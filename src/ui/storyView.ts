/**
 * 剧情的画面：开场回忆的黑底像素画、任务木牌、信、日记本、结局。
 * 只拼 HTML 和画小画布，状态都在 src/game/story.ts。
 */
import type { Ending, GameState } from "../game/state";
import { ENDINGS, endingText, type Mail, type Plaque, type Slide, type SlidePic } from "../game/story";
import { canvas } from "../world/sprites";
import "./story.css";

type Ctx = CanvasRenderingContext2D;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const px = (ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1): void => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

/* ---------------- 开场回忆的像素画（96×54） ---------------- */

const SLIDE_W = 96;
const SLIDE_H = 54;

/** 灰色小马侧影，x/y 是马背左端。 */
function pony(ctx: Ctx, x: number, y: number, body: string, mane: string, wings = false): void {
  px(ctx, x, y, body, 16, 6);
  px(ctx, x + 14, y - 5, body, 4, 7);
  px(ctx, x + 16, y - 7, body, 5, 4);
  px(ctx, x + 14, y - 6, mane, 2, 6);
  px(ctx, x - 3, y + 1, mane, 3, 4);
  px(ctx, x + 1, y + 6, body, 2, 6);
  px(ctx, x + 5, y + 6, body, 2, 5);
  px(ctx, x + 11, y + 6, body, 2, 6);
  px(ctx, x + 14, y + 6, body, 2, 5);
  px(ctx, x + 19, y - 6, "#2a1a12");
  if (wings) {
    px(ctx, x + 4, y - 6, "#fff8e8", 8, 2);
    px(ctx, x + 2, y - 9, "#fff8e8", 8, 3);
    px(ctx, x, y - 12, "#fff8e8", 7, 3);
  }
}

function person(ctx: Ctx, x: number, y: number, shirt: string, hair: string, h = 12): void {
  px(ctx, x, y - h, "#f0c49a", 4, 4);
  px(ctx, x, y - h, hair, 4, 1);
  px(ctx, x - 1, y - h + 4, shirt, 6, h - 7);
  px(ctx, x, y - 3, "#3b1c0e", 1, 3);
  px(ctx, x + 3, y - 3, "#3b1c0e", 1, 3);
}

const PICS: Record<SlidePic, (ctx: Ctx, t: number) => void> = {
  office(ctx) {
    px(ctx, 0, 0, "#0c0a14", SLIDE_W, SLIDE_H);
    for (let i = 0; i < 30; i++) px(ctx, (i * 37) % SLIDE_W, (i * 13) % 20, "#3a3a5a");
    px(ctx, 14, 8, "#1c1c2c", 68, 46);
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 8; c++) {
        const lit = r === 3 && c === 5;
        px(ctx, 18 + c * 8, 12 + r * 7, lit ? "#f6d05a" : "#2a2a3e", 5, 4);
      }
    px(ctx, 59, 34, "#3b1c0e", 2, 2);
  },
  summer(ctx) {
    px(ctx, 0, 0, "#8cc8e8", SLIDE_W, 30);
    px(ctx, 0, 30, "#6cb36b", SLIDE_W, 24);
    px(ctx, 0, 30, "#8ccf6a", SLIDE_W, 2);
    px(ctx, 74, 6, "#fff2a0", 8, 8);
    px(ctx, 10, 10, "#ffffff", 14, 3);
    px(ctx, 14, 8, "#ffffff", 8, 2);
    for (let x = 2; x < SLIDE_W; x += 10) px(ctx, x, 26, "#a0622a", 2, 10);
    px(ctx, 0, 28, "#c08040", SLIDE_W, 2);
    pony(ctx, 38, 34, "#a8a8b0", "#606068");
    person(ctx, 43, 34, "#d23a2a", "#3b1c0e", 8);
    person(ctx, 62, 47, "#7a5a9a", "#e8e8e8", 14);
    px(ctx, 57, 37, "#5a2e1a", 5, 1);
  },
  photo(ctx) {
    px(ctx, 0, 0, "#0c0806", SLIDE_W, SLIDE_H);
    px(ctx, 16, 4, "#e8d8b0", 64, 46);
    px(ctx, 19, 7, "#c8a878", 58, 40);
    px(ctx, 19, 36, "#a88858", 58, 11);
    px(ctx, 66, 7, "#f4ead0", 2, 40);
    for (let y = 8; y < 46; y += 4) px(ctx, 66, y, "#5a3a1a", 2, 2);
    pony(ctx, 36, 26, "#fff8e8", "#e8e0d0", true);
    px(ctx, 19, 7, "#8a6a3a", 58, 1);
  },
  phone(ctx, t) {
    px(ctx, 0, 0, "#0c0a14", SLIDE_W, SLIDE_H);
    px(ctx, 0, 38, "#2a1a12", SLIDE_W, 16);
    px(ctx, 0, 38, "#3b2414", SLIDE_W, 1);
    px(ctx, 40, 22, "#1c1c22", 16, 26);
    px(ctx, 42, 25, "#9ad8a0", 12, 18);
    px(ctx, 44, 28, "#2a5a32", 8, 2);
    px(ctx, 44, 32, "#2a5a32", 6, 1);
    if (Math.floor(t * 4) % 2 === 0) {
      px(ctx, 34, 26, "#9ad8a0", 2, 6);
      px(ctx, 30, 24, "#9ad8a0", 2, 10);
      px(ctx, 60, 26, "#9ad8a0", 2, 6);
      px(ctx, 64, 24, "#9ad8a0", 2, 10);
    }
  },
};

/**
 * 开场回忆：黑底，一张像素画配一行字，点一下翻页，翻完调用 done。
 * 盖在整个游戏画面上，自己管自己的点击和按键。
 */
export function playSlides(host: HTMLElement, slides: Slide[], done: () => void): void {
  const el = document.createElement("div");
  el.className = "scene";
  el.innerHTML = `<canvas class="scene-pic"></canvas><p class="scene-text"></p><span class="t-more"></span>`;
  host.appendChild(el);
  const cv = el.querySelector("canvas") as HTMLCanvasElement;
  const [buf, bctx] = canvas(SLIDE_W, SLIDE_H);
  cv.width = SLIDE_W;
  cv.height = SLIDE_H;
  const ctx = cv.getContext("2d") as Ctx;
  ctx.imageSmoothingEnabled = false;
  let i = 0;
  let shownAt = performance.now();
  let raf = 0;
  const show = (): void => {
    const s = slides[i] as Slide;
    (el.querySelector(".scene-text") as HTMLElement).textContent = s.text;
    el.classList.remove("in");
    void el.offsetWidth;
    el.classList.add("in");
    shownAt = performance.now();
  };
  const frame = (now: number): void => {
    const s = slides[i];
    if (s) {
      PICS[s.pic](bctx, now / 1000);
      ctx.drawImage(buf, 0, 0);
    }
    raf = requestAnimationFrame(frame);
  };
  const next = (): void => {
    if (performance.now() - shownAt < 300) return;
    i++;
    if (i < slides.length) return show();
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    el.remove();
    done();
  };
  const onKey = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === "e" || k === "enter" || k === " ") {
      e.preventDefault();
      e.stopImmediatePropagation();
      next();
    }
  };
  el.addEventListener("click", next);
  window.addEventListener("keydown", onKey, true);
  show();
  raf = requestAnimationFrame(frame);
}

/* ---------------- 任务木牌（左上角） ---------------- */

export function plaqueHTML(p: Plaque | null): string {
  if (!p) return "";
  if (p.waitDay !== null) return `<span class="q-pin"></span><span class="q-text wait" title="下一段剧情">第${p.waitDay}天</span>`;
  const count = p.count > 1 ? `<b class="q-count">${p.progress}/${p.count}</b>` : "";
  return `<span class="q-pin"></span><span class="q-text">${esc(p.text)}</span>${count}`;
}

/* ---------------- 信 ---------------- */

export function mailHTML(m: Mail): string {
  return `<div class="letter mail">
    <h3 class="mail-title">${esc(m.title)}</h3>
    ${m.lines.map((l) => `<p>${esc(l)}</p>`).join("")}
    <div class="sign"><span>${esc(m.from)}</span>${m.seal ? `<span class="seal-sign">${esc(m.seal)}</span>` : ""}</div>
  </div>`;
}

/* ---------------- 日记本 ---------------- */

export function diaryHTML(pages: number[], text: Record<number, string>, total = 7): string {
  const found = new Set(pages);
  return `<div class="diary">${Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    return found.has(n)
      ? `<div class="d-page"><span class="d-no">${n}</span><p>${esc(text[n] ?? "")}</p></div>`
      : `<div class="d-page missing" title="还没找到"><span class="d-no">${n}</span><p>？</p></div>`;
  }).join("")}</div>`;
}

/* ---------------- 结局 ---------------- */

export function endingHTML(ending: Ending, state?: GameState): string {
  const e = state ? endingText(state, ending) : ENDINGS[ending];
  return `<div class="ending ${ending}">
    <span class="stamp-big">${esc(e.title)}</span>
    ${[e.lines[0], e.lines.at(-1)].filter(Boolean).map((l) => `<p class="say">${esc(l!)}</p>`).join("")}
  </div>`;
}
