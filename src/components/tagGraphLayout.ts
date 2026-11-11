import type { Tag, TagLink } from "../db";

/** 画布尺寸（SVG viewBox） */
export const VIEW_W = 1200;
export const VIEW_H = 760;
export const CX = VIEW_W / 2;
export const CY = VIEW_H / 2;

export const R_MIN = 22; // 视觉下限：再小就放不下数字
export const R_MAX = 84;
/** 数量下限：少于这个数的标签按这个数算面积（用户要求：太小的归一档） */
export const AREA_FLOOR = 50;

// 圆-圆（按关系远近分档：越远推得越开）
export const GAP = 10;
/** 直接相连的两圆：保证连线至少有这么长，否则箭头会把线整个吃掉 */
export const LINKED_GAP = 32;
export const NEAR2_GAP = 28;
export const NEAR3_GAP = 46;
export const CLUSTER_GAP = 52;
export const LONELY_GAP = 40;
export const REPULSION = 0.7;
// 直接相连的两圆互相吸
export const SPRING = 0.13;
export const IDEAL_GAP = 56;
// 族群 / 重力
export const CLUSTER_PULL = 0.035;
export const GRAVITY = 0.0016;
export const ASPECT_Y = 2.2;
// 线与圆、线与线
export const EDGE_CLEARANCE = 14;
export const EDGE_PUSH = 0.6;
export const FLIP_COOLDOWN = 40; // 同一个端点两次硬翻之间的最小帧间隔（防抽搐）
export const FLIP_PER_FRAME = 2; // 每帧最多解几个交叉（先解最严重的）
export const EDGE_ROTATE = 0.02; // 交叉时每条边绕中点旋转的弧度
  export const EDGE_EDGE_MIN = 30; // 两条线之间的最小距离（线也有体积）
export const EDGE_EDGE_PUSH = 0.3;

export interface Pos {
  x: number;
  y: number;
}

export interface SimNode {
  id: number;
  r: number;
  x: number;
  y: number;
}

export interface Clusters {
  groups: Map<number, number[]>;
  groupOf: Map<number, number>;
  sizeOf: Map<number, number>;
  /** 同一族群里两点的最短跳数（1..3，3 表示 ≥3 跳） */
  hops: Map<string, number>;
}

export function pairKey(a: number, b: number) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function countOf(tag: Tag) {
  return Math.max(tag.reach ?? 0, tag.usage ?? 0);
}

/**
 * 半径：**面积正比于数量**（r = k·sqrt(n)），所以 面积比 = 数量比。
 * 数量不足 AREA_FLOOR 的按 AREA_FLOOR 算（小标签归成同一档），再夹到 [R_MIN, R_MAX]。
 */
export function radiusOf(count: number, maxCount: number) {
  const m = Math.max(maxCount, AREA_FLOOR, 1);
  const c = Math.max(count, AREA_FLOOR);
  const r = R_MAX * Math.sqrt(c / m);
  return Math.max(R_MIN, Math.min(R_MAX, r));
}

export function clustersOf(tags: Tag[], links: TagLink[]): Clusters {
  const parent = new Map<number, number>();
  const adjacency = new Map<number, Set<number>>();
  tags.forEach((tag) => {
    parent.set(tag.id, tag.id);
    adjacency.set(tag.id, new Set());
  });
  const find = (id: number): number => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current) as number;
    return current;
  };
  for (const link of links) {
    const a = link.source_tag_id;
    const b = link.target_tag_id;
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  }

  const groups = new Map<number, number[]>();
  const groupOf = new Map<number, number>();
  const sizeOf = new Map<number, number>();
  for (const tag of tags) {
    const root = find(tag.id);
    groupOf.set(tag.id, root);
    sizeOf.set(root, (sizeOf.get(root) ?? 0) + 1);
    const list = groups.get(root) ?? [];
    list.push(tag.id);
    groups.set(root, list);
  }

  const hops = new Map<string, number>();
  for (const tag of tags) {
    const seen = new Map<number, number>([[tag.id, 0]]);
    let frontier = [tag.id];
    for (let depth = 1; depth <= 3; depth += 1) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (seen.has(neighbor)) continue;
          seen.set(neighbor, depth);
          next.push(neighbor);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    for (const [other, depth] of seen) {
      if (other === tag.id) continue;
      hops.set(pairKey(tag.id, other), Math.min(depth, 3));
    }
  }

  return { groups, groupOf, sizeOf, hops };
}

/** 点到线段的最短距离与最近点 */
export function segmentClosest(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { distance: Math.hypot(px - cx, py - cy), cx, cy };
}

/** 两个圆之间要求的最小间隙（按关系远近分档） */
export function requiredGap(idA: number, idB: number, ra: number, rb: number, meta: Clusters): number {
  const rootA = meta.groupOf.get(idA);
  const rootB = meta.groupOf.get(idB);
  const sameGroup = rootA !== undefined && rootA === rootB;
  const lonely = meta.sizeOf.get(rootA ?? -1) === 1 && meta.sizeOf.get(rootB ?? -2) === 1;
  const hops = meta.hops.get(pairKey(idA, idB)) ?? 3;
  let min = ra + rb + (hops === 1 ? LINKED_GAP : GAP);
  if (!sameGroup) min += CLUSTER_GAP;
  else if (hops === 2) min += NEAR2_GAP;
  else if (hops >= 3) min += NEAR3_GAP;
  if (lonely) min += LONELY_GAP;
  return min;
}

export interface EdgeCurve {
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
}

/**
 * 计算一条边的绘制曲线：如果直线会压到无关的圆，就把曲线往另一侧弯，
 * 让线绕开圆（节点位置交给力布局，绘制层面兜底，避免"线被圆圈盖住"）。
 */
export function edgeCurve(
  from: Pos,
  to: Pos,
  ra: number,
  rb: number,
  nodes: { id: number; x: number; y: number; r: number }[],
  skipIds: number[],
  clearance = 12,
): EdgeCurve {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x1 = from.x + ux * ra;
  const y1 = from.y + uy * ra;
  const x2 = to.x - ux * (rb + 4);
  const y2 = to.y - uy * (rb + 4);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = -uy;
  const ny = ux;

  const obstacles = nodes.filter((node) => !skipIds.includes(node.id));
  const make = (shift: number): EdgeCurve => ({ x1, y1, cx: mx + nx * shift, cy: my + ny * shift, x2, y2 });

  let shift = 0;
  for (let round = 0; round < 3; round += 1) {
    const curve = make(shift);
    const points = sampleCurve(curve, 14);
    let worst = 0;
    let worstSide = 0;
    for (const node of obstacles) {
      let penetration = 0;
      for (const point of points) {
        const gap = node.r + clearance - Math.hypot(point.x - node.x, point.y - node.y);
        if (gap > penetration) penetration = gap;
      }
      if (penetration - 2 > worst) {
        worst = penetration - 2;
        const cross = dx * (node.y - from.y) - dy * (node.x - from.x);
        worstSide = cross >= 0 ? 1 : -1;
      }
    }
    if (worst <= 0) break;
    shift += -worstSide * (worst * 2.3 + 10);
    if (Math.abs(shift) > 220) break;
  }

  return make(shift);
}

/** 让一条边绕自己的中点旋转（rad 为正=逆时针） */
export function rotateEdge(a: SimNode, b: SimNode, rad: number) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = (x: number, y: number) => {
    const dx = x - mx;
    const dy = y - my;
    return { x: mx + dx * cos - dy * sin, y: my + dx * sin + dy * cos };
  };
  const na = rotate(a.x, a.y);
  const nb = rotate(b.x, b.y);
  a.x = na.x;
  a.y = na.y;
  b.x = nb.x;
  b.y = nb.y;
}

/** 两条线段之间的最近点对（采样近似，够用且便宜） */
export function closestBetweenSegments(
  p1: Pos,
  p2: Pos,
  q1: Pos,
  q2: Pos,
): { distance: number; ax: number; ay: number; bx: number; by: number } {
  const steps = 6;
  let best = { distance: Number.POSITIVE_INFINITY, ax: p1.x, ay: p1.y, bx: q1.x, by: q1.y };
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const px = p1.x + (p2.x - p1.x) * t;
    const py = p1.y + (p2.y - p1.y) * t;
    for (let j = 0; j <= steps; j += 1) {
      const u = j / steps;
      const qx = q1.x + (q2.x - q1.x) * u;
      const qy = q1.y + (q2.y - q1.y) * u;
      const d = Math.hypot(px - qx, py - qy);
      if (d < best.distance) best = { distance: d, ax: px, ay: py, bx: qx, by: qy };
    }
  }
  return best;
}

/** 二次贝塞尔上的采样点（测试与命中判定用） */
export function sampleCurve(curve: EdgeCurve, steps = 24): Pos[] {
  const points: Pos[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt * mt * curve.x1 + 2 * mt * t * curve.cx + t * t * curve.x2,
      y: mt * mt * curve.y1 + 2 * mt * t * curve.cy + t * t * curve.y2,
    });
  }
  return points;
}

/** 两条线段是否真交叉（内点相交） */
export function segmentsCross(p: Pos, q: Pos, r: Pos, s: Pos): Pos | null {
  const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  if (Math.abs(d) < 1e-6) return null;
  const ua = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
  const ub = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
  if (ua <= 0.02 || ua >= 0.98 || ub <= 0.02 || ub >= 0.98) return null;
  return { x: p.x + ua * (q.x - p.x), y: p.y + ua * (q.y - p.y) };
}

/**
 * 一帧力导向松弛（位置式，自带阻尼）：
 * 1. 圆-圆排斥：直接相连的最小间隙 GAP；隔一跳 +NEAR2_GAP；更远 +NEAR3_GAP；跨族群 +CLUSTER_GAP；孤立对 +LONELY_GAP
 * 2. 弹簧：直接相连的两圆吸到 r1+r2+IDEAL_GAP
 * 3. 线-圆避让：线离无关圆心至少 r+EDGE_CLEARANCE
 * 4. 线-线不交叉：硬翻转端点（允许短暂穿透），避免慢慢挪被实体挡住
 * 5. 族群抱团：向自身质心收 CLUSTER_PULL
 * 6. 椭圆重力：纵向 ASPECT_Y 倍，铺满画布
 */
export interface RelaxState {
  frame: number;
  /** 端点 id → 上次被硬翻的帧号 */
  flipped: Map<number, number>;
}

function crossingDepth(p: Pos, q: Pos, r: Pos, s: Pos): number {
  const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  if (Math.abs(d) < 1e-6) return 0;
  const ua = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
  const ub = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
  if (ua <= 0.02 || ua >= 0.98 || ub <= 0.02 || ub >= 0.98) return 0;
  return Math.min(ua, 1 - ua, ub, 1 - ub);
}

export function relax(
  nodes: SimNode[],
  links: TagLink[],
  meta: Clusters,
  damp = 1,
  allowFlip = true,
  state?: RelaxState,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const startX = nodes.map((node) => node.x);
  const startY = nodes.map((node) => node.y);

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.001) {
        dx = 0.2 + (i % 5) * 0.15;
        dy = 0.2;
        distance = Math.hypot(dx, dy);
      }
      const minDistance = requiredGap(a.id, b.id, a.r, b.r, meta);

      if (distance < minDistance) {
        const push = ((minDistance - distance) / distance) * REPULSION;
        const sx = dx * push;
        const sy = dy * push;
        a.x -= sx;
        a.y -= sy;
        b.x += sx;
        b.y += sy;
      }
    }
  }

  const sprung = new Set<string>();
  for (const link of links) {
    const a = byId.get(link.source_tag_id);
    const b = byId.get(link.target_tag_id);
    if (!a || !b) continue;
    const key = pairKey(a.id, b.id);
    if (sprung.has(key)) continue; // 双向关系只算一次弹簧，避免吸力翻倍
    sprung.add(key);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy) || 0.001;
    // 如果这条线的直线上有别的圆挡着，就把两端拉开一些，让线尽量绷直（少弯=少抖）
    let blocked = false;
    for (const other of nodes) {
      if (other.id === a.id || other.id === b.id) continue;
      const closest = segmentClosest(other.x, other.y, a.x, a.y, b.x, b.y);
      if (closest.distance < other.r + EDGE_CLEARANCE) {
        blocked = true;
        break;
      }
    }
    const ideal = a.r + b.r + IDEAL_GAP + (blocked ? 26 : 0);
    const shift = ((distance - ideal) / distance) * SPRING;
    a.x += dx * shift;
    a.y += dy * shift;
    b.x -= dx * shift;
    b.y -= dy * shift;
  }

  for (const link of links) {
    const a = byId.get(link.source_tag_id);
    const b = byId.get(link.target_tag_id);
    if (!a || !b) continue;
    for (const node of nodes) {
      if (node.id === a.id || node.id === b.id) continue;
      const closest = segmentClosest(node.x, node.y, a.x, a.y, b.x, b.y);
      const need = node.r + EDGE_CLEARANCE;
      if (closest.distance < need && closest.distance > 0.001) {
        const push = (need - closest.distance) * EDGE_PUSH;
        node.x += ((node.x - closest.cx) / closest.distance) * push;
        node.y += ((node.y - closest.cy) / closest.distance) * push;
      }
    }
  }

  // 3.5) 线-线斥力：把每条线当成有体积的实体，靠太近就互相推开
  for (let i = 0; i < links.length; i += 1) {
    for (let j = i + 1; j < links.length; j += 1) {
      const e1a = byId.get(links[i].source_tag_id);
      const e1b = byId.get(links[i].target_tag_id);
      const e2a = byId.get(links[j].source_tag_id);
      const e2b = byId.get(links[j].target_tag_id);
      if (!e1a || !e1b || !e2a || !e2b) continue;
      if ([e1a.id, e1b.id].some((id) => id === e2a.id || id === e2b.id)) continue;

      const closest = closestBetweenSegments(e1a, e1b, e2a, e2b);
      if (closest.distance >= EDGE_EDGE_MIN) continue;
      const need = EDGE_EDGE_MIN - closest.distance;
      if (closest.distance < 1) {
        // 已经交叉/重合：沿各自中点反向微旋，把两条线"掰开"
        rotateEdge(e1a, e1b, EDGE_ROTATE);
        rotateEdge(e2a, e2b, -EDGE_ROTATE);
        continue;
      }
      const ux = (closest.bx - closest.ax) / closest.distance;
      const uy = (closest.by - closest.ay) / closest.distance;
      const push = need * EDGE_EDGE_PUSH * 0.5;
      e1a.x -= ux * push;
      e1a.y -= uy * push;
      e1b.x -= ux * push;
      e1b.y -= uy * push;
      e2a.x += ux * push;
      e2a.y += uy * push;
      e2b.x += ux * push;
      e2b.y += uy * push;
    }
  }

  if (allowFlip) {
    // 收集本帧所有交叉，按"越靠中间越严重"排序，只解最前面的几个
    const crossingPairs: { a: SimNode; b: SimNode; c: SimNode; d: SimNode; depth: number }[] = [];
    for (let i = 0; i < links.length; i += 1) {
      for (let j = i + 1; j < links.length; j += 1) {
        const e1a = byId.get(links[i].source_tag_id);
        const e1b = byId.get(links[i].target_tag_id);
        const e2a = byId.get(links[j].source_tag_id);
        const e2b = byId.get(links[j].target_tag_id);
        if (!e1a || !e1b || !e2a || !e2b) continue;
        if ([e1a.id, e1b.id].some((id) => id === e2a.id || id === e2b.id)) continue;
        const depth = crossingDepth(e1a, e1b, e2a, e2b);
        if (depth <= 0) continue;
        crossingPairs.push({ a: e1a, b: e1b, c: e2a, d: e2b, depth });
      }
    }
    crossingPairs.sort((x, y) => y.depth - x.depth);
    let resolved = 0;
    for (const pair of crossingPairs) {
      if (resolved >= FLIP_PER_FRAME) break;
      // 选半径小的端点当被翻方，且该端点不在冷却期
      const mover =
        pair.a.r <= pair.b.r ? (pair.a.r <= pair.c.r ? pair.a : pair.c) : pair.b.r <= pair.c.r ? pair.b : pair.c;
      const other = mover === pair.a || mover === pair.b ? [pair.c, pair.d] : [pair.a, pair.b];
      if (state) {
        const last = state.flipped.get(mover.id) ?? -9999;
        if (state.frame - last < FLIP_COOLDOWN) continue;
      }
      const dx = other[1].x - other[0].x;
      const dy = other[1].y - other[0].y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const side = (mover.x - other[0].x) * nx + (mover.y - other[0].y) * ny;
      if (Math.abs(side) < 0.5) continue;
      const shift = -2 * side + Math.sign(side) * -14;
      mover.x += nx * shift;
      mover.y += ny * shift;
      state?.flipped.set(mover.id, state.frame);
      resolved += 1;
    }
  }

  for (const group of meta.groups.values()) {
    if (group.length < 2) continue;
    let mx = 0;
    let my = 0;
    let total = 0;
    for (const id of group) {
      const node = byId.get(id);
      if (!node) continue;
      mx += node.x;
      my += node.y;
      total += 1;
    }
    if (total === 0) continue;
    mx /= total;
    my /= total;
    for (const id of group) {
      const node = byId.get(id);
      if (!node) continue;
      node.x += (mx - node.x) * CLUSTER_PULL;
      node.y += (my - node.y) * CLUSTER_PULL;
    }
  }

  for (const node of nodes) {
    const gravity = GRAVITY * (0.35 + node.r / R_MAX);
    node.x += (CX - node.x) * gravity;
    node.y += (CY - node.y) * gravity * ASPECT_Y;
    node.x = Math.min(VIEW_W - node.r - 3, Math.max(node.r + 3, node.x));
    node.y = Math.min(VIEW_H - node.r - 3, Math.max(node.r + 3, node.y));
  }

  // 全局降温：保证任何拓扑下都能收敛，而不是无限互相推挤
  if (damp < 1) {
    nodes.forEach((node, index) => {
      node.x = startX[index] + (node.x - startX[index]) * damp;
      node.y = startY[index] + (node.y - startY[index]) * damp;
    });
  }

  // 硬性分离：任何两个圆都不得小于最小间隙（放在最后，越过边界夹取与交叉翻转的副作用）
  for (let pass = 0; pass < 3; pass += 1) {
    let moved = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          dx = 0.3 + (i % 4) * 0.2;
          dy = 0.3;
          distance = Math.hypot(dx, dy);
        }
        const need = requiredGap(a.id, b.id, a.r, b.r, meta);
        if (distance >= need) continue;
        const push = (need - distance) / distance / 2;
        const sx = dx * push;
        const sy = dy * push;
        a.x -= sx;
        a.y -= sy;
        b.x += sx;
        b.y += sy;
        moved += need - distance;
      }
    }
    if (moved < 0.05) break;
  }

  // 硬分离可能把圆推出画布，最后再夹一次，保证不出界
  clampToView(nodes);
}

/** 当前所有交叉的条数（共用端点不算） */
export function countCrossings(nodes: SimNode[], links: TagLink[]): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let count = 0;
  for (let i = 0; i < links.length; i += 1) {
    for (let j = i + 1; j < links.length; j += 1) {
      const a = byId.get(links[i].source_tag_id);
      const b = byId.get(links[i].target_tag_id);
      const c = byId.get(links[j].source_tag_id);
      const d = byId.get(links[j].target_tag_id);
      if (!a || !b || !c || !d) continue;
      if ([a.id, b.id].some((id) => id === c.id || id === d.id)) continue;
      if (segmentsCross(a, b, c, d)) count += 1;
    }
  }
  return count;
}


/** 整簇平移/旋转：交叉只靠单点挪不开时，把较小的那个族群整体挪一下 */
function tryClusterMoves(nodes: SimNode[], links: TagLink[], meta: Clusters, best: number): number {
  let remaining = best;
  let attempts = 0;
  const snapshot = () => nodes.map((node) => ({ x: node.x, y: node.y }));
  const restore = (snap: { x: number; y: number }[]) => {
    nodes.forEach((node, index) => {
      node.x = snap[index].x;
      node.y = snap[index].y;
    });
  };

  for (let i = 0; i < links.length && attempts < 24; i += 1) {
    for (let j = i + 1; j < links.length && attempts < 24; j += 1) {
      const e1a = nodes.find((node) => node.id === links[i].source_tag_id);
      const e1b = nodes.find((node) => node.id === links[i].target_tag_id);
      const e2a = nodes.find((node) => node.id === links[j].source_tag_id);
      const e2b = nodes.find((node) => node.id === links[j].target_tag_id);
      if (!e1a || !e1b || !e2a || !e2b) continue;
      if ([e1a.id, e1b.id].some((id) => id === e2a.id || id === e2b.id)) continue;
      if (!segmentsCross(e1a, e1b, e2a, e2b)) continue;

      const rootA = meta.groupOf.get(e1a.id);
      const rootB = meta.groupOf.get(e2a.id);
      if (rootA === undefined || rootB === undefined || rootA === rootB) continue;

      const membersA = meta.groups.get(rootA) ?? [];
      const membersB = meta.groups.get(rootB) ?? [];
      const root = membersA.length <= membersB.length ? rootA : rootB;
      const members = root === rootA ? membersA : membersB;
      if (members.length === 0) continue;

      let cx = 0;
      let cy = 0;
      for (const id of members) {
        const node = nodes.find((item) => item.id === id);
        if (!node) continue;
        cx += node.x;
        cy += node.y;
      }
      cx /= members.length;
      cy /= members.length;

      const moves: { dx: number; dy: number; rotate: number }[] = [];
      for (const r of [70, 120]) {
        for (let k = 0; k < 8; k += 1) {
          const angle = (k / 8) * Math.PI * 2;
          moves.push({ dx: Math.cos(angle) * r, dy: Math.sin(angle) * r, rotate: 0 });
        }
      }
      for (const deg of [-40, -20, 20, 40]) moves.push({ dx: 0, dy: 0, rotate: (deg * Math.PI) / 180 });

      for (const move of moves) {
        attempts += 1;
        const snap = snapshot();
        const cos = Math.cos(move.rotate);
        const sin = Math.sin(move.rotate);
        for (const id of members) {
          const node = nodes.find((item) => item.id === id);
          if (!node) continue;
          const px = node.x - cx;
          const py = node.y - cy;
          node.x = cx + px * cos - py * sin + move.dx;
          node.y = cy + px * sin + py * cos + move.dy;
        }
        separateOnce(nodes, meta);
        separateOnce(nodes, meta);
        const score = countCrossings(nodes, links);
        if (score < remaining) {
          remaining = score;
          return remaining;
        }
        restore(snap);
        if (attempts >= 24) break;
      }
    }
  }
  return remaining;
}

/** 把所有圆夹回画布内（留 5px 让描边不被切掉） */
export function clampToView(nodes: SimNode[]) {
  for (const node of nodes) {
    node.x = Math.min(VIEW_W - node.r - 5, Math.max(node.r + 5, node.x));
    node.y = Math.min(VIEW_H - node.r - 5, Math.max(node.r + 5, node.y));
  }
}

/** 单轮全量硬分离（保证任意两圆不小于最小间隙） */
export function separateOnce(nodes: SimNode[], meta: Clusters): number {
  let moved = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.001) {
        dx = 0.3 + (i % 4) * 0.2;
        dy = 0.3;
        distance = Math.hypot(dx, dy);
      }
      const need = requiredGap(a.id, b.id, a.r, b.r, meta);
      if (distance >= need) continue;
      const push = (need - distance) / distance / 2;
      a.x -= dx * push;
      a.y -= dy * push;
      b.x += dx * push;
      b.y += dy * push;
      moved += need - distance;
    }
  }
  return moved;
}

/** 布局入场种子：族群中心按数量顺序铺开，成员围在各自中心周围 */
export function seedNodes(tags: Tag[], links: TagLink[], radii: Map<number, number>): SimNode[] {
  const clusters = clustersOf(tags, links);
  const comps = [...clusters.groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const maxRadius = Math.min(VIEW_W, VIEW_H) / 2 - 120;
  const centers = new Map<number, Pos>();
  comps.forEach(([root], index) => {
    const distance = comps.length <= 1 ? 0 : maxRadius * Math.sqrt(index / (comps.length - 1));
    const angle = index * golden;
    centers.set(root, { x: CX + distance * Math.cos(angle), y: CY + distance * Math.sin(angle) });
  });
  const out: SimNode[] = [];
  for (const tag of tags) {
    const root = clusters.groupOf.get(tag.id) ?? -1;
    const center = centers.get(root) ?? { x: CX, y: CY };
    const members = clusters.groups.get(root) ?? [tag.id];
    const index = members.indexOf(tag.id);
    const ring = Math.max(70, Math.sqrt(members.length) * 62);
    const angle = (index / Math.max(1, members.length)) * Math.PI * 2;
    out.push({
      id: tag.id,
      r: radii.get(tag.id) ?? R_MIN,
      x: center.x + Math.cos(angle) * ring * 0.45,
      y: center.y + Math.sin(angle) * ring * 0.45,
    });
  }
  return out;
}

/**
 * 兜底：布局冻结后若仍有交叉，对涉及的端点做局部搜索。
 * 候选：绕伙伴旋转 ±20/40/60 度、沿对方直线法向平移 40/70/110px、镜像越过对方直线、与伙伴交换位置。
 * 每次候选都先做两轮硬分离再统计交叉，只接受「交叉确实变少」的移动。
 */
export function untangle(nodes: SimNode[], links: TagLink[], meta: Clusters, rounds = 60): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const snapshot = () => nodes.map((node) => ({ x: node.x, y: node.y }));
  const restore = (snap: { x: number; y: number }[]) => {
    nodes.forEach((node, index) => {
      node.x = snap[index].x;
      node.y = snap[index].y;
    });
  };

  let best = countCrossings(nodes, links);
  if (best === 0) return 0;

  for (let round = 0; round < rounds && best > 0; round += 1) {
    let improved = false;

    outer: for (let i = 0; i < links.length; i += 1) {
      for (let j = i + 1; j < links.length; j += 1) {
        const e1a = byId.get(links[i].source_tag_id);
        const e1b = byId.get(links[i].target_tag_id);
        const e2a = byId.get(links[j].source_tag_id);
        const e2b = byId.get(links[j].target_tag_id);
        if (!e1a || !e1b || !e2a || !e2b) continue;
        if ([e1a.id, e1b.id].some((id) => id === e2a.id || id === e2b.id)) continue;
        if (!segmentsCross(e1a, e1b, e2a, e2b)) continue;

        const ends = [
          { node: e1a, partner: e1b, oa: e2a, ob: e2b },
          { node: e1b, partner: e1a, oa: e2a, ob: e2b },
          { node: e2a, partner: e2b, oa: e1a, ob: e1b },
          { node: e2b, partner: e2a, oa: e1a, ob: e1b },
        ];

        for (const item of ends) {
          const node = item.node;
          const candidates: Pos[] = [];

          const dx = node.x - item.partner.x;
          const dy = node.y - item.partner.y;
          const dist = Math.hypot(dx, dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          const len = Math.min(dist, 170);
          for (const deg of [-60, -40, -20, 20, 40, 60]) {
            const a = (deg * Math.PI) / 180;
            candidates.push({
              x: item.partner.x + (ux * Math.cos(a) - uy * Math.sin(a)) * len,
              y: item.partner.y + (ux * Math.sin(a) + uy * Math.cos(a)) * len,
            });
          }

          const ex = item.ob.x - item.oa.x;
          const ey = item.ob.y - item.oa.y;
          const elen = Math.hypot(ex, ey) || 1;
          const nx = -ey / elen;
          const ny = ex / elen;
          for (const k of [40, 70, 110]) {
            candidates.push({ x: node.x + nx * k, y: node.y + ny * k });
            candidates.push({ x: node.x - nx * k, y: node.y - ny * k });
          }

          // 镜像越过对方直线（一步跨过去）
          const side = (node.x - item.oa.x) * nx + (node.y - item.oa.y) * ny;
          candidates.push({ x: node.x - nx * side * 2, y: node.y - ny * side * 2 });

          // 与伙伴交换位置
          candidates.push({ x: item.partner.x, y: item.partner.y });

          for (const cand of candidates) {
            if (cand.x < node.r + 4 || cand.x > VIEW_W - node.r - 4) continue;
            if (cand.y < node.r + 4 || cand.y > VIEW_H - node.r - 4) continue;

            const snap = snapshot();
            node.x = cand.x;
            node.y = cand.y;
            separateOnce(nodes, meta);
            separateOnce(nodes, meta);
            const score = countCrossings(nodes, links);
            if (score < best) {
              best = score;
              improved = true;
              break outer;
            }
            restore(snap);
          }
        }
      }
    }

    if (!improved) {
      const nextBest = tryClusterMoves(nodes, links, meta, best);
      if (nextBest < best) {
        best = nextBest;
        improved = true;
      }
    }
    if (!improved) break;
  }
  clampToView(nodes);
  return best;
}

/** 把控制点关于弦做镜像，得到"往另一侧弯"的同一条边 */
export function mirrorCurve(curve: EdgeCurve): EdgeCurve {
  const mx = (curve.x1 + curve.x2) / 2;
  const my = (curve.y1 + curve.y2) / 2;
  return { ...curve, cx: mx * 2 - curve.cx, cy: my * 2 - curve.cy };
}

function curvesCross(a: EdgeCurve, b: EdgeCurve): boolean {
  const pa = sampleCurve(a, 6);
  const pb = sampleCurve(b, 6);
  for (let i = 0; i < pa.length - 1; i += 1) {
    for (let j = 0; j < pb.length - 1; j += 1) {
      if (segmentsCross(pa[i], pa[i + 1], pb[j], pb[j + 1])) return true;
    }
  }
  return false;
}

/**
 * 给所有边算绘制曲线：先按障碍物绕行，再贪心地选"弯曲方向"，
 * 让每条新边尽量不与已排好的边交叉（曲线也会互相交叉，这点必须单独处理）。
 */
export function routeEdges(
  edges: { key: string; a: number; b: number }[],
  positions: Record<number, Pos>,
  radiusOf: (id: number) => number,
  clearance = 12,
): Map<string, EdgeCurve> {
  const out = new Map<string, EdgeCurve>();
  const accepted: EdgeCurve[] = [];

  for (const edge of edges) {
    const from = positions[edge.a];
    const to = positions[edge.b];
    if (!from || !to) continue;
    const obstacles = Object.entries(positions)
      .filter(([id]) => Number(id) !== edge.a && Number(id) !== edge.b)
      .map(([id, pos]) => ({ id: Number(id), x: pos.x, y: pos.y, r: radiusOf(Number(id)) }));

    const base = edgeCurve(from, to, radiusOf(edge.a), radiusOf(edge.b), obstacles, [edge.a, edge.b], clearance);
    const mirrored = mirrorCurve(base);
    const baseCrosses = accepted.reduce((sum, other) => sum + (curvesCross(base, other) ? 1 : 0), 0);
    const mirroredCrosses = accepted.reduce((sum, other) => sum + (curvesCross(mirrored, other) ? 1 : 0), 0);
    const chosen = mirroredCrosses < baseCrosses ? mirrored : base;
    out.set(edge.key, chosen);
    accepted.push(chosen);
  }

  // 回头修复：还有交叉的曲线，逐个试镜像，能减少总交叉就换
  for (let pass = 0; pass < 2; pass += 1) {
    let improved = false;
    for (const item of edges) {
      const curve = out.get(item.key);
      if (!curve) continue;
      const others = [...out.entries()].filter(([key]) => key !== item.key).map(([, value]) => value);
      const before = others.reduce((sum, other) => sum + (curvesCross(curve, other) ? 1 : 0), 0);
      if (before === 0) continue;
      const flipped = mirrorCurve(curve);
      const after = others.reduce((sum, other) => sum + (curvesCross(flipped, other) ? 1 : 0), 0);
      if (after >= before) continue;
      // 镜像后不能压到圆：用采样检查非端点圆的间隙
      const flippedPoints = sampleCurve(flipped, 12);
      const hitsCircle = Object.entries(positions).some(([id, pos]) => {
        const tagId = Number(id);
        if (tagId === item.a || tagId === item.b) return false;
        const need = radiusOf(tagId) + clearance * 0.5;
        return flippedPoints.some((point) => Math.hypot(point.x - pos.x, point.y - pos.y) < need);
      });
      if (!hitsCircle) {
        out.set(item.key, flipped);
        improved = true;
      }
    }
    if (!improved) break;
  }
  return out;
}

/**
 * 计算每条线"与更早绘制的线"的交叉点。
 * 渲染时在这些点先画一个小色块，让后画的线从"缺口"上跨过去 ——
 * 电路图那种处理方式，几何上解不掉的交叉也不会看起来打结。
 */
export function crossingPointsFor(
  edges: { key: string; a: number; b: number }[],
  curves: Map<string, EdgeCurve>,
): Map<string, Pos[]> {
  const out = new Map<string, Pos[]>();
  const earlier: { key: string; points: Pos[] }[] = [];
  for (const edge of edges) {
    const curve = curves.get(edge.key);
    if (!curve) continue;
    const points: Pos[] = [];
    const mine = sampleCurve(curve, 10);
    for (const prev of earlier) {
      for (let i = 0; i < mine.length - 1; i += 1) {
        for (let j = 0; j < prev.points.length - 1; j += 1) {
          const a = mine[i];
          const b = mine[i + 1];
          const c = prev.points[j];
          const d = prev.points[j + 1];
          const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
          if (Math.abs(den) < 1e-9) continue;
          const ua = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
          const ub = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
          if (ua <= 0.05 || ua >= 0.95 || ub <= 0.05 || ub >= 0.95) continue;
          points.push({ x: a.x + ua * (b.x - a.x), y: a.y + ua * (b.y - a.y) });
        }
      }
    }
    if (points.length > 0) out.set(edge.key, points);
    earlier.push({ key: edge.key, points: mine });
  }
  return out;
}