/**
 * 大世界上的字：名牌、互动气泡、飘字、地名木牌。
 * 世界画面先画进小缓冲再整数倍放大，12px 的字跟着放大就挤成一团，位置也只能按美术像素对齐。
 * 所以字等放大以后直接画在屏幕上：k 是一个字像素占的设备像素，框线也按 k 画，和字对齐。
 */
import { textSprite } from "./sprites";

type Ctx = CanvasRenderingContext2D;

const DARK = "#2a1a12";

interface Ink {
  c: HTMLCanvasElement;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/** 画布里有字的行：[第一行, 最后一行]。 */
function inkRows(c: HTMLCanvasElement): [number, number] {
  const { width: w, height: h } = c;
  const d = (c.getContext("2d") as Ctx).getImageData(0, 0, w, h).data;
  let top = h;
  let bottom = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3]! > 0) {
        top = Math.min(top, y);
        bottom = y;
        break;
      }
  return bottom < 0 ? [0, h - 1] : [top, bottom];
}

const rowsCache = new WeakMap<HTMLCanvasElement, [number, number]>();
const rowsOf = (c: HTMLCanvasElement): [number, number] => {
  let r = rowsCache.get(c);
  if (!r) {
    r = inkRows(c);
    rowsCache.set(c, r);
  }
  return r;
};

/**
 * 一段字的墨迹框。横向按字宽（textSprite 左边留 2 像素）；纵向取一个满格汉字的上下沿，
 * 再并上这段字自己的墨迹，所以不同系统上字形高低差一两个像素也不会被裁掉，名牌高度也一致。
 */
function ink(text: string, color: string): Ink {
  const c = textSprite(text, color);
  const [r0, r1] = rowsOf(textSprite("国", color));
  const [t0, t1] = rowsOf(c);
  const oy = Math.min(r0, t0);
  const h = Math.max(r1, t1) - oy + 1;
  return { c, ox: 2, oy, w: c.width - 4, h };
}

function put(s: Ctx, g: Ink, x: number, y: number, k: number): void {
  s.drawImage(g.c, g.ox, g.oy, g.w, g.h, Math.round(x), Math.round(y), g.w * k, g.h * k);
}

/** 以 (x0, y0) 为原点、k 为一格画方块。 */
function grid(s: Ctx, x0: number, y0: number, k: number) {
  return (x: number, y: number, w: number, h: number, color: string): void => {
    s.fillStyle = color;
    s.fillRect(x0 + x * k, y0 + y * k, w * k, h * k);
  };
}

/** 马头顶的名牌：深色小牌，切掉四个角。(x, y) 是牌子底边的中点。 */
export function nameTag(s: Ctx, x: number, y: number, text: string, k: number): void {
  const g = ink(text, "#fbefd4");
  // 字右边自带 1 像素字距，所以右边少留一格，看起来左右一样宽。
  const w = g.w + 3;
  const h = g.h + 4;
  const x0 = Math.round(x - (w * k) / 2);
  const y0 = Math.round(y - h * k);
  const r = grid(s, x0, y0, k);
  r(1, 0, w - 2, h, DARK);
  r(0, 1, w, h - 2, DARK);
  r(1, h - 1, w - 2, 1, "#4a3020");
  put(s, g, x0 + 2 * k, y0 + 2 * k, k);
}

/** 互动提示：对话气泡，键帽 E 加动作名。(x, y) 是气泡尖。返回占的屏幕区域（点它也算互动）。 */
export function bubble(s: Ctx, x: number, y: number, label: string, k: number): { x: number; y: number; w: number; h: number } {
  const g = ink(label, DARK);
  const e = ink("E", DARK);
  const w = 18 + g.w + 4;
  const h = 17;
  const x0 = Math.round(x - (w * k) / 2);
  const y0 = Math.round(y - (h + 4) * k);
  const r = grid(s, x0, y0, k);
  r(-1, 0, w + 2, h, DARK);
  r(0, -1, w, h + 2, DARK);
  r(0, 0, w, h, "#fff6e0");
  r(0, h - 2, w, 2, "#e8cf9c");
  // 键帽
  r(2, 2, 13, 13, DARK);
  r(3, 3, 11, 10, "#f6d05a");
  put(s, e, x0 + Math.round(2 + (13 - e.w) / 2) * k, y0 + 3 * k, k);
  put(s, g, x0 + 18 * k, y0 + 3 * k, k);
  // 气泡尖
  const m = Math.floor(w / 2);
  r(m - 3, h, 7, 2, DARK);
  r(m - 2, h + 2, 5, 2, DARK);
  r(m - 2, h, 5, 1, "#fff6e0");
  r(m - 1, h + 1, 3, 2, "#fff6e0");
  return { x: x0 - k, y: y0 - k, w: (w + 2) * k, h: (h + 5) * k };
}

/**
 * 带影子的字：右下各落一个字像素的深色影子。
 * 不用一圈描边：12px 的汉字笔画之间只隔一个像素，描边会把这些缝填死，字就糊成一团。
 */
function shadowed(s: Ctx, text: string, color: string, x: number, y: number, k: number): void {
  const sh = ink(text, DARK);
  put(s, sh, x + k, y, k);
  put(s, sh, x, y + k, k);
  put(s, sh, x + k, y + k, k);
  put(s, ink(text, color), x, y, k);
}

/** 飘字，(x, y) 是顶边中点。 */
export function floatText(s: Ctx, x: number, y: number, text: string, color: string, k: number): void {
  const g = ink(text, color);
  shadowed(s, text, color, Math.round(x - (g.w * k) / 2), y, k);
}

/** 进入新地方时顶上滑下来的木牌。(x, y) 是木牌顶边中点。 */
export function banner(s: Ctx, x: number, y: number, text: string, k: number): void {
  const g = ink(text, "#fbefd4");
  const w = g.w + 26;
  const h = 20;
  const x0 = Math.round(x - (w * k) / 2);
  const y0 = Math.round(y);
  const r = grid(s, x0, y0, k);
  r(-1, -1, w + 2, h + 2, DARK);
  r(0, 0, w, h, "#a8622c");
  r(0, 0, w, 2, "#d08a44");
  r(0, h - 2, w, 2, "#7a4218");
  r(3, h / 2 - 1, 2, 2, "#f2c14e");
  r(w - 5, h / 2 - 1, 2, 2, "#f2c14e");
  shadowed(s, text, "#fbefd4", x0 + 13 * k, y0 + Math.floor((h - g.h) / 2) * k, k);
}

/** 马头顶的念头气泡（发呆「…」、绊了一下「!」、摔晕「晕」）：小纸条加一个尖。(x, y) 是尖的位置。 */
export function thinkBubble(s: Ctx, x: number, y: number, text: string, k: number): void {
  const g = ink(text, DARK);
  const w = Math.max(g.w + 6, 13);
  const h = g.h + 4;
  const x0 = Math.round(x - (w * k) / 2);
  const y0 = Math.round(y - (h + 3) * k);
  const r = grid(s, x0, y0, k);
  r(-1, 0, w + 2, h, DARK);
  r(0, -1, w, h + 2, DARK);
  r(0, 0, w, h, "#fff6e0");
  r(0, h - 1, w, 1, "#e8cf9c");
  const m = Math.floor(w / 2);
  r(m - 2, h, 4, 2, DARK);
  r(m - 1, h + 2, 2, 1, DARK);
  r(m - 1, h, 2, 1, "#fff6e0");
  r(m - 1, h - 1, 2, 1, "#fff6e0");
  put(s, g, x0 + Math.round((w - g.w) / 2) * k, y0 + 2 * k, k);
}

const tint = document.createElement("canvas");

/**
 * 房子匾额上的字：(x, y) 是牌面中心，maxW 是牌面宽（设备像素）。放不下就把字缩一档。
 * light 是环境光颜色：字画在光照之后，要自己乘上夜色，不然夜里会发亮。
 */
export function signText(s: Ctx, x: number, y: number, text: string, color: string, k: number, maxW: number, light: string, alpha = 1): void {
  const g = ink(text, color);
  let kk = k;
  while (kk > 1 && g.w * kk > maxW) kk--;
  const [w, h] = [g.w * kk, g.h * kk];
  if (tint.width < w || tint.height < h) {
    tint.width = Math.max(tint.width, w);
    tint.height = Math.max(tint.height, h);
  }
  const t = tint.getContext("2d") as Ctx;
  t.globalCompositeOperation = "copy";
  t.imageSmoothingEnabled = false;
  t.drawImage(g.c, g.ox, g.oy, g.w, g.h, 0, 0, w, h);
  t.globalCompositeOperation = "multiply";
  t.fillStyle = light;
  t.fillRect(0, 0, w, h);
  t.globalCompositeOperation = "destination-in";
  t.drawImage(g.c, g.ox, g.oy, g.w, g.h, 0, 0, w, h);
  t.globalCompositeOperation = "source-over";
  s.globalAlpha = alpha;
  s.drawImage(tint, 0, 0, w, h, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
  s.globalAlpha = 1;
}
