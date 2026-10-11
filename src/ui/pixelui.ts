/**
 * 界面的像素边框：木框、纸片、格子、按钮，开场时用画布画成小图，
 * 交给 CSS 的 border-image 九宫格拉伸，再用 pixelated 放大，保持方块感。
 */
import { canvas, iconURL, type IconId } from "../world/sprites";

type Ctx = CanvasRenderingContext2D;

interface FrameSpec {
  size: number;
  /** 从外往里一圈一圈的颜色；数组表示 [上左, 下右] 两种。 */
  rings: Array<string | [string, string]>;
  fill: string;
  /** 外圈切掉的角（像素）。 */
  corner?: number;
  /** 角上的铆钉。 */
  rivet?: { at: number; color: string };
  /** 底部额外一道阴影，按钮的厚度。 */
  lip?: { color: string; h: number };
}

function frame(spec: FrameSpec): string {
  const { size: n } = spec;
  const [c, ctx] = canvas(n, n);
  const lip = spec.lip?.h ?? 0;
  spec.rings.forEach((ring, i) => {
    const [tl, br] = typeof ring === "string" ? [ring, ring] : ring;
    const w = n - i * 2;
    const h = n - i * 2 - lip;
    ctx.fillStyle = br;
    ctx.fillRect(i, i, w, h);
    ctx.fillStyle = tl;
    ctx.fillRect(i, i, w - 1, 1);
    ctx.fillRect(i, i, 1, h - 1);
  });
  const k = spec.rings.length;
  ctx.fillStyle = spec.fill;
  ctx.fillRect(k, k, n - k * 2, n - k * 2 - lip);
  if (spec.lip) {
    ctx.fillStyle = spec.rings[0] as string;
    ctx.fillRect(1, n - lip, n - 2, lip);
    ctx.fillStyle = spec.lip.color;
    ctx.fillRect(1, n - lip - 1, n - 2, lip);
    ctx.fillRect(0, n - lip - 1, 1, lip - 1);
    ctx.fillRect(n - 1, n - lip - 1, 1, lip - 1);
  }
  cutCorners(ctx, n, spec.corner ?? 1);
  if (spec.rivet) {
    const { at, color } = spec.rivet;
    for (const [x, y] of [
      [at, at],
      [n - at - 2, at],
      [at, n - at - 2 - lip],
      [n - at - 2, n - at - 2 - lip],
    ] as const) {
      ctx.fillStyle = "#3b1c0e";
      ctx.fillRect(x, y + 1, 2, 2);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  return c.toDataURL();
}

function cutCorners(ctx: Ctx, n: number, r: number): void {
  for (let i = 0; i < r; i++) {
    const len = r - i;
    ctx.clearRect(0, i, len, 1);
    ctx.clearRect(n - len, i, len, 1);
    ctx.clearRect(0, n - 1 - i, len, 1);
    ctx.clearRect(n - len, n - 1 - i, len, 1);
  }
}

const OUT = "#3b1c0e";

/** 生成全部边框，挂到 :root 上做 CSS 变量。 */
export function installPixelUI(): void {
  const frames: Record<string, string> = {
    // 菜单大木框：粗木边、四角铆钉、里面一张浅黄的纸。
    menu: frame({
      size: 24,
      corner: 2,
      rings: [OUT, ["#f0a850", "#9a4416"], "#d47a2e", ["#c06a26", "#c06a26"], ["#8a3c12", "#e8a048"], OUT, ["#d9a865", "#fbe6b8"]],
      fill: "#f7d79e",
      rivet: { at: 2, color: "#f6d05a" },
    }),
    // 纸条：提示、气泡、对话正文。
    paper: frame({ size: 12, corner: 1, rings: [OUT, ["#fff6dc", "#d9a865"]], fill: "#fbe6b8" }),
    // 道具格：凹下去的方格。
    slot: frame({ size: 12, corner: 1, rings: ["#9a5a2a", ["#c98d4c", "#f7d79e"]], fill: "#efc27e" }),
    slotOn: frame({ size: 12, corner: 1, rings: ["#d8402a", ["#f6d05a", "#f6d05a"]], fill: "#fbe6b8" }),
    // 厚按钮：木头面、底下一道厚边。
    btn: frame({ size: 14, corner: 1, rings: [OUT, ["#ffd890", "#c06a26"]], fill: "#e8a048", lip: { color: "#8a3c12", h: 3 } }),
    btnHover: frame({ size: 14, corner: 1, rings: [OUT, ["#ffe6b0", "#d47a2e"]], fill: "#f6b860", lip: { color: "#8a3c12", h: 3 } }),
    btnGo: frame({ size: 14, corner: 1, rings: [OUT, ["#c8f08a", "#4a8a2a"]], fill: "#7cc04a", lip: { color: "#2e5a1a", h: 3 } }),
    btnGoHover: frame({ size: 14, corner: 1, rings: [OUT, ["#dcf8a8", "#5a9a34"]], fill: "#92d25a", lip: { color: "#2e5a1a", h: 3 } }),
    btnRed: frame({ size: 14, corner: 1, rings: [OUT, ["#ff9a80", "#9a2a1a"]], fill: "#d8483a", lip: { color: "#5a1a10", h: 3 } }),
    btnOff: frame({ size: 14, corner: 1, rings: ["#6a5040", ["#cdb898", "#9a8670"]], fill: "#b8a488", lip: { color: "#6a5040", h: 3 } }),
    // 木牌：标题、标签。
    plank: frame({ size: 12, corner: 1, rings: [OUT, ["#e8a048", "#7a3410"]], fill: "#b45e22", rivet: { at: 2, color: "#f6d05a" } }),
    // 深色数字格：钱袋里的金字。
    cell: frame({ size: 8, corner: 1, rings: [OUT, ["#1e0e06", "#6a3a1e"]], fill: "#4a2414" }),
    // 红色小印签。
    seal: frame({ size: 8, corner: 1, rings: ["#7a1a10", ["#f06a50", "#a8281a"]], fill: "#d23a2a" }),
  };
  const root = document.documentElement.style;
  for (const [k, url] of Object.entries(frames)) root.setProperty(`--f-${k}`, `url(${url})`);
  const icons: IconId[] = ["rope", "horse", "coin", "sun", "moon", "flag", "ring", "crown", "star", "close", "heart", "dna", "scroll", "shoe", "menu", "ticket", "tag", "bag", "clock"];
  for (const id of icons) root.setProperty(`--i-${id}`, `url(${iconURL(id)})`);
}

/** 像素图标的 HTML。 */
export const ico = (id: IconId, cls = ""): string => `<i class="ico ico-${id}${cls ? ` ${cls}` : ""}" style="background-image:var(--i-${id})"></i>`;

/**
 * 钟盘：左半圆，指针从正上方（早上六点）往左转到正下方（半夜）。
 * 白天天蓝、傍晚橘红、夜里深蓝，每次刷新重画，指针是一条像素线。
 */
export function drawDial(c: HTMLCanvasElement, t: number): void {
  const ctx = c.getContext("2d") as Ctx;
  const W = c.width;
  const H = c.height;
  const cx = W - 1;
  const cy = Math.floor(H / 2);
  const R = Math.min(W - 2, cy - 1);
  ctx.clearRect(0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const put = (x: number, y: number, hex: string): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    d[i] = parseInt(hex.slice(1, 3), 16);
    d[i + 1] = parseInt(hex.slice(3, 5), 16);
    d[i + 2] = parseInt(hex.slice(5, 7), 16);
    d[i + 3] = 255;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r > R + 1 || dx > 0.5) continue;
      if (r > R) {
        put(x, y, "#3b1c0e");
        continue;
      }
      if (r > R - 1.2) {
        put(x, y, "#f0a850");
        continue;
      }
      // 这个像素对应的钟点 0..1
      const at = Math.atan2(-dx, -dy) / Math.PI;
      const sky = at < 0.6 ? (r < R * 0.55 ? "#bfe8f6" : "#8ed0ee") : at < 0.72 ? (r < R * 0.55 ? "#f8b870" : "#e8784a") : r < R * 0.55 ? "#4a5a9a" : "#2c3466";
      put(x, y, sky);
    }
  ctx.putImageData(img, 0, 0);
  // 太阳、月亮
  const mark = (at: number, rr: number): [number, number] => [Math.round(cx - Math.sin(Math.PI * at) * rr), Math.round(cy - Math.cos(Math.PI * at) * rr)];
  const [sx, sy] = mark(0.3, R * 0.62);
  ctx.fillStyle = "#f6c84a";
  ctx.fillRect(sx - 2, sy - 1, 4, 2);
  ctx.fillRect(sx - 1, sy - 2, 2, 4);
  const [mx, my] = mark(0.86, R * 0.62);
  ctx.fillStyle = "#f4ecc8";
  ctx.fillRect(mx - 1, my - 2, 2, 4);
  ctx.fillRect(mx - 2, my - 1, 1, 2);
  // 指针
  const tt = Math.max(0, Math.min(1, t));
  const ex = cx - Math.sin(Math.PI * tt) * (R - 2);
  const ey = cy - Math.cos(Math.PI * tt) * (R - 2);
  const steps = Math.ceil(Math.max(Math.abs(ex - cx), Math.abs(ey - cy)));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) pts.push([Math.round(cx + ((ex - cx) * i) / steps - 0.5), Math.round(cy + ((ey - cy) * i) / steps - 0.5)]);
  ctx.fillStyle = "#3b1c0e";
  for (const [x, y] of pts) ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = "#e8402a";
  for (const [x, y] of pts) ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = "#3b1c0e";
  ctx.fillRect(cx - 3, cy - 3, 4, 6);
  ctx.fillStyle = "#f6d05a";
  ctx.fillRect(cx - 2, cy - 2, 2, 4);
}
