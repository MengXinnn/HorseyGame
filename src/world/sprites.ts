/**
 * 像素美术：地面、人物、头像、图标都在这里用代码一个像素一个像素画出来，
 * 画一次缓存成小画布，之后每帧只是贴图。摆设在 props.ts，房子在 buildingArt.ts。
 */
import { createRng, hashSeed, type Rng } from "../sim/rng";
import { bayer, Raster } from "./raster";
import { GROUND, MAP_H, MAP_W, RING, T, TILE, TRACK, type TileKind } from "./tiles";

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

export const px = (ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1): void => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

export function blob(ctx: Ctx, cx: number, cy: number, r: number, color: string, squash = 1): void {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (x * x + (y * y) / (squash * squash) <= r * r + r * 0.6) px(ctx, cx + x, cy + y, color);
}

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

/**
 * 每种地面：base/dark/light 是点缀用的颜色，field 是大片起伏的三个深浅
 * （按低频噪声 + Bayer 抖动铺开，地面不再是一整块平涂）。
 */
const GROUND_COLORS: Record<number, { base: string; dark: string; light: string; field: [string, string, string] }> = {
  [T.grass]: { base: "#68ac3e", dark: "#4f8f30", light: "#84c650", field: ["#5f9f39", "#68ac3e", "#72b743"] },
  [T.meadow]: { base: "#7bb846", dark: "#5f9b36", light: "#9bd15e", field: ["#70ab40", "#7bb846", "#87c34e"] },
  [T.paddock]: { base: "#71b041", dark: "#559333", light: "#8cc955", field: ["#67a33b", "#71b041", "#7bba48"] },
  [T.infield]: { base: "#5fa43b", dark: "#4b8b2f", light: "#78bd4b", field: ["#579a37", "#5fa43b", "#68ad40"] },
  [T.path]: { base: "#d8a764", dark: "#bf8a4a", light: "#e9c286", field: ["#cf9d5c", "#d8a764", "#dfb06e"] },
  [T.plaza]: { base: "#bdb3a2", dark: "#9a907f", light: "#d6cdbd", field: ["#bdb3a2", "#bdb3a2", "#bdb3a2"] },
  [T.sand]: { base: "#ead190", dark: "#d2b672", light: "#f6e4ae", field: ["#e2c886", "#ead190", "#f0d99a"] },
  [T.track]: { base: "#c98a56", dark: "#ad7043", light: "#dca372", field: ["#c0814e", "#c98a56", "#d1935e"] },
  [T.water]: { base: "#3f8bd0", dark: "#2f6fae", light: "#6fb3ea", field: ["#3f8bd0", "#3f8bd0", "#3f8bd0"] },
  [T.bridge]: { base: "#a8723c", dark: "#7c5028", light: "#c48c52", field: ["#a8723c", "#a8723c", "#a8723c"] },
  [T.soil]: { base: "#7a4a2c", dark: "#5e3620", light: "#94603a", field: ["#704428", "#7a4a2c", "#835030"] },
  [T.court]: { base: "#c2c4be", dark: "#a8aaa4", light: "#d6d8d2", field: ["#bcbeb8", "#c2c4be", "#c8cac4"] },
  [T.clay]: { base: "#bc8252", dark: "#9a643a", light: "#d49a68", field: ["#b47a4a", "#bc8252", "#c48a5a"] },
};

/** 水从岸边往中间越来越深。 */
const WATER_DEPTH = ["#5aa6e0", "#4596d8", "#3a84c8", "#3070b4", "#2a62a4"];

const kindAt = (x: number, z: number): number => {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return T.grass;
  return GROUND[z * MAP_W + x] as number;
};

/** 平滑的值噪声：格点上随机，中间 smoothstep 插值。 */
function valueNoise(seed: number, cell: number, w: number, h: number): (x: number, y: number) => number {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const rng = createRng(seed);
  const v = new Float32Array(gw * gh);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    let fx = gx - ix;
    let fy = gy - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = v[iy * gw + ix]!;
    const b = v[iy * gw + ix + 1]!;
    const c = v[(iy + 1) * gw + ix]!;
    const d = v[(iy + 1) * gw + ix + 1]!;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** 每格水离岸多远（格），岸边是 1。 */
function waterDepth(): Float32Array {
  const d = new Float32Array(MAP_W * MAP_H);
  const q: number[] = [];
  for (let i = 0; i < d.length; i++) {
    if (GROUND[i] === T.water) d[i] = Infinity;
    else q.push(i);
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const x = i % MAP_W;
    const z = (i - x) / MAP_W;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
      const j = nz * MAP_W + nx;
      if (d[j]! > d[i]! + 1) {
        d[j] = d[i]! + 1;
        q.push(j);
      }
    }
  }
  return d;
}

/** 底色：整张地图逐像素铺，草地有大片的深浅起伏，水按深浅分层，全用抖动过渡。 */
function baseLayer(): HTMLCanvasElement {
  const W = MAP_W * TILE;
  const H = MAP_H * TILE;
  const r = new Raster(W, H);
  const n1 = valueNoise(hashSeed("草地起伏"), 56, W, H);
  const n2 = valueNoise(hashSeed("草地细纹"), 14, W, H);
  const depth = waterDepth();
  const fields = new Map<number, [number, number, number]>();
  const packed = (hex: string): number => {
    const s = hex.slice(1);
    return ((255 << 24) | (parseInt(s.slice(4, 6), 16) << 16) | (parseInt(s.slice(2, 4), 16) << 8) | parseInt(s.slice(0, 2), 16)) >>> 0;
  };
  for (const [k, c] of Object.entries(GROUND_COLORS)) fields.set(Number(k), [packed(c.field[0]), packed(c.field[1]), packed(c.field[2])]);
  const waterC = WATER_DEPTH.map(packed);
  const depthAt = (tx: number, tz: number): number => {
    if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) return 0;
    const v = depth[tz * MAP_W + tx]!;
    return v === Infinity ? 4 : v;
  };
  for (let y = 0; y < H; y++) {
    const tz = Math.floor(y / TILE);
    for (let x = 0; x < W; x++) {
      const tx = Math.floor(x / TILE);
      const k = GROUND[tz * MAP_W + tx]!;
      let c: number;
      if (k === T.water) {
        // 水深：在格子中心之间双线性插值，再分层抖动。
        const gx = x / TILE - 0.5;
        const gy = y / TILE - 0.5;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;
        const dv =
          depthAt(ix, iy) * (1 - fx) * (1 - fy) + depthAt(ix + 1, iy) * fx * (1 - fy) + depthAt(ix, iy + 1) * (1 - fx) * fy + depthAt(ix + 1, iy + 1) * fx * fy;
        const t = Math.max(0, Math.min(WATER_DEPTH.length - 1, (dv - 0.6) * 1.3 + (bayer(x, y) - 0.5) * 0.9));
        c = waterC[Math.round(t)]!;
      } else {
        const f = fields.get(k)!;
        const n = n1(x, y) * 0.75 + n2(x, y) * 0.25 + (bayer(x, y) - 0.5) * 0.16;
        c = n < 0.4 ? f[0] : n > 0.6 ? f[2] : f[1];
      }
      r.data[y * W + x] = c;
    }
  }
  return r.toCanvas();
}

function drawTile(ctx: Ctx, tx: number, tz: number, k: TileKind, rng: Rng): void {
  const C = GROUND_COLORS[k]!;
  const x0 = tx * TILE;
  const y0 = tz * TILE;
  if (GRASSY.has(k)) {
    if (k === T.infield && Math.floor(tz / 2) % 2 === 0) px(ctx, x0, y0, "rgba(255,255,255,0.06)", TILE, TILE);
    if (k === T.paddock && Math.floor(tx / 2) % 2 === 0) px(ctx, x0, y0, "rgba(255,255,255,0.04)", TILE, TILE);
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
  } else if (k === T.path || k === T.sand || k === T.track || k === T.clay) {
    for (let i = 0; i < 10; i++) px(ctx, x0 + rng.int(0, 15), y0 + rng.int(0, 15), rng.next() < 0.6 ? C.dark : C.light);
    if (rng.next() < 0.3) {
      const x = x0 + rng.int(2, 12);
      const y = y0 + rng.int(2, 12);
      px(ctx, x, y, "#9c8a76", 2, 1);
      px(ctx, x, y - 1, "#c9b9a2", 1, 1);
    }
    if (k === T.track) for (let y = 2; y < 16; y += 5) px(ctx, x0 + rng.int(0, 4), y0 + y, C.dark, rng.int(6, 11), 1);
    if (k === T.path && rng.next() < 0.15) {
      // 车辙和马蹄印。
      const x = x0 + rng.int(3, 11);
      const y = y0 + rng.int(3, 11);
      px(ctx, x, y, C.dark, 2, 1);
      px(ctx, x, y + 1, C.dark, 1, 1);
      px(ctx, x + 1, y + 1, C.light, 1, 1);
    }
  } else if (k === T.soil) {
    // 翻过的地：一道道垄沟。
    for (let y = 1; y < 16; y += 4) {
      px(ctx, x0, y0 + y, C.light, TILE, 1);
      px(ctx, x0, y0 + y + 2, C.dark, TILE, 1);
    }
    for (let i = 0; i < 4; i++) px(ctx, x0 + rng.int(0, 15), y0 + rng.int(0, 15), "#a06a40");
  } else if (k === T.court) {
    // 水泥地：一块块方砖。
    px(ctx, x0, y0, C.dark, TILE, 1);
    px(ctx, x0, y0, C.dark, 1, TILE);
    px(ctx, x0 + 8, y0, C.dark, 1, TILE);
    px(ctx, x0, y0 + 8, C.dark, TILE, 1);
    px(ctx, x0 + 1, y0 + 1, C.light, 7, 1);
    px(ctx, x0 + 9, y0 + 9, C.light, 7, 1);
    for (let i = 0; i < 3; i++) px(ctx, x0 + rng.int(0, 15), y0 + rng.int(0, 15), C.dark);
  } else if (k === T.plaza) {
    // 青石板：错缝的砖，每块深浅不一，偶尔一点青苔。
    px(ctx, x0, y0, C.base, TILE, TILE);
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
    for (let i = 0; i < 2; i++) {
      if (rng.next() < 0.5) continue;
      px(ctx, x0 + rng.int(0, 11), y0 + rng.int(2, 14), "rgba(20,50,100,0.35)", rng.int(3, 5), 1);
    }
  } else if (k === T.bridge) {
    // 木板桥：横着的板子，每块一道亮边一道缝；底下看得见水的阴影。
    px(ctx, x0, y0, C.base, TILE, TILE);
    for (let y = 0; y < 16; y += 4) {
      px(ctx, x0, y0 + y, C.light, TILE, 1);
      px(ctx, x0, y0 + y + 3, C.dark, TILE, 1);
      px(ctx, x0 + rng.int(2, 13), y0 + y + 1, C.dark);
      if (rng.next() < 0.4) px(ctx, x0 + rng.int(1, 14), y0 + y + 2, "#5a3a1c");
    }
  }
}

/** 不同地面交界的地方画一道边：草压在路上，水边一圈浅滩和深色水线，台子的正面。 */
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
    if (k === T.bridge && n !== T.bridge) {
      // 桥边的栏杆：一根根桩子，桥下的水里一道影子。
      if (n !== T.water) continue;
      if (side === "w" || side === "e") {
        const x = side === "w" ? x0 : x0 + 13;
        px(ctx, x, y0, "#5e3a1c", 3, TILE);
        px(ctx, x, y0, "#8a5a32", 1, TILE);
        for (let y = 2; y < 16; y += 8) {
          px(ctx, x - 1, y0 + y - 2, "#4a2a14", 5, 4);
          px(ctx, x, y0 + y - 2, "#a8723c", 3, 1);
        }
      } else if (side === "s") {
        px(ctx, x0, y0 + 14, "#5e3a1c", TILE, 2);
      }
      continue;
    }
    if (k === T.water) {
      if (n === T.bridge) {
        if (side === "n") px(ctx, x0, y0, "rgba(10,30,60,0.45)", TILE, 4);
        continue;
      }
      const sand = "#e8d7a2";
      const deep = "#2c68a2";
      for (let i = 0; i < 16; i++) {
        const j = rng.next() < 0.3 ? 1 : 0;
        const w = 2 + j;
        if (side === "n") {
          px(ctx, x0 + i, y0, sand, 1, w);
          px(ctx, x0 + i, y0 + w, deep);
          px(ctx, x0 + i, y0 + w + 1, "rgba(20,50,90,0.3)", 1, 2);
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
    if (k === T.clay) {
      // 擂台是垫高的夯土台：前面露出一截台壁，上沿一道亮边。
      if (side === "s") {
        px(ctx, x0, y0 + 11, "#8a5a34", TILE, 5);
        px(ctx, x0, y0 + 11, "#e0b07a", TILE, 1);
        for (let x = 0; x < 16; x += 5) px(ctx, x0 + x, y0 + 12, "#6e4428", 1, 4);
        px(ctx, x0, y0 + 15, "#5a3620", TILE, 1);
      } else if (side === "n") px(ctx, x0, y0, "#e0b07a", TILE, 2);
      else if (side === "w") px(ctx, x0, y0, "#d8a070", 2, TILE);
      else px(ctx, x0 + 14, y0, "#8a5a34", 2, TILE);
      continue;
    }
    if (!GRASSY.has(n)) {
      const curb = (a: number, b: number): boolean => a === T.plaza || a === T.court || b === T.plaza || b === T.court;
      if (curb(k, n)) {
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
      const w = 1 + ((hashSeed(`${tx},${tz},${side},${i >> 1}`) >>> 3) % 3);
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

/** 赛道的白色栏杆，和看台前面那一段的终点线。 */
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
      px(ctx, x + 1, y + 1, "rgba(20,40,20,0.3)", 1, 1);
      px(ctx, x, y - 3, "#f4f1e6", 1, 3);
      px(ctx, x, y, "#9a9584");
      if (i % 4 === 0) px(ctx, x, y - 4, "#c33b2e");
    }
  }
  // 终点线：黑白格，横跨看台前的那段跑道。
  const x = TRACK.cx * TILE;
  const top = (TRACK.cz - TRACK.rz) * TILE;
  const band = TRACK.band * TILE;
  for (let y = 0; y < band; y += 2) for (let c = 0; c < 2; c++) px(ctx, x - 2 + c * 2, top + y, (y / 2 + c) % 2 ? "#2a2a2a" : "#f4f1e6", 2, 2);
}

/** 擂台中间：一圈沙地，外面一圈草绳（俵），中间两道白线。逐像素画，圆是真圆。 */
function drawDohyo(ctx: Ctx): void {
  const cx = RING.x * TILE;
  const cy = RING.z * TILE;
  const R = RING.r * TILE;
  for (let y = Math.floor(cy - R - 3); y <= cy + R + 3; y++)
    for (let x = Math.floor(cx - R - 3); x <= cx + R + 3; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > R + 2.5) continue;
      if (d < R - 2) {
        const n = (hashSeed(`沙${x},${y}`) % 100) / 100;
        px(ctx, x, y, n < 0.08 ? "#d2b672" : n > 0.94 ? "#f6e4ae" : "#ead190");
        continue;
      }
      // 草绳：一节一节，上半圈亮、下半圈（朝前）暗，外沿一道深线。
      const a = Math.atan2(dy, dx);
      const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 36) % 2;
      let c = dy < 0 ? (seg ? "#e8d49a" : "#d8c080") : seg ? "#c8ae6a" : "#b89a58";
      if (d > R + 1.3) c = "#6e5a30";
      else if (d < R - 1.2) c = "#f2e2b0";
      px(ctx, x, y, c);
    }
  // 两道白色起手线。
  for (const sx of [-9, 7]) {
    px(ctx, cx + sx, cy - 5, "#fbfaf2", 2, 10);
    px(ctx, cx + sx + 2, cy - 5, "#c9b98e", 1, 10);
  }
}

/** 整张地图的地面烘焙成一张大图。 */
export function bakeGround(): HTMLCanvasElement {
  const c = baseLayer();
  const ctx = c.getContext("2d") as Ctx;
  ctx.imageSmoothingEnabled = false;
  const rng = createRng(hashSeed("地面"));
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) drawTile(ctx, x, z, kindAt(x, z) as TileKind, rng);
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) drawEdges(ctx, x, z, kindAt(x, z), rng);
  drawRails(ctx);
  drawDohyo(ctx);
  return c;
}

/** 小地图用的地面颜色。 */
export function groundColor(k: number): string {
  return GROUND_COLORS[k]?.base ?? "#68ac3e";
}

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
