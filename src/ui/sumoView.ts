import { mix, shade } from "../render/color";
import { drawCrowd } from "../render/crowd";
import { lookFor, toScreen, type View } from "../render/horseArt";
import { thinkBubble } from "../world/labels";
import { drawScene, PALETTES } from "../render/scene";
import { STEP } from "../sim/race";
import type { SumoBout } from "../sim/sumo";
import { drawPixelHorse, PixelSurface, pixelBox, pixelText, PX } from "./pixelCanvas";

export interface SumoViewOptions {
  /** 你的马是哪一边（0 左、1 右），观战为 null。 */
  mine: 0 | 1 | null;
  onFinish: (bout: SumoBout) => void;
}

/** 分出胜负后再看几秒输家倒地、滑出圈外。 */
const AFTERMATH = 2.2;

/** 相扑台的侧面镜头：两匹马在台上顶牛。 */
export class SumoView {
  private readonly surface: PixelSurface;
  private bout: SumoBout | null = null;
  private opts: SumoViewOptions | null = null;
  private acc = 0;
  private last = 0;
  private after = 0;
  private fired = false;
  private raf = 0;
  private wall = 0;
  speed = 1;
  active = false;

  constructor(canvas: HTMLCanvasElement) {
    this.surface = new PixelSurface(canvas);
    this.raf = requestAnimationFrame(this.frame);
  }

  show(bout: SumoBout, opts: SumoViewOptions): void {
    this.bout = bout;
    this.opts = opts;
    this.acc = 0;
    this.after = 0;
    this.fired = false;
    this.active = true;
  }

  stop(): void {
    this.active = false;
    this.bout = null;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  /** 跳过：直接算出结果。 */
  skip(): void {
    if (!this.bout || this.bout.finished) return;
    this.bout.runToEnd();
    this.after = AFTERMATH;
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.active || !this.bout) return;
    this.wall += dt;
    const bout = this.bout;
    this.acc += dt * this.speed;
    let n = 0;
    while (this.acc >= STEP && n++ < 12) {
      bout.step();
      this.acc -= STEP;
    }
    if (n >= 12) this.acc = 0;
    if (bout.finished) {
      this.after += dt * this.speed;
      if (this.after >= AFTERMATH && !this.fired) {
        this.fired = true;
        this.opts?.onFinish(bout);
      }
    }
    this.render();
  };

  private render(): void {
    const bout = this.bout;
    if (!bout) return;
    const { W, H } = this.surface.begin();
    const ctx = this.surface.buf;
    const P = PALETTES.dusk;
    const R = bout.ringRadius;
    const groundY = H * 0.7;
    const sc = drawScene(ctx, W, H, "dusk", 0, this.wall * 1000, 0.6);
    const ppm = Math.min(W / (2 * R + 7), H * 0.13);
    const view: View = { camX: 0, ppm, groundY, width: W, anchor: 0.5 };

    // 场地：四周一圈看台，坐满了人；前面一道矮木栏，地上是夯土。全按缓冲像素画。
    const bw = Math.ceil(W / PX);
    const bh = Math.ceil(H / PX);
    const hz = Math.round((H * 0.6) / PX);
    const rect = (x: number, y: number, w: number, h: number, c: string): void => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const live = bout.started && !bout.finished;
    const heat = bout.finished ? 1 : live ? 0.35 + 0.3 * Math.abs(Math.sin(this.wall * 1.3)) : 0.1;
    rect(0, hz - 34, bw, 34, mix("#4a3020", P.fog, 0.35));
    drawCrowd(ctx, { x0: 0, x1: bw, base: hz - 1, rows: 5, offset: 0, time: this.wall, cheer: () => heat, seed: "擂台", haze: P.fog, hazeAmount: 0.25, seats: true, density: 0.9 });
    rect(0, hz, bw, 4, "#7a4a24");
    rect(0, hz, bw, 1, "#a8733f");
    for (let x = 0; x < bw; x += 12) rect(x, hz, 1, 4, "#5a3218");
    rect(0, hz + 4, bw, bh - hz - 4, shade(P.ground, 0.25));
    for (let i = 0; i < bw * 0.6; i++) {
      const h = (i * 2654435761) >>> 0;
      rect(h % bw, hz + 5 + ((h >>> 12) % Math.max(1, bh - hz - 6)), 1, 1, shade(P.ground, (h >>> 8) % 2 ? 0.35 : 0.12));
    }

    // 土俵：梯形的台子，正面看得见夯土的台壁；顶上一个椭圆的沙面，一圈草绳。
    const [lxC] = toScreen(view, { x: -R - 1.4, y: 0 });
    const [rxC] = toScreen(view, { x: R + 1.4, y: 0 });
    const lx = lxC / PX;
    const rx = rxC / PX;
    const gy = Math.round(groundY / PX);
    const depth = Math.round((ppm * 0.9) / PX);
    for (let y = 0; y < depth; y++) {
      const spread = y * 0.6;
      const c = y < 2 ? "#c8a070" : y > depth - 3 ? "#5e4228" : "#8a6a46";
      rect(lx - spread, gy + y, rx - lx + spread * 2, 1, c);
    }
    for (let x = Math.ceil(lx); x < rx; x += 7) rect(x, gy + 2, 1, depth - 4, "#76583a");
    const cx = (lx + rx) / 2;
    const rxE = (rx - lx) / 2;
    const ryE = Math.max(3, Math.round((ppm * 0.5) / PX));
    for (let dy = -ryE; dy <= 1; dy++) {
      const w = Math.round(rxE * Math.sqrt(Math.max(0, 1 - (Math.min(0, dy) / ryE) ** 2)));
      rect(cx - w, gy + dy, w * 2, 1, dy === -ryE ? "#efe0b8" : "#d9c296");
    }
    // 草绳圈：按角度一节一节地点出来。
    const ringR = (R / (R + 1.4)) * rxE;
    const ringRy = (R / (R + 1.4)) * ryE;
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * Math.PI;
      const x = Math.round(cx + Math.cos(a + Math.PI) * ringR);
      const y = Math.round(gy - Math.sin(a) * ringRy);
      rect(x, y, 1, 1, k % 6 < 3 ? "#b89a58" : "#d8c080");
    }
    rect(cx - ringR, gy - 1, ringR * 2, 1, "#b89a58");
    for (const sx of [-0.7, 0.7]) {
      const [x] = toScreen(view, { x: sx, y: 0 });
      rect(Math.round(x / PX), gy - 2, 1, 4, "#f5efe2");
    }
    ctx.restore();

    const poses = bout.poses();
    const bubbles = poses.map((pose, i) => {
      const horse = bout.horses[i]!;
      return drawPixelHorse(ctx, pose, horse.plan, lookFor(horse.plan, sc.rim), view);
    });

    const screen = this.surface.present();
    for (const b of bubbles) if (b) thinkBubble(screen, b.x, b.y, b.text, 2);
    this.drawHud(screen, W, H);
  }

  private drawHud(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const bout = this.bout as SumoBout;
    const mine = this.opts?.mine ?? null;
    const plaque = (x: number, align: "left" | "right", name: string, isMine: boolean, won: boolean | null): void => {
      const w = Math.max(168, name.length * 36 + 60);
      const x0 = align === "left" ? x : x - w;
      pixelBox(ctx, x0, 12, w, 72, PX, isMine ? "red" : "plank");
      pixelText(ctx, name, x0 + w / 2, 18, { scale: 3, align: "center" });
      if (won) stamp(ctx, align === "left" ? x0 + w + 40 : x0 - 40, 48, "胜");
    };
    const done = bout.finished;
    plaque(16, "left", bout.entrants[0].name, mine === 0, done ? bout.winner === 0 : null);
    plaque(W - 16, "right", bout.entrants[1].name, mine === 1, done ? bout.winner === 1 : null);
    const left = Math.max(0, bout.timeLimit - bout.boutTime);
    pixelBox(ctx, W / 2 - 54, 12, 108, 72, PX, "wood");
    pixelText(ctx, bout.started ? `${Math.ceil(left)}` : "预备", W / 2, 24, { scale: 3, align: "center", color: "#3b1c0e", line: null });
    if (done) {
      const text = bout.winner === null ? "平局" : bout.reason === "flip" ? "掀翻" : bout.reason === "ringout" ? "推出圈" : "判定";
      pixelText(ctx, text, W / 2, H * 0.22, { scale: 6, align: "center" });
    }
  }
}

/** 红色印章：像素方块，四边一圈浅色线。 */
export function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  const u = PX;
  pixelBox(ctx, x - 30, y - 30, 60, 60, u, "red");
  ctx.fillStyle = "#fff2d0";
  ctx.fillRect(x - 22, y - 22, 44, u);
  ctx.fillRect(x - 22, y + 22 - u, 44, u);
  ctx.fillRect(x - 22, y - 22, u, 44);
  ctx.fillRect(x + 22 - u, y - 22, u, 44);
  pixelText(ctx, text, x, y - 22, { scale: 3, align: "center", line: null });
}
