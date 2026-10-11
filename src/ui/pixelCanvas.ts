/**
 * 赛场和相扑台的像素画面：场景先画进 1/PX 大小的缓冲画布，再按整数倍放大到屏幕；
 * 名牌、计时这些字最后用像素字体直接画在屏幕上，保持清楚。
 */
import type { BodyPlan } from "../body/bodyPlan";
import { drawHorsePose, lookFor, toScreen, type HorseBubble, type View } from "../render/horseArt";
import type { HorsePose } from "../sim/horse";
import { canvas, outline, textSprite } from "../world/sprites";

export const PX = 3;

type Ctx = CanvasRenderingContext2D;

export class PixelSurface {
  readonly screen: Ctx;
  readonly buf: Ctx;
  private readonly bufCanvas: HTMLCanvasElement;
  W = 0;
  H = 0;
  dpr = 1;

  constructor(private readonly target: HTMLCanvasElement) {
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D 不可用");
    this.screen = ctx;
    const [c, b] = canvas(1, 1);
    this.bufCanvas = c;
    this.buf = b;
  }

  /** 量好尺寸；之后往 buf 里按 CSS 坐标画，自动缩成 1/PX。 */
  begin(): { W: number; H: number } {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.target.clientWidth || 800;
    const H = this.target.clientHeight || 450;
    if (this.target.width !== Math.round(W * this.dpr) || this.target.height !== Math.round(H * this.dpr)) {
      this.target.width = Math.round(W * this.dpr);
      this.target.height = Math.round(H * this.dpr);
    }
    const bw = Math.ceil(W / PX);
    const bh = Math.ceil(H / PX);
    if (this.bufCanvas.width !== bw || this.bufCanvas.height !== bh) {
      this.bufCanvas.width = bw;
      this.bufCanvas.height = bh;
    }
    this.buf.setTransform(1 / PX, 0, 0, 1 / PX, 0, 0);
    this.buf.imageSmoothingEnabled = false;
    this.W = W;
    this.H = H;
    return { W, H };
  }

  /** 把缓冲放大贴到屏幕上，之后 screen 用 CSS 坐标画字。 */
  present(): Ctx {
    const s = this.screen;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.imageSmoothingEnabled = false;
    s.drawImage(this.bufCanvas, 0, 0, this.bufCanvas.width * PX * this.dpr, this.bufCanvas.height * PX * this.dpr);
    s.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    s.imageSmoothingEnabled = false;
    return s;
  }
}

const scratch = canvas(1, 1);

/** 一匹马单独画进小画布，去掉灰边、描一圈深色线，再贴进缓冲。 */
/** 画一匹像素马，返回头顶气泡（CSS 坐标），等 present() 以后用 thinkBubble 画在屏幕上。 */
export function drawPixelHorse(buf: Ctx, pose: HorsePose, plan: BodyPlan, look: ReturnType<typeof lookFor>, view: View, alpha = 1): HorseBubble | null {
  const reach = (plan.torsoLength + plan.neckLength + plan.tailLength + 1.2) * view.ppm;
  const tall = (Math.max(plan.legFront, plan.legRear) + plan.torsoHeight + plan.neckLength + 0.8) * view.ppm;
  const [cx, cy] = toScreen(view, { x: pose.torso.x, y: pose.torso.y });
  const x0 = Math.floor((cx - reach) / PX) * PX;
  const y0 = Math.floor((cy - tall) / PX) * PX;
  const w = Math.ceil((reach * 2) / PX) + 2;
  const h = Math.ceil((tall * 1.6) / PX) + 2;
  const [c, ctx] = scratch;
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, w);
    c.height = Math.max(c.height, h);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.setTransform(1 / PX, 0, 0, 1 / PX, -x0 / PX, -y0 / PX);
  const bubble = drawHorsePose(ctx, pose, plan, look, view);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  outlineRegion(c, w, h);
  buf.globalAlpha = alpha;
  buf.drawImage(c, 0, 0, w, h, x0, y0, w * PX, h * PX);
  buf.globalAlpha = 1;
  return bubble;
}

/** outline() 只认整张画布，这里只处理用到的左上角一块。 */
function outlineRegion(c: HTMLCanvasElement, w: number, h: number): void {
  const [tmp, tctx] = region;
  if (tmp.width !== w || tmp.height !== h) {
    tmp.width = w;
    tmp.height = h;
  }
  tctx.clearRect(0, 0, w, h);
  tctx.drawImage(c, 0, 0, w, h, 0, 0, w, h);
  outline(tmp, "#24140c", 110);
  const ctx = c.getContext("2d") as Ctx;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);
}

const region = canvas(1, 1);

/** 屏幕上的像素字：12px 字放大 scale 倍。 */
export function pixelText(s: Ctx, text: string, x: number, y: number, opts: { color?: string; line?: string | null; scale?: number; align?: "left" | "center" | "right" } = {}): number {
  const t = textSprite(text, opts.color ?? "#fff2d0", opts.line === undefined ? "#3b1c0e" : opts.line);
  const k = opts.scale ?? 2;
  const w = t.width * k;
  const dx = opts.align === "center" ? -w / 2 : opts.align === "right" ? -w : 0;
  s.drawImage(t, Math.round(x + dx), Math.round(y), w, t.height * k);
  return w;
}

/** 屏幕上的木框（和界面的菜单框同一套颜色），u 是一个美术像素的大小。 */
export function pixelBox(s: Ctx, x: number, y: number, w: number, h: number, u = PX, kind: "wood" | "paper" | "plank" | "red" = "wood"): void {
  const r = (xx: number, yy: number, ww: number, hh: number, c: string): void => {
    s.fillStyle = c;
    s.fillRect(Math.round(xx), Math.round(yy), Math.round(ww), Math.round(hh));
  };
  x = Math.round(x);
  y = Math.round(y);
  r(x + u, y, w - 2 * u, h, "#3b1c0e");
  r(x, y + u, w, h - 2 * u, "#3b1c0e");
  if (kind === "wood") {
    r(x + u, y + u, w - 2 * u, h - 2 * u, "#9a4416");
    r(x + u, y + u, w - 3 * u, h - 3 * u, "#f0a850");
    r(x + 2 * u, y + 2 * u, w - 4 * u, h - 4 * u, "#d47a2e");
    r(x + 4 * u, y + 4 * u, w - 8 * u, h - 8 * u, "#3b1c0e");
    r(x + 5 * u, y + 5 * u, w - 10 * u, h - 10 * u, "#f7d79e");
    r(x + 5 * u, y + 5 * u, w - 10 * u, u, "#d9a865");
  } else if (kind === "paper") {
    r(x + u, y + u, w - 2 * u, h - 2 * u, "#d9a865");
    r(x + u, y + u, w - 3 * u, h - 3 * u, "#fff6dc");
    r(x + 2 * u, y + 2 * u, w - 4 * u, h - 4 * u, "#fbe6b8");
  } else {
    const [hi, mid, lo] = kind === "red" ? ["#f06a50", "#d23a2a", "#7a1a10"] : ["#e8a048", "#b45e22", "#7a3410"];
    r(x + u, y + u, w - 2 * u, h - 2 * u, lo);
    r(x + u, y + u, w - 3 * u, h - 3 * u, hi);
    r(x + 2 * u, y + 2 * u, w - 4 * u, h - 4 * u, mid);
  }
}
