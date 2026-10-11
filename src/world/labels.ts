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

/**
 * 一段字的墨迹框。textSprite 左边留 2 像素、顶上 1 像素空白，汉字占 11 行；
 * 描边的再往外扩 1 像素。
 */
function ink(text: string, color: string, line: string | null = null): Ink {
  const c = textSprite(text, color, line);
  return line ? { c, ox: 1, oy: 0, w: c.width - 2, h: 13 } : { c, ox: 2, oy: 1, w: c.width - 4, h: 11 };
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

/** 描边的飘字，(x, y) 是顶边中点。 */
export function floatText(s: Ctx, x: number, y: number, text: string, color: string, k: number): void {
  const g = ink(text, color, DARK);
  put(s, g, x - (g.w * k) / 2, y, k);
}

/** 进入新地方时顶上滑下来的木牌。(x, y) 是木牌顶边中点。 */
export function banner(s: Ctx, x: number, y: number, text: string, k: number): void {
  const g = ink(text, "#fbefd4", DARK);
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
  put(s, g, x0 + 13 * k, y0 + 3 * k, k);
}
