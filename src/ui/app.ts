import { bodyPlanFrom } from "../body/bodyPlan";
import { encodeGenome, express, type Genome } from "../genome/genome";
import { LOCI, LOCUS_IDS } from "../genome/loci";
import { displayStats } from "../genome/traits";
import { coatFor } from "../render/color";
import { Race, type RaceResult } from "../sim/race";
import { hashSeed } from "../sim/rng";
import { SumoBout } from "../sim/sumo";
import { laozhaoLines, LETTER } from "../game/laozhao";
import {
  betLimit,
  betPayout,
  daysUntilDebt,
  debtDue,
  ENTRY_FEE,
  EVENT_LABELS,
  EVENT_TIME,
  eventFor,
  formatClock,
  MIDNIGHT,
  RACE_DISTANCE,
  SEQUENCING_FEE,
  weekOf,
  type EventKind,
} from "../game/season";
import {
  applyOutcome,
  findHorse,
  importHorse,
  isFoal,
  loadGame,
  mate,
  placeBet,
  register,
  resetGame,
  saveGame,
  sellHorse,
  sellPrice,
  sendToSequencing,
  sleep,
  STABLE_LIMIT,
  todaysField,
  todaysOdds,
  type EventOutcome,
  type GameState,
  type NightReport,
  type StableHorse,
} from "../game/state";
import { INTERACTS, type InteractId } from "../world/tiles";
import { WorldScene } from "../world/world";
import { drawPortrait } from "./portrait";
import { drawDial, ico, installPixelUI } from "./pixelui";
import { portraitURL } from "../world/sprites";
import { Stage } from "./stage";
import { SumoView } from "./sumoView";

const TRIAL_SECONDS = 10;
/** 试跑一次花掉的游戏时间（分钟）。 */
const TRIAL_MINUTES = 20;
/** 赛后回到世界时的钟点。 */
const AFTER_EVENT = 19 * 60;
const RACE_TIME_LIMIT = 120;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** 几段短信息并排摆放，用间距隔开，不用分隔符。 */
const parts = (...items: Array<string | false | null | undefined>): string =>
  `<span class="parts">${items.filter(Boolean).map((t) => `<i>${t}</i>`).join("")}</span>`;

/** 中文数字（1–99），毛笔字体写阿拉伯数字不好看。 */
const DIGITS = "零一二三四五六七八九";
const cn = (n: number): string => {
  if (n < 10) return DIGITS[n] as string;
  if (n >= 100) return String(n);
  const t = Math.floor(n / 10);
  const u = n % 10;
  return `${t > 1 ? DIGITS[t] : ""}十${u ? DIGITS[u] : ""}`;
};

const money = (n: number): string => `<span class="coin-num">${ico("coin")}${n.toLocaleString("zh-CN")}</span>`;

/** 钱袋里一格一个数字，前面空格补齐。 */
const goldCells = (n: number): string => {
  const digits = String(Math.max(0, Math.floor(n))).padStart(7, " ").slice(-8);
  return [...digits].map((d) => `<b class="cell">${d === " " ? "" : d}</b>`).join("");
};

const EVENT_ICON: Record<EventKind, "flag" | "ring" | "crown"> = { race: "flag", sumo: "ring", boss: "crown" };

/** 说话的人有头像的就配上。 */
const PORTRAIT: Record<string, "laozhao" | "madong"> = { 老赵: "laozhao", 马董: "madong" };

const EVENT_GLYPH: Record<EventKind, string> = { race: "跑", sumo: "扑", boss: "擂" };

/** 场地的入口，赛后把人放回这里。 */
const VENUE: Record<EventKind, InteractId> = { race: "race", sumo: "sumo", boss: "sumo" };

type Actions = Record<string, (arg: string, el: HTMLElement) => void>;

interface PanelOptions {
  cls?: string;
  closable?: boolean;
  onClose?: () => void;
}

export function startApp(root: HTMLElement): void {
  installPixelUI();
  let game: GameState = loadGame();
  let mode: "world" | "event" = "world";
  let toastTimer = 0;
  let lastSave = 0;

  root.innerHTML = `
    <div class="game">
      <canvas id="world" class="view" aria-label="大世界"></canvas>
      <canvas id="race" class="view" hidden aria-label="赛场"></canvas>
      <canvas id="sumo" class="view" hidden aria-label="相扑台"></canvas>
      <div class="hud" id="hud">
        <div class="clockbox">
          <div class="cb-main">
            <canvas class="cb-dial" id="h-dial" width="20" height="34"></canvas>
            <div class="cb-info">
              <div class="cb-date" id="h-day"></div>
              <div class="cb-event" id="h-event"></div>
              <div class="cb-time" id="h-clock"></div>
            </div>
          </div>
          <div class="cb-gold" id="h-money" title="钱"></div>
        </div>
        <div class="debt-note" id="h-debt"></div>
        <div class="toolbar" id="toolbar"></div>
        <div class="keys" id="h-keys" hidden>
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>走</span>
          <span><kbd>Shift</kbd>跑</span>
          <span><kbd>E</kbd>动作</span>
          <span><kbd>Tab</kbd>马厩</span>
        </div>
      </div>
      <div class="event-bar" id="event-bar" hidden>
        <button class="chip-btn" data-speed="1">1×</button>
        <button class="chip-btn" data-speed="2">2×</button>
        <button class="chip-btn" data-speed="4">4×</button>
        <button class="btn sm" id="b-skip">跳过</button>
      </div>
      <div class="veil" id="veil" hidden><div class="menu-frame" id="panel" role="dialog"></div></div>
      <div class="talk" id="talk" hidden></div>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
      <div class="curtain" id="curtain"></div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string): T => {
    const found = root.querySelector<T>(sel);
    if (!found) throw new Error(`找不到元素 ${sel}`);
    return found;
  };
  const worldCanvas = $<HTMLCanvasElement>("#world");
  const raceCanvas = $<HTMLCanvasElement>("#race");
  const sumoCanvas = $<HTMLCanvasElement>("#sumo");
  const veil = $<HTMLDivElement>("#veil");
  const panelEl = $<HTMLDivElement>("#panel");
  const talkEl = $<HTMLDivElement>("#talk");
  const eventBar = $<HTMLDivElement>("#event-bar");
  const curtain = $<HTMLDivElement>("#curtain");

  const persist = (): void => {
    saveGame(game);
    lastSave = performance.now();
  };

  const toast = (text: string): void => {
    const t = $<HTMLDivElement>("#toast");
    t.textContent = text;
    t.classList.remove("show");
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.classList.remove("show"), 2400);
  };

  const world = new WorldScene(worldCanvas, game, {
    onInteract: (id) => interact(id),
    onHorseClick: (id) => openDetail(id),
    onCaught: (id, name) => {
      persist();
      hud();
      const h = findHorse(game, id);
      if (h) showCaught(h, name);
    },
    onToast: toast,
    onChange: () => {
      persist();
      hud();
    },
  });
  const stage = new Stage(raceCanvas);
  stage.active = false;
  stage.time = "dusk";
  const sumoView = new SumoView(sumoCanvas);

  /* ---------------- HUD ---------------- */

  const hud = (): void => {
    const kind = eventFor(game.day);
    $("#h-day").textContent = `第${cn(game.day)}天`;
    $("#h-clock").textContent = formatClock(game.clock);
    drawDial($<HTMLCanvasElement>("#h-dial"), (game.clock - 360) / (MIDNIGHT - 360));
    const done = !!game.flags[`ev:${game.day}`];
    const entered = game.entry?.day === game.day;
    const bet = game.bet?.day === game.day;
    const soon = !done && game.clock >= EVENT_TIME - 120;
    const ev = $("#h-event");
    ev.className = `cb-event ${kind}${soon ? " soon" : ""}${done ? " done" : ""}`;
    ev.title = done ? "今天的赛事结束了" : `${EVENT_LABELS[kind]}　傍晚五点开赛`;
    ev.innerHTML = `${ico(EVENT_ICON[kind])}<span>${EVENT_LABELS[kind]}</span>${entered ? `<i class="seal-chip" title="已报名">报</i>` : ""}${bet ? `<i class="seal-chip gold" title="已下注">注</i>` : ""}`;
    $("#h-money").innerHTML = goldCells(game.money);
    const due = debtDue(game.day);
    const left = daysUntilDebt(game.day);
    const debt = $("#h-debt");
    debt.hidden = due <= 0;
    debt.classList.toggle("urgent", left <= 1);
    debt.title = `第${cn(weekOf(game.day))}周要还给马董`;
    debt.innerHTML = `<i class="seal-chip">债</i><b>${due.toLocaleString("zh-CN")}</b><small>${left === 0 ? "今夜" : `${left}天`}</small>`;
    toolbar();
  };

  /** 底部工具栏：套索、名望、马厩里的马、马厩和菜单。 */
  const TOOLBAR_HORSES = 6;
  let toolbarKey = "";
  const toolbar = (): void => {
    const horses = game.horses.slice(0, TOOLBAR_HORSES);
    const key = JSON.stringify([game.lassos, game.reputation, horses.map((h) => [h.id, h.name, game.selectedId === h.id])]);
    if (key === toolbarKey) return;
    toolbarKey = key;
    const tb = $("#toolbar");
    tb.innerHTML = `
      <span class="tslot${game.lassos ? "" : " empty"}" title="今天剩下的套索">${ico("rope")}<b class="stack">${game.lassos}</b></span>
      <span class="tslot" title="名望　下注上限 ${betLimit(game.reputation)}">${ico("shoe")}<b class="stack">${game.reputation}</b></span>
      <i class="tsep"></i>
      ${Array.from({ length: TOOLBAR_HORSES }, (_, i) => {
        const h = horses[i];
        return h
          ? `<button class="tslot horse${game.selectedId === h.id ? " on" : ""}" data-horse="${h.id}" title="${esc(h.name)}"><canvas data-pt="${h.id}"></canvas><small class="num">${i + 1}</small></button>`
          : `<span class="tslot"><small class="num">${i + 1}</small></span>`;
      }).join("")}
      <i class="tsep"></i>
      <button class="tslot" id="b-stable" title="马厩（Tab）">${ico("horse")}</button>
      <button class="tslot" id="b-menu" title="菜单（Esc）">${ico("menu")}</button>`;
    drawPortraits(tb);
  };

  /* ---------------- 面板 ---------------- */

  let actions: Actions = {};
  let onPanelClose: (() => void) | null = null;
  let closable = true;

  const portraitOf = (id: string): Genome | undefined => findHorse(game, id)?.genome ?? game.rivals.find((r) => r.id === id)?.genome;

  const drawPortraits = (scope: ParentNode): void => {
    scope.querySelectorAll<HTMLCanvasElement>("canvas[data-pt]").forEach((c) => {
      const g = portraitOf(c.dataset.pt as string);
      if (g) drawPortrait(c, g, "noon", c.dataset.bust !== undefined);
    });
  };

  const panel = (title: string, body: string, acts: Actions = {}, opts: PanelOptions = {}): void => {
    const fresh = veil.hidden;
    veil.hidden = false;
    closable = opts.closable !== false;
    panelEl.className = `menu-frame${opts.cls ? ` ${opts.cls}` : ""}${fresh ? " enter" : ""}`;
    panelEl.innerHTML = `
      ${title ? `<h2 class="m-title"><span>${title}</span></h2>` : ""}
      ${closable ? `<button class="m-x" data-act="close" aria-label="关闭">${ico("close")}</button>` : ""}
      <div class="m-body">${body}</div>`;
    actions = { close: () => closePanel(), ...acts };
    onPanelClose = opts.onClose ?? null;
    world.paused = true;
    drawPortraits(panelEl);
  };

  const closePanel = (): void => {
    if (veil.hidden) return;
    veil.hidden = true;
    panelEl.innerHTML = "";
    const cb = onPanelClose;
    onPanelClose = null;
    actions = {};
    if (talkEl.hidden && mode === "world") world.paused = false;
    cb?.();
    hud();
  };

  panelEl.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el || !panelEl.contains(el) || el.hasAttribute("disabled")) return;
    actions[el.dataset.act as string]?.(el.dataset.arg ?? "", el);
  });
  veil.addEventListener("pointerdown", (e) => {
    if (e.target === veil && closable) closePanel();
  });

  /* ---------------- 对白 ---------------- */

  let talkLines: string[] = [];
  let talkIndex = 0;
  let talkThen: (() => void) | null = null;
  let talkOpened = 0;

  const talk = (name: string, lines: string[], then?: () => void): void => {
    talkLines = lines;
    talkIndex = 0;
    talkThen = then ?? null;
    talkOpened = performance.now();
    talkEl.hidden = false;
    world.paused = true;
    talkEl.dataset.name = name;
    renderTalk();
  };
  const renderTalk = (): void => {
    const name = talkEl.dataset.name ?? "";
    const who = PORTRAIT[name];
    talkEl.innerHTML = `<div class="t-text"><p>${esc(talkLines[talkIndex] ?? "")}</p><span class="t-more"></span></div>
      ${who ? `<div class="t-face"><span class="t-pic"><img src="${portraitURL(who)}" alt="" /></span><span class="t-name">${esc(name)}</span></div>` : ""}`;
  };
  const advanceTalk = (): void => {
    if (performance.now() - talkOpened < 200) return;
    talkIndex++;
    if (talkIndex < talkLines.length) return renderTalk();
    talkEl.hidden = true;
    if (veil.hidden && mode === "world") world.paused = false;
    const then = talkThen;
    talkThen = null;
    then?.();
  };
  talkEl.addEventListener("click", advanceTalk);

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement | null)?.closest("input, textarea")) return;
    const k = e.key.toLowerCase();
    if (!talkEl.hidden && (k === "e" || k === "enter" || k === " ")) {
      e.preventDefault();
      advanceTalk();
      return;
    }
    if (k === "escape") {
      if (!veil.hidden) {
        if (closable) closePanel();
      } else if (mode === "world" && talkEl.hidden) openMenu();
    }
    if (k === "tab" && mode === "world" && talkEl.hidden) {
      e.preventDefault();
      if (veil.hidden) openStable();
      else if (closable) closePanel();
    }
  });

  /* ---------------- 马的小卡片 ---------------- */

  const horseTags = (h: StableHorse): string => {
    const tags: string[] = [];
    if (isFoal(h, game.day)) tags.push(`<span class="tag">小马</span>`);
    if (game.entry?.day === game.day && game.entry.horseId === h.id) tags.push(`<span class="tag red">出赛</span>`);
    if (game.pregnancies.some((p) => p.damId === h.id || p.sireId === h.id)) tags.push(`<span class="tag pink">配种</span>`);
    if (h.sequencing) tags.push(`<span class="tag">测序中</span>`);
    if (h.mutations.length) tags.push(`<span class="tag gold">突变</span>`);
    return tags.join("");
  };

  const card = (h: StableHorse, opts: { act?: string; on?: boolean; off?: boolean; badge?: string } = {}): string => `
    <button class="hcard${opts.on ? " on" : ""}${opts.off ? " off" : ""}" data-act="${opts.act ?? "detail"}" data-arg="${h.id}" ${opts.off ? "disabled" : ""}>
      <span class="frame"><canvas data-pt="${h.id}"></canvas></span>
      <span class="nm">${esc(h.name)}</span>
      <span class="tags">${horseTags(h)}</span>
      ${opts.badge ? `<span class="badge">${opts.badge}</span>` : ""}
    </button>`;

  const statBars = (h: StableHorse): string => {
    const s = displayStats(express(h.genome));
    const row = (glyph: string, label: string, v: number, hint: string): string => `
      <div class="stat" title="${label} ${v}　${hint}">
        <span class="s-glyph">${glyph}</span>
        <span class="notches">${Array.from({ length: 10 }, (_, i) => `<i class="${i < Math.round(v / 10) ? "on" : ""}"></i>`).join("")}</span>
        <b>${v}</b>
      </div>`;
    return `<div class="stats">
      ${row("速", "速度", s.speed, "腿长、肌力、步频")}
      ${row("稳", "稳定", s.stability, "躯干厚、蹄宽；腿太长容易翻")}
      ${row("力", "力量", s.strength, "体型和肌力，相扑看这个")}
      ${row("耐", "耐力", s.endurance, "体质")}
    </div>`;
  };

  const geneGrid = (h: StableHorse): string => {
    const p = express(h.genome);
    const mutated = new Set(h.mutations);
    return `<div class="genes${h.sequenced ? "" : " locked"}" title="${h.sequenced ? "" : "去镇上测序才能看到基因"}">
      ${LOCUS_IDS.map((id) => {
        const info = LOCI[id];
        if (!h.sequenced) return `<span class="gene"><small>${info.name}</small><b>?</b></span>`;
        const [a, b] = h.genome[id];
        return `<span class="gene${mutated.has(id) ? " mut" : ""}" title="${info.name} ${a > 0 ? "+" : ""}${a} ${b > 0 ? "+" : ""}${b}　＋${esc(info.plus)}　－${esc(info.minus)}">
          <small>${info.name}</small>
          <span class="g-track"><i style="left:${((p[id] + 2) / 4) * 100}%"></i></span>
        </span>`;
      }).join("")}
    </div>`;
  };

  /* ---------------- 马厩和马的详情 ---------------- */

  const openStable = (): void => {
    const pregnant = game.pregnancies.length;
    panel(
      "马厩",
      `<div class="count-plaque">${game.horses.length + pregnant}<small>/${STABLE_LIMIT}</small></div>
       <div class="roster">${game.horses.map((h) => card(h)).join("")}${Array.from({ length: pregnant }, () => `<span class="hcard ghost"><span class="frame"><b>?</b></span><span class="nm">明早出生</span></span>`).join("")}</div>`,
      { detail: (id) => openDetail(id, openStable) },
      { cls: "wide" },
    );
  };

  const openDetail = (id: string, back?: () => void): void => {
    const h = findHorse(game, id);
    if (!h) return;
    game.selectedId = id;
    const p = express(h.genome);
    const plan = bodyPlanFrom(p);
    const code = encodeGenome(h.genome);
    const pub = h.pub;
    panel(
      "",
      `<div class="d-head">
        <span class="frame big"><canvas data-pt="${h.id}"></canvas></span>
        <div class="d-id">
          <h3 class="title-txt">${esc(h.name)}</h3>
          <p>${parts(h.generation ? `第${cn(h.generation)}代` : "初代", `${coatFor(p.coat).name}马`, `${Math.round(plan.totalMass)}公斤`)}</p>
          ${h.parents ? `<p class="lineage">${esc(h.parents[0])} <i>×</i> ${esc(h.parents[1])}</p>` : ""}
          <p class="tags">${horseTags(h)}</p>
        </div>
      </div>
      ${statBars(h)}
      <div class="record">
        <span title="平地赛"><b>${pub.races}</b><small>出赛</small></span>
        <span title="平地赛冠军"><b>${pub.wins}</b><small>冠军</small></span>
        <span title="相扑胜场"><b>${pub.sumoWins}</b><small>扑胜</small></span>
        <span title="试跑 10 秒最远（米）"><b>${h.record.bestTrial ? h.record.bestTrial.toFixed(0) : "-"}</b><small>试跑</small></span>
      </div>
      ${geneGrid(h)}
      <div class="code-row"><code title="把马码发给朋友，对方在牧场的告示牌导入">${code}</code><button class="btn wood sm" data-act="copy">复制</button>${back ? `<button class="btn sm" data-act="back">返回</button>` : ""}</div>`,
      {
        copy: () => {
          const done = (): void => toast("马码已复制");
          navigator.clipboard?.writeText(code).then(done, () => toast(code)) ?? toast(code);
        },
        back: () => back?.(),
      },
      { cls: "detail" },
    );
  };

  /* ---------------- 地点 ---------------- */

  const interact = (id: InteractId): void => {
    if (mode !== "world" || !veil.hidden || !talkEl.hidden) return;
    switch (id) {
      case "sleep":
        return askSleep();
      case "barn":
        return openBarn();
      case "board":
        return openBoard();
      case "sequence":
        return openSequencing();
      case "market":
        return openMarket();
      case "bookie":
        return openBookie();
      case "sumo":
        return openRegister("sumo");
      case "race":
        return openRegister("race");
      case "laozhao":
        return talk("老赵", laozhaoLines(game), persist);
    }
  };

  /* 配种 */
  const breedPick: string[] = [];
  const openBarn = (): void => {
    const pick = breedPick.filter((id) => findHorse(game, id));
    breedPick.length = 0;
    breedPick.push(...pick);
    const usable = (h: StableHorse): boolean => !isFoal(h, game.day) && h.bredDay !== game.day;
    const slot = (i: number): string => {
      const h = breedPick[i] ? findHorse(game, breedPick[i] as string) : undefined;
      return h
        ? `<button class="slot filled" data-act="unpick" data-arg="${h.id}"><span class="frame"><canvas data-pt="${h.id}"></canvas></span><span class="nm">${esc(h.name)}</span></button>`
        : `<span class="slot"><b>${i === 0 ? "一" : "二"}</b></span>`;
    };
    const full = game.horses.length + game.pregnancies.length >= STABLE_LIMIT;
    panel(
      "配种",
      `<div class="breed">
        ${slot(0)}<span class="heart">♥</span>${slot(1)}
      </div>
      <div class="row center"><button class="btn big" data-act="mate" ${breedPick.length < 2 || full ? "disabled" : ""}>配种</button></div>
      ${full ? `<p class="warn-line">马厩满了</p>` : ""}
      <div class="roster compact">${game.horses
        .filter((h) => !breedPick.includes(h.id))
        .map((h) => card(h, { act: "pick", off: !usable(h) }))
        .join("")}</div>`,
      {
        pick: (id) => {
          if (breedPick.length >= 2) breedPick.shift();
          breedPick.push(id);
          openBarn();
        },
        unpick: (id) => {
          breedPick.splice(breedPick.indexOf(id), 1);
          openBarn();
        },
        mate: () => {
          const [a, b] = breedPick;
          const res = mate(game, a as string, b as string);
          if (!res.ok) return toast(res.reason);
          breedPick.length = 0;
          persist();
          toast("配上了，明早出生");
          openBarn();
        },
      },
      { cls: "wide" },
    );
  };

  /* 测序 */
  const openSequencing = (): void => {
    panel(
      "测序",
      `<div class="price-head">${money(SEQUENCING_FEE)}<small>一匹</small><small>明早出结果</small></div>
       <div class="roster">${game.horses
         .map((h) =>
           card(h, {
             act: h.sequenced || h.sequencing ? "detail" : "seq",
             badge: h.sequenced ? `<span class="stamp-s">已测</span>` : h.sequencing ? `<span class="stamp-s grey">明早</span>` : "",
           }),
         )
         .join("")}</div>`,
      {
        detail: (id) => openDetail(id, openSequencing),
        seq: (id) => {
          const res = sendToSequencing(game, id);
          if (!res.ok) return toast(res.reason);
          persist();
          toast("收下了，明早出结果");
          openSequencing();
        },
      },
      { cls: "wide" },
    );
  };

  /* 马市 */
  let selling: string | null = null;
  const openMarket = (): void => {
    panel(
      "马市",
      `<div class="roster">${game.horses
        .map((h) => card(h, { act: "sell", on: selling === h.id, badge: `<span class="price">${money(sellPrice(game, h))}</span>` }))
        .join("")}</div>
       <div class="row center">${
         selling && findHorse(game, selling)
           ? `<button class="btn big" data-act="confirm">卖掉${esc(findHorse(game, selling)!.name)}</button>`
           : `<span class="hint-line">选一匹马</span>`
       }</div>`,
      {
        sell: (id) => {
          selling = selling === id ? null : id;
          openMarket();
        },
        confirm: () => {
          if (!selling) return;
          const name = findHorse(game, selling)?.name ?? "";
          const res = sellHorse(game, selling);
          if (!res.ok) return toast(res.reason);
          selling = null;
          persist();
          world.sync();
          toast(`${name}卖掉了`);
          openMarket();
        },
      },
      { cls: "wide", onClose: () => (selling = null) },
    );
  };

  /* 马码告示牌 */
  const openBoard = (): void => {
    panel(
      "马码",
      `<div class="board">
        <input id="code-in" class="code-in" autocomplete="off" spellcheck="false" placeholder="TM2-" />
        <button class="btn" data-act="import">牵进来</button>
      </div>`,
      {
        import: () => {
          const input = panelEl.querySelector<HTMLInputElement>("#code-in");
          const res = importHorse(game, input?.value ?? "");
          if (res === "full") return toast("马厩满了");
          if (res === "invalid") return toast("马码不对");
          persist();
          world.sync();
          closePanel();
          toast(`${res.name}进了马厩`);
        },
      },
    );
    panelEl.querySelector<HTMLInputElement>("#code-in")?.focus();
  };

  /* 报名（赛马场门口或相扑台） */
  let regPick: string | null = null;
  const openRegister = (venue: "race" | "sumo"): void => {
    const kind = eventFor(game.day);
    const today = kind === "race" ? "race" : "sumo";
    const done = !!game.flags[`ev:${game.day}`];
    if (venue === "sumo" && today !== "sumo") return toast(`今天是${EVENT_LABELS[kind]}，相扑在双日`);
    const canEnter = today === venue && !done && game.clock < EVENT_TIME;
    const entered = game.entry?.day === game.day ? findHorse(game, game.entry.horseId) : undefined;
    const ready = game.horses.filter((h) => !isFoal(h, game.day));
    if (!regPick || !ready.some((h) => h.id === regPick)) regPick = ready[0]?.id ?? null;
    const rivals = todaysField(game).filter((f) => !f.mine);
    const title = venue === "race" ? (today === "race" ? EVENT_LABELS.race : "赛马场") : EVENT_LABELS[kind];
    const rivalRow =
      today === venue && !done
        ? `<div class="rivals">${rivals
            .map((r) => {
              const mass = Math.round(bodyPlanFrom(express(r.genome)).totalMass);
              return `<span class="rival" title="${esc(r.owner)}的马"><span class="frame sm"><canvas data-pt="${r.id}"></canvas></span><b>${esc(r.name)}</b>${venue === "sumo" ? `<small>${mass}公斤</small>` : ""}</span>`;
            })
            .join("")}</div>`
        : "";
    const status = entered
      ? `<div class="entered"><span class="stamp-s">已报名</span><b>${esc(entered.name)}</b></div>`
      : done
        ? `<p class="hint-line">今天散场了</p>`
        : "";
    panel(
      title,
      `${rivalRow}
       ${status}
       <div class="roster compact">${ready.map((h) => card(h, { act: "pick", on: regPick === h.id })).join("")}</div>
       <div class="row center">
         ${venue === "race" ? `<button class="btn wood big" data-act="trial" ${regPick ? "" : "disabled"} title="单独跑 ${TRIAL_SECONDS} 秒，看看能跑多远">试跑</button>` : ""}
         ${canEnter && !entered ? `<button class="btn big" data-act="enter" ${regPick ? "" : "disabled"}>报名 ${money(ENTRY_FEE)}</button>` : ""}
       </div>`,
      {
        pick: (id) => {
          regPick = id;
          openRegister(venue);
        },
        enter: () => {
          if (!regPick) return;
          const res = register(game, regPick);
          if (!res.ok) return toast(res.reason);
          persist();
          toast("报上名了，傍晚五点开赛");
          openRegister(venue);
        },
        trial: () => {
          if (!regPick) return;
          if (game.clock + TRIAL_MINUTES >= MIDNIGHT) return toast("太晚了");
          const h = findHorse(game, regPick);
          if (h) {
            closePanel();
            runTrial(h);
          }
        },
      },
      { cls: "wide" },
    );
  };

  /* 下注 */
  let betPick: string | null = null;
  let stake = 50;
  let insured = false;
  const openBookie = (): void => {
    if (game.flags[`ev:${game.day}`] || game.clock >= EVENT_TIME) return toast("收摊了，明天请早");
    const field = todaysField(game);
    const odds = todaysOdds(game);
    const limit = Math.min(betLimit(game.reputation), game.money);
    const placed = game.bet?.day === game.day ? game.bet : null;
    if (!betPick || !field.some((f) => f.id === betPick)) betPick = field[0]?.id ?? null;
    stake = Math.max(10, Math.min(stake, limit));
    const pickIndex = field.findIndex((f) => f.id === betPick);
    const pickOdds = (odds[pickIndex] ?? 1) as number;
    const board = `<div class="odds-board">${field
      .map((f, i) => {
        const o = odds[i] as number;
        const isPlaced = placed?.horseId === f.id;
        return `<button class="odds-row${f.mine ? " mine" : ""}${betPick === f.id ? " on" : ""}" data-act="pick" data-arg="${f.id}" ${placed ? "disabled" : ""}>
          <span class="frame sm"><canvas data-pt="${f.id}"></canvas></span>
          <span class="o-name"><b>${esc(f.name)}</b><small>${esc(f.owner)}</small></span>
          <span class="o-odds${o >= 10 ? " long" : ""}">${o.toFixed(1)}<small>倍</small></span>
          ${isPlaced ? `<span class="stamp-s">押</span>` : ""}
        </button>`;
      })
      .join("")}</div>`;
    const ticket = placed
      ? `<div class="ticket"><span>${esc(field.find((f) => f.id === placed.horseId)?.name ?? "")}</span><b>${money(placed.amount)}</b><span>${placed.odds.toFixed(1)}倍</span>${placed.insured ? `<span class="mini-seal">保</span>` : ""}</div>`
      : `<div class="stake">
          ${[10, 50, 100, limit]
            .filter((v, i, a) => v >= 10 && v <= limit && a.indexOf(v) === i)
            .map((v) => `<button class="chip-btn${stake === v ? " on" : ""}" data-act="stake" data-arg="${v}">${v === limit && limit > 100 ? "全押" : v}</button>`)
            .join("")}
          <button class="ins${insured ? " on" : ""}" data-act="ins" title="输了退一半本金，赢了只拿八成"><span class="mini-seal">保</span></button>
        </div>
        <div class="row center">
          <span class="payout" title="赢了能拿回">${money(betPayout(stake, pickOdds, true, insured))}</span>
          <button class="btn big" data-act="bet" ${limit < 10 ? "disabled" : ""}>押 ${money(stake)}</button>
        </div>`;
    panel(
      `${EVENT_LABELS[eventFor(game.day)]}赔率`,
      `${board}${ticket}`,
      {
        pick: (id) => {
          betPick = id;
          openBookie();
        },
        stake: (v) => {
          stake = Number(v);
          openBookie();
        },
        ins: () => {
          insured = !insured;
          openBookie();
        },
        bet: () => {
          if (!betPick) return;
          const res = placeBet(game, betPick, stake, insured);
          if (!res.ok) return toast(res.reason);
          persist();
          openBookie();
        },
      },
      { cls: "wide" },
    );
  };

  /* 套到马 */
  const showCaught = (h: StableHorse, name: string): void => {
    panel(
      "",
      `<div class="caught">
        <span class="frame big"><canvas data-pt="${h.id}"></canvas></span>
        <h3 class="title-txt">${esc(h.name)}</h3>
        <span class="stamp-big">入厩</span>
      </div>
      <div class="row center"><button class="btn big" data-act="close">好</button></div>`,
      {},
      { cls: "narrow" },
    );
    void name;
  };

  /* ---------------- 睡觉和夜晚结算 ---------------- */

  const askSleep = (): void => {
    const pending = !game.flags[`ev:${game.day}`] && game.clock < EVENT_TIME && (game.entry?.day === game.day || game.bet?.day === game.day);
    if (!pending) return goToSleep();
    panel(
      "睡觉",
      `<p class="say">今天的${EVENT_LABELS[eventFor(game.day)]}还没开赛。</p>
       <div class="row center"><button class="btn wood big" data-act="close">再等等</button><button class="btn big" data-act="sleep">睡</button></div>`,
      { sleep: () => goToSleep() },
      { cls: "narrow" },
    );
  };

  const fade = (mid: () => void): void => {
    curtain.classList.add("on");
    world.paused = true;
    window.setTimeout(() => {
      mid();
      window.setTimeout(() => curtain.classList.remove("on"), 60);
    }, 650);
  };

  const goToSleep = (forced = false): void => {
    closePanel();
    world.paused = true;
    fade(() => {
      const report = sleep(game);
      world.setState(game);
      persist();
      hud();
      showNight(report, forced);
    });
  };

  const showNight = (r: NightReport, forced: boolean): void => {
    const total = r.ledger.reduce((a, l) => a + l.amount, 0);
    const lines = r.ledger
      .map((l) => `<li><span>${esc(l.label)}</span><b class="${l.amount >= 0 ? "plus" : "minus"}">${l.amount >= 0 ? "+" : "−"}${Math.abs(l.amount)}</b></li>`)
      .join("");
    const foals = r.foals.length
      ? `<div class="news"><span class="news-tag">出生</span><div class="roster compact">${r.foals.map((h) => card(h, { act: "none" })).join("")}</div></div>`
      : "";
    const seq = r.sequenced.length ? `<div class="news"><span class="news-tag">测序</span>${r.sequenced.map((h) => `<span class="tag">${esc(h.name)}</span>`).join("")}</div>` : "";
    const grown = r.grownUp.length ? `<div class="news"><span class="news-tag">长大</span>${r.grownUp.map((h) => `<span class="tag">${esc(h.name)}</span>`).join("")}</div>` : "";
    if (r.ruined) return showRuined(r);
    panel(
      `第${cn(r.day)}天`,
      `${forced ? `<p class="say">累倒在路边，被人抬回了家。</p>` : ""}
       <ul class="ledger">${lines || `<li class="empty"><span>没进没出</span></li>`}</ul>
       <div class="ledger-total"><span>今天</span><b class="${total >= 0 ? "plus" : "minus"}">${total >= 0 ? "+" : "−"}${Math.abs(total)}</b><span class="purse-now">${money(game.money)}</span></div>
       ${r.debtPaid ? `<div class="debt-paid"><span class="stamp-big">还清</span><span>${money(r.debtPaid)}</span>${debtDue(game.day) ? `<small>下一笔 ¥${debtDue(game.day).toLocaleString("zh-CN")}</small>` : ""}</div>` : ""}
       ${foals}${seq}${grown}
       <div class="row center"><button class="btn big" data-act="close">天亮了</button></div>`,
      { none: () => undefined },
      { cls: "night", closable: true, onClose: morning },
    );
  };

  const morning = (): void => {
    hud();
    persist();
    if (eventFor(game.day) === "boss" && !game.flags[`boss-hint:${game.day}`]) {
      game.flags[`boss-hint:${game.day}`] = true;
      toast("今天老赵摆擂台");
    }
  };

  const showRuined = (r: NightReport): void => {
    panel(
      "",
      `<div class="ruin">
        <span class="stamp-big huge">查封</span>
        <p class="say">第${r.day}天夜里，马董带人来收牧场。</p>
        <p class="say">还差 ${money(Math.max(0, debtDue(r.day) - game.money))}</p>
      </div>
      <div class="row center"><button class="btn big" data-act="restart">从头再来</button></div>`,
      {
        restart: () => {
          game = resetGame();
          world.setState(game);
          closePanel();
          hud();
          intro();
        },
      },
      { cls: "narrow", closable: false },
    );
  };

  /* ---------------- 赛事 ---------------- */

  const setEventSpeed = (v: number): void => {
    stage.speed = v;
    sumoView.speed = v;
    eventBar.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === v));
  };
  eventBar.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.addEventListener("click", () => setEventSpeed(Number(b.dataset.speed))));
  $("#b-skip").addEventListener("click", () => {
    stage.skip();
    sumoView.skip();
  });

  const enterEventView = (canvas: HTMLCanvasElement): void => {
    mode = "event";
    world.active = false;
    worldCanvas.hidden = true;
    canvas.hidden = false;
    $("#hud").hidden = true;
    eventBar.hidden = false;
    setEventSpeed(1);
  };

  const leaveEventView = (venue: InteractId | null): void => {
    stage.clear();
    stage.active = false;
    sumoView.stop();
    raceCanvas.hidden = true;
    sumoCanvas.hidden = true;
    eventBar.hidden = true;
    worldCanvas.hidden = false;
    $("#hud").hidden = false;
    mode = "world";
    world.active = true;
    world.paused = false;
    if (venue) {
      const spot = INTERACTS.find((i) => i.id === venue);
      if (spot) world.teleport(spot.x, spot.z + 1);
    }
    persist();
    hud();
  };

  const runTrial = (h: StableHorse): void => {
    game.clock += TRIAL_MINUTES;
    const seed = hashSeed(`trial:${h.id}:${h.record.trials}`);
    const race = new Race([{ id: h.id, name: h.name, genome: h.genome }], { distance: 10_000, seed, timeLimit: TRIAL_SECONDS });
    enterEventView(raceCanvas);
    stage.time = game.clock < 10 * 60 ? "dawn" : game.clock < 16 * 60 ? "noon" : game.clock < 19 * 60 ? "dusk" : "night";
    stage.active = true;
    stage.show(race, {
      mode: "trial",
      player: 0,
      onFinish: (r) => {
        const res = r.results()[0] as RaceResult;
        const prev = h.record.bestTrial;
        h.record.trials++;
        h.record.falls += res.falls;
        h.record.bestTrial = Math.max(prev, res.distance);
        persist();
        panel(
          "",
          `<div class="trial-res">
            <h3 class="title-txt">${esc(h.name)}</h3>
            <div class="big-num">${res.distance.toFixed(1)}<small>米</small></div>
            <p>${parts(`${((res.distance / TRIAL_SECONDS) * 3.6).toFixed(0)}公里/时`, res.falls > 0 && `<span class="tag red">摔倒</span>`, res.stalls > 0 && `<span class="tag">发呆</span>`)}</p>
            ${res.distance > prev && prev > 0 ? `<span class="stamp-big">新纪录</span>` : ""}
          </div>
          <div class="row center"><button class="btn wood big" data-act="again">再跑</button><button class="btn big" data-act="close">离开</button></div>`,
          {
            again: () => {
              if (game.clock + TRIAL_MINUTES >= MIDNIGHT) return toast("太晚了");
              onPanelClose = null;
              closePanel();
              stage.clear();
              runTrial(h);
            },
          },
          { cls: "narrow", onClose: () => leaveEventView(null) },
        );
      },
    });
  };

  const involved = (): boolean => game.entry?.day === game.day || game.bet?.day === game.day;

  const eventPrompt = (): void => {
    const kind = eventFor(game.day);
    const mine = involved();
    panel(
      "",
      `<div class="drum">
        <span class="drum-glyph">${EVENT_GLYPH[kind]}</span>
        <h3 class="title-txt">${EVENT_LABELS[kind]}</h3>
        <p class="drum-sub">开赛</p>
      </div>
      <div class="row center">${mine ? "" : `<button class="btn wood big" data-act="close">不看</button>`}<button class="btn big" data-act="go">入场</button></div>`,
      { go: () => ((onPanelClose = null), closePanel(), runEvent()) },
      { cls: "narrow banner", closable: !mine },
    );
  };

  const runEvent = (): void => {
    const kind = eventFor(game.day);
    const field = todaysField(game);
    const seed = hashSeed(`event:${game.day}:${field.map((f) => f.id).join(",")}`);
    if (kind === "race") {
      const race = new Race(
        field.map((f) => ({ id: f.id, name: f.name, genome: f.genome })),
        { distance: RACE_DISTANCE, seed, timeLimit: RACE_TIME_LIMIT },
      );
      enterEventView(raceCanvas);
      stage.time = "dusk";
      stage.active = true;
      stage.show(race, {
        mode: "race",
        player: field.findIndex((f) => f.mine),
        onFinish: (r) => {
          const results = r.results();
          const order = [...results].sort((a, b) => a.rank - b.rank).map((x) => x.id);
          const out = applyOutcome(game, kind, order);
          persist();
          showResults(out, results);
        },
      });
    } else {
      const [a, b] = field;
      if (!a || !b) return;
      const bout = new SumoBout({ id: a.id, name: a.name, genome: a.genome }, { id: b.id, name: b.name, genome: b.genome }, { seed });
      enterEventView(sumoCanvas);
      sumoView.show(bout, {
        mine: a.mine ? 0 : null,
        onFinish: (done) => {
          const order = done.winner === null ? null : done.winner === 0 ? [a.id, b.id] : [b.id, a.id];
          const out = applyOutcome(game, kind, order);
          persist();
          showResults(out, null, done);
        },
      });
    }
  };

  const showResults = (out: EventOutcome, results: RaceResult[] | null, bout?: SumoBout): void => {
    const nameOf = (id: string): string => findHorse(game, id)?.name ?? game.rivals.find((r) => r.id === id)?.name ?? "";
    const mineId = (id: string): boolean => !!findHorse(game, id);
    let board = "";
    if (results) {
      board = `<ol class="podium">${[...results]
        .sort((a, b) => a.rank - b.rank)
        .map(
          (r) => `<li class="${mineId(r.id) ? "mine" : ""}">
            <span class="medal m${Math.min(r.rank, 4)}">${r.rank}</span>
            <b>${esc(r.name)}</b>
            <span class="time">${r.time !== null ? `${r.time.toFixed(1)}秒` : `${r.distance.toFixed(0)}米`}</span>
            ${r.falls ? `<span class="tag red">摔</span>` : ""}
          </li>`,
        )
        .join("")}</ol>`;
    } else if (bout) {
      const winner = out.order ? out.order[0] : null;
      const reason = bout.reason === "flip" ? "掀翻" : bout.reason === "ringout" ? "推出圈" : bout.reason === "time" ? "判定" : "平局";
      board = `<div class="bout-res">
        ${bout.entrants
          .map(
            (e) => `<span class="fighter${mineId(e.id) ? " mine" : ""}${winner === e.id ? " win" : ""}">
              <span class="frame"><canvas data-pt="${e.id}"></canvas></span><b>${esc(e.name)}</b>${winner === e.id ? `<span class="stamp-s">胜</span>` : ""}
            </span>`,
          )
          .join(`<span class="vs">${reason}</span>`)}
      </div>`;
    }
    const headline =
      out.myRank === null
        ? out.order
          ? `${esc(nameOf(out.order[0] as string))}赢了`
          : "平局"
        : out.kind === "race"
          ? out.myRank === 1
            ? "头名"
            : `第${cn(out.myRank)}名`
          : out.myRank === 1
            ? "赢了"
            : "输了";
    const gains = [
      out.prize ? `<span class="gain"><small>奖金</small>${money(out.prize)}</span>` : "",
      out.betReturn ? `<span class="gain"><small>赌注</small>${money(out.betReturn)}</span>` : "",
      out.reputation ? `<span class="gain"><small>名望</small><b>+${out.reputation}</b></span>` : "",
    ].join("");
    panel(
      "",
      `<h3 class="title-txt headline${out.myRank === 1 ? " win" : ""}">${headline}</h3>
       ${board}
       ${gains ? `<div class="gains">${gains}</div>` : ""}
       <div class="row center"><button class="btn big" data-act="close">离场</button></div>`,
      {},
      { cls: "wide results", onClose: afterEvent },
    );
  };

  const afterEvent = (): void => {
    const kind = eventFor(game.day);
    game.clock = Math.max(game.clock, AFTER_EVENT);
    leaveEventView(VENUE[kind]);
  };

  /* ---------------- 菜单和开场 ---------------- */

  let confirmReset = false;
  const openMenu = (): void => {
    panel(
      "",
      `<div class="menu">
        <button class="btn big" data-act="close">继续</button>
        <button class="btn wood big" data-act="keys">操作</button>
        <button class="btn wood big${confirmReset ? " danger" : ""}" data-act="reset">${confirmReset ? "真的重开" : "重开"}</button>
      </div>`,
      {
        keys: () => {
          closePanel();
          showKeys(8000);
        },
        reset: () => {
          if (!confirmReset) {
            confirmReset = true;
            return openMenu();
          }
          confirmReset = false;
          game = resetGame();
          world.setState(game);
          closePanel();
          hud();
          intro();
        },
      },
      { cls: "narrow", onClose: () => (confirmReset = false) },
    );
  };

  let keysTimer = 0;
  const showKeys = (ms: number): void => {
    const keys = $("#h-keys");
    keys.hidden = false;
    clearTimeout(keysTimer);
    keysTimer = window.setTimeout(() => (keys.hidden = true), ms);
  };

  const intro = (): void => {
    if (game.flags.intro) return;
    panel(
      "",
      `<div class="letter">
        ${LETTER.map((l) => `<p>${esc(l)}</p>`).join("")}
        <div class="sign"><img class="letter-face" src="${portraitURL("madong")}" alt="" /><span>马董</span><span class="seal-sign">董</span></div>
      </div>
      <div class="row center"><button class="btn big" data-act="close">收下</button></div>`,
      {},
      {
        cls: "letter-scroll",
        closable: false,
        onClose: () => {
          game.flags.intro = true;
          persist();
          showKeys(12000);
        },
      },
    );
  };

  $("#toolbar").addEventListener("click", (e) => {
    if (mode !== "world" || !talkEl.hidden) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!el) return;
    if (el.id === "b-stable") openStable();
    else if (el.id === "b-menu") openMenu();
    else if (el.dataset.horse) openDetail(el.dataset.horse);
  });
  window.addEventListener("keydown", (e) => {
    if (mode !== "world" || !talkEl.hidden || !veil.hidden) return;
    if ((e.target as HTMLElement | null)?.closest("input, textarea")) return;
    const n = Number(e.key);
    const h = n >= 1 && n <= TOOLBAR_HORSES ? game.horses[n - 1] : undefined;
    if (h) openDetail(h.id);
  });

  /* ---------------- 钟点 ---------------- */

  const tick = (): void => {
    if (mode !== "world" || game.over) return;
    hud();
    if (world.paused || !veil.hidden || !talkEl.hidden) return;
    if (game.clock >= EVENT_TIME && !game.flags[`ev:${game.day}`]) {
      game.flags[`ev:${game.day}`] = true;
      persist();
      eventPrompt();
      return;
    }
    if (game.clock >= MIDNIGHT) {
      goToSleep(true);
      return;
    }
    if (performance.now() - lastSave > 10_000) persist();
  };
  window.setInterval(tick, 250);
  window.addEventListener("beforeunload", () => saveGame(game));

  hud();
  persist();
  if (game.over) {
    showRuined({ day: game.day - 1, ledger: [], foals: [], sequenced: [], grownUp: [], debtPaid: 0, ruined: true });
  } else {
    intro();
    if (game.flags.intro && game.day <= 2) showKeys(8000);
  }
}
