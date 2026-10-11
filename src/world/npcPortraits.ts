/**
 * 剧情角色的对话头像（48×48 美术像素），和 sprites.ts 里老赵、马董的头像同一个画法。
 * 画一次缓存成 data URL。
 */
import { canvas, outline } from "./sprites";

type Ctx = CanvasRenderingContext2D;

export type NpcId = "atao" | "xiaobai" | "qiansi" | "mia" | "kdr";

/** 对白里的名字对应哪张头像。 */
export const NPC_BY_NAME: Record<string, NpcId> = { 阿桃: "atao", 小白: "xiaobai", 钱四: "qiansi", 米娅: "mia", K博士: "kdr" };

const px = (ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1): void => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

function blob(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) px(ctx, cx + x, cy + y, color);
}

const SKIN = "#f0c49a";
const EYE = "#2a1a12";

/** 脸、眼睛、嘴：每个人都一样的部分。 */
function face(ctx: Ctx, skin = SKIN): void {
  blob(ctx, 24, 22, 11, skin);
  px(ctx, 18, 22, EYE, 2, 3);
  px(ctx, 28, 22, EYE, 2, 3);
  px(ctx, 22, 29, "#b05a40", 4, 1);
  px(ctx, 15, 26, "#f2a08a", 3, 2);
  px(ctx, 30, 26, "#f2a08a", 3, 2);
}

const BG: Record<NpcId, string> = { atao: "#f2c8c0", xiaobai: "#c8e0e4", qiansi: "#e8d090", mia: "#e0c8ec", kdr: "#cdd4c4" };

function draw(id: NpcId, ctx: Ctx): void {
  switch (id) {
    case "atao": // 报名亭的阿桃：麻花辫，别着铅笔，蓝布褂
      px(ctx, 8, 35, "#4a7ab0", 32, 13);
      px(ctx, 22, 35, "#f4f0e6", 4, 13);
      face(ctx);
      px(ctx, 13, 9, "#5a2e1a", 22, 7);
      px(ctx, 12, 13, "#5a2e1a", 4, 10);
      px(ctx, 32, 13, "#5a2e1a", 4, 10);
      for (let i = 0; i < 4; i++) px(ctx, 10 - (i % 2), 23 + i * 3, "#5a2e1a", 4, 3);
      px(ctx, 9, 35, "#d23a2a", 3, 2);
      px(ctx, 33, 10, "#f6d05a", 2, 9);
      px(ctx, 33, 19, "#3b1c0e", 2, 1);
      break;
    case "xiaobai": // 测序所的小白：短发，圆眼镜，白大褂
      px(ctx, 7, 35, "#f4f4f0", 34, 13);
      px(ctx, 22, 35, "#9ab8c4", 4, 13);
      px(ctx, 12, 40, "#c8d4d8", 6, 1);
      face(ctx);
      px(ctx, 13, 9, "#2c2c3a", 22, 6);
      px(ctx, 12, 12, "#2c2c3a", 4, 9);
      px(ctx, 32, 12, "#2c2c3a", 4, 9);
      px(ctx, 16, 20, "#5a6a8a", 6, 1);
      px(ctx, 16, 25, "#5a6a8a", 6, 1);
      px(ctx, 16, 20, "#5a6a8a", 1, 6);
      px(ctx, 21, 20, "#5a6a8a", 1, 6);
      px(ctx, 26, 20, "#5a6a8a", 6, 1);
      px(ctx, 26, 25, "#5a6a8a", 6, 1);
      px(ctx, 26, 20, "#5a6a8a", 1, 6);
      px(ctx, 31, 20, "#5a6a8a", 1, 6);
      px(ctx, 22, 22, "#5a6a8a", 4, 1);
      break;
    case "qiansi": // 庄家钱四：红帽子，八字胡，金牙
      px(ctx, 7, 35, "#3a5a3a", 34, 13);
      px(ctx, 20, 35, "#f6d05a", 8, 2);
      face(ctx, "#e8b888");
      px(ctx, 10, 10, "#c9302a", 28, 3);
      px(ctx, 14, 4, "#d23a2a", 20, 7);
      px(ctx, 14, 9, "#3b1c0e", 20, 1);
      px(ctx, 17, 27, "#3b1c0e", 5, 2);
      px(ctx, 26, 27, "#3b1c0e", 5, 2);
      px(ctx, 24, 29, "#f6d05a", 2, 1);
      break;
    case "mia": // 马戏团米娅：双马尾，星星发卡，红白条纹衣
      for (let x = 8; x < 40; x += 4) px(ctx, x, 35, x % 8 === 0 ? "#d23a2a" : "#fff2d0", 4, 13);
      face(ctx);
      px(ctx, 13, 9, "#e07a2a", 22, 6);
      px(ctx, 12, 12, "#e07a2a", 3, 7);
      px(ctx, 33, 12, "#e07a2a", 3, 7);
      blob(ctx, 8, 18, 4, "#e07a2a");
      blob(ctx, 40, 18, 4, "#e07a2a");
      px(ctx, 28, 8, "#f6d05a", 5, 1);
      px(ctx, 30, 6, "#f6d05a", 1, 5);
      break;
    case "kdr": // K 博士：灰发后梳，圆框眼镜，山羊胡，实验服
      px(ctx, 7, 35, "#f4f4f0", 34, 13);
      px(ctx, 21, 35, "#2c2c3a", 6, 13);
      px(ctx, 23, 35, "#4a8a2a", 2, 10);
      face(ctx, "#e8c0a0");
      px(ctx, 13, 8, "#a8a8a8", 22, 5);
      px(ctx, 12, 11, "#a8a8a8", 3, 9);
      px(ctx, 33, 11, "#a8a8a8", 3, 9);
      blob(ctx, 19, 23, 3, "#2c2c3a");
      blob(ctx, 29, 23, 3, "#2c2c3a");
      blob(ctx, 19, 23, 2, "#dfe8ec");
      blob(ctx, 29, 23, 2, "#dfe8ec");
      px(ctx, 19, 23, EYE);
      px(ctx, 29, 23, EYE);
      px(ctx, 22, 22, "#2c2c3a", 4, 1);
      px(ctx, 22, 31, "#a8a8a8", 4, 4);
      break;
  }
}

const cache = new Map<NpcId, string>();

export function npcPortraitURL(id: NpcId): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const [c, ctx] = canvas(48, 48);
  px(ctx, 0, 0, BG[id], 48, 48);
  for (let y = 0; y < 48; y += 4) px(ctx, 0, y, "rgba(0,0,0,0.05)", 48, 2);
  draw(id, ctx);
  outline(c, "#2a1a12");
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}
