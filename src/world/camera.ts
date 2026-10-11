/**
 * 大世界镜头：固定朝北（+z）的透视镜头，跟在人物身后斜着往下看。
 * 远处的东西变小、往地平线靠，地平线上面是天空和远山。
 * 世界坐标：x 向东，z 向北，y 向上，单位米。
 */
export interface Camera {
  x: number;
  z: number;
  /** 镜头离地高度（米）。 */
  height: number;
  /** 焦距（像素）。 */
  focal: number;
  /** 地平线在屏幕上的 y。 */
  horizon: number;
  width: number;
  screenH: number;
}

export const NEAR = 1.5;
export const FAR = 170;
/** 镜头在人物身后多远。 */
export const CAMERA_BACK = 9;

export function makeCamera(px: number, pz: number, W: number, H: number): Camera {
  const focal = Math.min(H * 0.64, W * 0.5);
  // 让人物站在屏幕 78% 高度处。
  const horizon = H * 0.3;
  const height = ((H * 0.78 - horizon) * CAMERA_BACK) / focal;
  return { x: px, z: pz - CAMERA_BACK, height, focal, horizon, width: W, screenH: H };
}

export interface Projected {
  x: number;
  y: number;
  /** 这个深度上每米多少像素。 */
  scale: number;
  depth: number;
}

export function depthOf(cam: Camera, z: number): number {
  return z - cam.z;
}

/** 三维点投到屏幕上；在镜头后面（depth < NEAR）返回 null。 */
export function project(cam: Camera, x: number, z: number, y = 0): Projected | null {
  const d = z - cam.z;
  if (d < NEAR) return null;
  const scale = cam.focal / d;
  return { x: cam.width / 2 + (x - cam.x) * scale, y: cam.horizon + (cam.height - y) * scale, scale, depth: d };
}

/** 不做近裁剪的投影（调用方保证 depth > 0）。 */
function projectRaw(cam: Camera, x: number, z: number, y: number): [number, number] {
  const d = z - cam.z;
  const s = cam.focal / d;
  return [cam.width / 2 + (x - cam.x) * s, cam.horizon + (cam.height - y) * s];
}

/** 屏幕上的点反投到地面上（点在地平线以上返回 null）。 */
export function unproject(cam: Camera, sx: number, sy: number): { x: number; z: number } | null {
  const dy = sy - cam.horizon;
  if (dy <= 1) return null;
  const d = (cam.focal * cam.height) / dy;
  return { x: cam.x + ((sx - cam.width / 2) * d) / cam.focal, z: cam.z + d };
}

/** 屏幕上某一深度可见的横向半宽（米）。 */
export function halfWidthAt(cam: Camera, depth: number): number {
  return (cam.width / 2 / cam.focal) * depth;
}

/** 物体是否大致在视野里（含一点余量）。 */
export function visible(cam: Camera, x: number, z: number, radius: number): boolean {
  const d = z - cam.z;
  if (d + radius < NEAR || d - radius > FAR) return false;
  return Math.abs(x - cam.x) - radius < halfWidthAt(cam, Math.max(NEAR, d)) + 2;
}

/**
 * 把地面上的多边形（世界坐标，y 可选）裁掉镜头后面的部分再投影成屏幕路径。
 * 返回屏幕坐标点列；完全看不见返回空数组。
 */
export function projectPolygon(cam: Camera, pts: ReadonlyArray<readonly [number, number, number?]>): Array<[number, number]> {
  const clip = cam.z + NEAR;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as readonly [number, number, number?];
    const b = pts[(i + 1) % pts.length] as readonly [number, number, number?];
    const ain = a[1] >= clip;
    const bin = b[1] >= clip;
    if (ain) out.push([a[0], a[1], a[2] ?? 0]);
    if (ain !== bin) {
      const t = (clip - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, clip, (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t]);
    }
  }
  return out.map(([x, z, y]) => projectRaw(cam, x, z, y));
}

export function pathFrom(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>): boolean {
  if (pts.length < 3) return false;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
  return true;
}
