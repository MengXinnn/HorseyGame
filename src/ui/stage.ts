import type { BodyPlan } from "../body/bodyPlan";
import { rgba, shade } from "../render/color";
import { drawHorsePose, lookFor, toScreen, type View } from "../render/horseArt";
import { drawScene, drawTrackDetails, PALETTES, type TimeOfDay } from "../render/scene";
import type { HorsePose } from "../sim/horse";
import { STEP, type Race } from "../sim/race";

const NECK_ANGLE = 0.95;

export type StageMode = "preview" | "trial" | "race";

interface Dust {
  lane: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

export interface StageOptions {
  mode: StageMode;
  /** 玩家的马在 race.runners 里的下标。 */
  player: number;
  onFinish?: (race: Race) => void;
  onTick?: (race: Race) => void;
}

/**
 * 舞台：用固定步长推进比赛，用 Canvas 2D 画出来。渲染只读物理姿态，
 * 以后换成 PixiJS 只需要替换这一层。
 */
export class Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private race: Race | null = null;
  private opts: StageOptions = { mode: "preview", player: 0 };
  private acc = 0;
  private last = 0;
  private camX = 0;
  private dust: Dust[] = [];
  private finishedFired = false;
  private raf = 0;
  private wall = 0;
  time: TimeOfDay = "dusk";
  speed = 1;
  paused = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D 不可用");
    this.ctx = ctx;
    this.raf = requestAnimationFrame(this.frame);
  }

  get current(): Race | null {
    return this.race;
  }

  get mode(): StageMode {
    return this.opts.mode;
  }

  show(race: Race, opts: StageOptions): void {
    this.race = race;
    this.opts = opts;
    this.acc = 0;
    this.dust = [];
    this.finishedFired = false;
    this.camX = race.runners[opts.player]?.horse.x ?? 0;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.wall += dt;
    const race = this.race;
    if (race && !this.paused) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= STEP && n++ < 12) {
        race.step();
        this.acc -= STEP;
        this.spawnDust(race);
      }
      if (n >= 12) this.acc = 0;
      this.opts.onTick?.(race);
      if (race.finished && !this.finishedFired && this.opts.mode !== "preview") {
        this.finishedFired = true;
        this.opts.onFinish?.(race);
      }
    }
    this.updateDust(dt * this.speed);
    this.render();
  };

  private resize(): { W: number; H: number } {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth || 800;
    const H = this.canvas.clientHeight || 450;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W, H };
  }

  /** 每条泳道的镜头参数：越靠后的泳道越小、越高，形成纵深。 */
  private laneViews(W: number, H: number, count: number): View[] {
    const race = this.race;
    const mode = this.opts.mode;
    const anchor = mode === "race" ? 0.4 : 0.5;
    if (mode !== "race" || count <= 1) {
      const tallest = race ? Math.max(...race.runners.map((r) => r.horse.plan.legFront + r.horse.plan.torsoHeight + r.horse.plan.neckLength)) : 2.6;
      const ppm = Math.min((H * 0.5) / Math.max(2.2, tallest), W / 7);
      return [{ camX: this.camX, ppm, groundY: H * 0.84, width: W, anchor }];
    }
    const front = H * 0.94;
    const back = H * 0.69;
    const ppmFront = Math.min(H * 0.1, W / 10);
    const views: View[] = [];
    for (let i = 0; i < count; i++) {
      const depth = count === 1 ? 0 : i / (count - 1); // 0 = 最前
      views.push({ camX: this.camX, ppm: ppmFront * (1 - 0.45 * depth), groundY: front - (front - back) * depth, width: W, anchor });
    }
    return views;
  }

  /** 玩家的马永远在最前面的泳道，其余按下标往后排。 */
  private laneOf(index: number): number {
    const p = this.opts.player;
    if (index === p) return 0;
    return index < p ? index + 1 : index;
  }

  private render(): void {
    const { W, H } = this.resize();
    const ctx = this.ctx;
    const race = this.race;
    const mode = this.opts.mode;
    const n = race ? race.runners.length : 1;
    const player = race?.runners[this.opts.player];
    if (player) {
      const target = player.horse.x + (mode === "race" ? 1.5 : 0);
      this.camX += (target - this.camX) * (mode === "preview" ? 1 : 0.12);
    }
    const views = this.laneViews(W, H, n);
    const front = views[0] as View;
    const horizon = mode === "race" ? (views[views.length - 1] as View).groundY - 26 : front.groundY;
    const sc = drawScene(ctx, W, H, this.time, this.camX * front.ppm * 0.6, this.wall * 1000, horizon / H);
    const palette = PALETTES[this.time];

    if (mode === "race" && race) this.drawRaceTrack(views, race.options.distance, palette.rim, palette.grass);
    else drawTrackDetails(ctx, W, H, this.time, this.camX * front.ppm, front.groundY, front.ppm * 2.5);
    if (mode === "trial") this.drawMeterMarks(front, palette.rim);

    if (!race) return;
    // 从后往前画：后排的马先画，被前排挡住。
    const order = race.runners.map((r, i) => ({ r, i, lane: this.laneOf(i) })).sort((a, b) => b.lane - a.lane);
    for (const { r, i, lane } of order) {
      const view = views[Math.min(lane, views.length - 1)] as View;
      this.drawDust(view, lane, palette.ground);
      const pose = r.horse.pose();
      const look = lookFor(r.horse.plan, sc.rim);
      // 远处的马淡一点，突出玩家的马。
      ctx.globalAlpha = mode === "race" ? 1 - 0.05 * lane : 1;
      drawHorsePose(ctx, pose, r.horse.plan, look, view);
      ctx.globalAlpha = 1;
      if (mode === "race") this.drawTag(view, pose, r.horse.plan, r.entrant.name, i === this.opts.player, sc.rim);
    }
    this.drawHud(W, race);
  }

  private drawRaceTrack(views: View[], distance: number, rim: string, grass: string): void {
    const ctx = this.ctx;
    const backV = views[views.length - 1] as View;
    const frontV = views[0] as View;
    // 泳道分隔线。
    ctx.strokeStyle = rgba(rim, 0.12);
    ctx.lineWidth = 1;
    for (let i = 0; i < views.length; i++) {
      const v = views[i] as View;
      ctx.beginPath();
      ctx.moveTo(0, v.groundY + 2);
      ctx.lineTo(v.width, v.groundY + 2);
      ctx.stroke();
    }
    // 每 25 米一根标杆，起点和终点画横贯所有泳道的线。
    const marks: number[] = [];
    for (let m = 0; m <= distance; m += 25) marks.push(m);
    for (const m of marks) {
      const [bx, by] = toScreen(backV, { x: m, y: 0 });
      const [fx, fy] = toScreen(frontV, { x: m, y: 0 });
      if (Math.max(bx, fx) < -40 || Math.min(bx, fx) > frontV.width + 40) continue;
      const isEnd = m === 0 || m === distance;
      ctx.strokeStyle = isEnd ? rgba("#ffffff", 0.75) : rgba(rim, 0.25);
      ctx.lineWidth = isEnd ? 4 : 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by - 6);
      ctx.lineTo(fx, fy + 10);
      ctx.stroke();
      ctx.fillStyle = rgba(rim, 0.8);
      ctx.font = "600 12px 'Noto Sans SC', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m === distance ? "终点" : m === 0 ? "起点" : `${m}`, bx, by - 12);
      if (m === distance) {
        // 终点旗杆和彩带。
        ctx.strokeStyle = shade(grass, 0.6);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(bx, by - 6);
        ctx.lineTo(bx, by - 90);
        ctx.stroke();
        ctx.fillStyle = "#e85d4a";
        ctx.beginPath();
        ctx.moveTo(bx, by - 90);
        ctx.lineTo(bx + 34, by - 80);
        ctx.lineTo(bx, by - 70);
        ctx.fill();
      }
    }
  }

  private drawMeterMarks(view: View, rim: string): void {
    const ctx = this.ctx;
    const left = this.camX - (view.width * (view.anchor ?? 0.5)) / view.ppm;
    const right = left + view.width / view.ppm;
    ctx.font = "600 12px 'Noto Sans SC', sans-serif";
    ctx.textAlign = "center";
    for (let m = Math.max(0, Math.ceil(left / 5) * 5); m <= right; m += 5) {
      const [x, y] = toScreen(view, { x: m, y: 0 });
      ctx.fillStyle = rgba(rim, 0.7);
      ctx.fillRect(x - 1, y + 4, 2, 10);
      ctx.fillText(`${m} 米`, x, y + 28);
    }
  }

  private drawTag(view: View, pose: HorsePose, plan: BodyPlan, name: string, mine: boolean, rim: string): void {
    const ctx = this.ctx;
    // 名牌挂在头顶上方。
    const a = pose.neck.angle + NECK_ANGLE;
    const head = { x: pose.neck.x + Math.cos(a) * plan.neckLength, y: pose.neck.y + Math.sin(a) * plan.neckLength };
    const [x, y] = toScreen(view, { x: head.x, y: Math.max(head.y, pose.torso.y) + 0.45 });
    ctx.font = `${mine ? 700 : 500} ${mine ? 14 : 11}px 'Noto Sans SC', sans-serif`;
    const tw = ctx.measureText(name).width + 14;
    ctx.fillStyle = mine ? "rgba(243,199,123,0.95)" : "rgba(20,16,36,0.55)";
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y - 26, tw, mine ? 22 : 18, 9);
    ctx.fill();
    ctx.fillStyle = mine ? "#2a1b2e" : rgba(rim, 0.95);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, x, y - 26 + (mine ? 11 : 9));
    ctx.textBaseline = "alphabetic";
  }

  private drawHud(W: number, race: Race): void {
    const ctx = this.ctx;
    const mode = this.opts.mode;
    if (mode === "preview") return;
    const me = race.runners[this.opts.player];
    if (!me) return;
    const dist = Math.max(0, race.progress(me));
    const speed = Math.max(0, me.horse.pose().speed);
    ctx.fillStyle = "rgba(14,12,30,0.55)";
    ctx.beginPath();
    ctx.roundRect(14, 14, 190, 64, 12);
    ctx.fill();
    ctx.fillStyle = "#fbefd9";
    ctx.textAlign = "left";
    ctx.font = "700 22px 'Noto Sans SC', sans-serif";
    const remaining = Math.max(0, race.options.timeLimit - race.raceTime);
    const clock = mode === "trial" ? `${remaining.toFixed(1)} 秒` : `${race.raceTime.toFixed(1)} 秒`;
    ctx.fillText(race.started ? clock : "预备…", 26, 42);
    ctx.font = "500 13px 'Noto Sans SC', sans-serif";
    ctx.fillStyle = "rgba(251,239,217,0.8)";
    const distText = `${dist.toFixed(1)} 米`;
    ctx.fillText(distText, 26, 64);
    ctx.fillText(me.horse.state === "fallen" ? "摔倒" : `${(speed * 3.6).toFixed(0)} 公里/时`, 26 + ctx.measureText(distText).width + 16, 64);

    if (mode === "race") {
      // 顶部进度条：每匹马一个点。
      const x0 = 230;
      const x1 = W - 24;
      if (x1 - x0 < 80) return;
      const y = 30;
      ctx.strokeStyle = "rgba(251,239,217,0.35)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      race.runners.forEach((r, i) => {
        if (i === this.opts.player) return;
        const t = Math.min(1, Math.max(0, race.progress(r) / race.options.distance));
        ctx.fillStyle = "rgba(251,239,217,0.7)";
        ctx.beginPath();
        ctx.arc(x0 + (x1 - x0) * t, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      const t = Math.min(1, dist / race.options.distance);
      ctx.fillStyle = "#f3c77b";
      ctx.beginPath();
      ctx.arc(x0 + (x1 - x0) * t, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private spawnDust(race: Race): void {
    if (!race.started) return;
    race.runners.forEach((r, i) => {
      const pose = r.horse.pose();
      if (pose.speed < 2.5 && !pose.fallen) return;
      for (const leg of pose.legs) {
        if (leg.foot.y > r.horse.plan.hoofRadius + 0.03) continue;
        if (Math.random() > 0.18) continue;
        this.dust.push({
          lane: this.laneOf(i),
          x: leg.foot.x,
          y: 0.05,
          vx: -0.3 * pose.speed * Math.random(),
          vy: 0.4 + Math.random() * 0.6,
          life: 1,
          size: 0.05 + Math.random() * 0.07,
        });
      }
    });
    if (this.dust.length > 400) this.dust.splice(0, this.dust.length - 400);
  }

  private updateDust(dt: number): void {
    for (const d of this.dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy -= 0.6 * dt;
      d.size += 0.25 * dt;
      d.life -= dt * 1.3;
    }
    this.dust = this.dust.filter((d) => d.life > 0);
  }

  private drawDust(view: View, lane: number, ground: string): void {
    const ctx = this.ctx;
    const color = shade(ground, 0.55);
    for (const d of this.dust) {
      if (d.lane !== lane) continue;
      const [x, y] = toScreen(view, d);
      ctx.fillStyle = rgba(color, 0.25 * d.life);
      ctx.beginPath();
      ctx.arc(x, y, d.size * view.ppm, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
