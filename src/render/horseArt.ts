import type { BodyPlan } from "../body/bodyPlan";
import type { HorsePose, Vec2Like } from "../sim/horse";
import { coatFor, mix, rgba, shade, type Coat } from "./color";

/** 物理坐标（米，y 向上）到屏幕像素的换算。 */
export interface View {
  camX: number;
  ppm: number;
  groundY: number;
  width: number;
  /** 镜头中心在屏幕上的横向比例，默认 0.5。 */
  anchor?: number;
}

export function toScreen(v: View, p: Vec2Like): [number, number] {
  return [(p.x - v.camX) * v.ppm + v.width * (v.anchor ?? 0.5), v.groundY - p.y * v.ppm];
}

export interface HorseLook {
  coat: Coat;
  pattern: number;
  rim: string;
}

export function lookFor(plan: BodyPlan, rim: string): HorseLook {
  return { coat: coatFor(plan.coat), pattern: plan.pattern, rim };
}

const NECK_ANGLE = 0.95;

function bodyPath(ctx: CanvasRenderingContext2D, L: number, H: number): void {
  ctx.beginPath();
  ctx.moveTo(L * 0.5, -H * 0.05);
  ctx.bezierCurveTo(L * 0.52, -H * 0.42, L * 0.4, -H * 0.56, L * 0.24, -H * 0.54);
  ctx.bezierCurveTo(L * 0.05, -H * 0.42, -L * 0.15, -H * 0.44, -L * 0.3, -H * 0.52);
  ctx.bezierCurveTo(-L * 0.48, -H * 0.56, -L * 0.56, -H * 0.2, -L * 0.5, H * 0.08);
  ctx.bezierCurveTo(-L * 0.46, H * 0.38, -L * 0.3, H * 0.5, -L * 0.14, H * 0.46);
  ctx.bezierCurveTo(0, H * 0.56, L * 0.2, H * 0.56, L * 0.32, H * 0.42);
  ctx.bezierCurveTo(L * 0.46, H * 0.32, L * 0.5, H * 0.18, L * 0.5, -H * 0.05);
  ctx.closePath();
}

/** 先整块填边缘光色，再把主色错位叠上去，留下一道背光描边。 */
function rimFill(ctx: CanvasRenderingContext2D, path: () => void, fill: string | CanvasGradient, rim: string, dx: number, dy: number): void {
  ctx.save();
  path();
  ctx.clip();
  path();
  ctx.fillStyle = rim;
  ctx.fill();
  ctx.translate(dx, dy);
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function taper(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, ws: number[], color: string): void {
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)] as [number, number];
    const b = pts[Math.min(pts.length - 1, i + 1)] as [number, number];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = (ws[i] ?? 1) / 2;
    const p = pts[i] as [number, number];
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0]![0], left[0]![1]);
  for (let j = 1; j < left.length; j++) {
    const p = left[j - 1]!;
    const q = left[j]!;
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.lineTo(left[left.length - 1]![0], left[left.length - 1]![1]);
  ctx.lineTo(right[right.length - 1]![0], right[right.length - 1]![1]);
  for (let k = right.length - 2; k >= 0; k--) {
    const p = right[k + 1]!;
    const q = right[k]!;
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.lineTo(right[0]![0], right[0]![1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function local(origin: Vec2Like, angle: number, lx: number, ly: number): Vec2Like {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: origin.x + lx * c - ly * s, y: origin.y + lx * s + ly * c };
}

/** 把朝左的姿态绕躯干中心镜像成朝右的姿态（x' = 2·cx − x，角度取反，远近腿不变）。 */
function mirrorPose(pose: HorsePose): HorsePose {
  const cx = pose.torso.x;
  const m = (p: Vec2Like): Vec2Like => ({ x: 2 * cx - p.x, y: p.y });
  return {
    ...pose,
    torso: { x: cx, y: pose.torso.y, angle: -pose.torso.angle },
    neck: { x: 2 * cx - pose.neck.x, y: pose.neck.y, angle: -pose.neck.angle },
    legs: pose.legs.map((l) => ({ ...l, hip: m(l.hip), knee: m(l.knee), foot: m(l.foot) })),
    facing: 1,
  };
}

/** 按物理姿态画一匹马。朝左（facing −1）的马画成朝右的马的镜像，气泡里的字不镜像。 */
export function drawHorsePose(ctx: CanvasRenderingContext2D, pose: HorsePose, plan: BodyPlan, look: HorseLook, view: View): void {
  const bubble = pose.stalled || pose.fallen || pose.stumbling ? (pose.fallen ? "晕" : pose.stumbling ? "!" : "…") : null;
  if (pose.facing === -1) {
    const [tx] = toScreen(view, pose.torso);
    ctx.save();
    ctx.translate(tx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-tx, 0);
    const [bx, by] = drawFacingRight(ctx, mirrorPose(pose), plan, look, view);
    ctx.restore();
    if (bubble) drawBubble(ctx, 2 * tx - bx, by, bubble, look.rim);
  } else {
    const [bx, by] = drawFacingRight(ctx, pose, plan, look, view);
    if (bubble) drawBubble(ctx, bx, by, bubble, look.rim);
  }
}

/** 画一匹头朝右的马，返回头顶气泡的位置（屏幕像素）。 */
function drawFacingRight(ctx: CanvasRenderingContext2D, pose: HorsePose, plan: BodyPlan, look: HorseLook, view: View): [number, number] {
  const ppm = view.ppm;
  const { light, dark, mane } = look.coat;
  const rim = look.rim;
  const L = plan.torsoLength * ppm;
  const H = plan.torsoHeight * ppm * 1.08;
  const w = Math.max(3, plan.legWidth * ppm * 1.15);
  const speedK = Math.min(1, Math.abs(pose.speed) / 6);
  const ph = pose.phase;

  // 地面阴影
  const [shx] = toScreen(view, pose.torso);
  const sh = ctx.createRadialGradient(shx, view.groundY, 0, shx, view.groundY, L * 0.8);
  sh.addColorStop(0, "rgba(0,0,0,0.3)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.translate(shx, view.groundY);
  ctx.scale(1, 0.15);
  ctx.translate(-shx, -view.groundY);
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(shx, view.groundY, L * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const legFill = (far: boolean): string => (far ? shade(dark, -0.15) : mix(light, dark, 0.5));
  const drawLeg = (far: boolean): void => {
    for (const leg of pose.legs) {
      if (leg.far !== far) continue;
      const hip = toScreen(view, leg.hip);
      const knee = toScreen(view, leg.knee);
      const foot = toScreen(view, leg.foot);
      const color = legFill(far);
      taper(ctx, [hip, knee, foot], [w * (leg.front ? 1.35 : 1.7), w * 0.62, w * 0.5], color);
      // 白袜子花纹
      if (look.pattern >= 1) {
        const sock: [number, number] = [knee[0] + (foot[0] - knee[0]) * 0.55, knee[1] + (foot[1] - knee[1]) * 0.55];
        taper(ctx, [sock, foot], [w * 0.52, w * 0.5], far ? "#cfc8bd" : "#f3eee4");
      }
      // 蹄子
      const ang = Math.atan2(foot[1] - knee[1], foot[0] - knee[0]) - Math.PI / 2;
      ctx.save();
      ctx.translate(foot[0], foot[1]);
      ctx.rotate(ang);
      ctx.fillStyle = "#2a2023";
      const hw = w * 0.62;
      ctx.beginPath();
      ctx.moveTo(-hw * 0.6, -hw * 0.25);
      ctx.lineTo(hw * 0.6, -hw * 0.25);
      ctx.lineTo(hw * 0.85, hw * 0.5);
      ctx.lineTo(-hw * 0.75, hw * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  // 尾巴（在身体后面）
  const tailRoot = toScreen(view, local(pose.torso, pose.torso.angle, -plan.torsoLength * 0.48, plan.torsoHeight * 0.3));
  const tl = plan.tailLength * ppm;
  ctx.strokeStyle = mane;
  ctx.lineCap = "round";
  for (let k = 0; k < 7; k++) {
    const sw = Math.sin(ph * 0.9 + k * 0.4) * tl * 0.12;
    ctx.lineWidth = Math.max(1, tl * (0.09 - k * 0.008));
    ctx.beginPath();
    ctx.moveTo(tailRoot[0], tailRoot[1] + k);
    ctx.bezierCurveTo(
      tailRoot[0] - tl * 0.4,
      tailRoot[1] - tl * 0.05 + sw,
      tailRoot[0] - tl * (0.7 + speedK * 0.3),
      tailRoot[1] + tl * 0.35 + sw,
      tailRoot[0] - tl * (0.6 + k * 0.04 + speedK * 0.5),
      tailRoot[1] + tl * (1.0 - speedK * 0.5) + sw * 1.4,
    );
    ctx.stroke();
  }

  drawLeg(true);

  // 躯干
  const [tx, ty] = toScreen(view, pose.torso);
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(-pose.torso.angle);
  const bg = ctx.createLinearGradient(0, -H * 0.55, 0, H * 0.55);
  bg.addColorStop(0, light);
  bg.addColorStop(0.55, mix(light, dark, 0.35));
  bg.addColorStop(1, dark);
  rimFill(ctx, () => bodyPath(ctx, L, H), bg, rim, L * 0.022, H * 0.07);
  ctx.save();
  bodyPath(ctx, L, H);
  ctx.clip();
  ctx.fillStyle = rgba(dark, 0.22);
  ctx.beginPath();
  ctx.ellipse(-L * 0.3, H * 0.05, L * 0.2, H * 0.42, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(light, 0.25);
  ctx.beginPath();
  ctx.ellipse(-L * 0.34, -H * 0.1, L * 0.12, H * 0.22, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(L * 0.3, -H * 0.05, L * 0.1, H * 0.25, 0.3, 0, Math.PI * 2);
  ctx.fill();
  if (look.pattern <= -1) {
    // 斑点花纹
    ctx.fillStyle = rgba("#ffffff", 0.18);
    for (let i = 0; i < 14; i++) {
      const px = (((i * 37) % 100) / 100 - 0.5) * L * 0.9;
      const py = (((i * 53) % 100) / 100 - 0.6) * H * 0.7;
      ctx.beginPath();
      ctx.arc(px, py, H * (0.05 + ((i * 7) % 5) * 0.012), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.restore();

  // 颈和头
  const nl = plan.neckLength;
  const ux = Math.cos(NECK_ANGLE);
  const uy = Math.sin(NECK_ANGLE);
  const nx = -uy;
  const ny = ux;
  const wb = plan.torsoHeight * 0.3;
  const wt = plan.torsoHeight * 0.16;
  const root = pose.neck;
  const a = root.angle;
  const P = (lx: number, ly: number): [number, number] => toScreen(view, local(root, a, lx, ly));
  const baseBack = P(nx * wb - ux * 0.05, ny * wb - uy * 0.05);
  const baseFront = P(-nx * wb * 1.6 + ux * 0.1, -ny * wb * 1.6);
  const topBack = P(ux * nl + nx * wt, uy * nl + ny * wt);
  const topFront = P(ux * nl - nx * wt, uy * nl - ny * wt);
  const ng = ctx.createLinearGradient(baseBack[0], topBack[1], baseFront[0], baseFront[1]);
  ng.addColorStop(0, light);
  ng.addColorStop(1, mix(light, dark, 0.45));
  rimFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(baseBack[0], baseBack[1]);
      const mid = P(ux * nl * 0.55 + nx * wb * 1.05, uy * nl * 0.55 + ny * wb * 1.05);
      ctx.quadraticCurveTo(mid[0], mid[1], topBack[0], topBack[1]);
      ctx.lineTo(topFront[0], topFront[1]);
      const mid2 = P(ux * nl * 0.4 - nx * wb * 1.1, uy * nl * 0.4 - ny * wb * 1.1);
      ctx.quadraticCurveTo(mid2[0], mid2[1], baseFront[0], baseFront[1]);
      ctx.closePath();
    },
    ng,
    rim,
    w * 0.25,
    w * 0.3,
  );
  // 鬃毛
  ctx.strokeStyle = mane;
  ctx.lineCap = "round";
  for (let m = 0; m < 9; m++) {
    const tm = m / 8;
    const crest = P(ux * nl * tm + nx * (wb + (wt - wb) * tm) * 1.05, uy * nl * tm + ny * (wb + (wt - wb) * tm) * 1.05);
    const flow = Math.sin(ph + m * 0.7) * w * 0.4;
    ctx.lineWidth = Math.max(1.5, w * 0.6);
    ctx.beginPath();
    ctx.moveTo(crest[0], crest[1]);
    ctx.quadraticCurveTo(crest[0] - w * 1.0, crest[1] - w * 0.2 + flow, crest[0] - w * (1.9 + speedK * 0.8), crest[1] + w * 0.8 + flow);
    ctx.stroke();
  }

  // 头：在「头坐标系」里画，x 朝向嘴巴
  const hl = plan.headLength;
  const headC = P(ux * nl + hl * 0.32, uy * nl - hl * 0.1);
  const u = (hl * ppm) / 1.05;
  ctx.save();
  ctx.translate(headC[0], headC[1]);
  ctx.rotate(-(a - 0.75));
  ctx.translate(-u * 0.35, 0);
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-u * 0.08, -u * 0.18);
  ctx.quadraticCurveTo(-u * 0.22, -u * 0.48, -u * 0.12, -u * 0.55);
  ctx.quadraticCurveTo(u * 0.02, -u * 0.38, u * 0.06, -u * 0.2);
  ctx.fill();
  const hg = ctx.createLinearGradient(0, -u * 0.25, 0, u * 0.28);
  hg.addColorStop(0, light);
  hg.addColorStop(1, mix(light, dark, 0.5));
  rimFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(-u * 0.12, -u * 0.2);
      ctx.bezierCurveTo(u * 0.2, -u * 0.26, u * 0.55, -u * 0.17, u * 0.78, -u * 0.06);
      ctx.bezierCurveTo(u * 0.9, 0, u * 0.88, u * 0.16, u * 0.72, u * 0.19);
      ctx.bezierCurveTo(u * 0.5, u * 0.22, u * 0.3, u * 0.2, u * 0.12, u * 0.3);
      ctx.bezierCurveTo(-u * 0.12, u * 0.36, -u * 0.24, u * 0.12, -u * 0.12, -u * 0.2);
      ctx.closePath();
    },
    hg,
    rim,
    u * 0.04,
    u * 0.05,
  );
  if (look.pattern >= 1.5) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(u * 0.45, -u * 0.13, u * 0.28, u * 0.05, 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = mane;
  ctx.lineWidth = u * 0.09;
  ctx.beginPath();
  ctx.moveTo(-u * 0.02, -u * 0.2);
  ctx.quadraticCurveTo(u * 0.12, -u * 0.22, u * 0.2, -u * 0.08);
  ctx.stroke();
  ctx.fillStyle = "#1a1214";
  ctx.beginPath();
  if (pose.fallen) {
    ctx.lineWidth = Math.max(1, u * 0.03);
    ctx.strokeStyle = "#1a1214";
    ctx.moveTo(u * 0.15, -u * 0.11);
    ctx.lineTo(u * 0.25, -u * 0.01);
    ctx.moveTo(u * 0.25, -u * 0.11);
    ctx.lineTo(u * 0.15, -u * 0.01);
    ctx.stroke();
  } else {
    ctx.ellipse(u * 0.2, -u * 0.06, u * 0.06, u * 0.05, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(u * 0.22, -u * 0.08, u * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgba("#1a1214", 0.6);
  ctx.beginPath();
  ctx.ellipse(u * 0.72, u * 0.04, u * 0.04, u * 0.025, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawLeg(false);

  const [bx, by] = topBack;
  return [bx + w * 2, by - w * 5];
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, rim: string): void {
  ctx.save();
  ctx.font = "600 15px 'Noto Sans SC', sans-serif";
  const tw = Math.max(26, ctx.measureText(text).width + 16);
  ctx.fillStyle = "rgba(255,250,240,0.92)";
  ctx.strokeStyle = rgba(rim, 0.9);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - tw / 2, y - 13, tw, 26, 13);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2a1b2e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}
