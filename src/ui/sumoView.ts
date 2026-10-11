import { shade } from "../render/color";
import { lookFor, toScreen, type View } from "../render/horseArt";
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

    // 场地：远处的观众剪影。
    ctx.fillStyle = shade(P.hills[3], -0.25);
    for (let i = 0; i < 70; i++) {
      const x = (i / 70) * W + ((i * 37) % 11);
      const bob = Math.sin(this.wall * 4 + i) * (bout.started && !bout.finished ? 3 : 1);
      const y = H * 0.6 + ((i * 13) % 9) - bob;
      const r = 9 + (i % 3) * 3;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillRect(x - r * 0.4, y - r * 1.7, r * 0.8, r * 0.8);
    }
    ctx.fillStyle = shade(P.ground, -0.1);
    ctx.fillRect(0, H * 0.6, W, H * 0.4);

    // 土俵：梯形台子，台面上一圈草绳。
    const [lx] = toScreen(view, { x: -R - 1.4, y: 0 });
    const [rx] = toScreen(view, { x: R + 1.4, y: 0 });
    const depth = ppm * 0.9;
    ctx.fillStyle = "#8a6a46";
    ctx.beginPath();
    ctx.moveTo(lx, groundY);
    ctx.lineTo(rx, groundY);
    ctx.lineTo(rx + depth * 0.6, groundY + depth);
    ctx.lineTo(lx - depth * 0.6, groundY + depth);
    ctx.fill();
    ctx.fillStyle = "#d9c296";
    ctx.beginPath();
    ctx.ellipse((lx + rx) / 2, groundY, (rx - lx) / 2, ppm * 0.5, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(lx, groundY - 1, rx - lx, 3);
    for (const sx of [-R, R]) {
      const [x] = toScreen(view, { x: sx, y: 0 });
      ctx.fillStyle = "#8f7a3c";
      ctx.beginPath();
      ctx.ellipse(x, groundY - ppm * 0.08, ppm * 0.22, ppm * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#f5efe2";
    ctx.lineWidth = Math.max(2, ppm * 0.06);
    for (const sx of [-0.7, 0.7]) {
      const [x] = toScreen(view, { x: sx, y: 0 });
      ctx.beginPath();
      ctx.moveTo(x, groundY - ppm * 0.15);
      ctx.lineTo(x, groundY + ppm * 0.15);
      ctx.stroke();
    }

    const poses = bout.poses();
    poses.forEach((pose, i) => {
      const horse = bout.horses[i]!;
      drawPixelHorse(ctx, pose, horse.plan, lookFor(horse.plan, sc.rim), view);
    });

    this.drawHud(this.surface.present(), W, H);
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
