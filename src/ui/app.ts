import { advanceTime, HOME, loadGame, saveGame } from "../game/state";
import { DAY_START, formatClock, MIDNIGHT } from "../game/season";
import { BUILDINGS, INTERACTS, MAP_H, MAP_W, regionAt, RING, type InteractId } from "../world/tiles";
import { MAP_PX } from "../world/minimap";
import { WorldScene } from "../world/world";
import { buildingSprite } from "../world/buildingArt";
import { themeFor } from "../audio/score";
import { WorldMusic } from "../audio/worldMusic";
import { ico, installPixelUI } from "./pixelui";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
type Actions = Record<string, () => void>;

export function startApp(root: HTMLElement): void {
  installPixelUI();
  const game = loadGame();
  let toastTimer = 0;
  let lastSave = 0;
  root.innerHTML = `
    <div class="game">
      <canvas id="world" class="view" aria-label="大世界"></canvas>
      <div class="hud">
        <button class="minimap" id="minimap" title="地图（M）" aria-label="打开地图">
          <canvas id="mm-canvas" width="80" height="56"></canvas>
          <span class="mm-name" id="mm-name" hidden></span>
        </button>
        <button class="world-clock" id="clock" title="时钟"></button>
        <div class="toolbar">
          <button class="tslot" id="b-home" title="回家" aria-label="回家">${ico("horse")}</button>
          <button class="tslot" id="b-menu" title="菜单（Esc）" aria-label="打开菜单">${ico("menu")}</button>
        </div>
      </div>
      <div class="veil" id="veil" hidden><div class="menu-frame" id="panel" role="dialog" aria-modal="true" aria-label="游戏面板"></div></div>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string): T => {
    const found = root.querySelector<T>(sel);
    if (!found) throw new Error(`找不到元素 ${sel}`);
    return found;
  };
  const veil = $("#veil");
  const panelEl = $("#panel");
  const persist = (): void => { saveGame(game); lastSave = performance.now(); };
  const toast = (text: string): void => {
    const el = $("#toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove("show"), 4000);
  };
  const world = new WorldScene($<HTMLCanvasElement>("#world"), game, {
    onInteract: (id) => openScene(id),
    onChange: persist,
  });
  world.minimapCanvas = $<HTMLCanvasElement>("#mm-canvas");
  const music = new WorldMusic(() => toast("音乐暂时无法播放，可点击音乐开关重试"));
  const updateMusic = (): void => music.update(themeFor(regionAt(game.player.x, game.player.z)?.id, world.clock), !document.hidden);
  const unlockMusic = (): void => { updateMusic(); void music.unlock(); };
  root.addEventListener("pointerdown", unlockMusic);
  document.addEventListener("keydown", unlockMusic);
  document.addEventListener("visibilitychange", () => { updateMusic(); persist(); });
  window.addEventListener("pagehide", persist);

  let actions: Actions = {};
  let previousFocus: HTMLElement | null = null;
  const closePanel = (): void => {
    veil.hidden = true;
    panelEl.innerHTML = "";
    actions = {};
    world.paused = false;
    previousFocus?.focus();
    previousFocus = null;
  };
  const panel = (title: string, body: string, acts: Actions = {}, opts: { cls?: string } = {}): void => {
    if (veil.hidden) previousFocus = document.activeElement as HTMLElement | null;
    world.paused = true;
    veil.hidden = false;
    panelEl.className = `menu-frame ${opts.cls ?? ""}`;
    panelEl.setAttribute("aria-label", title);
    panelEl.innerHTML = `<h2 class="m-title"><span>${esc(title)}</span></h2>
      <button class="m-x" data-act="close" aria-label="关闭">${ico("close")}</button>
      <div class="m-body">${body}</div>`;
    actions = { close: closePanel, ...acts };
    panelEl.querySelector<HTMLButtonElement>("button")?.focus();
  };
  panelEl.addEventListener("click", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (el && !el.hasAttribute("disabled")) actions[el.dataset.act ?? ""]?.();
  });
  veil.addEventListener("pointerdown", (event) => { if (event.target === veil) closePanel(); });

  const openScene = (id: InteractId): void => {
    const spot = INTERACTS.find((it) => it.id === id);
    if (!spot) return;
    panel(spot.label, `<div class="scene-preview"><canvas id="scene-preview" width="240" height="160" aria-label="${esc(spot.label)}"></canvas></div>
      <div class="row center"><button class="btn" data-act="close">返回世界</button></div>`);
    const c = $<HTMLCanvasElement>("#scene-preview");
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const buildingIds: Partial<Record<InteractId, string>> = { sleep: "home", barn: "barn", sequence: "seq", market: "market", bookie: "bookie", race: "booth" };
    const building = BUILDINGS.find((b) => b.id === buildingIds[id]);
    if (building) {
      const sprite = buildingSprite(building);
      const scale = Math.min(2, 220 / sprite.img.width, 145 / sprite.img.height);
      ctx.drawImage(sprite.img, (240 - sprite.img.width * scale) / 2, 150 - sprite.img.height * scale, sprite.img.width * scale, sprite.img.height * scale);
    } else {
      ctx.drawImage(world.minimap.base, Math.max(0, Math.min(MAP_W * MAP_PX - 80, spot.x * MAP_PX - 40)), Math.max(0, Math.min(MAP_H * MAP_PX - 50, spot.z * MAP_PX - 25)), 80, 50, 0, 10, 240, 150);
    }
  };

  /** 大地图上的地名：几片地方的名字，和挂了匾的房子。 */
  const MAP_PLACES: Array<{ text: string; x: number; z: number; big?: boolean }> = [
    { text: "赛马场", x: 22, z: 25, big: true },
    { text: "马蹄镇", x: 75, z: 30.5, big: true },
    { text: "研究所", x: 124, z: 18, big: true },
    { text: "擂台", x: 120, z: 46, big: true },
    { text: "牧场", x: 30, z: 87, big: true },
    { text: "野原", x: 98, z: 94, big: true },
    { text: "红帐篷", x: 85, z: 31 },
    ...(["wetland", "hill", "coast", "forest", "mountain"] as const).map(id => {
      const place = INTERACTS.find(p => p.id === id)!;
      return { text: place.label, x: place.x, z: place.z - 2 };
    }),
    ...BUILDINGS.filter((b) => b.sign).map((b) => ({ text: b.sign as string, x: b.x + b.w / 2, z: b.z - 0.4 })),
    { text: "擂台", x: RING.x, z: RING.z - RING.r - 1.6 },
  ];

  const openMap = (): void => {
    const w = MAP_W * MAP_PX;
    const h = MAP_H * MAP_PX;
    const labels = MAP_PLACES.map(
      (p) => `<span class="wm-label${p.big ? " big" : ""}" style="left:${((p.x / MAP_W) * 100).toFixed(2)}%;top:${((p.z / MAP_H) * 100).toFixed(2)}%">${esc(p.text)}</span>`,
    ).join("");
    panel("地图", `<div class="worldmap"><canvas id="wm-canvas" width="${w}" height="${h}"></canvas>${labels}</div>`, {}, { cls: "map" });
    const c = $<HTMLCanvasElement>("#wm-canvas");
    // 整数倍放大，像素方正；放不大的时候只留几片地方的名字。
    const k = Math.max(1, Math.floor(Math.min((window.innerWidth * 0.86) / w, (window.innerHeight * 0.76) / h)));
    c.parentElement?.classList.toggle("small", k < 2);
    c.style.width = `${w * k}px`;
    c.style.height = `${h * k}px`;
    const loop = (t: number): void => {
      if (!c.isConnected) return;
      world.minimap.drawFull(c, world.mapMarks(), t / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };


  const openClock = (): void => panel("时钟", `<div class="row center">
    <button class="btn" data-act="rest">休息一小时</button>
    <button class="btn" data-act="next">下一天</button></div>`, {
      rest: () => { advanceTime(game, 60); world.sync(); persist(); closePanel(); },
      next: () => { advanceTime(game, MIDNIGHT - game.clock); world.sync(); persist(); closePanel(); },
    });
  const openSettings = (): void => {
    panel("设置", `<div class="menu">
      <button class="btn" data-act="music" aria-pressed="${music.enabled}" ${music.supported ? "" : "disabled"}>背景音乐 ${music.enabled ? "开启" : "关闭"}</button>
      <label>音量 <input id="volume" type="range" min="0" max="100" value="${Math.round(music.volume * 100)}" aria-label="音乐音量"></label>
      <button class="btn" data-act="back">返回</button></div>`, {
        music: () => { music.setEnabled(!music.enabled); openSettings(); },
        back: openMenu,
      });
    $<HTMLInputElement>("#volume").addEventListener("input", (event) => music.setVolume(Number((event.target as HTMLInputElement).value) / 100));
  };
  const openMenu = (): void => panel("天马行空", `<div class="menu">
    <button class="btn" data-act="close">继续探索</button>
    <button class="btn" data-act="map">地图</button>
    <button class="btn" data-act="settings">设置</button>
    <button class="btn" data-act="keys">操作</button></div>`, {
      map: openMap,
      settings: openSettings,
      keys: () => toast("WASD移动　Shift跑步　点地面移动　E互动　M地图　Esc菜单"),
    });
  $("#minimap").addEventListener("click", openMap);
  $("#clock").addEventListener("click", openClock);
  $("#b-menu").addEventListener("click", openMenu);
  $("#b-home").addEventListener("click", () => { world.teleport(HOME.x, HOME.z); persist(); });
  window.addEventListener("keydown", (event) => {
    if ((event.target as HTMLElement | null)?.closest("input, textarea, select")) return;
    const key = event.key.toLowerCase();
    if (key === "escape") { if (veil.hidden) openMenu(); else closePanel(); }
    if (key === "m") { if (veil.hidden) openMap(); else closePanel(); }
    if (key === "tab" && !veil.hidden) {
      const focusable = [...panelEl.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  let seenDay = game.day;
  const loop = (now: number): void => {
    $("#clock").textContent = `第${game.day}天　${formatClock(world.clock)}`;
    const name = $("#mm-name");
    name.textContent = world.regionName;
    name.hidden = !name.textContent;
    if (seenDay !== game.day) { seenDay = game.day; world.sync(); }
    updateMusic();
    if (now - lastSave > 5000) persist();
    requestAnimationFrame(loop);
  };
  // 载入后直接展示世界。
  game.clock = Math.max(DAY_START, game.clock);
  persist();
  requestAnimationFrame(loop);
}
