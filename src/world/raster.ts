/**
 * 一块像素画板：直接往 Uint32 数组里写像素，画完一次性转成画布。
 * 房子、喷泉这些大件逐像素上色（明暗面、抖动阴影），比一个个 fillRect 快得多，也不会有抗锯齿的灰边。
 */

const colorCache = new Map<string, number>();

/** "#rrggbb"（或带透明度的 "#rrggbbaa"）→ 打包好的像素值（小端：R、G、B、A）。 */
export function rgb(hex: string, a = 255): number {
  const key = `${hex}|${a}`;
  let c = colorCache.get(key);
  if (c === undefined) {
    const s = hex.replace("#", "");
    if (s.length === 8) a = parseInt(s.slice(6, 8), 16);
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    c = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    colorCache.set(key, c);
  }
  return c;
}

/** 4×4 Bayer 矩阵，抖动用。 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

type Color = string | number;
const scanXs: number[] = [];
const byValue = (a: number, b: number): number => a - b;
const col = (c: Color): number => (typeof c === "number" ? c : rgb(c));

export class Raster {
  readonly data: Uint32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint32Array(w * h);
  }

  get(x: number, y: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x]!;
  }

  px(x: number, y: number, c: Color): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const v = col(c);
    const a = v >>> 24;
    const i = y * this.w + x;
    if (a === 255 || a === 0) {
      this.data[i] = v;
      return;
    }
    // 半透明：和底下的像素混一下。
    const d = this.data[i]!;
    const k = a / 255;
    const mixC = (s: number): number => Math.round(((v >>> s) & 255) * k + ((d >>> s) & 255) * (1 - k));
    const da = d >>> 24;
    this.data[i] = ((Math.max(a, da) << 24) | (mixC(16) << 16) | (mixC(8) << 8) | mixC(0)) >>> 0;
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    const v = col(c);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    if (v >>> 24 === 255) {
      for (let yy = y0; yy < y1; yy++) this.data.fill(v, yy * this.w + x0, yy * this.w + x1);
      return;
    }
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, v);
  }

  /** 按 Bayer 矩阵抖动地铺一层颜色，level 0..1 是覆盖比例。 */
  dither(x: number, y: number, w: number, h: number, c: Color, level: number): void {
    const v = col(c);
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) if (bayer(xx, yy) < level) this.px(xx, yy, v);
  }

  /** 把已经画了的像素压暗（k<1）或提亮（k>1），只动不透明的地方。可选抖动比例。 */
  shade(x: number, y: number, w: number, h: number, k: number, level = 1): void {
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(this.h, Math.round(y + h)); yy++)
      for (let xx = Math.max(0, Math.round(x)); xx < Math.min(this.w, Math.round(x + w)); xx++) {
        if (level < 1 && bayer(xx, yy) >= level) continue;
        const i = yy * this.w + xx;
        const d = this.data[i]!;
        if (d >>> 24 === 0) continue;
        const f = (s: number): number => Math.max(0, Math.min(255, Math.round(((d >>> s) & 255) * k)));
        this.data[i] = ((d & 0xff000000) | (f(16) << 16) | (f(8) << 8) | f(0)) >>> 0;
      }
  }

  /** 扫描线填多边形（取像素中心判断），没有抗锯齿。(ox, oy) 是先从各点减去的偏移。 */
  poly(pts: ReadonlyArray<readonly [number, number]>, c: Color, ox = 0, oy = 0): void {
    const v = col(c);
    const opaque = v >>> 24 === 255 || v >>> 24 === 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1] - oy);
      maxY = Math.max(maxY, p[1] - oy);
    }
    const xs = scanXs;
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const cy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const ay = a[1] - oy;
        const by = b[1] - oy;
        if (ay <= cy !== by <= cy) xs.push(a[0] - ox + ((cy - ay) / (by - ay)) * (b[0] - a[0]));
      }
      xs.sort(byValue);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.round(xs[i]!);
        const x1 = Math.round(xs[i + 1]!);
        if (opaque) {
          const l = Math.max(0, x0);
          const r = Math.min(this.w, x1);
          if (r > l) this.data.fill(v, y * this.w + l, y * this.w + r);
        } else for (let x = x0; x < x1; x++) this.px(x, y, v);
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color): void {
    const v = col(c);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, v);
      }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    const v = col(c);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), v);
  }

  /** 不透明区域外面描一圈。 */
  outline(c: Color): void {
    const v = col(c);
    const { w, h, data } = this;
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) solid[i] = data[i]! >>> 24 > 100 ? 1 : 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])) data[i] = v;
      }
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(new Uint8ClampedArray(this.data.buffer));
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
