import { encodeGenome, type Genome } from "../genome/genome";
import { drawHorsePose, lookFor } from "../render/horseArt";
import { PALETTES, type TimeOfDay } from "../render/scene";
import { Race } from "../sim/race";
import type { HorsePose } from "../sim/horse";
import type { BodyPlan } from "../body/bodyPlan";
import { outline } from "../world/sprites";

interface Snapshot {
  pose: HorsePose;
  plan: BodyPlan;
}

const cache = new Map<string, Snapshot>();

/** 让马在物理世界里站稳，拍一张静止姿态。按马码缓存。 */
function snapshot(genome: Genome): Snapshot {
  const key = encodeGenome(genome);
  const hit = cache.get(key);
  if (hit) return hit;
  const race = new Race([{ id: "p", name: "p", genome }], { distance: 10, seed: 1, timeLimit: 1, startAt: Infinity });
  for (let i = 0; i < 50; i++) race.step();
  const shot = { pose: race.poses()[0] as HorsePose, plan: race.runners[0]!.horse.plan };
  cache.set(key, shot);
  return shot;
}

/** 画面放大倍数：小像按低分辨率画，再由 CSS 放大成方块像素。 */
const PIXEL = 2;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const boxes = new Map<string, Box>();

/** 先在一张大画布上画一遍，量出马实际占的范围（米），小像按这个范围取景。 */
function measure(genome: Genome, shot: Snapshot, look: ReturnType<typeof lookFor>): Box {
  const key = encodeGenome(genome);
  const hit = boxes.get(key);
  if (hit) return hit;
  const S = 40;
  const W = 400;
  const H = 300;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const camX = shot.pose.torso.x;
  drawHorsePose(ctx, shot.pose, shot.plan, look, { camX, ppm: S, groundY: H - 20, width: W });
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W;
  let x1 = 0;
  let y0 = H;
  let y1 = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3]! > 60) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const box = x1 > x0 ? { x0: (x0 - W / 2) / S + camX, x1: (x1 + 1 - W / 2) / S + camX, y0: (H - 20 - y1 - 1) / S, y1: (H - 20 - y0) / S } : { x0: camX - 1.5, x1: camX + 1.5, y0: 0, y1: 2.4 };
  boxes.set(key, box);
  return box;
}

/** 画一张马的像素小像：透明背景，马居中，描一圈深色边。bust：只取头颈，给工具栏的小格子用。 */
export function drawPortrait(canvas: HTMLCanvasElement, genome: Genome, time: TimeOfDay, bust = false): void {
  const cssW = canvas.clientWidth || Number(canvas.getAttribute("width")) || 96;
  const cssH = canvas.clientHeight || Number(canvas.getAttribute("height")) || 72;
  const W = Math.max(8, Math.round(cssW / PIXEL));
  const H = Math.max(8, Math.round(cssH / PIXEL));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  const shot = snapshot(genome);
  const look = lookFor(shot.plan, PALETTES[time].rim);
  const b = measure(genome, shot, look);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  // 取景框（米）：整匹马，或者右上角的头颈。
  const view = bust ? { x0: b.x0 + w * 0.5, x1: b.x1, y0: b.y0 + h * 0.4, y1: b.y1 } : b;
  const vw = view.x1 - view.x0;
  const vh = view.y1 - view.y0;
  const ppm = Math.min((W - 2) / vw, (H - 2) / vh);
  const cx = (view.x0 + view.x1) / 2;
  // 整匹马站在底边上，头像让头颈居中。
  const groundY = bust ? H / 2 + ((view.y0 + view.y1) / 2) * ppm : H - 1 - (H - 2 - vh * ppm) / 2 + view.y0 * ppm;
  drawHorsePose(ctx, shot.pose, shot.plan, look, { camX: cx, ppm, groundY, width: W });
  outline(canvas, "#3b1c0e", 110);
}
