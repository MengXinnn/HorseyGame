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
    const c = cross(a, b, [x, z]);
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
interface Projection {
  caster: SunCaster;
  polygon: Point[];
}

/** 阴影和接收点共享一套几何；格子索引也包含画面外物体投进来的长影。 */
export class SolarField {
  sun: Sun = sunAt(0);
  private minute = -1;
  private grid = new Map<string, SunCaster[]>();
  private projections = new Map<SunCaster, Projection>();

  constructor(readonly casters: SunCaster[]) {
    // 覆盖一天内可能的影区，索引不随太阳重建。只给当前视野里的物体算投影。
    // sunAt 的最大投影斜率是 x=±3、z=1.4，且高处接收点更靠近物体。
    for (const caster of casters) {
      const xs = caster.footprint.map((p) => p[0]);
      const zs = caster.footprint.map((p) => p[1]);
      for (let z = Math.floor(Math.min(...zs) / CELL); z <= Math.floor((Math.max(...zs) + caster.height * 1.4) / CELL); z++)
        for (let x = Math.floor((Math.min(...xs) - caster.height * 3) / CELL); x <= Math.floor((Math.max(...xs) + caster.height * 3) / CELL); x++) {
          const key = `${x},${z}`;
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
    const entries = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
    return entries.some((caster) => caster.id !== ignore && blocksSun(caster, this.sun, x, z, height));
  }

  visible(x: number, z: number, w: number, h: number): Projection[] {
    if (this.sun.power <= 0) return [];
    const seen = new Set<SunCaster>();
    for (let gz = Math.floor(z / CELL); gz <= Math.floor((z + h) / CELL); gz++)
      for (let gx = Math.floor(x / CELL); gx <= Math.floor((x + w) / CELL); gx++)
        for (const caster of this.grid.get(`${gx},${gz}`) ?? []) seen.add(caster);
    const result: Projection[] = [];
    for (const caster of seen) {
      let projection = this.projections.get(caster);
      if (!projection) {
        projection = { caster, polygon: shadowPolygon(caster, this.sun) };
        this.projections.set(caster, projection);
      }
      const xs = projection.polygon.map((p) => p[0]);
      const zs = projection.polygon.map((p) => p[1]);
      if (Math.max(...xs) >= x && Math.min(...xs) <= x + w && Math.max(...zs) >= z && Math.min(...zs) <= z + h) result.push(projection);
    }
    return result;
  }
}

/** 只把物体投下的影区画到地面，接收物体则在自己的贴图内着色。 */
export class Sunlight {
  readonly field: SolarField;
  private key = "";
  private staticMask = new Raster(1, 1);
  private mask = new Raster(1, 1);
  private ground = document.createElement("canvas");
  private pixels: ImageData | null = null;
  private tinted = document.createElement("canvas");
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
      } else this.staticMask.data.fill(0);
      for (const { polygon } of this.field.visible(cx, cz, w, h))
        this.staticMask.poly(polygon.map(([x, z]) => [x - cx, z - cz]), "#162330");
    }
    this.mask.data.set(this.staticMask.data);
  }

  castActor(x: number, z: number, r: number, height: number): void {
    if (this.field.sun.power <= 0) return;
    const polygon = shadowPolygon({ id: "", footprint: roundFootprint(x, z, r), bottom: 0, height }, this.field.sun);
    this.mask.poly(polygon.map(([px, pz]) => [px - this.cx, pz - this.cz]), "#162330");
  }

  drawGround(b: CanvasRenderingContext2D): void {
    if (this.field.sun.power <= 0) return;
    const { w, h, data } = this.mask;
    if (this.ground.width !== w || this.ground.height !== h) { this.ground.width = w; this.ground.height = h; }
    const ctx = this.ground.getContext("2d")!;
    if (!this.pixels || this.pixels.width !== w || this.pixels.height !== h) this.pixels = ctx.createImageData(w, h);
    this.pixels.data.set(new Uint8ClampedArray(data.buffer));
    ctx.putImageData(this.pixels, 0, 0);
    b.save();
    b.globalAlpha = this.field.sun.power * 0.28;
    b.drawImage(this.ground, 0, 0);
    b.restore();
  }

  /** 每 6×4 个像素按接收高度查询遮挡，只在原贴图的不透明像素上加阴影。 */
  sprite(img: HTMLCanvasElement, x: number, z: number, ax: number, ay: number, ignore = "", flipped = false): HTMLCanvasElement {
    if (this.field.sun.power <= 0) return img;
    if (this.tinted.width !== img.width || this.tinted.height !== img.height) { this.tinted.width = img.width; this.tinted.height = img.height; }
    const ctx = this.tinted.getContext("2d")!;
    ctx.clearRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    for (let row = 0; row < img.height; row += 4) {
      const height = Math.max(0, ay - row - 2);
      for (let col = 0; col < img.width; col += 6) {
        const wx = x + (col + 3 - ax) * (flipped ? -1 : 1);
        if (!this.field.shaded(wx, z, height, ignore)) continue;
        ctx.fillStyle = `rgba(22,35,48,${this.field.sun.power * 0.28})`;
        ctx.fillRect(col, row, 6, 4);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    return this.tinted;
  }

  drawSprite(b: CanvasRenderingContext2D, img: HTMLCanvasElement, sx: number, sy: number, x: number, z: number, ax: number, ay: number, ignore = "", flipped = false): void {
    b.drawImage(this.sprite(img, x, z, ax, ay, ignore, flipped), sx, sy);
  }
}
