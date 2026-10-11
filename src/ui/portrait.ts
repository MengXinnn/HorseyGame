import { encodeGenome, type Genome } from "../genome/genome";
import { drawHorsePose, lookFor } from "../render/horseArt";
import { PALETTES, type TimeOfDay } from "../render/scene";
import { Race } from "../sim/race";
import type { HorsePose } from "../sim/horse";
import type { BodyPlan } from "../body/bodyPlan";

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

/** 画一张马的小像：透明背景，马居中、按画布大小缩放。 */
export function drawPortrait(canvas: HTMLCanvasElement, genome: Genome, time: TimeOfDay): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || Number(canvas.getAttribute("width")) || 96;
  const H = canvas.clientHeight || Number(canvas.getAttribute("height")) || 72;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const { pose, plan } = snapshot(genome);
  const tall = Math.max(plan.legFront, plan.legRear) + plan.torsoHeight + plan.neckLength * 0.9;
  const long = plan.torsoLength + plan.neckLength * 0.6 + plan.tailLength * 0.5 + 0.6;
  const ppm = Math.min((H * 0.86) / tall, (W * 0.9) / long);
  drawHorsePose(ctx, pose, plan, lookFor(plan, PALETTES[time].rim), {
    camX: pose.torso.x + plan.torsoLength * 0.12,
    ppm,
    groundY: H * 0.93,
    width: W,
  });
}
