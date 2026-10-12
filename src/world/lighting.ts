/**
 * 大世界的光：
 * - 光照贴图：先铺一层环境光（白天白、傍晚橙、夜里深蓝），再把每盏灯「加」上去，
 *   最后整张乘到画面上——灯照到的地方露出本来的颜色，照不到的沉进夜色里。
 *   灯的光晕不是平滑渐变，而是一圈圈分层、用 Bayer 抖动过渡的像素光。
 * - 白天：云影慢慢飘过地面。
 * - 夜里画面四角压暗一点（暗角）。
 */
import { mix } from "../render/color";
import { bayer, Raster, rgb } from "./raster";

type Ctx = CanvasRenderingContext2D;

export interface Light {
  /** 缓冲坐标（屏幕上的像素）。 */
  x: number;
  y: number;
  r: number;
  color: string;
  /** 亮度 0..1（闪烁、远近）。 */
  power: number;
}

export interface Ambient {
  /** 乘到画面上的环境色。 */
  color: string;
  /** 0 白天 … 1 深夜：灯开多亮。 */
  night: number;
  /** 0..1：白天云影的浓淡。 */
  day: number;
}

/** 一天里的环境光：清晨偏粉，傍晚偏橙，夜里深蓝。 */
export function ambientAt(clock: number): Ambient {
  const h = clock / 60;
  const keys: Array<[number, string, number]> = [
    [4.5, "#2e3a78", 1],
    [6, "#c8a0b8", 0.45],
    [7.2, "#ffe6d8", 0.05],
    [9, "#ffffff", 0],
    [15.5, "#ffffff", 0],
    [17.2, "#ffd8a8", 0.05],
    [18.6, "#dc9a86", 0.4],
    [19.8, "#6a5a96", 0.8],
    [21, "#36427e", 1],
    [24, "#2c3670", 1],
  ];
  const c = Math.max(keys[0]![0], Math.min(keys[keys.length - 1]![0], h));
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (c <= b[0]) {
      const t = (c - a[0]) / (b[0] - a[0]);
      const night = a[2] + (b[2] - a[2]) * t;
      return { color: mix(a[1], b[1], t), night, day: Math.max(0, 1 - night * 2.2) };
    }
  }
  const last = keys[keys.length - 1]!;
  return { color: last[1], night: last[2], day: 0 };
}

/* ---------------- 像素光晕 ---------------- */

const lightCache = new Map<string, HTMLCanvasElement>();

/** 一盏灯的光：中心最亮，往外分六层变暗，层与层之间抖动过渡。 */
export function lightSprite(r: number, color: string): HTMLCanvasElement {
  r = Math.max(4, Math.round(r));
  const key = `${r}|${color}`;
  let c = lightCache.get(key);
  if (c) return c;
  const size = r * 2;
  const ras = new Raster(size, size);
  const s = color.replace("#", "");
  const cr = parseInt(s.slice(0, 2), 16);
  const cg = parseInt(s.slice(2, 4), 16);
  const cb = parseInt(s.slice(4, 6), 16);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      if (d >= 1) continue;
      const k = Math.pow(1 - d, 1.5);
      const q = Math.max(0, Math.min(6, Math.floor(k * 6 + bayer(x, y)))) / 6;
      if (q <= 0) continue;
      ras.data[y * size + x] = ((255 << 24) | (Math.round(cb * q) << 16) | (Math.round(cg * q) << 8) | Math.round(cr * q)) >>> 0;
    }
  c = ras.toCanvas();
  lightCache.set(key, c);
  return c;
}

/* ---------------- 云影 ---------------- */

/** 能无缝平铺的值噪声。 */
function tileNoise(size: number, cell: number, seed: number): (x: number, y: number) => number {
  const n = Math.round(size / cell);
  const v = new Float32Array(n * n);
  let s = seed;
  for (let i = 0; i < v.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    v[i] = s / 4294967296;
  }
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = (gx - ix) * (gx - ix) * (3 - 2 * (gx - ix));
    const fy = (gy - iy) * (gy - iy) * (3 - 2 * (gy - iy));
    const at = (a: number, b: number): number => v[((b % n) + n) % n * n + (((a % n) + n) % n)]!;
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function cloudTexture(): HTMLCanvasElement {
  const size = 512;
  const big = tileNoise(size, 128, 7);
  const mid = tileNoise(size, 64, 13);
  const small = tileNoise(size, 16, 29);
  const ras = new Raster(size, size);
  const shadow = rgb("#14283c");
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = big(x, y) * 0.6 + mid(x, y) * 0.3 + small(x, y) * 0.1;
      // 只留下最浓的几片（大约一成多的地面），边缘窄窄地抖一圈。
      const k = (n - 0.72) / 0.06 + (bayer(x, y) - 0.5) * 0.5;
      if (k <= 0) continue;
      const a = k > 1 ? 0.13 : 0.07;
      ras.data[y * size + x] = ((Math.round(a * 255) << 24) | (shadow & 0xffffff)) >>> 0;
    }
  return ras.toCanvas();
}

/* ---------------- 合成 ---------------- */

export class Lighting {
  private readonly map: HTMLCanvasElement;
  private readonly mctx: Ctx;
  private clouds: CanvasPattern | null = null;
  private vignette: HTMLCanvasElement | null = null;

  constructor() {
    this.map = document.createElement("canvas");
    this.mctx = this.map.getContext("2d") as Ctx;
  }

  /** 白天的云影：跟着地面走（世界坐标），再被风吹着慢慢挪。 */
  drawClouds(b: Ctx, cx: number, cy: number, bw: number, bh: number, time: number, amb: Ambient): void {
    if (amb.day <= 0.02) return;
    if (!this.clouds) this.clouds = b.createPattern(cloudTexture(), "repeat");
    const pat = this.clouds;
    if (!pat) return;
    const ox = Math.round(-cx - time * 7);
    const oy = Math.round(-cy - time * 3);
    pat.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]));
    b.globalAlpha = Math.min(1, amb.day);
    b.fillStyle = pat;
    b.fillRect(0, 0, bw, bh);
    b.globalAlpha = 1;
  }

  private vignetteFor(bw: number, bh: number): HTMLCanvasElement {
    if (this.vignette && this.vignette.width === bw && this.vignette.height === bh) return this.vignette;
    const ras = new Raster(bw, bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const dx = (x - bw / 2) / (bw / 2);
        const dy = (y - bh / 2) / (bh / 2);
        const d = Math.sqrt(dx * dx * 0.8 + dy * dy);
        const k = Math.max(0, Math.min(1, (d - 0.55) / 0.6));
        const q = Math.floor(k * 3 + bayer(x, y)) / 3;
        const v = Math.round(255 * (1 - q * 0.45));
        ras.data[y * bw + x] = ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
      }
    this.vignette = ras.toCanvas();
    return this.vignette;
  }

  /**
   * 光照贴图乘到画面上。白天（环境光是白的、又没有灯）就什么也不做。
   * 返回 true 表示画了（之后该画发光的东西了）。
   */
  apply(b: Ctx, bw: number, bh: number, lights: Light[], amb: Ambient): boolean {
    if (amb.color === "#ffffff" && amb.night <= 0.01) return false;
    const m = this.map;
    if (m.width !== bw || m.height !== bh) {
      m.width = bw;
      m.height = bh;
    }
    const c = this.mctx;
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.fillStyle = amb.color;
    c.fillRect(0, 0, bw, bh);
    if (amb.night > 0.3) {
      c.globalCompositeOperation = "multiply";
      c.globalAlpha = Math.min(1, (amb.night - 0.3) / 0.5);
      c.drawImage(this.vignetteFor(bw, bh), 0, 0);
      c.globalAlpha = 1;
    }
    if (amb.night > 0.05) {
      c.globalCompositeOperation = "lighter";
      for (const l of lights) {
        if (l.x < -l.r || l.y < -l.r || l.x > bw + l.r || l.y > bh + l.r) continue;
        c.globalAlpha = Math.max(0, Math.min(1, l.power * Math.min(1, amb.night * 1.4)));
        c.drawImage(lightSprite(l.r, l.color), Math.round(l.x - l.r), Math.round(l.y - l.r));
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
    }
    b.globalCompositeOperation = "multiply";
    b.drawImage(m, 0, 0);
    b.globalCompositeOperation = "source-over";
    return true;
  }

  /** 灯芯、窗户之类自己发光的东西外面再加一圈淡淡的辉光。 */
  bloom(b: Ctx, lights: Light[], amb: Ambient): void {
    if (amb.night < 0.2) return;
    b.globalCompositeOperation = "lighter";
    for (const l of lights) {
      const r = Math.max(5, Math.round(l.r * 0.32));
      b.globalAlpha = Math.min(1, l.power * amb.night * 0.5);
      b.drawImage(lightSprite(r, l.color), Math.round(l.x - r), Math.round(l.y - r));
    }
    b.globalAlpha = 1;
    b.globalCompositeOperation = "source-over";
  }
}
