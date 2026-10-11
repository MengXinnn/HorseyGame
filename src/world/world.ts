import { hashSeed } from "../sim/rng";
import { express } from "../genome/genome";
import { addCaught, canCatch, HOME, isFoal, throwLasso, travel, wildHerd, type GameState } from "../game/state";
import {
  arrivedRegion,
  BUILDINGS,
  INTERACTS,
  inside,
  LAOZHAO_SPOT,
  MAP_H,
  MAP_W,
  METERS_PER_TILE,
  PADDOCK,
  POND,
  PROPS,
  regionAt,
  T,
  TIEDUN_SPOT,
  TILE,
  tileAt,
  walkable,
  WILDS,
  YARD,
  FENCES,
  crossesFence,
  type Fence,
  type Interactable,
  type InteractId,
  type Prop,
  type PropKind,
} from "./tiles";
import { banner, bubble, floatText, nameTag, thinkBubble } from "./labels";
import { bakeGround, canvas, icon, personFrame, PLAYER_LOOK, type Dir, type PersonLook } from "./sprites";
import { propSprite } from "./props";
import { bakeBuildingShadows, buildingSprite } from "./buildingArt";
import { HorsePuppet } from "./puppet";
import { Ambient } from "./ambient";
import { ambientAt, Lighting, type Light } from "./lighting";
import { Minimap, type MapMarks } from "./minimap";

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
  dir: Dir;
}

const NPCS: Npc[] = [
  // 老赵，擂台边上。
  { look: { hat: "none", hair: "#e8e2d6", skin: "#d9a070", shirt: "#6b3b2a", shirtDark: "#4a2618", pants: "#3a2a20", beard: true, wide: true }, x: LAOZHAO_SPOT.x, z: LAOZHAO_SPOT.z, dir: "down" },
  // 赌马的伙计、研究所的研究员、马市的贩子、报名处的姑娘。
  { look: { hat: "cap", hair: "#2a1a12", skin: "#e2b893", shirt: "#8e2519", shirtDark: "#5e1810", pants: "#2a2a30" }, x: 38.8, z: 11.6, dir: "down" },
  { look: { hat: "none", hair: "#3a3a3a", skin: "#ecc6a0", shirt: "#f4f0e6", shirtDark: "#c8c2b4", pants: "#3f4a52" }, x: 118.2, z: 13.4, dir: "down" },
  { look: { hat: "straw", hair: "#3a2414", skin: "#d8a77e", shirt: "#5a7a3a", shirtDark: "#3e5828", pants: "#4a3a2e" }, x: 64.8, z: 14.2, dir: "down" },
  { look: { hat: "bun", hair: "#2a1a12", skin: "#f0c8a4", shirt: "#c9302a", shirtDark: "#8e2519", pants: "#3a2a20" }, x: 37.4, z: 22.4, dir: "right" },
  // 铁匠、茶馆跑堂、码头钓鱼的。
  { look: { hat: "none", hair: "#1e1a18", skin: "#c08a5e", shirt: "#4a4a52", shirtDark: "#2e2e36", pants: "#3a2a20", wide: true }, x: 61.2, z: 20.4, dir: "left" },
  { look: { hat: "bun", hair: "#2a1a12", skin: "#ecc6a0", shirt: "#2f4a7a", shirtDark: "#1e3258", pants: "#2a2a30" }, x: 81.4, z: 14.4, dir: "down" },
  { look: { hat: "straw", hair: "#5a3a22", skin: "#d8a77e", shirt: "#7a8a5a", shirtDark: "#5a6a3e", pants: "#3a3a4a" }, x: 75.5, z: 46.2, dir: "down" },
];

/** 存档里记一笔：已经换到这一版的大地图了。 */
const MAP_FLAG = "map:v3";

/** 走、跑的速度（格/秒）。 */
const WALK = 4.5;
const RUN = 8;
/** 套索能扔多远（格）。 */
const THROW_RANGE = 7;
/** 大世界里马的比例：每米多少像素。 */
const HORSE_PPM = 12;

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

/** 影子大小（像素半径）；0 是不要影子。 */
const SHADOW: Partial<Record<PropKind, number>> = {
  pine: 9,
  oak: 10,
  willow: 12,
  bamboo: 7,
  bush: 6,
  rock: 5,
  stump: 5,
  statue: 15,
  well: 12,
  stall: 17,
  tent: 17,
  dish: 10,
  barrel: 5,
  crate: 6,
  lamppost: 4,
  lantern: 3,
  planter: 9,
  bench: 13,
  hay: 8,
  cart: 13,
  trough: 14,
  beehive: 5,
  scarecrow: 5,
  post: 4,
  anvil: 6,
  hitch: 11,
  mailbox: 3,
  signpost: 3,
  board: 8,
  woodpile: 8,
  log: 13,
  flag: 2,
  sunflower: 2,
};

const SWAYS = new Set<PropKind>(["pine", "oak", "willow", "bamboo", "sunflower", "grass", "reeds"]);
const TREES = new Set<PropKind>(["pine", "oak", "willow", "bamboo"]);
/** 站在水边会映进水里的东西。 */
const REFLECTS = new Set<PropKind>(["pine", "oak", "willow", "bamboo", "reeds", "bush", "rock", "lamppost", "lantern", "stump", "barrel", "signpost"]);

interface Drawable {
  y: number;
  draw: () => void;
}

export class WorldScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly ground: HTMLCanvasElement;
  private state: GameState;
  private readonly hooks: WorldHooks;
  private paddock: HorsePuppet[] = [];
  private herd: HorsePuppet[] = [];
  private herdDay = -1;
  private tiedun: HorsePuppet | null = null;
  private keys = new Set<string>();
  private target: { x: number; z: number } | null = null;
  private dir: Dir = "down";
  private moving = false;
  private running = false;
  private walkPhase = 0;
  private time = 0;
  private hits: Hit[] = [];
  /** 放大以后画在屏幕上的字（名牌、气泡、飘字），参数是屏幕画布。 */
  private labels: Array<(s: CanvasRenderingContext2D) => void> = [];
  /** 设备像素：一个美术像素多大（zoom × dpr），一个字像素多大。 */
  private screenPx = 3;
  private textPx = 2;
  private nearby: Interactable | null = null;
  private region = "";
  private banner: { text: string; t: number } | null = null;
  private rope: Rope | null = null;
  private tug: Tug | null = null;
  private holding = false;
  private float: Array<{ text: string; x: number; z: number; t: number; color: string }> = [];
  private zoom = 3;
  private readonly ambient = new Ambient();
  private readonly lighting = new Lighting();
  readonly minimap: Minimap;
  /** 角落里的小地图画布（界面给的）。 */
  minimapCanvas: HTMLCanvasElement | null = null;
  private readonly rbuf: HTMLCanvasElement;
  private readonly rctx: CanvasRenderingContext2D;
  /** 水边会有倒影的摆设。 */
  private readonly reflectors: Prop[];
  private camX = 0;
  private camY = 0;
  private raf = 0;
  private last = 0;
  /** 画面上的钟：做了事以后时间一下子跳过去，天色跟着几秒内慢慢转过去。 */
  private shown = 0;
  /** 上回在哪片地方算过路上的时间。 */
  private place = "";
  /** 打开面板、比赛进行中时暂停世界（时钟也停）。 */
  paused = false;
  active = true;

  constructor(canvasEl: HTMLCanvasElement, state: GameState, hooks: WorldHooks) {
    this.canvas = canvasEl;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D 不可用");
    this.ctx = ctx;
    [this.buf, this.bctx] = canvas(320, 180);
    [this.rbuf, this.rctx] = canvas(320, 180);
    this.ground = bakeGround();
    bakeBuildingShadows(this.ground.getContext("2d") as CanvasRenderingContext2D, BUILDINGS);
    this.minimap = new Minimap();
    this.reflectors = PROPS.filter((p) => REFLECTS.has(p.kind) && nearWaterBelow(p.x, p.z));
    this.state = state;
    this.hooks = hooks;
    this.shown = state.clock;
    this.fixPlayer();
    this.sync();
    this.bindInput();
    this.raf = requestAnimationFrame(this.frame);
  }

  setState(state: GameState): void {
    this.state = state;
    this.herdDay = -1;
    this.shown = state.clock;
    this.fixPlayer();
    this.sync();
  }

  /** 画面上的钟点（界面的钟盘和天色都看它）。 */
  get clock(): number {
    return this.shown;
  }

  /** 画面上的钟已经追上真正的时间了（天色转完了）。 */
  get settled(): boolean {
    return Math.abs(this.state.clock - this.shown) < 0.5;
  }

  /** 旧存档里的位置是旧地图的坐标（或者站不住），挪回家门口。 */
  private fixPlayer(): void {
    const s = this.state;
    if (!s.flags[MAP_FLAG]) {
      s.flags[MAP_FLAG] = true;
      s.player = { ...HOME };
    }
    if (!walkable(s.player.x, s.player.z)) s.player = { ...HOME };
    this.place = regionAt(s.player.x, s.player.z)?.id ?? "";
  }

  /** 马厩里的马变了、换了一天：重建牧场里的马和野马群。 */
  sync(): void {
    const s = this.state;
    const keep = new Map(this.paddock.map((p) => [p.id, p]));
    this.paddock = s.horses.map((h, i) => {
      const scale = isFoal(h, s.day) ? 0.62 : 1;
      const old = keep.get(h.id);
      if (old && old.scale === scale) return old;
      const rx = PADDOCK.x0 + 2 + ((hashSeed(h.id) % 1000) / 1000) * (PADDOCK.x1 - PADDOCK.x0 - 4);
      const rz = PADDOCK.z0 + 3 + (i % 4) * ((PADDOCK.z1 - PADDOCK.z0 - 5) / 3);
      return new HorsePuppet(h.id, h.name, h.genome, rx, rz, scale);
    });
    if (this.herdDay !== s.day) {
      this.herdDay = s.day;
      this.herd = wildHerd(s, 0, 6)
        .map((w, i) => ({ w, i }))
        .filter(({ i }) => !s.flags[`caught:${s.day}:${i}`])
        .map(({ w, i }) => {
          let cx = WILDS.x0 + 4 + ((hashSeed(`${s.day}:${i}`) % 100) / 100) * (WILDS.x1 - WILDS.x0 - 8);
          let cz = WILDS.z0 + 4 + ((hashSeed(`z${s.day}:${i}`) % 100) / 100) * (WILDS.z1 - WILDS.z0 - 8);
          if (tileAt(cx, cz) === T.water) {
            cx = WILDS.x0 + 6;
            cz = WILDS.z0 + 6 + i * 3;
          }
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
    this.fixPlayer();
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

  private toBuffer(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / this.zoom, (e.clientY - r.top) / this.zoom];
  }

  private hitAt(x: number, y: number): Hit | undefined {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return undefined;
  }

  private bindInput(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active || this.paused) return;
      const [x, y] = this.toBuffer(e);
      this.canvas.setPointerCapture(e.pointerId);
      if (this.tug) {
        this.holding = true;
        return;
      }
      const h = this.hitAt(x, y);
      if (h) return h.act();
      this.target = { x: (this.camX + x) / TILE, z: (this.camY + y) / TILE };
    });
    this.canvas.addEventListener("pointermove", (e) => {
      const [x, y] = this.toBuffer(e);
      this.canvas.style.cursor = this.hitAt(x, y) ? "pointer" : "";
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
    this.easeClock(dt);
    this.render();
    if (this.minimapCanvas) this.minimap.drawLocal(this.minimapCanvas, this.mapMarks(), dt);
  };

  /** 钟往前跳了一大段时，画面上的钟追过去：差得越多追得越快，一两秒内追上；新的一天直接对齐。 */
  private easeClock(dt: number): void {
    const d = this.state.clock - this.shown;
    if (d < 0 || d > 24 * 60) this.shown = this.state.clock;
    else if (d > 0) this.shown += Math.min(d, Math.max(60, d * 3) * dt);
  }

  /** 小地图要的：人在哪、马在哪。 */
  mapMarks(): MapMarks {
    const p = this.state.player;
    return {
      x: p.x,
      z: p.z,
      horses: [...this.paddock.map((h) => ({ x: h.x, z: h.z, wild: false })), ...this.herd.map((h) => ({ x: h.x, z: h.z, wild: true }))],
    };
  }

  /** 人现在在哪片地方（小地图下面的名字）。 */
  get regionName(): string {
    const p = this.state.player;
    return regionAt(p.x, p.z)?.name ?? "";
  }

  private update(dt: number): void {
    this.time += dt;
    const s = this.state;
    this.movePlayer(dt);
    // 时间不会自己走：只有走到另一片地方，路上才花一段时间。
    const arrived = arrivedRegion(s.player.x, s.player.z);
    if (arrived && arrived.id !== this.place) {
      if (this.place) {
        travel(s);
        this.hooks.onChange();
      }
      this.place = arrived.id;
    }
    this.updatePaddock(dt);
    this.updateHerd(dt);
    this.tiedun?.update(dt);
    this.updateLasso(dt);
    this.ambient.update(dt, { cx: this.camX, cy: this.camY, bw: this.buf.width, bh: this.buf.height }, this.shown, {
      x: s.player.x,
      z: s.player.z,
      running: this.running,
      moving: this.moving,
    });
    for (const f of this.float) f.t += dt;
    this.float = this.float.filter((f) => f.t < 1.6);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 2.6) this.banner = null;
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
    if (this.keys.has("w") || this.keys.has("arrowup")) dz -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dz += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;
    let speed = this.running ? RUN : WALK;
    if (!dx && !dz && this.target) {
      const tx = this.target.x - p.x;
      const tz = this.target.z - p.z;
      const d = Math.hypot(tx, tz);
      if (d < 0.15) this.target = null;
      else {
        dx = tx / d;
        dz = tz / d;
        if (d > 12) speed = RUN;
        speed = Math.min(speed, d / Math.max(dt, 1e-3));
      }
    }
    const len = Math.hypot(dx, dz);
    this.moving = len > 0;
    if (!len) return;
    dx /= len;
    dz /= len;
    this.dir = Math.abs(dx) > Math.abs(dz) * 1.1 ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up";
    const nx = p.x + dx * speed * dt;
    const nz = p.z + dz * speed * dt;
    const ok = (x: number, z: number): boolean =>
      walkable(x - 0.3, z) && walkable(x + 0.3, z) && !crossesFence(p.x, p.z, x, z) && !this.fenceClose(x, z);
    if (ok(nx, nz)) {
      p.x = nx;
      p.z = nz;
    } else if (ok(nx, p.z)) p.x = nx;
    else if (ok(p.x, nz)) p.z = nz;
    else this.target = null;
    this.walkPhase += dt * speed * 1.6;
  }

  /** 人的身体有宽度，贴着竖着的围栏走不过去。 */
  private fenceClose(x: number, z: number): boolean {
    for (const f of FENCES) {
      if (f.horizontal) {
        if (Math.abs(z - f.z) < 0.15 && x > f.x - 0.2 && x < f.x + 1.2) return true;
      } else if (Math.abs(x - f.x) < 0.3 && z > f.z && z < f.z + 1) return true;
    }
    return false;
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
          h.tx = PADDOCK.x0 + 2 + r * (PADDOCK.x1 - PADDOCK.x0 - 4);
          h.tz = PADDOCK.z0 + 2 + ((r * 7.3) % 1) * (PADDOCK.z1 - PADDOCK.z0 - 3);
        }
        h.timer = 3 + r * 5;
      }
      steer(h, h.tx, h.tz, (1.4 * h.scale + 0.3) / METERS_PER_TILE);
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
      const fleeR = 4.5 + (1 - courage) * 1.1;
      if (d < fleeR) {
        // 受惊：往远离人的方向跑，胆小的马跑得更凶。
        const sp = Math.min(h.plan.topSpeed * (0.5 - courage * 0.06), 8) / METERS_PER_TILE;
        let fx = dx / (d || 1);
        let fz = dz / (d || 1);
        if (h.x < WILDS.x0 + 3 || h.x > WILDS.x1 - 3) fx *= -0.3;
        if (h.z < WILDS.z0 + 3 || h.z > WILDS.z1 - 3) fz *= -0.3;
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
            h.tx = Math.max(WILDS.x0 + 3, Math.min(WILDS.x1 - 3, h.x + (Math.random() - 0.5) * 14));
            h.tz = Math.max(WILDS.z0 + 3, Math.min(WILDS.z1 - 3, h.z + (Math.random() - 0.5) * 14));
          }
          h.timer = 3 + Math.random() * 5;
        }
        steer(h, h.tx, h.tz, 1.5 / METERS_PER_TILE);
      }
      // 别跑进水塘。
      const nx = h.x + h.vx * dt;
      const nz = h.z + h.vz * dt;
      if (Math.hypot(nx - POND.x, (nz - POND.z) * 1.2) < POND.r + 0.6) {
        const ax = h.x - POND.x;
        const az = h.z - POND.z;
        const al = Math.hypot(ax, az) || 1;
        h.vx = (ax / al) * Math.hypot(h.vx, h.vz);
        h.vz = (az / al) * Math.hypot(h.vx, h.vz);
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
      const k = (d - THROW_RANGE + 1) / d;
      this.target = { x: s.player.x + (h.x - s.player.x) * k, z: s.player.z + (h.z - s.player.z) * k };
      return;
    }
    const thrown = throwLasso(s);
    if (!thrown.ok) {
      this.hooks.onToast(thrown.reason);
      return;
    }
    this.hooks.onChange();
    const chance = Math.max(0.15, Math.min(0.9, 1 - d / 9 - (h.speed * METERS_PER_TILE) / 22));
    const dx = h.x - s.player.x;
    const dz = h.z - s.player.z;
    this.dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up";
    this.rope = { target: h, t: 0, dur: 0.35 + d * 0.05, hit: Math.random() < chance };
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
          this.floatText("套中了", h.x, h.z, "#f6d05a");
        } else this.floatText("没套中", h.x, h.z, "#fbefd4");
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
    const pull = (0.8 + tug.strength * 0.6) / METERS_PER_TILE;
    h.vx = (dx / d) * pull * (0.6 + tug.tension);
    h.vz = (dz / d) * pull * (0.6 + tug.tension);
    if (d > THROW_RANGE + 1.5) {
      h.x = s.player.x + (dx / d) * (THROW_RANGE + 1.5);
      h.z = s.player.z + (dz / d) * (THROW_RANGE + 1.5);
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
      this.floatText(tug.high > 0.45 ? "绳子断了" : "挣脱了", h.x, h.z, "#fbefd4");
      h.roped = false;
      h.vx = (dx / d) * 6;
      h.vz = (dz / d) * 6;
      this.tug = null;
      this.holding = false;
    }
  }

  private floatText(text: string, x: number, z: number, color: string): void {
    this.float.push({ text, x, z, t: 0, color });
  }

  /* ---------------- 画面 ---------------- */

  render(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth || 960;
    const H = this.canvas.clientHeight || 540;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    // 整数倍放大，保证像素方正。
    this.zoom = Math.max(2, Math.min(5, Math.round(Math.min(W / (24 * TILE), H / (14 * TILE)))));
    const bw = Math.ceil(W / this.zoom);
    const bh = Math.ceil(H / this.zoom);
    if (this.buf.width !== bw || this.buf.height !== bh) {
      this.buf.width = bw;
      this.buf.height = bh;
    }
    const b = this.bctx;
    b.imageSmoothingEnabled = false;
    const s = this.state;
    // 镜头跟着人走，不出地图边。
    const px = s.player.x * TILE;
    const pz = s.player.z * TILE;
    this.camX = Math.round(Math.max(0, Math.min(MAP_W * TILE - bw, px - bw / 2)));
    this.camY = Math.round(Math.max(0, Math.min(MAP_H * TILE - bh, pz - bh / 2)));
    const cx = this.camX;
    const cy = this.camY;
    this.hits = [];
    this.labels = [];
    this.screenPx = this.zoom * dpr;
    // 字按 24px 的大小画（一个字像素两个 CSS 像素），比美术像素细一档，和界面上的字一样大。
    this.textPx = Math.max(2, Math.round(2 * dpr));
    const amb = ambientAt(this.shown);
    const t = this.time;

    b.fillStyle = "#1d3d1f";
    b.fillRect(0, 0, bw, bh);
    b.drawImage(this.ground, cx, cy, bw, bh, 0, 0, bw, bh);
    this.drawWater(b, cx, cy, bw, bh);
    this.drawReflections(b, cx, cy, bw, bh);

    /** 夜里的光源（缓冲坐标）；cores 是灯芯，最后再加一圈辉光。 */
    const lights: Light[] = [];
    const cores: Light[] = [];
    const glows: Array<() => void> = [];
    const items: Drawable[] = [];
    const visible = (x: number, y: number, m: number): boolean => x > cx - m && x < cx + bw + m && y > cy - m && y < cy + bh + m * 2;

    for (const bd of BUILDINGS) {
      const sp = buildingSprite(bd);
      const ox = bd.x * TILE;
      const oy = (bd.z + bd.d) * TILE;
      if (!visible(ox + (bd.w * TILE) / 2, oy, bd.w * TILE + 40)) continue;
      const sx = ox - sp.ax - cx;
      const sy = oy - sp.ay - cy;
      // 人走到房子后面时，房子变半透明。
      const behind = pz < oy && pz > oy - sp.ay + 8 && px > sx + cx && px < sx + cx + sp.img.width;
      items.push({
        y: oy,
        draw: () => {
          if (behind) b.globalAlpha = 0.55;
          b.drawImage(sp.img, sx, sy);
          if (sp.hub) drawBlades(b, ox + sp.hub[0] - cx, oy + sp.hub[1] - cy, t);
          b.globalAlpha = 1;
        },
      });
      if (sp.glow) {
        const glow = sp.glow;
        glows.push(() => {
          b.globalAlpha = Math.min(1, amb.night * 1.3) * (behind ? 0.55 : 1);
          b.drawImage(glow, sx, sy);
        });
      }
      for (const l of sp.lights) {
        const lx = ox + l.x - cx;
        const ly = oy + l.y - cy;
        let power = l.kind === "spill" ? 0.75 : 1;
        if (l.kind === "flicker") power = 0.8 + Math.sin(t * 11 + lx) * 0.1 + Math.sin(t * 27 + ly) * 0.08;
        if (l.kind === "beacon") {
          const on = (t * 0.7) % 1 < 0.35;
          if (on) {
            cores.push({ x: lx, y: ly, r: l.r, color: l.color, power: 1 });
            glows.push(() => {
              b.globalAlpha = 1;
              b.fillStyle = "#ff6a50";
              b.fillRect(Math.round(lx) - 1, Math.round(ly) - 1, 3, 2);
            });
          }
          continue;
        }
        lights.push({ x: lx, y: ly, r: l.r, color: l.color, power });
        if (l.kind !== "spill") cores.push({ x: lx, y: ly, r: Math.round(l.r * 0.7), color: l.color, power: power * 0.8 });
      }
    }
    for (const p of PROPS) {
      const x = p.x * TILE;
      const y = p.z * TILE;
      if (!visible(x, y, p.kind === "fountain" ? 70 : 44)) continue;
      const sp = propSprite(p);
      const tree = TREES.has(p.kind);
      const sways = SWAYS.has(p.kind);
      const sr = SHADOW[p.kind] ?? 0;
      items.push({
        y,
        draw: () => {
          if (sr) shadow(b, x - cx, y - cy, sr);
          // 人走到树后面时，树变半透明。
          if (tree && pz < y && pz > y - sp.img.height + 6 && Math.abs(px - x) < sp.img.width / 2) b.globalAlpha = 0.5;
          const sx = Math.round(x - sp.ax - cx);
          let sy = Math.round(y - sp.ay - cy);
          if (p.kind === "boat") sy += Math.round(Math.sin(t * 1.6 + p.x) * 0.8);
          if (p.kind === "flag") drawFlag(b, sp.img, sx, sy, t + p.v);
          else if (sways) {
            // 风吹过来，树冠和草尖左右晃一个像素；人从草边走过时晃得多。
            const brush = !tree && Math.hypot(px - x, pz - y) < 10 && this.moving ? 2 : 1;
            const dx = Math.round(Math.sin(t * (tree ? 1.3 : 2.2) + p.x * 0.7 + p.z * 0.3) * 0.9 * brush);
            drawSway(b, sp.img, sx, sy, dx, p.kind === "willow" ? 0.3 : tree ? 0.62 : 0.5);
          } else b.drawImage(sp.img, sx, sy);
          if (p.kind === "fountain") drawFountainWater(b, sx, sy, t);
          if (p.kind === "campfire") drawFlames(b, Math.round(x - cx), Math.round(y - cy) - 4, t);
          b.globalAlpha = 1;
        },
      });
      const lx = x - cx;
      const ly = y - cy;
      if (p.kind === "lantern") {
        const flick = 0.9 + Math.sin(t * 9 + x) * 0.06 + Math.sin(t * 23 + y) * 0.04;
        lights.push({ x: lx + 2, y: ly - 17, r: 34, color: "#ff9a5a", power: flick });
        cores.push({ x: lx + 2, y: ly - 17, r: 16, color: "#ff8a4a", power: flick });
      } else if (p.kind === "lamppost") {
        const c = p.v ? "#d8ecff" : "#ffd27a";
        lights.push({ x: lx, y: ly - 26, r: 48, color: c, power: p.v ? 0.7 : 0.95 });
        cores.push({ x: lx, y: ly - 32, r: 14, color: c, power: 1 });
        glows.push(() => {
          b.globalAlpha = Math.min(1, amb.night * 1.4);
          b.fillStyle = p.v ? "#f4faff" : "#fff0b0";
          b.fillRect(Math.round(lx) - 3, Math.round(ly) - 35, 6, 5);
        });
      } else if (p.kind === "campfire") {
        const flick = 0.85 + Math.sin(t * 13 + x) * 0.1 + Math.sin(t * 31) * 0.05;
        lights.push({ x: lx, y: ly - 6, r: 64, color: "#ff8a3a", power: flick });
        cores.push({ x: lx, y: ly - 8, r: 20, color: "#ffb04a", power: flick });
      } else if (p.kind === "fountain") {
        lights.push({ x: lx, y: ly - 26, r: 56, color: "#8ad0ff", power: 0.45 });
      }
    }
    for (const f of FENCES) {
      const x = f.x * TILE;
      const y = f.z * TILE;
      if (!visible(x, y, 20)) continue;
      items.push({ y: f.horizontal ? y + 1 : y + TILE, draw: () => drawFence(b, x - cx, y - cy, f) });
    }

    // 人物和马。
    for (const n of NPCS) {
      const x = n.x * TILE;
      const y = n.z * TILE;
      if (!visible(x, y, 30)) continue;
      items.push({
        y,
        draw: () => {
          shadow(b, x - cx, y - cy, 5);
          const f = personFrame(n.look, n.dir, Math.floor(t * 1.5 + n.x) % 2 ? 0 : 2);
          b.drawImage(f, Math.round(x - 9 - cx), Math.round(y - 26 - cy));
        },
      });
    }
    const horseItem = (h: HorsePuppet, onClick: (() => void) | null, tag: string | null, mark: boolean): void => {
      const x = h.x * TILE;
      const y = h.z * TILE;
      if (!visible(x, y, 50)) return;
      items.push({
        y,
        draw: () => {
          shadow(b, x - cx, y - cy, Math.round(11 * h.scale));
          const r = h.drawPixel(b, x - cx, y - cy, HORSE_PPM);
          if (onClick) this.hits.push({ x: r.x, y: r.y, w: r.w, h: r.h, act: onClick });
          if (r.bubble) {
            const { text, x: bx, y: by } = r.bubble;
            const [Z, k] = [this.screenPx, this.textPx];
            this.labels.push((sc) => thinkBubble(sc, Math.round(bx) * Z, Math.round(by) * Z, text, k));
          }
          // 马头顶的高度：按体型估，不用缓冲画布的上沿（那里留了空白）。
          const top = Math.round(y - cy - 2.5 * HORSE_PPM * h.scale);
          if (tag && Math.hypot(h.x - s.player.x, h.z - s.player.z) < 5) {
            // 名牌放在画出来的马最高处（头或耳朵）上面一点，居中对着马身。
            const head = Math.round(y - cy) - h.headHeight();
            const [sx, sy, k] = [Math.round(x - cx) * this.screenPx, (head - 3) * this.screenPx, this.textPx];
            this.labels.push((sc) => nameTag(sc, sx, sy, tag, k));
          }
          if (mark) drawArrow(b, Math.round(x - cx), top - 10 + Math.round(Math.sin(t * 6) * 1.5));
        },
      });
    };
    for (const h of this.paddock) horseItem(h, () => this.hooks.onHorseClick(h.id), h.name, false);
    const inWilds = inside(WILDS, s.player.x, s.player.z) || this.region === "wilds";
    for (const h of this.herd) {
      const near = Math.hypot(h.x - s.player.x, h.z - s.player.z) <= THROW_RANGE;
      horseItem(h, () => this.throwAt(h), null, inWilds && near && !this.tug && !this.rope);
    }
    if (this.tiedun) horseItem(this.tiedun, null, inside(YARD, s.player.x, s.player.z + 3) ? this.tiedun.name : null, false);

    items.push({
      y: pz,
      draw: () => {
        shadow(b, px - cx, pz - cy, 5);
        const frame = this.moving ? Math.floor(this.walkPhase) % 4 : 0;
        b.drawImage(personFrame(PLAYER_LOOK, this.dir, frame), Math.round(px - 9 - cx), Math.round(pz - 26 - cy));
        this.drawRope(b, cx, cy);
      },
    });

    const view = { cx, cy, bw, bh };
    this.ambient.collect(items, b, view, shadow);
    items.sort((a, c) => a.y - c.y);
    for (const it of items) it.draw();
    this.ambient.drawAbove(b, view);

    // 白天云影飘过；之后整张乘上光照贴图，夜里点灯、窗户发光，再加一圈辉光。
    this.lighting.drawClouds(b, cx, cy, bw, bh, t, amb);
    if (amb.night > 0.05) lights.push({ x: px - cx, y: pz - cy - 8, r: 44, color: "#ffe0b0", power: 0.4 });
    if (this.lighting.apply(b, bw, bh, lights, amb) && amb.night > 0.05) {
      for (const g of glows) g();
      b.globalAlpha = 1;
      this.lighting.bloom(b, cores, amb);
    }
    this.lighting.drawRays(b, cx, bw, bh, t, amb);
    this.ambient.drawNight(b, view, amb.night);

    this.drawOverlay(b, cx, cy, bw, bh);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf, 0, 0, bw, bh, 0, 0, bw * this.zoom * dpr, bh * this.zoom * dpr);
    for (const l of this.labels) l(ctx);
    ctx.globalAlpha = 1;
  }

  /**
   * 水里的倒影：水边的树、灯、人倒过来画进一张缓冲，染上水色，
   * 只留水面那部分，再一行行错开一两个像素贴上去（波纹）。
   */
  private drawReflections(b: CanvasRenderingContext2D, cx: number, cy: number, bw: number, bh: number): void {
    const x0 = Math.floor(cx / TILE);
    const z0 = Math.floor(cy / TILE);
    const x1 = Math.ceil((cx + bw) / TILE);
    const z1 = Math.ceil((cy + bh) / TILE);
    const water: Array<[number, number, number, number]> = [];
    const wet = (x: number, z: number): boolean => {
      const k = tileAt(x, z);
      return k === T.water || k === T.bridge;
    };
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (tileAt(x, z) !== T.water) continue;
        const l = wet(x - 1, z) ? 0 : 3;
        const r = wet(x + 1, z) ? 0 : 3;
        const top = wet(x, z - 1) ? 0 : 4;
        const bot = wet(x, z + 1) ? 0 : 3;
        water.push([x * TILE - cx + l, z * TILE - cy + top, TILE - l - r, TILE - top - bot]);
      }
    if (!water.length) return;
    const r = this.rctx;
    if (this.rbuf.width !== bw || this.rbuf.height !== bh) {
      this.rbuf.width = bw;
      this.rbuf.height = bh;
    }
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.globalCompositeOperation = "source-over";
    r.clearRect(0, 0, bw, bh);
    r.imageSmoothingEnabled = false;
    const mirror = (img: HTMLCanvasElement, x: number, footY: number, top: number): void => {
      r.setTransform(1, 0, 0, -1, 0, Math.round(footY) * 2);
      r.drawImage(img, Math.round(x), Math.round(top));
    };
    for (const p of this.reflectors) {
      const x = p.x * TILE - cx;
      const y = p.z * TILE - cy;
      if (x < -60 || x > bw + 60 || y < -80 || y > bh + 10) continue;
      const sp = propSprite(p);
      mirror(sp.img, x - sp.ax, y, y - sp.ay);
    }
    const s = this.state;
    const people: Array<{ look: PersonLook; x: number; z: number; dir: Dir; frame: number }> = [
      ...NPCS.map((n) => ({ look: n.look, x: n.x, z: n.z, dir: n.dir, frame: 0 })),
      ...this.ambient.people(),
      { look: PLAYER_LOOK, x: s.player.x, z: s.player.z, dir: this.dir, frame: this.moving ? Math.floor(this.walkPhase) % 4 : 0 },
    ];
    for (const m of people) {
      if (!nearWaterBelow(m.x, m.z)) continue;
      const x = m.x * TILE - cx;
      const y = m.z * TILE - cy;
      if (x < -20 || x > bw + 20 || y < -40 || y > bh + 10) continue;
      mirror(personFrame(m.look, m.dir, m.frame), x - 9, y, y - 26);
    }
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.globalCompositeOperation = "source-atop";
    r.fillStyle = "rgba(36,90,150,0.5)";
    r.fillRect(0, 0, bw, bh);
    r.globalCompositeOperation = "destination-in";
    r.fillStyle = "#ffffff";
    r.beginPath();
    let minY = bh;
    let maxY = 0;
    for (const [x, y, w, h] of water) {
      r.rect(x, y, w, h);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + h);
    }
    r.fill();
    r.globalCompositeOperation = "source-over";
    b.globalAlpha = 0.55;
    for (let y = Math.max(0, minY); y < Math.min(bh, maxY); y++) {
      // 波纹的相位跟着地图上的行走，不跟屏幕行：镜头上下移动时波纹不会跟着快速滚动。
      const off = Math.round(Math.sin((y + cy) * 0.5 + this.time * 2.4) * 1.1);
      b.drawImage(this.rbuf, 0, y, bw, 1, off, y, bw, 1);
    }
    b.globalAlpha = 1;
  }

  private drawWater(b: CanvasRenderingContext2D, cx: number, cy: number, bw: number, bh: number): void {
    const x0 = Math.floor(cx / TILE);
    const z0 = Math.floor(cy / TILE);
    const x1 = Math.ceil((cx + bw) / TILE);
    const z1 = Math.ceil((cy + bh) / TILE);
    b.fillStyle = "rgba(220,240,255,0.75)";
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (tileAt(x, z) !== T.water) continue;
        const hsh = hashSeed(`w${x},${z}`);
        const phase = (this.time * 0.8 + (hsh % 100) / 100) % 2;
        if (phase > 1) continue;
        const sx = x * TILE + (hsh % 10) + Math.round(phase * 3) - cx;
        const sy = z * TILE + ((hsh >>> 4) % 12) + 2 - cy;
        b.fillRect(sx, sy, 3 + Math.round(phase * 2), 1);
      }
  }

  private drawRope(b: CanvasRenderingContext2D, cx: number, cy: number): void {
    const pl = this.state.player;
    const hx = pl.x * TILE - cx + (this.dir === "left" ? -5 : 5);
    const hy = pl.z * TILE - cy - 14;
    let tx: number;
    let ty: number;
    if (this.rope) {
      const h = this.rope.target;
      const k = this.rope.t / this.rope.dur;
      const ex = h.x * TILE - cx;
      const ey = h.z * TILE - cy - 18 * h.scale;
      tx = hx + (ex - hx) * k;
      ty = hy + (ey - hy) * k - Math.sin(k * Math.PI) * 18;
    } else if (this.tug) {
      const h = this.tug.horse;
      tx = h.x * TILE - cx + 10 * h.facing;
      ty = h.z * TILE - cy - 18 * h.scale;
    } else return;
    b.strokeStyle = "#e0bd7a";
    b.lineWidth = 1;
    b.beginPath();
    b.moveTo(Math.round(hx) + 0.5, Math.round(hy) + 0.5);
    const sag = this.tug ? (1 - this.tug.tension) * 10 : 0;
    b.quadraticCurveTo((hx + tx) / 2, (hy + ty) / 2 + sag, Math.round(tx) + 0.5, Math.round(ty) + 0.5);
    b.stroke();
    if (this.rope) {
      b.beginPath();
      b.ellipse(Math.round(tx) + 0.5, Math.round(ty) + 0.5, 5, 3, 0, 0, Math.PI * 2);
      b.stroke();
    }
  }

  private drawOverlay(b: CanvasRenderingContext2D, cx: number, cy: number, bw: number, bh: number): void {
    const Z = this.screenPx;
    const k = this.textPx;
    for (const f of this.float) {
      const x = (f.x * TILE - cx) * Z;
      const y = (f.z * TILE - cy - 36) * Z - f.t * 12 * k;
      const alpha = Math.max(0, 1 - f.t / 1.6);
      this.labels.push((sc) => {
        sc.globalAlpha = alpha;
        floatText(sc, x, y, f.text, f.color, k);
        sc.globalAlpha = 1;
      });
    }
    if (this.nearby && !this.tug) {
      const it = this.nearby;
      const x = Math.round(it.x * TILE - cx) * Z;
      const y = Math.round(it.z * TILE - cy - 30) * Z;
      this.labels.push((sc) => {
        const r = bubble(sc, x, y, it.label, k);
        // 点击区域按缓冲坐标记。
        this.hits.push({ x: r.x / Z, y: r.y / Z, w: r.w / Z, h: r.h / Z, act: () => this.hooks.onInteract(it.id) });
      });
    }
    if (this.tug) {
      const y0 = drawTugGauge(b, bw, bh, this.tug);
      this.labels.push((sc) => floatText(sc, (bw / 2) * Z, (y0 - 11) * Z - (13 * k) / 2, "按住拉绳", "#fbefd4", k));
    }
    if (this.banner) {
      const t = this.banner.t;
      const slide = t < 0.3 ? (0.3 - t) / 0.3 : t > 2.2 ? (t - 2.2) / 0.4 : 0;
      // 地名木牌和界面上的标题一样大：一个字像素三个 CSS 像素。
      const K = Math.round((3 * Z) / this.zoom);
      const text = this.banner.text;
      this.labels.push((sc) => banner(sc, (bw / 2) * Z, (8 - slide * 40) * K, text, K));
    }
  }
}

function steer(h: HorsePuppet, tx: number, tz: number, speed: number): void {
  const dx = tx - h.x;
  const dz = tz - h.z;
  const d = Math.hypot(dx, dz);
  const want = d < 0.4 ? 0 : Math.min(speed, d);
  const vx = d > 0.01 ? (dx / d) * want : 0;
  const vz = d > 0.01 ? (dz / d) * want : 0;
  h.vx += (vx - h.vx) * 0.08;
  h.vz += (vz - h.vz) * 0.08;
}

/** 这一点往下几格之内有水（倒影用）。 */
function nearWaterBelow(x: number, z: number): boolean {
  for (let k = 0.6; k <= 3.6; k += 1) if (tileAt(x, z + k) === T.water) return true;
  return false;
}

/** 脚下的影子：一个像素椭圆，往右偏一点（光从左上来）。 */
function shadow(b: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  b.fillStyle = "rgba(20,34,16,0.3)";
  const rx = Math.round(x) + 1;
  const ry = Math.round(y);
  const h = Math.max(1, Math.round(r * 0.36));
  for (let dy = -h; dy <= h; dy++) {
    const w = Math.round(r * Math.sqrt(Math.max(0, 1 - (dy / (h + 0.6)) ** 2)));
    if (w > 0) b.fillRect(rx - w, ry + dy, w * 2, 1);
  }
}

function drawFence(b: CanvasRenderingContext2D, x: number, y: number, f: Fence): void {
  if (f.metal) {
    // 研究所的白铁栅栏：细杆、尖头、两道横杆。
    const bar = (bx: number, by: number, h: number): void => {
      b.fillStyle = "#3a3e46";
      b.fillRect(bx - 1, by - h - 1, 3, h + 1);
      b.fillStyle = "#e8eaf0";
      b.fillRect(bx, by - h, 1, h);
      b.fillRect(bx, by - h - 2, 1, 1);
    };
    if (f.horizontal) {
      b.fillStyle = "#3a3e46";
      b.fillRect(x, y - 13, TILE + 1, 3);
      b.fillRect(x, y - 6, TILE + 1, 3);
      b.fillStyle = "#e8eaf0";
      b.fillRect(x, y - 12, TILE + 1, 1);
      b.fillRect(x, y - 5, TILE + 1, 1);
      for (let i = 0; i < TILE; i += 4) bar(x + i, y, 14);
    } else {
      b.fillStyle = "#3a3e46";
      b.fillRect(x - 1, y - 12, 3, TILE + 2);
      b.fillStyle = "#e8eaf0";
      b.fillRect(x, y - 12, 1, TILE + 1);
      bar(x, y + TILE, 14);
    }
    return;
  }
  const post = (px: number, py: number): void => {
    b.fillStyle = "#3a2414";
    b.fillRect(px - 1, py - 13, 5, 14);
    b.fillStyle = "#a8733f";
    b.fillRect(px, py - 12, 3, 12);
    b.fillStyle = "#c99a5e";
    b.fillRect(px, py - 12, 1, 12);
    b.fillStyle = "#d8b07a";
    b.fillRect(px, py - 12, 3, 1);
  };
  if (f.horizontal) {
    b.fillStyle = "rgba(20,34,16,0.25)";
    b.fillRect(x + 1, y + 1, TILE, 2);
    b.fillStyle = "#3a2414";
    b.fillRect(x, y - 11, TILE + 1, 4);
    b.fillRect(x, y - 6, TILE + 1, 4);
    b.fillStyle = "#b07a46";
    b.fillRect(x, y - 10, TILE + 1, 2);
    b.fillRect(x, y - 5, TILE + 1, 2);
    b.fillStyle = "#d0a06a";
    b.fillRect(x, y - 10, TILE + 1, 1);
    b.fillRect(x, y - 5, TILE + 1, 1);
    post(x - 1, y);
  } else {
    b.fillStyle = "#3a2414";
    b.fillRect(x - 1, y - 10, 5, TILE + 2);
    b.fillStyle = "#a8733f";
    b.fillRect(x, y - 10, 3, TILE + 1);
    b.fillStyle = "#d0a06a";
    b.fillRect(x, y - 10, 1, TILE + 1);
    post(x, y + TILE);
  }
}

/** 风车的四片叶子，绕着轮毂慢慢转。 */
function drawBlades(b: CanvasRenderingContext2D, hx: number, hy: number, t: number): void {
  const a0 = t * 0.9;
  for (let i = 0; i < 4; i++) {
    const a = a0 + (i * Math.PI) / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let k = 3; k < 30; k++) {
      const x = Math.round(hx + ca * k);
      const y = Math.round(hy + sa * k * 0.92);
      b.fillStyle = "#3a2414";
      b.fillRect(x - 1, y - 1, 2, 2);
      // 帆布：在杆子一侧铺一条格子。
      if (k > 8) {
        for (let w = 1; w < 7; w++) {
          const sx = Math.round(x - sa * w);
          const sy = Math.round(y + ca * w * 0.92);
          b.fillStyle = (k + w) % 4 === 0 ? "#8a6a42" : w === 6 ? "#b8a37a" : "#f0e6cc";
          b.fillRect(sx, sy, 1, 1);
        }
      }
    }
  }
  b.fillStyle = "#3a2414";
  b.fillRect(Math.round(hx) - 2, Math.round(hy) - 2, 5, 5);
  b.fillStyle = "#a8733f";
  b.fillRect(Math.round(hx) - 1, Math.round(hy) - 1, 3, 3);
}

/** 喷泉的水：顶上一股水柱，两层水盘往下淌，池子里一圈圈波纹和闪光。坐标按喷泉贴图。 */
function drawFountainWater(b: CanvasRenderingContext2D, sx: number, sy: number, t: number): void {
  const cx = sx + 50;
  const dot = (x: number, y: number, c: string): void => {
    b.fillStyle = c;
    b.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  // 水柱
  b.fillStyle = "#bfe6ff";
  b.fillRect(cx - 1, sy + 2, 2, 9);
  dot(cx - 1, sy + 2 + ((t * 18) % 8), "#ffffff");
  for (let i = 0; i < 6; i++) {
    const ph = (t * 1.4 + i / 6) % 1;
    const side = i % 2 ? 1 : -1;
    dot(cx + side * (1 + ph * 6), sy + 2 + ph * 14 - Math.sin(ph * Math.PI) * 4, ph < 0.5 ? "#ffffff" : "#9fd8ff");
  }
  // 小水盘往大水盘淌：一圈竖着的水帘，水珠往下走。
  for (let a = 0; a <= 12; a++) {
    const th = (a / 12) * Math.PI;
    const x = cx + Math.cos(th) * 7;
    const y0 = sy + 19 + Math.sin(th) * 2.6;
    for (let y = y0; y < sy + 31 + Math.sin(th) * 4; y++) if ((Math.floor(y - t * 22) + a * 2) % 4 < 2) dot(x, y, (a + Math.floor(y)) % 3 ? "#9fd8ff" : "#e8f6ff");
  }
  // 大水盘往池子淌。
  for (let a = 0; a <= 20; a++) {
    const th = (a / 20) * Math.PI;
    const x = cx + Math.cos(th) * 17;
    const y0 = sy + 37 + Math.sin(th) * 5.5;
    for (let y = y0; y < y0 + 12 + Math.sin(th) * 4; y++) if ((Math.floor(y - t * 26) + a * 3) % 5 < 2) dot(x, y, (a + Math.floor(y)) % 3 ? "#8ac8f0" : "#e8f6ff");
  }
  // 池子里的波纹
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.45 + i / 3) % 1;
    const rx = 19 + ph * 19;
    const ry = rx * 0.33;
    b.globalAlpha = 1 - ph;
    for (let k = 0; k < 40; k++) {
      const th = (k / 40) * Math.PI * 2;
      if ((k + i) % 3 === 0) continue;
      dot(cx + Math.cos(th) * rx, sy + 58 + Math.sin(th) * ry, "#a8dcff");
    }
    b.globalAlpha = 1;
  }
  // 水面的闪光
  for (let i = 0; i < 7; i++) {
    const h = hashSeed(`f${i}:${Math.floor(t * 2 + i * 0.37)}`);
    const th = ((h % 628) / 100) * 1;
    const rr = 0.4 + ((h >>> 10) % 60) / 100;
    dot(cx + Math.cos(th) * 36 * rr, sy + 58 + Math.sin(th) * 11 * rr, "#ffffff");
  }
}

/** 篝火的火苗：三层颜色，一跳一跳，往上飘火星。 */
function drawFlames(b: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const layers: Array<[string, number, number]> = [
    ["#d8402a", 5, 11],
    ["#f28a2a", 4, 8],
    ["#ffd25a", 2, 5],
  ];
  for (const [c, w, h] of layers) {
    b.fillStyle = c;
    for (let dx = -w; dx <= w; dx++) {
      const k = 1 - Math.abs(dx) / (w + 1);
      const hh = Math.round(h * k * (0.75 + 0.25 * Math.sin(t * 14 + dx * 1.7 + w)));
      b.fillRect(x + dx, y - hh, 1, hh);
    }
  }
  for (let i = 0; i < 4; i++) {
    const ph = (t * 0.9 + i * 0.27) % 1;
    b.fillStyle = ph < 0.5 ? "#ffd25a" : "#f28a2a";
    b.fillRect(Math.round(x + Math.sin(t * 3 + i * 2) * 3), Math.round(y - 10 - ph * 18), 1, 1);
  }
}

/** 可以套的马头上一个上下跳的黄色箭头。 */
function drawArrow(b: CanvasRenderingContext2D, ax: number, ay: number): void {
  b.fillStyle = "#2a1a12";
  b.fillRect(ax - 5, ay - 1, 11, 4);
  b.fillRect(ax - 4, ay + 3, 9, 2);
  b.fillRect(ax - 3, ay + 5, 7, 2);
  b.fillRect(ax - 2, ay + 7, 5, 2);
  b.fillRect(ax - 1, ay + 9, 3, 1);
  b.fillStyle = "#f6d05a";
  b.fillRect(ax - 4, ay, 9, 3);
  b.fillRect(ax - 3, ay + 3, 7, 2);
  b.fillRect(ax - 2, ay + 5, 5, 2);
  b.fillRect(ax - 1, ay + 7, 3, 2);
  b.fillStyle = "#fff2b0";
  b.fillRect(ax - 3, ay, 3, 1);
}

/** 上半截（树冠、草尖）错开 dx 个像素，下半截不动。 */
function drawSway(b: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, dx: number, split: number): void {
  if (dx === 0) {
    b.drawImage(img, x, y);
    return;
  }
  const cut = Math.round(img.height * split);
  b.drawImage(img, 0, 0, img.width, cut, x + dx, y, img.width, cut);
  b.drawImage(img, 0, cut, img.width, img.height - cut, x, y + cut, img.width, img.height - cut);
}

/** 旗子：旗杆不动，旗面一列一列上下起伏。 */
function drawFlag(b: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, t: number): void {
  b.drawImage(img, 0, 0, 4, img.height, x, y, 4, img.height);
  for (let col = 4; col < img.width; col++) {
    const off = Math.round(Math.sin(t * 6 - col * 0.7) * ((col - 3) / 6));
    b.drawImage(img, col, 0, 1, 14, x + col, y + off, 1, 14);
  }
}

function woodPlank(b: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  b.fillStyle = "#2a1a12";
  b.fillRect(x - 1, y - 1, w + 2, h + 2);
  b.fillStyle = "#a8622c";
  b.fillRect(x, y, w, h);
  b.fillStyle = "#d08a44";
  b.fillRect(x, y, w, 2);
  b.fillStyle = "#7a4218";
  b.fillRect(x, y + h - 2, w, 2);
  b.fillStyle = "#f2c14e";
  b.fillRect(x + 3, y + h / 2 - 1, 2, 2);
  b.fillRect(x + w - 5, y + h / 2 - 1, 2, 2);
}

/** 拔河仪表：木框里一根张力条，绿区里才算拉近。画在缓冲里，返回张力条的顶边（字另外画在屏幕上）。 */
function drawTugGauge(b: CanvasRenderingContext2D, bw: number, bh: number, tug: Tug): number {
  const w = Math.min(150, bw - 20);
  const x0 = Math.round(bw / 2 - w / 2);
  const y0 = bh - 64;
  woodPlank(b, x0 - 8, y0 - 18, w + 16, 46);
  b.drawImage(icon("rope"), x0 - 4, y0 - 16);
  b.fillStyle = "#2a1a12";
  b.fillRect(x0 - 1, y0 - 1, w + 2, 12);
  b.fillStyle = "#4a3020";
  b.fillRect(x0, y0, w, 10);
  b.fillStyle = "#6abf45";
  b.fillRect(x0 + Math.round(w * 0.35), y0 + 1, Math.round(w * 0.43), 8);
  b.fillStyle = "#e0453a";
  b.fillRect(x0 + Math.round(w * 0.95), y0 + 1, Math.round(w * 0.05), 8);
  const nx = x0 + Math.round(Math.min(1, tug.tension) * w);
  b.fillStyle = "#fbefd4";
  b.fillRect(nx - 1, y0 - 3, 3, 16);
  b.fillStyle = "#2a1a12";
  b.fillRect(nx - 2, y0 - 4, 5, 1);
  b.fillRect(x0 - 1, y0 + 14, w + 2, 6);
  b.fillStyle = "#6a4a2a";
  b.fillRect(x0, y0 + 15, w, 4);
  b.fillStyle = "#f6d05a";
  b.fillRect(x0, y0 + 15, Math.round(w * Math.min(1, tug.progress)), 4);
  return y0;
}
