/**
 * 大世界里的小动静：鸡、鸭、蝴蝶、飞鸟、萤火虫、炊烟、落叶、跑步扬起的土、镇上走来走去的人。
 * 都不影响玩法，只让世界活起来。
 */
import { BUILDINGS, POND, T, TILE, tileAt } from "./tiles";
import { canvas, outline, personFrame, roofTop, type Dir, type PersonLook } from "./sprites";

type Ctx = CanvasRenderingContext2D;

export interface Drawable {
  y: number;
  draw: () => void;
}

interface View {
  cx: number;
  cy: number;
  bw: number;
  bh: number;
}

/* ---------------- 小动物的像素图 ---------------- */

const cache = new Map<string, HTMLCanvasElement>();

function art(key: string, w: number, h: number, draw: (ctx: Ctx) => void, line: string | null = "#2a1a12"): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) {
    const [cv, ctx] = canvas(w, h);
    draw(ctx);
    if (line) outline(cv, line, 100);
    c = cv;
    cache.set(key, c);
  }
  return c;
}

const r = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void => {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};

/** 鸡：frame 0/1 走路，2 低头啄食。朝右画，朝左时翻转。 */
function chicken(frame: number, brown: boolean): HTMLCanvasElement {
  return art(`chick:${frame}:${brown}`, 14, 14, (ctx) => {
    const body = brown ? "#c8823a" : "#f4f0e6";
    const shade = brown ? "#9a5a24" : "#d6d0c2";
    r(ctx, 2, 5, 8, 6, body);
    r(ctx, 1, 4, 3, 3, body);
    r(ctx, 3, 9, 6, 2, shade);
    r(ctx, 4, 6, 3, 2, shade);
    if (frame === 2) {
      r(ctx, 9, 8, 3, 3, body);
      r(ctx, 12, 9, 1, 1, "#f2a93b");
      r(ctx, 10, 7, 1, 1, "#d8402a");
      r(ctx, 10, 9, 1, 1, "#2a1a12");
    } else {
      r(ctx, 8, 2, 3, 4, body);
      r(ctx, 11, 3, 2, 1, "#f2a93b");
      r(ctx, 9, 1, 2, 1, "#d8402a");
      r(ctx, 10, 3, 1, 1, "#2a1a12");
    }
    r(ctx, 4 + (frame === 1 ? 1 : 0), 11, 1, 2, "#f2a93b");
    r(ctx, 7 - (frame === 1 ? 1 : 0), 11, 1, 2, "#f2a93b");
  });
}

function duck(frame: number): HTMLCanvasElement {
  return art(`duck:${frame}`, 14, 10, (ctx) => {
    r(ctx, 1, 4, 9, 4, "#f4f0e6");
    r(ctx, 0, 3, 3, 2, "#f4f0e6");
    r(ctx, 3, 5, 5, 2, "#d6d0c2");
    r(ctx, 8, 1, 3, 4, "#3f8a3a");
    r(ctx, 11, 2 + frame, 2, 1, "#f2a93b");
    r(ctx, 9, 2, 1, 1, "#2a1a12");
  });
}

function butterfly(frame: number, color: string): HTMLCanvasElement {
  return art(
    `fly:${frame}:${color}`,
    7,
    5,
    (ctx) => {
      r(ctx, 3, 1, 1, 3, "#2a1a12");
      if (frame === 0) {
        r(ctx, 0, 0, 3, 2, color);
        r(ctx, 4, 0, 3, 2, color);
        r(ctx, 1, 2, 2, 2, color);
        r(ctx, 4, 2, 2, 2, color);
      } else {
        r(ctx, 1, 1, 2, 2, color);
        r(ctx, 4, 1, 2, 2, color);
      }
    },
    null,
  );
}

function bird(frame: number): HTMLCanvasElement {
  return art(
    `bird:${frame}`,
    9,
    5,
    (ctx) => {
      r(ctx, 3, 2, 3, 2, "#3a2a24");
      r(ctx, 6, 2, 2, 1, "#3a2a24");
      if (frame === 0) {
        r(ctx, 0, 0, 3, 1, "#3a2a24");
        r(ctx, 2, 1, 2, 1, "#3a2a24");
        r(ctx, 5, 1, 2, 1, "#3a2a24");
        r(ctx, 6, 0, 3, 1, "#3a2a24");
      } else {
        r(ctx, 0, 3, 3, 1, "#3a2a24");
        r(ctx, 6, 3, 3, 1, "#3a2a24");
      }
    },
    null,
  );
}

/* ---------------- 状态 ---------------- */

interface Critter {
  x: number;
  z: number;
  tx: number;
  tz: number;
  wait: number;
  facing: 1 | -1;
  phase: number;
}

interface Walker {
  look: PersonLook;
  path: Array<[number, number]>;
  i: number;
  x: number;
  z: number;
  dir: Dir;
  wait: number;
  phase: number;
}

interface Puff {
  x: number;
  y: number;
  t: number;
  size: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  color: string;
}

const CHICKEN_PEN = { x0: 20.5, z0: 52.2, x1: 29.5, z1: 55 };

const WALKERS: Array<{ look: PersonLook; path: Array<[number, number]> }> = [
  {
    look: { hat: "none", hair: "#5a3a22", skin: "#f0c8a4", shirt: "#d07a2a", shirtDark: "#9a5418", pants: "#3a3a4a" },
    path: [
      [44, 15],
      [56, 15],
      [56, 24],
      [70, 24],
      [70, 15],
      [56, 15],
    ],
  },
  {
    look: { hat: "bun", hair: "#1e1a18", skin: "#ecc6a0", shirt: "#5a8ac8", shirtDark: "#3a62a0", pants: "#2a2a30" },
    path: [
      [72, 26],
      [72, 14],
      [48, 14],
      [48, 26],
    ],
  },
  {
    look: { hat: "straw", hair: "#3a2414", skin: "#d8a77e", shirt: "#8a6a9a", shirtDark: "#644a72", pants: "#4a3a2e" },
    path: [
      [32, 30],
      [32, 48],
      [32, 30],
      [38, 26],
    ],
  },
];

/** 冒炊烟的房子：家、老赵家、马市。 */
const CHIMNEYS = BUILDINGS.filter((b) => b.kind === "home" || b.kind === "zhao" || b.kind === "market");

const BUTTERFLY_COLORS = ["#f6f0ff", "#f6d84a", "#f19ab0", "#9ac8f6"];

export class Ambient {
  private chickens: Critter[] = [];
  private ducks: Array<{ a: number; r: number; speed: number }> = [];
  private walkers: Walker[] = [];
  private flies: Array<{ x: number; y: number; vx: number; vy: number; color: string; phase: number }> = [];
  private birds: Array<{ x: number; y: number; vx: number; phase: number }> = [];
  private birdTimer = 4;
  private puffs: Puff[] = [];
  private puffTimer = 0;
  private bits: Particle[] = [];
  private fireflies: Array<{ x: number; y: number; phase: number; speed: number }> = [];
  private ripples: Array<{ x: number; y: number; t: number }> = [];
  private time = 0;
  /** 夜里鸡回窝。 */
  private roost = false;

  constructor() {
    for (let i = 0; i < 5; i++) {
      const x = CHICKEN_PEN.x0 + Math.random() * (CHICKEN_PEN.x1 - CHICKEN_PEN.x0);
      const z = CHICKEN_PEN.z0 + Math.random() * (CHICKEN_PEN.z1 - CHICKEN_PEN.z0);
      this.chickens.push({ x, z, tx: x, tz: z, wait: Math.random() * 2, facing: 1, phase: Math.random() * 10 });
    }
    for (let i = 0; i < 3; i++) this.ducks.push({ a: (i / 3) * Math.PI * 2, r: 1.6 + i * 0.8, speed: 0.12 + i * 0.05 });
    for (const w of WALKERS) {
      const [x, z] = w.path[0]!;
      this.walkers.push({ look: w.look, path: w.path, i: 1, x, z, dir: "down", wait: 0, phase: 0 });
    }
  }

  update(dt: number, view: View, clock: number, player: { x: number; z: number; running: boolean; moving: boolean }): void {
    this.time += dt;
    const day = clock > 6.5 * 60 && clock < 19 * 60;
    this.roost = clock > 20 * 60 || clock < 6 * 60;
    // 鸡：走两步、停下啄食。
    for (const c of this.chickens) {
      c.phase += dt;
      const dx = c.tx - c.x;
      const dz = c.tz - c.z;
      const d = Math.hypot(dx, dz);
      if (c.wait > 0) c.wait -= dt;
      else if (d < 0.1) {
        c.wait = 1 + Math.random() * 3;
        c.tx = CHICKEN_PEN.x0 + Math.random() * (CHICKEN_PEN.x1 - CHICKEN_PEN.x0);
        c.tz = CHICKEN_PEN.z0 + Math.random() * (CHICKEN_PEN.z1 - CHICKEN_PEN.z0);
      } else {
        const sp = 1.4 * dt;
        c.x += (dx / d) * Math.min(sp, d);
        c.z += (dz / d) * Math.min(sp, d);
        if (Math.abs(dx) > 0.05) c.facing = dx > 0 ? 1 : -1;
      }
      // 人靠近就扑腾着跑开。
      const pd = Math.hypot(c.x - player.x, c.z - player.z);
      if (pd < 1.4) {
        c.tx = Math.max(CHICKEN_PEN.x0, Math.min(CHICKEN_PEN.x1, c.x + ((c.x - player.x) / pd) * 3));
        c.tz = Math.max(CHICKEN_PEN.z0, Math.min(CHICKEN_PEN.z1, c.z + ((c.z - player.z) / pd) * 3));
        c.wait = 0;
      }
    }
    for (const d of this.ducks) d.a += d.speed * dt;
    // 镇上的人沿着路线来回走。
    for (const w of this.walkers) {
      if (w.wait > 0) {
        w.wait -= dt;
        continue;
      }
      const [tx, tz] = w.path[w.i]!;
      const dx = tx - w.x;
      const dz = tz - w.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) {
        w.i = (w.i + 1) % w.path.length;
        w.wait = Math.random() < 0.4 ? 1.5 + Math.random() * 2 : 0;
        continue;
      }
      const sp = Math.min(d, 2 * dt);
      w.x += (dx / d) * sp;
      w.z += (dz / d) * sp;
      w.phase += dt * 6;
      w.dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up";
    }
    // 蝴蝶：白天在镜头里的草地上飞。
    const want = day ? 7 : 0;
    while (this.flies.length < want) {
      const x = view.cx + Math.random() * view.bw;
      const y = view.cy + Math.random() * view.bh;
      const k = tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
      if (k !== T.meadow && k !== T.grass && k !== T.paddock) {
        if (Math.random() < 0.7) break;
        continue;
      }
      this.flies.push({ x, y, vx: 0, vy: 0, color: BUTTERFLY_COLORS[Math.floor(Math.random() * 4)]!, phase: Math.random() * 10 });
    }
    if (!day && this.flies.length) this.flies.length = 0;
    for (const f of this.flies) {
      f.phase += dt;
      f.vx += (Math.random() - 0.5) * 60 * dt;
      f.vy += (Math.random() - 0.5) * 60 * dt;
      f.vx *= 0.96;
      f.vy *= 0.96;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.flies = this.flies.filter((f) => f.x > view.cx - 40 && f.x < view.cx + view.bw + 40 && f.y > view.cy - 40 && f.y < view.cy + view.bh + 40);
    // 鸟：白天隔一阵飞过一小群。
    this.birdTimer -= dt;
    if (day && this.birdTimer <= 0) {
      this.birdTimer = 10 + Math.random() * 14;
      const y = view.cy + 20 + Math.random() * (view.bh * 0.5);
      for (let i = 0; i < 3; i++) this.birds.push({ x: view.cx - 20 - i * 12, y: y + (i % 2) * 8 + i * 4, vx: 46 + Math.random() * 6, phase: i });
    }
    for (const b of this.birds) {
      b.x += b.vx * dt;
      b.phase += dt * 8;
    }
    this.birds = this.birds.filter((b) => b.x < view.cx + view.bw + 60);
    // 炊烟：早晚做饭的时候冒得多。
    this.puffTimer -= dt;
    if (this.puffTimer <= 0) {
      const cooking = (clock > 6 * 60 && clock < 9 * 60) || (clock > 17 * 60 && clock < 21 * 60);
      this.puffTimer = cooking ? 0.35 : 0.9;
      for (const b of CHIMNEYS) {
        const [x, y] = chimneyAt(b);
        this.puffs.push({ x: x + Math.random() * 2 - 1, y, t: 0, size: 2 });
      }
    }
    for (const p of this.puffs) {
      p.t += dt;
      p.y -= 9 * dt;
      p.x += (4 + Math.sin(p.t * 2) * 3) * dt;
      p.size = 2 + p.t * 2.2;
    }
    this.puffs = this.puffs.filter((p) => p.t < 2.6);
    // 跑步扬起的土。
    if (player.moving && player.running && Math.random() < dt * 14) {
      this.bits.push({ x: player.x * TILE + (Math.random() - 0.5) * 6, y: player.z * TILE, vx: (Math.random() - 0.5) * 10, vy: -8, t: 0, life: 0.5, color: "#c9a46a" });
    }
    // 树下偶尔飘一片叶子。
    if (Math.random() < dt * 0.8) {
      const x = view.cx + Math.random() * view.bw;
      this.bits.push({ x, y: view.cy - 4, vx: 6, vy: 12, t: 0, life: 6, color: Math.random() < 0.5 ? "#8cc955" : "#e8b04a" });
    }
    for (const p of this.bits) {
      p.t += dt;
      p.x += (p.vx + (p.life > 1 ? Math.sin(p.t * 3) * 10 : 0)) * dt;
      p.y += p.vy * dt;
    }
    this.bits = this.bits.filter((p) => p.t < p.life);
    // 萤火虫：夜里在镜头里的草丛和水边。
    const flies = day ? 0 : 18;
    while (this.fireflies.length < flies) this.fireflies.push({ x: Math.random(), y: Math.random(), phase: Math.random() * 10, speed: 0.4 + Math.random() * 0.6 });
    if (day) this.fireflies.length = 0;
    // 河里偶尔有鱼跳起来的水花。
    if (Math.random() < dt * 0.5) {
      const x = Math.floor((view.cx + Math.random() * view.bw) / TILE);
      const z = Math.floor((view.cy + Math.random() * view.bh) / TILE);
      if (tileAt(x, z) === T.water) this.ripples.push({ x: x * TILE + 8, y: z * TILE + 8, t: 0 });
    }
    for (const rp of this.ripples) rp.t += dt;
    this.ripples = this.ripples.filter((rp) => rp.t < 1.4);
  }

  /** 和人、树一起按 y 排序的东西：鸡、鸭、行人。 */
  collect(items: Drawable[], b: Ctx, view: View, shadow: (b: Ctx, x: number, y: number, r: number) => void): void {
    const { cx, cy, bw, bh } = view;
    const vis = (x: number, y: number): boolean => x > cx - 30 && x < cx + bw + 30 && y > cy - 30 && y < cy + bh + 40;
    for (const c of this.roost ? [] : this.chickens) {
      const x = c.x * TILE;
      const y = c.z * TILE;
      if (!vis(x, y)) continue;
      const moving = Math.hypot(c.tx - c.x, c.tz - c.z) > 0.1 && c.wait <= 0;
      const frame = moving ? Math.floor(c.phase * 8) % 2 : Math.floor(c.phase * 1.3) % 3 === 0 ? 2 : 0;
      const img = chicken(frame, this.chickens.indexOf(c) % 2 === 1);
      items.push({
        y,
        draw: () => {
          shadow(b, x - cx, y - cy, 3);
          drawFlipped(b, img, Math.round(x - cx - 7), Math.round(y - cy - 13), c.facing);
        },
      });
    }
    for (const d of this.ducks) {
      const x = (POND.x + Math.cos(d.a) * d.r) * TILE;
      const y = (POND.z + Math.sin(d.a) * d.r * 0.8) * TILE;
      if (!vis(x, y)) continue;
      const facing = -Math.sin(d.a) > 0 ? 1 : -1;
      items.push({
        y,
        draw: () => {
          b.fillStyle = "rgba(220,240,255,0.6)";
          b.fillRect(Math.round(x - cx - 8 - facing * 3), Math.round(y - cy + 1), 4, 1);
          drawFlipped(b, duck(Math.floor(this.time * 2 + d.r) % 2), Math.round(x - cx - 7), Math.round(y - cy - 8), facing as 1 | -1);
        },
      });
    }
    for (const w of this.walkers) {
      const x = w.x * TILE;
      const y = w.z * TILE;
      if (!vis(x, y)) continue;
      const frame = w.wait > 0 ? 0 : Math.floor(w.phase) % 4;
      items.push({
        y,
        draw: () => {
          shadow(b, x - cx, y - cy, 5);
          b.drawImage(personFrame(w.look, w.dir, frame), Math.round(x - 9 - cx), Math.round(y - 26 - cy));
        },
      });
    }
  }

  /** 画在所有东西上面：炊烟、蝴蝶、落叶、扬土、水花、飞鸟（连地上的影子）。 */
  drawAbove(b: Ctx, view: View): void {
    const { cx, cy } = view;
    for (const rp of this.ripples) {
      const k = rp.t / 1.4;
      const rad = Math.round(2 + k * 6);
      b.fillStyle = `rgba(230,245,255,${0.8 * (1 - k)})`;
      b.fillRect(Math.round(rp.x - cx - rad), Math.round(rp.y - cy), rad * 2, 1);
      b.fillRect(Math.round(rp.x - cx - rad + 1), Math.round(rp.y - cy - Math.round(rad / 2)), 1, 1);
      b.fillRect(Math.round(rp.x - cx + rad - 1), Math.round(rp.y - cy - Math.round(rad / 2)), 1, 1);
      if (rp.t < 0.3) {
        b.fillStyle = "#e6f4ff";
        b.fillRect(Math.round(rp.x - cx), Math.round(rp.y - cy - 4 - rp.t * 10), 1, 2);
      }
    }
    for (const p of this.puffs) {
      const a = Math.max(0, 0.75 * (1 - p.t / 2.6));
      const s = Math.round(p.size);
      b.fillStyle = `rgba(220,220,226,${a})`;
      b.fillRect(Math.round(p.x - cx - s / 2), Math.round(p.y - cy - s / 2), s, s);
      b.fillStyle = `rgba(160,160,170,${a * 0.6})`;
      b.fillRect(Math.round(p.x - cx - s / 2), Math.round(p.y - cy + s / 2 - 1), s, 1);
    }
    for (const f of this.flies) {
      b.drawImage(butterfly(Math.floor(f.phase * 10) % 2, f.color), Math.round(f.x - cx - 3), Math.round(f.y - cy - 8 - Math.sin(f.phase * 3) * 2));
    }
    for (const p of this.bits) {
      b.fillStyle = p.color;
      b.globalAlpha = Math.max(0, 1 - p.t / p.life);
      b.fillRect(Math.round(p.x - cx), Math.round(p.y - cy), p.life > 1 ? 2 : 1, 1);
      b.globalAlpha = 1;
    }
    for (const bd of this.birds) {
      b.fillStyle = "rgba(0,0,0,0.15)";
      b.fillRect(Math.round(bd.x - cx + 10), Math.round(bd.y - cy + 46), 5, 2);
      b.drawImage(bird(Math.floor(bd.phase) % 2), Math.round(bd.x - cx), Math.round(bd.y - cy));
    }
  }

  /** 夜里的萤火虫，画在夜色之后，自己发光。 */
  drawNight(b: Ctx, view: View, night: number): void {
    if (night < 0.4) return;
    const { bw, bh } = view;
    b.globalCompositeOperation = "lighter";
    for (const f of this.fireflies) {
      const t = this.time * f.speed + f.phase;
      const x = Math.round(f.x * bw + Math.sin(t * 0.7) * 20);
      const y = Math.round(f.y * bh + Math.cos(t * 0.5) * 14);
      const glow = (Math.sin(t * 3) + 1) / 2;
      if (glow < 0.2) continue;
      b.fillStyle = `rgba(200,255,120,${0.25 * glow * night})`;
      b.fillRect(x - 2, y - 2, 5, 5);
      b.fillStyle = `rgba(230,255,160,${glow * night})`;
      b.fillRect(x, y, 1, 1);
    }
    b.globalCompositeOperation = "source-over";
  }
}

/** 烟囱口在屋顶右侧（缓冲坐标）。 */
function chimneyAt(b: (typeof BUILDINGS)[number]): [number, number] {
  return [(b.x + b.w * 0.74) * TILE, roofTop(b) + 6];
}

export function drawChimney(b: Ctx, bd: (typeof BUILDINGS)[number], cx: number, cy: number): void {
  if (!CHIMNEYS.includes(bd)) return;
  const [x, y] = chimneyAt(bd);
  const sx = Math.round(x - cx - 3);
  const sy = Math.round(y - cy) + 2;
  b.fillStyle = "#2a1a12";
  b.fillRect(sx - 1, sy - 1, 8, 12);
  b.fillStyle = "#8a4a3a";
  b.fillRect(sx, sy, 6, 11);
  b.fillStyle = "#a85a44";
  b.fillRect(sx, sy, 6, 2);
  b.fillStyle = "#6a3428";
  b.fillRect(sx, sy + 5, 6, 1);
}

function drawFlipped(b: Ctx, img: HTMLCanvasElement, x: number, y: number, facing: 1 | -1): void {
  if (facing === 1) {
    b.drawImage(img, x, y);
    return;
  }
  b.save();
  b.translate(x + img.width, y);
  b.scale(-1, 1);
  b.drawImage(img, 0, 0);
  b.restore();
}
