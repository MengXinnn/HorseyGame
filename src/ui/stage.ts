import type { BodyPlan } from "../body/bodyPlan";
import { rgba, shade } from "../render/color";
import { lookFor, toScreen, type View } from "../render/horseArt";
import { drawScene, drawTrackDetails, PALETTES, type TimeOfDay } from "../render/scene";
import type { HorsePose } from "../sim/horse";
import { STEP, type Race } from "../sim/race";
import { drawPixelHorse, PixelSurface, pixelBox, pixelText, PX } from "./pixelCanvas";

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
  private readonly surface: PixelSurface;
  /** 场景缓冲（按 CSS 坐标画，自动缩小）。 */
  private readonly ctx: CanvasRenderingContext2D;
  /** 场景里要写的字，留到放大以后用像素字体写在屏幕上。 */
  private labels: Array<{ x: number; y: number; text: string; color: string }> = [];
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
  /** 不在屏幕上时停掉推进和绘制。 */
  active = true;

  constructor(canvas: HTMLCanvasElement) {
    this.surface = new PixelSurface(canvas);
    this.ctx = this.surface.buf;
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
    this.camX = race.runners[Math.max(0, opts.player)]?.horse.x ?? 0;
  }

  /** 收场：清掉比赛，不再推进。 */
  clear(): void {
    this.race = null;
    this.dust = [];
  }

  /** 跳过：直接算完，下一帧触发结束回调。 */
  skip(): void {
    if (this.race && !this.race.finished) this.race.runToEnd();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.active) return;
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
    this.labels = [];
    return this.surface.begin();
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
  private leader(race: Race) {
    return race.runners.reduce((a, b) => (race.progress(b) > race.progress(a) ? b : a));
  }

  private laneOf(index: number): number {
    const p = this.opts.player;
    if (p < 0) return index;
    if (index === p) return 0;
    return index < p ? index + 1 : index;
  }

  private render(): void {
    const { W, H } = this.resize();
    const ctx = this.ctx;
    const race = this.race;
    const mode = this.opts.mode;
    const n = race ? race.runners.length : 1;
    const player = race ? (race.runners[this.opts.player] ?? this.leader(race)) : undefined;
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

    if (!race) {
      this.surface.present();
      return;
    }
    // 从后往前画：后排的马先画，被前排挡住。
    const order = race.runners.map((r, i) => ({ r, i, lane: this.laneOf(i) })).sort((a, b) => b.lane - a.lane);
    for (const { r, lane } of order) {
      const view = views[Math.min(lane, views.length - 1)] as View;
      this.drawDust(view, lane, palette.ground);
      const pose = r.horse.pose();
      const look = lookFor(r.horse.plan, sc.rim);
      // 远处的马淡一点，突出玩家的马。
      drawPixelHorse(ctx, pose, r.horse.plan, look, view, mode === "race" ? 1 - 0.05 * lane : 1);
    }
    const screen = this.surface.present();
    for (const l of this.labels) pixelText(screen, l.text, l.x, l.y, { color: l.color, align: "center" });
    if (mode === "race")
      for (const { r, i, lane } of order) {
        const view = views[Math.min(lane, views.length - 1)] as View;
        this.drawTag(screen, view, r.horse.pose(), r.horse.plan, r.entrant.name, i === this.opts.player);
      }
    this.drawHud(screen, W, race);
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
      if (isEnd || m % 100 === 0) this.labels.push({ x: bx, y: by - 40, text: m === distance ? "终点" : m === 0 ? "起点" : `${m}`, color: isEnd ? "#fff2d0" : "#f6d05a" });
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
    for (let m = Math.max(0, Math.ceil(left / 5) * 5); m <= right; m += 5) {
      const [x, y] = toScreen(view, { x: m, y: 0 });
      ctx.fillStyle = rgba(rim, 0.7);
      ctx.fillRect(x - PX, y + 4, PX, 12);
      this.labels.push({ x, y: y + 18, text: `${m}米`, color: "#fff2d0" });
    }
  }

  private drawTag(s: CanvasRenderingContext2D, view: View, pose: HorsePose, plan: BodyPlan, name: string, mine: boolean): void {
    // 名牌挂在头顶上方。
    const a = pose.neck.angle + NECK_ANGLE;
    const head = { x: pose.neck.x + Math.cos(a) * plan.neckLength, y: pose.neck.y + Math.sin(a) * plan.neckLength };
    const [x, y] = toScreen(view, { x: head.x, y: Math.max(head.y, pose.torso.y) + 0.45 });
    const k = mine ? 2 : 1;
    const tw = (name.length * 12 + 6) * k;
    pixelBox(s, x - tw / 2 - 2 * k, y - 22 * k, tw + 4 * k, 18 * k, k, mine ? "red" : "plank");
    pixelText(s, name, x, y - 22 * k, { scale: k, align: "center", line: null });
  }

  private drawHud(s: CanvasRenderingContext2D, W: number, race: Race): void {
    const mode = this.opts.mode;
    if (mode === "preview") return;
    const me = race.runners[this.opts.player] ?? this.leader(race);
    if (!me) return;
    const dist = Math.max(0, race.progress(me));
    const speed = Math.max(0, me.horse.pose().speed);
    // 计时木框。
    pixelBox(s, 12, 12, 252, 114, PX, "wood");
    const remaining = Math.max(0, race.options.timeLimit - race.raceTime);
    const clock = mode === "trial" ? `${remaining.toFixed(1)}秒` : `${race.raceTime.toFixed(1)}秒`;
    pixelText(s, race.started ? clock : "预备", 36, 24, { color: "#3b1c0e", line: null, scale: 3 });
    pixelText(s, `${dist.toFixed(0)}米`, 36, 70, { color: "#8a5a32", line: null, scale: 2 });
    pixelText(s, me.horse.state === "fallen" ? "摔倒" : `${(speed * 3.6).toFixed(0)}公里/时`, 240, 70, { color: me.horse.state === "fallen" ? "#d23a2a" : "#8a5a32", line: null, scale: 2, align: "right" });

    if (mode === "race") {
      // 顶部进度条：一根木槽，每匹马一个点。
      const x0 = 290;
      const x1 = W - 24;
      if (x1 - x0 < 80) return;
      const y = 30;
      pixelBox(s, x0 - 12, y - 12, x1 - x0 + 24, 24, PX, "plank");
      s.fillStyle = "#3b1c0e";
      s.fillRect(x0, y - 3, x1 - x0, 6);
      race.runners.forEach((r, i) => {
        if (i === this.opts.player) return;
        const t = Math.min(1, Math.max(0, race.progress(r) / race.options.distance));
        const px = Math.round(x0 + (x1 - x0) * t);
        s.fillStyle = "#3b1c0e";
        s.fillRect(px - 6, y - 6, 12, 12);
        s.fillStyle = "#fbe6b8";
        s.fillRect(px - 3, y - 3, 6, 6);
      });
      const t = Math.min(1, dist / race.options.distance);
      const px = Math.round(x0 + (x1 - x0) * t);
      s.fillStyle = "#3b1c0e";
      s.fillRect(px - 9, y - 9, 18, 18);
      s.fillStyle = "#f6d05a";
      s.fillRect(px - 6, y - 6, 12, 12);
      s.fillStyle = "#d23a2a";
      s.fillRect(px - 3, y - 3, 6, 6);
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
      ctx.fillStyle = rgba(color, 0.35 * d.life);
      const r = Math.max(PX, Math.round((d.size * view.ppm) / PX) * PX);
      ctx.fillRect(Math.round(x / PX) * PX - r, Math.round(y / PX) * PX - r, r * 2, r * 2);
    }
  }
}
