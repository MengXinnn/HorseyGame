/**
 * 摆设的像素画：树、花坛、长凳、货摊、喷泉……都按 3/4 俯视画：
 * 顶面看得见（亮），正面在下（暗一点），光从左上来。画一次缓存成小画布。
 */
import { blob, canvas, outline, px } from "./sprites";
import type { Prop } from "./tiles";

type Ctx = CanvasRenderingContext2D;

export interface Sprite {
  img: HTMLCanvasElement;
  /** 贴图时的锚点（脚底），相对图片左上角。 */
  ax: number;
  ay: number;
}

function sprite(w: number, h: number, ax: number, ay: number, draw: (ctx: Ctx) => void, line?: string): Sprite {
  const [c, ctx] = canvas(w, h);
  draw(ctx);
  if (line) outline(c, line);
  return { img: c, ax, ay };
}

/** 椭圆（顶面用），没有抗锯齿。 */
function oval(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(ctx, x, y, color);
    }
}

/* ---------------- 树 ---------------- */

function pine(v: number): Sprite {
  const greens = [
    ["#21543a", "#2f6e45", "#46905a", "#6cb36b"],
    ["#1f4c3c", "#2b6449", "#3f8460", "#62a877"],
    ["#28583a", "#357345", "#4d9455", "#79bb6a"],
    ["#22503a", "#2e6a46", "#438a58", "#68ae6c"],
  ][v % 4] as string[];
  return sprite(
    32,
    52,
    16,
    49,
    (ctx) => {
      px(ctx, 14, 38, "#5a3a22", 4, 12);
      px(ctx, 14, 38, "#7a5030", 2, 12);
      const layers = [
        [40, 14],
        [31, 12],
        [22, 10],
        [13, 7],
      ];
      layers.forEach(([y, r]) => {
        for (let row = 0; row < 12; row++) {
          const half = Math.round((row / 12) * (r as number));
          const yy = (y as number) - 12 + row;
          px(ctx, 16 - half, yy, greens[1]!, half * 2, 1);
          px(ctx, 16 - half, yy, greens[2]!, Math.max(1, half - 1), 1);
          if (row > 2) px(ctx, 16 - half + 1, yy, greens[3]!, Math.max(1, Math.floor(half / 3)), 1);
          px(ctx, 16 + half - 2, yy, greens[0]!, 2, 1);
        }
        // 每层下沿一道深色，层次更分明。
        px(ctx, 16 - (r as number) + 1, (y as number) - 1, greens[0]!, (r as number) * 2 - 2, 1);
      });
      px(ctx, 16, 2, greens[3]!, 1, 2);
    },
    "#183326",
  );
}

function oak(v: number): Sprite {
  const g = [
    ["#2c6a33", "#3f8a3a", "#5aa848", "#86c95e"],
    ["#2f6630", "#45873a", "#62a64a", "#8fcb63"],
    ["#356a2c", "#4d8c34", "#6cab42", "#9ccf5c"],
    ["#2a6236", "#3b8240", "#55a250", "#7fc468"],
  ][v % 4] as string[];
  return sprite(
    36,
    46,
    18,
    43,
    (ctx) => {
      px(ctx, 15, 28, "#5e3d24", 6, 16);
      px(ctx, 15, 28, "#7d5434", 2, 16);
      px(ctx, 19, 28, "#4a2e1a", 2, 16);
      px(ctx, 13, 42, "#5e3d24", 10, 2);
      const clusters: Array<[number, number, number]> = [
        [18, 16, 13],
        [9, 22, 8],
        [27, 22, 8],
        [12, 10, 8],
        [24, 10, 8],
        [18, 25, 9],
      ];
      for (const [x, y, r] of clusters) blob(ctx, x, y, r, g[0]!);
      for (const [x, y, r] of clusters) blob(ctx, x - 1, y - 1, r - 1, g[1]!);
      for (const [x, y, r] of clusters) blob(ctx, x - 2, y - 2, Math.max(2, r - 4), g[2]!);
      for (const [x, y, r] of clusters) blob(ctx, x - 3, y - 3, Math.max(1, r - 7), g[3]!);
      if (v === 2) for (const [x, y] of [[12, 14], [24, 18], [18, 24], [28, 12], [8, 22]] as const) px(ctx, x, y, "#e2513c", 2, 2);
    },
    "#1d3d1f",
  );
}

/** 垂柳：圆圆的树冠，一缕缕枝条垂下来。 */
function willow(v: number): Sprite {
  const g = v ? ["#3f7a3a", "#5a9a44", "#7cbf58", "#a6d878"] : ["#3a7240", "#548f4a", "#74b45e", "#9cd07e"];
  return sprite(
    44,
    52,
    22,
    49,
    (ctx) => {
      px(ctx, 19, 30, "#5e3d24", 6, 19);
      px(ctx, 19, 30, "#7d5434", 2, 19);
      blob(ctx, 22, 16, 14, g[0]!, 0.75);
      blob(ctx, 21, 15, 12, g[1]!, 0.75);
      blob(ctx, 19, 12, 7, g[2]!, 0.75);
      blob(ctx, 17, 10, 3, g[3]!, 0.75);
      for (let i = 0; i < 14; i++) {
        const x = 5 + i * 2.6;
        const len = 14 + ((i * 7) % 11);
        const c = i % 3 === 0 ? g[2]! : i % 3 === 1 ? g[1]! : g[0]!;
        px(ctx, x, 18, c, 1, len);
        px(ctx, x + 1, 22, g[0]!, 1, len - 6);
        if (i % 2) px(ctx, x, 18 + len, g[3]!, 1, 1);
      }
    },
    "#1d3d1f",
  );
}

/** 一丛竹子。 */
function bamboo(v: number): Sprite {
  return sprite(
    24,
    56,
    12,
    53,
    (ctx) => {
      const stalks = [
        [6, 46],
        [11, 52],
        [16, 44],
        [19, 38],
      ].slice(0, 3 + (v % 2));
      for (const [x, h] of stalks) {
        for (let y = 54 - h!; y < 54; y++) px(ctx, x!, y, (54 - y) % 9 === 0 ? "#3f6a2a" : "#7aa64a", 2, 1);
        px(ctx, x!, 54 - h!, "#a8c86a", 1, h!);
        for (let y = 54 - h! + 4; y < 46; y += 9) {
          px(ctx, x! - 4, y, "#4f8a30", 4, 2);
          px(ctx, x! + 2, y + 3, "#5aa040", 4, 2);
          px(ctx, x! - 3, y - 1, "#7cbf58", 2, 1);
        }
      }
    },
    "#1d3d1f",
  );
}

function bush(v: number): Sprite {
  const g = v % 2 ? ["#2f6e35", "#46903f", "#6db454"] : ["#336a2e", "#4c8a37", "#78b34c"];
  return sprite(
    20,
    16,
    10,
    14,
    (ctx) => {
      blob(ctx, 6, 9, 5, g[0]!);
      blob(ctx, 13, 9, 5, g[0]!);
      blob(ctx, 10, 6, 5, g[0]!);
      blob(ctx, 5, 8, 4, g[1]!);
      blob(ctx, 12, 8, 4, g[1]!);
      blob(ctx, 9, 5, 4, g[1]!);
      blob(ctx, 8, 4, 2, g[2]!);
      blob(ctx, 4, 7, 1, g[2]!);
      if (v === 3) for (const [x, y] of [[6, 7], [12, 6], [10, 10]] as const) px(ctx, x, y, "#f2f0f6");
    },
    "#1d3d1f",
  );
}

function rock(v: number): Sprite {
  return sprite(
    16,
    12,
    8,
    10,
    (ctx) => {
      blob(ctx, 8, 7, 5, "#7e7a72", 0.7);
      blob(ctx, 7, 6, 4, "#9e9a90", 0.7);
      blob(ctx, 6, 5, 2, "#c3bfb3", 0.7);
      if (v % 2) px(ctx, 9, 7, "#6a665f", 3, 1);
      if (v === 2) px(ctx, 4, 8, "#7d9a4a", 3, 1);
    },
    "#3b372f",
  );
}

function stump(): Sprite {
  return sprite(
    16,
    14,
    8,
    12,
    (ctx) => {
      px(ctx, 3, 5, "#6e4729", 10, 7);
      px(ctx, 3, 5, "#8a5a34", 2, 7);
      oval(ctx, 8, 5, 5, 2.4, "#c99a63");
      oval(ctx, 8, 5, 3, 1.4, "#a77a48");
      px(ctx, 8, 5, "#8a5a34");
      px(ctx, 3, 11, "#553620", 10, 1);
    },
    "#2c1a10",
  );
}

function reeds(v: number): Sprite {
  return sprite(16, 18, 8, 16, (ctx) => {
    const n = 4 + v;
    for (let i = 0; i < n; i++) {
      const x = 2 + ((i * 5) % 12);
      const h = 7 + ((i * 7) % 8);
      px(ctx, x, 16 - h, i % 2 ? "#5c8a3a" : "#7aa648", 1, h);
      if (i % 2 === 0) px(ctx, x, 16 - h - 2, "#7a5534", 1, 3);
    }
  });
}

/* ---------------- 灯 ---------------- */

function lantern(): Sprite {
  return sprite(
    12,
    30,
    6,
    28,
    (ctx) => {
      px(ctx, 5, 6, "#4a2e1a", 2, 22);
      px(ctx, 4, 27, "#3a2414", 4, 2);
      px(ctx, 6, 5, "#4a2e1a", 4, 1);
      px(ctx, 8, 6, "#3a2414", 1, 2);
      blob(ctx, 8, 11, 3, "#c9302a");
      px(ctx, 6, 9, "#e8574a", 2, 3);
      px(ctx, 7, 7, "#f2c14e", 3, 1);
      px(ctx, 7, 15, "#f2c14e", 3, 1);
      px(ctx, 8, 16, "#f2c14e", 1, 2);
    },
    "#24150c",
  );
}

/** 铁路灯：细杆、方灯笼、小帽子。v=1 是研究所的白灯。 */
function lamppost(v: number): Sprite {
  return sprite(
    14,
    40,
    7,
    38,
    (ctx) => {
      const iron = v ? "#8a9098" : "#3a3a44";
      const hi = v ? "#c6ccd4" : "#5a5a66";
      px(ctx, 4, 35, iron, 6, 3);
      px(ctx, 4, 35, hi, 6, 1);
      px(ctx, 6, 11, iron, 2, 25);
      px(ctx, 6, 11, hi, 1, 25);
      px(ctx, 3, 9, iron, 8, 2);
      px(ctx, 3, 3, iron, 8, 7);
      px(ctx, 4, 4, v ? "#e8f4ff" : "#ffd98a", 6, 5);
      px(ctx, 4, 4, v ? "#ffffff" : "#fff2c0", 2, 2);
      px(ctx, 6, 4, iron, 1, 5);
      px(ctx, 2, 2, iron, 10, 2);
      px(ctx, 4, 0, iron, 6, 2);
      px(ctx, 6, 0, hi, 2, 1);
    },
    "#1e1a18",
  );
}

/* ---------------- 花草 ---------------- */

function sunflower(v: number): Sprite {
  return sprite(10, 22, 5, 20, (ctx) => {
    px(ctx, 4, 8, "#4c8a37", 1, 13);
    px(ctx, 2, 13 + (v % 2), "#5ea446", 2, 2);
    px(ctx, 5, 15 - (v % 2), "#5ea446", 2, 2);
    blob(ctx, 4, 5, 3, "#f2c230");
    px(ctx, 3, 4, "#7a4a1c", 3, 3);
    px(ctx, 1, 4, "#e6a320");
  });
}

const FLOWERS = ["#f19ab0", "#f6d84a", "#ffffff", "#b8a6ff"];

function tallGrass(v: number): Sprite {
  return sprite(16, 14, 8, 13, (ctx) => {
    const n = 5 + v;
    for (let i = 0; i < n; i++) {
      const x = 2 + ((i * 5 + v) % 12);
      const h = 6 + ((i * 3) % 6);
      px(ctx, x, 13 - h, i % 2 ? "#4f8f30" : "#6cbf4a", 1, h);
      px(ctx, x + 1, 13 - h + 2, "#3f7a2a", 1, h - 2);
    }
  });
}

function flowerPatch(v: number): Sprite {
  const c = FLOWERS[v % FLOWERS.length] as string;
  return sprite(16, 12, 8, 10, (ctx) => {
    for (const [x, y] of [
      [3, 6],
      [8, 4],
      [12, 7],
      [6, 9],
      [10, 10],
    ] as const) {
      px(ctx, x, y + 1, "#4f8f30", 1, 2);
      px(ctx, x - 1, y, c);
      px(ctx, x + 1, y, c);
      px(ctx, x, y - 1, c);
      px(ctx, x, y, "#f2a93b");
    }
  });
}

function lily(v: number): Sprite {
  return sprite(12, 8, 6, 6, (ctx) => {
    blob(ctx, 5, 4, 3, "#4f9a3a", 0.6);
    px(ctx, 5, 3, "#3f8bd0", 2, 1);
    px(ctx, 4, 3, "#6cbf4a", 1, 1);
    if (v === 1) {
      px(ctx, 7, 2, "#f6b8c8", 2, 2);
      px(ctx, 8, 1, "#ffffff");
    }
  });
}

function mushroom(v: number): Sprite {
  const cap = v ? "#c9302a" : "#c8925a";
  return sprite(
    12,
    10,
    6,
    9,
    (ctx) => {
      px(ctx, 3, 5, "#f4ead2", 2, 4);
      px(ctx, 1, 3, cap, 6, 3);
      px(ctx, 2, 2, cap, 4, 1);
      if (v) px(ctx, 3, 3, "#ffffff", 1, 1);
      px(ctx, 8, 6, "#f4ead2", 1, 3);
      px(ctx, 7, 5, cap, 3, 2);
    },
    "#2a1a12",
  );
}

/** 花坛：石头砌的方台子，从上面看得见里面的土和花，正面暗一些。 */
function planter(v: number): Sprite {
  const c = FLOWERS[v % FLOWERS.length] as string;
  return sprite(
    24,
    24,
    12,
    22,
    (ctx) => {
      // 正面
      px(ctx, 2, 15, "#8f877a", 20, 7);
      for (let x = 2; x < 22; x += 5) px(ctx, x, 16, "#7a7264", 1, 6);
      px(ctx, 2, 18, "#7a7264", 20, 1);
      px(ctx, 18, 15, "#6e675c", 4, 7);
      // 顶面：一圈石沿，里面是土。
      px(ctx, 1, 9, "#c6bead", 22, 6);
      px(ctx, 1, 9, "#ddd6c8", 22, 1);
      px(ctx, 3, 10, "#5a3a22", 18, 4);
      px(ctx, 3, 10, "#3e2614", 18, 1);
      // 花和叶子从土里冒出来，高过石沿。
      blob(ctx, 7, 8, 4, "#3f7f30", 0.7);
      blob(ctx, 15, 8, 4, "#3f7f30", 0.7);
      blob(ctx, 11, 6, 4, "#4f9a3a", 0.7);
      blob(ctx, 10, 5, 2, "#6cbf4a", 0.7);
      for (const [x, y] of [
        [5, 6],
        [9, 3],
        [14, 5],
        [17, 8],
        [7, 9],
        [12, 8],
      ] as const) {
        px(ctx, x, y, c, 2, 2);
        px(ctx, x, y, "#ffffff");
        px(ctx, x + 1, y + 1, "#f2a93b");
      }
    },
    "#2a1a12",
  );
}

/* ---------------- 木头家什 ---------------- */

/** 木桶：顶上一个椭圆的盖子，桶身左亮右暗，两道铁箍。 */
function barrel(): Sprite {
  return sprite(
    14,
    18,
    7,
    16,
    (ctx) => {
      px(ctx, 2, 4, "#9a6232", 10, 12);
      px(ctx, 1, 6, "#9a6232", 12, 8);
      px(ctx, 3, 4, "#c08a4a", 2, 12);
      px(ctx, 9, 4, "#6a3e1c", 3, 12);
      px(ctx, 1, 7, "#4a4a50", 12, 1);
      px(ctx, 1, 12, "#4a4a50", 12, 1);
      px(ctx, 2, 7, "#8a8a92", 3, 1);
      oval(ctx, 7, 4, 5, 2.4, "#c99a62");
      oval(ctx, 7, 4, 4, 1.6, "#b07a46");
      px(ctx, 4, 4, "#8a5a32", 6, 1);
    },
    "#2a1a12",
  );
}

/** 木箱：顶面亮，正面一个叉。 */
function crate(): Sprite {
  return sprite(
    16,
    18,
    8,
    16,
    (ctx) => {
      px(ctx, 2, 3, "#dcae6c", 12, 4);
      px(ctx, 2, 3, "#ecc488", 12, 1);
      px(ctx, 2, 5, "#c99a5a", 12, 1);
      px(ctx, 2, 7, "#b8803e", 12, 9);
      px(ctx, 2, 7, "#8a5a2a", 2, 9);
      px(ctx, 12, 7, "#7a4a22", 2, 9);
      px(ctx, 2, 14, "#7a4a22", 12, 2);
      px(ctx, 2, 7, "#8a5a2a", 12, 1);
      for (let i = 0; i < 7; i++) px(ctx, 4 + i * 1.2, 8 + i, "#8a5a2a", 1, 1);
    },
    "#2a1a12",
  );
}

/** 水井：圆石井台（顶面一圈石沿，中间黑水），木架和小屋顶。 */
function well(): Sprite {
  return sprite(
    32,
    44,
    16,
    41,
    (ctx) => {
      // 井台正面
      px(ctx, 4, 30, "#8f877a", 24, 10);
      for (let x = 4; x < 28; x += 5) px(ctx, x + ((x / 5) % 2), 31, "#7a7264", 1, 9);
      px(ctx, 4, 35, "#7a7264", 24, 1);
      px(ctx, 22, 30, "#6e675c", 6, 10);
      // 井口
      oval(ctx, 16, 29, 13, 5, "#c6bead");
      oval(ctx, 16, 29, 10, 3.4, "#2c3a4a");
      oval(ctx, 15, 29.5, 7, 2, "#3f6f9a");
      px(ctx, 6, 26, "#ddd6c8", 8, 1);
      // 井架和小屋顶
      px(ctx, 5, 10, "#5a3a22", 3, 20);
      px(ctx, 24, 10, "#5a3a22", 3, 20);
      px(ctx, 5, 10, "#7a5030", 1, 20);
      px(ctx, 7, 15, "#3a2414", 18, 2);
      px(ctx, 15, 17, "#c9b98e", 1, 6);
      px(ctx, 13, 22, "#7a4a24", 5, 4);
      px(ctx, 13, 22, "#a8733f", 5, 1);
      px(ctx, 1, 6, "#4a5a6e", 30, 5);
      px(ctx, 3, 3, "#5c6e86", 26, 3);
      px(ctx, 6, 1, "#7a8ea8", 20, 2);
      px(ctx, 1, 10, "#2c3644", 30, 1);
      for (let x = 3; x < 30; x += 4) px(ctx, x, 6, "#3e4c5e", 1, 4);
    },
    "#24150c",
  );
}

const AWNINGS = [
  ["#c9302a", "#f3e6c8"],
  ["#3f6fb0", "#f3e6c8"],
  ["#4f8f30", "#f6d05a"],
  ["#d07a2a", "#f3e6c8"],
];
const GOODS = [
  ["#e0453a", "#f6a23a", "#9ad14e"],
  ["#f6d84a", "#e8b04a", "#c98a56"],
  ["#d6a0e6", "#f19ab0", "#ffffff"],
  ["#7ac6e8", "#e0453a", "#f6d84a"],
];

/** 货摊：柜台的顶面上摆着货，篷子从上面看是斜的条纹，前沿一排波浪边。 */
function stall(v: number): Sprite {
  const [a, b] = AWNINGS[v % 4] as [string, string];
  const goods = GOODS[v % 4] as string[];
  return sprite(
    46,
    46,
    23,
    43,
    (ctx) => {
      px(ctx, 5, 14, "#5a3a22", 2, 28);
      px(ctx, 39, 14, "#5a3a22", 2, 28);
      // 柜台正面
      px(ctx, 3, 32, "#9a6232", 40, 10);
      px(ctx, 3, 32, "#7a4a24", 40, 1);
      for (let x = 8; x < 42; x += 7) px(ctx, x, 33, "#7a4a24", 1, 9);
      px(ctx, 3, 40, "#5a3218", 40, 2);
      px(ctx, 39, 32, "#6a3e1c", 4, 10);
      // 柜台顶面和货
      px(ctx, 2, 24, "#c08a4a", 42, 8);
      px(ctx, 2, 24, "#dcae6c", 42, 1);
      px(ctx, 4, 26, "#a8733f", 38, 5);
      for (let i = 0; i < 10; i++) {
        const c = goods[i % 3] as string;
        const gx = 6 + i * 3.6;
        const gy = 27 + (i % 2) * 2;
        blob(ctx, gx, gy, 2, c);
        px(ctx, gx - 1, gy - 1, "#ffffff");
      }
      // 篷子：顶面（斜着看）+ 前沿波浪
      for (let i = 0; i < 11; i++) {
        const c = i % 2 ? b : a;
        px(ctx, 1 + i * 4, 4, c, 4, 10);
        px(ctx, 1 + i * 4, 4, "rgba(255,255,255,0.18)", 4, 2);
        px(ctx, 1 + i * 4, 14, i % 2 ? "#d8cdb4" : "#8e2519", 4, 1);
        px(ctx, 2 + i * 4, 15, i % 2 ? "#d8cdb4" : "#8e2519", 2, 2);
      }
      for (let i = 0; i < 11; i++) if (v % 4 !== 0 && i % 2 === 0) px(ctx, 1 + i * 4, 14, "rgba(0,0,0,0.25)", 4, 3);
      px(ctx, 1, 4, "rgba(255,255,255,0.3)", 44, 1);
      px(ctx, 3, 17, "rgba(0,0,0,0.25)", 40, 3);
    },
    "#24150c",
  );
}

const CROPS = [
  { leaf: "#5aa848", dark: "#3f8a3a", fruit: "#b8e070" },
  { leaf: "#6cbf4a", dark: "#3f8a3a", fruit: "#f08a2a" },
  { leaf: "#7cbf3a", dark: "#4f8f30", fruit: "#f6d05a" },
  { leaf: "#4f9a3a", dark: "#356a2c", fruit: "#e8782a" },
];

/** 菜地里一格菜（地垄在地面图里）。 */
function crops(v: number): Sprite {
  const c = CROPS[v % 4]!;
  return sprite(16, 18, 8, 17, (ctx) => {
    px(ctx, 2, 15, "rgba(40,20,10,0.35)", 12, 2);
    if (v % 4 === 0) {
      // 白菜
      blob(ctx, 8, 11, 4, c.dark);
      blob(ctx, 8, 10, 3, c.leaf);
      px(ctx, 7, 9, c.fruit, 2, 2);
    } else if (v % 4 === 1) {
      // 胡萝卜缨子
      for (const x of [4, 8, 12]) {
        px(ctx, x, 13, c.fruit, 2, 1);
        px(ctx, x - 1, 7, c.leaf, 1, 6);
        px(ctx, x + 1, 6, c.dark, 1, 7);
        px(ctx, x + 2, 8, c.leaf, 1, 5);
      }
    } else if (v % 4 === 2) {
      // 玉米
      for (const x of [4, 11]) {
        px(ctx, x, 1, c.leaf, 2, 14);
        px(ctx, x - 2, 6, c.dark, 2, 1);
        px(ctx, x + 2, 8, c.dark, 2, 1);
        px(ctx, x + 2, 4, c.fruit, 2, 4);
      }
    } else {
      // 南瓜
      blob(ctx, 8, 12, 4, c.fruit, 0.75);
      px(ctx, 6, 10, "#f6a24a", 1, 4);
      px(ctx, 10, 10, "#c85a1a", 1, 4);
      px(ctx, 8, 7, c.dark, 1, 3);
      px(ctx, 9, 7, c.leaf, 3, 2);
    }
  });
}

/** 草捆：顶面亮，正面有捆绳。 */
function hay(v: number): Sprite {
  return sprite(
    20,
    18,
    10,
    16,
    (ctx) => {
      px(ctx, 1, 3, "#f2d878", 18, 4);
      px(ctx, 1, 3, "#f8e6a0", 18, 1);
      px(ctx, 1, 7, "#d8b048", 18, 9);
      px(ctx, 15, 7, "#b08a30", 4, 9);
      px(ctx, 1, 14, "#b08a30", 18, 2);
      px(ctx, 5, 3, "#8a5a2a", 1, 13);
      px(ctx, 14, 3, "#8a5a2a", 1, 13);
      for (let i = 0; i < 7; i++) px(ctx, 2 + ((i * 7 + v * 3) % 15), 8 + ((i * 3) % 6), "#b89036", 2, 1);
    },
    "#3b2410",
  );
}

/** 水槽：看得见里面的水。 */
function trough(): Sprite {
  return sprite(
    36,
    16,
    18,
    14,
    (ctx) => {
      px(ctx, 1, 2, "#a8733f", 34, 6);
      px(ctx, 1, 2, "#c99a5a", 34, 1);
      px(ctx, 3, 3, "#3f8bd0", 30, 4);
      px(ctx, 3, 3, "#2f6fae", 30, 1);
      px(ctx, 6, 5, "#9fd0f0", 6, 1);
      px(ctx, 20, 4, "#9fd0f0", 3, 1);
      px(ctx, 1, 8, "#8a5a32", 34, 4);
      px(ctx, 1, 11, "#6a4024", 34, 1);
      px(ctx, 2, 12, "#5e3d24", 3, 2);
      px(ctx, 31, 12, "#5e3d24", 3, 2);
    },
    "#2a1a12",
  );
}

function mailbox(): Sprite {
  return sprite(
    12,
    22,
    6,
    20,
    (ctx) => {
      px(ctx, 5, 9, "#5e3d24", 2, 12);
      px(ctx, 1, 3, "#c9302a", 10, 7);
      px(ctx, 2, 2, "#e8574a", 8, 1);
      px(ctx, 1, 3, "#e8574a", 10, 1);
      px(ctx, 2, 5, "#8e2519", 1, 4);
      px(ctx, 9, 0, "#5a4632", 1, 5);
      px(ctx, 10, 0, "#f6d05a", 2, 2);
    },
    "#2a1a12",
  );
}

function woodpile(): Sprite {
  return sprite(
    20,
    16,
    10,
    14,
    (ctx) => {
      for (let r = 0; r < 3; r++)
        for (let i = 0; i < 4 - r; i++) {
          const x = 2 + i * 4 + r * 2;
          const y = 10 - r * 4;
          blob(ctx, x + 1, y + 1, 2, "#8a5a32");
          px(ctx, x, y, "#d8a868", 2, 2);
          px(ctx, x + 1, y + 1, "#b07a46");
        }
    },
    "#2a1a12",
  );
}

/** 路牌：木牌上画一个箭头（牌子太小，写不下能看清的字；地名进了那片地方会滑出来）。 */
function signpost(v: number): Sprite {
  return sprite(
    22,
    26,
    11,
    24,
    (ctx) => {
      px(ctx, 10, 6, "#5e3d24", 2, 18);
      px(ctx, 2, 3, "#a8733f", 16, 8);
      px(ctx, 18, 4, "#a8733f", 2, 6);
      px(ctx, 20, 5, "#a8733f", 1, 4);
      px(ctx, 2, 3, "#c99a5a", 16, 1);
      px(ctx, 2, 10, "#7a4a24", 18, 1);
      // 箭头：横杆加三角头，深色；单数的牌子还多一道刻痕，免得每块都一样。
      px(ctx, 5, 6, "#3b1c0e", 8, 2);
      px(ctx, 12, 4, "#3b1c0e", 1, 6);
      px(ctx, 13, 5, "#3b1c0e", 1, 4);
      px(ctx, 14, 6, "#3b1c0e", 1, 2);
      if (v % 2) px(ctx, 4, 9, "#8a5a32", 10, 1);
    },
    "#2a1a12",
  );
}

function noticeBoard(): Sprite {
  return sprite(
    22,
    26,
    11,
    24,
    (ctx) => {
      px(ctx, 3, 12, "#5a3a22", 2, 13);
      px(ctx, 17, 12, "#5a3a22", 2, 13);
      px(ctx, 1, 3, "#8a5a32", 20, 12);
      px(ctx, 2, 4, "#a8733f", 18, 10);
      px(ctx, 4, 5, "#f4ead2", 6, 7);
      px(ctx, 12, 6, "#f4ead2", 6, 6);
      px(ctx, 5, 7, "#9a8a70", 4, 1);
      px(ctx, 5, 9, "#9a8a70", 3, 1);
      px(ctx, 13, 8, "#9a8a70", 4, 1);
      px(ctx, 6, 5, "#c9302a", 2, 1);
      px(ctx, 0, 1, "#6b4222", 22, 3);
      px(ctx, 0, 1, "#8a5a32", 22, 1);
    },
    "#24150c",
  );
}

function flag(v: number): Sprite {
  const colors = ["#d8443a", "#f2b632", "#3f7fd0", "#4fa64a", "#d8443a", "#f2b632"];
  return sprite(
    14,
    34,
    2,
    32,
    (ctx) => {
      px(ctx, 1, 2, "#5a4632", 2, 31);
      px(ctx, 3, 3, colors[v % 6]!, 9, 6);
      px(ctx, 3, 9, colors[v % 6]!, 6, 2);
      px(ctx, 3, 3, "rgba(255,255,255,0.35)", 9, 1);
    },
    "#24150c",
  );
}

function log(): Sprite {
  return sprite(
    36,
    14,
    18,
    12,
    (ctx) => {
      px(ctx, 3, 3, "#7a4a2a", 30, 8);
      px(ctx, 3, 3, "#9a6232", 30, 2);
      px(ctx, 3, 9, "#5e3620", 30, 2);
      oval(ctx, 3.5, 7, 3, 4, "#c99a62");
      oval(ctx, 3.5, 7, 1.5, 2, "#a8733f");
      px(ctx, 14, 2, "#4f9a3a", 4, 2);
      px(ctx, 22, 1, "#5aa848", 2, 3);
      for (const x of [10, 18, 26]) px(ctx, x, 6, "#5e3620", 3, 1);
    },
    "#2a1a12",
  );
}

function cart(): Sprite {
  return sprite(
    40,
    26,
    20,
    24,
    (ctx) => {
      // 车厢：顶沿看得见，里面装着草。
      px(ctx, 4, 6, "#c99a5a", 26, 3);
      px(ctx, 5, 7, "#d8b048", 24, 3);
      blob(ctx, 14, 6, 4, "#e8c45a", 0.6);
      blob(ctx, 21, 6, 3, "#d8b048", 0.6);
      px(ctx, 4, 10, "#a8733f", 26, 7);
      px(ctx, 4, 10, "#c99a5a", 26, 1);
      for (const x of [10, 17, 24]) px(ctx, x, 11, "#7a4a24", 1, 6);
      px(ctx, 30, 13, "#7a4a24", 9, 2);
      blob(ctx, 10, 19, 4, "#5e3d24");
      blob(ctx, 10, 19, 2, "#a8733f");
      blob(ctx, 24, 19, 4, "#5e3d24");
      blob(ctx, 24, 19, 2, "#a8733f");
    },
    "#2a1a12",
  );
}

/** 铜马像：石座有顶面和正面，上面一匹扬蹄的马，左边受光。 */
function statue(): Sprite {
  return sprite(
    44,
    58,
    22,
    55,
    (ctx) => {
      // 底座两层：每层顶面亮、正面暗。
      px(ctx, 3, 47, "#b0a898", 38, 3);
      px(ctx, 3, 50, "#8a8274", 38, 5);
      px(ctx, 35, 50, "#746c60", 6, 5);
      px(ctx, 7, 34, "#d6cdbd", 30, 5);
      px(ctx, 7, 34, "#e8e0d2", 30, 1);
      px(ctx, 7, 39, "#9a9284", 30, 8);
      px(ctx, 31, 39, "#7e766a", 6, 8);
      px(ctx, 13, 41, "#7a7264", 16, 4);
      px(ctx, 14, 42, "#f2c14e", 14, 2);
      // 马：身子、后腿站立、前腿扬起、脖子和头、尾巴
      const c = "#6a8a6a";
      const d = "#4a6a52";
      const l = "#9fc09a";
      px(ctx, 13, 20, c, 15, 8);
      px(ctx, 13, 20, l, 15, 2);
      px(ctx, 13, 20, l, 3, 6);
      px(ctx, 24, 22, d, 4, 6);
      px(ctx, 14, 28, d, 3, 8);
      px(ctx, 23, 28, d, 3, 8);
      px(ctx, 14, 28, c, 1, 8);
      px(ctx, 26, 14, c, 4, 8);
      px(ctx, 28, 10, c, 6, 5);
      px(ctx, 28, 10, l, 6, 1);
      px(ctx, 33, 11, d, 2, 3);
      px(ctx, 29, 8, d, 2, 2);
      px(ctx, 25, 11, d, 2, 9);
      px(ctx, 29, 22, c, 6, 3);
      px(ctx, 33, 18, c, 3, 5);
      px(ctx, 28, 25, d, 3, 5);
      px(ctx, 8, 20, d, 5, 2);
      px(ctx, 6, 22, d, 3, 7);
      px(ctx, 31, 12, "#2a1a12");
    },
    "#24150c",
  );
}

/** 长凳：从上往下看得见椅面的木条，后面靠背，前面两条腿。 */
function bench(v: number): Sprite {
  const wood = v ? ["#7a5a3a", "#9a7a52", "#5a3e24"] : ["#a8733f", "#c99a5a", "#7a4a24"];
  return sprite(
    34,
    20,
    17,
    18,
    (ctx) => {
      // 靠背
      px(ctx, 3, 2, wood[0]!, 28, 4);
      px(ctx, 3, 2, wood[1]!, 28, 1);
      px(ctx, 4, 6, "#3a2414", 2, 3);
      px(ctx, 28, 6, "#3a2414", 2, 3);
      // 椅面（顶面，三条木板）
      px(ctx, 2, 9, wood[1]!, 30, 5);
      px(ctx, 2, 11, wood[0]!, 30, 1);
      px(ctx, 2, 13, wood[0]!, 30, 1);
      px(ctx, 2, 9, "#e0bd8a", 30, 1);
      // 前沿和腿
      px(ctx, 2, 14, wood[2]!, 30, 2);
      px(ctx, 4, 16, "#3a2414", 2, 3);
      px(ctx, 28, 16, "#3a2414", 2, 3);
    },
    "#2a1a12",
  );
}

/** 喷泉的池子（水和水柱在 world 里一帧帧画）：圆石池沿有顶面、正面，中间一根石柱托着水盘。 */
function fountain(): Sprite {
  return sprite(
    100,
    86,
    50,
    80,
    (ctx) => {
      const cx = 50;
      // 池子正面一圈石头
      for (let x = 2; x < 98; x++) {
        const t = (x - cx) / 47;
        const yTop = 56 + Math.sqrt(Math.max(0, 1 - t * t)) * 18;
        const h = 9;
        for (let y = Math.round(yTop); y < Math.round(yTop) + h; y++) {
          const shadeC = t > 0.45 ? "#7e766a" : t < -0.5 ? "#b0a898" : "#9a9284";
          px(ctx, x, y, (x + Math.floor(y / 3)) % 7 === 0 || (y - Math.round(yTop)) % 4 === 3 ? "#6e675c" : shadeC);
        }
      }
      // 池沿顶面（一圈亮石头）和池水
      oval(ctx, cx, 56, 48, 19, "#d6cdbd");
      oval(ctx, cx, 56, 48, 19, "#d6cdbd");
      oval(ctx, cx, 55, 43, 15.5, "#e8e0d2");
      oval(ctx, cx, 56.5, 41, 14.5, "#9a9284");
      oval(ctx, cx, 57, 40, 13.5, "#2f72b8");
      oval(ctx, cx, 58.5, 37, 11, "#3f8bd0");
      oval(ctx, cx - 6, 60, 22, 6, "#4f9ad8");
      // 中间的石柱和水盘
      px(ctx, cx - 4, 34, "#b0a898", 8, 22);
      px(ctx, cx - 4, 34, "#d6cdbd", 2, 22);
      px(ctx, cx + 2, 34, "#7e766a", 2, 22);
      oval(ctx, cx, 34, 17, 6, "#9a9284");
      oval(ctx, cx, 33, 17, 5.5, "#d6cdbd");
      oval(ctx, cx, 33, 14, 4, "#3f8bd0");
      oval(ctx, cx - 3, 33.5, 6, 1.6, "#6fb3ea");
      px(ctx, cx - 17, 34, "#9a9284", 34, 3);
      px(ctx, cx - 3, 18, "#b0a898", 6, 15);
      px(ctx, cx - 3, 18, "#d6cdbd", 2, 15);
      oval(ctx, cx, 18, 7, 2.6, "#d6cdbd");
      oval(ctx, cx, 18, 5, 1.6, "#3f8bd0");
      px(ctx, cx - 1, 12, "#c6bead", 3, 6);
      oval(ctx, cx, 11, 3, 2, "#e8e0d2");
    },
    "#3b372f",
  );
}

/** 卫星锅：白色的大圆盘斜着朝天。 */
function dish(): Sprite {
  return sprite(
    34,
    38,
    17,
    35,
    (ctx) => {
      px(ctx, 13, 26, "#8a9098", 8, 10);
      px(ctx, 13, 26, "#c6ccd4", 2, 10);
      px(ctx, 9, 33, "#7a7e78", 16, 3);
      for (let y = 0; y < 26; y++)
        for (let x = 0; x < 34; x++) {
          const dx = (x + 0.5 - 17) / 15;
          const dy = (y + 0.5 - 14) / 11;
          if (dx * dx + dy * dy > 1) continue;
          const lit = -dx * 0.6 - dy * 0.5;
          px(ctx, x, y, lit > 0.35 ? "#ffffff" : lit > -0.1 ? "#e6eaee" : lit > -0.5 ? "#c4cad2" : "#9aa2ac");
        }
      px(ctx, 16, 6, "#5a5e66", 2, 9);
      px(ctx, 15, 4, "#e0453a", 4, 3);
    },
    "#2a2a30",
  );
}

/** 帐篷：前面一个三角门洞，左坡亮右坡暗。 */
function tent(): Sprite {
  return sprite(
    46,
    36,
    23,
    33,
    (ctx) => {
      for (let y = 0; y < 26; y++) {
        const half = Math.round((y / 26) * 20);
        px(ctx, 23 - half - 2, 6 + y - 4, "#d8c49a", half + 2, 1);
        px(ctx, 23, 6 + y - 4, "#a8946a", half + 2, 1);
      }
      for (let y = 6; y < 30; y++) {
        const half = Math.round(((y - 6) / 24) * 17);
        px(ctx, 23 - half, y, "#e8d8b0", half * 2, 1);
      }
      for (let y = 14; y < 30; y++) {
        const half = Math.round(((y - 14) / 16) * 6);
        px(ctx, 23 - half, y, "#3a2614", half * 2, 1);
      }
      px(ctx, 22, 2, "#5a3a22", 2, 6);
      px(ctx, 4, 29, "#5a3a22", 1, 3);
      px(ctx, 42, 29, "#5a3a22", 1, 3);
    },
    "#2a1a12",
  );
}

/** 篝火：一圈石头和柴（火苗在 world 里画）。 */
function campfire(): Sprite {
  return sprite(20, 14, 10, 11, (ctx) => {
    for (let a = 0; a < 10; a++) {
      const t = (a / 10) * Math.PI * 2;
      const x = 10 + Math.cos(t) * 7;
      const y = 8 + Math.sin(t) * 3.4;
      px(ctx, x - 1, y - 1, Math.sin(t) > 0 ? "#7e7a72" : "#a8a49a", 3, 2);
    }
    px(ctx, 5, 7, "#5e3d24", 10, 2);
    px(ctx, 7, 5, "#7a4a2a", 6, 2);
    px(ctx, 8, 8, "#2a1a12", 4, 1);
  });
}

/** 擂台四角的柱子，绑着四色的穗子（青、红、白、黑）。 */
function dohyoPost(v: number): Sprite {
  const cloth = ["#2f8a5a", "#c9302a", "#f0ece0", "#2a2a30"][v % 4]!;
  return sprite(
    14,
    48,
    7,
    46,
    (ctx) => {
      px(ctx, 4, 6, "#8e2519", 5, 40);
      px(ctx, 4, 6, "#c9302a", 2, 40);
      px(ctx, 3, 43, "#5a3a22", 7, 3);
      px(ctx, 3, 4, "#f2c14e", 7, 3);
      px(ctx, 5, 0, "#f2c14e", 3, 4);
      // 穗子
      px(ctx, 2, 8, cloth, 9, 4);
      for (let i = 0; i < 4; i++) px(ctx, 2 + i * 2 + (i % 2), 12, cloth, 1, 5 + (i % 2) * 2);
    },
    "#24150c",
  );
}

function scarecrow(): Sprite {
  return sprite(
    24,
    34,
    12,
    32,
    (ctx) => {
      px(ctx, 11, 8, "#6a4a2a", 2, 24);
      px(ctx, 2, 13, "#6a4a2a", 20, 2);
      px(ctx, 7, 12, "#5a7aa8", 10, 9);
      px(ctx, 7, 12, "#7a9ac8", 3, 9);
      px(ctx, 9, 14, "#c9302a", 2, 2);
      px(ctx, 2, 15, "#e8c45a", 2, 2);
      px(ctx, 20, 15, "#e8c45a", 2, 2);
      blob(ctx, 12, 8, 3, "#e8d8a8");
      px(ctx, 10, 8, "#2a1a12");
      px(ctx, 13, 8, "#2a1a12");
      px(ctx, 5, 4, "#c99a4a", 14, 2);
      px(ctx, 8, 1, "#ddb562", 8, 3);
    },
    "#2a1a12",
  );
}

function anvil(): Sprite {
  return sprite(
    20,
    18,
    10,
    16,
    (ctx) => {
      px(ctx, 5, 9, "#6e4729", 10, 7);
      oval(ctx, 10, 9, 5, 2, "#a77a48");
      px(ctx, 2, 3, "#4a4a52", 16, 3);
      px(ctx, 2, 3, "#8a8a96", 16, 1);
      px(ctx, 0, 4, "#4a4a52", 3, 2);
      px(ctx, 6, 6, "#3a3a42", 8, 3);
    },
    "#1e1a18",
  );
}

/** 拴马桩：两根桩子一根横杆。 */
function hitch(): Sprite {
  return sprite(
    36,
    18,
    18,
    16,
    (ctx) => {
      px(ctx, 4, 4, "#6a4a2a", 3, 12);
      px(ctx, 29, 4, "#6a4a2a", 3, 12);
      px(ctx, 4, 4, "#8a6a42", 1, 12);
      px(ctx, 2, 5, "#a8733f", 32, 3);
      px(ctx, 2, 5, "#c99a5a", 32, 1);
      px(ctx, 12, 8, "#d9b06a", 1, 4);
    },
    "#2a1a12",
  );
}

function beehive(v: number): Sprite {
  return sprite(
    14,
    20,
    7,
    18,
    (ctx) => {
      px(ctx, 1, 3, "#f4ead2", 12, 3);
      px(ctx, 1, 3, "#ffffff", 12, 1);
      px(ctx, 1, 6, v % 2 ? "#e8d8a0" : "#e0e4d8", 12, 10);
      px(ctx, 1, 10, "#a8a090", 12, 1);
      px(ctx, 10, 6, "#b8b0a0", 3, 10);
      px(ctx, 5, 13, "#3a2a1a", 4, 2);
      px(ctx, 2, 16, "#6a4a2a", 2, 2);
      px(ctx, 10, 16, "#6a4a2a", 2, 2);
    },
    "#2a1a12",
  );
}

/** 小木船：从上往下看，船舱里有一块横板。 */
function boat(): Sprite {
  return sprite(
    34,
    14,
    17,
    10,
    (ctx) => {
      for (let x = 1; x < 33; x++) {
        const t = (x - 17) / 16;
        const half = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * 5.5);
        px(ctx, x, 6 - half, "#8a5a32", 1, half * 2 + 1);
        if (half > 1) px(ctx, x, 7 - half + 1, "#5e3d24", 1, half * 2 - 2);
      }
      px(ctx, 15, 2, "#a8733f", 3, 9);
      px(ctx, 4, 5, "#c99a5a", 26, 1);
    },
    "#2a1a12",
  );
}

const cache = new Map<string, Sprite>();

const MAKERS: Record<Prop["kind"], (v: number) => Sprite> = {
  pine,
  oak,
  willow,
  bamboo,
  bush,
  rock,
  stump,
  reeds,
  lantern,
  lamppost,
  sunflower,
  flag,
  board: noticeBoard,
  planter,
  barrel,
  crate,
  well,
  stall,
  crops,
  hay,
  trough,
  mailbox,
  woodpile,
  signpost,
  lily,
  mushroom,
  log,
  grass: tallGrass,
  flowers: flowerPatch,
  cart,
  statue,
  bench,
  fountain,
  dish,
  tent,
  campfire,
  post: dohyoPost,
  scarecrow,
  anvil,
  hitch,
  beehive,
  boat,
};

export function propSprite(p: Prop): Sprite {
  const key = `${p.kind}:${p.v}`;
  let s = cache.get(key);
  if (!s) {
    s = MAKERS[p.kind](p.v);
    cache.set(key, s);
  }
  return s;
}
