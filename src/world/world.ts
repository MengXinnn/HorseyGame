import { mix, rgba, shade } from "../render/color";
import { drawScene, paletteAt, type Palette } from "../render/scene";
import { hashSeed } from "../sim/rng";
import { express } from "../genome/genome";
import { addCaught, canCatch, isFoal, wildHerd, type GameState } from "../game/state";
import { MINUTES_PER_SECOND } from "../game/season";
import { FAR, halfWidthAt, makeCamera, pathFrom, project, projectPolygon, unproject, type Camera } from "./camera";
import {
  BOUNDS,
  BRIDGE,
  BUILDINGS,
  crossesFence,
  FENCES,
  GROUND,
  INTERACTS,
  LAOZHAO_SPOT,
  PADDOCK,
  PROPS,
  regionAt,
  RING,
  RIVER,
  TIEDUN_SPOT,
  walkable,
  WILDS,
  type GroundKind,
  type Interactable,
  type InteractId,
} from "./map";
import {
  drawBridge,
  drawBuilding,
  drawFenceSeg,
  drawPerson,
  drawProp,
  drawRing,
  fenceSegments,
  PLAYER_LOOK,
  type Light,
  type PersonLook,
} from "./props";
import { HorsePuppet } from "./puppet";

export interface WorldHooks {
  onInteract(id: InteractId): void;
  onHorseClick(horseId: string): void;
  onCaught(horseId: string, name: string): void;
  onToast(text: string): void;
  /** 状态变了（钱、马、套索），让界面刷新。 */
  onChange(): void;
}

interface Npc {
  look: PersonLook;
  x: number;
  z: number;
  facing: 1 | -1;
}

const NPCS: Npc[] = [
  { look: { robe: "#6b3b2a", hat: "none", skin: "#d9a982", build: 1.35, beard: true }, x: LAOZHAO_SPOT.x, z: LAOZHAO_SPOT.z, facing: 1 },
  { look: { robe: "#7a2a2a", hat: "cap", skin: "#e2b893", build: 1.05 }, x: -12.8, z: 74.9, facing: 1 },
  { look: { robe: "#2f4a52", hat: "cap", skin: "#ecc6a0", build: 0.9 }, x: -12.6, z: 100.2, facing: 1 },
  { look: { robe: "#5a4a2a", hat: "straw", skin: "#d8a77e", build: 1.15 }, x: 17.8, z: 100.2, facing: -1 },
  { look: { robe: "#2f5d4a", hat: "cap", skin: "#e9c39b", build: 1 }, x: -27.8, z: 120.2, facing: -1 },
];

const WALK = 4.6;
const RUN = 8.5;
const THROW_RANGE = 11;

interface Rope {
  target: HorsePuppet;
  t: number;
  dur: number;
  hit: boolean;
}

interface Tug {
  horse: HorsePuppet;
  tension: number;
  progress: number;
  yankIn: number;
  high: number;
  low: number;
  strength: number;
}

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  act: () => void;
}

const FENCE_SEGS = fenceSegments(FENCES);

/** 一天里的环境色：叠在世界上面，清晨偏粉，傍晚偏橙，夜里偏蓝暗。 */
function gradeAt(clock: number): { color: string; alpha: number; night: number } {
  const h = clock / 60;
  const keys: Array<[number, string, number, number]> = [
    [5, "#1a2350", 0.55, 1],
    [7, "#f2b9a8", 0.16, 0.15],
    [9.5, "#ffffff", 0, 0],
    [15.5, "#ffffff", 0, 0],
    [17.5, "#f2a35e", 0.2, 0.15],
    [19, "#5a3a6a", 0.32, 0.55],
    [20.5, "#141c48", 0.52, 1],
  ];
  const c = Math.max(keys[0]![0], Math.min(keys[keys.length - 1]![0], h));
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (c <= b[0]) {
      const t = (c - a[0]) / (b[0] - a[0]);
      return { color: mix(a[1], b[1], t), alpha: a[2] + (b[2] - a[2]) * t, night: a[3] + (b[3] - a[3]) * t };
    }
  }
  const last = keys[keys.length - 1]!;
  return { color: last[1], alpha: last[2], night: last[3] };
}

function groundColor(kind: GroundKind, P: Palette): string {
  switch (kind) {
    case "path":
      return mix("#b89a6c", P.ground, 0.25);
    case "plaza":
      return mix("#b9ae9a", P.ground, 0.2);
    case "water":
      return mix("#5f9fb5", P.sky[2] as string, 0.35);
    case "track":
      return mix("#b0784a", P.ground, 0.2);
    case "infield":
      return shade(P.grass, 0.08);
    case "paddock":
      return mix(P.grass, "#a8b56a", 0.25);
    case "meadow":
      return mix(P.grass, "#c2b45e", 0.18);
    case "sand":
      return mix("#cdb58a", P.ground, 0.2);
  }
}

export class WorldScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private readonly lctx: CanvasRenderingContext2D;
  private state: GameState;
  private readonly hooks: WorldHooks;
  private paddock: HorsePuppet[] = [];
  private herd: HorsePuppet[] = [];
  private herdDay = -1;
  private tiedun: HorsePuppet | null = null;
  private keys = new Set<string>();
  private target: { x: number; z: number; then?: () => void } | null = null;
  private walkPhase = 0;
  private facing: 1 | -1 = 1;
  private moving = false;
  private running = false;
  private time = 0;
  private hits: Hit[] = [];
  private nearby: Interactable | null = null;
  private region = "";
  private banner: { text: string; t: number } | null = null;
  private rope: Rope | null = null;
  private tug: Tug | null = null;
  private holding = false;
  private float: Array<{ text: string; x: number; z: number; t: number; color: string }> = [];
  private cam: Camera;
  private raf = 0;
  private last = 0;
  /** 打开面板、比赛进行中时暂停世界（时钟也停）。 */
  paused = false;
  active = true;

  constructor(canvas: HTMLCanvasElement, state: GameState, hooks: WorldHooks) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D 不可用");
    this.ctx = ctx;
    this.layer = document.createElement("canvas");
    this.lctx = this.layer.getContext("2d") as CanvasRenderingContext2D;
    this.state = state;
    this.hooks = hooks;
    this.cam = makeCamera(state.player.x, state.player.z, 800, 450);
    this.sync();
    this.bindInput();
    this.raf = requestAnimationFrame(this.frame);
  }

  setState(state: GameState): void {
    this.state = state;
    this.herdDay = -1;
    this.sync();
  }

  /** 马厩里的马变了、换了一天：重建牧场里的马和野马群。 */
  sync(): void {
    const s = this.state;
    const keep = new Map(this.paddock.map((p) => [p.id, p]));
    this.paddock = s.horses.map((h, i) => {
      const scale = isFoal(h, s.day) ? 0.62 : 1;
      const old = keep.get(h.id);
      if (old && old.scale === scale) return old;
      const rx = PADDOCK.x0 + 3 + ((hashSeed(h.id) % 1000) / 1000) * (PADDOCK.x1 - PADDOCK.x0 - 6);
      const rz = PADDOCK.z0 + 3 + (i % 4) * ((PADDOCK.z1 - PADDOCK.z0 - 6) / 3);
      return new HorsePuppet(h.id, h.name, h.genome, rx, rz, scale);
    });
    if (this.herdDay !== s.day) {
      this.herdDay = s.day;
      const wild = wildHerd(s, 0, 6);
      this.herd = wild
        .map((w, i) => ({ w, i }))
        .filter(({ i }) => !s.flags[`caught:${s.day}:${i}`])
        .map(({ w, i }) => {
          const cx = WILDS.x0 + 20 + ((hashSeed(`${s.day}:${i}`) % 100) / 100) * (WILDS.x1 - WILDS.x0 - 40);
          const cz = WILDS.z0 + 15 + ((hashSeed(`z${s.day}:${i}`) % 100) / 100) * (WILDS.z1 - WILDS.z0 - 30);
          return new HorsePuppet(`wild:${s.day}:${i}`, w.name, w.genome, cx, cz);
        });
    }
    if (!this.tiedun) {
      const t = s.rivals.find((r) => r.id === "r-tiedun");
      if (t) this.tiedun = new HorsePuppet(t.id, t.name, t.genome, TIEDUN_SPOT.x, TIEDUN_SPOT.z);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  /** 把人物传送到某处（比赛结束回到场边）。 */
  teleport(x: number, z: number): void {
    this.state.player.x = x;
    this.state.player.z = z;
    this.target = null;
  }

  /* ---------------- 输入 ---------------- */

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active || this.paused) return;
    if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " "].includes(k)) e.preventDefault();
    this.keys.add(k);
    if (k === "shift") this.running = true;
    if (k === " ") this.holding = true;
    if ((k === "e" || k === "enter") && this.nearby) this.hooks.onInteract(this.nearby.id);
    this.target = null;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (k === "shift") this.running = false;
    if (k === " ") this.holding = false;
  };

  private bindInput(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    const pos = (e: PointerEvent): [number, number] => {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active || this.paused) return;
      const [x, y] = pos(e);
      this.canvas.setPointerCapture(e.pointerId);
      if (this.tug) {
        this.holding = true;
        return;
      }
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const h = this.hits[i]!;
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
          h.act();
          return;
        }
      }
      const g = unproject(this.cam, x, y);
      if (g) this.target = { x: g.x, z: g.z };
    });
    // 指到马、门口这些能点的东西时，光标变成手指。
    this.canvas.addEventListener("pointermove", (e) => {
      const [x, y] = pos(e);
      const over = this.hits.some((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
      this.canvas.style.cursor = over ? "pointer" : "";
    });
    const up = (): void => {
      this.holding = false;
    };
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
  }

  /* ---------------- 更新 ---------------- */

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.active) return;
    if (!this.paused) this.update(dt);
    this.render();
  };

  private update(dt: number): void {
    this.time += dt;
    const s = this.state;
    s.clock += dt * MINUTES_PER_SECOND;
    this.movePlayer(dt);
    this.updatePaddock(dt);
    this.updateHerd(dt);
    this.tiedun?.update(dt);
    this.updateLasso(dt);
    for (const f of this.float) f.t += dt;
    this.float = this.float.filter((f) => f.t < 1.6);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 3) this.banner = null;
    }
    const r = regionAt(s.player.x, s.player.z);
    const id = r?.id ?? "";
    if (id !== this.region) {
      this.region = id;
      if (r) this.banner = { text: r.name, t: 0 };
    }
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of INTERACTS) {
      const d = Math.hypot(it.x - s.player.x, it.z - s.player.z);
      if (d < it.radius && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    this.nearby = best;
  }

  private movePlayer(dt: number): void {
    const p = this.state.player;
    if (this.tug || this.rope) {
      this.moving = false;
      return;
    }
    let dx = 0;
    let dz = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) dz += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dz -= 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;
    let speed = this.running ? RUN : WALK;
    if (!dx && !dz && this.target) {
      const tx = this.target.x - p.x;
      const tz = this.target.z - p.z;
      const d = Math.hypot(tx, tz);
      if (d < 0.25) {
        const then = this.target.then;
        this.target = null;
        then?.();
      } else {
        dx = tx / d;
        dz = tz / d;
        if (d > 25) speed = RUN;
        speed = Math.min(speed, d / dt);
      }
    }
    const len = Math.hypot(dx, dz);
    this.moving = len > 0;
    if (!len) return;
    dx /= len;
    dz /= len;
    if (Math.abs(dx) > 0.15) this.facing = dx > 0 ? 1 : -1;
    const nx = p.x + dx * speed * dt;
    const nz = p.z + dz * speed * dt;
    const ok = (x: number, z: number): boolean => walkable(x, z) && !crossesFence(p.x, p.z, x, z);
    if (ok(nx, nz)) {
      p.x = nx;
      p.z = nz;
    } else if (ok(nx, p.z)) p.x = nx;
    else if (ok(p.x, nz)) p.z = nz;
    else this.target = null;
    this.walkPhase += dt * speed * 2.2;
  }

  private updatePaddock(dt: number): void {
    for (const h of this.paddock) {
      h.timer -= dt;
      if (h.timer <= 0) {
        const r = (hashSeed(`${h.id}:${Math.floor(this.time * 10)}`) % 1000) / 1000;
        if (r < 0.45) {
          h.tx = h.x;
          h.tz = h.z;
        } else {
          h.tx = PADDOCK.x0 + 2.5 + r * (PADDOCK.x1 - PADDOCK.x0 - 5);
          h.tz = PADDOCK.z0 + 2.5 + ((r * 7.3) % 1) * (PADDOCK.z1 - PADDOCK.z0 - 5);
        }
        h.timer = 3 + r * 5;
      }
      steer(h, h.tx, h.tz, 1.5 * h.scale + 0.3);
      h.update(dt);
    }
  }

  private updateHerd(dt: number): void {
    const p = this.state.player;
    for (const h of this.herd) {
      if (h.roped) {
        h.update(dt);
        continue;
      }
      const dx = h.x - p.x;
      const dz = h.z - p.z;
      const d = Math.hypot(dx, dz);
      const courage = express(h.genome).courage;
      const fleeR = 8 + (1 - courage) * 1.6;
      if (d < fleeR) {
        // 受惊：往远离人的方向跑，胆小的马跑得更凶。
        const sp = Math.min(h.plan.topSpeed * (0.55 - courage * 0.06), 9);
        let fx = dx / (d || 1);
        let fz = dz / (d || 1);
        if (h.x < WILDS.x0 + 4 || h.x > WILDS.x1 - 4) fx *= -0.3;
        if (h.z < WILDS.z0 + 4 || h.z > WILDS.z1 - 4) fz *= -0.3;
        const l = Math.hypot(fx, fz) || 1;
        h.vx += ((fx / l) * sp - h.vx) * Math.min(1, dt * 3);
        h.vz += ((fz / l) * sp - h.vz) * Math.min(1, dt * 3);
        h.timer = 1 + Math.random() * 2;
        h.tx = h.x;
        h.tz = h.z;
      } else {
        h.timer -= dt;
        if (h.timer <= 0) {
          if (Math.random() < 0.4) {
            h.tx = h.x;
            h.tz = h.z;
          } else {
            h.tx = Math.max(WILDS.x0 + 5, Math.min(WILDS.x1 - 5, h.x + (Math.random() - 0.5) * 24));
            h.tz = Math.max(WILDS.z0 + 5, Math.min(WILDS.z1 - 5, h.z + (Math.random() - 0.5) * 24));
          }
          h.timer = 3 + Math.random() * 5;
        }
        steer(h, h.tx, h.tz, 1.6);
      }
      h.x = Math.max(WILDS.x0 + 1, Math.min(WILDS.x1 - 1, h.x));
      h.z = Math.max(WILDS.z0 + 1, Math.min(WILDS.z1 - 1, h.z));
      h.update(dt);
    }
  }

  /* ---------------- 套马 ---------------- */

  private throwAt(h: HorsePuppet): void {
    const s = this.state;
    const ok = canCatch(s);
    if (!ok.ok) {
      this.hooks.onToast(ok.reason);
      return;
    }
    const d = Math.hypot(h.x - s.player.x, h.z - s.player.z);
    if (d > THROW_RANGE) {
      this.target = { x: h.x - Math.sign(h.x - s.player.x) * 3, z: h.z - Math.sign(h.z - s.player.z) * 3 };
      return;
    }
    s.lassos--;
    this.hooks.onChange();
    const chance = Math.max(0.15, Math.min(0.9, 1 - d / 14 - h.speed / 22));
    this.facing = h.x >= s.player.x ? 1 : -1;
    this.rope = { target: h, t: 0, dur: 0.35 + d * 0.04, hit: Math.random() < chance };
  }

  private updateLasso(dt: number): void {
    const s = this.state;
    if (this.rope) {
      this.rope.t += dt;
      if (this.rope.t >= this.rope.dur) {
        const h = this.rope.target;
        if (this.rope.hit) {
          h.roped = true;
          const p = express(h.genome);
          const strength = Math.max(0.6, Math.min(2, (h.plan.totalMass / 650) * (1 + 0.2 * p.power) * (1 - 0.12 * p.courage)));
          this.tug = { horse: h, tension: 0.45, progress: 0, yankIn: 0.6, high: 0, low: 0, strength };
          this.floatText("套中！", h.x, h.z, "#f2cf7e");
        } else {
          this.floatText("没套中", h.x, h.z, "#efe6d2");
        }
        this.rope = null;
      }
    }
    const tug = this.tug;
    if (!tug) return;
    const h = tug.horse;
    // 马往远处挣，人往回拉。
    const dx = h.x - s.player.x;
    const dz = h.z - s.player.z;
    const d = Math.hypot(dx, dz) || 1;
    const pull = 0.8 + tug.strength * 0.6;
    h.vx = (dx / d) * pull * (0.6 + tug.tension);
    h.vz = (dz / d) * pull * (0.6 + tug.tension);
    if (d > THROW_RANGE + 2) {
      h.x = s.player.x + (dx / d) * (THROW_RANGE + 2);
      h.z = s.player.z + (dz / d) * (THROW_RANGE + 2);
    }
    tug.tension += (this.holding ? 0.85 : -0.6) * dt;
    tug.yankIn -= dt;
    if (tug.yankIn <= 0) {
      tug.tension += 0.12 + Math.random() * 0.22 * tug.strength;
      tug.yankIn = (0.5 + Math.random() * 0.9) / Math.sqrt(tug.strength);
    }
    tug.tension = Math.max(0, Math.min(1.05, tug.tension));
    const inZone = tug.tension > 0.35 && tug.tension < 0.78;
    if (inZone) tug.progress += dt * (0.5 / Math.sqrt(tug.strength));
    tug.high = tug.tension > 0.95 ? tug.high + dt : 0;
    tug.low = tug.tension < 0.12 ? tug.low + dt : 0;
    if (tug.progress >= 1) {
      // 套住了：牵回牧场。
      const idx = this.herd.indexOf(h);
      const herdIdx = Number(h.id.split(":")[2]);
      s.flags[`caught:${s.day}:${herdIdx}`] = true;
      if (idx >= 0) this.herd.splice(idx, 1);
      const horse = addCaught(s, h.name, h.genome);
      this.tug = null;
      this.holding = false;
      this.sync();
      this.hooks.onCaught(horse.id, horse.name);
    } else if (tug.high > 0.45 || tug.low > 1.3) {
      this.floatText(tug.high > 0.45 ? "绳子断了" : "挣脱了", h.x, h.z, "#efe6d2");
      h.roped = false;
      h.vx = (dx / d) * 8;
      h.vz = (dz / d) * 8;
      this.tug = null;
      this.holding = false;
    }
  }

  private floatText(text: string, x: number, z: number, color: string): void {
    this.float.push({ text, x, z, t: 0, color });
  }

  /* ---------------- 画面 ---------------- */

  private resize(): { W: number; H: number; dpr: number } {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth || 800;
    const H = this.canvas.clientHeight || 450;
    for (const c of [this.canvas, this.layer]) {
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W, H, dpr };
  }

  render(): void {
    const { W, H } = this.resize();
    const ctx = this.ctx;
    const lctx = this.lctx;
    const s = this.state;
    const cam = makeCamera(s.player.x, s.player.z, W, H);
    this.cam = cam;
    const P = paletteAt(s.clock);
    const grade = gradeAt(s.clock);
    const L: Light = { rim: P.rim, night: grade.night, t: this.time };
    this.hits = [];

    drawScene(ctx, W, H, P, cam.x * 6, this.time * 1000, cam.horizon / H);

    lctx.clearRect(0, 0, W, H);
    this.drawGround(lctx, cam, P, W, H);
    const lights: Array<[number, number, number]> = [];
    this.drawSprites(lctx, cam, P, L, lights);
    // 环境色：只染世界这一层，天空保持自己的颜色。
    if (grade.alpha > 0.01) {
      lctx.globalCompositeOperation = "source-atop";
      lctx.fillStyle = rgba(grade.color, grade.alpha);
      lctx.fillRect(0, 0, W, H);
      lctx.globalCompositeOperation = "source-over";
    }
    ctx.drawImage(this.layer, 0, 0, W, H);
    // 远处的雾。
    const top = cam.horizon - H * 0.07;
    const fog = ctx.createLinearGradient(0, top, 0, cam.horizon + H * 0.09);
    fog.addColorStop(0, rgba(P.fog, 0));
    fog.addColorStop(0.42, rgba(P.fog, 0.7));
    fog.addColorStop(0.52, rgba(P.fog, 0.7));
    fog.addColorStop(1, rgba(P.fog, 0));
    ctx.fillStyle = fog;
    ctx.fillRect(0, top, W, H * 0.16);
    // 夜里的灯光。
    if (grade.night > 0.15) {
      ctx.globalCompositeOperation = "lighter";
      for (const [x, y, r] of lights) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,190,110,${0.5 * grade.night})`);
        g.addColorStop(1, "rgba(255,160,80,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    this.drawOverlay(ctx, cam, W, H, P);
  }

  private drawGround(ctx: CanvasRenderingContext2D, cam: Camera, P: Palette, W: number, H: number): void {
    const g = ctx.createLinearGradient(0, cam.horizon, 0, H);
    g.addColorStop(0, mix(P.grass, P.fog, 0.55));
    g.addColorStop(0.25, P.grass);
    g.addColorStop(1, shade(P.grass, -0.08));
    ctx.fillStyle = g;
    ctx.fillRect(0, cam.horizon, W, H - cam.horizon);
    // 世界外面的远方草地颜色淡一点。
    for (const patch of GROUND) {
      const pts = projectPolygon(cam, patch.pts);
      if (!pathFrom(ctx, pts)) continue;
      ctx.fillStyle = groundColor(patch.kind, P);
      ctx.fill();
      if (patch.kind === "water") {
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = rgba(P.sky[2] as string, 0.35);
        for (let i = 0; i < 26; i++) {
          const wx = cam.x - 40 + ((i * 37) % 80) + Math.sin(this.time * 0.6 + i) * 1.5;
          const wz = RIVER.z0 + ((i * 13) % 6);
          const a = project(cam, wx, wz, 0);
          if (!a) continue;
          ctx.lineWidth = Math.max(0.5, a.scale * 0.05);
          ctx.beginPath();
          ctx.moveTo(a.x - a.scale * 0.8, a.y);
          ctx.lineTo(a.x + a.scale * 0.8, a.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (patch.kind === "path" || patch.kind === "track") {
        ctx.strokeStyle = rgba(shade(groundColor(patch.kind, P), -0.2), 0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // 草丛：近处细节。
    const tuftColor = shade(P.grass, -0.18);
    const tuftLight = shade(P.grass, 0.18);
    ctx.lineWidth = 1;
    const maxD = 32;
    const step = 1.7;
    for (let z = Math.ceil((cam.z + 3) / step) * step; z < cam.z + maxD; z += step) {
      const hw = halfWidthAt(cam, z - cam.z) + 2;
      for (let x = Math.floor((cam.x - hw) / step) * step; x < cam.x + hw; x += step) {
        const hsh = hashSeed(`${x.toFixed(1)},${z.toFixed(1)}`);
        if (hsh % 3 !== 0) continue;
        const ox = x + ((hsh >> 4) % 100) / 70;
        const oz = z + ((hsh >> 11) % 100) / 70;
        if (!onGrass(ox, oz)) continue;
        const a = project(cam, ox, oz, 0);
        if (!a) continue;
        const s = a.scale * (0.22 + ((hsh >> 7) % 10) / 40);
        const meadow = ox > WILDS.x0 && ox < WILDS.x1 && oz > WILDS.z0 && oz < WILDS.z1;
        ctx.strokeStyle = (hsh >> 3) % 2 ? tuftColor : tuftLight;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x - s * 0.5, a.y - s * (meadow ? 2.2 : 1.3));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + s * 0.35, a.y - s * (meadow ? 2.6 : 1.5));
        ctx.stroke();
        if (meadow && hsh % 7 === 0) {
          ctx.fillStyle = ["#f2d06b", "#efe6f2", "#e88a7a"][hsh % 3] as string;
          ctx.beginPath();
          ctx.arc(a.x + s * 0.35, a.y - s * 2.6, Math.max(0.8, s * 0.35), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawSprites(ctx: CanvasRenderingContext2D, cam: Camera, P: Palette, L: Light, lights: Array<[number, number, number]>): void {
    const s = this.state;
    const items: Array<{ d: number; draw: () => void }> = [];
    const add = (z: number, draw: () => void): void => {
      const d = z - cam.z;
      if (d > 1 && d < FAR) items.push({ d, draw });
    };
    const near = (x: number, z: number, r: number): boolean => Math.abs(x - cam.x) - r < halfWidthAt(cam, Math.max(1.5, z - cam.z)) + 3;

    for (const b of BUILDINGS) {
      if (!near(b.x, b.z, b.w)) continue;
      add(b.z, () => drawBuilding(ctx, cam, b, L));
      if (L.night > 0.2) {
        const p = project(cam, b.x, b.z - 0.2, 1.4);
        if (p) lights.push([p.x, p.y, p.scale * 3.5]);
      }
    }
    for (const prop of PROPS) {
      if (!near(prop.x, prop.z, 4)) continue;
      add(prop.z, () => {
        // 贴着镜头的树会挡住人，淡一点。
        const d = prop.z - cam.z;
        const tall = prop.kind === "pine" || prop.kind === "willow";
        const fade = tall && d < 9 && Math.abs(prop.x - cam.x) < halfWidthAt(cam, Math.max(1.5, d)) * 0.8;
        if (fade) ctx.globalAlpha = Math.max(0.28, Math.min(1, (d - 2) / 7));
        drawProp(ctx, cam, prop, L, P.grass);
        ctx.globalAlpha = 1;
      });
      if (prop.kind === "lantern" && L.night > 0.2) {
        const p = project(cam, prop.x + 0.5, prop.z, 2.1);
        if (p) lights.push([p.x, p.y, p.scale * 4]);
      }
    }
    for (const f of FENCE_SEGS) {
      const mz = (f.az + f.bz) / 2;
      if (!near((f.ax + f.bx) / 2, mz, 4)) continue;
      add(Math.min(f.az, f.bz) + 0.01, () => drawFenceSeg(ctx, cam, f, L));
    }
    add(RING.z - RING.r, () => drawRing(ctx, cam, RING.x, RING.z, RING.r, L));
    add(RIVER.z0 - 1, () => drawBridge(ctx, cam, BRIDGE.x0, BRIDGE.x1, RIVER.z0, RIVER.z1, L));

    for (const n of NPCS) {
      if (!near(n.x, n.z, 2)) continue;
      add(n.z, () => {
        const p = project(cam, n.x, n.z, 0);
        if (p) drawPerson(ctx, p.x, p.y + Math.sin(this.time * 2 + n.x) * 0.3, p.scale, n.look, 0, n.facing, L, false);
      });
    }

    const horseItem = (h: HorsePuppet, onClick: (() => void) | null, tag: string | null): void => {
      if (!near(h.x, h.z, 3)) return;
      add(h.z, () => {
        h.draw(ctx, cam, P.rim);
        const b = h.bounds(cam);
        if (!b) return;
        if (onClick) this.hits.push({ ...b, act: onClick });
        if (tag && b.w > 30) drawTag(ctx, b.x + b.w / 2, b.y - 4, tag, Math.min(14, 9 + b.w / 30));
      });
    };
    for (const h of this.paddock) horseItem(h, () => this.hooks.onHorseClick(h.id), h.name);
    for (const h of this.herd) horseItem(h, () => this.throwAt(h), null);
    if (this.tiedun) horseItem(this.tiedun, null, null);

    // 人物。
    const pl = s.player;
    add(pl.z, () => {
      const p = project(cam, pl.x, pl.z, 0);
      if (p) drawPerson(ctx, p.x, p.y, p.scale, PLAYER_LOOK, this.walkPhase, this.facing, L, this.moving);
      this.drawRope(ctx, cam);
    });

    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      if (it.d > FAR * 0.55) ctx.globalAlpha = Math.max(0.35, 1 - (it.d - FAR * 0.55) / (FAR * 0.45));
      it.draw();
      ctx.globalAlpha = 1;
    }
  }

  private drawRope(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const pl = this.state.player;
    const hand = project(cam, pl.x + 0.3 * this.facing, pl.z, 1.2);
    if (!hand) return;
    let target: { x: number; y: number } | null = null;
    let k = 1;
    if (this.rope) {
      const h = this.rope.target;
      const p = project(cam, h.x, h.z, (Math.max(h.plan.legFront, h.plan.legRear) + h.plan.torsoHeight) * h.scale);
      if (!p) return;
      k = this.rope.t / this.rope.dur;
      target = { x: hand.x + (p.x - hand.x) * k, y: hand.y + (p.y - hand.y) * k - Math.sin(k * Math.PI) * hand.scale * 2.2 };
    } else if (this.tug) {
      const h = this.tug.horse;
      const p = project(cam, h.x + h.plan.torsoLength * 0.4 * h.facing, h.z, (Math.max(h.plan.legFront, h.plan.legRear) + h.plan.torsoHeight * 0.9) * h.scale);
      if (p) target = p;
    }
    if (!target) return;
    ctx.strokeStyle = "#d9b77a";
    ctx.lineWidth = Math.max(1, hand.scale * 0.05);
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    const sag = this.tug ? (1 - this.tug.tension) * hand.scale * 1.2 : 0;
    ctx.quadraticCurveTo((hand.x + target.x) / 2, (hand.y + target.y) / 2 + sag, target.x, target.y);
    ctx.stroke();
    if (this.rope) {
      ctx.beginPath();
      ctx.ellipse(target.x, target.y, hand.scale * 0.5, hand.scale * 0.25, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number, P: Palette): void {
    const s = this.state;
    // 漂字。
    for (const f of this.float) {
      const p = project(cam, f.x, f.z, 3 + f.t * 1.5);
      if (!p) continue;
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      ctx.font = `700 ${Math.round(Math.max(18, p.scale * 0.9))}px 'Ma Shan Zheng', 'Noto Serif SC', serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(30,18,12,0.8)";
      ctx.strokeText(f.text, p.x, p.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    // 互动提示：一块小木牌，点它或按 E。
    if (this.nearby && !this.tug) {
      const it = this.nearby;
      const p = project(cam, it.x, it.z + 0.5, 2.9);
      if (p) {
        const r = drawPrompt(ctx, p.x, p.y, it.label);
        this.hits.push({ ...r, act: () => this.hooks.onInteract(it.id) });
      }
    }
    // 野原里套马的提示：射程内的野马头上一个圈。
    if (!this.tug && !this.rope && this.region === "wilds") {
      for (const h of this.herd) {
        const d = Math.hypot(h.x - s.player.x, h.z - s.player.z);
        if (d > THROW_RANGE) continue;
        const b = h.bounds(cam);
        if (!b) continue;
        ctx.strokeStyle = rgba("#f2cf7e", 0.5 + 0.3 * Math.sin(this.time * 6));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, b.y - 8, 9, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.tug) drawTugGauge(ctx, W, H, this.tug);
    if (this.banner) {
      const t = this.banner.t;
      const a = t < 0.4 ? t / 0.4 : t > 2.4 ? Math.max(0, (3 - t) / 0.6) : 1;
      ctx.globalAlpha = a;
      ctx.font = `400 ${Math.round(Math.min(64, W * 0.08))}px 'Ma Shan Zheng', 'Noto Serif SC', serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(25,16,12,0.55)";
      const y = H * 0.24;
      ctx.strokeText(this.banner.text, W / 2, y);
      ctx.fillStyle = "#fbf1dc";
      ctx.fillText(this.banner.text, W / 2, y);
      ctx.fillStyle = "#b8322a";
      const sw = Math.min(64, W * 0.08) * 0.42;
      ctx.fillRect(W / 2 + ctx.measureText(this.banner.text).width / 2 + 10, y - sw * 1.6, sw, sw);
      ctx.globalAlpha = 1;
    }
    drawMinimap(ctx, W, H, s, P, this.herd);
  }
}

function steer(h: HorsePuppet, tx: number, tz: number, speed: number): void {
  const dx = tx - h.x;
  const dz = tz - h.z;
  const d = Math.hypot(dx, dz);
  const want = d < 0.6 ? 0 : Math.min(speed, d);
  const vx = d > 0.01 ? (dx / d) * want : 0;
  const vz = d > 0.01 ? (dz / d) * want : 0;
  h.vx += (vx - h.vx) * 0.08;
  h.vz += (vz - h.vz) * 0.08;
}

function onGrass(x: number, z: number): boolean {
  if (Math.abs(x) < 2.6 && z < 72) return false;
  if (z > RIVER.z0 - 0.5 && z < RIVER.z1 + 0.5) return false;
  if (x > -25 && x < 25 && z > 70 && z < 101) return false;
  const tx = (x - -56) / 33;
  const tz = (z - 142) / 16;
  const t = tx * tx + tz * tz;
  if (t < 1 && t > 0.55) return false;
  return x > BOUNDS.x0 - 10 && x < BOUNDS.x1 + 10;
}

function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number): void {
  ctx.font = `600 ${Math.round(size)}px 'Noto Serif SC', serif`;
  const w = ctx.measureText(text).width + size;
  ctx.fillStyle = "rgba(40,24,16,0.72)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - size * 1.5, w, size * 1.45, size * 0.3);
  ctx.fill();
  ctx.fillStyle = "#f6e7c4";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y - size * 0.77);
  ctx.textBaseline = "alphabetic";
}

/** 互动木牌：按键提示 + 动作名。返回可点区域。 */
function drawPrompt(ctx: CanvasRenderingContext2D, x: number, y: number, label: string): { x: number; y: number; w: number; h: number } {
  const size = 17;
  ctx.font = `700 ${size}px 'Noto Serif SC', serif`;
  const tw = ctx.measureText(label).width;
  const key = 24;
  const w = key + tw + 26;
  const h = 34;
  const x0 = x - w / 2;
  const y0 = y - h;
  ctx.fillStyle = "#2c1a10";
  ctx.beginPath();
  ctx.roundRect(x0 - 2, y0 - 2, w + 4, h + 6, 9);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  g.addColorStop(0, "#9a6438");
  g.addColorStop(1, "#6b3f22");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,220,160,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0 + 8, y0 + 2);
  ctx.lineTo(x0 + w - 8, y0 + 2);
  ctx.stroke();
  // 键帽
  ctx.fillStyle = "#f2e3c2";
  ctx.beginPath();
  ctx.roundRect(x0 + 7, y0 + 5, key, key, 5);
  ctx.fill();
  ctx.fillStyle = "#3a2416";
  ctx.font = `800 14px 'Noto Serif SC', serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("E", x0 + 7 + key / 2, y0 + 5 + key / 2 + 1);
  ctx.fillStyle = "#fbe9c0";
  ctx.font = `700 ${size}px 'Noto Serif SC', serif`;
  ctx.textAlign = "left";
  ctx.fillText(label, x0 + key + 15, y0 + h / 2 + 1);
  ctx.textBaseline = "alphabetic";
  // 小三角指向下方。
  ctx.fillStyle = "#6b3f22";
  ctx.beginPath();
  ctx.moveTo(x - 7, y0 + h);
  ctx.lineTo(x + 7, y0 + h);
  ctx.lineTo(x, y0 + h + 8);
  ctx.fill();
  return { x: x0, y: y0, w, h: h + 8 };
}

/** 拔河仪表：木条上一段绿区，指针是当前绳子的松紧，下面是进度。 */
function drawTugGauge(ctx: CanvasRenderingContext2D, W: number, H: number, tug: Tug): void {
  const w = Math.min(420, W * 0.7);
  const h = 26;
  const x0 = W / 2 - w / 2;
  const y0 = H - 120;
  ctx.fillStyle = "#2c1a10";
  ctx.beginPath();
  ctx.roundRect(x0 - 8, y0 - 30, w + 16, h + 62, 14);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y0 - 30, 0, y0 + h + 32);
  g.addColorStop(0, "#8a5a34");
  g.addColorStop(1, "#5e3820");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x0 - 4, y0 - 26, w + 8, h + 54, 12);
  ctx.fill();
  ctx.fillStyle = "#3b2416";
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 8);
  ctx.fill();
  ctx.fillStyle = "#6fae6a";
  ctx.fillRect(x0 + w * 0.35, y0 + 3, w * 0.43, h - 6);
  ctx.fillStyle = "#c8493a";
  ctx.fillRect(x0 + w * 0.95, y0 + 3, w * 0.05 - 3, h - 6);
  const nx = x0 + Math.min(1, tug.tension) * w;
  ctx.fillStyle = "#fbefd4";
  ctx.beginPath();
  ctx.moveTo(nx, y0 - 4);
  ctx.lineTo(nx - 7, y0 - 14);
  ctx.lineTo(nx + 7, y0 - 14);
  ctx.fill();
  ctx.fillRect(nx - 2, y0 - 4, 4, h + 8);
  // 进度：一圈圈绳子
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(x0, y0 + h + 10, w, 8);
  ctx.fillStyle = "#f2cf7e";
  ctx.fillRect(x0, y0 + h + 10, w * Math.min(1, tug.progress), 8);
  ctx.fillStyle = "#fbefd4";
  ctx.font = "700 14px 'Noto Serif SC', serif";
  ctx.textAlign = "center";
  ctx.fillText("按住拉绳", W / 2, y0 - 10);
}

/** 小地图：一张旧地图卷，标出你的位置和今天的赛场。 */
function drawMinimap(ctx: CanvasRenderingContext2D, W: number, H: number, s: GameState, P: Palette, herd: HorsePuppet[]): void {
  const mw = Math.min(170, W * 0.26);
  const sc = mw / (BOUNDS.x1 - BOUNDS.x0);
  const mh = (BOUNDS.z1 - BOUNDS.z0) * sc;
  const x0 = 16;
  const y0 = H - mh - 16;
  const mx = (x: number): number => x0 + (x - BOUNDS.x0) * sc;
  const mz = (z: number): number => y0 + mh - (z - BOUNDS.z0) * sc;
  ctx.save();
  ctx.fillStyle = "#3a2416";
  ctx.beginPath();
  ctx.roundRect(x0 - 6, y0 - 6, mw + 12, mh + 12, 10);
  ctx.fill();
  ctx.fillStyle = "#e9dcbc";
  ctx.beginPath();
  ctx.roundRect(x0 - 2, y0 - 2, mw + 4, mh + 4, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x0 - 2, y0 - 2, mw + 4, mh + 4, 7);
  ctx.clip();
  const fillPoly = (pts: Array<[number, number]>, color: string): void => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(mx(x), mz(z)) : ctx.moveTo(mx(x), mz(z))));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  for (const g of GROUND) {
    const color = g.kind === "water" ? "#8fb6c0" : g.kind === "path" ? "#c9a878" : g.kind === "plaza" ? "#cfc2a6" : g.kind === "track" ? "#c08a5a" : g.kind === "meadow" ? "#d6d29a" : g.kind === "infield" ? "#b9c994" : g.kind === "paddock" ? "#c9d49a" : "#d9c7a0";
    fillPoly(g.pts, color);
  }
  ctx.fillStyle = "#6b4a32";
  for (const b of BUILDINGS) ctx.fillRect(mx(b.x - b.w / 2), mz(b.z + b.d), b.w * sc, b.d * sc);
  ctx.fillStyle = "rgba(120,60,40,0.8)";
  for (const h of herd) {
    ctx.beginPath();
    ctx.arc(mx(h.x), mz(h.z), 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 今天的赛场：红点闪烁。
  const ev = s.day % 7 === 0 || s.day % 2 === 0 ? { x: RING.x, z: RING.z } : { x: -56, z: 142 };
  ctx.fillStyle = `rgba(200,50,40,${0.6 + 0.4 * Math.sin(Date.now() / 250)})`;
  ctx.beginPath();
  ctx.arc(mx(ev.x), mz(ev.z), 3.5, 0, Math.PI * 2);
  ctx.fill();
  // 你
  ctx.fillStyle = "#1f3a6a";
  ctx.strokeStyle = "#fbf1dc";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mx(s.player.x), mz(s.player.z), 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  void P;
}
