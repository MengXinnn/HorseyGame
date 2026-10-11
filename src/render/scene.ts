import { rgba, shade } from "./color";

/** 山水剪影：一天四个时段，每个时段一套天空、远山、雾和边缘光颜色。 */
export type TimeOfDay = "dawn" | "noon" | "dusk" | "night";

export interface Palette {
  sky: string[];
  sun: string;
  sunY: number;
  hills: [string, string, string, string];
  fog: string;
  ground: string;
  grass: string;
  rim: string;
  stars: number;
}

export const PALETTES: Record<TimeOfDay, Palette> = {
  dawn: { sky: ["#7f8fc4", "#e9b7b8", "#fbe0c4"], sun: "#fff1d6", sunY: 0.62, hills: ["#9a9cc7", "#8586b6", "#6d6c9c", "#55507d"], fog: "#f6d2c8", ground: "#4a4468", grass: "#5d5a7c", rim: "#ffd9b8", stars: 0 },
  noon: { sky: ["#5ea7dc", "#9fd0ec", "#e3f3f6"], sun: "#fffbea", sunY: 0.18, hills: ["#a6cfd0", "#7fb5b2", "#5b9890", "#3f7a6c"], fog: "#e6f4f1", ground: "#3d6f55", grass: "#4f8a63", rim: "#fff6dc", stars: 0 },
  dusk: { sky: ["#2a2154", "#9b4e78", "#f19763", "#f8d27f"], sun: "#ffe3a3", sunY: 0.66, hills: ["#b0607a", "#7f4673", "#563562", "#33244a"], fog: "#f2a07a", ground: "#2a1f3d", grass: "#3a2b4f", rim: "#ffc98a", stars: 0.25 },
  night: { sky: ["#070b22", "#141c46", "#2b3466"], sun: "#f3efe0", sunY: 0.2, hills: ["#2c3768", "#222b57", "#182046", "#0f1534"], fog: "#3a4680", ground: "#0c1129", grass: "#141a3a", rim: "#b9c7ff", stars: 1 },
};

export const TIME_LABELS: Record<TimeOfDay, string> = { dawn: "清晨", noon: "正午", dusk: "黄昏", night: "夜晚" };

function ridge(seed: number, x: number, amp: number, base: number): number {
  return base + amp * (0.5 * Math.sin(x * 0.0021 + seed) + 0.28 * Math.sin(x * 0.0057 + seed * 2.1) + 0.14 * Math.sin(x * 0.013 + seed * 3.7) + 0.08 * Math.sin(x * 0.031 + seed * 5.3));
}

const STARS: Array<[number, number, number, number]> = [];
for (let i = 0; i < 140; i++) {
  // 固定的伪随机星空，避免每帧闪烁位置。
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.678;
  STARS.push([a - Math.floor(a), (b - Math.floor(b)) * 0.6, 0.3 + ((i * 7) % 13) / 10, i * 0.7]);
}

export interface SceneInfo {
  groundY: number;
  rim: string;
}

/**
 * 画背景。scroll 是镜头的横向位置（像素），远山按视差系数移动。
 * groundRatio 决定地平线在画面中的高度。
 */
export function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, time: TimeOfDay, scroll: number, t: number, groundRatio = 0.8): SceneInfo {
  const T = PALETTES[time];
  const sky = ctx.createLinearGradient(0, 0, 0, H * groundRatio);
  T.sky.forEach((c, i) => sky.addColorStop(i / (T.sky.length - 1), c));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  if (T.stars > 0) {
    for (const s of STARS) {
      const a = T.stars * (0.45 + 0.55 * Math.sin(t * 0.002 + s[3]));
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,248,230,${a})`;
      ctx.beginPath();
      ctx.arc(s[0] * W, s[1] * H, s[2], 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const sx = W * 0.72;
  const sy = H * T.sunY;
  const sr = Math.min(W, H) * (time === "night" ? 0.045 : 0.07);
  const halo = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 7);
  halo.addColorStop(0, rgba(T.sun, 0.58));
  halo.addColorStop(1, rgba(T.sun, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = T.sun;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  if (time === "night") {
    ctx.fillStyle = T.sky[1] as string;
    ctx.beginPath();
    ctx.arc(sx + sr * 0.42, sy - sr * 0.2, sr * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  const gy = H * groundRatio;
  const layers = [
    { amp: gy * 0.37, base: gy * 0.58, par: 0.05, seed: 1.3, peak: true },
    { amp: gy * 0.22, base: gy * 0.72, par: 0.12, seed: 4.1, peak: false },
    { amp: gy * 0.11, base: gy * 0.83, par: 0.25, seed: 7.7, peak: false },
    { amp: gy * 0.06, base: gy * 0.92, par: 0.5, seed: 2.9, peak: false },
  ];
  layers.forEach((L, i) => {
    const off = scroll * L.par;
    ctx.fillStyle = T.hills[i] as string;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 8; x += 6) {
      let ry = ridge(L.seed, x + off, L.amp, L.base);
      if (L.peak) ry -= Math.pow(Math.max(0, Math.sin((x + off) * 0.0042 + 0.7)), 6) * L.amp * 0.9;
      ctx.lineTo(x, ry);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    const fog = ctx.createLinearGradient(0, L.base - L.amp * 0.2, 0, L.base + L.amp * 1.4);
    fog.addColorStop(0, rgba(T.fog, 0));
    fog.addColorStop(1, rgba(T.fog, i < 3 ? 0.55 - i * 0.12 : 0.18));
    ctx.fillStyle = fog;
    ctx.fillRect(0, L.base - L.amp, W, L.amp * 2.6);
    if (i === 1) {
      ctx.fillStyle = shade(T.hills[i] as string, -0.08);
      const step = 46;
      for (let px = -(off % step) - step; px < W + step; px += step) {
        const py = ridge(L.seed, px + off, L.amp, L.base);
        const h = 10 + 8 * Math.abs(Math.sin((px + off) * 0.37));
        ctx.beginPath();
        ctx.moveTo(px - 5, py + 2);
        ctx.lineTo(px, py - h);
        ctx.lineTo(px + 5, py + 2);
        ctx.fill();
      }
    }
  });

  const ground = ctx.createLinearGradient(0, gy, 0, H);
  ground.addColorStop(0, T.grass);
  ground.addColorStop(1, T.ground);
  ctx.fillStyle = ground;
  ctx.fillRect(0, gy, W, H - gy);
  return { groundY: gy, rim: T.rim };
}

/** 赛道前景：栏杆和草丛，按镜头位置 1:1 移动。 */
export function drawTrackDetails(ctx: CanvasRenderingContext2D, W: number, H: number, time: TimeOfDay, scroll: number, groundY: number, postEvery = 90): void {
  const T = PALETTES[time];
  ctx.strokeStyle = rgba(T.rim, 0.55);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY - 26);
  ctx.lineTo(W, groundY - 26);
  ctx.stroke();
  ctx.strokeStyle = rgba(T.rim, 0.35);
  ctx.lineWidth = 3;
  for (let fx = -mod(scroll, postEvery); fx < W; fx += postEvery) {
    ctx.beginPath();
    ctx.moveTo(fx, groundY - 30);
    ctx.lineTo(fx, groundY + 2);
    ctx.stroke();
  }
  ctx.strokeStyle = shade(T.grass, 0.12);
  ctx.lineWidth = 1.4;
  const tuft = 23;
  for (let tx = -mod(scroll * 1.3, tuft); tx < W; tx += tuft) {
    const ty = groundY + 14 + mod(Math.round(tx + scroll * 1.3) * 7.3, Math.max(10, H - groundY - 20));
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 3, ty - 7);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + 2, ty - 8);
    ctx.stroke();
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
