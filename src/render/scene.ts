import { bayer, Raster } from "../world/raster";
import { mix, shade } from "./color";

/** 山水剪影：一天四个时段，每个时段一套天空、远山、雾和边缘光颜色。 */
export type TimeOfDay = "dawn" | "noon" | "dusk" | "night";

export interface Palette {
  sky: string[];
  sun: string;
  sunY: number;
  hills: [string, string, string, string];
  fog: string;
  ground: string;
  grass: string;
  rim: string;
  stars: number;
}

export const PALETTES: Record<TimeOfDay, Palette> = {
  dawn: { sky: ["#7f8fc4", "#e9b7b8", "#fbe0c4"], sun: "#fff1d6", sunY: 0.62, hills: ["#9a9cc7", "#8586b6", "#6d6c9c", "#55507d"], fog: "#f6d2c8", ground: "#4a4468", grass: "#5d5a7c", rim: "#ffd9b8", stars: 0 },
  noon: { sky: ["#5ea7dc", "#9fd0ec", "#e3f3f6"], sun: "#fffbea", sunY: 0.18, hills: ["#a6cfd0", "#7fb5b2", "#5b9890", "#3f7a6c"], fog: "#e6f4f1", ground: "#3d6f55", grass: "#4f8a63", rim: "#fff6dc", stars: 0 },
  dusk: { sky: ["#2a2154", "#9b4e78", "#f19763", "#f8d27f"], sun: "#ffe3a3", sunY: 0.66, hills: ["#b0607a", "#7f4673", "#563562", "#33244a"], fog: "#f2a07a", ground: "#2a1f3d", grass: "#3a2b4f", rim: "#ffc98a", stars: 0.25 },
  night: { sky: ["#070b22", "#141c46", "#2b3466"], sun: "#f3efe0", sunY: 0.2, hills: ["#2c3768", "#222b57", "#182046", "#0f1534"], fog: "#3a4680", ground: "#0c1129", grass: "#141a3a", rim: "#b9c7ff", stars: 1 },
};

function sampleSky(sky: string[], t: number): string {
  const f = Math.max(0, Math.min(1, t)) * (sky.length - 1);
  const i = Math.min(sky.length - 2, Math.floor(f));
  return mix(sky[i] as string, sky[i + 1] as string, f - i);
}

function lerpPalette(a: Palette, b: Palette, t: number): Palette {
  const n = (x: number, y: number): number => x + (y - x) * t;
  return {
    sky: [0, 1 / 3, 2 / 3, 1].map((k) => mix(sampleSky(a.sky, k), sampleSky(b.sky, k), t)),
    sun: mix(a.sun, b.sun, t),
    sunY: n(a.sunY, b.sunY),
    hills: a.hills.map((c, i) => mix(c, b.hills[i] as string, t)) as Palette["hills"],
    fog: mix(a.fog, b.fog, t),
    ground: mix(a.ground, b.ground, t),
    grass: mix(a.grass, b.grass, t),
    rim: mix(a.rim, b.rim, t),
    stars: n(a.stars, b.stars),
  };
}

/** 一天里的关键时刻（分钟）和对应的天色，中间平滑过渡。 */
const KEYS: Array<[number, TimeOfDay]> = [
  [5 * 60, "night"],
  [7 * 60, "dawn"],
  [10 * 60, "noon"],
  [15 * 60, "noon"],
  [18 * 60, "dusk"],
  [20 * 60, "night"],
];

/** 按时钟（分钟）混合出当前的天色。 */
export function paletteAt(clock: number): Palette {
  const c = Math.max(KEYS[0]![0], Math.min(KEYS[KEYS.length - 1]![0], clock));
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [t0, a] = KEYS[i]!;
    const [t1, b] = KEYS[i + 1]!;
    if (c <= t1) {
      const t = (c - t0) / (t1 - t0);
      const smooth = t * t * (3 - 2 * t);
      return lerpPalette(PALETTES[a], PALETTES[b], smooth);
    }
  }
  return PALETTES.night;
}

export const TIME_LABELS: Record<TimeOfDay, string> = { dawn: "清晨", noon: "正午", dusk: "黄昏", night: "夜晚" };

/* ---------------- 像素背景 ---------------- */

/**
 * 背景按缓冲像素（屏幕的 1/3）直接画：天空分层抖动，远山是硬边的剪影条，
 * 雾也是抖动出来的，放大以后每个像素都是方的，不会糊。
 */

/** 山条的周期（缓冲像素）：山脊用整数个周期的正弦叠起来，左右能无缝接上。 */
const PERIOD = 1024;

const packed = (hex: string, a = 255): number => {
  const s = hex.replace("#", "");
  return ((a << 24) | (parseInt(s.slice(4, 6), 16) << 16) | (parseInt(s.slice(2, 4), 16) << 8) | parseInt(s.slice(0, 2), 16)) >>> 0;
};

const LAYERS = [
  { amp: 0.37, base: 0.58, par: 0.05, seed: 1.3, waves: [1, 3, 6, 15], peak: true, trees: false },
  { amp: 0.22, base: 0.72, par: 0.12, seed: 4.1, waves: [2, 4, 9, 19], peak: false, trees: true },
  { amp: 0.11, base: 0.83, par: 0.25, seed: 7.7, waves: [3, 5, 11, 23], peak: false, trees: false },
  { amp: 0.06, base: 0.92, par: 0.5, seed: 2.9, waves: [4, 7, 13, 29], peak: false, trees: true },
];

function ridge(L: (typeof LAYERS)[number], x: number, gy: number): number {
  const w = (n: number): number => (2 * Math.PI * n * x) / PERIOD;
  const [a, b, c, d] = L.waves as [number, number, number, number];
  let y = gy * L.base + gy * L.amp * (0.5 * Math.sin(w(a) + L.seed) + 0.28 * Math.sin(w(b) + L.seed * 2.1) + 0.14 * Math.sin(w(c) + L.seed * 3.7) + 0.08 * Math.sin(w(d) + L.seed * 5.3));
  if (L.peak) y -= Math.pow(Math.max(0, Math.sin(w(2) + 0.7)), 6) * gy * L.amp * 0.9;
  return y;
}

/** 整数哈希，给山上撒点深色的斑。 */
function speckle(x: number, y: number): number {
  let h = Math.imul(x ^ Math.imul(y, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const cache = new Map<string, HTMLCanvasElement>();
const cached = (key: string, make: () => HTMLCanvasElement): HTMLCanvasElement => {
  let c = cache.get(key);
  if (!c) {
    if (cache.size > 40) cache.clear();
    c = make();
    cache.set(key, c);
  }
  return c;
};

/** 天空：竖直方向分十几层，层与层之间 Bayer 抖动。 */
function skyCanvas(P: Palette, bw: number, gy: number): HTMLCanvasElement {
  return cached(`sky|${P.sky.join()}|${bw}|${gy}`, () => {
    const h = Math.max(1, Math.ceil(gy));
    const r = new Raster(bw, h);
    const steps = 14;
    const colors = Array.from({ length: steps + 1 }, (_, i) => packed(sampleSky(P.sky, i / steps)));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < bw; x++) {
        const q = Math.min(steps, Math.floor((y / h) * steps + bayer(x, y)));
        r.data[y * bw + x] = colors[q]!;
      }
    return r.toCanvas();
  });
}

/** 一层远山：整数周期宽的一条，山脊以下填色，底部抖进雾里，第二、四层山脊上长着小树。 */
function hillStrip(P: Palette, i: number, gy: number, bh: number): HTMLCanvasElement {
  return cached(`hill|${i}|${P.hills[i]}|${P.fog}|${gy}|${bh}`, () => {
    const L = LAYERS[i]!;
    const r = new Raster(PERIOD, bh);
    const fog0 = gy * (L.base - L.amp * 0.2);
    const fog1 = gy * (L.base + L.amp * 1.4);
    const fogMax = i < 3 ? 0.55 - i * 0.12 : 0.18;
    // 雾分四层（山色 → 雾色），层与层之间抖动。
    const tones = [0, 1, 2, 3, 4].map((q) => packed(mix(P.hills[i]!, P.fog, (q / 4) * fogMax)));
    const dark = packed(shade(P.hills[i]!, -0.1));
    for (let x = 0; x < PERIOD; x++) {
      let top = Math.round(ridge(L, x, gy));
      if (L.trees) {
        // 山脊上一棵棵小尖树。
        const step = i === 1 ? 15 : 9;
        const k = x % step;
        const h = (i === 1 ? 4 : 2) + (Math.floor(x / step) * 7) % 3;
        const half = i === 1 ? 2 : 1;
        if (k <= half * 2) top -= Math.round(h * (1 - Math.abs(k - half) / (half + 1)));
      }
      for (let y = Math.max(0, top); y < bh; y++) {
        const a = y > fog0 ? Math.min(1, (y - fog0) / (fog1 - fog0)) : 0;
        const q = Math.min(4, Math.floor(a * 4 + bayer(x, y)));
        r.data[y * PERIOD + x] = q === 0 && speckle(x, y) % 29 === 0 && y > top + 2 ? dark : tones[q]!;
      }
    }
    return r.toCanvas();
  });
}

/** 地面：草色到地色，分层抖动。 */
function groundCanvas(P: Palette, bw: number, gy: number, bh: number): HTMLCanvasElement {
  return cached(`ground|${P.grass}|${P.ground}|${bw}|${gy}|${bh}`, () => {
    const top = Math.floor(gy);
    const h = Math.max(1, bh - top);
    const r = new Raster(bw, h);
    const steps = 6;
    const colors = Array.from({ length: steps + 1 }, (_, i) => packed(mix(P.grass, P.ground, i / steps)));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < bw; x++) r.data[y * bw + x] = colors[Math.min(steps, Math.floor((y / h) * steps + bayer(x, y)))]!;
    return r.toCanvas();
  });
}

/** 太阳（或月亮）：硬边的圆盘，外面三圈抖动的光晕。 */
function sunSprite(P: Palette, rad: number, moon: boolean): HTMLCanvasElement {
  return cached(`sun|${P.sun}|${P.sky[1]}|${rad}|${moon}`, () => {
    const R = rad * 5;
    const size = R * 2 + 2;
    const r = new Raster(size, size);
    const c = R + 1;
    const sun = packed(P.sun);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
        if (d <= rad) {
          if (moon && Math.hypot(x + 0.5 - c - rad * 0.42, y + 0.5 - c + rad * 0.2) < rad * 0.9) continue;
          r.data[y * size + x] = sun;
          continue;
        }
        const k = 1 - (d - rad) / (R - rad);
        if (k <= 0) continue;
        const q = Math.floor(k * k * 3 + bayer(x, y)) / 3;
        if (q > 0) r.data[y * size + x] = packed(P.sun, Math.round(q * (moon ? 50 : 110)));
      }
    return r.toCanvas();
  });
}

/** 像素云：几团圆叠起来，上亮下暗，硬边。 */
function cloudSprite(P: Palette, seed: number): HTMLCanvasElement {
  return cached(`cloud|${P.sky[1]}|${P.fog}|${seed}`, () => {
    const w = 48 + (seed % 3) * 14;
    const h = 18;
    const r = new Raster(w, h);
    const light = packed(mix(P.fog, "#ffffff", 0.35));
    const mid = packed(mix(P.fog, P.sky[1]!, 0.25));
    const dark = packed(mix(P.fog, P.sky[1]!, 0.55));
    const puffs: Array<[number, number, number]> = [];
    for (let i = 0; i < 5; i++) puffs.push([8 + ((w - 16) * i) / 4, 11 - Math.abs(2 - i) * 1.5 - ((seed + i) % 2) * 2, 6 + ((seed * 3 + i * 5) % 4)]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let inside = false;
        let top = false;
        for (const [px, py, pr] of puffs) {
          const d = Math.hypot(x + 0.5 - px, (y + 0.5 - py) * 1.3);
          if (d < pr) {
            inside = true;
            if (y + 0.5 < py - pr * 0.25) top = true;
          }
        }
        if (!inside || y > 14) continue;
        r.data[y * w + x] = y > 11 ? dark : top ? light : mid;
      }
    return r.toCanvas();
  });
}

const STARS: Array<[number, number, number]> = [];
for (let i = 0; i < 140; i++) {
  // 固定的伪随机星空，避免每帧闪烁位置。
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.678;
  STARS.push([a - Math.floor(a), (b - Math.floor(b)) * 0.6, i * 0.7]);
}

export interface SceneInfo {
  groundY: number;
  rim: string;
}

/**
 * 画背景。ctx 是 1/3 大小的缓冲（变换已经缩好，按屏幕坐标画），
 * scroll 是镜头的横向位置（屏幕像素），远山按视差系数移动；groundRatio 决定地平线高度。
 */
export function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, time: TimeOfDay | Palette, scroll: number, t: number, groundRatio = 0.8, px = 3): SceneInfo {
  const P = typeof time === "string" ? PALETTES[time] : time;
  const night = P.stars > 0.6;
  const bw = Math.ceil(W / px);
  const bh = Math.ceil(H / px);
  const gy = Math.round((H * groundRatio) / px);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(skyCanvas(P, bw, gy), 0, 0);
  ctx.fillStyle = P.sky[P.sky.length - 1]!;
  ctx.fillRect(0, gy, bw, bh - gy);

  if (P.stars > 0) {
    for (const [sx, sy, ph] of STARS) {
      const a = P.stars * (0.45 + 0.55 * Math.sin(t * 0.002 + ph));
      if (a < 0.35) continue;
      ctx.fillStyle = a > 0.8 ? "#fff8e6" : "#b8b4c8";
      ctx.fillRect(Math.floor(sx * bw), Math.floor(sy * bh), 1, 1);
    }
  }

  const rad = Math.max(3, Math.round((Math.min(W, H) * (night ? 0.045 : 0.07)) / px));
  const sun = sunSprite(P, rad, night);
  ctx.drawImage(sun, Math.round(bw * 0.72 - sun.width / 2), Math.round(bh * P.sunY - sun.height / 2));

  // 云：几朵慢慢往左飘，比远山还远。
  if (!night) {
    for (let i = 0; i < 5; i++) {
      const c = cloudSprite(P, i);
      const span = bw + 120;
      const x = ((((i * 197 - t * 0.004 - (scroll / px) * 0.02) % span) + span) % span) - 60;
      ctx.drawImage(c, Math.round(x), Math.round(gy * (0.12 + ((i * 37) % 5) * 0.07)));
    }
  }

  LAYERS.forEach((L, i) => {
    const strip = hillStrip(P, i, gy, bh);
    const off = ((Math.round((scroll / px) * L.par) % PERIOD) + PERIOD) % PERIOD;
    for (let x = -off; x < bw; x += PERIOD) ctx.drawImage(strip, x, 0);
  });

  ctx.drawImage(groundCanvas(P, bw, gy, bh), 0, gy);
  ctx.restore();
  return { groundY: gy * px, rim: P.rim };
}

/** 赛道前景（试跑用）：栏杆和草丛，按镜头位置 1:1 移动。都按缓冲像素画。 */
export function drawTrackDetails(ctx: CanvasRenderingContext2D, W: number, H: number, time: TimeOfDay, scroll: number, groundY: number, postEvery = 90, px = 3): void {
  const T = PALETTES[time];
  const bw = Math.ceil(W / px);
  const bh = Math.ceil(H / px);
  const gy = Math.round(groundY / px);
  const s = scroll / px;
  const pe = Math.max(8, Math.round(postEvery / px));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rail = mix(T.rim, "#ffffff", 0.3);
  const railDark = mix(T.rim, T.ground, 0.5);
  ctx.fillStyle = rail;
  ctx.fillRect(0, gy - 10, bw, 1);
  ctx.fillRect(0, gy - 6, bw, 1);
  ctx.fillStyle = railDark;
  ctx.fillRect(0, gy - 9, bw, 1);
  for (let fx = -mod(s, pe); fx < bw; fx += pe) {
    ctx.fillStyle = railDark;
    ctx.fillRect(Math.round(fx), gy - 11, 2, 12);
    ctx.fillStyle = rail;
    ctx.fillRect(Math.round(fx), gy - 11, 1, 11);
  }
  const tuft = 8;
  ctx.fillStyle = shade(T.grass, 0.15);
  for (let tx = -mod(s * 1.3, tuft); tx < bw; tx += tuft) {
    const k = Math.round(tx + s * 1.3);
    const ty = gy + 5 + mod(k * 7.3, Math.max(4, bh - gy - 7));
    const x = Math.round(tx);
    const y = Math.round(ty);
    ctx.fillRect(x, y - 2, 1, 2);
    ctx.fillRect(x - 1, y - 3, 1, 1);
    ctx.fillRect(x + 1, y - 3, 1, 2);
  }
  ctx.restore();
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
