/**
 * 像素美术：地面、树、房子、人物、图标都在这里用代码一个像素一个像素画出来，
 * 画一次缓存成小画布，之后每帧只是贴图。
 */
import { createRng, hashSeed, type Rng } from "../sim/rng";
import {
  BUILDINGS,
  GROUND,
  MAP_H,
  MAP_W,
  T,
  TILE,
  TRACK,
  type Building,
  type Prop,
  type TileKind,
} from "./tiles";

export const PIXEL_FONT = "'Fusion Pixel 12px Proportional SC', 'Noto Serif SC', monospace";

type Ctx = CanvasRenderingContext2D;

export function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d") as Ctx;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** 字体加载完成前画的字会用后备字体，所以缓存要等字体到位。 */
export const fontReady = (): boolean => document.fonts.check(`12px ${PIXEL_FONT}`);

const textCache = new Map<string, HTMLCanvasElement>();

/**
 * 像素字：12px 像素字体画进小画布，透明度一刀切成 0/255，
 * 去掉浏览器的抗锯齿灰边，放大后才是干净的方块字。可选一圈描边。
 */
export function textSprite(text: string, color: string, line: string | null = null): HTMLCanvasElement {
  const key = `${text}|${color}|${line}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const [m, mctx] = canvas(1, 1);
  mctx.font = `12px ${PIXEL_FONT}`;
  const w = Math.ceil(mctx.measureText(text).width) + 2;
  const [c, ctx] = canvas(w + 2, 16);
  ctx.font = `12px ${PIXEL_FONT}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = color;
  ctx.fillText(text, 2, 2);
  if (line) outline(c, line, 100);
  else hardEdge(c, 100);
  m.width = 0;
  if (fontReady()) textCache.set(key, c);
  return c;
}

function hardEdge(c: HTMLCanvasElement, threshold: number): void {
  const ctx = c.getContext("2d") as Ctx;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i]! >= threshold ? 255 : 0;
  ctx.putImageData(img, 0, 0);
}

const px = (ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1): void => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

/** 给不透明区域描一圈深色外框（星露谷人物那种干净的轮廓），顺便去掉半透明的抗锯齿边。 */
export function outline(c: HTMLCanvasElement, color = "#2a1a12", threshold = 110): void {
  const ctx = c.getContext("2d") as Ctx;
  const { width: w, height: h } = c;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3]! >= threshold) {
      solid[i] = 1;
      d[i * 4 + 3] = 255;
    } else d[i * 4 + 3] = 0;
  }
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])) {
        d[i * 4] = r;
        d[i * 4 + 1] = g;
        d[i * 4 + 2] = b;
        d[i * 4 + 3] = 255;
      }
    }
  ctx.putImageData(img, 0, 0);
}

/* ---------------- 地面 ---------------- */

const GRASSY = new Set<number>([T.grass, T.meadow, T.paddock, T.infield]);

const GROUND_COLORS: Record<number, { base: string; dark: string; light: string }> = {
  [T.grass]: { base: "#68ac3e", dark: "#4f8f30", light: "#84c650" },
  [T.meadow]: { base: "#7bb846", dark: "#5f9b36", light: "#9bd15e" },
  [T.paddock]: { base: "#71b041", dark: "#559333", light: "#8cc955" },
  [T.infield]: { base: "#5fa43b", dark: "#4b8b2f", light: "#78bd4b" },
  [T.path]: { base: "#d8a764", dark: "#bf8a4a", light: "#e9c286" },
  [T.plaza]: { base: "#bdb3a2", dark: "#9a907f", light: "#d6cdbd" },
  [T.sand]: { base: "#ead190", dark: "#d2b672", light: "#f6e4ae" },
  [T.track]: { base: "#c98a56", dark: "#ad7043", light: "#dca372" },
  [T.water]: { base: "#3f8bd0", dark: "#2f6fae", light: "#6fb3ea" },
  [T.bridge]: { base: "#a8723c", dark: "#7c5028", light: "#c48c52" },
};

const kindAt = (x: number, z: number): number => {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return T.grass;
  return GROUND[z * MAP_W + x] as number;
};

function drawTile(ctx: Ctx, tx: number, tz: number, k: TileKind, rng: Rng): void {
  const C = GROUND_COLORS[k]!;
  const x0 = tx * TILE;
  const y0 = tz * TILE;
  px(ctx, x0, y0, C.base, TILE, TILE);
  if (GRASSY.has(k)) {
    if (k === T.infield && Math.floor(tz / 2) % 2 === 0) px(ctx, x0, y0, "rgba(255,255,255,0.06)", TILE, TILE);
    // 小草丛和斑点。
    for (let i = 0; i < 6; i++) px(ctx, x0 + rng.int(0, 15), y0 + rng.int(0, 15), rng.next() < 0.5 ? C.dark : C.light);
    const tufts = k === T.meadow ? 3 : 2;
    for (let i = 0; i < tufts; i++) {
      if (rng.next() < 0.45) continue;
      const x = x0 + rng.int(1, 13);
      const y = y0 + rng.int(3, 14);
      px(ctx, x, y, C.dark);
      px(ctx, x + 1, y - 1, C.dark);
      px(ctx, x + 2, y, C.dark);
      px(ctx, x + 1, y - 2, C.light);
      if (k === T.meadow) px(ctx, x + 3, y - 2, C.dark);
    }
    const flowerChance = k === T.meadow ? 0.22 : k === T.grass ? 0.05 : 0.02;
    if (rng.next() < flowerChance) {
      const x = x0 + rng.int(2, 13);
      const y = y0 + rng.int(2, 13);
      const petal = ["#ffffff", "#f6d84a", "#f19ab0", "#b8a6ff"][rng.int(0, 3)] as string;
      px(ctx, x - 1, y, petal);
      px(ctx, x + 1, y, petal);
      px(ctx, x, y - 1, petal);
      px(ctx, x, y + 1, petal);
      px(ctx, x, y, "#f2a93b");
    }
  } else if (k === T.path || k === T.sand || k === T.track) {
    for (let i = 0; i < 10; i++) px(ctx, x0 + rng.int(0, 15), y0 + rng.int(0, 15), rng.next() < 0.6 ? C.dark : C.light);
    if (rng.next() < 0.3) {
      const x = x0 + rng.int(2, 12);
      const y = y0 + rng.int(2, 12);
      px(ctx, x, y, "#9c8a76", 2, 1);
      px(ctx, x, y - 1, "#c9b9a2", 1, 1);
    }
    if (k === T.track) for (let y = 2; y < 16; y += 5) px(ctx, x0 + rng.int(0, 4), y0 + y, C.dark, rng.int(6, 11), 1);
  } else if (k === T.plaza) {
    // 青石板：错缝的砖，每块深浅不一，偶尔一点青苔。
    const shades = ["#bdb3a2", "#b3a998", "#c6bdad", "#aaa08f"];
    for (let r = 0; r < 2; r++) {
      const yy = y0 + r * 8;
      const off = (tz * 2 + r) % 2 ? 0 : 8;
      for (let c = -1; c < 2; c++) {
        const bx = x0 + off + c * 16;
        const l = Math.max(x0, bx + 1);
        const rgt = Math.min(x0 + 16, bx + 16);
        if (rgt > l) px(ctx, l, yy + 1, shades[rng.int(0, 3)] as string, rgt - l, 7);
      }
      px(ctx, x0, yy, C.dark, TILE, 1);
      px(ctx, x0 + off, yy, C.dark, 1, 8);
      px(ctx, x0 + ((off + 8) % 16), yy, C.dark, 1, 8);
      px(ctx, x0 + off + 1, yy + 1, C.light, 6, 1);
      px(ctx, x0 + ((off + 8) % 16) + 1, yy + 1, C.light, 6, 1);
    }
    if (rng.next() < 0.2) px(ctx, x0 + rng.int(2, 13), y0 + rng.int(2, 13), C.dark);
    if (rng.next() < 0.08) {
      const x = x0 + rng.int(1, 12);
      const y = y0 + (rng.next() < 0.5 ? 7 : 15);
      px(ctx, x, y, "#7d9a4a", 3, 1);
      px(ctx, x + 1, y - 1, "#93b05a");
    }
  } else if (k === T.water) {
    for (let i = 0; i < 3; i++) {
      if (rng.next() < 0.5) continue;
      px(ctx, x0 + rng.int(0, 11), y0 + rng.int(2, 14), C.dark, rng.int(3, 5), 1);
    }
  } else if (k === T.bridge) {
    for (let y = 0; y < 16; y += 4) {
      px(ctx, x0, y0 + y, C.light, TILE, 1);
      px(ctx, x0, y0 + y + 3, C.dark, TILE, 1);
      px(ctx, x0 + rng.int(2, 13), y0 + y + 1, C.dark);
    }
  }
}

/** 不同地面交界的地方画一道边：草压在路上，水边一圈浅滩和深色水线。 */
function drawEdges(ctx: Ctx, tx: number, tz: number, k: number, rng: Rng): void {
  if (GRASSY.has(k)) return;
  const x0 = tx * TILE;
  const y0 = tz * TILE;
  const dirs: Array<[number, number, "n" | "s" | "w" | "e"]> = [
    [0, -1, "n"],
    [0, 1, "s"],
    [-1, 0, "w"],
    [1, 0, "e"],
  ];
  for (const [dx, dz, side] of dirs) {
    const n = kindAt(tx + dx, tz + dz);
    if (n === k) continue;
    if (k === T.bridge && n === T.water) {
      // 桥边的栏杆。
      if (side === "w") px(ctx, x0, y0, "#5e3a1c", 2, TILE);
      if (side === "e") px(ctx, x0 + 14, y0, "#5e3a1c", 2, TILE);
      continue;
    }
    if (k === T.bridge) continue;
    if (k === T.water) {
      if (n === T.bridge) continue;
      const sand = "#e8d7a2";
      const deep = "#2c68a2";
      for (let i = 0; i < 16; i++) {
        const j = rng.next() < 0.3 ? 1 : 0;
        const w = 2 + j;
        if (side === "n") {
          px(ctx, x0 + i, y0, sand, 1, w);
          px(ctx, x0 + i, y0 + w, deep);
        } else if (side === "s") {
          px(ctx, x0 + i, y0 + 16 - w, sand, 1, w);
          px(ctx, x0 + i, y0 + 15 - w, "#8cc8f0");
        } else if (side === "w") {
          px(ctx, x0, y0 + i, sand, w, 1);
          px(ctx, x0 + w, y0 + i, deep);
        } else {
          px(ctx, x0 + 16 - w, y0 + i, sand, w, 1);
          px(ctx, x0 + 15 - w, y0 + i, deep);
        }
      }
      continue;
    }
    if (!GRASSY.has(n)) {
      if (k === T.plaza || n === T.plaza) {
        const c = "#8a8070";
        if (side === "n") px(ctx, x0, y0, c, 16, 1);
        if (side === "s") px(ctx, x0, y0 + 15, c, 16, 1);
        if (side === "w") px(ctx, x0, y0, c, 1, 16);
        if (side === "e") px(ctx, x0 + 15, y0, c, 1, 16);
      }
      continue;
    }
    const G = GROUND_COLORS[n]!;
    const C = GROUND_COLORS[k]!;
    // 草边：参差不齐的一到三像素，下面一道深色描边。
    for (let i = 0; i < 16; i++) {
      const w = 1 + ((hashSeed(`${tx},${tz},${side},${i >> 1}`) >> 3) % 3);
      if (side === "n") {
        px(ctx, x0 + i, y0, G.base, 1, w);
        px(ctx, x0 + i, y0 + w, C.dark);
      } else if (side === "s") {
        px(ctx, x0 + i, y0 + 16 - w, G.base, 1, w);
        px(ctx, x0 + i, y0 + 15 - w, C.dark);
      } else if (side === "w") {
        px(ctx, x0, y0 + i, G.base, w, 1);
        px(ctx, x0 + w, y0 + i, C.dark);
      } else {
        px(ctx, x0 + 16 - w, y0 + i, G.base, w, 1);
        px(ctx, x0 + 15 - w, y0 + i, C.dark);
      }
    }
  }
}

/** 赛道的白色栏杆。 */
function drawRails(ctx: Ctx): void {
  for (const scale of [1, 1 - TRACK.band / TRACK.rz]) {
    const rx = TRACK.rx * scale * TILE;
    const rz = TRACK.rz * scale * TILE;
    const cx = TRACK.cx * TILE;
    const cz = TRACK.cz * TILE;
    const n = Math.round((rx + rz) * 0.9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * rx;
      const y = cz + Math.sin(a) * rz;
      px(ctx, x, y - 3, "#f4f1e6", 1, 3);
      px(ctx, x, y, "#9a9584");
      if (i % 4 === 0) px(ctx, x, y - 4, "#c33b2e");
    }
  }
}

/** 整张地图的地面烘焙成一张大图。 */
export function bakeGround(): HTMLCanvasElement {
  const [c, ctx] = canvas(MAP_W * TILE, MAP_H * TILE);
  const rng = createRng(hashSeed("地面"));
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) drawTile(ctx, x, z, kindAt(x, z) as TileKind, rng);
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) drawEdges(ctx, x, z, kindAt(x, z), rng);
  drawRails(ctx);
  return c;
}

/* ---------------- 树和道具 ---------------- */

export interface Sprite {
  img: HTMLCanvasElement;
  /** 贴图时的锚点（脚底），相对图片左上角。 */
  ax: number;
  ay: number;
}

function sprite(w: number, h: number, ax: number, ay: number, draw: (ctx: Ctx) => void, line?: string): Sprite {
  const [c, ctx] = canvas(w, h);
  draw(ctx);
  if (line) outline(c, line);
  return { img: c, ax, ay };
}

function blob(ctx: Ctx, cx: number, cy: number, r: number, color: string, squash = 1): void {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (x * x + (y * y) / (squash * squash) <= r * r + r * 0.6) px(ctx, cx + x, cy + y, color);
}

function pine(v: number): Sprite {
  const greens = [
    ["#21543a", "#2f6e45", "#46905a", "#6cb36b"],
    ["#1f4c3c", "#2b6449", "#3f8460", "#62a877"],
    ["#28583a", "#357345", "#4d9455", "#79bb6a"],
    ["#22503a", "#2e6a46", "#438a58", "#68ae6c"],
  ][v % 4] as string[];
  return sprite(
    32,
    52,
    16,
    49,
    (ctx) => {
      px(ctx, 14, 38, "#5a3a22", 4, 12);
      px(ctx, 14, 38, "#7a5030", 2, 12);
      const layers = [
        [40, 14],
        [31, 12],
        [22, 10],
        [13, 7],
      ];
      layers.forEach(([y, r]) => {
        for (let row = 0; row < 12; row++) {
          const half = Math.round((row / 12) * (r as number));
          const yy = (y as number) - 12 + row;
          px(ctx, 16 - half, yy, greens[1]!, half * 2, 1);
          px(ctx, 16 - half, yy, greens[2]!, Math.max(1, half - 1), 1);
          if (row > 2) px(ctx, 16 - half + 1, yy, greens[3]!, Math.max(1, Math.floor(half / 3)), 1);
          px(ctx, 16 + half - 2, yy, greens[0]!, 2, 1);
        }
      });
      px(ctx, 16, 2, greens[3]!, 1, 2);
    },
    "#183326",
  );
}

function oak(v: number): Sprite {
  const g = [
    ["#2c6a33", "#3f8a3a", "#5aa848", "#86c95e"],
    ["#2f6630", "#45873a", "#62a64a", "#8fcb63"],
    ["#356a2c", "#4d8c34", "#6cab42", "#9ccf5c"],
    ["#2a6236", "#3b8240", "#55a250", "#7fc468"],
  ][v % 4] as string[];
  return sprite(
    36,
    46,
    18,
    43,
    (ctx) => {
      px(ctx, 15, 28, "#5e3d24", 6, 16);
      px(ctx, 15, 28, "#7d5434", 2, 16);
      px(ctx, 13, 42, "#5e3d24", 10, 2);
      const clusters: Array<[number, number, number]> = [
        [18, 16, 13],
        [9, 22, 8],
        [27, 22, 8],
        [12, 10, 8],
        [24, 10, 8],
        [18, 25, 9],
      ];
      for (const [x, y, r] of clusters) blob(ctx, x, y, r, g[0]!);
      for (const [x, y, r] of clusters) blob(ctx, x - 1, y - 1, r - 1, g[1]!);
      for (const [x, y, r] of clusters) blob(ctx, x - 2, y - 2, Math.max(2, r - 4), g[2]!);
      for (const [x, y, r] of clusters) blob(ctx, x - 3, y - 3, Math.max(1, r - 7), g[3]!);
      if (v === 2) for (const [x, y] of [[12, 14], [24, 18], [18, 24], [28, 12]] as const) px(ctx, x, y, "#e2513c", 2, 2);
    },
    "#1d3d1f",
  );
}

function bush(v: number): Sprite {
  const g = v % 2 ? ["#2f6e35", "#46903f", "#6db454"] : ["#336a2e", "#4c8a37", "#78b34c"];
  return sprite(
    20,
    16,
    10,
    14,
    (ctx) => {
      blob(ctx, 6, 9, 5, g[0]!);
      blob(ctx, 13, 9, 5, g[0]!);
      blob(ctx, 10, 6, 5, g[0]!);
      blob(ctx, 5, 8, 4, g[1]!);
      blob(ctx, 12, 8, 4, g[1]!);
      blob(ctx, 9, 5, 4, g[1]!);
      blob(ctx, 8, 4, 2, g[2]!);
      blob(ctx, 4, 7, 1, g[2]!);
      if (v === 3) for (const [x, y] of [[6, 7], [12, 6], [10, 10]] as const) px(ctx, x, y, "#f2f0f6");
    },
    "#1d3d1f",
  );
}

function rock(v: number): Sprite {
  return sprite(
    16,
    12,
    8,
    10,
    (ctx) => {
      blob(ctx, 8, 7, 5, "#7e7a72", 0.7);
      blob(ctx, 7, 6, 4, "#9e9a90", 0.7);
      blob(ctx, 6, 5, 2, "#c3bfb3", 0.7);
      if (v % 2) px(ctx, 9, 7, "#6a665f", 3, 1);
    },
    "#3b372f",
  );
}

function stump(): Sprite {
  return sprite(
    16,
    14,
    8,
    12,
    (ctx) => {
      px(ctx, 3, 5, "#6e4729", 10, 7);
      px(ctx, 3, 4, "#c99a63", 10, 3);
      px(ctx, 5, 5, "#a77a48", 6, 1);
      px(ctx, 3, 11, "#553620", 10, 1);
    },
    "#2c1a10",
  );
}

function reeds(v: number): Sprite {
  return sprite(16, 18, 8, 16, (ctx) => {
    const n = 4 + v;
    for (let i = 0; i < n; i++) {
      const x = 2 + ((i * 5) % 12);
      const h = 7 + ((i * 7) % 8);
      px(ctx, x, 16 - h, i % 2 ? "#5c8a3a" : "#7aa648", 1, h);
      if (i % 2 === 0) px(ctx, x, 16 - h - 2, "#7a5534", 1, 3);
    }
  });
}

function lantern(): Sprite {
  return sprite(
    12,
    30,
    6,
    28,
    (ctx) => {
      px(ctx, 5, 6, "#4a2e1a", 2, 22);
      px(ctx, 4, 27, "#3a2414", 4, 2);
      px(ctx, 6, 5, "#4a2e1a", 4, 1);
      px(ctx, 8, 6, "#3a2414", 1, 2);
      blob(ctx, 8, 11, 3, "#c9302a");
      px(ctx, 6, 9, "#e8574a", 2, 3);
      px(ctx, 7, 7, "#f2c14e", 3, 1);
      px(ctx, 7, 15, "#f2c14e", 3, 1);
      px(ctx, 8, 16, "#f2c14e", 1, 2);
    },
    "#24150c",
  );
}

function sunflower(v: number): Sprite {
  return sprite(10, 22, 5, 20, (ctx) => {
    px(ctx, 4, 8, "#4c8a37", 1, 13);
    px(ctx, 2, 13 + (v % 2), "#5ea446", 2, 2);
    px(ctx, 5, 15 - (v % 2), "#5ea446", 2, 2);
    blob(ctx, 4, 5, 3, "#f2c230");
    px(ctx, 3, 4, "#7a4a1c", 3, 3);
    px(ctx, 1, 4, "#e6a320");
  });
}

function flag(v: number): Sprite {
  const colors = ["#d8443a", "#f2b632", "#3f7fd0", "#4fa64a", "#d8443a", "#f2b632"];
  return sprite(
    14,
    34,
    2,
    32,
    (ctx) => {
      px(ctx, 1, 2, "#5a4632", 2, 31);
      px(ctx, 3, 3, colors[v % 6]!, 9, 6);
      px(ctx, 3, 9, colors[v % 6]!, 6, 2);
      px(ctx, 3, 3, "rgba(255,255,255,0.35)", 9, 1);
    },
    "#24150c",
  );
}

function noticeBoard(): Sprite {
  return sprite(
    22,
    26,
    11,
    24,
    (ctx) => {
      px(ctx, 3, 12, "#5a3a22", 2, 13);
      px(ctx, 17, 12, "#5a3a22", 2, 13);
      px(ctx, 1, 3, "#8a5a32", 20, 12);
      px(ctx, 2, 4, "#a8733f", 18, 10);
      px(ctx, 4, 5, "#f4ead2", 6, 7);
      px(ctx, 12, 6, "#f4ead2", 6, 6);
      px(ctx, 5, 7, "#9a8a70", 4, 1);
      px(ctx, 5, 9, "#9a8a70", 3, 1);
      px(ctx, 13, 8, "#9a8a70", 4, 1);
      px(ctx, 6, 5, "#c9302a", 2, 1);
      px(ctx, 0, 2, "#6b4222", 22, 2);
    },
    "#24150c",
  );
}

const FLOWERS = ["#f19ab0", "#f6d84a", "#ffffff", "#b8a6ff"];

function planter(v: number): Sprite {
  return sprite(
    18,
    16,
    9,
    14,
    (ctx) => {
      px(ctx, 1, 8, "#8a5a32", 16, 7);
      px(ctx, 1, 8, "#b07a46", 16, 2);
      px(ctx, 1, 13, "#6a4024", 16, 2);
      px(ctx, 5, 10, "#6a4024", 1, 3);
      px(ctx, 12, 10, "#6a4024", 1, 3);
      blob(ctx, 9, 6, 6, "#4f8f30", 0.55);
      blob(ctx, 8, 5, 4, "#68ac3e", 0.55);
      const c = FLOWERS[v % FLOWERS.length] as string;
      for (const [x, y] of [
        [4, 5],
        [8, 3],
        [12, 5],
        [6, 7],
        [11, 7],
        [14, 6],
      ] as const) {
        px(ctx, x, y, c, 2, 2);
        px(ctx, x, y, "#f2a93b");
      }
    },
    "#2a1a12",
  );
}

function barrel(): Sprite {
  return sprite(
    14,
    18,
    7,
    16,
    (ctx) => {
      px(ctx, 2, 3, "#9a6232", 10, 13);
      px(ctx, 1, 5, "#9a6232", 12, 9);
      px(ctx, 4, 3, "#b87a42", 2, 13);
      px(ctx, 9, 3, "#7a4a24", 2, 13);
      px(ctx, 1, 6, "#5a5a5a", 12, 1);
      px(ctx, 1, 12, "#5a5a5a", 12, 1);
      px(ctx, 3, 2, "#c99a62", 8, 2);
      px(ctx, 4, 2, "#7a4a24", 6, 1);
    },
    "#2a1a12",
  );
}

function crate(): Sprite {
  return sprite(
    16,
    16,
    8,
    14,
    (ctx) => {
      px(ctx, 2, 3, "#c08a4a", 12, 11);
      px(ctx, 2, 3, "#dca866", 12, 2);
      px(ctx, 2, 3, "#8a5a2a", 2, 11);
      px(ctx, 12, 3, "#8a5a2a", 2, 11);
      px(ctx, 2, 12, "#8a5a2a", 12, 2);
      for (let i = 0; i < 8; i++) px(ctx, 4 + i, 5 + i * 0.9, "#8a5a2a", 1, 1);
    },
    "#2a1a12",
  );
}

function well(): Sprite {
  return sprite(
    30,
    40,
    15,
    37,
    (ctx) => {
      // 井台
      px(ctx, 3, 24, "#8f877a", 24, 12);
      px(ctx, 3, 24, "#b5ad9e", 24, 3);
      for (let x = 3; x < 27; x += 6) px(ctx, x, 27, "#6e675c", 1, 9);
      px(ctx, 3, 31, "#6e675c", 24, 1);
      px(ctx, 6, 22, "#2c3a4a", 18, 4);
      px(ctx, 6, 22, "#3f6f9a", 18, 1);
      // 井架和小屋顶
      px(ctx, 5, 8, "#5a3a22", 2, 17);
      px(ctx, 23, 8, "#5a3a22", 2, 17);
      px(ctx, 6, 13, "#3a2414", 18, 1);
      px(ctx, 14, 14, "#c9b98e", 2, 7);
      px(ctx, 13, 19, "#7a4a24", 4, 3);
      px(ctx, 1, 5, "#3e4a5c", 28, 4);
      px(ctx, 3, 2, "#52627a", 24, 3);
      px(ctx, 6, 0, "#6a7c96", 18, 2);
      px(ctx, 1, 8, "#2c3644", 28, 1);
    },
    "#24150c",
  );
}

const AWNINGS = [
  ["#c9302a", "#f3e6c8"],
  ["#3f6fb0", "#f3e6c8"],
  ["#4f8f30", "#f6d05a"],
  ["#d07a2a", "#f3e6c8"],
];
const GOODS = [
  ["#e0453a", "#f6a23a", "#9ad14e"],
  ["#f6d84a", "#e8b04a", "#c98a56"],
  ["#d6a0e6", "#f19ab0", "#ffffff"],
  ["#7ac6e8", "#e0453a", "#f6d84a"],
];

function stall(v: number): Sprite {
  const [a, b] = AWNINGS[v % 4] as [string, string];
  const goods = GOODS[v % 4] as string[];
  return sprite(
    44,
    40,
    22,
    37,
    (ctx) => {
      px(ctx, 4, 10, "#5a3a22", 2, 26);
      px(ctx, 38, 10, "#5a3a22", 2, 26);
      // 柜台
      px(ctx, 3, 24, "#9a6232", 38, 12);
      px(ctx, 3, 24, "#c08a4a", 38, 3);
      px(ctx, 3, 33, "#6a4024", 38, 3);
      for (let x = 8; x < 40; x += 8) px(ctx, x, 27, "#7a4a24", 1, 6);
      // 货
      for (let i = 0; i < 9; i++) {
        const c = goods[i % 3] as string;
        blob(ctx, 8 + i * 3.5, 22, 2, c);
        px(ctx, 7 + i * 3.5, 20, "#ffffff");
      }
      // 条纹遮阳篷
      for (let i = 0; i < 11; i++) px(ctx, 1 + i * 4, 2, i % 2 ? b : a, 4, 9);
      for (let i = 0; i < 11; i++) px(ctx, 1 + i * 4, 11, i % 2 ? b : a, 4, 2 - (i % 2));
      px(ctx, 1, 2, "rgba(255,255,255,0.25)", 42, 1);
      px(ctx, 1, 10, "rgba(0,0,0,0.18)", 42, 1);
    },
    "#24150c",
  );
}

const CROPS = [
  { leaf: "#5aa848", dark: "#3f8a3a", fruit: "#b8e070" },
  { leaf: "#6cbf4a", dark: "#3f8a3a", fruit: "#f08a2a" },
  { leaf: "#7cbf3a", dark: "#4f8f30", fruit: "#f6d05a" },
  { leaf: "#4f9a3a", dark: "#356a2c", fruit: "#e8782a" },
];

/** 菜地一格：翻过的土垄上长着菜。 */
function crops(v: number): Sprite {
  const c = CROPS[v % 4]!;
  return sprite(16, 18, 8, 17, (ctx) => {
    px(ctx, 0, 6, "#7a4a2a", 16, 11);
    px(ctx, 0, 6, "#8f5a34", 16, 2);
    px(ctx, 0, 11, "#6a3e22", 16, 1);
    px(ctx, 0, 15, "#5e3620", 16, 2);
    for (let i = 0; i < 5; i++) px(ctx, 1 + i * 3, 8 + (i % 2) * 4, "#a06a40");
    if (v % 4 === 0) {
      // 白菜
      blob(ctx, 8, 9, 4, c.dark);
      blob(ctx, 8, 8, 3, c.leaf);
      px(ctx, 7, 7, c.fruit, 2, 2);
    } else if (v % 4 === 1) {
      // 胡萝卜缨子
      for (const x of [4, 8, 12]) {
        px(ctx, x, 11, c.fruit, 2, 1);
        px(ctx, x - 1, 5, c.leaf, 1, 6);
        px(ctx, x + 1, 4, c.dark, 1, 7);
        px(ctx, x + 2, 6, c.leaf, 1, 5);
      }
    } else if (v % 4 === 2) {
      // 玉米
      for (const x of [4, 11]) {
        px(ctx, x, 0, c.leaf, 2, 13);
        px(ctx, x - 2, 5, c.dark, 2, 1);
        px(ctx, x + 2, 7, c.dark, 2, 1);
        px(ctx, x + 2, 3, c.fruit, 2, 4);
      }
    } else {
      // 南瓜
      blob(ctx, 8, 11, 4, c.fruit, 0.75);
      px(ctx, 6, 9, "#f6a24a", 1, 4);
      px(ctx, 10, 9, "#c85a1a", 1, 4);
      px(ctx, 8, 6, c.dark, 1, 3);
      px(ctx, 9, 6, c.leaf, 3, 2);
    }
  });
}

function hay(v: number): Sprite {
  return sprite(
    20,
    18,
    10,
    16,
    (ctx) => {
      px(ctx, 1, 5, "#d8b048", 18, 11);
      px(ctx, 2, 3, "#e8c45a", 16, 3);
      px(ctx, 1, 5, "#f2d878", 18, 2);
      px(ctx, 1, 13, "#b08a30", 18, 3);
      px(ctx, 5, 3, "#8a5a2a", 1, 13);
      px(ctx, 14, 3, "#8a5a2a", 1, 13);
      for (let i = 0; i < 7; i++) px(ctx, 2 + ((i * 7 + v * 3) % 15), 7 + ((i * 3) % 6), "#b89036", 2, 1);
    },
    "#3b2410",
  );
}

function trough(): Sprite {
  return sprite(
    36,
    14,
    18,
    12,
    (ctx) => {
      px(ctx, 1, 3, "#8a5a32", 34, 8);
      px(ctx, 1, 3, "#a8733f", 34, 2);
      px(ctx, 3, 4, "#3f8bd0", 30, 3);
      px(ctx, 5, 4, "#9fd0f0", 6, 1);
      px(ctx, 2, 11, "#5e3d24", 3, 2);
      px(ctx, 31, 11, "#5e3d24", 3, 2);
      px(ctx, 1, 8, "#6a4024", 34, 1);
    },
    "#2a1a12",
  );
}

function mailbox(): Sprite {
  return sprite(
    12,
    22,
    6,
    20,
    (ctx) => {
      px(ctx, 5, 9, "#5e3d24", 2, 12);
      px(ctx, 1, 3, "#c9302a", 10, 7);
      px(ctx, 2, 2, "#e8574a", 8, 1);
      px(ctx, 1, 3, "#e8574a", 10, 1);
      px(ctx, 2, 5, "#8e2519", 1, 4);
      px(ctx, 9, 0, "#5a4632", 1, 5);
      px(ctx, 10, 0, "#f6d05a", 2, 2);
    },
    "#2a1a12",
  );
}

function woodpile(): Sprite {
  return sprite(
    20,
    16,
    10,
    14,
    (ctx) => {
      for (let r = 0; r < 3; r++)
        for (let i = 0; i < 4 - r; i++) {
          const x = 2 + i * 4 + r * 2;
          const y = 10 - r * 4;
          blob(ctx, x + 1, y + 1, 2, "#8a5a32");
          px(ctx, x, y, "#d8a868", 2, 2);
          px(ctx, x + 1, y + 1, "#b07a46");
        }
    },
    "#2a1a12",
  );
}

const SIGNS = ["镇", "场", "野"];
function signpost(v: number): Sprite {
  return sprite(
    22,
    26,
    11,
    24,
    (ctx) => {
      px(ctx, 10, 6, "#5e3d24", 2, 18);
      px(ctx, 2, 3, "#a8733f", 16, 8);
      px(ctx, 18, 4, "#a8733f", 2, 6);
      px(ctx, 20, 5, "#a8733f", 1, 4);
      px(ctx, 2, 3, "#c99a5a", 16, 1);
      px(ctx, 2, 10, "#7a4a24", 18, 1);
      ctx.drawImage(textSprite(SIGNS[v % 3]!, "#3b1c0e"), 4, 0);
    },
    "#2a1a12",
  );
}

function lily(v: number): Sprite {
  return sprite(12, 8, 6, 6, (ctx) => {
    blob(ctx, 5, 4, 3, "#4f9a3a", 0.6);
    px(ctx, 5, 3, "#3f8bd0", 2, 1);
    px(ctx, 4, 3, "#6cbf4a", 1, 1);
    if (v === 1) {
      px(ctx, 7, 2, "#f6b8c8", 2, 2);
      px(ctx, 8, 1, "#ffffff");
    }
  });
}

function mushroom(v: number): Sprite {
  const cap = v ? "#c9302a" : "#c8925a";
  return sprite(
    12,
    10,
    6,
    9,
    (ctx) => {
      px(ctx, 3, 5, "#f4ead2", 2, 4);
      px(ctx, 1, 3, cap, 6, 3);
      px(ctx, 2, 2, cap, 4, 1);
      if (v) px(ctx, 3, 3, "#ffffff", 1, 1);
      px(ctx, 8, 6, "#f4ead2", 1, 3);
      px(ctx, 7, 5, cap, 3, 2);
    },
    "#2a1a12",
  );
}

function log(): Sprite {
  return sprite(
    36,
    14,
    18,
    12,
    (ctx) => {
      px(ctx, 3, 3, "#7a4a2a", 30, 8);
      px(ctx, 3, 3, "#9a6232", 30, 2);
      px(ctx, 3, 9, "#5e3620", 30, 2);
      blob(ctx, 3, 7, 4, "#c99a62");
      blob(ctx, 3, 7, 2, "#a8733f");
      px(ctx, 14, 2, "#4f9a3a", 4, 2);
      px(ctx, 22, 1, "#5aa848", 2, 3);
      for (const x of [10, 18, 26]) px(ctx, x, 6, "#5e3620", 3, 1);
    },
    "#2a1a12",
  );
}

function tallGrass(v: number): Sprite {
  return sprite(16, 14, 8, 13, (ctx) => {
    const n = 5 + v;
    for (let i = 0; i < n; i++) {
      const x = 2 + ((i * 5 + v) % 12);
      const h = 6 + ((i * 3) % 6);
      px(ctx, x, 13 - h, i % 2 ? "#4f8f30" : "#6cbf4a", 1, h);
      px(ctx, x + 1, 13 - h + 2, "#3f7a2a", 1, h - 2);
    }
  });
}

function flowerPatch(v: number): Sprite {
  const c = FLOWERS[v % FLOWERS.length] as string;
  return sprite(16, 12, 8, 10, (ctx) => {
    for (const [x, y] of [
      [3, 6],
      [8, 4],
      [12, 7],
      [6, 9],
      [10, 10],
    ] as const) {
      px(ctx, x, y + 1, "#4f8f30", 1, 2);
      px(ctx, x - 1, y, c);
      px(ctx, x + 1, y, c);
      px(ctx, x, y - 1, c);
      px(ctx, x, y, "#f2a93b");
    }
  });
}

function cart(): Sprite {
  return sprite(
    40,
    24,
    20,
    22,
    (ctx) => {
      px(ctx, 4, 6, "#a8733f", 26, 9);
      px(ctx, 4, 6, "#c99a5a", 26, 2);
      for (const x of [10, 17, 24]) px(ctx, x, 8, "#7a4a24", 1, 7);
      px(ctx, 30, 11, "#7a4a24", 9, 2);
      blob(ctx, 10, 17, 4, "#5e3d24");
      blob(ctx, 10, 17, 2, "#a8733f");
      blob(ctx, 24, 17, 4, "#5e3d24");
      blob(ctx, 24, 17, 2, "#a8733f");
      blob(ctx, 14, 5, 4, "#e8c45a", 0.6);
      blob(ctx, 21, 5, 3, "#d8b048", 0.6);
    },
    "#2a1a12",
  );
}

/** 铜马像：石座上一匹扬蹄的马。 */
function statue(): Sprite {
  return sprite(
    40,
    52,
    20,
    50,
    (ctx) => {
      // 石座
      px(ctx, 6, 34, "#9a9284", 28, 15);
      px(ctx, 6, 34, "#c6bdad", 28, 3);
      px(ctx, 4, 45, "#8a8274", 32, 4);
      px(ctx, 4, 45, "#b0a898", 32, 1);
      px(ctx, 12, 39, "#7a7264", 16, 4);
      px(ctx, 13, 40, "#f2c14e", 14, 2);
      // 马：身子、后腿站立、前腿扬起、脖子和头、尾巴
      const c = "#6a8a6a";
      const d = "#4a6a52";
      const l = "#8fb08a";
      px(ctx, 12, 18, c, 15, 8);
      px(ctx, 12, 18, l, 15, 2);
      px(ctx, 13, 26, d, 3, 8);
      px(ctx, 22, 26, d, 3, 8);
      px(ctx, 25, 12, c, 4, 8);
      px(ctx, 27, 8, c, 6, 5);
      px(ctx, 32, 9, d, 2, 3);
      px(ctx, 28, 6, d, 2, 2);
      px(ctx, 24, 9, d, 2, 9);
      px(ctx, 28, 20, c, 6, 3);
      px(ctx, 32, 16, c, 3, 5);
      px(ctx, 27, 23, d, 3, 5);
      px(ctx, 7, 18, d, 5, 2);
      px(ctx, 5, 20, d, 3, 7);
      px(ctx, 30, 10, "#2a1a12");
    },
    "#24150c",
  );
}

function bench(): Sprite {
  return sprite(
    34,
    16,
    17,
    14,
    (ctx) => {
      px(ctx, 2, 2, "#8a5a32", 30, 3);
      px(ctx, 2, 2, "#b07a46", 30, 1);
      px(ctx, 2, 7, "#a8733f", 30, 4);
      px(ctx, 2, 7, "#c99a5a", 30, 1);
      px(ctx, 4, 5, "#5e3d24", 2, 9);
      px(ctx, 28, 5, "#5e3d24", 2, 9);
    },
    "#2a1a12",
  );
}

const propCache = new Map<string, Sprite>();

export function propSprite(p: Prop): Sprite {
  const key = `${p.kind}:${p.v}`;
  let s = propCache.get(key);
  if (!s) {
    switch (p.kind) {
      case "pine":
        s = pine(p.v);
        break;
      case "oak":
        s = oak(p.v);
        break;
      case "bush":
        s = bush(p.v);
        break;
      case "rock":
        s = rock(p.v);
        break;
      case "stump":
        s = stump();
        break;
      case "reeds":
        s = reeds(p.v);
        break;
      case "lantern":
        s = lantern();
        break;
      case "sunflower":
        s = sunflower(p.v);
        break;
      case "flag":
        s = flag(p.v);
        break;
      case "board":
        s = noticeBoard();
        break;
      case "planter":
        s = planter(p.v);
        break;
      case "barrel":
        s = barrel();
        break;
      case "crate":
        s = crate();
        break;
      case "well":
        s = well();
        break;
      case "stall":
        s = stall(p.v);
        break;
      case "crops":
        s = crops(p.v);
        break;
      case "hay":
        s = hay(p.v);
        break;
      case "trough":
        s = trough();
        break;
      case "mailbox":
        s = mailbox();
        break;
      case "woodpile":
        s = woodpile();
        break;
      case "signpost":
        s = signpost(p.v);
        break;
      case "lily":
        s = lily(p.v);
        break;
      case "mushroom":
        s = mushroom(p.v);
        break;
      case "log":
        s = log();
        break;
      case "grass":
        s = tallGrass(p.v);
        break;
      case "flowers":
        s = flowerPatch(p.v);
        break;
      case "cart":
        s = cart();
        break;
      case "statue":
        s = statue();
        break;
      case "bench":
        s = bench();
        break;
    }
    propCache.set(key, s);
  }
  return s;
}

/* ---------------- 房子 ---------------- */

interface Style {
  wall: string;
  wallDark: string;
  wallLight: string;
  roof: string;
  roofDark: string;
  roofLight: string;
  trim: string;
  door: string;
}

const STYLES: Record<string, Style> = {
  home: { wall: "#f0e2c4", wallDark: "#cdb894", wallLight: "#fbf3df", roof: "#b6452f", roofDark: "#7e2b1d", roofLight: "#d8674a", trim: "#8a3a22", door: "#7a4a26" },
  barn: { wall: "#b84a35", wallDark: "#8a3324", wallLight: "#d0634a", roof: "#6e5a48", roofDark: "#4a3a2e", roofLight: "#8e7864", trim: "#f0e2c4", door: "#f0e2c4" },
  bookie: { wall: "#c53a2c", wallDark: "#8e2519", wallLight: "#e0584a", roof: "#3c4a5e", roofDark: "#26303e", roofLight: "#56677e", trim: "#f2c14e", door: "#5a2a18" },
  seq: { wall: "#e9e4d6", wallDark: "#c4bca8", wallLight: "#f8f5ec", roof: "#3f6f7a", roofDark: "#28494f", roofLight: "#5c919c", trim: "#7a2a22", door: "#3f4a52" },
  market: { wall: "#e7d3a8", wallDark: "#c2a978", wallLight: "#f6e8c6", roof: "#8a4a2c", roofDark: "#5e2f1a", roofLight: "#ad6a44", trim: "#7a2a22", door: "#6a4022" },
  zhao: { wall: "#d8c4a0", wallDark: "#b29c76", wallLight: "#ebdcbc", roof: "#4b4f58", roofDark: "#2f323a", roofLight: "#686d78", trim: "#7a2a22", door: "#5a3a22" },
  booth: { wall: "#e7d3a8", wallDark: "#c2a978", wallLight: "#f6e8c6", roof: "#2f7a52", roofDark: "#1e5236", roofLight: "#45a06e", trim: "#c9302a", door: "#6a4022" },
};

/** 屋顶高度（格）。 */
const ROOF_TILES: Record<string, number> = { home: 3, barn: 3.4, bookie: 2.6, seq: 2.8, market: 2.6, zhao: 2.8, booth: 1.6, stand: 0 };
const WALL_PX = 34;

function signPlaque(ctx: Ctx, cx: number, y: number, text: string): void {
  const t = textSprite(text, "#f6cf5a");
  const w = Math.max(18, t.width + 4);
  const x = Math.round(cx - w / 2);
  px(ctx, x - 1, y - 1, "#24150c", w + 2, 16);
  px(ctx, x, y, "#3a2414", w, 14);
  px(ctx, x, y, "#5a3a22", w, 1);
  ctx.drawImage(t, Math.round(cx - t.width / 2), y - 1);
}

function window(ctx: Ctx, x: number, y: number, w: number, h: number, S: Style): void {
  px(ctx, x - 1, y - 1, S.trim, w + 2, h + 2);
  px(ctx, x, y, "#2c3a4a", w, h);
  px(ctx, x, y, "#4a6a84", w, 2);
  for (let i = 2; i < w; i += 3) px(ctx, x + i, y, S.trim, 1, h);
  px(ctx, x, y + Math.floor(h / 2), S.trim, w, 1);
}

/** 一栋房子：墙在下，屋顶在上，角上翘起来。门、窗户、匾额。 */
function drawHouse(ctx: Ctx, b: Building, ox: number, oy: number): { lights: Array<[number, number]> } {
  const S = STYLES[b.kind]!;
  const W = b.w * TILE;
  const wallTop = oy - WALL_PX;
  const lights: Array<[number, number]> = [];
  // 墙
  px(ctx, ox, wallTop, S.wall, W, WALL_PX);
  px(ctx, ox, wallTop, S.wallDark, W, 3);
  px(ctx, ox, oy - 3, S.wallDark, W, 3);
  px(ctx, ox + 2, wallTop + 4, S.wallLight, W - 4, 1);
  // 木柱
  for (const x of [ox, ox + W - 4]) {
    px(ctx, x, wallTop, S.trim, 4, WALL_PX);
    px(ctx, x + 1, wallTop, "rgba(255,255,255,0.18)", 1, WALL_PX);
  }
  if (b.kind === "barn") {
    // 谷仓大门：白框打叉。
    const dw = 26;
    const dx = ox + W / 2 - dw / 2;
    px(ctx, dx, oy - 26, "#f0e2c4", dw, 26);
    px(ctx, dx + 2, oy - 24, "#8a3324", dw - 4, 24);
    ctx.strokeStyle = "#f0e2c4";
    for (let i = 0; i < 22; i++) {
      px(ctx, dx + 2 + i, oy - 24 + i, "#f0e2c4", 1, 1);
      px(ctx, dx + dw - 3 - i, oy - 24 + i, "#f0e2c4", 1, 1);
    }
    px(ctx, dx + dw / 2 - 1, oy - 26, "#f0e2c4", 2, 26);
    window(ctx, ox + 10, wallTop + 9, 10, 9, S);
    window(ctx, ox + W - 20, wallTop + 9, 10, 9, S);
    lights.push([ox + 15, wallTop + 13], [ox + W - 15, wallTop + 13]);
  } else {
    const dw = b.kind === "booth" ? 0 : 12;
    if (dw) {
      const dx = Math.round(ox + W / 2 - dw / 2);
      px(ctx, dx - 2, oy - 22, S.trim, dw + 4, 22);
      px(ctx, dx, oy - 20, S.door, dw, 20);
      px(ctx, dx + dw / 2, oy - 20, "rgba(0,0,0,0.35)", 1, 20);
      px(ctx, dx + 2, oy - 11, "#f2c14e");
      px(ctx, dx + dw - 3, oy - 11, "#f2c14e");
      lights.push([dx + dw / 2, oy - 12]);
    } else {
      // 小摊：台面和后面的货架。
      px(ctx, ox + 4, oy - 16, "#8a5a32", W - 8, 4);
      px(ctx, ox + 4, oy - 16, "#a8733f", W - 8, 1);
      px(ctx, ox + 8, oy - 28, "#f4ead2", 8, 9);
      px(ctx, ox + W - 18, oy - 26, "#f4ead2", 10, 7);
    }
    const n = Math.max(1, Math.floor((W - 30) / 26));
    for (let i = 0; i < n && b.kind !== "booth"; i++) {
      const x = ox + 8 + i * 13;
      window(ctx, x, wallTop + 9, 10, 10, S);
      window(ctx, ox + W - 18 - i * 13, wallTop + 9, 10, 10, S);
      lights.push([x + 5, wallTop + 14], [ox + W - 13 - i * 13, wallTop + 14]);
    }
  }
  // 屋顶：一行行瓦片，两头上翘。
  const roofH = Math.round(ROOF_TILES[b.kind]! * TILE);
  const top = wallTop - roofH;
  const over = b.kind === "booth" ? 3 : 6;
  for (let r = 0; r < roofH; r++) {
    const t = r / roofH;
    const inset = Math.round((1 - t) * (b.kind === "barn" ? W * 0.18 : W * 0.08));
    const x0 = ox - over + inset;
    const w = W + over * 2 - inset * 2;
    const band = Math.floor(r / 4) % 2;
    const c = b.kind === "booth" ? (Math.floor((r * 3) / roofH) % 2 ? S.roof : "#f4ead2") : band ? S.roof : S.roofLight;
    px(ctx, x0, top + r, c, w, 1);
    if (b.kind !== "booth" && r % 4 === 3) px(ctx, x0, top + r, S.roofDark, w, 1);
    if (b.kind !== "booth") for (let x = x0 + ((r >> 2) % 2) * 3; x < x0 + w; x += 6) px(ctx, x, top + r, S.roofDark);
  }
  // 屋脊和翘角。
  if (b.kind !== "booth") {
    const ridgeInset = Math.round(b.kind === "barn" ? W * 0.18 : W * 0.08);
    px(ctx, ox - over + ridgeInset - 3, top - 3, S.roofDark, W + over * 2 - ridgeInset * 2 + 6, 4);
    px(ctx, ox - over + ridgeInset - 3, top - 3, S.roofLight, W + over * 2 - ridgeInset * 2 + 6, 1);
    for (const [x, d] of [
      [ox - over + ridgeInset - 5, -1],
      [ox + W + over - ridgeInset + 3, 1],
    ] as const) {
      px(ctx, x, top - 5, S.roofDark, 3, 3);
      px(ctx, x + d * 2, top - 7, S.roofDark, 2, 2);
    }
    for (const [x, d] of [
      [ox - over - 2, -1],
      [ox + W + over, 1],
    ] as const) {
      px(ctx, x, wallTop - 3, S.roofDark, 3, 3);
      px(ctx, x + d * 2, wallTop - 6, S.roofDark, 2, 3);
    }
  }
  px(ctx, ox - over, wallTop - 1, S.roofDark, W + over * 2, 2);
  px(ctx, ox, wallTop + 1, "rgba(0,0,0,0.25)", W, 3);
  if (b.sign) signPlaque(ctx, ox + W / 2, b.kind === "booth" ? top + 4 : wallTop - 13, b.sign);
  return { lights };
}

function drawStand(ctx: Ctx, b: Building, ox: number, oy: number): void {
  const W = b.w * TILE;
  const rows = 4;
  const rng = createRng(7);
  for (let r = 0; r < rows; r++) {
    const y = oy - 10 - r * 9;
    px(ctx, ox + r * 3, y, "#8a5a32", W - r * 6, 9);
    px(ctx, ox + r * 3, y, "#b07a46", W - r * 6, 2);
    for (let x = ox + r * 3 + 3; x < ox + W - r * 3 - 3; x += 4) {
      if (rng.next() < 0.25) continue;
      const shirt = ["#d8443a", "#3f7fd0", "#f2b632", "#4fa64a", "#f4ead2", "#8a4ab0"][rng.int(0, 5)] as string;
      px(ctx, x, y - 3, shirt, 3, 3);
      px(ctx, x, y - 5, "#e8b48a", 3, 2);
      px(ctx, x, y - 6, "#3a2414", 3, 1);
    }
  }
  px(ctx, ox, oy - 4, "#5a3a22", W, 4);
  // 横幅
  px(ctx, ox + W / 2 - 32, oy - 55, "#c9302a", 64, 14);
  px(ctx, ox + W / 2 - 32, oy - 55, "#e8574a", 64, 1);
  const t = textSprite("马蹄镇赛马", "#f6cf5a");
  ctx.drawImage(t, Math.round(ox + W / 2 - t.width / 2), oy - 56);
  for (const x of [ox + 2, ox + W - 4]) px(ctx, x, oy - 58, "#5a4632", 2, 58);
}

export interface BuildingSprite extends Sprite {
  lights: Array<[number, number]>;
}

const buildingCache = new Map<string, BuildingSprite>();

/** 房子的贴图，锚点在占地的左下角。 */
/** 屋脊的高度（缓冲坐标，相对地图），烟囱和炊烟用。 */
export function roofTop(b: Building): number {
  return (b.z + b.d) * TILE - WALL_PX - Math.round((ROOF_TILES[b.kind] ?? 0) * TILE);
}

export function buildingSprite(b: Building): BuildingSprite {
  let s = buildingCache.get(b.id);
  if (s) return s;
  const W = b.w * TILE + 20;
  const roof = Math.round((ROOF_TILES[b.kind] ?? 0) * TILE);
  const H = b.d * TILE + roof + WALL_PX + 20;
  const [c, ctx] = canvas(W, H);
  const ox = 10;
  const oy = H - 4;
  let lights: Array<[number, number]> = [];
  if (b.kind === "stand") drawStand(ctx, b, ox, oy);
  else lights = drawHouse(ctx, b, ox, oy).lights;
  s = { img: c, ax: ox, ay: oy, lights: lights.map(([x, y]) => [x - ox, y - oy]) };
  buildingCache.set(b.id, s);
  return s;
}

export const ALL_BUILDINGS = BUILDINGS;

/* ---------------- 人物 ---------------- */

export interface PersonLook {
  hat: "straw" | "none" | "cap" | "bun";
  hair: string;
  skin: string;
  shirt: string;
  shirtDark: string;
  pants: string;
  beard?: boolean;
  wide?: boolean;
}

export const PLAYER_LOOK: PersonLook = { hat: "straw", hair: "#3a2414", skin: "#f0c49a", shirt: "#3f6fb0", shirtDark: "#2c4f82", pants: "#4a3a2e" };

export type Dir = "down" | "up" | "left" | "right";

const personCache = new Map<string, HTMLCanvasElement>();

/** 人物一帧：16×26，四个方向各四帧走路。 */
export function personFrame(look: PersonLook, dir: Dir, frame: number): HTMLCanvasElement {
  const key = `${JSON.stringify(look)}:${dir}:${frame}`;
  const hit = personCache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(18, 28);
  const ox = 1;
  const oy = 1;
  const step = frame % 4 === 1 ? 1 : frame % 4 === 3 ? -1 : 0;
  const bob = frame % 2 ? 1 : 0;
  const side = dir === "left" || dir === "right";
  const bw = look.wide ? 12 : 10;
  const bx = ox + 8 - bw / 2;
  // 腿
  if (side) {
    px(ctx, ox + 6 + step, oy + 20, look.pants, 2, 5);
    px(ctx, ox + 8 - step, oy + 20, look.pants, 2, 5);
    px(ctx, ox + 6 + step, oy + 24, "#2a1a12", 3, 1);
    px(ctx, ox + 8 - step, oy + 24, "#2a1a12", 3, 1);
  } else {
    px(ctx, ox + 5, oy + 20, look.pants, 2, 5 - (step > 0 ? 1 : 0));
    px(ctx, ox + 9, oy + 20, look.pants, 2, 5 - (step < 0 ? 1 : 0));
    px(ctx, ox + 5, oy + 24 - (step > 0 ? 1 : 0), "#2a1a12", 2, 1);
    px(ctx, ox + 9, oy + 24 - (step < 0 ? 1 : 0), "#2a1a12", 2, 1);
  }
  const y0 = oy + bob;
  // 身子
  px(ctx, bx, y0 + 12, look.shirt, bw, 9);
  px(ctx, bx, y0 + 18, look.shirtDark, bw, 1);
  px(ctx, bx, y0 + 12, look.shirtDark, 1, 9);
  if (!side) {
    px(ctx, bx - 2, y0 + 13 + (step > 0 ? 1 : 0), look.shirt, 2, 6);
    px(ctx, bx + bw, y0 + 13 + (step < 0 ? 1 : 0), look.shirt, 2, 6);
    px(ctx, bx - 2, y0 + 19 + (step > 0 ? 1 : 0), look.skin, 2, 1);
    px(ctx, bx + bw, y0 + 19 + (step < 0 ? 1 : 0), look.skin, 2, 1);
    if (dir === "down") px(ctx, ox + 7, y0 + 12, look.shirtDark, 2, 6);
  } else {
    const fx = dir === "right" ? 1 : -1;
    px(ctx, ox + 7 + step * fx, y0 + 13, look.shirtDark, 2, 6);
    px(ctx, ox + 7 + step * fx, y0 + 19, look.skin, 2, 1);
  }
  // 头
  px(ctx, ox + 4, y0 + 4, look.skin, 8, 8);
  if (dir === "up") px(ctx, ox + 4, y0 + 4, look.hair, 8, 8);
  else {
    px(ctx, ox + 4, y0 + 4, look.hair, 8, 2);
    if (dir === "down") {
      px(ctx, ox + 6, y0 + 8, "#2a1a12", 1, 2);
      px(ctx, ox + 9, y0 + 8, "#2a1a12", 1, 2);
      px(ctx, ox + 5, y0 + 10, "#e89a86");
      px(ctx, ox + 10, y0 + 10, "#e89a86");
    } else {
      const ex = dir === "right" ? ox + 10 : ox + 5;
      px(ctx, ex, y0 + 8, "#2a1a12", 1, 2);
      px(ctx, dir === "right" ? ox + 4 : ox + 9, y0 + 4, look.hair, 3, 6);
    }
    if (look.beard) px(ctx, ox + 4, y0 + 10, "#e8e2d6", 8, 3);
  }
  // 帽子
  if (look.hat === "straw") {
    px(ctx, ox + 0, y0 + 4, "#c99a4a", 16, 2);
    px(ctx, ox + 2, y0 + 2, "#ddb562", 12, 2);
    px(ctx, ox + 5, y0 + 0, "#e8c676", 6, 2);
    px(ctx, ox + 7, y0 - 1, "#e8c676", 2, 1);
    px(ctx, ox + 0, y0 + 5, "#a87c36", 16, 1);
  } else if (look.hat === "cap") {
    px(ctx, ox + 4, y0 + 2, look.shirtDark, 8, 3);
    px(ctx, dir === "left" ? ox + 2 : ox + 10, y0 + 4, look.shirtDark, 4, 1);
  } else if (look.hat === "bun") {
    px(ctx, ox + 4, y0 + 3, look.hair, 8, 2);
    px(ctx, ox + 6, y0 + 0, look.hair, 4, 3);
  } else {
    px(ctx, ox + 4, y0 + 3, look.hair === "#e8e2d6" ? "#f0c49a" : look.hair, 8, 2);
  }
  outline(c, "#2a1a12");
  personCache.set(key, c);
  return c;
}

/* ---------------- 头像 ---------------- */

/** 对话框里的大头像（48×48），画好转成图片地址给界面用。 */
export function portraitURL(who: "laozhao" | "madong"): string {
  const [c, ctx] = canvas(48, 48);
  px(ctx, 0, 0, who === "laozhao" ? "#e9c88c" : "#b9c4d6", 48, 48);
  for (let y = 0; y < 48; y += 4) px(ctx, 0, y, "rgba(0,0,0,0.05)", 48, 2);
  if (who === "laozhao") {
    px(ctx, 8, 34, "#6b3b2a", 32, 14);
    px(ctx, 8, 34, "#87503a", 32, 2);
    px(ctx, 21, 34, "#f2c14e", 6, 14);
    blob(ctx, 24, 20, 12, "#d9a070");
    px(ctx, 14, 18, "#2a1a12", 4, 2);
    px(ctx, 30, 18, "#2a1a12", 4, 2);
    px(ctx, 13, 15, "#7a6a5a", 6, 1);
    px(ctx, 29, 15, "#7a6a5a", 6, 1);
    px(ctx, 22, 21, "#c08050", 4, 4);
    blob(ctx, 24, 31, 9, "#eeeae0");
    px(ctx, 19, 26, "#c9302a", 10, 2);
    px(ctx, 12, 8, "#f0bc8a", 24, 3);
    px(ctx, 11, 22, "#c08050", 2, 4);
    px(ctx, 35, 22, "#c08050", 2, 4);
  } else {
    px(ctx, 6, 34, "#2c2c3a", 36, 14);
    px(ctx, 20, 34, "#f4f0e6", 8, 14);
    px(ctx, 23, 34, "#c9302a", 2, 14);
    px(ctx, 16, 40, "#f2c14e", 16, 1);
    blob(ctx, 24, 21, 11, "#f0c49a");
    px(ctx, 13, 8, "#1e1a18", 22, 6);
    px(ctx, 12, 12, "#1e1a18", 4, 8);
    px(ctx, 32, 12, "#1e1a18", 4, 8);
    px(ctx, 14, 18, "#1e1a18", 9, 4);
    px(ctx, 25, 18, "#1e1a18", 9, 4);
    px(ctx, 23, 19, "#1e1a18", 2, 1);
    px(ctx, 15, 18, "#5a6a8a", 3, 1);
    px(ctx, 26, 18, "#5a6a8a", 3, 1);
    px(ctx, 19, 27, "#8a4a3a", 10, 1);
    px(ctx, 28, 26, "#8a4a3a");
  }
  outline(c, "#2a1a12");
  return c.toDataURL();
}

/* ---------------- 图标 ---------------- */

export type IconId =
  | "rope"
  | "horse"
  | "bag"
  | "coin"
  | "sun"
  | "moon"
  | "flag"
  | "ring"
  | "crown"
  | "star"
  | "close"
  | "heart"
  | "dna"
  | "scroll"
  | "shoe"
  | "menu"
  | "ticket"
  | "tag";

function iconDraw(id: IconId, ctx: Ctx): void {
  switch (id) {
    case "rope":
      for (let a = 0; a < 40; a++) {
        const t = (a / 40) * Math.PI * 2;
        px(ctx, 8 + Math.cos(t) * 5, 6 + Math.sin(t) * 3.5, "#d9b06a");
        px(ctx, 8 + Math.cos(t) * 3, 6 + Math.sin(t) * 2, "#b88a48");
      }
      px(ctx, 11, 9, "#d9b06a", 1, 2);
      px(ctx, 12, 11, "#d9b06a", 1, 2);
      px(ctx, 11, 13, "#d9b06a", 1, 2);
      break;
    case "horse":
      px(ctx, 5, 9, "#9a5a2c", 5, 6);
      px(ctx, 6, 4, "#9a5a2c", 5, 6);
      px(ctx, 9, 3, "#9a5a2c", 4, 4);
      px(ctx, 11, 5, "#9a5a2c", 3, 3);
      px(ctx, 6, 3, "#3a2414", 2, 7);
      px(ctx, 9, 1, "#9a5a2c", 1, 2);
      px(ctx, 11, 4, "#2a1a12");
      px(ctx, 13, 7, "#2a1a12");
      break;
    case "bag":
      px(ctx, 4, 6, "#a8733f", 9, 8);
      px(ctx, 5, 4, "#8a5a32", 7, 2);
      px(ctx, 6, 2, "#8a5a32", 1, 2);
      px(ctx, 10, 2, "#8a5a32", 1, 2);
      px(ctx, 4, 9, "#7a4a26", 9, 1);
      px(ctx, 8, 8, "#f2c14e", 1, 3);
      break;
    case "coin":
      blob(ctx, 8, 8, 6, "#e0a830");
      blob(ctx, 7, 7, 5, "#f6d05a");
      px(ctx, 7, 7, "#8a5a14", 3, 3);
      break;
    case "sun":
      blob(ctx, 8, 8, 4, "#f6c84a");
      for (const [x, y] of [[8, 1], [8, 14], [1, 8], [14, 8], [3, 3], [13, 3], [3, 13], [13, 13]] as const) px(ctx, x, y, "#f2a93b", 1, 1);
      px(ctx, 6, 6, "#fff2b0", 2, 2);
      break;
    case "moon":
      blob(ctx, 8, 8, 6, "#f4ecc8");
      blob(ctx, 11, 6, 5, "rgba(0,0,0,0)");
      ctx.clearRect(9, 1, 7, 9);
      ctx.clearRect(11, 9, 5, 2);
      break;
    case "flag":
      px(ctx, 3, 2, "#5a4632", 2, 13);
      px(ctx, 5, 2, "#d8443a", 8, 6);
      px(ctx, 5, 8, "#d8443a", 5, 1);
      px(ctx, 6, 3, "#f4ead2", 2, 2);
      px(ctx, 10, 5, "#f4ead2", 2, 2);
      break;
    case "ring":
      blob(ctx, 8, 9, 6, "#c9a464", 0.7);
      blob(ctx, 8, 9, 5, "#ead190", 0.7);
      for (let a = 0; a < 30; a++) {
        const t = (a / 30) * Math.PI * 2;
        px(ctx, 8 + Math.cos(t) * 4, 9 + Math.sin(t) * 2.8, "#f4f0e6");
      }
      break;
    case "crown":
      px(ctx, 2, 7, "#f2c14e", 12, 6);
      px(ctx, 2, 4, "#f2c14e", 2, 3);
      px(ctx, 7, 2, "#f2c14e", 2, 5);
      px(ctx, 12, 4, "#f2c14e", 2, 3);
      px(ctx, 7, 9, "#c9302a", 2, 2);
      px(ctx, 2, 12, "#c99a2a", 12, 1);
      break;
    case "star":
      px(ctx, 7, 2, "#f6d05a", 2, 12);
      px(ctx, 2, 6, "#f6d05a", 12, 2);
      px(ctx, 4, 4, "#f6d05a", 8, 6);
      px(ctx, 3, 11, "#f6d05a", 3, 3);
      px(ctx, 10, 11, "#f6d05a", 3, 3);
      px(ctx, 6, 5, "#fff2b0", 2, 2);
      break;
    case "close":
      px(ctx, 1, 1, "#c9302a", 14, 14);
      px(ctx, 1, 1, "#e8574a", 14, 2);
      for (let i = 0; i < 8; i++) {
        px(ctx, 4 + i, 4 + i, "#fbefd4", 1, 1);
        px(ctx, 5 + i, 4 + i, "#fbefd4", 1, 1);
        px(ctx, 11 - i, 4 + i, "#fbefd4", 1, 1);
        px(ctx, 12 - i, 4 + i, "#fbefd4", 1, 1);
      }
      break;
    case "heart":
      px(ctx, 3, 4, "#e8434a", 4, 4);
      px(ctx, 9, 4, "#e8434a", 4, 4);
      px(ctx, 2, 5, "#e8434a", 12, 4);
      px(ctx, 3, 9, "#e8434a", 10, 2);
      px(ctx, 5, 11, "#e8434a", 6, 2);
      px(ctx, 7, 13, "#e8434a", 2, 1);
      px(ctx, 4, 5, "#ff9a9a", 2, 2);
      break;
    case "dna":
      for (let y = 1; y < 15; y++) {
        const s = Math.sin(y * 0.7) * 4;
        px(ctx, 8 + s, y, "#5aa0e0");
        px(ctx, 8 - s, y, "#e8574a");
        if (y % 3 === 0) px(ctx, 8 - Math.abs(s), y, "#c9c4b8", Math.max(1, Math.abs(s) * 2), 1);
      }
      break;
    case "shoe":
      px(ctx, 3, 3, "#a8a8b0", 3, 10);
      px(ctx, 10, 3, "#a8a8b0", 3, 10);
      px(ctx, 4, 2, "#a8a8b0", 8, 3);
      px(ctx, 6, 5, "rgba(0,0,0,0)", 4, 1);
      ctx.clearRect(6, 5, 4, 8);
      px(ctx, 4, 3, "#e4e4ea", 2, 2);
      for (const y of [6, 9]) {
        px(ctx, 4, y, "#5a5a64");
        px(ctx, 11, y, "#5a5a64");
      }
      break;
    case "menu":
      for (const y of [3, 7, 11]) {
        px(ctx, 3, y, "#fbefd4", 10, 2);
        px(ctx, 3, y + 2, "#c9a46a", 10, 1);
      }
      break;
    case "ticket":
      px(ctx, 2, 4, "#f4ead2", 12, 8);
      px(ctx, 2, 4, "#c9302a", 3, 8);
      px(ctx, 7, 6, "#9a8a70", 5, 1);
      px(ctx, 7, 9, "#9a8a70", 4, 1);
      ctx.clearRect(2, 7, 1, 2);
      ctx.clearRect(13, 7, 1, 2);
      break;
    case "tag":
      px(ctx, 3, 3, "#f2c14e", 9, 9);
      px(ctx, 4, 2, "#f2c14e", 7, 11);
      px(ctx, 6, 5, "#8a5a14", 3, 3);
      break;
    case "scroll":
      px(ctx, 3, 3, "#f4ead2", 10, 10);
      px(ctx, 2, 2, "#a8733f", 12, 2);
      px(ctx, 2, 12, "#a8733f", 12, 2);
      px(ctx, 5, 6, "#9a8a70", 6, 1);
      px(ctx, 5, 8, "#9a8a70", 5, 1);
      px(ctx, 5, 10, "#9a8a70", 6, 1);
      break;
  }
}

const iconCache = new Map<IconId, HTMLCanvasElement>();

export function icon(id: IconId): HTMLCanvasElement {
  let c = iconCache.get(id);
  if (!c) {
    const [cv, ctx] = canvas(16, 16);
    iconDraw(id, ctx);
    if (id !== "close" && id !== "menu") outline(cv, "#2a1a12", 60);
    c = cv;
    iconCache.set(id, c);
  }
  return c;
}

const iconURLs = new Map<IconId, string>();

export function iconURL(id: IconId): string {
  let u = iconURLs.get(id);
  if (!u) {
    u = icon(id).toDataURL();
    iconURLs.set(id, u);
  }
  return u;
}
