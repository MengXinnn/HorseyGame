/**
 * 大世界里的物件画法：房子、树、石头、围栏、相扑台、看台、人物。
 * 全部用透视投影画成「体块 + 边缘光」，和马的画风一致。
 */
import { mix, rgba, shade } from "../render/color";
import { pathFrom, project, projectPolygon, type Camera } from "./camera";
import type { Building, FenceLine, Prop } from "./map";

export interface Light {
  rim: string;
  /** 0 = 白天，1 = 深夜。 */
  night: number;
  /** 当前时间（秒），用来做摆动动画。 */
  t: number;
}

type P3 = readonly [number, number, number];

function poly(ctx: CanvasRenderingContext2D, cam: Camera, pts: P3[], fill: string): boolean {
  const sp = projectPolygon(
    cam,
    pts.map((p) => [p[0], p[2], p[1]] as [number, number, number]),
  );
  if (!pathFrom(ctx, sp)) return false;
  ctx.fillStyle = fill;
  ctx.fill();
  return true;
}

/* ---------------- 房子 ---------------- */

export function drawBuilding(ctx: CanvasRenderingContext2D, cam: Camera, b: Building, L: Light): void {
  const x0 = b.x - b.w / 2;
  const x1 = b.x + b.w / 2;
  const z0 = b.z;
  const z1 = b.z + b.d;
  const h = b.h;
  const wall = b.wall;
  const sideWall = shade(wall, -0.22);
  const o = b.style === "booth" ? 0.5 : 0.9; // 屋檐出挑
  const rh = b.style === "stand" ? 1.6 : b.style === "booth" ? 1.3 : b.h * 0.62; // 屋顶高

  // 地面上的影子。
  poly(ctx, cam, [[x0 - 0.4, 0, z0 - 0.6], [x1 + 0.8, 0, z0 - 0.6], [x1 + 1.4, 0, z1], [x0 - 0.4, 0, z1]], "rgba(0,0,0,0.18)");

  // 侧墙：房子在镜头右边就能看到它的左墙，反之亦然。
  if (b.x - cam.x > b.w / 2) poly(ctx, cam, [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], sideWall);
  else if (cam.x - b.x > b.w / 2) poly(ctx, cam, [[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], sideWall);

  if (b.style === "stand") {
    drawStand(ctx, cam, b, L);
    return;
  }

  // 正面墙。
  poly(ctx, cam, [[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]], wall);
  // 墙脚的石基。
  poly(ctx, cam, [[x0 - 0.1, 0, z0 - 0.05], [x1 + 0.1, 0, z0 - 0.05], [x1 + 0.1, 0.45, z0 - 0.05], [x0 - 0.1, 0.45, z0 - 0.05]], shade(wall, -0.45));

  // 红柱子。
  const pillar = b.style === "barn" ? shade(wall, -0.35) : "#8e3324";
  const pw = Math.min(0.32, b.w * 0.04);
  for (const px of [x0 + pw, x1 - pw, ...(b.w > 8 ? [b.x - b.w * 0.22, b.x + b.w * 0.22] : [])]) {
    poly(ctx, cam, [[px - pw / 2, 0, z0 - 0.08], [px + pw / 2, 0, z0 - 0.08], [px + pw / 2, h, z0 - 0.08], [px - pw / 2, h, z0 - 0.08]], pillar);
  }

  // 门和窗。夜里窗户透出暖光。
  const doorW = b.style === "barn" ? Math.min(3.2, b.w * 0.34) : b.style === "booth" ? b.w * 0.7 : 1.5;
  const doorH = b.style === "booth" ? h * 0.5 : Math.min(h * 0.72, 2.5);
  const doorY = b.style === "booth" ? h * 0.32 : 0;
  const glow = mix("#2a1d18", "#ffcf7a", L.night * 0.9);
  if (b.style === "booth") {
    // 摊位：柜台开口里是暗处，前面一块木柜台。
    poly(ctx, cam, [[b.x - doorW / 2, doorY, z0 - 0.02], [b.x + doorW / 2, doorY, z0 - 0.02], [b.x + doorW / 2, doorY + doorH, z0 - 0.02], [b.x - doorW / 2, doorY + doorH, z0 - 0.02]], mix("#2a1d18", "#ffcf7a", L.night * 0.6));
    poly(ctx, cam, [[x0 - 0.2, doorY - 0.05, z0 - 0.4], [x1 + 0.2, doorY - 0.05, z0 - 0.4], [x1 + 0.2, doorY + 0.12, z0 - 0.4], [x0 - 0.2, doorY + 0.12, z0 - 0.4]], "#5b3a22");
  } else {
    poly(ctx, cam, [[b.x - doorW / 2, 0, z0 - 0.03], [b.x + doorW / 2, 0, z0 - 0.03], [b.x + doorW / 2, doorH, z0 - 0.03], [b.x - doorW / 2, doorH, z0 - 0.03]], b.style === "barn" ? "#3b2418" : glow);
    if (b.style === "barn") {
      // 谷仓门上的交叉木条。
      const a = project(cam, b.x - doorW / 2, z0 - 0.04, 0);
      const c = project(cam, b.x + doorW / 2, z0 - 0.04, doorH);
      if (a && c) {
        ctx.strokeStyle = "#c79a62";
        ctx.lineWidth = Math.max(1, a.scale * 0.12);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.moveTo(a.x, c.y);
        ctx.lineTo(c.x, a.y);
        ctx.rect(a.x, c.y, c.x - a.x, a.y - c.y);
        ctx.stroke();
      }
    }
    const winW = 1.1;
    for (const wx of b.w > 6 ? [x0 + b.w * 0.2, x1 - b.w * 0.2] : []) {
      poly(ctx, cam, [[wx - winW / 2, 1.1, z0 - 0.03], [wx + winW / 2, 1.1, z0 - 0.03], [wx + winW / 2, 2.1, z0 - 0.03], [wx - winW / 2, 2.1, z0 - 0.03]], glow);
      // 窗格。
      const a = project(cam, wx - winW / 2, z0 - 0.04, 1.1);
      const c = project(cam, wx + winW / 2, z0 - 0.04, 2.1);
      if (a && c) {
        ctx.strokeStyle = "#4a2a1c";
        ctx.lineWidth = Math.max(1, a.scale * 0.06);
        ctx.beginPath();
        ctx.moveTo((a.x + c.x) / 2, a.y);
        ctx.lineTo((a.x + c.x) / 2, c.y);
        ctx.moveTo(a.x, (a.y + c.y) / 2);
        ctx.lineTo(c.x, (a.y + c.y) / 2);
        ctx.strokeRect(a.x, c.y, c.x - a.x, a.y - c.y);
        ctx.stroke();
      }
      if (L.night > 0.3) lightGlow(ctx, (a?.x ?? 0) + ((c?.x ?? 0) - (a?.x ?? 0)) / 2, ((a?.y ?? 0) + (c?.y ?? 0)) / 2, (a?.scale ?? 0) * 2.2, L.night);
    }
  }

  // 屋顶：飞檐翘角的歇山顶。
  drawRoof(ctx, cam, b, x0 - o, x1 + o, z0 - o, z1 + o, h, rh, L);

  // 招牌。
  if (b.sign) {
    const sy = b.style === "booth" ? h + rh * 0.25 : Math.min(h - 0.35, doorH + 0.75);
    const sz = b.style === "booth" ? z0 - o - 0.05 : z0 - 0.12;
    drawSign(ctx, cam, b.x, sz, sy, b.sign, b.style === "booth" ? 0.75 : 0.7);
  }
}

function drawRoof(ctx: CanvasRenderingContext2D, cam: Camera, b: Building, x0: number, x1: number, z0: number, z1: number, h: number, rh: number, L: Light): void {
  const roof = b.roof;
  const lift = b.style === "barn" ? 0.15 : 0.45; // 翘角
  const inset = (x1 - x0) * (b.style === "barn" ? 0 : 0.18);
  const zm = (z0 + z1) / 2;
  const top = h + rh;
  const front: P3[] = [[x0, h + lift, z0], [x1, h + lift, z0], [x1 - inset, top, zm], [x0 + inset, top, zm]];
  const back: P3[] = [[x0 + inset, top, zm], [x1 - inset, top, zm], [x1, h + lift, z1], [x0, h + lift, z1]];
  const left: P3[] = [[x0, h + lift, z0], [x0 + inset, top, zm], [x0, h + lift, z1]];
  const right: P3[] = [[x1, h + lift, z0], [x1, h + lift, z1], [x1 - inset, top, zm]];
  const camAbove = cam.height > top;
  if (camAbove) poly(ctx, cam, back, shade(roof, 0.12));
  if (b.x - cam.x > 0) poly(ctx, cam, left, shade(roof, -0.15));
  else poly(ctx, cam, right, shade(roof, -0.15));
  poly(ctx, cam, front, roof);
  // 瓦垄：几条竖线。
  const n = Math.max(3, Math.round((x1 - x0) / 0.8));
  ctx.strokeStyle = rgba(shade(roof, -0.4), 0.55);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ex = x0 + (x1 - x0) * t;
    const rx = x0 + inset + (x1 - x0 - 2 * inset) * t;
    const a = project(cam, ex, z0, h + lift * (Math.abs(t - 0.5) * 2) ** 3);
    const c = project(cam, rx, zm, top);
    if (!a || !c) continue;
    ctx.lineWidth = Math.max(0.6, a.scale * 0.05);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
  // 屋檐边缘光和屋脊。
  const e0 = project(cam, x0, z0, h + lift);
  const e1 = project(cam, x1, z0, h + lift);
  const em = project(cam, (x0 + x1) / 2, z0, h);
  if (e0 && e1 && em) {
    ctx.strokeStyle = rgba(L.rim, 0.75);
    ctx.lineWidth = Math.max(1, em.scale * 0.12);
    ctx.beginPath();
    ctx.moveTo(e0.x, e0.y);
    ctx.quadraticCurveTo(em.x, em.y + em.scale * 0.15, e1.x, e1.y);
    ctx.stroke();
  }
  const r0 = project(cam, x0 + inset - 0.3, zm, top + 0.12);
  const r1 = project(cam, x1 - inset + 0.3, zm, top + 0.12);
  if (r0 && r1) {
    ctx.strokeStyle = shade(roof, -0.5);
    ctx.lineWidth = Math.max(1.5, r0.scale * 0.28);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r0.x, r0.y - r0.scale * 0.25);
    ctx.lineTo(r0.x + (r1.x - r0.x) * 0.06, r0.y);
    ctx.lineTo(r1.x - (r1.x - r0.x) * 0.06, r1.y);
    ctx.lineTo(r1.x, r1.y - r1.scale * 0.25);
    ctx.stroke();
    ctx.lineCap = "butt";
  }
}

/** 木招牌：深色木框，金字。 */
export function drawSign(ctx: CanvasRenderingContext2D, cam: Camera, x: number, z: number, y: number, text: string, size: number): void {
  const p = project(cam, x, z, y);
  if (!p || p.scale < 3) return;
  const ch = size * p.scale;
  const w = ch * (text.length * 1.05 + 0.7);
  const hgt = ch * 1.35;
  ctx.fillStyle = "#3a2216";
  ctx.fillRect(p.x - w / 2 - ch * 0.12, p.y - hgt / 2 - ch * 0.12, w + ch * 0.24, hgt + ch * 0.24);
  const g = ctx.createLinearGradient(0, p.y - hgt / 2, 0, p.y + hgt / 2);
  g.addColorStop(0, "#7a4a2a");
  g.addColorStop(1, "#5a3420");
  ctx.fillStyle = g;
  ctx.fillRect(p.x - w / 2, p.y - hgt / 2, w, hgt);
  ctx.fillStyle = "#f2cf7e";
  ctx.font = `700 ${Math.round(ch)}px 'Ma Shan Zheng', 'Noto Serif SC', serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, p.x, p.y + ch * 0.05);
  ctx.textBaseline = "alphabetic";
}

/** 赛马场看台：阶梯座位、顶棚和彩旗。 */
function drawStand(ctx: CanvasRenderingContext2D, cam: Camera, b: Building, L: Light): void {
  const x0 = b.x - b.w / 2;
  const x1 = b.x + b.w / 2;
  const steps = 5;
  for (let i = steps - 1; i >= 0; i--) {
    const z = b.z + (i * b.d) / steps;
    const y = 0.6 + i * 0.75;
    poly(ctx, cam, [[x0, y - 0.75, z], [x1, y - 0.75, z], [x1, y, z], [x0, y, z]], shade(b.wall, -0.1 - i * 0.05));
    poly(ctx, cam, [[x0, y, z], [x1, y, z], [x1, y, z + b.d / steps], [x0, y, z + b.d / steps]], shade(b.wall, 0.08));
  }
  // 观众：一排排小点，傍晚开赛时更多。
  const crowd = 0.35 + 0.65 * (L.night > 0.05 && L.night < 0.6 ? 1 : 0.4);
  for (let i = 0; i < steps; i++) {
    const z = b.z + ((i + 0.5) * b.d) / steps;
    const y = 0.6 + i * 0.75 + 0.35;
    for (let k = 0; k < 40; k++) {
      if (((k * 37 + i * 11) % 100) / 100 > crowd) continue;
      const p = project(cam, x0 + 0.5 + (k / 40) * (b.w - 1), z, y);
      if (!p) continue;
      ctx.fillStyle = ["#c0533f", "#3e5f8a", "#e2b04a", "#5b8a5e", "#ead9c0"][(k + i) % 5] as string;
      ctx.beginPath();
      ctx.arc(p.x, p.y - p.scale * 0.1 * Math.abs(Math.sin(L.t * 3 + k)), Math.max(1, p.scale * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 顶棚。
  const top = 0.6 + steps * 0.75 + 1.6;
  poly(ctx, cam, [[x0 - 0.5, top, b.z - 0.6], [x1 + 0.5, top, b.z - 0.6], [x1 + 0.5, top + 0.9, b.z + b.d], [x0 - 0.5, top + 0.9, b.z + b.d]], b.roof);
  for (const px of [x0 + 0.2, b.x - b.w / 6, b.x + b.w / 6, x1 - 0.2]) {
    const a = project(cam, px, b.z - 0.4, 0);
    const c = project(cam, px, b.z - 0.4, top);
    if (!a || !c) continue;
    ctx.strokeStyle = "#5a3a26";
    ctx.lineWidth = Math.max(1, a.scale * 0.18);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
  // 顶棚边上的三角彩旗。
  const e0 = project(cam, x0 - 0.5, b.z - 0.6, top);
  const e1 = project(cam, x1 + 0.5, b.z - 0.6, top);
  if (e0 && e1) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const ax = e0.x + ((e1.x - e0.x) * i) / n;
      const bx = e0.x + ((e1.x - e0.x) * (i + 1)) / n;
      ctx.fillStyle = ["#e0563f", "#f2c14e", "#3f7fbf", "#efe6d2"][i % 4] as string;
      ctx.beginPath();
      ctx.moveTo(ax, e0.y);
      ctx.lineTo(bx, e0.y);
      ctx.lineTo((ax + bx) / 2, e0.y + e0.scale * 0.55);
      ctx.fill();
    }
  }
}

/* ---------------- 树、石头、灌木 ---------------- */

export function drawProp(ctx: CanvasRenderingContext2D, cam: Camera, prop: Prop, L: Light, grass: string): void {
  const p = project(cam, prop.x, prop.z, 0);
  if (!p) return;
  const s = p.scale * prop.size;
  if (s < 0.6) return;
  const leaf = mix(shade(grass, -0.35), "#1f3b34", 0.35 + prop.v * 0.3);
  switch (prop.kind) {
    case "pine": {
      shadowBlob(ctx, p.x, p.y, s * 1.6, s * 0.35);
      ctx.fillStyle = "#4a3426";
      ctx.fillRect(p.x - s * 0.13, p.y - s * 1.3, s * 0.26, s * 1.3);
      const tiers = 4;
      const hgt = 5.2 + prop.v * 2;
      for (let i = 0; i < tiers; i++) {
        const y0 = p.y - s * (1 + i * (hgt / tiers) * 0.8);
        const w = s * (2.2 - i * 0.42);
        const th = s * (hgt / tiers) * 1.25;
        ctx.fillStyle = shade(leaf, i * 0.05);
        ctx.beginPath();
        ctx.moveTo(p.x - w, y0);
        ctx.quadraticCurveTo(p.x - w * 0.3, y0 - th * 0.35, p.x, y0 - th);
        ctx.quadraticCurveTo(p.x + w * 0.3, y0 - th * 0.35, p.x + w, y0);
        ctx.quadraticCurveTo(p.x, y0 + th * 0.12, p.x - w, y0);
        ctx.fill();
        // 背光一侧的暖色描边。
        ctx.strokeStyle = rgba(L.rim, 0.35);
        ctx.lineWidth = Math.max(0.6, s * 0.08);
        ctx.beginPath();
        ctx.moveTo(p.x, y0 - th);
        ctx.quadraticCurveTo(p.x + w * 0.3, y0 - th * 0.35, p.x + w, y0);
        ctx.stroke();
      }
      break;
    }
    case "willow": {
      shadowBlob(ctx, p.x, p.y, s * 2, s * 0.4);
      ctx.strokeStyle = "#4b3a2c";
      ctx.lineWidth = s * 0.3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x - s * 0.3, p.y - s * 2, p.x + s * 0.2, p.y - s * 3.6);
      ctx.stroke();
      const sway = Math.sin(L.t * 0.8 + prop.v * 6) * s * 0.15;
      ctx.fillStyle = mix(leaf, "#7c9a5a", 0.35);
      ctx.beginPath();
      ctx.ellipse(p.x + s * 0.2, p.y - s * 3.8, s * 2.2, s * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mix(leaf, "#9fbf72", 0.4);
      ctx.lineWidth = Math.max(0.6, s * 0.1);
      for (let i = 0; i < 9; i++) {
        const bx = p.x - s * 1.8 + (i / 8) * s * 4;
        ctx.beginPath();
        ctx.moveTo(bx, p.y - s * 3.9);
        ctx.quadraticCurveTo(bx + sway, p.y - s * 2.6, bx + sway * 1.6, p.y - s * (1.4 + (i % 3) * 0.3));
        ctx.stroke();
      }
      break;
    }
    case "bush": {
      shadowBlob(ctx, p.x, p.y, s * 1.2, s * 0.3);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = shade(leaf, 0.06 * i);
        ctx.beginPath();
        ctx.arc(p.x + (i - 1) * s * 0.6, p.y - s * (0.5 + (i % 2) * 0.25), s * (0.7 - i * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = rgba(L.rim, 0.3);
      ctx.lineWidth = Math.max(0.5, s * 0.07);
      ctx.beginPath();
      ctx.arc(p.x + s * 0.6, p.y - s * 0.5, s * 0.6, -1.4, 0.2);
      ctx.stroke();
      break;
    }
    case "rock": {
      shadowBlob(ctx, p.x, p.y, s * 1.1, s * 0.25);
      ctx.fillStyle = mix("#7d7c86", "#5b5a66", prop.v);
      ctx.beginPath();
      ctx.moveTo(p.x - s * 0.9, p.y);
      ctx.quadraticCurveTo(p.x - s * 0.8, p.y - s * 0.8, p.x - s * 0.1, p.y - s * 0.9);
      ctx.quadraticCurveTo(p.x + s * 0.8, p.y - s * 0.7, p.x + s * 0.9, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(L.rim, 0.25);
      ctx.beginPath();
      ctx.moveTo(p.x - s * 0.1, p.y - s * 0.9);
      ctx.quadraticCurveTo(p.x + s * 0.8, p.y - s * 0.7, p.x + s * 0.9, p.y);
      ctx.lineTo(p.x + s * 0.6, p.y);
      ctx.quadraticCurveTo(p.x + s * 0.5, p.y - s * 0.6, p.x - s * 0.1, p.y - s * 0.9);
      ctx.fill();
      break;
    }
    case "reed": {
      ctx.strokeStyle = mix(leaf, "#b9b06a", 0.4);
      ctx.lineWidth = Math.max(0.5, s * 0.06);
      for (let i = 0; i < 6; i++) {
        const bx = p.x + (i - 3) * s * 0.25;
        const sw = Math.sin(L.t * 1.3 + i + prop.v * 5) * s * 0.12;
        ctx.beginPath();
        ctx.moveTo(bx, p.y);
        ctx.quadraticCurveTo(bx + sw, p.y - s * 0.8, bx + sw * 2, p.y - s * (1.2 + (i % 3) * 0.2));
        ctx.stroke();
      }
      break;
    }
    case "lantern": {
      ctx.strokeStyle = "#3a2618";
      ctx.lineWidth = Math.max(1, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - s * 2.4);
      ctx.lineTo(p.x + s * 0.5, p.y - s * 2.4);
      ctx.stroke();
      const ly = p.y - s * 2.1;
      ctx.fillStyle = mix("#a8322a", "#ff7a4a", L.night);
      ctx.beginPath();
      ctx.ellipse(p.x + s * 0.5, ly, s * 0.28, s * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      if (L.night > 0.2) lightGlow(ctx, p.x + s * 0.5, ly, s * 3.2, L.night);
      break;
    }
    case "post": {
      ctx.fillStyle = "#5a3a26";
      ctx.fillRect(p.x - s * 0.1, p.y - s * 1.6, s * 0.2, s * 1.6);
      ctx.fillStyle = "#d9c49a";
      ctx.fillRect(p.x - s * 0.6, p.y - s * 1.9, s * 1.2, s * 0.8);
      ctx.strokeStyle = "#5a3a26";
      ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.strokeRect(p.x - s * 0.6, p.y - s * 1.9, s * 1.2, s * 0.8);
      ctx.fillStyle = "#3a2618";
      for (let i = 0; i < 3; i++) ctx.fillRect(p.x - s * 0.45, p.y - s * (1.75 - i * 0.22), s * (0.9 - i * 0.2), Math.max(1, s * 0.05));
      break;
    }
    case "flag": {
      ctx.strokeStyle = "#e9e1d0";
      ctx.lineWidth = Math.max(1, s * 0.1);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - s * 9);
      ctx.stroke();
      const wave = Math.sin(L.t * 3 + prop.v * 7);
      ctx.fillStyle = ["#d9473a", "#f2c14e", "#3f7fbf"][Math.floor(prop.v * 3)] as string;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s * 9);
      ctx.quadraticCurveTo(p.x + s * 1, p.y - s * (8.8 + wave * 0.3), p.x + s * 2, p.y - s * 8.5);
      ctx.lineTo(p.x, p.y - s * 7.8);
      ctx.fill();
      break;
    }
  }
}

export function shadowBlob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function lightGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number): void {
  if (r < 1) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,200,120,${0.55 * k})`);
  g.addColorStop(1, "rgba(255,170,90,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/* ---------------- 围栏 ---------------- */

/** 围栏拆成一段一段，按深度和别的物件一起排序画。 */
export interface FenceSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  color: string;
  height: number;
}

export function fenceSegments(fences: FenceLine[]): FenceSeg[] {
  const segs: FenceSeg[] = [];
  for (const f of fences) {
    const n = f.pts.length;
    const count = f.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = f.pts[i]!;
      const b = f.pts[(i + 1) % n]!;
      // 长边再细分，排序更准。
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const parts = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < parts; k++) {
        const t0 = k / parts;
        const t1 = (k + 1) / parts;
        segs.push({ ax: a[0] + (b[0] - a[0]) * t0, az: a[1] + (b[1] - a[1]) * t0, bx: a[0] + (b[0] - a[0]) * t1, bz: a[1] + (b[1] - a[1]) * t1, color: f.color, height: f.height });
      }
    }
  }
  return segs;
}

export function drawFenceSeg(ctx: CanvasRenderingContext2D, cam: Camera, f: FenceSeg, L: Light): void {
  const a0 = project(cam, f.ax, f.az, 0);
  const b0 = project(cam, f.bx, f.bz, 0);
  if (!a0 || !b0) return;
  const a1 = project(cam, f.ax, f.az, f.height) as { x: number; y: number; scale: number };
  const b1 = project(cam, f.bx, f.bz, f.height) as { x: number; y: number; scale: number };
  const am = project(cam, f.ax, f.az, f.height * 0.55) as { x: number; y: number; scale: number };
  const bm = project(cam, f.bx, f.bz, f.height * 0.55) as { x: number; y: number; scale: number };
  const dark = shade(f.color, -0.35);
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, a0.scale * 0.14);
  ctx.beginPath();
  ctx.moveTo(a0.x, a0.y);
  ctx.lineTo(a1.x, a1.y - a0.scale * 0.1);
  ctx.stroke();
  ctx.strokeStyle = f.color;
  ctx.lineWidth = Math.max(1, ((a0.scale + b0.scale) / 2) * 0.1);
  ctx.beginPath();
  ctx.moveTo(a1.x, a1.y);
  ctx.lineTo(b1.x, b1.y);
  ctx.moveTo(am.x, am.y);
  ctx.lineTo(bm.x, bm.y);
  ctx.stroke();
  ctx.strokeStyle = rgba(L.rim, 0.35);
  ctx.lineWidth = Math.max(0.5, a0.scale * 0.03);
  ctx.beginPath();
  ctx.moveTo(a1.x, a1.y - a0.scale * 0.04);
  ctx.lineTo(b1.x, b1.y - b0.scale * 0.04);
  ctx.stroke();
}

/* ---------------- 相扑台 ---------------- */

export function drawRing(ctx: CanvasRenderingContext2D, cam: Camera, x: number, z: number, r: number, L: Light): void {
  const n = 36;
  const h = 0.6;
  const ring = (rad: number, y: number): P3[] => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [x + Math.cos(a) * rad, y, z + Math.sin(a) * rad] as P3;
  });
  // 台子侧面（前半圈）。
  const side: P3[] = [];
  for (let i = 0; i <= n / 2; i++) {
    const a = Math.PI + (i / (n / 2)) * Math.PI;
    side.push([x + Math.cos(a) * (r + 0.6), h, z + Math.sin(a) * (r + 0.6)]);
  }
  for (let i = n / 2; i >= 0; i--) {
    const a = Math.PI + (i / (n / 2)) * Math.PI;
    side.push([x + Math.cos(a) * (r + 0.8), 0, z + Math.sin(a) * (r + 0.8)]);
  }
  poly(ctx, cam, side, "#8a6a46");
  poly(ctx, cam, ring(r + 0.6, h), "#cdb183");
  poly(ctx, cam, ring(r, h + 0.01), "#d9c296");
  // 草绳圈。
  const pts = projectPolygon(cam, ring(r, h + 0.05).map((p) => [p[0], p[2], p[1]] as [number, number, number]));
  if (pathFrom(ctx, pts)) {
    const c = project(cam, x, z, h);
    ctx.strokeStyle = "#8f7a3c";
    ctx.lineWidth = Math.max(1, (c?.scale ?? 4) * 0.22);
    ctx.stroke();
  }
  // 两条白色起手线。
  for (const dx of [-0.8, 0.8]) {
    const a = project(cam, x + dx, z - 0.5, h + 0.02);
    const b = project(cam, x + dx, z + 0.5, h + 0.02);
    if (!a || !b) continue;
    ctx.strokeStyle = "#f5efe2";
    ctx.lineWidth = Math.max(1, a.scale * 0.12);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // 四角的旗杆，挂着红白幡。
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const px = x + dx * (r + 0.4);
    const pz = z + dz * (r + 0.4);
    const a = project(cam, px, pz, 0);
    const b = project(cam, px, pz, 4.2);
    if (!a || !b) continue;
    ctx.strokeStyle = "#5a3a26";
    ctx.lineWidth = Math.max(1, a.scale * 0.12);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const wave = Math.sin(L.t * 2 + dx + dz * 2) * a.scale * 0.1;
    ctx.fillStyle = dz < 0 ? "#c8402f" : "#efe6d2";
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x + a.scale * 0.6 * -dx + wave, b.y + a.scale * 0.2);
    ctx.lineTo(b.x + a.scale * 0.5 * -dx + wave, b.y + a.scale * 1.6);
    ctx.lineTo(b.x, b.y + a.scale * 1.5);
    ctx.fill();
  }
}

/* ---------------- 桥 ---------------- */

export function drawBridge(ctx: CanvasRenderingContext2D, cam: Camera, x0: number, x1: number, z0: number, z1: number, L: Light): void {
  poly(ctx, cam, [[x0, 0.25, z0 - 1], [x1, 0.25, z0 - 1], [x1, 0.25, z1 + 1], [x0, 0.25, z1 + 1]], "#8a6440");
  for (let z = z0 - 1; z < z1 + 1; z += 0.6) {
    const a = project(cam, x0, z, 0.26);
    const b = project(cam, x1, z, 0.26);
    if (!a || !b) continue;
    ctx.strokeStyle = "rgba(50,30,18,0.5)";
    ctx.lineWidth = Math.max(0.5, a.scale * 0.04);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const x of [x0, x1]) {
    drawFenceSeg(ctx, cam, { ax: x, az: z0 - 1, bx: x, bz: z1 + 1, color: "#9a2f25", height: 1.2 }, L);
  }
}

/* ---------------- 人物 ---------------- */

export interface PersonLook {
  robe: string;
  hat: "straw" | "cap" | "none" | "bun";
  skin: string;
  /** 体型：1 正常，>1 壮。 */
  build: number;
  beard?: boolean;
}

export const PLAYER_LOOK: PersonLook = { robe: "#2f4f7a", hat: "straw", skin: "#e9c39b", build: 1 };

/** 画一个人：x,y 是脚底的屏幕位置，s 是每米像素，walk 是走路相位，facing 朝向。 */
export function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, look: PersonLook, walk: number, facing: 1 | -1, L: Light, moving: boolean): void {
  if (s < 1) return;
  shadowBlob(ctx, x, y, s * 0.45 * look.build, s * 0.12);
  const swing = moving ? Math.sin(walk) * 0.35 : 0;
  const bob = moving ? Math.abs(Math.cos(walk)) * s * 0.05 : 0;
  const hip = y - s * 0.85 - bob;
  // 腿
  ctx.strokeStyle = shade(look.robe, -0.45);
  ctx.lineWidth = s * 0.16 * look.build;
  ctx.lineCap = "round";
  for (const k of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(x + k * s * 0.08, hip);
    ctx.lineTo(x + k * s * 0.08 + Math.sin(swing * k) * s * 0.45 * facing, y - s * 0.05);
    ctx.stroke();
  }
  // 身体（长袍）
  const w = s * 0.32 * look.build;
  ctx.fillStyle = look.robe;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.8, y - s * 0.6 - bob);
  ctx.lineTo(x - w, hip - s * 0.65);
  ctx.quadraticCurveTo(x, hip - s * 0.8, x + w, hip - s * 0.65);
  ctx.lineTo(x + w * 0.8, y - s * 0.6 - bob);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(look.robe, -0.25);
  ctx.fillRect(x - w * 0.85, hip - s * 0.08, w * 1.7, s * 0.1);
  ctx.strokeStyle = rgba(L.rim, 0.5);
  ctx.lineWidth = Math.max(0.6, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(x + w * facing, hip - s * 0.65);
  ctx.lineTo(x + w * 0.8 * facing, y - s * 0.6 - bob);
  ctx.stroke();
  // 手臂
  ctx.strokeStyle = shade(look.robe, -0.1);
  ctx.lineWidth = s * 0.13 * look.build;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.7 * facing, hip - s * 0.55);
  ctx.lineTo(x + w * 0.9 * facing - Math.sin(swing) * s * 0.3 * facing, hip - s * 0.05);
  ctx.stroke();
  ctx.lineCap = "butt";
  // 头
  const hy = hip - s * 0.95;
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(x + s * 0.03 * facing, hy, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
  if (look.beard) {
    ctx.fillStyle = "#3a2e2a";
    ctx.beginPath();
    ctx.arc(x + s * 0.06 * facing, hy + s * 0.08, s * 0.12, 0, Math.PI);
    ctx.fill();
  }
  // 帽子
  if (look.hat === "straw") {
    ctx.fillStyle = "#d8b56a";
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, hy - s * 0.04);
    ctx.lineTo(x, hy - s * 0.42);
    ctx.lineTo(x + s * 0.5, hy - s * 0.04);
    ctx.quadraticCurveTo(x, hy + s * 0.02, x - s * 0.5, hy - s * 0.04);
    ctx.fill();
    ctx.strokeStyle = rgba(L.rim, 0.6);
    ctx.lineWidth = Math.max(0.6, s * 0.04);
    ctx.beginPath();
    ctx.moveTo(x, hy - s * 0.42);
    ctx.lineTo(x + s * 0.5, hy - s * 0.04);
    ctx.stroke();
  } else if (look.hat === "cap") {
    ctx.fillStyle = "#2a2a30";
    ctx.beginPath();
    ctx.arc(x, hy - s * 0.06, s * 0.18, Math.PI, 0);
    ctx.fill();
  } else if (look.hat === "bun") {
    ctx.fillStyle = "#2a2226";
    ctx.beginPath();
    ctx.arc(x, hy - s * 0.12, s * 0.17, Math.PI, 0);
    ctx.arc(x - s * 0.02 * facing, hy - s * 0.28, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
}
