/**
 * 大世界地图：俯视的瓦片地图（星露谷那种 2D 俯视）。
 * 坐标单位是格子，x 向右、z 向下（z 就是地图上的行）。一格 16 像素。
 *
 * 一条河把地图分成南北两半：北边是赛马场、马蹄镇、赵家擂台和镇外的研究所，
 * 南边是牧场和野原。几片地方之间隔着林子和草地，用大路和桥连起来。
 */
import { createRng, hashSeed } from "../sim/rng";

export const TILE = 16;
export const MAP_W = 144;
export const MAP_H = 112;
/** 一格合多少米：大世界里的马按这个比例画，物理步态也按这个换算速度。 */
export const METERS_PER_TILE = 1.25;

export const T = {
  grass: 0,
  path: 1,
  water: 2,
  bridge: 3,
  sand: 4,
  track: 5,
  plaza: 6,
  meadow: 7,
  paddock: 8,
  infield: 9,
  soil: 10,
  court: 11,
  clay: 12,
} as const;
export type TileKind = (typeof T)[keyof typeof T];

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** 河道中线（行），沿 x 弯来弯去。 */
export function riverCenter(x: number): number {
  return 50 + 2.6 * Math.sin(x * 0.055 + 0.4) + 1.4 * Math.sin(x * 0.13 + 2.1);
}
const RIVER_HALF = 1.9;

export const PADDOCK: Rect = { x0: 16, z0: 78, x1: 44, z1: 96 };
export const PADDOCK_GATE = { x0: 28, x1: 31 };
export const WILDS: Rect = { x0: 62, z0: 64, x1: 138, z1: 106 };
export const POND = { x: 112, z: 88, r: 5.5 };
export const PLAZA: Rect = { x0: 62, z0: 16, x1: 88, z1: 34 };
/** 广场中间的喷泉，r 是挡路的半径。 */
export const FOUNTAIN = { x: 75, z: 25, r: 2.6 };
/** 赵家擂台：土台子上一圈沙。 */
export const RING = { x: 112, z: 38, r: 3.2 };
export const DOHYO: Rect = { x0: 107, z0: 33, x1: 117, z1: 43 };
export const TRACK = { cx: 22, cz: 25, rx: 15, rz: 11, band: 2.8 };
export const YARD: Rect = { x0: 128, z0: 31, x1: 140, z1: 43 };
export const YARD_GATE = { x0: 130, x1: 133 };
/** 研究所的院子，四周一圈栅栏，门朝南。 */
export const LAB_YARD: Rect = { x0: 110, z0: 4, x1: 139, z1: 21 };
export const LAB_GATE = { x0: 120, x1: 123 };
export const LAOZHAO_SPOT = { x: 118.5, z: 35.2 };
export const TIEDUN_SPOT = { x: 134, z: 38 };
/** 牧场门口的鸡到处溜达的范围。 */
export const CHICKEN_PEN: Rect = { x0: 3.5, z0: 69.4, x1: 12.5, z1: 72.6 };

export type BuildingKind =
  | "home"
  | "barn"
  | "silo"
  | "coop"
  | "mill"
  | "bookie"
  | "lab"
  | "greenhouse"
  | "market"
  | "teahouse"
  | "store"
  | "smithy"
  | "house"
  | "shrine"
  | "zhao"
  | "booth"
  | "stand";

export interface Building {
  id: string;
  kind: BuildingKind;
  /** 占地（挡路的部分），单位格。 */
  x: number;
  z: number;
  w: number;
  d: number;
  sign?: string;
}

export const BUILDINGS: Building[] = [
  // 牧场
  { id: "home", kind: "home", x: 14, z: 64, w: 7, d: 4, sign: "家" },
  { id: "barn", kind: "barn", x: 26, z: 63, w: 8, d: 5, sign: "马厩" },
  { id: "silo", kind: "silo", x: 35, z: 64, w: 3, d: 4 },
  { id: "coop", kind: "coop", x: 5, z: 65, w: 6, d: 3 },
  { id: "mill", kind: "mill", x: 48, z: 73, w: 4, d: 3 },
  // 赛马场
  { id: "stand", kind: "stand", x: 8, z: 6, w: 28, d: 5 },
  { id: "bookie", kind: "bookie", x: 38, z: 6, w: 6, d: 4, sign: "赌马" },
  { id: "booth", kind: "booth", x: 38, z: 18, w: 4, d: 3, sign: "报名" },
  // 马蹄镇
  { id: "market", kind: "market", x: 63, z: 8, w: 8, d: 5, sign: "马市" },
  { id: "teahouse", kind: "teahouse", x: 74, z: 7, w: 9, d: 6, sign: "茶馆" },
  { id: "store", kind: "store", x: 86, z: 9, w: 7, d: 4, sign: "杂货" },
  { id: "smithy", kind: "smithy", x: 52, z: 15, w: 7, d: 4, sign: "铁匠" },
  { id: "house1", kind: "house", x: 52, z: 29, w: 6, d: 4 },
  { id: "house2", kind: "house", x: 62, z: 37, w: 6, d: 4 },
  { id: "house3", kind: "house", x: 81, z: 37, w: 7, d: 4 },
  { id: "house4", kind: "house", x: 93, z: 17, w: 6, d: 4 },
  { id: "shrine", kind: "shrine", x: 93, z: 31, w: 4, d: 3 },
  // 赵家
  { id: "zhao", kind: "zhao", x: 120, z: 29, w: 7, d: 4, sign: "赵" },
  // 研究所
  { id: "seq", kind: "lab", x: 115, z: 7, w: 10, d: 5, sign: "测序" },
  { id: "greenhouse", kind: "greenhouse", x: 128, z: 8, w: 7, d: 4 },
];

export type InteractId = "sleep" | "barn" | "board" | "sequence" | "market" | "bookie" | "sumo" | "race" | "laozhao";

export interface Interactable {
  id: InteractId;
  x: number;
  z: number;
  radius: number;
  label: string;
}

const door = (id: string): { x: number; z: number } => {
  const b = BUILDINGS.find((x) => x.id === id) as Building;
  return { x: b.x + b.w / 2, z: b.z + b.d + 0.6 };
};

export const BOARD = { x: 23, z: 69 };

export const INTERACTS: Interactable[] = [
  { id: "sleep", ...door("home"), radius: 1.6, label: "睡觉" },
  { id: "barn", ...door("barn"), radius: 1.8, label: "配种" },
  { id: "board", x: BOARD.x, z: BOARD.z + 0.8, radius: 1.3, label: "马码" },
  { id: "sequence", ...door("seq"), radius: 1.8, label: "测序" },
  { id: "market", ...door("market"), radius: 1.8, label: "马市" },
  { id: "bookie", ...door("bookie"), radius: 1.8, label: "下注" },
  { id: "sumo", x: RING.x, z: RING.z + RING.r + 0.8, radius: 1.8, label: "相扑" },
  { id: "race", ...door("booth"), radius: 1.6, label: "报名" },
  { id: "laozhao", x: LAOZHAO_SPOT.x, z: LAOZHAO_SPOT.z + 1, radius: 1.5, label: "老赵" },
];

export interface Region {
  id: string;
  name: string;
  rect: Rect;
}

export const REGIONS: Region[] = [
  { id: "track", name: "赛马场", rect: { x0: 2, z0: 2, x1: 48, z1: 44 } },
  { id: "town", name: "马蹄镇", rect: { x0: 48, z0: 2, x1: 104, z1: 44 } },
  { id: "lab", name: "研究所", rect: { x0: 104, z0: 2, x1: 142, z1: 23 } },
  { id: "arena", name: "赵家擂台", rect: { x0: 104, z0: 23, x1: 142, z1: 46 } },
  { id: "ranch", name: "牧场", rect: { x0: 2, z0: 58, x1: 58, z1: 110 } },
  { id: "wilds", name: "野原", rect: { x0: 58, z0: 58, x1: 142, z1: 110 } },
];

export function regionAt(x: number, z: number): Region | undefined {
  return REGIONS.find((r) => x >= r.rect.x0 && x < r.rect.x1 && z >= r.rect.z0 && z < r.rect.z1);
}

/* ---------------- 地面 ---------------- */

const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1;

function trackT(x: number, z: number): number {
  const dx = (x - TRACK.cx) / TRACK.rx;
  const dz = (z - TRACK.cz) / TRACK.rz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** 点在赛道带上：外圈 1，内圈约 0.75。 */
export const onTrack = (x: number, z: number): boolean => {
  const t = trackT(x, z);
  return t <= 1 && t >= 1 - TRACK.band / TRACK.rz;
};

/** 大路：一段段长方形（格），桥是路过河的那几格。 */
const ROADS: Rect[] = [
  // 赛马场：看台前的走道、牧场大路（一路往南过桥到牧场）、往镇上的西大街。
  { x0: 5, z0: 11, x1: 46, z1: 14 },
  { x0: 42, z0: 11, x1: 45, z1: 72 },
  { x0: 37, z0: 24, x1: 62, z1: 27 },
  // 镇上：北街、广场南口到河边的码头、东大街、去野原的路。
  { x0: 60, z0: 13, x1: 96, z1: 16 },
  { x0: 74, z0: 34, x1: 77, z1: 47 },
  { x0: 88, z0: 24, x1: 125, z1: 27 },
  { x0: 100, z0: 27, x1: 103, z1: 67 },
  // 南大街：牧场到野原。
  { x0: 45, z0: 60, x1: 100, z1: 62 },
  // 牧场：门前的院子路、往马场门口的小路。
  { x0: 4, z0: 69, x1: 42, z1: 71 },
  { x0: 28, z0: 71, x1: 31, z1: 78 },
  // 研究所和赵家。
  { x0: 120, z0: 21, x1: 123, z1: 24 },
  { x0: 120, z0: 12, x1: 123, z1: 21 },
  { x0: 117, z0: 27, x1: 120, z1: 33 },
  { x0: 125, z0: 27, x1: 133, z1: 31 },
];

/** 码头：伸进河里的木板，从广场南口一直铺到水上。 */
const PIER: Rect = { x0: 74, z0: 43, x1: 77, z1: 47 };

function buildGround(): Uint8Array {
  const g = new Uint8Array(MAP_W * MAP_H);
  const set = (x: number, z: number, k: TileKind): void => {
    if (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H) g[z * MAP_W + x] = k;
  };
  const get = (x: number, z: number): number => (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H ? (g[z * MAP_W + x] as number) : T.grass);
  const fill = (r: Rect, k: TileKind): void => {
    for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) set(x, z, k);
  };
  fill(WILDS, T.meadow);
  fill(PADDOCK, T.paddock);
  fill(PLAZA, T.plaza);
  // 研究所门口一片水泥地。
  fill({ x0: 114, z0: 12, x1: 127, z1: 15 }, T.court);
  // 赛马场：椭圆跑道，中间草地。
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      const t = trackT(x + 0.5, z + 0.5);
      if (t <= 1 && t >= 1 - TRACK.band / TRACK.rz) set(x, z, T.track);
      else if (t < 1) set(x, z, T.infield);
    }
  for (const r of ROADS) fill(r, T.path);
  // 每栋房子门口一小段路，接到最近的路或广场上。
  for (const b of BUILDINGS) {
    if (b.kind === "stand" || b.kind === "silo" || b.kind === "mill" || b.kind === "greenhouse") continue;
    const dx = Math.floor(b.x + b.w / 2) - 1;
    for (let z = b.z + b.d; z < b.z + b.d + 6; z++) {
      const k = get(dx, z);
      if (z > b.z + b.d && (k === T.path || k === T.plaza || k === T.court)) break;
      set(dx, z, k === T.plaza || k === T.court ? (k as TileKind) : T.path);
      set(dx + 1, z, k === T.plaza || k === T.court ? (k as TileKind) : T.path);
    }
  }
  // 菜地。
  fill({ x0: 5, z0: 73, x1: 14, z1: 80 }, T.soil);
  // 擂台：一块夯土台子（中间那圈沙和草绳在地面图里逐像素画）。
  fill(DOHYO, T.clay);
  // 河，路过河的地方是桥；码头伸进水里。
  for (let x = 0; x < MAP_W; x++) {
    const c = riverCenter(x + 0.5);
    for (let z = 0; z < MAP_H; z++) {
      if (Math.abs(z + 0.5 - c) >= RIVER_HALF) continue;
      set(x, z, get(x, z) === T.path ? T.bridge : T.water);
    }
  }
  for (let z = PIER.z0; z < PIER.z1; z++) for (let x = PIER.x0; x < PIER.x1; x++) if (get(x, z) === T.water || get(x, z) === T.bridge) set(x, z, T.bridge);
  // 野原的水塘。
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (Math.hypot(x + 0.5 - POND.x, (z + 0.5 - POND.z) * 1.2) < POND.r) set(x, z, T.water);
  return g;
}

export const GROUND = buildGround();

export function tileAt(x: number, z: number): TileKind {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  if (ix < 0 || iz < 0 || ix >= MAP_W || iz >= MAP_H) return T.water;
  return GROUND[iz * MAP_W + ix] as TileKind;
}

/* ---------------- 围栏 ---------------- */

/** 围栏：一格一段，沿格子边放。horizontal 表示横着的一段。 */
export interface Fence {
  x: number;
  z: number;
  horizontal: boolean;
  /** 白漆的铁栅栏（研究所），其余是木栅栏。 */
  metal?: boolean;
}

function rectFence(r: Rect, gate: { x0: number; x1: number } | null, gateSide: "top" | "bottom", metal = false): Fence[] {
  const out: Fence[] = [];
  for (let x = r.x0; x < r.x1; x++) {
    const inGate = gate && x >= gate.x0 && x < gate.x1;
    if (!(inGate && gateSide === "top")) out.push({ x, z: r.z0, horizontal: true, metal });
    if (!(inGate && gateSide === "bottom")) out.push({ x, z: r.z1, horizontal: true, metal });
  }
  for (let z = r.z0; z < r.z1; z++) {
    out.push({ x: r.x0, z, horizontal: false, metal });
    out.push({ x: r.x1, z, horizontal: false, metal });
  }
  return out;
}

export const FENCES: Fence[] = [
  ...rectFence(PADDOCK, PADDOCK_GATE, "top"),
  ...rectFence(YARD, YARD_GATE, "top"),
  ...rectFence(LAB_YARD, LAB_GATE, "bottom", true),
];

const fenceKey = (x: number, z: number, h: boolean): string => `${x},${z},${h ? "h" : "v"}`;
const FENCE_SET = new Set(FENCES.map((f) => fenceKey(f.x, f.z, f.horizontal)));

/** 从 (ax,az) 走到 (bx,bz) 有没有跨过围栏。 */
export function crossesFence(ax: number, az: number, bx: number, bz: number): boolean {
  const zx0 = Math.floor(az);
  const zx1 = Math.floor(bz);
  if (zx0 !== zx1) {
    const line = Math.max(zx0, zx1);
    if (FENCE_SET.has(fenceKey(Math.floor(bx), line, true)) || FENCE_SET.has(fenceKey(Math.floor(ax), line, true))) return true;
  }
  const xx0 = Math.floor(ax);
  const xx1 = Math.floor(bx);
  if (xx0 !== xx1) {
    const line = Math.max(xx0, xx1);
    if (FENCE_SET.has(fenceKey(line, Math.floor(bz), false)) || FENCE_SET.has(fenceKey(line, Math.floor(az), false))) return true;
  }
  return false;
}

/* ---------------- 道具 ---------------- */

export type PropKind =
  | "pine"
  | "oak"
  | "willow"
  | "bamboo"
  | "bush"
  | "rock"
  | "lantern"
  | "lamppost"
  | "stump"
  | "reeds"
  | "sunflower"
  | "flag"
  | "board"
  | "planter"
  | "barrel"
  | "crate"
  | "well"
  | "stall"
  | "crops"
  | "hay"
  | "trough"
  | "mailbox"
  | "woodpile"
  | "signpost"
  | "lily"
  | "mushroom"
  | "log"
  | "grass"
  | "flowers"
  | "cart"
  | "statue"
  | "bench"
  | "fountain"
  | "dish"
  | "tent"
  | "campfire"
  | "post"
  | "scarecrow"
  | "anvil"
  | "hitch"
  | "beehive"
  | "boat";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** 变体编号，画的时候挑颜色和形状。 */
  v: number;
}

function buildingAt(x: number, z: number, pad = 0): boolean {
  return BUILDINGS.some((b) => x >= b.x - pad && x < b.x + b.w + pad && z >= b.z - pad - (b.kind === "stand" ? 0 : 3) && z < b.z + b.d + pad + 1);
}

const grow = (r: Rect, n: number): Rect => ({ x0: r.x0 - n, z0: r.z0 - n, x1: r.x1 + n + 1, z1: r.z1 + n + 1 });

function clearAt(x: number, z: number): boolean {
  const k = tileAt(x, z);
  if (k !== T.grass && k !== T.meadow) return false;
  if (buildingAt(x, z, 1)) return false;
  for (const r of [PADDOCK, YARD, LAB_YARD, DOHYO, PLAZA]) if (inRect(grow(r, 1), x, z)) return false;
  if (trackT(x, z) < 1.12) return false;
  return true;
}

/** 河岸：这一格不是水，上下左右有水。 */
function bank(x: number, z: number): boolean {
  if (tileAt(x, z) === T.water) return false;
  return tileAt(x, z - 1) === T.water || tileAt(x, z + 1) === T.water || tileAt(x - 1, z) === T.water || tileAt(x + 1, z) === T.water;
}

function buildProps(): Prop[] {
  const rng = createRng(hashSeed("天马牧场"));
  const props: Prop[] = [];
  const taken = new Set<string>();
  const put = (kind: PropKind, x: number, z: number, v = rng.int(0, 3)): void => {
    const key = `${Math.floor(x)},${Math.floor(z)}`;
    if (taken.has(key)) return;
    taken.add(key);
    props.push({ kind, x, z, v });
  };
  const tree = (x: number, z: number, pineShare = 0.5): void => {
    if (!clearAt(x, z)) return;
    put(rng.next() < pineShare ? "pine" : "oak", x + 0.5, z + 0.9);
  };

  // 地图四周一圈密林。
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      const edge = Math.min(x, z, MAP_W - 1 - x, MAP_H - 1 - z);
      if (edge > 2) continue;
      if (tileAt(x, z) === T.water) continue;
      if ((x + z * 3) % 2 === 0 || edge === 0) put(rng.next() < 0.7 ? "pine" : "oak", x + 0.5, z + 0.9);
    }
  // 几道林带把地方隔开：镇子和研究所之间、赛马场和镇子之间、牧场和野原之间。
  for (let z = 3; z < 22; z++) for (let x = 104; x < 109; x++) if ((x + z) % 2 === 0 && rng.next() < 0.8) tree(x, z, 0.8);
  for (let z = 30; z < 42; z++) for (let x = 46; x < 50; x++) if ((x + z) % 2 === 0 && rng.next() < 0.6) tree(x, z, 0.4);
  for (let z = 64; z < 106; z++) for (let x = 55; x < 60; x++) if ((x * 3 + z) % 3 === 0 && rng.next() < 0.75) tree(x, z, 0.5);
  // 研究所院墙外一圈松树，从镇上看不见里面。
  for (let x = LAB_YARD.x0 - 2; x <= LAB_YARD.x1 + 2; x += 2) {
    tree(x, LAB_YARD.z0 - 2, 0.9);
  }
  for (let z = LAB_YARD.z0; z <= LAB_YARD.z1; z += 2) {
    tree(LAB_YARD.x0 - 2, z, 0.9);
    tree(LAB_YARD.x1 + 2, z, 0.9);
  }
  // 野原里一丛一丛的树林和石头堆。
  for (const [cx, cz, n] of [
    [72, 76, 9],
    [128, 70, 8],
    [86, 98, 10],
    [130, 100, 7],
    [96, 84, 5],
  ] as const) {
    for (let i = 0; i < n * 3; i++) {
      const x = Math.round(cx + (rng.next() - 0.5) * n * 1.4);
      const z = Math.round(cz + (rng.next() - 0.5) * n);
      if (rng.next() < 0.7) tree(x, z, 0.35);
      else if (clearAt(x, z)) put("rock", x + 0.5, z + 0.7);
    }
  }
  // 零散的树、灌木、石头。
  for (let i = 0; i < 1100; i++) {
    const x = rng.int(3, MAP_W - 4);
    const z = rng.int(3, MAP_H - 4);
    if (!clearAt(x, z) || !clearAt(x + 1, z) || !clearAt(x, z + 1)) continue;
    const wild = inRect(WILDS, x, z);
    const r = rng.next();
    if (wild && r < 0.08) put("oak", x + 0.5, z + 0.9);
    else if (r < 0.14) put(rng.next() < 0.5 ? "pine" : "oak", x + 0.5, z + 0.9);
    else if (r < 0.28) put("bush", x + 0.5, z + 0.8);
    else if (r < 0.36) put("rock", x + 0.5, z + 0.7);
    else if (r < 0.39) put("stump", x + 0.5, z + 0.7);
  }
  // 河边：垂柳和芦苇。
  for (let x = 3; x < MAP_W - 3; x++)
    for (let z = 40; z < 60; z++) {
      if (!bank(x, z) || !clearAt(x, z)) continue;
      const north = tileAt(x, z + 1) === T.water;
      if (rng.next() < 0.07 && north) put("willow", x + 0.5, z + 0.9, rng.int(0, 1));
      else if (rng.next() < 0.4) put("reeds", x + 0.5, z + (north ? 0.9 : 0.6), rng.int(0, 2));
    }
  for (let z = 70; z < 106; z++)
    for (let x = 100; x < 124; x++) if (bank(x, z) && clearAt(x, z) && rng.next() < 0.45) put("reeds", x + 0.5, z + 0.8, rng.int(0, 2));

  /* ---- 赛马场 ---- */
  // 看台前一排彩旗，入口立着铜马。
  for (let i = 0; i < 9; i++) put("flag", 9.5 + i * 3.2, 11.2, i);
  put("statue", 40.5, 30.8, 0);
  put("lamppost", 37.6, 23.6, 0);
  put("lamppost", 46.4, 23.6, 0);
  put("lamppost", 41.4, 15.0, 0);
  for (const [x, z, v] of [
    [8.5, 39.6, 0],
    [14.5, 39.6, 3],
  ] as const)
    put("stall", x, z, v);
  for (const [x, z] of [
    [20.5, 39.8],
    [26.5, 39.8],
  ] as const)
    put("bench", x, z, 0);
  put("hitch", 46.5, 19.8, 0);
  put("barrel", 44.0, 9.0, 0);
  put("crate", 37.4, 22.0, 1);
  put("signpost", 41.4, 28.2, 0);

  /* ---- 马蹄镇 ---- */
  put("fountain", FOUNTAIN.x, FOUNTAIN.z + 1.2, 0);
  // 广场四角的花坛、长凳、街灯，北街和东西大街的路灯。
  for (const [x, z] of [
    [63.5, 17.4],
    [86.5, 17.4],
    [63.5, 33.4],
    [86.5, 33.4],
  ] as const)
    put("planter", x, z, rng.int(0, 3));
  for (const [x, z] of [
    [69.5, 20.6],
    [80.5, 20.6],
    [69.5, 30.6],
    [80.5, 30.6],
  ] as const)
    put("bench", x, z, 0);
  for (const [x, z] of [
    [66.4, 16.6],
    [83.6, 16.6],
    [66.4, 33.0],
    [83.6, 33.0],
    [59.6, 23.6],
    [90.4, 23.6],
    [98.4, 23.6],
    [110.4, 23.6],
    [73.4, 39.6],
    [77.6, 39.6],
    [49.4, 23.6],
  ] as const)
    put("lamppost", x, z, 0);
  // 广场东西两边的货摊。
  for (const [x, z, v] of [
    [66.5, 22.4, 0],
    [66.5, 28.4, 1],
    [84.0, 22.4, 2],
    [84.0, 28.4, 3],
  ] as const)
    put("stall", x, z, v);
  // 门口的木桶箱子、招牌下的灯笼。
  for (const [k, x, z] of [
    ["barrel", 62.4, 13.0],
    ["crate", 71.6, 13.0],
    ["barrel", 72.4, 12.6],
    ["crate", 85.0, 12.8],
    ["barrel", 93.6, 12.6],
    ["crate", 94.4, 13.6],
    ["barrel", 59.6, 19.0],
    ["crate", 51.4, 18.8],
  ] as const)
    put(k, x, z, rng.int(0, 3));
  put("anvil", 60.0, 21.8, 0);
  for (const [x, z] of [
    [73.4, 13.6],
    [83.6, 13.6],
    [92.4, 34.2],
    [97.6, 34.2],
  ] as const)
    put("lantern", x, z);
  // 茶馆和土地庙边上的竹子。
  for (const [x, z] of [
    [72.5, 9.2],
    [84.2, 8.4],
    [91.6, 31.8],
    [98.4, 32.0],
    [98.6, 30.4],
  ] as const)
    put("bamboo", x, z, rng.int(0, 2));
  // 码头边拴着一条小船。
  put("boat", 78.6, 46.4, 0);
  put("barrel", 73.4, 42.4, 0);
  // 民居门口的花和柴。
  put("planter", 51.4, 33.6, 1);
  put("woodpile", 69.4, 40.6, 0);
  put("planter", 88.6, 41.6, 2);
  put("well", 59.5, 39.4, 0);
  put("signpost", 99.4, 28.2, 2);
  // 镇子东边一片果园。
  for (let z = 30; z <= 42; z += 3) for (let x = 86; x <= 99; x += 3) if (clearAt(x, z)) put("oak", x + 0.5 + ((z / 3) % 2), z + 0.9, 2);

  /* ---- 赵家擂台 ---- */
  // 台子四角的柱子（四色穗子），两边几排长凳。
  for (const [x, z, v] of [
    [DOHYO.x0 + 0.5, DOHYO.z0 + 0.7, 0],
    [DOHYO.x1 - 0.5, DOHYO.z0 + 0.7, 1],
    [DOHYO.x0 + 0.5, DOHYO.z1 - 0.2, 2],
    [DOHYO.x1 - 0.5, DOHYO.z1 - 0.2, 3],
  ] as const)
    put("post", x, z, v);
  for (const z of [35.8, 38.8, 41.8]) put("bench", 104.6, z, 1);
  for (const x of [109.5, 114.5]) put("bench", x, 45.4, 0);
  put("barrel", 127.4, 33.4, 0);
  put("hay", 126.2, 36.6, 1);
  put("lantern", 106.0, 32.4);
  put("lantern", 118.0, 32.4);
  put("signpost", 106.6, 28.2, 3);

  /* ---- 研究所 ---- */
  put("dish", 112.6, 10.8, 0);
  for (let i = 0; i < 4; i++) put("beehive", 129.5 + i * 2, 16.6, i);
  for (const [x, z] of [
    [119.4, 15.8],
    [123.6, 15.8],
    [119.4, 20.0],
    [123.6, 20.0],
  ] as const)
    put("lamppost", x, z, 1);
  for (let x = 112; x <= 116; x += 2) put("planter", x + 0.5, 17.6, 2);
  put("crate", 126.0, 13.6, 2);
  put("crate", 127.0, 14.4, 0);

  /* ---- 牧场 ---- */
  // 家门口：菜地、稻草人、信箱、柴堆、向日葵。
  for (let z = 74; z <= 78; z++) for (let x = 6; x <= 12; x++) if (!(x === 9 && z === 76)) put("crops", x + 0.5, z + 0.95, (z - 74 + (x > 9 ? 2 : 0)) % 4);
  put("scarecrow", 9.5, 76.9, 0);
  put("mailbox", 12.6, 68.9, 0);
  put("woodpile", 22.6, 66.6, 0);
  for (let i = 0; i < 4; i++) put("sunflower", 14.6 + i * 0.9, 68.8, i);
  put("board", BOARD.x, BOARD.z, 0);
  put("lantern", 13.6, 69.0);
  put("lantern", 21.6, 69.0);
  // 马厩东边：草垛和板车，马场门口两盏灯。
  put("hay", 39.6, 66.4, 0);
  put("hay", 40.8, 67.4, 1);
  put("hay", 39.4, 68.2, 2);
  put("cart", 37.5, 74.8, 0);
  put("barrel", 25.0, 68.4, 1);
  put("lantern", 27.6, 77.6);
  put("lantern", 31.4, 77.6);
  // 牧场里的水槽。
  put("trough", 20.5, 81.9, 0);
  put("trough", 38.5, 92.9, 0);
  // 南边一片果园、几个蜂箱。
  for (let z = 82; z <= 100; z += 3) for (let x = 4; x <= 12; x += 3) put("oak", x + 0.5 + ((z / 3) % 2), z + 0.9, 2);
  // 路牌。
  put("signpost", 45.6, 59.2, 1);
  put("signpost", 103.6, 63.2, 2);
  for (const [x, z] of [
    [45.6, 30.6],
    [45.6, 42.6],
    [41.4, 58.6],
    [45.6, 66.6],
    [58.0, 59.6],
    [80.0, 59.6],
    [99.6, 40.6],
  ] as const)
    put("lantern", x, z);

  /* ---- 野原 ---- */
  // 猎人的营地：帐篷、篝火、围着坐的木头。
  put("tent", 92.5, 70.4, 0);
  put("campfire", 96.5, 72.2, 0);
  put("log", 96.5, 74.2, 0);
  put("crate", 90.6, 72.0, 1);
  put("log", 77.5, 92.8, 0);
  put("log", 124.5, 78.8, 0);

  // 水面上的睡莲，野地里的蘑菇、高草和花丛。
  for (let z = 1; z < MAP_H - 1; z++)
    for (let x = 1; x < MAP_W - 1; x++) {
      const k = tileAt(x, z);
      const r = rng.next();
      if (k === T.water) {
        if (r < 0.04 && !bank(x, z - 1) && Math.abs(x - 76) > 4) put("lily", x + 0.5, z + 0.7, rng.int(0, 2));
        continue;
      }
      if (!clearAt(x, z)) continue;
      const wild = inRect(WILDS, x, z);
      if (r < (wild ? 0.07 : 0.03)) put("grass", x + 0.5, z + 0.85, rng.int(0, 2));
      else if (r < (wild ? 0.1 : 0.045)) put("flowers", x + 0.5, z + 0.8, rng.int(0, 3));
      else if (r < (wild ? 0.11 : 0.05)) put("mushroom", x + 0.5, z + 0.7, rng.int(0, 1));
    }
  return props;
}

export const PROPS = buildProps();

const SOLID_PROPS = new Set<PropKind>([
  "pine",
  "oak",
  "willow",
  "bamboo",
  "rock",
  "lantern",
  "lamppost",
  "stump",
  "board",
  "flag",
  "planter",
  "barrel",
  "crate",
  "well",
  "stall",
  "hay",
  "trough",
  "mailbox",
  "woodpile",
  "signpost",
  "log",
  "cart",
  "statue",
  "bench",
  "dish",
  "tent",
  "campfire",
  "post",
  "scarecrow",
  "anvil",
  "hitch",
  "beehive",
]);
/** 占地不止一格的摆设，左右各多挡几格。 */
const WIDE: Partial<Record<PropKind, number>> = { stall: 1, trough: 1, cart: 1, log: 1, statue: 1, bench: 1, tent: 1, dish: 1, hitch: 1 };
const PROP_BLOCK = new Set(
  PROPS.filter((p) => SOLID_PROPS.has(p.kind)).flatMap((p) => {
    const r = WIDE[p.kind] ?? 0;
    const out: string[] = [];
    for (let dx = -r; dx <= r; dx++) out.push(`${Math.floor(p.x) + dx},${Math.floor(p.z - 0.3)}`);
    return out;
  }),
);

/** 人能不能站在这里。 */
export function walkable(x: number, z: number): boolean {
  if (x < 1 || z < 1 || x > MAP_W - 1 || z > MAP_H - 1) return false;
  const k = tileAt(x, z);
  if (k === T.water) return false;
  for (const b of BUILDINGS) if (x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d) return false;
  if (Math.hypot(x - RING.x, z - RING.z) < RING.r - 0.4) return false;
  if (Math.hypot(x - FOUNTAIN.x, (z - FOUNTAIN.z) * 1.3) < FOUNTAIN.r) return false;
  if (PROP_BLOCK.has(`${Math.floor(x)},${Math.floor(z)}`)) return false;
  return true;
}

export const inside = inRect;
