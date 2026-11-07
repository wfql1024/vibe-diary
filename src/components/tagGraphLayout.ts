import type { Tag, TagLink } from "../db";

/** 画布尺寸（SVG viewBox） */
export const VIEW_W = 1200;
export const VIEW_H = 760;
export const CX = VIEW_W / 2;
export const CY = VIEW_H / 2;

export const R_MIN = 24;
export const R_MAX = 52;

// 圆-圆（按关系远近分档：越远推得越开）
export const GAP = 12;
/** 直接相连的两圆：保证连线至少有这么长，否则箭头会把线整个吃掉 */
export const LINKED_GAP = 34;
export const NEAR2_GAP = 28;
export const NEAR3_GAP = 46;
export const CLUSTER_GAP = 56;
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

export function radiusOf(count: number, maxCount: number) {
  if (maxCount <= 1) return R_MIN;
  const ratio = Math.min(1, Math.max(0, count / maxCount));
  return R_MIN + (R_MAX - R_MIN) * Math.sqrt(ratio);
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
      if (penetration > worst) {
        worst = penetration;
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
export function relax(nodes: SimNode[], links: TagLink[], meta: Clusters, damp = 1, allowFlip = true) {
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
    const ideal = a.r + b.r + IDEAL_GAP;
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
      if (closest.distance >= EDGE_EDGE_MIN || closest.distance < 0.01) continue;
      const need = EDGE_EDGE_MIN - closest.distance;
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

  for (let i = 0; i < links.length; i += 1) {
    for (let j = i + 1; j < links.length; j += 1) {
      const e1a = byId.get(links[i].source_tag_id);
      const e1b = byId.get(links[i].target_tag_id);
      const e2a = byId.get(links[j].source_tag_id);
      const e2b = byId.get(links[j].target_tag_id);
      if (!e1a || !e1b || !e2a || !e2b) continue;
      if ([e1a.id, e1b.id].some((id) => id === e2a.id || id === e2b.id)) continue;
      if (!allowFlip) continue;
      if (!segmentsCross(e1a, e1b, e2a, e2b)) continue;

      const mover = e1a.r <= e1b.r ? e1a : e1b;
      const dx = e2b.x - e2a.x;
      const dy = e2b.y - e2a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const side = (mover.x - e2a.x) * nx + (mover.y - e2a.y) * ny;
      if (Math.abs(side) < 0.5) continue;
      const shift = -2 * side + Math.sign(side) * -14;
      mover.x += nx * shift;
      mover.y += ny * shift;
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
    node.x = Math.min(VIEW_W - node.r - 6, Math.max(node.r + 6, node.x));
    node.y = Math.min(VIEW_H - node.r - 6, Math.max(node.r + 6, node.y));
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
}