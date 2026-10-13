/** 世界坐标里的日照：物体是有高度的棱柱，影子来自太阳射线与物体的交点。 */
import { Raster } from "./raster";

export type Point = [number, number];
export interface Sun {
  /** 每升高一个像素，影子在地面上沿 x、z 偏移多少。 */
  dx: number;
  dz: number;
  power: number;
}
export interface SunCaster {
  id: string;
  /** 逆时针的凸占地，单位为世界像素。 */
  footprint: Point[];
  bottom: number;
  height: number;
}

const smooth = (v: number): number => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};

/** 太阳从画面左侧升起、右侧落下；正午影子短，日出日落渐隐。 */
export function sunAt(clock: number): Sun {
  const h = clock / 60;
  const phase = Math.max(0, Math.min(1, (h - 6) / 13.5));
  const elevation = 0.2 + Math.sin(phase * Math.PI) * 0.9;
  return {
    dx: Math.cos(phase * Math.PI) * 0.6 / elevation,
    dz: 0.28 / elevation,
    power: smooth((h - 6) / 0.75) * smooth((19.5 - h) / 0.75),
  };
}

export function boxFootprint(x: number, z: number, w: number, d: number): Point[] {
  return [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
}

export function roundFootprint(x: number, z: number, r: number): Point[] {
  return Array.from({ length: 12 }, (_, i) => {
    const a = i * Math.PI / 6;
    return [x + Math.cos(a) * r, z + Math.sin(a) * r];
  });
}

const cross = (a: Point, b: Point, c: Point): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** 棱柱上下两面的投影组成一个凸影区。 */
export function shadowPolygon(caster: SunCaster, sun: Sun): Point[] {
  const points = [caster.bottom, caster.height].flatMap((h) => caster.footprint.map(([x, z]): Point => [x + sun.dx * h, z + sun.dz * h]));
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (ps: Point[]): Point[] => {
    const result: Point[] = [];
    for (const p of ps) {
      while (result.length > 1 && cross(result[result.length - 2]!, result[result.length - 1]!, p) <= 0) result.pop();
      result.push(p);
    }
    result.pop();
    return result;
  };
  return [...half(points), ...half([...points].reverse())];
}

/** 从接收点向太阳追踪射线。高度足够、且射线穿过占地时才遮挡。 */
export function blocksSun(caster: SunCaster, sun: Sun, x: number, z: number, height = 0): boolean {
  if (sun.power <= 0 || height >= caster.height) return false;
  let low = Math.max(0, caster.bottom - height);
  let high = caster.height - height;
  for (let i = 0; i < caster.footprint.length; i++) {
    const a = caster.footprint[i]!;
    const b = caster.footprint[(i + 1) % caster.footprint.length]!;
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const slope = (b[1] - a[1]) * sun.dx - (b[0] - a[0]) * sun.dz;
    if (Math.abs(slope) < 1e-9) {
      if (c < 0) return false;
    } else if (slope > 0) low = Math.max(low, -c / slope);
    else high = Math.min(high, -c / slope);
    if (low > high) return false;
  }
  return high > Math.max(low, 1e-6);
}

const CELL = 96;
/** 格子坐标打包成一个整数当键，查询时不拼字符串。 */
const cellKey = (gx: number, gz: number): number => (gz + 4096) * 8192 + gx + 4096;
const NONE: SunCaster[] = [];
interface Projection {
  caster: SunCaster;
  polygon: Point[];
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** 阴影和接收点共享一套几何；格子索引也包含画面外物体投进来的长影。 */
export class SolarField {
  sun: Sun = sunAt(0);
  private minute = -1;
  private grid = new Map<number, SunCaster[]>();
  private projections = new Map<SunCaster, Projection>();

  constructor(readonly casters: SunCaster[]) {
    // 覆盖一天内可能的影区，索引不随太阳重建。只给当前视野里的物体算投影。
    // sunAt 的最大投影斜率是 x=±3、z=1.4，且高处接收点更靠近物体。
    for (const caster of casters) {
      const xs = caster.footprint.map((p) => p[0]);
      const zs = caster.footprint.map((p) => p[1]);
      for (let z = Math.floor(Math.min(...zs) / CELL); z <= Math.floor((Math.max(...zs) + caster.height * 1.4) / CELL); z++)
        for (let x = Math.floor((Math.min(...xs) - caster.height * 3) / CELL); x <= Math.floor((Math.max(...xs) + caster.height * 3) / CELL); x++) {
          const key = cellKey(x, z);
          const entries = this.grid.get(key) ?? [];
          entries.push(caster);
          this.grid.set(key, entries);
        }
    }
  }

  update(clock: number): void {
    const minute = Math.floor(clock);
    if (minute === this.minute) return;
    this.minute = minute;
    this.sun = sunAt(minute);
    this.projections.clear();
  }

  shaded(x: number, z: number, height = 0, ignore = ""): boolean {
    if (this.sun.power <= 0) return false;
    const entries = this.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NONE;
    for (const caster of entries) if (caster.id !== ignore && blocksSun(caster, this.sun, x, z, height)) return true;
    return false;
  }

  visible(x: number, z: number, w: number, h: number): Projection[] {
    if (this.sun.power <= 0) return [];
    const seen = new Set<SunCaster>();
    for (let gz = Math.floor(z / CELL); gz <= Math.floor((z + h) / CELL); gz++)
      for (let gx = Math.floor(x / CELL); gx <= Math.floor((x + w) / CELL); gx++)
        for (const caster of this.grid.get(cellKey(gx, gz)) ?? NONE) seen.add(caster);
    const result: Projection[] = [];
    for (const caster of seen) {
      let projection = this.projections.get(caster);
      if (!projection) {
        const polygon = shadowPolygon(caster, this.sun);
        projection = { caster, polygon, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
        for (const [px, pz] of polygon) {
          projection.x0 = Math.min(projection.x0, px);
          projection.x1 = Math.max(projection.x1, px);
          projection.z0 = Math.min(projection.z0, pz);
          projection.z1 = Math.max(projection.z1, pz);
        }
        this.projections.set(caster, projection);
      }
      if (projection.x1 >= x && projection.x0 <= x + w && projection.z1 >= z && projection.z0 <= z + h) result.push(projection);
    }
    return result;
  }
}

const SHADE = "#162330";

interface Tinted {
  canvas: HTMLCanvasElement;
  cells: Uint8Array;
  power: number;
}

/** 只把物体投下的影区画到地面，接收物体则在自己的贴图内着色。 */
export class Sunlight {
  readonly field: SolarField;
  private key = "";
  private staticMask = new Raster(1, 1);
  private mask = new Raster(1, 1);
  private ground = document.createElement("canvas");
  private pixels: ImageData | null = null;
  private maskBytes: Uint8ClampedArray = new Uint8ClampedArray(0);
  /** 每张贴图一块着色画布，尺寸不变就不重新分配；遮挡格子没变就直接复用。 */
  private tinted = new WeakMap<HTMLCanvasElement, Tinted>();
  private cells = new Uint8Array(0);
  private cx = 0;
  private cz = 0;

  constructor(casters: SunCaster[]) { this.field = new SolarField(casters); }

  prepare(clock: number, cx: number, cz: number, w: number, h: number): void {
    this.field.update(clock);
    this.cx = cx; this.cz = cz;
    const key = `${Math.floor(clock)}|${cx}|${cz}|${w}|${h}`;
    if (key !== this.key) {
      this.key = key;
      if (this.staticMask.w !== w || this.staticMask.h !== h) {
        this.staticMask = new Raster(w, h);
        this.mask = new Raster(w, h);
        this.maskBytes = new Uint8ClampedArray(this.mask.data.buffer);
      } else this.staticMask.data.fill(0);
      for (const { polygon } of this.field.visible(cx, cz, w, h))
        this.staticMask.poly(polygon, SHADE, cx, cz);
    }
    this.mask.data.set(this.staticMask.data);
  }

  castActor(x: number, z: number, r: number, height: number): void {
    const sun = this.field.sun;
    if (sun.power <= 0) return;
    // 影子够不到画面的就不算。
    const reach = Math.abs(sun.dx) * height;
    if (x + r + reach < this.cx || x - r - reach > this.cx + this.mask.w || z + r + sun.dz * height < this.cz || z - r > this.cz + this.mask.h) return;
    const polygon = shadowPolygon({ id: "", footprint: roundFootprint(x, z, r), bottom: 0, height }, sun);
    this.mask.poly(polygon, SHADE, this.cx, this.cz);
  }

  drawGround(b: CanvasRenderingContext2D): void {
    if (this.field.sun.power <= 0) return;
    const { w, h, data } = this.mask;
    if (this.ground.width !== w || this.ground.height !== h) { this.ground.width = w; this.ground.height = h; }
    const ctx = this.ground.getContext("2d")!;
    if (!this.pixels || this.pixels.width !== w || this.pixels.height !== h) this.pixels = ctx.createImageData(w, h);
    if (this.maskBytes.buffer !== data.buffer) this.maskBytes = new Uint8ClampedArray(data.buffer);
    this.pixels.data.set(this.maskBytes);
    ctx.putImageData(this.pixels, 0, 0);
    b.save();
    b.globalAlpha = this.field.sun.power * 0.28;
    b.drawImage(this.ground, 0, 0);
    b.restore();
  }

  /**
   * 每 6×4 个像素按接收高度查询遮挡，只在原贴图的不透明像素上加阴影。
   * 没被遮住就直接用原图；遮挡格子和日照都没变时复用上次的结果。
   * live 表示原图每帧都会重画（马），这时总要重新着色。
   */
  sprite(img: HTMLCanvasElement, x: number, z: number, ax: number, ay: number, ignore = "", flipped = false, live = false): HTMLCanvasElement {
    const power = this.field.sun.power;
    if (power <= 0) return img;
    const cols = Math.ceil(img.width / 6);
    const rows = Math.ceil(img.height / 4);
    const n = cols * rows;
    if (this.cells.length < n) this.cells = new Uint8Array(n);
    const cells = this.cells;
    let any = false;
    for (let row = 0; row < rows; row++) {
      const height = Math.max(0, ay - row * 4 - 2);
      for (let col = 0; col < cols; col++) {
        const wx = x + (col * 6 + 3 - ax) * (flipped ? -1 : 1);
        const hit = this.field.shaded(wx, z, height, ignore) ? 1 : 0;
        cells[row * cols + col] = hit;
        if (hit) any = true;
      }
    }
    if (!any) return img;
    let entry = this.tinted.get(img);
    if (!entry || entry.canvas.width !== img.width || entry.canvas.height !== img.height) {
      const canvas = entry?.canvas ?? document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      entry = { canvas, cells: new Uint8Array(n), power: -1 };
      this.tinted.set(img, entry);
    }
    let same = !live && entry.power === power;
    for (let i = 0; same && i < n; i++) same = entry.cells[i] === cells[i];
    if (same) return entry.canvas;
    entry.cells.set(cells.subarray(0, n));
    entry.power = power;
    const ctx = entry.canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = `rgba(22,35,48,${power * 0.28})`;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) if (cells[row * cols + col]) ctx.fillRect(col * 6, row * 4, 6, 4);
    ctx.globalCompositeOperation = "source-over";
    return entry.canvas;
  }

  drawSprite(b: CanvasRenderingContext2D, img: HTMLCanvasElement, sx: number, sy: number, x: number, z: number, ax: number, ay: number, ignore = "", flipped = false, live = false): void {
    b.drawImage(this.sprite(img, x, z, ax, ay, ignore, flipped, live), sx, sy);
  }
}
