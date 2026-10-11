/**
 * 看台上的人群：一个人三个像素宽，头、身子、偶尔举手或者摇小旗；
 * 越靠近比赛的热闹处，跳得越欢。都在缓冲像素坐标里画（调用方先 setTransform 回 1:1）。
 */
import { hashSeed } from "../sim/rng";
import { mix } from "./color";

type Ctx = CanvasRenderingContext2D;

const SHIRTS = ["#d8443a", "#3f7fd0", "#f2b632", "#4fa64a", "#f4ead2", "#8a4ab0", "#e87a3a", "#2a8a8a", "#c9302a", "#f19ab0"];
const SKINS = ["#f0c8a4", "#d8a77e", "#e8b48a", "#c08a5e"];
const HAIR = ["#2a1a12", "#3a2414", "#5a3a22", "#1e1a18", "#8a6a3a"];
const HATS = ["#c99a4a", "#c9302a", "#3f6fb0", "#f4ead2"];
const FLAGS = ["#d8443a", "#f2b632", "#3f7fd0", "#4fa64a"];

export interface CrowdOpts {
  /** 画在屏幕上的左右范围（缓冲像素）。 */
  x0: number;
  x1: number;
  /** 最前一排人脚下的 y。 */
  base: number;
  rows: number;
  /** 人群坐标到屏幕的偏移：屏幕 x = 位置 - offset。 */
  offset: number;
  time: number;
  /** 某个屏幕 x 处的兴奋程度 0..1。 */
  cheer: (x: number) => number;
  seed: string;
  /** 远处的雾色和混进去的比例。 */
  haze: string;
  hazeAmount: number;
  /** 坐在台阶上（有木头台阶），还是站着。 */
  seats: boolean;
  density?: number;
  /** 每排的高度（像素）。 */
  rowH?: number;
}

const tintCache = new Map<string, string>();
function tint(c: string, haze: string, k: number): string {
  const key = `${c}|${haze}|${k}`;
  let v = tintCache.get(key);
  if (!v) {
    if (tintCache.size > 4000) tintCache.clear();
    v = mix(c, haze, k);
    tintCache.set(key, v);
  }
  return v;
}

export function drawCrowd(ctx: Ctx, o: CrowdOpts): void {
  const rowH = o.rowH ?? 6;
  const density = o.density ?? 0.8;
  const t = o.time;
  const step = (o.seats ? "#8a5a32" : "") as string;
  for (let r = o.rows - 1; r >= 0; r--) {
    const y = Math.round(o.base - r * rowH);
    const hz = Math.min(0.85, o.hazeAmount + r * 0.04);
    if (o.seats) {
      // 台阶：一条亮的踏面，下面一截暗的立面。
      ctx.fillStyle = tint("#c08a4a", o.haze, hz);
      ctx.fillRect(Math.floor(o.x0), y - 1, Math.ceil(o.x1 - o.x0), 1);
      ctx.fillStyle = tint(step, o.haze, hz);
      ctx.fillRect(Math.floor(o.x0), y, Math.ceil(o.x1 - o.x0), rowH - 1);
    }
    const first = Math.floor((o.x0 + o.offset) / 4) - 1;
    const last = Math.ceil((o.x1 + o.offset) / 4) + 1;
    for (let i = first; i <= last; i++) {
      const h = hashSeed(`${o.seed}:${r}:${i}`);
      if ((h % 1000) / 1000 > density) continue;
      const x = Math.round(i * 4 - o.offset + ((h >>> 10) % 2));
      if (x < o.x0 - 3 || x > o.x1) continue;
      const e = o.cheer(x);
      const phase = Math.sin(t * (7 + ((h >>> 4) % 5)) + (h % 97));
      const jump = e > 0.25 && phase > 0.2 ? 1 : 0;
      const arms = e > 0.15 && ((h >>> 7) % 3 === 0 || (e > 0.6 && phase > -0.4));
      const yy = y - 1 - jump - ((h >>> 3) % 2 === 0 && !o.seats ? 1 : 0);
      const shirt = tint(SHIRTS[(h >>> 5) % SHIRTS.length]!, o.haze, hz);
      const skin = tint(SKINS[(h >>> 9) % SKINS.length]!, o.haze, hz);
      // 身子
      ctx.fillStyle = shirt;
      ctx.fillRect(x, yy - 3, 3, 3);
      // 头
      ctx.fillStyle = skin;
      ctx.fillRect(x, yy - 5, 3, 2);
      if (arms) {
        ctx.fillRect(x - 1, yy - 6 - (phase > 0.6 ? 1 : 0), 1, 2);
        ctx.fillRect(x + 3, yy - 6 - (phase < -0.2 ? 1 : 0), 1, 2);
      }
      // 头发或帽子
      const hat = (h >>> 12) % 6 === 0;
      ctx.fillStyle = tint(hat ? HATS[(h >>> 14) % HATS.length]! : HAIR[(h >>> 14) % HAIR.length]!, o.haze, hz);
      ctx.fillRect(hat ? x - 1 : x, yy - 6, hat ? 5 : 3, 1);
      // 偶尔有人举着小旗。
      if ((h >>> 16) % 11 === 0) {
        const wave = e > 0.2 && Math.sin(t * 9 + i) > 0 ? 1 : 0;
        ctx.fillStyle = tint("#5a4632", o.haze, hz);
        ctx.fillRect(x + 3, yy - 10, 1, 5);
        ctx.fillStyle = tint(FLAGS[(h >>> 18) % FLAGS.length]!, o.haze, hz);
        ctx.fillRect(x + 4, yy - 10 + wave, 3, 2);
      }
    }
  }
}
