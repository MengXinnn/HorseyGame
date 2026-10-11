/**
 * 大世界的地图：牧场、河、马蹄镇、赛马场、野原。
 * 所有坐标都是米；x 向东，z 向北。
 */
import { createRng } from "../sim/rng";

export const BOUNDS = { x0: -95, x1: 122, z0: 0, z1: 192 };

export type GroundKind = "path" | "plaza" | "water" | "track" | "infield" | "paddock" | "meadow" | "sand";

export interface GroundPatch {
  kind: GroundKind;
  pts: Array<[number, number]>;
}

export type BuildingStyle = "house" | "barn" | "shop" | "booth" | "stand";

export interface Building {
  id: string;
  /** 正面（朝南、朝镜头）中点。 */
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: BuildingStyle;
  sign?: string;
  wall: string;
  roof: string;
}

export type InteractId = "sleep" | "barn" | "board" | "sequence" | "market" | "bookie" | "sumo" | "race" | "laozhao";

export interface Interactable {
  id: InteractId;
  x: number;
  z: number;
  radius: number;
  label: string;
}

export interface Region {
  id: string;
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export type PropKind = "pine" | "willow" | "rock" | "bush" | "reed" | "lantern" | "post" | "flag";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  size: number;
  /** 0–1 的随机数，用来让同类物件长得不一样。 */
  v: number;
}

export interface FenceLine {
  pts: Array<[number, number]>;
  closed: boolean;
  color: string;
  height: number;
}

const rect = (x0: number, z0: number, x1: number, z1: number): Array<[number, number]> => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

function ellipse(cx: number, cz: number, rx: number, rz: number, n = 40): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cz + Math.sin(a) * rz] as [number, number];
  });
}

/** 一条有宽度的路：沿折线两侧各偏移 w/2。 */
function road(points: Array<[number, number]>, w: number): Array<[number, number]> {
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (w / 2);
    const nz = (dx / len) * (w / 2);
    const p = points[i]!;
    left.push([p[0] + nx, p[1] + nz]);
    right.push([p[0] - nx, p[1] - nz]);
  }
  return [...left, ...right.reverse()];
}

export const RIVER = { z0: 46, z1: 52 };
export const BRIDGE = { x0: -3.6, x1: 3.6 };
export const TRACK = { cx: -56, cz: 142, rx: 32, rz: 15, band: 5 };
export const RING = { x: 7, z: 84, r: 4.2 };
export const PADDOCK = { x0: -33, x1: -12, z0: 6, z1: 22 };
export const WILDS = { x0: 46, x1: 118, z0: 8, z1: 92 };
export const LAOZHAO_SPOT = { x: 31, z: 82 };
export const TIEDUN_SPOT = { x: 38.5, z: 83.5 };

export const GROUND: GroundPatch[] = [
  { kind: "meadow", pts: rect(WILDS.x0, WILDS.z0, WILDS.x1, WILDS.z1) },
  { kind: "paddock", pts: rect(PADDOCK.x0, PADDOCK.z0, PADDOCK.x1, PADDOCK.z1) },
  { kind: "path", pts: road([[0, 6], [0, 30], [0, 60], [0, 72]], 4.2) },
  { kind: "path", pts: road([[-6, 20], [-1, 18], [8, 20], [13, 22]], 3.4) },
  { kind: "path", pts: road([[0, 28], [16, 30], [32, 33], [48, 36]], 3.6) },
  { kind: "path", pts: road([[-14, 96], [-24, 106], [-30, 116], [-34, 124]], 3.8) },
  { kind: "path", pts: road([[20, 82], [30, 85], [37, 88]], 3) },
  { kind: "plaza", pts: rect(-25, 70, 25, 101) },
  { kind: "track", pts: ellipse(TRACK.cx, TRACK.cz, TRACK.rx, TRACK.rz) },
  { kind: "infield", pts: ellipse(TRACK.cx, TRACK.cz, TRACK.rx - TRACK.band, TRACK.rz - TRACK.band) },
  { kind: "water", pts: rect(BOUNDS.x0 - 20, RIVER.z0, BOUNDS.x1 + 20, RIVER.z1) },
  { kind: "water", pts: ellipse(-40, 66, 9, 5, 24) },
  { kind: "sand", pts: ellipse(RING.x, RING.z, RING.r + 1.6, RING.r + 1.6, 28) },
];

export const BUILDINGS: Building[] = [
  { id: "home", x: -6, z: 26, w: 11, d: 7, h: 3.3, style: "house", sign: "家", wall: "#e8dfcc", roof: "#3a3e4c" },
  { id: "barn", x: 13, z: 27, w: 10, d: 8, h: 4.2, style: "barn", sign: "马厩", wall: "#9b5a3a", roof: "#4a3a34" },
  { id: "seq", x: -15, z: 101, w: 10, d: 6, h: 4, style: "shop", sign: "测序", wall: "#e6ddc8", roof: "#2f4a52" },
  { id: "market", x: 15, z: 101, w: 11, d: 6, h: 4, style: "shop", sign: "马市", wall: "#e9dcc4", roof: "#5a2f2a" },
  { id: "bookie", x: -11, z: 76, w: 4.4, d: 3, h: 3, style: "booth", sign: "赌马", wall: "#7a3b2a", roof: "#a2342a" },
  { id: "zhao", x: 37, z: 94, w: 9, d: 6, h: 3.5, style: "house", sign: "赵", wall: "#ddd2bc", roof: "#3b3a33" },
  { id: "gate", x: -30, z: 121, w: 5, d: 3, h: 3.2, style: "booth", sign: "报名", wall: "#6b4a2e", roof: "#2f5d4a" },
  { id: "stand", x: -56, z: 163, w: 30, d: 7, h: 5, style: "stand", wall: "#c9b48c", roof: "#9a3027" },
];

export const INTERACTS: Interactable[] = [
  { id: "sleep", x: -6, z: 24.2, radius: 2.6, label: "睡觉" },
  { id: "barn", x: 13, z: 25.2, radius: 2.8, label: "配种" },
  { id: "board", x: 5, z: 16.5, radius: 2.2, label: "马码" },
  { id: "sequence", x: -15, z: 99.3, radius: 2.8, label: "测序" },
  { id: "market", x: 15, z: 99.3, radius: 2.8, label: "马市" },
  { id: "bookie", x: -11, z: 74.4, radius: 2.6, label: "下注" },
  { id: "sumo", x: RING.x, z: RING.z - RING.r - 1.4, radius: 2.8, label: "相扑" },
  { id: "race", x: -30, z: 119.4, radius: 2.8, label: "报名" },
  { id: "laozhao", x: LAOZHAO_SPOT.x, z: LAOZHAO_SPOT.z - 0.6, radius: 2.6, label: "老赵" },
];

export const REGIONS: Region[] = [
  { id: "ranch", name: "牧场", x0: -40, x1: 30, z0: 0, z1: 44 },
  { id: "town", name: "马蹄镇", x0: -28, x1: 45, z0: 64, z1: 108 },
  { id: "track", name: "赛马场", x0: -95, x1: -18, z0: 112, z1: 175 },
  { id: "wilds", name: "野原", x0: WILDS.x0, x1: WILDS.x1, z0: WILDS.z0, z1: WILDS.z1 },
];

export function regionAt(x: number, z: number): Region | null {
  return REGIONS.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) ?? null;
}

export const FENCES: FenceLine[] = [
  {
    pts: [
      [PADDOCK.x1, PADDOCK.z0 + 5],
      [PADDOCK.x1, PADDOCK.z0],
      [PADDOCK.x0, PADDOCK.z0],
      [PADDOCK.x0, PADDOCK.z1],
      [PADDOCK.x1, PADDOCK.z1],
      [PADDOCK.x1, PADDOCK.z1 - 6],
    ],
    closed: false,
    color: "#8a6a48",
    height: 1.1,
  },
  { pts: ellipse(TRACK.cx, TRACK.cz, TRACK.rx + 0.4, TRACK.rz + 0.4, 48), closed: true, color: "#efe9dc", height: 1 },
  { pts: ellipse(TRACK.cx, TRACK.cz, TRACK.rx - TRACK.band - 0.4, TRACK.rz - TRACK.band - 0.4, 40), closed: true, color: "#efe9dc", height: 0.9 },
  {
    pts: [
      [30, 89],
      [30, 79],
      [34.5, 79],
    ],
    closed: false,
    color: "#7a5a3c",
    height: 1.1,
  },
  {
    pts: [
      [38.5, 79],
      [44, 79],
      [44, 90],
    ],
    closed: false,
    color: "#7a5a3c",
    height: 1.1,
  },
];

function insideAny(x: number, z: number, pad: number): boolean {
  for (const b of BUILDINGS) {
    if (x > b.x - b.w / 2 - pad && x < b.x + b.w / 2 + pad && z > b.z - pad - 2 && z < b.z + b.d + pad) return true;
  }
  if (z > RIVER.z0 - 1.5 && z < RIVER.z1 + 1.5) return true;
  if (Math.abs(x) < 4 + pad && z < 72) return true;
  if (x > -26 - pad && x < 26 + pad && z > 69 - pad && z < 102 + pad) return true;
  const tx = (x - TRACK.cx) / (TRACK.rx + 3 + pad);
  const tz = (z - TRACK.cz) / (TRACK.rz + 3 + pad);
  if (tx * tx + tz * tz < 1) return true;
  if (x > PADDOCK.x0 - 1 && x < PADDOCK.x1 + 1 && z > PADDOCK.z0 - 1 && z < PADDOCK.z1 + 1) return true;
  if (x > -14 && x < 22 && z > 12 && z < 36) return true;
  return false;
}

/** 撒树、石头、灌木：种子固定，每次打开都一样。 */
function scatterProps(): Prop[] {
  const rng = createRng(20261011);
  const props: Prop[] = [];
  const tryAdd = (kind: PropKind, x: number, z: number, size: number, pad = 1.5): void => {
    if (insideAny(x, z, pad)) return;
    props.push({ kind, x, z, size, v: rng.next() });
  };
  // 地图边缘的树林，挡住世界尽头。
  for (let x = BOUNDS.x0 - 8; x <= BOUNDS.x1 + 8; x += 3.2) {
    for (let k = 0; k < 3; k++) tryAdd("pine", x + rng.next() * 2, BOUNDS.z1 + 2 + k * 4 + rng.next() * 2, 1 + rng.next() * 0.6, 0);
  }
  for (let z = BOUNDS.z0; z <= BOUNDS.z1; z += 3) {
    for (let k = 0; k < 2; k++) {
      tryAdd("pine", BOUNDS.x0 - 2 - k * 4 - rng.next() * 2, z + rng.next() * 2, 1 + rng.next() * 0.6, 0);
      tryAdd("pine", BOUNDS.x1 + 2 + k * 4 + rng.next() * 2, z + rng.next() * 2, 1 + rng.next() * 0.6, 0);
    }
  }
  // 中间零散的树丛。
  for (let i = 0; i < 260; i++) {
    const x = BOUNDS.x0 + rng.next() * (BOUNDS.x1 - BOUNDS.x0);
    const z = BOUNDS.z0 + 4 + rng.next() * (BOUNDS.z1 - BOUNDS.z0 - 4);
    const inWilds = x > WILDS.x0 && x < WILDS.x1 && z > WILDS.z0 && z < WILDS.z1;
    if (inWilds && rng.next() < 0.75) continue; // 野原空旷，方便套马
    const r = rng.next();
    tryAdd(r < 0.55 ? "pine" : r < 0.75 ? "bush" : r < 0.9 ? "rock" : "willow", x, z, 0.8 + rng.next() * 0.7);
  }
  // 河边的柳树和芦苇。
  for (let x = BOUNDS.x0; x < BOUNDS.x1; x += 6 + rng.next() * 8) {
    if (Math.abs(x) < 8) continue;
    if (rng.next() < 0.5) props.push({ kind: "willow", x, z: RIVER.z1 + 2.2 + rng.next() * 2, size: 1 + rng.next() * 0.4, v: rng.next() });
    props.push({ kind: "reed", x: x + 2, z: RIVER.z0 - 0.8, size: 1, v: rng.next() });
  }
  // 野原上的石头和灌木。
  for (let i = 0; i < 26; i++) {
    tryAdd(rng.next() < 0.5 ? "rock" : "bush", WILDS.x0 + 3 + rng.next() * (WILDS.x1 - WILDS.x0 - 6), WILDS.z0 + 3 + rng.next() * (WILDS.z1 - WILDS.z0 - 6), 0.6 + rng.next() * 0.8, 0.5);
  }
  // 镇上和牧场的灯笼，夜里会亮。
  const lanterns: Array<[number, number]> = [
    [-3.5, 22],
    [3, 22],
    [-24, 71],
    [24, 71],
    [-24, 99],
    [24, 99],
    [-3, 70],
    [3, 70],
    [-26, 119],
    [-34, 119],
    [33, 80],
  ];
  for (const [x, z] of lanterns) props.push({ kind: "lantern", x, z, size: 1, v: rng.next() });
  // 赛马场的旗子。
  for (let i = 0; i < 6; i++) props.push({ kind: "flag", x: TRACK.cx - 13 + i * 5.2, z: 166.5, size: 1, v: rng.next() });
  props.push({ kind: "post", x: 5, z: 17, size: 1, v: 0 });
  return props;
}

export const PROPS: Prop[] = scatterProps();

/** 能不能走到这个位置：不能出界、不能下河（桥上可以）、不能穿墙。 */
export function walkable(x: number, z: number): boolean {
  if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return false;
  if (z > RIVER.z0 + 0.3 && z < RIVER.z1 - 0.3 && (x < BRIDGE.x0 || x > BRIDGE.x1)) return false;
  for (const b of BUILDINGS) {
    if (x > b.x - b.w / 2 - 0.3 && x < b.x + b.w / 2 + 0.3 && z > b.z - 0.3 && z < b.z + b.d) return false;
  }
  const dx = (x + 40) / 9;
  const dz = (z - 66) / 5;
  if (dx * dx + dz * dz < 1) return false;
  return true;
}

/** 围栏挡路：判断从 a 走到 b 有没有穿过某段围栏。 */
export function crossesFence(ax: number, az: number, bx: number, bz: number): boolean {
  for (const f of FENCES) {
    const n = f.pts.length;
    const segs = f.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p = f.pts[i]!;
      const q = f.pts[(i + 1) % n]!;
      if (segmentsCross(ax, az, bx, bz, p[0], p[1], q[0], q[1])) return true;
    }
  }
  return false;
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
