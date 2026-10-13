import type { BodyPlan } from "../body/bodyPlan";
import { mix, rgba, shade } from "../render/color";
import { drawCrowd } from "../render/crowd";
import { lookFor, toScreen, type HorseBubble, type View } from "../render/horseArt";
import { thinkBubble } from "../world/labels";
import { drawScene, drawTrackDetails, PALETTES, type Palette, type TimeOfDay } from "../render/scene";
import type { HorsePose } from "../sim/horse";
import { STEP, type Race } from "../sim/race";
import { hashSeed } from "../sim/rng";
import { lightSprite } from "../world/lighting";
import { drawPixelHorse, PixelSurface, pixelBox, pixelText, PX } from "./pixelCanvas";
import { drawCharacter, drawProp } from "../render/storyAssets";
import { groundHeight, TERRAIN_LABELS, terrainAt } from "../sim/terrain";

/** 看台离镜头比最后一条泳道还远一点，按这个比例慢一些地滚动（视差）。 */
const CROWD_DEPTH = 0.8;
/** 一段看台多长（米）。 */
const SECTION = 24;

const NECK_ANGLE = 0.95;

export type StageMode = "preview" | "trial" | "race" | "circus";

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
  title?: string;
  program?: "haul" | "jump" | "balance";
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
    const sc = drawScene(ctx, W, H, this.time, this.camX * front.ppm * 0.6, this.wall * 1000, horizon / H, PX);
    const palette = PALETTES[this.time];

    if (mode === "race" && race) this.drawRaceTrack(views, race, palette, horizon);
    else drawTrackDetails(ctx, W, H, this.time, this.camX * front.ppm, front.groundY, front.ppm * 2.5, PX);
    if (mode === "trial") this.drawMeterMarks(front, palette.rim);
    if (race?.options.terrains) this.drawTerrain(front, race, H);
    if (mode === "circus") {
      drawProp(ctx,0,W*0.83,H*0.66,Math.min(380,H*0.65));
      drawProp(ctx,7,W*0.26,H*0.65,Math.min(250,H*0.4));
      if(this.opts.program==="jump")drawProp(ctx,5,W*0.68,H*0.87,Math.min(170,H*0.27));
      if(this.opts.program==="balance")drawProp(ctx,6,W*0.57,H*0.93,Math.min(220,H*0.34));
    }

    if (!race) {
      this.surface.present();
      return;
    }
    // 从后往前画：后排的马先画，被前排挡住。
    const bubbles: HorseBubble[] = [];
    const order = race.runners.map((r, i) => ({ r, i, lane: this.laneOf(i) })).sort((a, b) => b.lane - a.lane);
    for (const { r, lane } of order) {
      const view = views[Math.min(lane, views.length - 1)] as View;
      this.drawDust(view, lane, palette);
      const pose = r.horse.pose();
      const look = lookFor(r.horse.plan, sc.rim);
      // 远处的马淡一点，突出玩家的马。
      const bubble = drawPixelHorse(ctx, pose, r.horse.plan, look, view, mode === "race" ? 1 - 0.05 * lane : 1);
      if (bubble) bubbles.push(bubble);
      if(mode==="circus"&&this.opts.program==="haul"){
        const [hx,hy]=toScreen(view,pose.torso);
        drawProp(ctx,4,hx-view.ppm*3,view.groundY,view.ppm*2.5);
        ctx.strokeStyle="#b69467";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(hx-view.ppm*1.9,hy);ctx.lineTo(hx-view.ppm*0.4,hy);ctx.stroke();
      }
    }
    if (mode === "circus") drawCharacter(ctx,"米娅",Math.floor(this.wall*2)%3===2?2:1,W*0.93,H*0.92,Math.min(210,H*0.27));
    if (mode === "race") this.drawForeground(front, palette);
    const screen = this.surface.present();
    if(this.opts.title)pixelText(screen,this.opts.title,W/2,30,{color:"#fbefd4",align:"center"});
    if(race.options.terrains&&player){
      const terrain=terrainAt(race.progress(player),race.options.distance,race.options.terrains);
      pixelText(screen,TERRAIN_LABELS[terrain],W/2,66,{color:"#efcf7f",align:"center"});
    }
    for (const b of bubbles) thinkBubble(screen, b.x, b.y, b.text, 2);
    for (const l of this.labels) pixelText(screen, l.text, l.x, l.y, { color: l.color, align: "center" });
    if (mode === "race")
      for (const { r, i, lane } of order) {
        const view = views[Math.min(lane, views.length - 1)] as View;
        this.drawTag(screen, view, r.horse.pose(), r.horse.plan, r.entrant.name, i === this.opts.player);
      }
    this.drawHud(screen, W, race);
  }

  /** 画面与碰撞面使用同一个高度函数，低枝也放在实际碰撞的位置。 */
  private drawTerrain(view: View, race: Race, H: number): void {
    const c = this.ctx;
    const terrains = race.options.terrains!;
    const distance = race.options.distance;
    const colors = { grass: "#819760", wetland: "#647e76", hill: "#9c9965", coast: "#c5b48b", forest: "#657951", mountain: "#d9e1dc" };
    const left = Math.floor(this.camX - view.width / view.ppm);
    const right = Math.ceil(this.camX + view.width / view.ppm);
    for (let x = left; x < right; x += 0.5) {
      const terrain = terrainAt(x, distance, terrains);
      const [sx, sy] = toScreen(view, { x, y: groundHeight(x, distance, terrains) });
      const [ex, ey] = toScreen(view, { x: x + 0.5, y: groundHeight(x + 0.5, distance, terrains) });
      c.fillStyle = colors[terrain];
      c.beginPath();c.moveTo(sx, sy);c.lineTo(ex, ey);c.lineTo(ex, H);c.lineTo(sx, H);c.fill();
      c.fillStyle = terrain === "mountain" ? "#f0f4e9" : terrain === "wetland" ? "#9fbcb6" : "#b5bc7d";
      c.fillRect(Math.round(sx), Math.round(sy), Math.ceil(ex-sx), 3);
      if ((terrain === "wetland" || terrain === "coast") && Math.floor(x * 2) % 4 === 0) {
        c.fillStyle = "#8cbcc1";c.fillRect(Math.round(sx), Math.round(sy + 15), 14, 3);
      }
    }
    for (let x = 8; x < distance; x += 15) {
      if (x < left - 4 || x > right + 4 || terrainAt(x, distance, terrains) !== "forest") continue;
      const [sx, sy] = toScreen(view, { x, y: 2.3 });
      c.fillStyle = "#6b4b30";c.fillRect(Math.round(sx), Math.round(sy), view.ppm * 3, 9);
      c.fillStyle = "#385c42";c.fillRect(Math.round(sx + 9), Math.round(sy - 12), view.ppm * 2, 12);
    }
    const current = terrainAt(this.camX, distance, terrains);
    if (current === "coast") drawProp(c, 10, view.width * 0.83, view.groundY - 40, 190);
    if (current === "mountain") drawProp(c, 9, view.width * 0.82, view.groundY - 40, 190);
  }

  /**
   * 平地赛的赛场：远处是一段段看台和人群（终点附近是带顶棚的大看台），
   * 外圈白栏杆、一条条泳道的土、起点终点线和距离杆。全按缓冲像素画，放大后不糊。
   */
  private drawRaceTrack(views: View[], race: Race, P: Palette, horizon: number): void {
    const ctx = this.ctx;
    const back = views[views.length - 1] as View;
    const front = views[0] as View;
    const bw = Math.ceil(front.width / PX);
    const bh = Math.ceil(this.surface.H / PX);
    const hy = Math.round(horizon / PX);
    const distance = race.options.distance;
    const lit = P.stars > 0.2;
    const t = this.wall;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const rect = (x: number, y: number, w: number, h: number, c: string): void => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };

    /* ---- 看台和人群 ---- */
    const cppm = (back.ppm * CROWD_DEPTH) / PX;
    const anchorX = bw * (back.anchor ?? 0.5);
    const toCrowd = (m: number): number => (m - this.camX) * cppm + anchorX;
    const fromCrowd = (x: number): number => (x - anchorX) / cppm + this.camX;
    const offset = this.camX * cppm - anchorX;
    const lead = Math.max(...race.runners.map((r) => r.horse.pose().torso.x));
    const cheer = (x: number): number => {
      const m = fromCrowd(x);
      const near = Math.max(0, 1 - Math.abs(m - lead) / 30);
      return Math.min(1, 0.08 + near * 0.9 + (race.finished ? 0.5 : 0) + (m > distance - 60 ? 0.15 : 0));
    };
    const haze = P.fog;
    const base = hy - 2;
    const lamps: Array<[number, number]> = [];
    const s0 = Math.floor(fromCrowd(-30) / SECTION);
    const s1 = Math.floor(fromCrowd(bw + 30) / SECTION);
    for (let si = s0; si <= s1; si++) {
      const xa = Math.round(toCrowd(si * SECTION));
      const xb = Math.round(toCrowd((si + 1) * SECTION));
      const h = hashSeed(`看台${si}`);
      const grand = (si + 1) * SECTION > distance - 130 && si * SECTION < distance + 40;
      const kind = grand ? "grand" : si * SECTION < -40 ? (h % 2 ? "trees" : "stand") : h % 10 < 5 ? "bleach" : h % 10 < 8 ? "stand" : "trees";
      const crowd = (rows: number, seats: boolean, density: number): void =>
        drawCrowd(ctx, { x0: xa, x1: xb, base, rows, offset, time: t, cheer, seed: `${si}`, haze, hazeAmount: 0.18, seats, density });
      if (kind === "grand") {
        // 大看台：深色后墙、六排座位、顶棚和彩旗边，几根白柱子。
        const rows = 6;
        const top = base - rows * 6 - 12;
        rect(xa, top + 6, xb - xa, base - top - 6, mix("#4a3020", haze, 0.3));
        crowd(rows, true, 0.92);
        for (let x = xa + ((si * 7) % 30); x < xb; x += 30) rect(x, top + 6, 2, base - top - 6, mix("#f4f1e6", haze, 0.2));
        rect(xa - 1, top, xb - xa + 2, 6, mix("#3c4a5e", haze, 0.25));
        rect(xa - 1, top, xb - xa + 2, 1, mix("#6a7a90", haze, 0.25));
        for (let x = xa; x < xb; x += 4) rect(x, top + 6, 4, 2, Math.floor(x / 4) % 2 ? mix("#f4ead2", haze, 0.2) : mix("#c9302a", haze, 0.2));
        for (let x = xa + 2; x < xb; x += 8) rect(x + 1, top + 8, 2, 1, Math.floor(x / 8) % 2 ? mix("#f4ead2", haze, 0.2) : mix("#c9302a", haze, 0.2));
        if (si % 2 === 0) lamps.push([xa + 4, top - 18]);
        // 顶棚正中挂块大牌子。
        const mid = Math.floor((distance - 50) / SECTION);
        if (si === mid) {
          const cx = Math.round((xa + xb) / 2);
          rect(cx - 30, top - 12, 60, 12, "#3b1c0e");
          rect(cx - 29, top - 11, 58, 10, "#c9302a");
          rect(cx - 29, top - 11, 58, 1, "#f06a50");
          this.labels.push({ x: cx * PX, y: (top - 13) * PX, text: "马蹄镇赛马", color: "#f6d05a" });
        }
      } else if (kind === "bleach") {
        crowd(3, true, 0.8);
        if (si % 3 === 0) lamps.push([xa + 2, base - 44]);
        // 一根旗杆，上面一面小三角旗。
        const fx = xa + 3;
        rect(fx, base - 32, 1, 32, mix("#5a4632", haze, 0.2));
        const wave = Math.sin(t * 5 + si) > 0 ? 1 : 0;
        rect(fx + 1, base - 32 + wave, 6, 2, mix(["#d8443a", "#f2b632", "#3f7fd0", "#4fa64a"][h % 4]!, haze, 0.2));
        rect(fx + 1, base - 30 + wave, 3, 1, mix(["#d8443a", "#f2b632", "#3f7fd0", "#4fa64a"][h % 4]!, haze, 0.2));
      } else if (kind === "stand") {
        // 站着看的人，中间一顶条纹帐篷（卖吃的）。
        const tx = Math.round((xa + xb) / 2) - 14;
        if (h % 3 !== 0) {
          for (let x = 0; x < 28; x++) {
            const c = Math.floor(x / 4) % 2 ? "#f4ead2" : ["#c9302a", "#3f6fb0", "#4f8f30"][h % 3]!;
            rect(tx + x, base - 22 + Math.abs(14 - x) / 5, 1, 6, mix(c, haze, 0.25));
          }
          rect(tx + 1, base - 16, 1, 16, mix("#5a3a22", haze, 0.25));
          rect(tx + 26, base - 16, 1, 16, mix("#5a3a22", haze, 0.25));
          rect(tx + 2, base - 7, 24, 5, mix("#9a6232", haze, 0.25));
        }
        crowd(2, false, 0.7);
      } else {
        // 几棵树，树下零星几个人。
        for (let k = 0; k < 3; k++) {
          const cx = xa + ((xb - xa) * (k + 0.5)) / 3 + ((h >>> (k * 3)) % 7) - 3;
          const r = 7 + ((h >>> (k * 4)) % 4);
          const g = mix(P.hills[3], P.grass, 0.4);
          rect(cx - 1, base - 8, 2, 8, mix("#4a3020", haze, 0.35));
          for (let dy = -r; dy <= r; dy++) {
            const w = Math.round(Math.sqrt(r * r - dy * dy));
            rect(cx - w, base - 8 - r + dy, w * 2, 1, dy < -r / 3 ? shade(g, 0.12) : g);
          }
        }
        crowd(1, false, 0.3);
      }
    }
    // 夜里和傍晚，看台上的探照灯亮着。
    for (const [x, y] of lamps) {
      rect(x, y, 1, base - y, mix("#8a9098", haze, 0.3));
      rect(x - 2, y - 2, 5, 3, "#3a3e46");
      rect(x - 1, y - 1, 3, 1, lit ? "#fff6d8" : "#c6ccd4");
    }
    if (lit) {
      ctx.globalCompositeOperation = "lighter";
      for (const [x, y] of lamps) {
        ctx.globalAlpha = 0.75;
        ctx.drawImage(lightSprite(18, "#fff0c8"), x - 18, y - 18);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    /* ---- 跑道：一条条泳道的土 ---- */
    const g = views.map((v) => Math.round(v.groundY / PX));
    const dirt = dirtColor(P);
    rect(0, hy, bw, bh - hy, shade(dirt, -0.08));
    for (let i = views.length - 1; i >= 0; i--) {
      const top = i === views.length - 1 ? hy + 2 : Math.round((g[i]! + g[i + 1]!) / 2);
      const bot = i === 0 ? bh : Math.round((g[i]! + g[i - 1]!) / 2);
      const depth = views.length > 1 ? i / (views.length - 1) : 0;
      const c = mix(i % 2 ? shade(dirt, -0.06) : dirt, P.fog, depth * 0.18);
      rect(0, top, bw, bot - top, c);
      rect(0, g[i]! + 2, bw, 1, shade(c, -0.12));
      rect(0, top, bw, 1, shade(c, 0.08));
      // 土里的小石子和蹄印，跟着这条泳道的远近一起滚动。
      const v = views[i] as View;
      const left = this.camX - ((v.anchor ?? 0.5) * v.width) / v.ppm;
      const right = left + v.width / v.ppm;
      const stepM = Math.max(0.12, (3 * PX) / v.ppm);
      for (let m = Math.floor(left / stepM) * stepM; m < right; m += stepM) {
        const hh = hashSeed(`土${i}:${Math.round(m / stepM)}`);
        if (hh % 5 > 1) continue;
        const [x] = toScreen(v, { x: m, y: 0 });
        const y = top + 1 + (hh >>> 4) % Math.max(1, bot - top - 2);
        rect(x / PX, y, hh % 7 === 0 ? 2 : 1, 1, (hh >>> 8) % 2 ? shade(c, 0.14) : shade(c, -0.18));
      }
    }

    /* ---- 外圈栏杆 ---- */
    const rail = mix("#f4f1e6", haze, 0.12);
    const railShade = mix("#9a9584", haze, 0.12);
    rect(0, hy - 3, bw, 1, rail);
    rect(0, hy - 2, bw, 1, railShade);
    rect(0, hy, bw, 1, rail);
    const bl = this.camX - ((back.anchor ?? 0.5) * back.width) / back.ppm;
    const br = bl + back.width / back.ppm;
    for (let m = Math.floor(bl / 2) * 2; m < br; m += 2) {
      const x = Math.round(toScreen(back, { x: m, y: 0 })[0] / PX);
      rect(x, hy - 4, 1, 6, rail);
      rect(x + 1, hy - 3, 1, 5, railShade);
    }

    /* ---- 起点、终点、距离杆 ---- */
    for (let m = 0; m <= distance; m += 25) {
      const [bx, by] = toScreen(back, { x: m, y: 0 });
      const [fx, fy] = toScreen(front, { x: m, y: 0 });
      if (Math.max(bx, fx) < -40 || Math.min(bx, fx) > front.width + 40) continue;
      const isEnd = m === 0 || m === distance;
      const y0 = Math.round(by / PX) - 1;
      const y1 = Math.round(fy / PX) + 3;
      for (let y = y0; y <= y1; y++) {
        const k = (y - y0) / Math.max(1, y1 - y0);
        const x = Math.round((bx + (fx - bx) * k) / PX);
        if (m === distance) {
          rect(x - 1, y, 1, 1, (y + 0) % 2 ? "#2a2a2a" : "#fbfaf2");
          rect(x, y, 1, 1, (y + 1) % 2 ? "#2a2a2a" : "#fbfaf2");
          rect(x + 1, y, 1, 1, y % 2 ? "#2a2a2a" : "#fbfaf2");
        } else if (isEnd) rect(x - 1, y, 2, 1, "#fbfaf2");
        else if (m % 100 === 0 && y % 3 === 0) rect(x, y, 1, 1, mix("#fbfaf2", dirt, 0.5));
      }
      // 外栏上的距离杆：每 100 米红牌子。
      const px = Math.round(bx / PX);
      rect(px, hy - 12, 1, 12, rail);
      rect(px - 1, hy - 15, 3, 3, m % 100 === 0 || isEnd ? "#d23a2a" : "#f4f1e6");
      if (isEnd || m % 100 === 0) this.labels.push({ x: bx, y: by - 40, text: m === distance ? "终点" : m === 0 ? "起点" : `${m}`, color: isEnd ? "#fff2d0" : "#f6d05a" });
      if (m === distance) {
        // 终点：高高的旗杆，挂一面黑白格的旗。
        rect(px, hy - 40, 2, 40, "#e8e4d8");
        const wave = Math.round(Math.sin(t * 6) * 1);
        for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 10; xx++) rect(px + 2 + xx, hy - 40 + yy + (xx > 5 ? wave : 0), 1, 1, (Math.floor(xx / 2) + Math.floor(yy / 2)) % 2 ? "#2a2a2a" : "#fbfaf2");
      }
    }
    ctx.restore();
  }

  /** 最前面的内圈栏杆和一窄条草地，比马还近，滚得快一点。 */
  private drawForeground(front: View, P: Palette): void {
    const ctx = this.ctx;
    const bw = Math.ceil(front.width / PX);
    const bh = Math.ceil(this.surface.H / PX);
    const y = bh - 6;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const grass = mix(P.grass, "#4f8a3a", 0.35);
    ctx.fillStyle = grass;
    ctx.fillRect(0, y + 2, bw, bh - y - 2);
    const ppm = (front.ppm * 1.15) / PX;
    const ax = bw * (front.anchor ?? 0.5);
    const left = this.camX - ax / ppm;
    ctx.fillStyle = shade(grass, 0.18);
    for (let m = Math.floor(left / 0.7) * 0.7; m < left + bw / ppm; m += 0.7) {
      const x = Math.round((m - this.camX) * ppm + ax);
      const hh = hashSeed(`草${Math.round(m / 0.7)}`);
      ctx.fillRect(x, y + 2 + (hh % 3), 1, 2);
    }
    const rail = mix("#f4f1e6", P.rim, 0.15);
    ctx.fillStyle = rail;
    ctx.fillRect(0, y - 2, bw, 1);
    ctx.fillRect(0, y + 1, bw, 1);
    for (let m = Math.floor(left / 2.5) * 2.5; m < left + bw / ppm; m += 2.5) {
      const x = Math.round((m - this.camX) * ppm + ax);
      ctx.fillStyle = rail;
      ctx.fillRect(x, y - 3, 2, 9);
      ctx.fillStyle = "#9a9584";
      ctx.fillRect(x + 1, y - 2, 1, 8);
    }
    ctx.restore();
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

  /** 扬起的土：缓冲里的方块，越旧越淡。 */
  private drawDust(view: View, lane: number, P: Palette): void {
    const ctx = this.ctx;
    const light = mix(dirtColor(P), "#ffffff", 0.25);
    const dark = shade(dirtColor(P), -0.1);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const d of this.dust) {
      if (d.lane !== lane) continue;
      const [x, y] = toScreen(view, d);
      const r = Math.max(1, Math.round((d.size * view.ppm) / PX));
      ctx.globalAlpha = d.life > 0.6 ? 0.75 : d.life > 0.3 ? 0.5 : 0.25;
      ctx.fillStyle = d.life > 0.5 ? light : dark;
      ctx.fillRect(Math.round(x / PX) - r, Math.round(y / PX) - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/** 跑道的土色：白天亮，傍晚、夜里沉下去。 */
function dirtColor(P: Palette): string {
  return mix("#b87c4c", P.ground, P.stars > 0.6 ? 0.6 : P.stars > 0.2 ? 0.38 : 0.18);
}
