import { rgba, shade } from "../render/color";
import { drawHorsePose, lookFor, toScreen, type View } from "../render/horseArt";
import { drawScene, PALETTES } from "../render/scene";
import { STEP } from "../sim/race";
import type { SumoBout } from "../sim/sumo";

export interface SumoViewOptions {
  /** 你的马是哪一边（0 左、1 右），观战为 null。 */
  mine: 0 | 1 | null;
  onFinish: (bout: SumoBout) => void;
}

/** 分出胜负后再看几秒输家倒地、滑出圈外。 */
const AFTERMATH = 2.2;

/** 相扑台的侧面镜头：两匹马在台上顶牛。 */
export class SumoView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
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
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth || 800;
    const H = this.canvas.clientHeight || 450;
    if (this.canvas.width !== Math.round(W * dpr)) this.canvas.width = Math.round(W * dpr);
    if (this.canvas.height !== Math.round(H * dpr)) this.canvas.height = Math.round(H * dpr);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      ctx.beginPath();
      ctx.arc(x, y, 9 + (i % 3) * 2, Math.PI, 0);
      ctx.fill();
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
      drawHorsePose(ctx, pose, horse.plan, lookFor(horse.plan, sc.rim), view);
    });

    this.drawHud(ctx, W, H);
  }

  private drawHud(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const bout = this.bout as SumoBout;
    const mine = this.opts?.mine ?? null;
    const plaque = (x: number, align: "left" | "right", name: string, isMine: boolean, won: boolean | null): void => {
      ctx.font = "400 30px 'Ma Shan Zheng', 'Noto Serif SC', serif";
      const w = Math.max(150, ctx.measureText(name).width + 50);
      const x0 = align === "left" ? x : x - w;
      ctx.fillStyle = "#2c1a10";
      ctx.beginPath();
      ctx.roundRect(x0 - 3, 13, w + 6, 58, 10);
      ctx.fill();
      const g = ctx.createLinearGradient(0, 16, 0, 68);
      g.addColorStop(0, isMine ? "#b8322a" : "#8f5c35");
      g.addColorStop(1, isMine ? "#8a2018" : "#5e3820");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x0, 16, w, 52, 8);
      ctx.fill();
      ctx.fillStyle = "#fbe9c0";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(name, x0 + w / 2, 44);
      ctx.textBaseline = "alphabetic";
      if (won) stamp(ctx, align === "left" ? x0 + w + 34 : x0 - 34, 44, "胜");
    };
    const done = bout.finished;
    plaque(16, "left", bout.entrants[0].name, mine === 0, done ? bout.winner === 0 : null);
    plaque(W - 16, "right", bout.entrants[1].name, mine === 1, done ? bout.winner === 1 : null);
    ctx.fillStyle = "#fbe9c0";
    ctx.font = "700 26px 'Noto Serif SC', serif";
    ctx.textAlign = "center";
    const left = Math.max(0, bout.timeLimit - bout.boutTime);
    ctx.fillText(bout.started ? `${Math.ceil(left)}` : "预备", W / 2, 52);
    if (done && bout.winner === null) {
      ctx.font = "400 64px 'Ma Shan Zheng', serif";
      ctx.fillText("平局", W / 2, H * 0.3);
    } else if (done) {
      const reason = bout.reason === "flip" ? "掀翻" : bout.reason === "ringout" ? "推出圈" : "判定";
      ctx.font = "400 56px 'Ma Shan Zheng', serif";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(30,18,12,0.6)";
      ctx.strokeText(reason, W / 2, H * 0.3);
      ctx.fillStyle = "#fbe9c0";
      ctx.fillText(reason, W / 2, H * 0.3);
    }
    ctx.fillStyle = rgba("#000000", 0);
  }
}

/** 红色印章。 */
export function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  ctx.fillStyle = "#b8322a";
  ctx.beginPath();
  ctx.roundRect(-24, -24, 48, 48, 6);
  ctx.fill();
  ctx.strokeStyle = "#f6e2c8";
  ctx.lineWidth = 2;
  ctx.strokeRect(-19, -19, 38, 38);
  ctx.fillStyle = "#f6e2c8";
  ctx.font = "400 30px 'Ma Shan Zheng', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 2);
  ctx.restore();
}
