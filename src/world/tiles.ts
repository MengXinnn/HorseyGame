/**
 * 大世界地图：俯视的瓦片地图（星露谷那种 2D 俯视）。
 * 坐标单位是格子，x 向右、z 向下（z 就是地图上的行）。一格 16 像素。
 */
import { createRng, hashSeed } from "../sim/rng";

export const TILE = 16;
export const MAP_W = 96;
export const MAP_H = 80;
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
} as const;
export type TileKind = (typeof T)[keyof typeof T];

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const RIVER = { z0: 36, z1: 39 };
export const PADDOCK: Rect = { x0: 7, z0: 56, x1: 30, z1: 70 };
export const PADDOCK_GATE = { x0: 17, x1: 20 };
export const WILDS: Rect = { x0: 50, z0: 43, x1: 90, z1: 75 };
export const POND = { x: 80, z: 63, r: 4.2 };
export const PLAZA: Rect = { x0: 42, z0: 12, x1: 75, z1: 28 };
export const RING = { x: 58, z: 20, r: 3.2 };
export const TRACK = { cx: 18, cz: 18, rx: 12.5, rz: 9, band: 2.6 };
export const YARD: Rect = { x0: 76, z0: 12, x1: 89, z1: 23 };
export const YARD_GATE = { x0: 77, x1: 79 };
export const LAOZHAO_SPOT = { x: 78, z: 11 };
export const TIEDUN_SPOT = { x: 83, z: 17.5 };

export type BuildingKind = "home" | "barn" | "bookie" | "seq" | "market" | "zhao" | "booth" | "stand";

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
  { id: "home", kind: "home", x: 10, z: 45, w: 7, d: 4, sign: "家" },
  { id: "barn", kind: "barn", x: 22, z: 44, w: 8, d: 5, sign: "马厩" },
  { id: "bookie", kind: "bookie", x: 45, z: 6, w: 6, d: 4, sign: "赌马" },
  { id: "seq", kind: "seq", x: 54, z: 5, w: 7, d: 4, sign: "测序" },
  { id: "market", kind: "market", x: 64, z: 6, w: 6, d: 4, sign: "马市" },
  { id: "zhao", kind: "zhao", x: 78, z: 5, w: 7, d: 4, sign: "赵" },
  { id: "booth", kind: "booth", x: 28, z: 22, w: 3, d: 2, sign: "报名" },
  { id: "stand", kind: "stand", x: 9, z: 3, w: 18, d: 3 },
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

export const BOARD = { x: 19.5, z: 50 };

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
  { id: "track", name: "赛马场", rect: { x0: 2, z0: 2, x1: 36, z1: 33 } },
  { id: "town", name: "马蹄镇", rect: { x0: 36, z0: 2, x1: 94, z1: 34 } },
  { id: "ranch", name: "牧场", rect: { x0: 2, z0: 40, x1: 46, z1: 78 } },
  { id: "wilds", name: "野原", rect: { x0: 46, z0: 40, x1: 94, z1: 78 } },
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

function buildGround(): Uint8Array {
  const g = new Uint8Array(MAP_W * MAP_H);
  const set = (x: number, z: number, k: TileKind): void => {
    if (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H) g[z * MAP_W + x] = k;
  };
  const fill = (r: Rect, k: TileKind): void => {
    for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) set(x, z, k);
  };
  fill(WILDS, T.meadow);
  fill(PADDOCK, T.paddock);
  fill(PLAZA, T.plaza);
  // 赛马场：椭圆跑道，中间草地。
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      const t = trackT(x + 0.5, z + 0.5);
      if (t <= 1 && t >= 1 - TRACK.band / TRACK.rz) set(x, z, T.track);
      else if (t < 1) set(x, z, T.infield);
    }
  // 路：牧场到镇上的大路，往赛马场、野原的岔路。
  fill({ x0: 31, z0: 26, x1: 33, z1: 52 }, T.path);
  fill({ x0: 10, z0: 50, x1: 33, z1: 52 }, T.path);
  fill({ x0: 17, z0: 52, x1: 20, z1: 56 }, T.path);
  fill({ x0: 26, z0: 24, x1: 43, z1: 26 }, T.path);
  fill({ x0: 33, z0: 42, x1: 52, z1: 44 }, T.path);
  fill({ x0: 70, z0: 28, x1: 72, z1: 44 }, T.path);
  fill({ x0: 76, z0: 9, x1: 80, z1: 12 }, T.path);
  for (const b of BUILDINGS) {
    if (b.kind === "stand") continue;
    const dx = Math.floor(b.x + b.w / 2) - 1;
    fill({ x0: dx, z0: b.z + b.d, x1: dx + 2, z1: b.z + b.d + 2 }, g[(b.z + b.d + 2) * MAP_W + dx] === T.plaza ? T.plaza : T.path);
  }
  // 相扑台：广场中间一圈沙。
  for (let z = RING.z - 4; z <= RING.z + 4; z++)
    for (let x = RING.x - 4; x <= RING.x + 4; x++) if (Math.hypot(x + 0.5 - RING.x, z + 0.5 - RING.z) < RING.r) set(x, z, T.sand);
  // 河和桥。
  for (let x = 0; x < MAP_W; x++) for (let z = RIVER.z0; z < RIVER.z1; z++) set(x, z, T.water);
  fill({ x0: 31, z0: RIVER.z0, x1: 33, z1: RIVER.z1 }, T.bridge);
  fill({ x0: 70, z0: RIVER.z0, x1: 72, z1: RIVER.z1 }, T.bridge);
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
}

function rectFence(r: Rect, gate: { x0: number; x1: number } | null, gateSide: "top" | "bottom"): Fence[] {
  const out: Fence[] = [];
  for (let x = r.x0; x < r.x1; x++) {
    const inGate = gate && x >= gate.x0 && x < gate.x1;
    if (!(inGate && gateSide === "top")) out.push({ x, z: r.z0, horizontal: true });
    if (!(inGate && gateSide === "bottom")) out.push({ x, z: r.z1, horizontal: true });
  }
  for (let z = r.z0; z < r.z1; z++) {
    out.push({ x: r.x0, z, horizontal: false });
    out.push({ x: r.x1, z, horizontal: false });
  }
  return out;
}

export const FENCES: Fence[] = [...rectFence(PADDOCK, PADDOCK_GATE, "top"), ...rectFence(YARD, YARD_GATE, "top")];

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
  | "bush"
  | "rock"
  | "lantern"
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
  | "bench";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** 变体编号，画的时候挑颜色和形状。 */
  v: number;
}

function buildingAt(x: number, z: number, pad = 0): boolean {
  return BUILDINGS.some((b) => x >= b.x - pad && x < b.x + b.w + pad && z >= b.z - pad - (b.kind === "stand" ? 0 : 2) && z < b.z + b.d + pad + 1);
}

function clearAt(x: number, z: number): boolean {
  const k = tileAt(x, z);
  if (k !== T.grass && k !== T.meadow) return false;
  if (buildingAt(x, z, 1)) return false;
  if (inRect({ x0: PADDOCK.x0 - 1, z0: PADDOCK.z0 - 1, x1: PADDOCK.x1 + 2, z1: PADDOCK.z1 + 2 }, x, z)) return false;
  if (inRect({ x0: YARD.x0 - 1, z0: YARD.z0 - 1, x1: YARD.x1 + 2, z1: YARD.z1 + 2 }, x, z)) return false;
  if (trackT(x, z) < 1.12) return false;
  return true;
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
  // 地图四周一圈密林。
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      const edge = Math.min(x, z, MAP_W - 1 - x, MAP_H - 1 - z);
      if (edge > 2) continue;
      if (tileAt(x, z) === T.water) continue;
      if ((x + z * 3) % 2 === 0 || edge === 0) put(rng.next() < 0.7 ? "pine" : "oak", x + 0.5, z + 0.9);
    }
  // 零散的树、灌木、石头。
  for (let i = 0; i < 520; i++) {
    const x = rng.int(3, MAP_W - 4);
    const z = rng.int(3, MAP_H - 4);
    if (!clearAt(x, z) || !clearAt(x + 1, z) || !clearAt(x, z + 1)) continue;
    const wild = inRect(WILDS, x, z);
    const r = rng.next();
    if (wild && r < 0.12) put("oak", x + 0.5, z + 0.9);
    else if (r < 0.18) put(rng.next() < 0.5 ? "pine" : "oak", x + 0.5, z + 0.9);
    else if (r < 0.32) put("bush", x + 0.5, z + 0.8);
    else if (r < 0.4) put("rock", x + 0.5, z + 0.7);
    else if (r < 0.43) put("stump", x + 0.5, z + 0.7);
  }
  // 河边的芦苇。
  for (let x = 2; x < MAP_W - 2; x += 1) {
    if (x >= 29 && x <= 34) continue;
    if (x >= 68 && x <= 73) continue;
    if (rng.next() < 0.35) put("reeds", x + 0.5, RIVER.z0 - 0.1, rng.int(0, 2));
    if (rng.next() < 0.35) put("reeds", x + 0.5, RIVER.z1 + 0.6, rng.int(0, 2));
  }
  // 灯笼：大路两边、广场四角。
  for (let z = 28; z < 50; z += 6) {
    put("lantern", 30.5, z + 0.8);
    put("lantern", 33.5, z + 0.8);
  }
  for (const [x, z] of [
    [42.5, 12.8],
    [74.5, 12.8],
    [42.5, 27.8],
    [74.5, 27.8],
    [54.5, 16.8],
    [61.5, 16.8],
  ] as const)
    put("lantern", x, z);
  // 广场：花坛、货摊、水井、木桶箱子，别让一大片石板空着。
  for (const x of [44.5, 46.5, 52.5, 62.5, 70.5, 72.5]) put("planter", x, 13.6, rng.int(0, 3));
  for (const [x, v] of [
    [46.5, 0],
    [50.5, 1],
    [66.5, 2],
    [70.5, 3],
  ] as const)
    put("stall", x, 26.6, v);
  put("well", 66.5, 19.8, 0);
  // 广场西边立着一匹铜马，旁边几条长凳。
  put("statue", 49.5, 20.8, 0);
  for (const [x, z] of [
    [46.5, 17.8],
    [52.5, 17.8],
    [46.5, 24.6],
    [52.5, 24.6],
    [64.5, 23.8],
    [69.5, 23.8],
  ] as const)
    put("bench", x, z, 0);
  put("oak", 44.5, 20.9, 1);
  put("oak", 73.5, 21.9, 2);
  for (const [k, x, z] of [
    ["barrel", 43.5, 10.8],
    ["crate", 51.5, 10.8],
    ["barrel", 52.5, 10.6],
    ["crate", 62.5, 10.8],
    ["barrel", 70.5, 10.8],
    ["crate", 31.5, 23.8],
    ["barrel", 26.5, 48.8],
    ["crate", 21.2, 48.8],
  ] as const)
    put(k, x, z, rng.int(0, 3));
  // 家门口：菜地、信箱、柴堆。
  for (let z = 52; z <= 54; z++) for (let x = 3; x <= 8; x++) put("crops", x + 0.5, z + 0.95, (z - 52 + (x > 5 ? 2 : 0)) % 4);
  put("mailbox", 17.5, 49.9, 0);
  put("woodpile", 8.4, 47.9, 0);
  // 马厩东边：草垛和板车。
  put("hay", 35.5, 45.9, 0);
  put("hay", 37.0, 46.7, 1);
  put("hay", 35.4, 47.6, 2);
  put("cart", 39.5, 47.9, 0);
  // 牧场里的水槽。
  put("trough", 12.5, 58.9, 0);
  put("trough", 24.5, 66.9, 0);
  // 路牌。
  put("signpost", 33.6, 49.9, 0);
  put("signpost", 34.6, 27.9, 1);
  put("signpost", 72.6, 41.9, 2);
  // 东边一片果园。
  for (let z = 27; z <= 33; z += 3) for (let x = 78; x <= 91; x += 3) put("oak", x + 0.5 + ((z / 3) % 2), z + 0.9, 2);
  // 水面上的睡莲，野地里的蘑菇、倒木、高草和花丛。
  for (let z = 1; z < MAP_H - 1; z++)
    for (let x = 1; x < MAP_W - 1; x++) {
      const k = tileAt(x, z);
      const r = rng.next();
      if (k === T.water) {
        if (r < 0.05) put("lily", x + 0.5, z + 0.7, rng.int(0, 2));
        continue;
      }
      if (!clearAt(x, z)) continue;
      const wild = inRect(WILDS, x, z);
      if (r < (wild ? 0.07 : 0.03)) put("grass", x + 0.5, z + 0.85, rng.int(0, 2));
      else if (r < (wild ? 0.1 : 0.045)) put("flowers", x + 0.5, z + 0.8, rng.int(0, 3));
      else if (r < (wild ? 0.11 : 0.05)) put("mushroom", x + 0.5, z + 0.7, rng.int(0, 1));
    }
  put("log", 58.5, 70.8, 0);
  put("log", 86.5, 48.8, 0);
  put("log", 12.5, 32.8, 0);
  put("lantern", 20.5, 49.8);
  put("lantern", 9.5, 49.8);
  // 赛马场的彩旗。
  for (let i = 0; i < 6; i++) put("flag", 10.5 + i * 3, 7.6, i);
  // 家门口的向日葵。
  for (let i = 0; i < 4; i++) put("sunflower", 10.5 + i, 50.0 - 0.1, i);
  put("board", BOARD.x, BOARD.z, 0);
  return props;
}

export const PROPS = buildProps();

const SOLID_PROPS = new Set<PropKind>(["pine", "oak", "rock", "lantern", "stump", "board", "flag", "planter", "barrel", "crate", "well", "stall", "hay", "trough", "mailbox", "woodpile", "signpost", "log", "cart", "statue", "bench"]);
/** 占地不止一格的摆设，左右各多挡几格。 */
const WIDE: Partial<Record<PropKind, number>> = { stall: 1, well: 0, trough: 1, cart: 1, log: 1, statue: 1, bench: 1 };
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
  if (PROP_BLOCK.has(`${Math.floor(x)},${Math.floor(z)}`)) return false;
  return true;
}

export const inside = inRect;
