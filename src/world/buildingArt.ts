/**
 * 房子的像素画：星露谷那种 3/4 俯视。前墙在下，屋顶从上面看得见——
 * 正面一坡、两头的戗脊面一明一暗（光从左上来），屋脊、瓦当、檐下的阴影、石头墙基，
 * 让房子和地面、树一样有体积。
 *
 * 每栋房子画两张图：本色一张，夜里发光的窗户一张（glow），再给出夜里的光源位置。
 */
import { mix, shade } from "../render/color";
import { createRng, hashSeed, type Rng } from "../sim/rng";
import { Raster } from "./raster";
import { textSprite } from "./sprites";
import { TILE, type Building, type BuildingKind } from "./tiles";

const PADX = 18;
const PADTOP = 30;
const PADBOT = 6;

/** 光源：坐标相对房子占地的左下角（缓冲像素）。 */
export interface BuildingLight {
  x: number;
  y: number;
  r: number;
  color: string;
  /** spill 是窗户洒在地上的光；flicker 会跳动（炉火、烛火）；beacon 一闪一闪。 */
  kind: "spill" | "lamp" | "flicker" | "beacon";
}

export interface BuildingSprite {
  img: HTMLCanvasElement;
  /** 夜里亮起来的窗户、炉火，和 img 一样大，没有就是 null。 */
  glow: HTMLCanvasElement | null;
  ax: number;
  ay: number;
  lights: BuildingLight[];
  /** 烟囱口（相对占地左下角），冒烟用。 */
  chimney: [number, number] | null;
  /** 风车的轮毂。 */
  hub: [number, number] | null;
  /** 匾额上的字：不烘进贴图，放大以后画在屏幕上（见 labels.ts signText）。 */
  texts: SignText[];
}

/** 前墙高度、屋顶高出占地的部分（像素）。 */
const SPEC: Record<BuildingKind, { wall: number; rise: number }> = {
  home: { wall: 30, rise: 20 },
  barn: { wall: 34, rise: 22 },
  silo: { wall: 0, rise: 44 },
  coop: { wall: 22, rise: 12 },
  mill: { wall: 0, rise: 58 },
  bookie: { wall: 30, rise: 18 },
  lab: { wall: 34, rise: 12 },
  greenhouse: { wall: 26, rise: 14 },
  market: { wall: 32, rise: 22 },
  teahouse: { wall: 54, rise: 28 },
  store: { wall: 30, rise: 18 },
  smithy: { wall: 30, rise: 16 },
  house: { wall: 28, rise: 18 },
  shrine: { wall: 22, rise: 16 },
  zhao: { wall: 30, rise: 20 },
  booth: { wall: 18, rise: 10 },
  stand: { wall: 0, rise: 8 },
};

const WARM = "#ffc970";
const INK = "#2a1a12";

/** 匾额上的一行字：(x, y) 是牌面中心（相对贴图左上角），w 是牌面能放字的宽度。 */
export interface SignText {
  text: string;
  x: number;
  y: number;
  w: number;
  color: string;
}

/** 画一栋房子时共用的东西：画板、发光层、尺寸、光源。 */
class Painter {
  readonly r: Raster;
  readonly g: Raster;
  readonly ox = PADX;
  readonly oy: number;
  readonly W: number;
  readonly D: number;
  readonly wall: number;
  /** 屋顶最高处的 y。 */
  readonly top: number;
  readonly rng: Rng;
  lights: BuildingLight[] = [];
  texts: SignText[] = [];
  glowUsed = false;
  chimney: [number, number] | null = null;
  hub: [number, number] | null = null;

  constructor(readonly b: Building) {
    const s = SPEC[b.kind];
    this.W = b.w * TILE;
    this.D = b.d * TILE;
    this.wall = s.wall;
    const h = this.D + s.rise + PADTOP + PADBOT;
    this.r = new Raster(this.W + PADX * 2, h);
    this.g = new Raster(this.W + PADX * 2, h);
    this.oy = h - PADBOT;
    this.top = this.oy - this.D - s.rise;
    this.rng = createRng(hashSeed(`房子${b.id}`));
  }

  /** 墙顶（檐口）的 y。 */
  get wallTop(): number {
    return this.oy - this.wall;
  }

  light(x: number, y: number, r: number, color = WARM, kind: BuildingLight["kind"] = "spill"): void {
    this.lights.push({ x: x - this.ox, y: y - this.oy, r, color, kind });
  }

  glow(x: number, y: number, w: number, h: number, color = WARM): void {
    this.glowUsed = true;
    this.g.rect(x, y, w, h, color);
  }
}

/* ---------------- 墙 ---------------- */

type Material = "plaster" | "plank" | "clap" | "brick" | "stone" | "panel" | "earth";

function wallFill(p: Painter, x: number, y: number, w: number, h: number, mat: Material, base: string): void {
  const r = p.r;
  const dark = shade(base, -0.18);
  const light = shade(base, 0.14);
  r.rect(x, y, w, h, base);
  if (mat === "plaster" || mat === "earth") {
    for (let i = 0; i < (w * h) / 40; i++) r.px(x + p.rng.int(0, w - 1), y + p.rng.int(0, h - 1), p.rng.next() < 0.5 ? dark : light);
    if (mat === "earth") for (let yy = y + 3; yy < y + h; yy += 6) r.rect(x, yy, w, 1, shade(base, -0.08));
  } else if (mat === "plank") {
    for (let xx = x; xx < x + w; xx += 5) {
      r.rect(xx, y, 1, h, light);
      r.rect(xx + 4, y, 1, h, dark);
      if (p.rng.next() < 0.3) r.px(xx + 2, y + p.rng.int(2, h - 3), dark);
    }
  } else if (mat === "clap") {
    for (let yy = y; yy < y + h; yy += 4) {
      r.rect(x, yy, w, 1, light);
      r.rect(x, yy + 3, w, 1, dark);
    }
  } else if (mat === "brick") {
    const mortar = shade(base, 0.32);
    for (let yy = y, row = 0; yy < y + h; yy += 4, row++) {
      r.rect(x, yy + 3, w, 1, mortar);
      for (let xx = x + (row % 2) * 4; xx < x + w; xx += 8) r.rect(xx, yy, 1, 3, mortar);
      for (let xx = x + (row % 2) * 4 + 1; xx < x + w; xx += 8) r.rect(xx, yy, 6, 1, light);
    }
  } else if (mat === "stone") {
    for (let yy = y, row = 0; yy < y + h; yy += 6, row++) {
      let xx = x - (row % 2) * 4;
      while (xx < x + w) {
        const sw = 6 + p.rng.int(0, 5);
        const tone = shade(base, (p.rng.next() - 0.5) * 0.16);
        r.rect(Math.max(x, xx), yy, Math.min(sw, x + w - xx) - 1, 5, tone);
        r.rect(Math.max(x, xx), yy, Math.min(sw, x + w - xx) - 1, 1, shade(tone, 0.18));
        r.rect(Math.max(x, xx) + Math.min(sw, x + w - xx) - 2, yy + 1, 1, 4, shade(tone, -0.2));
        xx += sw;
      }
      r.rect(x, yy + 5, w, 1, shade(base, -0.35));
    }
  } else if (mat === "panel") {
    for (let xx = x + 15; xx < x + w; xx += 16) r.rect(xx, y, 1, h, dark);
    r.rect(x, y + Math.floor(h * 0.62), w, 1, dark);
  }
  // 两头的明暗：左边亮，右边暗；墙脚一圈暗。
  r.shade(x, y, 2, h, 1.08);
  r.shade(x + w - 3, y, 3, h, 0.84);
  r.shade(x, y + h - 2, w, 2, 0.86);
}

/** 墙基：一圈石头，比墙宽一点。 */
function foundation(p: Painter, x: number, w: number, h = 5, stone = "#9a9282"): void {
  const r = p.r;
  const y = p.oy - h;
  r.rect(x - 1, y, w + 2, h, stone);
  r.rect(x - 1, y, w + 2, 1, shade(stone, 0.25));
  r.rect(x - 1, p.oy - 1, w + 2, 1, shade(stone, -0.35));
  for (let yy = y + 1, row = 0; yy < p.oy - 1; yy += 2, row++)
    for (let xx = x + (row % 2) * 3; xx < x + w; xx += 6 + ((xx * 7) % 3)) r.px(xx, yy, shade(stone, -0.25));
  r.shade(x + w - 3, y, 4, h, 0.82);
}

/** 檐下的阴影：屋檐挡住的一条，抖动过渡。 */
function eaveShadow(p: Painter, x: number, w: number, y = p.wallTop, h = 5): void {
  p.r.shade(x, y, w, 2, 0.62);
  p.r.shade(x, y + 2, w, h - 2, 0.72, 0.5);
}

/** 木柱：左边一道亮线。 */
function post(p: Painter, x: number, y: number, h: number, color: string, w = 3): void {
  p.r.rect(x, y, w, h, color);
  p.r.rect(x, y, 1, h, shade(color, 0.22));
  p.r.rect(x + w - 1, y, 1, h, shade(color, -0.25));
}

interface WinOpts {
  trim: string;
  shutters?: string;
  box?: boolean;
  lattice?: boolean;
  cool?: boolean;
  bars?: boolean;
}

/** 窗户：窗框、往里凹的玻璃（上沿和左边有阴影）、窗台，可选百叶和花箱。夜里玻璃发光。 */
function windowAt(p: Painter, x: number, y: number, w: number, h: number, o: WinOpts): void {
  const r = p.r;
  r.rect(x - 1, y - 1, w + 2, h + 2, o.trim);
  r.rect(x, y, w, h, o.cool ? "#35556e" : "#2d3d52");
  r.rect(x, y + Math.floor(h / 2), w, Math.ceil(h / 2), o.cool ? "#2a4558" : "#25334a");
  r.rect(x, y, w, 1, "#1a2230");
  r.rect(x, y, 1, h, "#1a2230");
  // 玻璃上斜斜一道反光。
  for (let i = 0; i < Math.min(w, h) - 2; i++) r.px(x + 2 + i, y + h - 2 - i, o.cool ? "#9ed0ee" : "#6f8eaa");
  const glowC = o.cool ? "#d8f0ff" : WARM;
  p.glow(x, y, w, h, glowC);
  p.g.rect(x + 1, y + 1, w - 2, Math.max(1, Math.floor(h / 2) - 1), o.cool ? "#ffffff" : "#ffe6a8");
  if (o.lattice) {
    for (let xx = x + 2; xx < x + w - 1; xx += 3) {
      r.rect(xx, y, 1, h, o.trim);
      p.g.rect(xx, y, 1, h, "#00000000");
    }
    for (let yy = y + 2; yy < y + h - 1; yy += 3) {
      r.rect(x, yy, w, 1, o.trim);
      p.g.rect(x, yy, w, 1, "#00000000");
    }
  } else if (!o.cool) {
    r.rect(x + Math.floor(w / 2), y, 1, h, o.trim);
    r.rect(x, y + Math.floor(h / 2), w, 1, o.trim);
    p.g.rect(x + Math.floor(w / 2), y, 1, h, "#00000000");
    p.g.rect(x, y + Math.floor(h / 2), w, 1, "#00000000");
  } else {
    for (let xx = x + 7; xx < x + w; xx += 8) {
      r.rect(xx, y, 1, h, o.trim);
      p.g.rect(xx, y, 1, h, "#00000000");
    }
  }
  // 窗台
  r.rect(x - 2, y + h + 1, w + 4, 2, shade(o.trim, 0.15));
  r.rect(x - 2, y + h + 1, w + 4, 1, shade(o.trim, 0.35));
  r.shade(x - 1, y + h + 3, w + 3, 1, 0.7);
  if (o.shutters) {
    for (const sx of [x - 5, x + w + 1]) {
      r.rect(sx, y - 1, 4, h + 2, o.shutters);
      r.rect(sx, y - 1, 1, h + 2, shade(o.shutters, 0.2));
      for (let yy = y + 1; yy < y + h; yy += 2) r.rect(sx + 1, yy, 3, 1, shade(o.shutters, -0.2));
    }
  }
  if (o.box) {
    const by = y + h + 3;
    r.rect(x - 1, by, w + 2, 3, "#8a5a32");
    r.rect(x - 1, by, w + 2, 1, "#a8733f");
    for (let xx = x; xx < x + w; xx += 2) {
      r.px(xx, by - 1, p.rng.next() < 0.5 ? "#4f9a3a" : "#3f7f30");
      if (p.rng.next() < 0.5) r.px(xx + (p.rng.next() < 0.5 ? 0 : 1), by - 2, ["#f19ab0", "#f6d84a", "#ffffff", "#e8574a"][p.rng.int(0, 3)]!);
    }
  }
  if (o.bars) for (let xx = x + 1; xx < x + w; xx += 2) r.rect(xx, y, 1, h, "#3a3a40");
  p.light(x + w / 2, p.oy + 10, Math.max(16, w + 8), o.cool ? "#cfe6ff" : WARM);
}

type DoorStyle = "plank" | "double" | "curtain" | "glass" | "open";

/** 门：门框、往里凹的门板、门前一块石阶。返回门洞的左上角。 */
function doorAt(p: Painter, cx: number, w: number, h: number, style: DoorStyle, color: string, trim: string, curtain = "#3a4a8a"): [number, number] {
  const r = p.r;
  const x = Math.round(cx - w / 2);
  const y = p.oy - h;
  r.rect(x - 2, y - 2, w + 4, h + 2, trim);
  r.rect(x - 2, y - 2, w + 4, 1, shade(trim, 0.25));
  if (style === "plank" || style === "double") {
    r.rect(x, y, w, h, color);
    for (let xx = x + 2; xx < x + w; xx += 3) r.rect(xx, y, 1, h, shade(color, -0.2));
    if (style === "double") r.rect(x + Math.floor(w / 2), y, 1, h, shade(color, -0.45));
    r.rect(x, y, w, 2, shade(color, -0.4));
    r.px(x + w - 3, y + Math.floor(h / 2), "#f2c14e");
    if (style === "double") r.px(x + 2, y + Math.floor(h / 2), "#f2c14e");
  } else if (style === "glass") {
    r.rect(x, y, w, h, "#9fc8dc");
    r.rect(x, y, w, 2, "#5f88a0");
    r.rect(x + Math.floor(w / 2), y, 1, h, trim);
    for (let i = 0; i < h - 4; i += 1) r.px(x + 2 + Math.floor(i / 2), y + h - 2 - i, "#d8f0fa");
    p.glow(x, y, w, h, "#e8f6ff");
  } else {
    // 门洞：里面是暗的，夜里透出暖光（下面亮、上面暗）。
    r.rect(x, y, w, h, "#2a1a12");
    r.rect(x, y + h - 3, w, 3, "#3a2618");
    p.glow(x + 1, y + 2, w - 2, h - 2, "#6a3418");
    p.g.dither(x + 1, y + Math.floor(h * 0.35), w - 2, Math.ceil(h * 0.65) - 1, "#c8682a", 0.5);
    p.g.rect(x + 1, y + h - 4, w - 2, 3, "#e8904a");
    if (style === "curtain") {
      // 门帘：盖住上面大半，中间开一道缝。
      const ch = Math.round(h * 0.7);
      r.rect(x, y, w, ch, curtain);
      r.rect(x, y, w, 1, shade(curtain, 0.3));
      r.rect(x + Math.floor(w / 2), y + 2, 1, ch - 2, shade(curtain, -0.5));
      for (let xx = x + 1; xx < x + w - 1; xx += 4) r.px(xx, y + Math.floor(ch / 2), shade(curtain, 0.45));
      r.rect(x, y + ch - 1, w, 1, shade(curtain, -0.3));
      p.g.rect(x, y, w, ch, "#00000000");
      p.glow(x + Math.floor(w / 2), y + 2, 1, ch - 2, "#f2a050");
    }
  }
  // 门前石阶
  r.rect(x - 3, p.oy - 1, w + 6, 3, "#a8a090");
  r.rect(x - 3, p.oy - 1, w + 6, 1, "#c6bead");
  r.rect(x - 3, p.oy + 2, w + 6, 1, "#6e675c");
  p.light(cx, p.oy + 8, 22);
  return [x, y];
}

/**
 * 匾额：深色木牌，金字，挂在檐下或屋顶上。
 * 字在屏幕上按 24px 画（一个字像素约是 2/3 个美术像素），牌子按这个宽度留出边。
 */
function plaque(p: Painter, cx: number, y: number, text: string, bg = "#3a2414", fg = "#f6cf5a"): void {
  const t = textSprite(text, fg);
  const w = Math.max(20, Math.ceil((t.width - 4) * 0.7) + 10);
  const x = Math.round(cx - w / 2);
  p.r.rect(x - 1, y - 1, w + 2, 16, INK);
  p.r.rect(x, y, w, 14, bg);
  p.r.rect(x, y, w, 1, shade(bg, 0.3));
  p.r.rect(x, y + 13, w, 1, shade(bg, -0.3));
  p.texts.push({ text, x: cx, y: y + 7, w: w - 4, color: fg });
}

/** 檐下挂的红灯笼。 */
function hangLantern(p: Painter, x: number, y: number, color = "#d23a2a"): void {
  const r = p.r;
  r.rect(x, y, 1, 3, INK);
  r.rect(x - 2, y + 3, 5, 6, color);
  r.rect(x - 3, y + 4, 7, 4, color);
  r.rect(x - 2, y + 4, 2, 3, shade(color, 0.35));
  r.rect(x - 2, y + 3, 5, 1, "#f2c14e");
  r.rect(x - 2, y + 9, 5, 1, "#f2c14e");
  r.rect(x, y + 10, 1, 2, "#f2c14e");
  p.glow(x - 2, y + 4, 5, 4, "#ffb070");
  p.light(x, y + 6, 26, "#ff9a5a", "lamp");
}

/** 屋顶上的砖烟囱。 */
function chimney(p: Painter, x: number, yBase: number, h = 14, color = "#8a4a3a"): void {
  const r = p.r;
  r.rect(x, yBase - h, 8, h, color);
  r.rect(x, yBase - h, 2, h, shade(color, 0.18));
  r.rect(x + 6, yBase - h, 2, h, shade(color, -0.25));
  for (let yy = yBase - h + 3; yy < yBase; yy += 4) r.rect(x, yy, 8, 1, shade(color, -0.2));
  r.rect(x - 1, yBase - h - 2, 10, 3, shade(color, -0.1));
  r.rect(x - 1, yBase - h - 2, 10, 1, shade(color, 0.25));
  r.rect(x + 1, yBase - h - 2, 6, 1, "#2a1a12");
  r.shade(x - 2, yBase - 1, 12, 2, 0.75);
  p.chimney = [x + 4 - p.ox, yBase - h - 2 - p.oy];
}

/* ---------------- 屋顶 ---------------- */

interface RoofColors {
  light: string;
  mid: string;
  dark: string;
}

const roofSet = (base: string): RoofColors => ({ light: shade(base, 0.2), mid: base, dark: shade(base, -0.3) });

/**
 * 四坡（庑殿）屋顶：正面一大坡，两头两个三角坡，左亮右暗，后坡只露一条。
 * curl 是檐角往上翘的像素，tile 是瓦的样子。
 */
function hipRoof(p: Painter, x0: number, x1: number, yTop: number, yEave: number, c: RoofColors, opts: { curl?: number; tile?: "tube" | "shingle" | "thatch"; back?: number } = {}): void {
  const r = p.r;
  const curl = opts.curl ?? 0;
  const tile = opts.tile ?? "tube";
  const back = opts.back ?? 4;
  const yR = yTop + back;
  const span = yEave - yR;
  const inset = Math.round(span * 0.48);
  const xr0 = x0 + inset;
  const xr1 = x1 - inset;
  const half = (x1 - x0) / 2;
  const xc = (x0 + x1) / 2;
  const eaveAt = (x: number): number => {
    const t = Math.abs(x + 0.5 - xc) / half;
    return yEave - Math.round(curl * Math.max(0, (t - 0.72) / 0.28) ** 2);
  };
  const back0 = shade(c.dark, -0.15);
  for (let x = x0; x < x1; x++) {
    const yb = eaveAt(x);
    // 后坡露出来的一条；两头往里收一点，屋顶不是方盒子。
    const edge = Math.min(x - x0, x1 - 1 - x);
    const yt = yTop + Math.max(0, Math.round((inset * 0.35 - edge) * 0.5));
    for (let y = yt; y <= yb; y++) {
      let color: string;
      if (y < yR) color = back0;
      else {
        const k = (yb - y) / Math.max(1, yb - yR);
        const xl = x0 + inset * k;
        const xr = x1 - 1 - inset * k;
        if (x < xl) {
          color = c.light;
          if (tile !== "thatch" && (y - x) % 4 === 0) color = shade(c.light, -0.12);
        } else if (x > xr) {
          color = c.dark;
          if (tile !== "thatch" && (y + x) % 4 === 0) color = shade(c.dark, -0.15);
        } else {
          color = c.mid;
          const tx = x - x0;
          if (tile === "tube") {
            if (tx % 4 === 0) color = shade(c.mid, -0.22);
            else if (tx % 4 === 1) color = shade(c.mid, 0.16);
          } else if (tile === "shingle") {
            if ((y - yR) % 4 === 3) color = shade(c.mid, -0.25);
            else if ((tx + Math.floor((y - yR) / 4) * 3) % 6 === 0) color = shade(c.mid, -0.15);
          } else if ((tx * 7 + y * 3) % 5 === 0) color = shade(c.mid, -0.18);
          else if ((tx * 3 + y) % 7 === 0) color = shade(c.mid, 0.15);
          // 越靠近屋脊越亮一点。
          if (k > 0.7) color = shade(color, 0.06);
        }
        // 戗脊：面和面之间一道亮线。
        if (Math.abs(x - xl) < 0.8 || Math.abs(x - xr) < 0.8) color = shade(c.mid, 0.3);
      }
      r.px(x, y, color);
    }
    // 檐口：一排瓦当，下面一道深色。
    if (tile === "tube") r.px(x, yb, (x - x0) % 4 === 1 ? shade(c.light, 0.25) : c.dark);
    else r.px(x, yb, c.dark);
    r.px(x, yb + 1, shade(c.dark, -0.35));
  }
  // 正脊：一根圆滚滚的脊，两头起翘。
  r.rect(xr0 - 2, yR - 2, xr1 - xr0 + 4, 4, c.dark);
  r.rect(xr0 - 2, yR - 2, xr1 - xr0 + 4, 1, shade(c.mid, 0.35));
  r.rect(xr0 - 2, yR + 1, xr1 - xr0 + 4, 1, shade(c.dark, -0.35));
  if (curl > 0) {
    for (const [x, d] of [
      [xr0 - 3, -1],
      [xr1 + 2, 1],
    ] as const) {
      r.rect(x, yR - 4, 2, 4, c.dark);
      r.rect(x + d * 2, yR - 6, 2, 3, c.dark);
      r.px(x + d * 2 + (d > 0 ? 1 : 0), yR - 6, shade(c.mid, 0.35));
    }
  }
}

/**
 * 山墙朝前的两坡屋顶（谷仓那种）：屋脊朝后，左坡亮、右坡暗，前面是三角山墙。
 * 返回山墙三角（之后画墙的时候填）。
 */
function gableRoof(p: Painter, x0: number, x1: number, yFront: number, gable: number, c: RoofColors, opts: { glass?: boolean; trim?: string; over?: number } = {}): void {
  const r = p.r;
  const over = opts.over ?? 4;
  const xc = Math.round((x0 + x1) / 2);
  const depth = yFront - gable - p.top;
  const apex = yFront - gable;
  const left: Array<[number, number]> = [
    [x0 - over, yFront + 2],
    [xc, apex - 1],
    [xc, apex - 1 - depth],
    [x0 - over, yFront + 2 - depth],
  ];
  const right: Array<[number, number]> = [
    [xc, apex - 1],
    [x1 + over, yFront + 2],
    [x1 + over, yFront + 2 - depth],
    [xc, apex - 1 - depth],
  ];
  r.poly(left, c.light);
  r.poly(right, c.dark);
  // 瓦行：和前沿平行的一道道线。
  const slopeL = (apex - 1 - (yFront + 2)) / (xc - (x0 - over));
  for (let k = 4; k < depth; k += opts.glass ? 8 : 4) {
    for (let x = x0 - over; x < xc; x++) r.px(x, Math.round(yFront + 2 - k + (x - (x0 - over)) * slopeL), shade(c.light, opts.glass ? 0.25 : -0.14));
    for (let x = xc; x < x1 + over; x++) r.px(x, Math.round(apex - 1 - k + (x - xc) * -slopeL), shade(c.dark, opts.glass ? 0.25 : -0.18));
  }
  if (opts.glass) {
    // 玻璃顶：竖的窗框和斜的反光。
    for (let k = 0; k < xc - x0 + over; k += 10) {
      r.line(x0 - over + k, Math.round(yFront + 2 + k * slopeL), x0 - over + k, Math.round(yFront + 2 + k * slopeL) - depth, shade(c.light, 0.35));
      r.line(x1 + over - k, Math.round(yFront + 2 + k * slopeL), x1 + over - k, Math.round(yFront + 2 + k * slopeL) - depth, shade(c.dark, 0.3));
    }
  }
  // 屋脊和后沿。
  r.rect(xc - 1, apex - 2 - depth, 2, depth + 2, shade(c.mid, 0.3));
  r.line(x0 - over, yFront + 2 - depth, xc, apex - 1 - depth, shade(c.light, 0.2));
  r.line(xc, apex - 1 - depth, x1 + over, yFront + 2 - depth, shade(c.dark, 0.15));
  // 前沿的封檐板。
  const trim = opts.trim ?? shade(c.dark, -0.3);
  r.line(x0 - over, yFront + 2, xc, apex - 1, trim);
  r.line(x0 - over, yFront + 3, xc, apex, trim);
  r.line(xc, apex - 1, x1 + over, yFront + 2, trim);
  r.line(xc, apex, x1 + over, yFront + 3, trim);
}

/** 山墙三角：用墙的材质填。 */
function gableWall(p: Painter, x0: number, x1: number, yFront: number, gable: number, mat: Material, base: string): void {
  const xc = Math.round((x0 + x1) / 2);
  const tmp = new Raster(p.r.w, p.r.h);
  tmp.poly(
    [
      [x0, yFront + 1],
      [xc, yFront - gable + 2],
      [x1, yFront + 1],
    ],
    "#ffffff",
  );
  const saved = p.r.data.slice();
  wallFill(p, x0, yFront - gable, x1 - x0, gable + 1, mat, base);
  for (let i = 0; i < tmp.data.length; i++) if (!tmp.data[i]) p.r.data[i] = saved[i]!;
}

/* ---------------- 各种房子 ---------------- */

function drawHome(p: Painter): void {
  const { ox, W } = p;
  const wt = p.wallTop;
  hipRoof(p, ox - 7, ox + W + 7, p.top, wt + 2, roofSet("#b8452f"), { curl: 4 });
  chimney(p, ox + W - 30, p.top + 18, 12);
  wallFill(p, ox, wt, W, p.wall, "plaster", "#efe0c0");
  post(p, ox, wt, p.wall, "#7a4a2a");
  post(p, ox + W - 3, wt, p.wall, "#7a4a2a");
  p.r.rect(ox, wt, W, 3, "#7a4a2a");
  eaveShadow(p, ox, W, wt + 3);
  foundation(p, ox, W);
  doorAt(p, ox + W / 2, 12, 20, "plank", "#8a5428", "#6a3a1e");
  for (const x of [ox + 10, ox + 28, ox + W - 38, ox + W - 20]) windowAt(p, x, wt + 9, 10, 9, { trim: "#6a3a1e", shutters: "#4f7a3a", box: true });
  plaque(p, ox + W / 2, wt - 14, p.b.sign ?? "家");
}

function drawHouse(p: Painter): void {
  const { ox, W } = p;
  const wt = p.wallTop;
  const v = hashSeed(p.b.id) % 4;
  const roof = ["#4a6a8a", "#3f7a52", "#8a5a3a", "#a8452f"][v]!;
  const [mat, wall] = (
    [
      ["plaster", "#ece2cc"],
      ["clap", "#c9d4c8"],
      ["brick", "#b8705a"],
      ["plaster", "#f0d6c0"],
    ] as Array<[Material, string]>
  )[(v + 1) % 4]!;
  hipRoof(p, ox - 6, ox + W + 6, p.top, wt + 2, roofSet(roof), { curl: v % 2 ? 3 : 0, tile: v % 2 ? "tube" : "shingle" });
  if (v !== 1) chimney(p, ox + 14 + v * 8, p.top + 16, 11, v === 2 ? "#7a6a5a" : "#8a4a3a");
  wallFill(p, ox, wt, W, p.wall, mat, wall);
  if (mat === "plaster") {
    post(p, ox, wt, p.wall, "#6a4a32");
    post(p, ox + W - 3, wt, p.wall, "#6a4a32");
  }
  eaveShadow(p, ox, W);
  foundation(p, ox, W);
  const dx = ox + W / 2 + (v % 2 ? 10 : -10);
  doorAt(p, dx, 11, 19, "plank", ["#5a6a8a", "#7a4a2a", "#4a6a3a", "#8a3a2a"][v]!, "#4a3020");
  const trim = mat === "brick" ? "#e8dcc4" : "#5a3a22";
  windowAt(p, dx > ox + W / 2 ? ox + 9 : ox + W - 21, wt + 8, 12, 10, { trim, box: v % 2 === 0, shutters: v === 3 ? "#8a5a9a" : undefined });
  if (W > 96) windowAt(p, dx > ox + W / 2 ? ox + 29 : ox + W - 41, wt + 8, 10, 10, { trim });
}

function drawBarn(p: Painter): void {
  const { ox, oy, W } = p;
  const wt = p.wallTop;
  const gable = 26;
  gableRoof(p, ox, ox + W, wt, gable, { light: "#8a7462", mid: "#6e5a48", dark: "#4a3a2e" }, { trim: "#f0e2c4", over: 5 });
  wallFill(p, ox, wt, W, p.wall, "plank", "#b0402e");
  gableWall(p, ox, ox + W, wt, gable, "plank", "#b0402e");
  // 白边框
  p.r.rect(ox, wt, 2, p.wall, "#f0e2c4");
  p.r.rect(ox + W - 2, wt, 2, p.wall, "#f0e2c4");
  p.r.rect(ox, wt, W, 2, "#f0e2c4");
  // 阁楼的草料门
  const xc = ox + W / 2;
  p.r.rect(xc - 8, wt - 16, 16, 13, "#f0e2c4");
  p.r.rect(xc - 6, wt - 14, 12, 11, "#3a2214");
  p.r.rect(xc - 6, wt - 7, 12, 4, "#d8b048");
  p.r.rect(xc - 6, wt - 8, 12, 1, "#f2d878");
  foundation(p, ox, W);
  // 大门：白框打叉。
  const dw = 34;
  const dx = Math.round(xc - dw / 2);
  const dy = oy - 28;
  p.r.rect(dx - 2, dy - 2, dw + 4, 30, "#f0e2c4");
  p.r.rect(dx, dy, dw, 28, "#8a3324");
  p.r.rect(dx, dy, dw, 2, "#5a2014");
  for (const lx of [dx, dx + dw / 2]) {
    for (let i = 0; i < 16; i++) {
      p.r.px(lx + Math.round((i * (dw / 2 - 1)) / 15), dy + 2 + Math.round((i * 25) / 15), "#f0e2c4");
      p.r.px(lx + dw / 2 - 1 - Math.round((i * (dw / 2 - 1)) / 15), dy + 2 + Math.round((i * 25) / 15), "#f0e2c4");
    }
    p.r.rect(lx, dy, 1, 28, "#f0e2c4");
  }
  p.r.rect(dx + dw - 1, dy, 1, 28, "#f0e2c4");
  p.r.rect(dx - 4, oy - 1, dw + 8, 3, "#a8a090");
  p.light(xc, oy + 10, 26);
  windowAt(p, ox + 11, wt + 9, 12, 10, { trim: "#f0e2c4" });
  windowAt(p, ox + W - 23, wt + 9, 12, 10, { trim: "#f0e2c4" });
  plaque(p, xc, wt - 36, p.b.sign ?? "马厩");
}

function drawSilo(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const x0 = ox + 4;
  const w = W - 8;
  const yTop = p.top + 14;
  // 圆筒：按列算明暗，左边受光。
  for (let x = x0; x < x0 + w; x++) {
    const t = (x - x0 + 0.5) / w;
    const lit = Math.cos((t - 0.3) * Math.PI);
    const band = Math.round(lit * 4) / 4;
    const base = mix("#6e7a80", "#d8e0e2", Math.max(0, band));
    for (let y = yTop; y < oy - 3; y++) r.px(x, y, (y - yTop) % 9 === 0 ? shade(base, -0.2) : (y - yTop) % 9 === 1 ? shade(base, 0.12) : base);
  }
  // 圆顶
  for (let x = x0 - 1; x < x0 + w + 1; x++) {
    const t = (x - x0 + 0.5) / w;
    const hh = Math.round(Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * 12);
    const lit = Math.cos((t - 0.3) * Math.PI);
    const c = mix("#6e2a1c", "#d0603e", Math.max(0, Math.round(lit * 3) / 3));
    for (let y = yTop - hh; y < yTop + 2; y++) r.px(x, y, c);
  }
  r.rect(x0 - 1, yTop + 1, w + 2, 2, "#5a2014");
  r.rect(ox + W / 2 - 2, yTop - 15, 4, 3, "#d0603e");
  // 梯子
  for (const lx of [x0 + w - 9, x0 + w - 5]) r.rect(lx, yTop + 4, 1, oy - yTop - 8, "#4a4a50");
  for (let y = yTop + 6; y < oy - 5; y += 4) r.rect(x0 + w - 9, y, 5, 1, "#4a4a50");
  r.rect(x0 - 1, oy - 4, w + 2, 4, "#9a9282");
  r.rect(x0 - 1, oy - 4, w + 2, 1, "#c6bead");
}

function drawCoop(p: Painter): void {
  const { ox, oy, W } = p;
  const wt = p.wallTop;
  const gable = 16;
  gableRoof(p, ox, ox + W, wt, gable, { light: "#e8c45a", mid: "#d0a840", dark: "#a8822a" }, { over: 4 });
  // 茅草的散茬
  for (let i = 0; i < 40; i++) p.r.px(ox + p.rng.int(0, W), p.top + p.rng.int(2, wt - p.top - 4), "#f2d878");
  wallFill(p, ox, wt, W, p.wall, "clap", "#b07440");
  gableWall(p, ox, ox + W, wt, gable, "clap", "#b07440");
  eaveShadow(p, ox, W, wt, 3);
  foundation(p, ox, W, 3);
  const xc = ox + W / 2;
  // 小门和斜坡
  p.r.rect(xc - 7, oy - 14, 12, 12, "#4a2a14");
  p.r.rect(xc - 6, oy - 13, 10, 10, "#2a1a10");
  p.glow(xc - 5, oy - 12, 8, 8, "#f2a050");
  for (let i = 0; i < 6; i++) p.r.rect(xc - 6 + i, oy - 2 + Math.floor(i / 3), 3, 1, "#a8733f");
  p.r.rect(ox + 8, oy - 13, 8, 6, "#6a4022");
  p.r.rect(ox + 9, oy - 12, 6, 4, "#2d3d52");
  p.glow(ox + 9, oy - 12, 6, 4);
  p.r.ellipse(xc, wt - 7, 3, 3, "#2a1a10");
}

function drawMill(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const xc = ox + W / 2;
  const top = p.top + 22;
  // 塔身：下宽上窄，按列明暗。
  for (let y = top; y < oy - 2; y++) {
    const t = (y - top) / (oy - 2 - top);
    const half = Math.round(13 + t * 11);
    for (let x = xc - half; x < xc + half; x++) {
      const u = (x - (xc - half)) / (2 * half);
      const band = Math.round(Math.cos((u - 0.3) * Math.PI) * 3) / 3;
      let c = mix("#8a7a66", "#ece0c8", Math.max(0, band));
      if ((y - top) % 7 === 0) c = shade(c, -0.12);
      r.px(x, y, c);
    }
  }
  // 帽子
  for (let y = 0; y < 14; y++) {
    const half = Math.round(16 - y * 0.9);
    for (let x = xc - half; x < xc + half; x++) {
      const u = (x - (xc - half)) / (2 * half);
      r.px(x, top - y, u < 0.45 ? "#b8452f" : "#7e2b1d");
    }
  }
  r.rect(xc - 17, top - 1, 34, 2, "#5a1e12");
  // 门和窗
  p.r.rect(xc - 6, oy - 18, 12, 16, "#5a3a22");
  p.r.rect(xc - 5, oy - 17, 10, 15, "#7a4a26");
  p.r.px(xc + 3, oy - 10, "#f2c14e");
  windowAt(p, xc - 4, top + 12, 8, 8, { trim: "#5a3a22" });
  r.rect(ox + 6, oy - 3, W - 12, 3, "#9a9282");
  p.hub = [xc - p.ox, top + 4 - p.oy];
  r.ellipse(xc, top + 4, 3, 3, "#3a2414");
}

function drawStand(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const rows = 5;
  const rowH = 11;
  const shirts = ["#d8443a", "#3f7fd0", "#f2b632", "#4fa64a", "#f4ead2", "#8a4ab0", "#e87a3a", "#2a8a8a"];
  const skins = ["#f0c8a4", "#d8a77e", "#e8b48a", "#c08a5e"];
  const hair = ["#2a1a12", "#3a2414", "#5a3a22", "#1e1a18", "#8a6a3a"];
  // 看台：一排排台阶，越往后越高。
  for (let row = rows - 1; row >= 0; row--) {
    const y = oy - 6 - row * rowH;
    const inset = row * 2;
    r.rect(ox + inset, y - 5, W - inset * 2, 5, "#c08a4a");
    r.rect(ox + inset, y - 5, W - inset * 2, 1, "#dca866");
    r.rect(ox + inset, y, W - inset * 2, 6, "#7a4a24");
    r.rect(ox + inset, y, W - inset * 2, 1, "#5a3218");
    for (let x = ox + inset + 2; x < ox + W - inset - 3; x += 4) {
      if (p.rng.next() < 0.18) continue;
      const shirt = shirts[p.rng.int(0, shirts.length - 1)]!;
      r.rect(x, y - 6, 3, 4, shirt);
      r.px(x, y - 6, shade(shirt, 0.25));
      r.rect(x, y - 9, 3, 3, skins[p.rng.int(0, 3)]!);
      r.rect(x, y - 10, 3, 1, hair[p.rng.int(0, 4)]!);
      if (p.rng.next() < 0.15) r.px(x + (p.rng.next() < 0.5 ? -1 : 3), y - 11, skins[0]!);
    }
  }
  // 顶棚：红白条纹的篷布，前沿一排波浪边，两根柱子一组。
  const cy = oy - 6 - rows * rowH - 6;
  const ch = 16;
  for (let x = ox - 4; x < ox + W + 4; x++) {
    const stripe = Math.floor((x - ox) / 8) % 2 ? "#f4ead2" : "#c9302a";
    for (let y = cy - ch; y < cy; y++) r.px(x, y, (y - (cy - ch)) < 3 ? shade(stripe, -0.25) : stripe);
    const sc = Math.floor((x - ox + 4) / 8);
    const lip = 2 + Math.round(Math.sin(((x - ox + 4) % 8) / 8 * Math.PI) * 2);
    for (let y = cy; y < cy + lip; y++) r.px(x, y, sc % 2 ? "#d8cdb4" : "#9e2418");
  }
  r.shade(ox, cy + 4, W, 4, 0.7, 0.5);
  for (let x = ox + 6; x < ox + W; x += 48) post(p, x, cy + 2, oy - cy - 8, "#5a3a22", 3);
  // 前面的栏杆和横幅
  r.rect(ox - 2, oy - 5, W + 4, 5, "#f4f1e6");
  r.rect(ox - 2, oy - 5, W + 4, 1, "#ffffff");
  r.rect(ox - 2, oy - 1, W + 4, 1, "#9a9584");
  for (let x = ox; x < ox + W; x += 12) r.rect(x, oy - 5, 1, 5, "#c33b2e");
  plaque(p, ox + W / 2, cy - ch - 2, "马蹄镇赛马", "#c9302a", "#f6cf5a");
  for (let i = 0; i < 6; i++) p.light(ox + 30 + i * ((W - 60) / 5), oy + 6, 30, "#fff0c8", "lamp");
}

function drawBookie(p: Painter): void {
  const { ox, W } = p;
  const wt = p.wallTop;
  hipRoof(p, ox - 6, ox + W + 6, p.top, wt + 2, roofSet("#3c4a5e"), { curl: 5 });
  wallFill(p, ox, wt, W, p.wall, "plaster", "#b8392c");
  post(p, ox, wt, p.wall, "#6a1e14");
  post(p, ox + W - 3, wt, p.wall, "#6a1e14");
  p.r.rect(ox, wt, W, 3, "#f2c14e");
  eaveShadow(p, ox, W, wt + 3);
  foundation(p, ox, W);
  doorAt(p, ox + W / 2 + 8, 14, 21, "curtain", "#5a2a18", "#f2c14e", "#2a2a4a");
  // 赔率黑板
  const bx = ox + 9;
  const by = wt + 8;
  p.r.rect(bx - 1, by - 1, 26, 17, "#6a3a1e");
  p.r.rect(bx, by, 24, 15, "#24382c");
  for (let i = 0; i < 4; i++) {
    p.r.rect(bx + 2, by + 2 + i * 3, 6 + ((i * 5) % 7), 1, "#e8e8d8");
    p.r.rect(bx + 14, by + 2 + i * 3, 3 + ((i * 3) % 5), 1, "#f6d05a");
  }
  hangLantern(p, ox + 4, wt + 2);
  hangLantern(p, ox + W - 4, wt + 2);
  plaque(p, ox + W / 2, wt - 14, p.b.sign ?? "赌马");
}

function drawBooth(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const wt = p.wallTop;
  // 小亭子：柜台、窗口，上面一顶条纹篷。
  wallFill(p, ox, wt, W, p.wall, "plank", "#e7d3a8");
  r.rect(ox + 8, wt + 2, W - 16, 8, "#3a2614");
  r.rect(ox + 8, wt + 2, W - 16, 2, "#24160c");
  p.glow(ox + 9, wt + 4, W - 18, 6, "#ffc970");
  r.rect(ox + 6, wt + 10, W - 12, 3, "#8a5a32");
  r.rect(ox + 6, wt + 10, W - 12, 1, "#c08a4a");
  r.rect(ox + 10, wt + 3, 6, 4, "#f4ead2");
  r.rect(ox + W - 18, wt + 4, 7, 3, "#f4ead2");
  foundation(p, ox, W, 3);
  const top = p.top + 4;
  for (let x = ox - 5; x < ox + W + 5; x++) {
    const s = Math.floor((x - ox + 5) / 7) % 2 ? "#f4ead2" : "#2f7a52";
    for (let y = top; y < wt; y++) r.px(x, y, y - top < 2 ? shade(s, 0.15) : s);
    const lip = 2 + Math.round(Math.sin((((x - ox + 5) % 7) / 7) * Math.PI) * 2);
    for (let y = wt; y < wt + lip; y++) r.px(x, y, shade(s, -0.2));
  }
  r.shade(ox, wt + 3, W, 3, 0.75, 0.5);
  plaque(p, ox + W / 2, top + 4, p.b.sign ?? "报名", "#c9302a");
  p.light(ox + W / 2, oy + 8, 24);
}

function drawMarket(p: Painter): void {
  const { ox, W } = p;
  const wt = p.wallTop;
  hipRoof(p, ox - 7, ox + W + 7, p.top, wt + 2, roofSet("#8a4a2c"), { curl: 3 });
  chimney(p, ox + 22, p.top + 18, 12, "#7a6a5a");
  wallFill(p, ox, wt, W, p.wall, "clap", "#d8bf8a");
  post(p, ox, wt, p.wall, "#6a4022");
  post(p, ox + W - 3, wt, p.wall, "#6a4022");
  eaveShadow(p, ox, W);
  foundation(p, ox, W);
  // 大敞门，里面能看见草料。
  const [dx, dy] = doorAt(p, ox + W / 2, 24, 24, "open", "#6a4022", "#6a4022");
  p.r.rect(dx + 2, dy + 14, 9, 7, "#d8b048");
  p.r.rect(dx + 2, dy + 14, 9, 1, "#f2d878");
  p.r.rect(dx + 14, dy + 16, 8, 5, "#c8a040");
  windowAt(p, ox + 12, wt + 9, 12, 10, { trim: "#6a4022" });
  windowAt(p, ox + W - 24, wt + 9, 12, 10, { trim: "#6a4022" });
  // 马头招牌
  const hx = ox + W - 40;
  p.r.rect(hx, wt + 6, 12, 10, "#f4ead2");
  p.r.rect(hx + 3, wt + 7, 5, 8, "#9a5a2c");
  p.r.rect(hx + 6, wt + 7, 4, 3, "#9a5a2c");
  p.r.rect(hx + 3, wt + 6, 2, 8, "#3a2414");
  plaque(p, ox + W / 2, wt - 14, p.b.sign ?? "马市");
}

function drawTeahouse(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const wt = p.wallTop;
  const floor = oy - 26;
  hipRoof(p, ox - 9, ox + W + 9, p.top, wt + 2, roofSet("#4b5560"), { curl: 7 });
  chimney(p, ox + W - 34, p.top + 18, 10, "#7a6a5a");
  // 二楼：粉墙，红柱，格子窗，栏杆。
  wallFill(p, ox, wt, W, floor - wt, "plaster", "#f2e6cc");
  for (const x of [ox, ox + 36, ox + W - 39, ox + W - 3]) post(p, x, wt, oy - wt, "#8e2519");
  for (const x of [ox + 8, ox + 46, ox + W - 70, ox + W - 30]) windowAt(p, x, wt + 7, 20, 10, { trim: "#8e2519", lattice: true });
  eaveShadow(p, ox, W);
  // 腰檐：一圈小瓦檐把两层分开。
  for (let x = ox - 4; x < ox + W + 4; x++) {
    for (let y = floor - 4; y < floor + 1; y++) r.px(x, y, (x - ox) % 4 === 0 ? "#3a424c" : y === floor - 4 ? "#6a747e" : "#4b5560");
    r.px(x, floor + 1, (x - ox) % 4 === 1 ? "#7a848e" : "#2a3038");
  }
  // 栏杆
  r.rect(ox + 2, floor - 9, W - 4, 1, "#8e2519");
  for (let x = ox + 3; x < ox + W - 3; x += 4) r.rect(x, floor - 8, 1, 4, "#8e2519");
  // 一楼：木格门，中间门帘。
  wallFill(p, ox, floor + 2, W, oy - floor - 2, "plank", "#a8683a");
  for (const x of [ox, ox + 36, ox + W - 39, ox + W - 3]) post(p, x, floor + 2, oy - floor - 2, "#8e2519");
  r.shade(ox, floor + 2, W, 3, 0.7);
  for (const x of [ox + 8, ox + W - 31]) windowAt(p, x, floor + 7, 20, 11, { trim: "#6a2a14", lattice: true });
  doorAt(p, ox + W / 2, 18, 20, "curtain", "#5a2a18", "#8e2519", "#2f4a7a");
  foundation(p, ox, W, 4);
  for (const x of [ox + 18, ox + 56, ox + W - 56, ox + W - 18]) hangLantern(p, x, wt + 2);
  plaque(p, ox + W / 2, wt - 16, p.b.sign ?? "茶馆", "#2a1a12");
}

function drawStore(p: Painter): void {
  const { ox, W } = p;
  const r = p.r;
  const wt = p.wallTop;
  hipRoof(p, ox - 6, ox + W + 6, p.top, wt + 2, roofSet("#3f6a4a"), { curl: 2, tile: "shingle" });
  wallFill(p, ox, wt, W, p.wall, "clap", "#a8bfa4");
  post(p, ox, wt, p.wall, "#f4ead2");
  post(p, ox + W - 3, wt, p.wall, "#f4ead2");
  eaveShadow(p, ox, W);
  foundation(p, ox, W);
  doorAt(p, ox + W - 24, 12, 20, "plank", "#6a4022", "#f4ead2");
  // 橱窗和条纹遮阳篷（篷顶从上面看得见）。
  const wx = ox + 10;
  windowAt(p, wx, wt + 12, 40, 12, { trim: "#f4ead2" });
  for (let i = 0; i < 9; i++) r.rect(wx + 2 + i * 4, wt + 19, 3, 4, ["#e0453a", "#f6d84a", "#9ad14e"][i % 3]!);
  for (let x = wx - 4; x < wx + 44; x++) {
    const s = Math.floor((x - wx + 4) / 6) % 2 ? "#f4ead2" : "#c9302a";
    for (let y = wt + 4; y < wt + 9; y++) r.px(x, y, y === wt + 4 ? shade(s, 0.2) : s);
    const lip = 1 + Math.round(Math.sin((((x - wx + 4) % 6) / 6) * Math.PI) * 2);
    for (let y = wt + 9; y < wt + 9 + lip; y++) r.px(x, y, shade(s, -0.25));
  }
  r.shade(wx - 2, wt + 11, 44, 2, 0.7);
  plaque(p, ox + W / 2, wt - 14, p.b.sign ?? "杂货");
}

function drawSmithy(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const wt = p.wallTop;
  const gable = 20;
  gableRoof(p, ox, ox + W, wt, gable, { light: "#6a707c", mid: "#4a4f5a", dark: "#2e323a" }, { over: 5 });
  chimney(p, ox + W - 26, p.top + 14, 18, "#6a6460");
  wallFill(p, ox, wt, W, p.wall, "stone", "#8a8478");
  gableWall(p, ox, ox + W, wt, gable, "plank", "#6a4a32");
  eaveShadow(p, ox, W, wt, 4);
  // 打铁的炉子：敞开的一间，炉火通红。
  const fx = ox + 10;
  const fy = wt + 6;
  r.rect(fx - 2, fy - 2, 40, oy - fy + 2, "#4a3a2a");
  r.rect(fx, fy, 36, oy - fy, "#1e1410");
  r.rect(fx + 4, oy - 12, 16, 10, "#5a5048");
  r.rect(fx + 6, oy - 14, 12, 3, "#ff8a2a");
  r.rect(fx + 8, oy - 15, 8, 1, "#ffd27a");
  r.rect(fx + 24, oy - 9, 8, 3, "#3a3a40");
  r.rect(fx + 26, oy - 6, 4, 4, "#2a2a30");
  p.glow(fx + 6, oy - 15, 12, 4, "#ffb04a");
  p.glow(fx + 1, fy + 1, 34, 6, "#7a2a10");
  p.light(fx + 12, oy - 6, 40, "#ff8a3a", "flicker");
  doorAt(p, ox + W - 24, 12, 20, "plank", "#5a3a22", "#3a2a1a");
  // 马蹄铁招牌
  const sx = ox + W - 46;
  r.rect(sx, wt + 8, 2, 10, "#c0c0c8");
  r.rect(sx + 7, wt + 8, 2, 10, "#c0c0c8");
  r.rect(sx + 1, wt + 7, 7, 2, "#c0c0c8");
  r.px(sx, wt + 8, "#ffffff");
  plaque(p, ox + W / 2, wt - 18, p.b.sign ?? "铁匠", "#2a1a12");
}

function drawShrine(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const wt = p.wallTop;
  hipRoof(p, ox - 7, ox + W + 7, p.top, wt + 2, roofSet("#2f7a5a"), { curl: 6 });
  r.rect(ox + W / 2 - 2, p.top - 4, 4, 4, "#f2c14e");
  wallFill(p, ox, wt, W, p.wall, "plaster", "#c9302a");
  post(p, ox, wt, p.wall, "#7a1a12");
  post(p, ox + W - 3, wt, p.wall, "#7a1a12");
  eaveShadow(p, ox, W);
  foundation(p, ox, W, 4, "#b0a898");
  // 神龛：供桌和两支蜡烛。
  const xc = ox + W / 2;
  r.rect(xc - 12, wt + 4, 24, oy - wt - 8, "#2a1410");
  r.rect(xc - 10, oy - 11, 20, 3, "#8a5a32");
  r.rect(xc - 2, wt + 7, 4, 7, "#f2c14e");
  r.rect(xc - 1, wt + 6, 2, 1, "#ffe08a");
  for (const cx of [xc - 7, xc + 6]) {
    r.rect(cx, oy - 15, 1, 4, "#f4ead2");
    r.px(cx, oy - 16, "#ffd27a");
    p.glow(cx - 1, oy - 17, 3, 3, "#ffc060");
  }
  p.glow(xc - 11, wt + 5, 22, oy - wt - 13, "#5a2a14");
  p.light(xc, oy - 10, 28, "#ffb060", "flicker");
}

function drawZhao(p: Painter): void {
  const { ox, W } = p;
  const r = p.r;
  const wt = p.wallTop;
  hipRoof(p, ox - 7, ox + W + 7, p.top, wt + 2, roofSet("#5a6068"), { curl: 4 });
  chimney(p, ox + W - 28, p.top + 18, 12, "#7a6a5a");
  wallFill(p, ox, wt, W, p.wall, "earth", "#c8a878");
  post(p, ox, wt, p.wall, "#5a3a22");
  post(p, ox + W - 3, wt, p.wall, "#5a3a22");
  eaveShadow(p, ox, W);
  foundation(p, ox, W);
  const xc = ox + W / 2;
  doorAt(p, xc, 16, 21, "double", "#4a2a18", "#3a2414");
  // 春联和福字
  for (const cx of [xc - 13, xc + 11]) r.rect(cx, p.oy - 22, 3, 16, "#d23a2a");
  r.rect(xc - 3, p.oy - 30, 7, 7, "#d23a2a");
  r.rect(xc - 1, p.oy - 28, 3, 3, "#f2c14e");
  windowAt(p, ox + 10, wt + 9, 14, 10, { trim: "#5a3a22", lattice: true });
  windowAt(p, ox + W - 24, wt + 9, 14, 10, { trim: "#5a3a22", lattice: true });
  hangLantern(p, xc - 18, wt + 2);
  hangLantern(p, xc + 18, wt + 2);
  plaque(p, xc, wt - 14, p.b.sign ?? "赵");
}

function drawLab(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const wt = p.wallTop;
  // 平顶：从上面看是一块浅灰水泥，四周一圈女儿墙，顶上有空调机、天窗和天线。
  const rt = p.top;
  r.rect(ox - 2, rt, W + 4, wt - rt, "#c9ccc6");
  for (let i = 0; i < (W * (wt - rt)) / 30; i++) r.px(ox + p.rng.int(0, W), rt + p.rng.int(2, wt - rt - 2), p.rng.next() < 0.5 ? "#bcbfb8" : "#d6d9d2");
  r.rect(ox - 2, rt, W + 4, 2, "#eef0ea");
  r.rect(ox - 2, rt, 2, wt - rt, "#e4e6e0");
  r.rect(ox + W, rt, 2, wt - rt, "#9a9e98");
  r.rect(ox, rt + 2, W, 1, "#a8aca6");
  r.rect(ox - 2, wt - 2, W + 4, 2, "#8a8e88");
  // 天窗
  for (const x of [ox + 20, ox + 44]) {
    r.rect(x, rt + 10, 16, 10, "#6f9ab8");
    r.rect(x, rt + 10, 16, 1, "#d8f0fa");
    r.rect(x + 7, rt + 10, 1, 10, "#4a6a84");
    r.rect(x - 1, rt + 20, 18, 2, "#7a7e78");
  }
  // 空调机：有顶面和正面的小盒子。
  for (const x of [ox + 78, ox + 100]) {
    r.rect(x, rt + 8, 14, 5, "#e2e4de");
    r.rect(x, rt + 13, 14, 7, "#a8aca6");
    r.ellipse(x + 7, rt + 16, 3, 3, "#6a6e68");
    r.rect(x + 14, rt + 13, 2, 7, "#7a7e78");
  }
  // 天线和顶上的红灯
  const ax = ox + W - 24;
  r.rect(ax, rt - 22, 1, 30, "#5a5e66");
  r.rect(ax - 4, rt - 12, 9, 1, "#5a5e66");
  r.rect(ax - 2, rt - 18, 5, 1, "#5a5e66");
  r.rect(ax - 1, rt - 24, 3, 2, "#e0453a");
  p.lights.push({ x: ax - p.ox, y: rt - 23 - p.oy, r: 18, color: "#ff4a3a", kind: "beacon" });
  // 白墙，一道青色腰线，大玻璃窗。
  wallFill(p, ox, wt, W, p.wall, "panel", "#eef0ea");
  r.rect(ox, wt + 4, W, 3, "#3f8f8a");
  eaveShadow(p, ox, W, wt, 3);
  foundation(p, ox, W, 4, "#8a8e88");
  for (const x of [ox + 8, ox + 40, ox + W - 70, ox + W - 38]) windowAt(p, x, wt + 11, 28, 12, { trim: "#c6cac4", cool: true });
  const xc = ox + W / 2;
  // 玻璃门和雨棚
  doorAt(p, xc, 18, 22, "glass", "#9fc8dc", "#c6cac4");
  r.rect(xc - 16, oy - 29, 32, 4, "#d6d9d2");
  r.rect(xc - 16, oy - 29, 32, 1, "#ffffff");
  r.shade(xc - 14, oy - 25, 28, 2, 0.7);
  plaque(p, xc, wt - 14, p.b.sign ?? "测序", "#24382c", "#9ae0d8");
  // DNA 小标志
  for (let y = 0; y < 12; y++) {
    const s = Math.round(Math.sin(y * 0.7) * 3);
    r.px(xc + 22 + s, wt - 14 + y, "#3f8f8a");
    r.px(xc + 22 - s, wt - 14 + y, "#e0453a");
  }
}

function drawGreenhouse(p: Painter): void {
  const { ox, oy, W } = p;
  const r = p.r;
  const wt = p.wallTop;
  const gable = 18;
  gableRoof(p, ox, ox + W, wt, gable, { light: "#d8f0ea", mid: "#bfe0da", dark: "#94beba" }, { glass: true, trim: "#f4f6f0", over: 2 });
  // 玻璃墙：里面有绿植。
  r.rect(ox, wt - gable, W, p.wall + gable, "#a8d8d0");
  r.poly(
    [
      [ox, wt - gable - 1],
      [ox + W / 2, wt - gable - 1],
      [ox, wt],
    ],
    "#00000000",
  );
  r.poly(
    [
      [ox + W / 2, wt - gable - 1],
      [ox + W + 1, wt - gable - 1],
      [ox + W + 1, wt],
    ],
    "#00000000",
  );
  for (let i = 0; i < 22; i++) {
    const x = ox + 4 + p.rng.int(0, W - 8);
    const y = oy - 6 - p.rng.int(0, 14);
    r.ellipse(x, y, 3 + p.rng.int(0, 2), 3, p.rng.next() < 0.5 ? "#4f9a3a" : "#6cbf4a");
    if (p.rng.next() < 0.3) r.px(x, y - 2, "#e0453a");
  }
  for (let x = ox; x <= ox + W; x += 10) r.rect(x, wt - gable, 1, p.wall + gable, "#f4f6f0");
  r.rect(ox, wt, W, 1, "#f4f6f0");
  r.rect(ox, oy - 14, W, 1, "#f4f6f0");
  for (let i = 0; i < W; i += 14) r.line(ox + i, oy - 3, ox + i + 10, wt + 1, "#e6f8f4");
  doorAt(p, ox + W / 2, 12, 18, "glass", "#bfe0da", "#f4f6f0");
  foundation(p, ox, W, 3, "#9a9282");
  p.light(ox + W / 2, oy + 6, 30, "#d0ffd8");
}

const DRAW: Record<BuildingKind, (p: Painter) => void> = {
  home: drawHome,
  barn: drawBarn,
  silo: drawSilo,
  coop: drawCoop,
  mill: drawMill,
  stand: drawStand,
  bookie: drawBookie,
  booth: drawBooth,
  market: drawMarket,
  teahouse: drawTeahouse,
  store: drawStore,
  smithy: drawSmithy,
  house: drawHouse,
  shrine: drawShrine,
  zhao: drawZhao,
  lab: drawLab,
  greenhouse: drawGreenhouse,
};

const cache = new Map<string, BuildingSprite>();

/** 房子的贴图，锚点在占地的左下角。 */
export function buildingSprite(b: Building): BuildingSprite {
  let s = cache.get(b.id);
  if (s) return s;
  const p = new Painter(b);
  DRAW[b.kind](p);
  p.r.outline(INK);
  const img = p.r.toCanvas();
  s = {
    img,
    glow: p.glowUsed ? p.g.toCanvas() : null,
    ax: p.ox,
    ay: p.oy,
    lights: p.lights,
    chimney: p.chimney,
    hub: p.hub,
    texts: p.texts,
  };
  cache.set(b.id, s);
  return s;
}

/** 建筑阻挡阳光的高度，与美术里的墙和屋顶尺寸一致。 */
export function buildingHeight(b: Building): number {
  const s = SPEC[b.kind];
  return s.wall + s.rise * 0.6 + 10;
}
