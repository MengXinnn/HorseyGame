/**
 * 小地图：整张地图烘成一张小图（一格两个像素），角落里只显示人物附近一块，
 * 按 M 或点一下打开整张大地图。
 */
import { Raster, rgb } from "./raster";
import { groundColor } from "./sprites";
import { BUILDINGS, FENCES, FOUNTAIN, GROUND, MAP_H, MAP_W, PROPS, T, type BuildingKind } from "./tiles";

/** 小地图上一格几个像素。 */
export const MAP_PX = 2;

/** 房顶的颜色（小地图上一眼认得出是哪栋）。 */
const ROOF: Record<BuildingKind, string> = {
  home: "#c0503a",
  barn: "#a83a28",
  silo: "#c8ccd0",
  coop: "#d8b048",
  mill: "#e8dcc4",
  bookie: "#c9302a",
  lab: "#e8eae4",
  greenhouse: "#bfe8e0",
  market: "#9a5a34",
  teahouse: "#4b5560",
  store: "#3f7a52",
  smithy: "#4a4f5a",
  house: "#6a7a8a",
  shrine: "#2f8a5a",
  courtyard: "#5a6068",
  booth: "#2f7a52",
  stand: "#c9302a",
};

const TREES = new Set(["pine", "oak", "willow", "bamboo"]);

export interface MapMarks {
  x: number;
  z: number;
  horses: Array<{ x: number; z: number; wild: boolean }>;
}

export class Minimap {
  readonly base: HTMLCanvasElement;
  private time = 0;

  constructor() {
    this.base = bake();
  }

  /** 角落里的小地图：以人物为中心截一块，画上人和马。 */
  drawLocal(c: HTMLCanvasElement, m: MapMarks, dt: number): void {
    this.time += dt;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    const w = c.width;
    const h = c.height;
    const sx = Math.round(Math.max(0, Math.min(MAP_W * MAP_PX - w, m.x * MAP_PX - w / 2)));
    const sy = Math.round(Math.max(0, Math.min(MAP_H * MAP_PX - h, m.z * MAP_PX - h / 2)));
    ctx.fillStyle = "#1d3d1f";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.base, sx, sy, w, h, 0, 0, w, h);
    marks(ctx, m, sx, sy, this.time);
  }

  /** 整张大地图。 */
  drawFull(c: HTMLCanvasElement, m: MapMarks, t: number): void {
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0);
    marks(ctx, m, 0, 0, t, 2);
  }
}

function marks(ctx: CanvasRenderingContext2D, m: MapMarks, sx: number, sy: number, t: number, big = 1): void {
  for (const h of m.horses) {
    const x = Math.round(h.x * MAP_PX - sx);
    const y = Math.round(h.z * MAP_PX - sy);
    ctx.fillStyle = "#2a1a12";
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillStyle = h.wild ? "#c8823a" : "#fbefd4";
    ctx.fillRect(x, y, 1, 1);
  }
  // 人：一个一闪一闪的红点，外面一圈深色。
  const x = Math.round(m.x * MAP_PX - sx);
  const y = Math.round(m.z * MAP_PX - sy);
  const r = big;
  ctx.fillStyle = "#2a1a12";
  ctx.fillRect(x - r - 1, y - r - 1, r * 2 + 3, r * 2 + 3);
  ctx.fillStyle = Math.floor(t * 3) % 2 ? "#f6d05a" : "#e8433a";
  ctx.fillRect(x - r, y - r, r * 2 + 1, r * 2 + 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - r, y - r, r, 1);
}

function bake(): HTMLCanvasElement {
  const W = MAP_W * MAP_PX;
  const H = MAP_H * MAP_PX;
  const r = new Raster(W, H);
  const at = (x: number, z: number): number => (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H ? T.grass : (GROUND[z * MAP_W + x] as number));
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      const k = at(x, z);
      let c = groundColor(k);
      if (k === T.water) c = "#4a8ed0";
      if (k === T.path) c = "#e0b878";
      if (k === T.track) c = "#c8864e";
      r.rect(x * MAP_PX, z * MAP_PX, MAP_PX, MAP_PX, c);
      // 水边一圈浅色，看得出河岸。
      if (k === T.water && (at(x, z - 1) !== T.water || at(x - 1, z) !== T.water || at(x + 1, z) !== T.water || at(x, z + 1) !== T.water))
        r.px(x * MAP_PX, z * MAP_PX, "#8cc8f0");
    }
  for (const p of PROPS) {
    if (!TREES.has(p.kind)) continue;
    const x = Math.floor(p.x) * MAP_PX;
    const y = Math.floor(p.z - 0.5) * MAP_PX;
    r.rect(x, y, 2, 2, p.kind === "pine" ? "#24583a" : "#2f6e35");
    r.px(x, y, p.kind === "pine" ? "#3f8460" : "#5aa848");
  }
  for (const f of FENCES) {
    const x = f.x * MAP_PX;
    const y = f.z * MAP_PX;
    if (f.horizontal) r.rect(x, y, MAP_PX, 1, f.metal ? "#e8eaf0" : "#7a4a24");
    else r.rect(x, y, 1, MAP_PX, f.metal ? "#e8eaf0" : "#7a4a24");
  }
  const ink = rgb("#2a1a12");
  for (const b of BUILDINGS) {
    const x = b.x * MAP_PX;
    const y = b.z * MAP_PX;
    const w = b.w * MAP_PX;
    const h = b.d * MAP_PX;
    r.rect(x - 1, y - 1, w + 2, h + 2, ink);
    r.rect(x, y, w, h, ROOF[b.kind]);
    r.rect(x, y, w, 1, "#ffffff40");
    r.rect(x, y + h - 1, w, 1, "#00000040");
  }
  r.ellipse(FOUNTAIN.x * MAP_PX, FOUNTAIN.z * MAP_PX, 4, 3, "#d6cdbd");
  r.ellipse(FOUNTAIN.x * MAP_PX, FOUNTAIN.z * MAP_PX, 3, 2, "#5aa6e0");
  return r.toCanvas();
}
