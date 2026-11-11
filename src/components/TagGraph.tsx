import { useEffect, useMemo, useRef, useState } from "react";
import { tagCountLabel, type Tag, type TagLink } from "../db";
import {
  CX,
  CY,
  R_MIN,
  VIEW_H,
  VIEW_W,
  clampToView,
  clustersOf,
  countCrossings,
  countOf,
  edgeCurve,
  pairKey,
  radiusOf,
  relax,
  crossingPointsFor,
  routeEdges,
  seedNodes,
  separateOnce,
  untangle,
  type Pos,
  type RelaxState,
  type SimNode,
} from "./tagGraphLayout";

interface Props {
  tags: Tag[];
  links: TagLink[];
  onCreateLink: (sourceId: number, targetId: number) => void;
  onDeleteLink: (sourceId: number, targetId: number) => void;
}

const POS_KEY = "vibe-diary:tag-graph-positions";
const AUTO_KEY = "vibe-diary:tag-graph-auto";

type Mode = "connect" | "move";

interface Bounds {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

/** 视口中心允许的活动范围：内容中心 ± 内容尺寸的一半（可移动总量 = 内容尺寸 × 2） */
function clampCenterToBounds(point: Pos, bounds: Bounds): Pos {
  return {
    x: Math.min(bounds.cx + bounds.halfW, Math.max(bounds.cx - bounds.halfW, point.x)),
    y: Math.min(bounds.cy + bounds.halfH, Math.max(bounds.cy - bounds.halfH, point.y)),
  };
}

interface DrawnEdge {
  a: number;
  b: number;
  both: boolean;
}

function loadPositions(): Record<string, Pos> {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Pos>) : {};
  } catch {
    return {};
  }
}

function loadAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

export default function TagGraph({ tags, links, onCreateLink, onDeleteLink }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<Map<number, SimNode>>(new Map());
  const stateRef = useRef<RelaxState>({ frame: 0, flipped: new Map() });
  const untangleRoundsRef = useRef(0);
  const idleRef = useRef(false);
  const restRef = useRef<Map<number, Pos>>(new Map());
  const hoverRef = useRef<number | null>(null);
  const prevAutoRef = useRef<boolean | null>(null);
  const animatedRef = useRef<Record<number, Pos>>({});
  const calmResetRef = useRef(false);
  const tweenRef = useRef<{ from: Map<number, Pos>; to: Map<number, Pos>; t: number } | null>(null);
  const [mode, setMode] = useState<Mode>("connect");
  const [auto, setAuto] = useState<boolean>(() => loadAuto());
  const [stored, setStored] = useState<Record<string, Pos>>(() => loadPositions());
  const [animated, setAnimated] = useState<Record<number, Pos>>({});
  const [dragging, setDragging] = useState<number | null>(null);
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [pointer, setPointer] = useState<Pos | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DrawnEdge | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  /** 视口中心；null = 跟随内容中心 */
  const [center, setCenter] = useState<Pos | null>(null);
  const viewRef = useRef({ zoom: 1, center: null as Pos | null });
  const boundsRef = useRef({ cx: CX, cy: CY, halfW: VIEW_W / 4, halfH: VIEW_H / 4 });
  const panRef = useRef<{ clientX: number; clientY: number; cx: number; cy: number; viewW: number; rectW: number } | null>(
    null,
  );

  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const visibleIds = useMemo(() => new Set(tags.map((tag) => tag.id)), [tags]);
  const visibleTags = tags;
  const visibleLinks = links;
  const revealComplete = true;

  const maxCount = useMemo(() => Math.max(1, ...tags.map(countOf)), [tags]);

  const radii = useMemo(() => {
    const map = new Map<number, number>();
    for (const tag of tags) map.set(tag.id, radiusOf(countOf(tag), maxCount));
    return map;
  }, [tags, maxCount]);

  // 注意：helper 必须定义在用到它们的 useMemo 之前，否则 render 时会踩 TDZ（曾导致整页空白）
  const radiusFor = (id: number) => radii.get(id) ?? R_MIN;
  const nameOf = (id: number) => tagById.get(id)?.name ?? "#" + id;
  const colorOf = (id: number) => tagById.get(id)?.color ?? "#8a8f98";

  const clusters = useMemo(() => clustersOf(visibleTags, visibleLinks), [visibleTags, visibleLinks]);

  const drawnEdges = useMemo<DrawnEdge[]>(() => {
    const map = new Map<string, DrawnEdge>();
    for (const link of visibleLinks) {
      const key = pairKey(link.source_tag_id, link.target_tag_id);
      const existing = map.get(key);
      if (existing) existing.both = true;
      else map.set(key, { a: link.source_tag_id, b: link.target_tag_id, both: false });
    }
    return [...map.values()];
  }, [visibleLinks]);

  useEffect(() => {
    untangleRoundsRef.current = 0;
    tweenRef.current = null;
  }, [visibleLinks, revealComplete]);

  useEffect(() => {
    if (!auto) return;

    const sim = simRef.current;
    for (const tag of visibleTags) {
      const radius = radii.get(tag.id) ?? R_MIN;
      const existing = sim.get(tag.id);
      if (existing) {
        existing.r = radius;
      } else {
        const seeded = seedNodes(visibleTags, visibleLinks, radii).find((node) => node.id === tag.id);
        sim.set(tag.id, {
          id: tag.id,
          r: radius,
          x: (seeded?.x ?? CX) + (Math.random() - 0.5) * 18,
          y: (seeded?.y ?? CY) + (Math.random() - 0.5) * 18,
        });
      }
    }
    for (const id of [...sim.keys()]) {
      if (!tagById.has(id)) sim.delete(id);
    }

    let raf = 0;
    let calm = 0;
    let frames = 0;

    const publish = () => {
      const next: Record<number, Pos> = {};
      for (const node of sim.values()) next[node.id] = { x: node.x, y: node.y };
      animatedRef.current = next;
      setAnimated(next);
    };

    const enterIdle = () => {
      restRef.current = new Map([...sim.values()].map((node) => [node.id, { x: node.x, y: node.y }]));
      idleRef.current = true;
    };

    // 悬停影响范围：被悬停的节点 + 1~2 跳邻居
    const hoverNeighborhood = (center: number): Map<number, number> => {
      const depth = new Map<number, number>([[center, 0]]);
      let frontier = [center];
      for (let level = 1; level <= 2; level += 1) {
        const next: number[] = [];
        for (const id of frontier) {
          for (const link of visibleLinks) {
            const other =
              link.source_tag_id === id ? link.target_tag_id : link.target_tag_id === id ? link.source_tag_id : null;
            if (other === null || depth.has(other)) continue;
            depth.set(other, level);
            next.push(other);
          }
        }
        frontier = next;
      }
      return depth;
    };

    // 静止后的"呼吸"：回弹到安息位置 + 极小幅扰动；鼠标悬停时给附近节点一点推力
    let breath = 0;
    const idleTick = () => {
      breath += 0.011; // 约 9 秒一个周期：慢，但幅度看得见
      for (const node of sim.values()) {
        const rest = restRef.current.get(node.id);
        if (!rest) continue;
        const seed = ((node.id * 37) % 100) * 0.0628;
        const targetX = rest.x + Math.cos(breath + seed) * 4.2;
        const targetY = rest.y + Math.sin(breath * 0.78 + seed * 1.4) * 3.6;
        node.x += (targetX - node.x) * 0.05;
        node.y += (targetY - node.y) * 0.05;
      }

      const hoveredId = hoverRef.current;
      if (hoveredId !== null) {
        const center = sim.get(hoveredId);
        if (center) {
          for (const [id, level] of hoverNeighborhood(hoveredId)) {
            const node = sim.get(id);
            if (!node) continue;
            const dx = node.x - center.x;
            const dy = node.y - center.y;
            const len = Math.hypot(dx, dy);
            if (len < 0.5) continue;
            const amp = level === 0 ? 0.55 : level === 1 ? 0.35 : 0.2;
            node.x += (dx / len) * amp;
            node.y += (dy / len) * amp;
            node.x = Math.min(VIEW_W - node.r - 3, Math.max(node.r + 3, node.x));
            node.y = Math.min(VIEW_H - node.r - 3, Math.max(node.r + 3, node.y));
          }
        }
      }
      clampToView([...sim.values()]);
      publish();
      raf = requestAnimationFrame(tick);
    };

    const tick = () => {
      const tween = tweenRef.current;
      if (tween) {
        tween.t = Math.min(1, tween.t + 1 / 18);
        for (const node of sim.values()) {
          const from = tween.from.get(node.id);
          const to = tween.to.get(node.id);
          if (!from || !to) continue;
          node.x = from.x + (to.x - from.x) * tween.t;
          node.y = from.y + (to.y - from.y) * tween.t;
        }
        clampToView([...sim.values()]);
        publish();
        if (tween.t >= 1) {
          tweenRef.current = null;
          idleRef.current = false;
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      if (idleRef.current) {
        idleTick();
        return;
      }

      if (calmResetRef.current) {
        calmResetRef.current = false;
        calm = 0;
        frames = 0;
      }

      const nodes = [...sim.values()];
      const before = nodes.map((node) => ({ x: node.x, y: node.y }));
      const damp = frames < 260 ? Math.max(0.05, 1 - frames / 260) : 0;
      stateRef.current.frame = frames;
      relax(nodes, visibleLinks, clusters, damp, frames < 220, stateRef.current);
      let moved = 0;
      nodes.forEach((node, index) => {
        moved = Math.max(moved, Math.hypot(node.x - before[index].x, node.y - before[index].y));
      });
      publish();

      frames += 1;
      calm = moved < 0.12 ? calm + 1 : 0;

      const crossed = revealComplete && nodes.length > 0 ? countCrossings(nodes, visibleLinks) : 0;
      // 兜底不等到完全静止：跑到 90 帧只要还有交叉就先解一轮（最多两轮）
      const earlyDue = crossed > 0 && frames >= 25 && untangleRoundsRef.current < 2;
      const lateDue = crossed > 0 && calm >= 5 && untangleRoundsRef.current < 3;
      if (earlyDue || lateDue) {
        untangleRoundsRef.current += 1;
        {
          const snapshot = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
          untangle(nodes, visibleLinks, clusters);
          // 分离可能把圆挤回交叉状态，交替再来两轮
          for (let pass = 0; pass < 2; pass += 1) {
            separateOnce(nodes, clusters);
            if (countCrossings(nodes, visibleLinks) === 0) break;
            untangle(nodes, visibleLinks, clusters, 30);
          }
          separateOnce(nodes, clusters);
          const target = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
          for (const node of nodes) {
            const from = snapshot.get(node.id);
            if (from) {
              node.x = from.x;
              node.y = from.y;
            }
          }
          tweenRef.current = { from: snapshot, to: target, t: 0 };
          raf = requestAnimationFrame(tick);
          return;
        }
      }

      if (calm < 5 && frames < 400) {
        raf = requestAnimationFrame(tick);
        return;
      }
      enterIdle();
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [auto, visibleTags, visibleLinks, clusters, radii, revealComplete, tagById]);

  // 悬停只同步给渲染循环（真正的推力在 idleTick 里），不再单独起动画
  useEffect(() => {
    hoverRef.current = hovered;
  }, [hovered]);

  // 重新打开自适应：把引擎的位置对齐到"当前画面"（可能是手动调过的 B 状态），
  // 然后从这儿继续自己排，而不是回到关闭前的旧布局
  useEffect(() => {
    const wasAuto = prevAutoRef.current === true;
    prevAutoRef.current = auto;
    if (wasAuto || !auto) return;
    const sim = simRef.current;
    const current = animatedRef.current;
    for (const tag of tags) {
      // 手动期间 animated 不会更新（循环停了），所以手动位置优先：stored 才是"当前画面"
      const pos = stored[tag.id] ?? current[tag.id];
      if (!pos) continue;
      const node = sim.get(tag.id);
      if (node) {
        node.x = pos.x;
        node.y = pos.y;
      } else {
        sim.set(tag.id, { id: tag.id, r: radii.get(tag.id) ?? R_MIN, x: pos.x, y: pos.y });
      }
    }
    untangleRoundsRef.current = 0;
    idleRef.current = false;
    tweenRef.current = null;
    calmResetRef.current = true;
  }, [auto]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_KEY, auto ? "on" : "off");
    } catch {
      /* 忽略 */
    }
  }, [auto]);

  useEffect(() => {
    if (auto || dragging !== null) return;
    setStored((prev) => {
      const merged: Record<string, Pos> = { ...prev };
      let changed = false;
      tags.forEach((tag, index) => {
        if (!merged[tag.id]) {
          merged[tag.id] = { x: 90 + (index % 8) * 142, y: 90 + Math.floor(index / 8) * 118 };
          changed = true;
        }
      });
      return changed ? merged : prev;
    });
  }, [auto, tags, dragging]);

  const positions = useMemo(() => {
    if (auto) {
      const next: Record<number, Pos> = {};
      for (const tag of tags) {
        const fromSim = animated[tag.id];
        const fromStored = stored[tag.id];
        next[tag.id] = fromSim ?? fromStored ?? { x: CX, y: CY };
      }
      return next;
    }
    const next: Record<number, Pos> = {};
    const columns = Math.max(6, Math.ceil(Math.sqrt(tags.length * (VIEW_W / VIEW_H))));
    tags.forEach((tag, index) => {
      next[tag.id] = stored[tag.id] ?? {
        x: 90 + (index % columns) * (VIEW_W / (columns + 0.5)),
        y: 90 + Math.floor(index / columns) * 118,
      };
    });
    return next;
  }, [auto, animated, stored, tags]);
  /** 内容包围盒（用于限制拖动范围：可移动范围 = 内容尺寸 × 2，内容始终至少露出一半） */
  const contentBounds = useMemo(() => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [key, node] of Object.entries(positions)) {
      if (!node) continue;
      const r = radii.get(Number(key)) ?? 24;
      minX = Math.min(minX, node.x - r);
      minY = Math.min(minY, node.y - r);
      maxX = Math.max(maxX, node.x + r);
      maxY = Math.max(maxY, node.y + r);
    }
    if (!Number.isFinite(minX)) {
      return { cx: CX, cy: CY, halfW: VIEW_W / 4, halfH: VIEW_H / 4 };
    }
    const width = Math.max(120, maxX - minX);
    const height = Math.max(120, maxY - minY);
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, halfW: width / 2, halfH: height / 2 };
  }, [positions, radii]);

  const viewBox = useMemo(() => {
    const w = VIEW_W / zoom;
    const h = VIEW_H / zoom;
    const cx = center?.x ?? contentBounds.cx;
    const cy = center?.y ?? contentBounds.cy;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
  }, [zoom, center, contentBounds]);

  useEffect(() => {
    viewRef.current = { zoom, center };
  }, [zoom, center]);

  useEffect(() => {
    boundsRef.current = contentBounds;
  }, [contentBounds]);

  // 滚轮缩放：以鼠标位置为中心
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const before = viewRef.current;
      const bounds = boundsRef.current;
      const w1 = VIEW_W / before.zoom;
      const h1 = VIEW_H / before.zoom;
      const cx1 = before.center?.x ?? bounds.cx;
      const cy1 = before.center?.y ?? bounds.cy;
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      // 鼠标指向的内容坐标（缩放前后必须同一点）
      const px = cx1 - w1 / 2 + fx * w1;
      const py = cy1 - h1 / 2 + fy * h1;
      const nextZoom = Math.min(3, Math.max(0.4, before.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      const w2 = VIEW_W / nextZoom;
      const h2 = VIEW_H / nextZoom;
      const nextCenter = clampCenterToBounds({ x: px + w2 * (0.5 - fx), y: py + h2 * (0.5 - fy) }, bounds);
      viewRef.current = { zoom: nextZoom, center: nextCenter };
      setZoom(nextZoom);
      setCenter(nextCenter);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);


  const routedCurves = useMemo(
    () => routeEdges(drawnEdges.map((edge) => ({ key: edge.a + "-" + edge.b, a: edge.a, b: edge.b })), positions, radiusFor, 12),
    [drawnEdges, positions, radii],
  );

  // 交叉点：后画的线在这些点先垫一块底色，看起来是从缺口跨过去，而不是打结
  const crossingPoints = useMemo(
    () =>
      crossingPointsFor(
        drawnEdges.map((edge) => ({ key: edge.a + "-" + edge.b, a: edge.a, b: edge.b })),
        routedCurves,
      ),
    [drawnEdges, routedCurves],
  );



  function toPoint(event: React.PointerEvent<SVGSVGElement>): Pos {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const mapped = pt.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
  }

  function hitTest(point: Pos): number | null {
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const id of visibleIds) {
      const pos = positions[id];
      if (!pos) continue;
      const distance = Math.hypot(pos.x - point.x, pos.y - point.y);
      if (distance < radiusFor(id) + 10 && distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** 手动触发一次"重新排布"：从族群种子重新铺，再平滑过渡 + 松弛 */
  function reseed() {
    const sim = simRef.current;
    if (sim.size === 0) return;
    const from = new Map([...sim.values()].map((node) => [node.id, { x: node.x, y: node.y }]));
    const seeded = seedNodes(tags, links, radii);
    const to = new Map(seeded.map((node) => [node.id, { x: node.x, y: node.y }]));
    stateRef.current = { frame: 0, flipped: new Map() };
    untangleRoundsRef.current = 0;
    idleRef.current = false;
    calmResetRef.current = true;
    tweenRef.current = { from, to, t: 0 };
  }

  function toggleAuto() {
    if (auto) {
      // 关闭自适应：把当前画面上的位置固化为手动位置（不要回落到网格）
      const snapshot: Record<string, Pos> = { ...stored };
      for (const tag of tags) {
        const pos = animated[tag.id];
        if (pos) snapshot[tag.id] = pos;
      }
      persist(snapshot);
      animatedRef.current = snapshot;
    }
    setAuto((value) => !value);
  }

  function persist(next: Record<string, Pos>) {
    setStored(next);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    } catch {
      /* 忽略 */
    }
  }

  function handleNodeDown(event: React.PointerEvent<SVGGElement>, tagId: number) {
    event.preventDefault();
    (event.currentTarget as SVGGElement).setPointerCapture?.(event.pointerId);
    if (mode === "connect") {
      setConnectFrom(tagId);
      setPointer(toPoint(event as unknown as React.PointerEvent<SVGSVGElement>));
    } else if (!auto) {
      setDragging(tagId);
    }
  }

  function handleCanvasDown(event: React.PointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest(".graph-node")) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const current = viewRef.current;
    const bounds = boundsRef.current;
    const from = current.center ?? { x: bounds.cx, y: bounds.cy };
    panRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      cx: from.x,
      cy: from.y,
      viewW: VIEW_W / current.zoom,
      rectW: rect.width,
    };
    (event.currentTarget as SVGSVGElement).setPointerCapture?.(event.pointerId);
  }

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const pan = panRef.current;
    if (pan) {
      const scale = pan.viewW / pan.rectW;
      const next = clampCenterToBounds(
        { x: pan.cx - (event.clientX - pan.clientX) * scale, y: pan.cy - (event.clientY - pan.clientY) * scale },
        boundsRef.current,
      );
      viewRef.current = { ...viewRef.current, center: next };
      setCenter(next);
      return;
    }
    const point = toPoint(event);
    if (dragging !== null) {
      persist({ ...positions, [dragging]: point });
    } else if (connectFrom !== null) {
      setPointer(point);
    }
  }

  function handleUp(event: React.PointerEvent<SVGSVGElement>) {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    if (connectFrom !== null) {
      const target = hitTest(toPoint(event));
      if (target !== null && target !== connectFrom) onCreateLink(connectFrom, target);
      setConnectFrom(null);
      setPointer(null);
    }
    setDragging(null);
  }

  return (
    <section className="graph">
      <div className="graph-toolbar">
        <div className="segmented">
          <button type="button" className={mode === "connect" ? "active" : ""} onClick={() => setMode("connect")}>
            连线
          </button>
          <button
            type="button"
            className={mode === "move" ? "active" : ""}
            disabled={auto}
            title={auto ? "自适应分布开启时不能自由移动" : "拖动标签调整位置"}
            onClick={() => setMode("move")}
          >
            移动
          </button>
        </div>
        <button
          type="button"
          className="ghost"
          disabled={!auto}
          title={auto ? "从族群种子重新排布一次（会重新解交叉）" : "先打开「自适应分布」才能重新排布"}
          onClick={reseed}
        >
          重新排布
        </button>
        <button
          type="button"
          className={auto ? "auto-on" : "ghost"}
          onClick={toggleAuto}
          title="按记录数量与关系持续微调：相连的靠拢、隔跳的推开、族群互斥、整体铺满画布"
        >
          自适应分布：{auto ? "开" : "关"}
        </button>
        <button
          type="button"
          className="flat"
          title="滚轮缩放画布；点这里恢复 100%"
          onClick={() => {
            viewRef.current = { zoom: 1, center: null };
            setZoom(1);
            setCenter(null);
          }}
        >
          缩放 {Math.round(zoom * 100)}%
        </button>
        <p className="muted">
          {mode === "connect" ? "从一个标签拖到另一个标签 = 建立 A → B 关系；点线可删除" : "拖动标签调整位置，位置会记住"}
          {"  ·  圆面积 ∝ 数量（<50 按 50 算）  ·  "}
          {tags.length}
          {" 个标签 / "}
          {drawnEdges.length}
          {" 条关系线"}
        </p>
      </div>

      {pendingDelete && (
        <div className="graph-confirm">
          删除关系「{nameOf(pendingDelete.a)}
          {pendingDelete.both ? " ↔ " : " → "}
          {nameOf(pendingDelete.b)}」？
          <button
            type="button"
            onClick={() => {
              onDeleteLink(pendingDelete.a, pendingDelete.b);
              setPendingDelete(null);
            }}
          >
            删除
          </button>
          <button type="button" className="ghost" onClick={() => setPendingDelete(null)}>
            取消
          </button>
        </div>
      )}

      <svg
        ref={svgRef}
        className="graph-canvas"
        viewBox={viewBox.x + " " + viewBox.y + " " + viewBox.w + " " + viewBox.h}
        onPointerDown={handleCanvasDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
      >
        <defs>
          <marker
            id="tag-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="4.2"
            markerHeight="4.2"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563" />
          </marker>
        </defs>

        {drawnEdges.map((edge) => {
          const from = positions[edge.a];
          const to = positions[edge.b];
          if (!from || !to) return null;
          const curve = routedCurves.get(edge.a + "-" + edge.b) ?? edgeCurve(from, to, radiusFor(edge.a), radiusFor(edge.b), [], [edge.a, edge.b], 12);
          const shift = (off: number, nx: number, ny: number) =>
            "M " + (curve.x1 + nx * off) + " " + (curve.y1 + ny * off) + " Q " + (curve.cx + nx * off) + " " +
            (curve.cy + ny * off) + " " + (curve.x2 + nx * off) + " " + (curve.y2 + ny * off);
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const offsets = edge.both ? [-2.4, 2.4] : [0];
          return (
            <g key={edge.a + "-" + edge.b} className="graph-edge">
              {(crossingPoints.get(edge.a + "-" + edge.b) ?? []).map((point, index) => (
                <circle key={"gap-" + index} cx={point.x} cy={point.y} r={6} fill="#fcfcfa" />
              ))}
              {offsets.map((off) => (
                <g key={off}>
                  <path d={shift(off, nx, ny)} fill="none" stroke="#ffffff" strokeWidth={6} strokeLinecap="round" />
                  <path
                    d={shift(off, nx, ny)}
                    fill="none"
                    stroke="#4b5563"
                    strokeWidth={edge.both ? 1.4 : 1.8}
                    markerEnd={edge.both ? undefined : "url(#tag-arrow)"}
                  />
                </g>
              ))}
              <path
                d={shift(0, 0, 0)}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                style={{ cursor: "pointer" }}
                onClick={() => setPendingDelete(edge)}
              />
              <title>{edge.both ? nameOf(edge.a) + " ↔ " + nameOf(edge.b) : nameOf(edge.a) + " → " + nameOf(edge.b)}</title>
            </g>
          );
        })}

        {connectFrom !== null && pointer && positions[connectFrom] && (
          <line
            x1={positions[connectFrom].x}
            y1={positions[connectFrom].y}
            x2={pointer.x}
            y2={pointer.y}
            stroke="#2f6bff"
            strokeDasharray="6 4"
            strokeWidth={1.8}
          />
        )}

        {visibleTags.map((tag) => {
          const pos = positions[tag.id];
          if (!pos) return null;
          const r = radiusFor(tag.id);
          const active = connectFrom === tag.id;
          const count = tagCountLabel(tag);
          const showNameInside = r >= 22;
          const nameMax = r >= 40 ? 6 : r >= 30 ? 5 : 4;
          const label = tag.name.length > nameMax ? tag.name.slice(0, nameMax) : tag.name;
          const nameFont = r >= 40 ? 12 : r >= 30 ? 11 : 10;
          const countFont = r >= 40 ? 15 : r >= 30 ? 13 : 11;
          const showExtra = Boolean(count.extra) && r >= 44;
          return (
            <g
              key={tag.id}
              className={"graph-node" + (active ? " active" : "") + (hovered === tag.id ? " hovered" : "")}
              transform={"translate(" + pos.x + " " + pos.y + ")"}
              onPointerDown={(event) => handleNodeDown(event, tag.id)}
              onPointerEnter={() => setHovered(tag.id)}
              onPointerLeave={() => setHovered((current) => (current === tag.id ? null : current))}
              style={{ cursor: mode === "move" && !auto ? "grab" : "crosshair" }}
            >
              <g style={{ transform: hovered === tag.id ? "scale(1.07)" : "scale(1)", transformOrigin: "0px 0px", transition: "transform 160ms ease" }}>
              <circle r={r} fill="#fff" stroke={colorOf(tag.id)} strokeWidth={active ? 3.4 : hovered === tag.id ? 3 : 2.2} />
              {showNameInside && (
                <text y={showExtra ? -12 : -4} textAnchor="middle" className="graph-node-name" style={{ fontSize: nameFont }}>
                  {label}
                </text>
              )}
              <text y={showExtra ? 6 : showNameInside ? 12 : 4} textAnchor="middle" className="graph-node-count" style={{ fontSize: countFont }}>
                {count.main}
              </text>
              {showExtra && (
                <text y={22} textAnchor="middle" className="graph-node-extra">
                  {count.extra}
                </text>
              )}
              {!showNameInside && (
                <text y={r + 13} textAnchor="middle" className="graph-node-caption">
                  {tag.name}
                </text>
              )}
              <title>{tag.name + "：" + count.main + (count.extra ?? "") + " 条"}</title>
              </g>
            </g>
          );
        })}
      </svg>
    </section>
  );
}