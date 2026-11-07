import { useEffect, useMemo, useRef, useState } from "react";
import { tagCountLabel, type Tag, type TagLink } from "../db";
import {
  CX,
  CY,
  R_MIN,
  VIEW_H,
  VIEW_W,
  clustersOf,
  countOf,
  edgeCurve,
  pairKey,
  radiusOf,
  relax,
  type Pos,
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
  const [mode, setMode] = useState<Mode>("connect");
  const [auto, setAuto] = useState<boolean>(() => loadAuto());
  const [stored, setStored] = useState<Record<string, Pos>>(() => loadPositions());
  const [animated, setAnimated] = useState<Record<number, Pos>>({});
  const [dragging, setDragging] = useState<number | null>(null);
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [pointer, setPointer] = useState<Pos | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DrawnEdge | null>(null);

  const maxCount = useMemo(() => Math.max(1, ...tags.map(countOf)), [tags]);

  const radii = useMemo(() => {
    const map = new Map<number, number>();
    for (const tag of tags) map.set(tag.id, radiusOf(countOf(tag), maxCount));
    return map;
  }, [tags, maxCount]);

  const clusters = useMemo(() => clustersOf(tags, links), [tags, links]);

  /** 同一对标签的 A→B 与 B→A 合并成一条线（不画箭头），删除时整条删掉 */
  const drawnEdges = useMemo<DrawnEdge[]>(() => {
    const map = new Map<string, DrawnEdge>();
    for (const link of links) {
      const key = pairKey(link.source_tag_id, link.target_tag_id);
      const existing = map.get(key);
      if (existing) existing.both = true;
      else map.set(key, { a: link.source_tag_id, b: link.target_tag_id, both: false });
    }
    return [...map.values()];
  }, [links]);

  useEffect(() => {
    if (!auto) return;

    const sim = simRef.current;
    for (const tag of tags) {
      const radius = radii.get(tag.id) ?? R_MIN;
      const existing = sim.get(tag.id);
      if (existing) {
        existing.r = radius;
      } else {
        const group = clusters.groups.get(clusters.groupOf.get(tag.id) ?? -1) ?? [];
        let sx = CX;
        let sy = CY;
        let total = 0;
        for (const id of group) {
          const node = sim.get(id);
          if (!node) continue;
          sx += node.x;
          sy += node.y;
          total += 1;
        }
        if (total > 0) {
          sx /= total + 1;
          sy /= total + 1;
        }
        sim.set(tag.id, {
          id: tag.id,
          r: radius,
          x: sx + (Math.random() - 0.5) * 30,
          y: sy + (Math.random() - 0.5) * 30,
        });
      }
    }
    for (const id of [...sim.keys()]) {
      if (!tags.some((tag) => tag.id === id)) sim.delete(id);
    }

    let raf = 0;
    let calm = 0;
    let frames = 0;

    const tick = () => {
      const nodes = [...sim.values()];
      const before = nodes.map((node) => ({ x: node.x, y: node.y }));
      // 快速降温：260 帧后彻底冻结，大撞击也不会留下缓慢蠕动
      const damp = frames < 260 ? Math.max(0.05, 1 - frames / 260) : 0;
      relax(nodes, links, clusters, damp, frames < 220);
      let moved = 0;
      nodes.forEach((node, index) => {
        moved = Math.max(moved, Math.hypot(node.x - before[index].x, node.y - before[index].y));
      });

      const next: Record<number, Pos> = {};
      for (const node of nodes) next[node.id] = { x: node.x, y: node.y };
      setAnimated(next);

      frames += 1;
      calm = moved < 0.12 ? calm + 1 : 0;
      if (calm < 5 && frames < 400) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [auto, tags, links, clusters, radii]);

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

  const nameOf = (id: number) => tags.find((tag) => tag.id === id)?.name ?? `#${id}`;
  const colorOf = (id: number) => tags.find((tag) => tag.id === id)?.color ?? "#8a8f98";
  const radiusFor = (id: number) => radii.get(id) ?? R_MIN;

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
    for (const tag of tags) {
      const pos = positions[tag.id];
      if (!pos) continue;
      const distance = Math.hypot(pos.x - point.x, pos.y - point.y);
      if (distance < radiusFor(tag.id) + 10 && distance < bestDistance) {
        best = tag.id;
        bestDistance = distance;
      }
    }
    return best;
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

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const point = toPoint(event);
    if (dragging !== null) {
      persist({ ...positions, [dragging]: point });
    } else if (connectFrom !== null) {
      setPointer(point);
    }
  }

  function handleUp(event: React.PointerEvent<SVGSVGElement>) {
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
          className={auto ? "auto-on" : "ghost"}
          onClick={() => setAuto((value) => !value)}
          title="按记录数量与关系持续微调：相连的靠拢、隔跳的推开、族群互斥、整体铺满画布"
        >
          自适应分布：{auto ? "开" : "关"}
        </button>
        <p className="muted">
          {mode === "connect"
            ? "从一个标签拖到另一个标签 = 建立 A → B 关系；点线可删除"
            : "拖动标签调整位置，位置会记住"}
          {"  ·  圈内为 标签名 / 记录总数 / (自身+外部)  ·  "}
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
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
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
          const obstacles = tags
            .filter((tag) => tag.id !== edge.a && tag.id !== edge.b)
            .map((tag) => ({
              id: tag.id,
              x: positions[tag.id]?.x ?? 0,
              y: positions[tag.id]?.y ?? 0,
              r: radiusFor(tag.id),
            }));
          const curve = edgeCurve(from, to, radiusFor(edge.a), radiusFor(edge.b), obstacles, [edge.a, edge.b], 12);
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          // 双向关系画成双线（本质还是一条连接），单向画单线 + 箭头
          const offsets = edge.both ? [-2.4, 2.4] : [0];
          const shifted = (off: number) =>
            `M ${curve.x1 + nx * off} ${curve.y1 + ny * off} Q ${curve.cx + nx * off} ${curve.cy + ny * off} ${curve.x2 + nx * off} ${curve.y2 + ny * off}`;
          const hitPath = shifted(0);
          return (
            <g key={`${edge.a}-${edge.b}`} className="graph-edge">
              {offsets.map((off) => (
                <g key={off}>
                  <path d={shifted(off)} fill="none" stroke="#ffffff" strokeWidth={6} strokeLinecap="round" />
                  <path
                    d={shifted(off)}
                    fill="none"
                    stroke="#4b5563"
                    strokeWidth={edge.both ? 1.4 : 1.8}
                    markerEnd={edge.both ? undefined : "url(#tag-arrow)"}
                  />
                </g>
              ))}
              <path
                d={hitPath}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                style={{ cursor: "pointer" }}
                onClick={() => setPendingDelete(edge)}
              />
              <title>
                {edge.both ? `${nameOf(edge.a)} ↔ ${nameOf(edge.b)}` : `${nameOf(edge.a)} → ${nameOf(edge.b)}`}
              </title>
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

        {tags.map((tag) => {
          const pos = positions[tag.id];
          if (!pos) return null;
          const r = radiusFor(tag.id);
          const active = connectFrom === tag.id;
          const count = tagCountLabel(tag);
          const nameMax = r >= 44 ? 6 : r >= 34 ? 5 : 4;
          const label = tag.name.length > nameMax ? tag.name.slice(0, nameMax) : tag.name;
          const nameFont = r >= 44 ? 12 : r >= 34 ? 11 : 10;
          const countFont = r >= 44 ? 17 : r >= 34 ? 14 : 12;
          const showExtra = Boolean(count.extra) && r >= 42;
          return (
            <g
              key={tag.id}
              className={`graph-node ${active ? "active" : ""}`}
              transform={`translate(${pos.x} ${pos.y})`}
              onPointerDown={(event) => handleNodeDown(event, tag.id)}
              style={{ cursor: mode === "move" && !auto ? "grab" : "crosshair" }}
            >
              <circle r={r} fill="#fff" stroke={colorOf(tag.id)} strokeWidth={active ? 3.4 : 2.2} />
              <text y={showExtra ? -12 : -4} textAnchor="middle" className="graph-node-name" style={{ fontSize: nameFont }}>
                {label}
              </text>
              <text y={showExtra ? 6 : 12} textAnchor="middle" className="graph-node-count" style={{ fontSize: countFont }}>
                {count.main}
              </text>
              {showExtra && (
                <text y={22} textAnchor="middle" className="graph-node-extra">
                  {count.extra}
                </text>
              )}
              <title>
                {tag.name}：{count.main}
                {count.extra ?? ""} 条
              </title>
            </g>
          );
        })}
      </svg>
    </section>
  );
}