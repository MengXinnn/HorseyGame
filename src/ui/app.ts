import { bodyPlanFrom } from "../body/bodyPlan";
import { encodeGenome, express } from "../genome/genome";
import { LOCI, LOCUS_IDS } from "../genome/loci";
import { chimeraSlots, displayStats, metabolicBudget } from "../genome/traits";
import { coatFor } from "../render/color";
import { TIME_LABELS, type TimeOfDay } from "../render/scene";
import { Race, type RaceResult } from "../sim/race";
import { hashSeed } from "../sim/rng";
import {
  breedFoal,
  catchWild,
  importHorse,
  loadGame,
  releaseHorse,
  resetGame,
  saveGame,
  STABLE_LIMIT,
  wildField,
  type GameState,
  type StableHorse,
} from "../game/state";
import { drawPortrait } from "./portrait";
import { Stage } from "./stage";

type Tab = "stable" | "trial" | "race";

const TRIAL_SECONDS = 10;
const RACE_DISTANCE = 200;
const RACE_TIME_LIMIT = 60;

const TAB_LABELS: Record<Tab, string> = { stable: "马厩", trial: "试跑场", race: "平地赛" };

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function el<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`找不到元素 ${selector}`);
  return found;
}

export function startApp(root: HTMLElement): void {
  let game: GameState = loadGame();
  let tab: Tab = "stable";
  let running = false;
  let toastTimer = 0;

  root.innerHTML = `
    <header class="top">
      <div class="brand"><span class="brand-mark">天马行空</span><span class="brand-sub">原型 M0</span></div>
      <nav class="tabs" role="tablist">
        ${(Object.keys(TAB_LABELS) as Tab[]).map((t) => `<button role="tab" data-tab="${t}">${TAB_LABELS[t]}</button>`).join("")}
      </nav>
      <div class="times" aria-label="时段">
        ${(Object.keys(TIME_LABELS) as TimeOfDay[]).map((t) => `<button data-time="${t}">${TIME_LABELS[t]}</button>`).join("")}
      </div>
    </header>
    <main class="layout">
      <aside class="panel stable">
        <div class="panel-head"><h2>马厩</h2><span class="count" id="stable-count"></span></div>
        <ul class="horse-list" id="horse-list"></ul>
        <div class="stable-actions">
          <button class="btn ghost" id="btn-wild">套一匹野马</button>
          <button class="btn ghost" id="btn-import">导入马码</button>
        </div>
      </aside>
      <section class="arena">
        <div class="stage-wrap">
          <canvas id="stage" aria-label="赛场"></canvas>
          <div class="overlay" id="overlay" hidden></div>
        </div>
        <div class="arena-bar" id="arena-bar"></div>
      </section>
      <aside class="panel detail" id="detail"></aside>
    </main>
    <footer class="foot">
      <span>基因决定身体，身体交给物理。马不受你操控，你决定的是这副身体。</span>
      <button class="link" id="btn-reset">重开存档</button>
    </footer>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <dialog id="dialog"></dialog>
  `;

  const stage = new Stage(el<HTMLCanvasElement>(root, "#stage"));
  const overlay = el<HTMLDivElement>(root, "#overlay");
  const dialog = el<HTMLDialogElement>(root, "#dialog");

  const selected = (): StableHorse => game.horses.find((h) => h.id === game.selectedId) ?? (game.horses[0] as StableHorse);

  const persist = (): void => saveGame(game);

  const toast = (text: string): void => {
    const t = el<HTMLDivElement>(root, "#toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.classList.remove("show"), 2200);
  };

  /* ---------------- 舞台 ---------------- */

  const showPreview = (): void => {
    const h = selected();
    const race = new Race([{ id: h.id, name: h.name, genome: h.genome }], { distance: 10, seed: 1, timeLimit: 1, startAt: Infinity });
    stage.show(race, { mode: "preview", player: 0 });
    running = false;
  };

  const startTrial = (): void => {
    const h = selected();
    overlay.hidden = true;
    const seed = hashSeed(`trial:${h.id}:${h.record.trials}`);
    const race = new Race([{ id: h.id, name: h.name, genome: h.genome }], { distance: 10_000, seed, timeLimit: TRIAL_SECONDS });
    running = true;
    stage.show(race, {
      mode: "trial",
      player: 0,
      onFinish: (r) => {
        running = false;
        const res = r.results()[0] as RaceResult;
        const prevBest = h.record.bestTrial;
        h.record.trials++;
        h.record.falls += res.falls;
        h.record.bestTrial = Math.max(prevBest, res.distance);
        persist();
        showTrialResult(h, res, res.distance > prevBest && prevBest > 0);
        renderList();
        renderDetail();
        renderBar();
      },
    });
    renderBar();
  };

  const startRace = (): void => {
    const h = selected();
    overlay.hidden = true;
    const seed = hashSeed(`race:${game.counter++}`);
    persist();
    const field = wildField(seed);
    const entrants = [{ id: h.id, name: h.name, genome: h.genome }, ...field.map((f, i) => ({ id: `wild${i}`, name: f.name, genome: f.genome }))];
    const race = new Race(entrants, { distance: RACE_DISTANCE, seed, timeLimit: RACE_TIME_LIMIT });
    running = true;
    stage.show(race, {
      mode: "race",
      player: 0,
      onFinish: (r) => {
        running = false;
        const results = r.results();
        const mine = results.find((x) => x.id === h.id) as RaceResult;
        h.record.races++;
        h.record.falls += mine.falls;
        if (mine.rank === 1) h.record.wins++;
        persist();
        showRaceResult(h, results);
        renderList();
        renderDetail();
        renderBar();
      },
    });
    renderBar();
  };

  const showTrialResult = (h: StableHorse, res: RaceResult, record: boolean): void => {
    const kmh = ((res.distance / TRIAL_SECONDS) * 3.6).toFixed(1);
    const notes: string[] = [];
    if (res.falls) notes.push(`摔了 ${res.falls} 跤`);
    if (res.stumbles > res.falls) notes.push(`绊了 ${res.stumbles - res.falls} 下没摔`);
    if (res.stalls) notes.push(`发了 ${res.stalls} 次呆`);
    overlay.innerHTML = `
      <div class="result-card">
        <p class="eyebrow">${esc(h.name)} · 试跑 ${TRIAL_SECONDS} 秒</p>
        <p class="big">${res.distance.toFixed(1)}<small> 米</small></p>
        <p>平均 ${kmh} 公里/时${notes.length ? ` · ${notes.join("，")}` : " · 一路顺利"}</p>
        ${record ? `<p class="badge">新纪录</p>` : ""}
        <div class="row"><button class="btn primary" data-act="again">再跑一次</button><button class="btn ghost" data-act="close">收起</button></div>
      </div>`;
    overlay.hidden = false;
  };

  const showRaceResult = (h: StableHorse, results: RaceResult[]): void => {
    const mine = results.find((x) => x.id === h.id) as RaceResult;
    const title = mine.rank === 1 ? "冠军！" : mine.rank <= 3 ? `第 ${mine.rank} 名，上了领奖台` : `第 ${mine.rank} 名`;
    overlay.innerHTML = `
      <div class="result-card wide">
        <p class="eyebrow">平地赛 · ${RACE_DISTANCE} 米</p>
        <p class="big">${title}</p>
        <table class="results">
          <thead><tr><th>名次</th><th>马</th><th>成绩</th><th>状况</th></tr></thead>
          <tbody>
            ${results
              .map(
                (r) => `<tr class="${r.id === h.id ? "mine" : ""}">
                  <td>${r.rank}</td>
                  <td>${esc(r.name)}${r.id === h.id ? "（你的马）" : ""}</td>
                  <td>${r.time !== null ? `${r.time.toFixed(2)} 秒` : `${r.distance.toFixed(0)} 米`}</td>
                  <td>${[r.falls ? `摔 ${r.falls}` : "", r.stalls ? `呆 ${r.stalls}` : ""].filter(Boolean).join(" · ") || "—"}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
        <div class="row"><button class="btn primary" data-act="again">再来一场</button><button class="btn ghost" data-act="close">收起</button></div>
      </div>`;
    overlay.hidden = false;
  };

  overlay.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "again") (tab === "race" ? startRace : startTrial)();
    if (act === "close") overlay.hidden = true;
  });

  /* ---------------- 顶部 ---------------- */

  const renderTop = (): void => {
    root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    root.querySelectorAll<HTMLButtonElement>("[data-time]").forEach((b) => b.classList.toggle("on", b.dataset.time === game.time));
    document.documentElement.dataset.time = game.time;
  };

  root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      tab = b.dataset.tab as Tab;
      overlay.hidden = true;
      showPreview();
      renderTop();
      renderBar();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-time]").forEach((b) =>
    b.addEventListener("click", () => {
      game.time = b.dataset.time as TimeOfDay;
      stage.time = game.time;
      persist();
      renderTop();
      renderList();
      renderDetail();
    }),
  );

  /* ---------------- 马厩列表 ---------------- */

  const renderList = (): void => {
    el<HTMLSpanElement>(root, "#stable-count").textContent = `${game.horses.length} / ${STABLE_LIMIT}`;
    const list = el<HTMLUListElement>(root, "#horse-list");
    list.innerHTML = game.horses
      .map((h) => {
        const coat = coatFor(express(h.genome).coat);
        const meta = [h.generation ? `第 ${h.generation} 代` : "初代", `${coat.name}马`, h.record.bestTrial ? `试跑 ${h.record.bestTrial.toFixed(0)} 米` : ""]
          .filter(Boolean)
          .join(" · ");
        return `<li><button class="horse-card ${h.id === game.selectedId ? "on" : ""}" data-id="${h.id}">
          <canvas class="mini" width="84" height="60"></canvas>
          <span class="hc-text"><strong>${esc(h.name)}</strong><span>${meta}</span></span>
          ${h.record.wins ? `<span class="wins" title="平地赛冠军次数">${h.record.wins} 冠</span>` : ""}
        </button></li>`;
      })
      .join("");
    list.querySelectorAll<HTMLButtonElement>(".horse-card").forEach((b) => {
      const h = game.horses.find((x) => x.id === b.dataset.id);
      const c = b.querySelector("canvas");
      if (h && c) drawPortrait(c, h.genome, game.time);
      b.addEventListener("click", () => {
        if (game.selectedId === b.dataset.id) return;
        game.selectedId = b.dataset.id as string;
        persist();
        renderList();
        renderDetail();
        if (!running) {
          overlay.hidden = true;
          showPreview();
        }
        renderBar();
      });
    });
  };

  el(root, "#btn-wild").addEventListener("click", () => {
    const h = catchWild(game);
    if (!h) return toast(`马厩满了（最多 ${STABLE_LIMIT} 匹），先放生一匹吧`);
    game.selectedId = h.id;
    persist();
    toast(`套回来一匹野马，起名「${h.name}」`);
    refreshAll();
  });

  el(root, "#btn-import").addEventListener("click", () => {
    dialog.innerHTML = `
      <form method="dialog" class="dlg">
        <h3>导入马码</h3>
        <p>朋友分享的马码长这样：TM2-XXXX-XXXX-XXXX-XXXX-X</p>
        <input name="code" autocomplete="off" spellcheck="false" placeholder="粘贴马码" />
        <p class="err" hidden></p>
        <div class="row"><button class="btn primary" value="ok">导入</button><button class="btn ghost" value="cancel" formnovalidate>取消</button></div>
      </form>`;
    const form = el<HTMLFormElement>(dialog, "form");
    const input = el<HTMLInputElement>(dialog, "input");
    const err = el<HTMLParagraphElement>(dialog, ".err");
    form.addEventListener("submit", (e) => {
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter?.value !== "ok") return;
      const res = importHorse(game, input.value);
      if (res === "invalid" || res === "full") {
        e.preventDefault();
        err.hidden = false;
        err.textContent = res === "full" ? `马厩满了（最多 ${STABLE_LIMIT} 匹）` : "马码不对，检查一下有没有抄错";
        return;
      }
      game.selectedId = res.id;
      persist();
      toast(`「${res.name}」来到了你的马厩`);
      refreshAll();
    });
    dialog.showModal();
    input.focus();
  });

  /* ---------------- 详情 ---------------- */

  const bar = (label: string, value: number, hint: string): string => `
    <div class="stat" title="${esc(hint)}">
      <span class="stat-label">${label}</span>
      <span class="stat-track"><span class="stat-fill" style="width:${value}%"></span></span>
      <span class="stat-num">${value}</span>
    </div>`;

  const renderDetail = (): void => {
    const h = selected();
    const p = express(h.genome);
    const stats = displayStats(p);
    const budget = metabolicBudget(p);
    const slots = chimeraSlots(p);
    const plan = bodyPlanFrom(p);
    const coat = coatFor(p.coat);
    const code = encodeGenome(h.genome);
    const others = game.horses.filter((x) => x.id !== h.id);
    const budgetPct = Math.min(100, Math.round((budget.used / Math.max(budget.used, budget.cap)) * 100));
    const capPct = Math.round((budget.cap / Math.max(budget.used, budget.cap)) * 100);
    const mutated = new Set(h.mutations);

    const genes = h.sequenced
      ? `<div class="genes">
          ${LOCUS_IDS.map((id) => {
            const [a, b] = h.genome[id];
            const info = LOCI[id];
            const pip = (v: number): string => `<span class="pip" style="--v:${(v + 2) / 4}" title="${v > 0 ? "+" : ""}${v}"></span>`;
            return `<div class="gene ${mutated.has(id) ? "mut" : ""}" title="＋ ${esc(info.plus)}　－ ${esc(info.minus)}">
              <span class="g-name">${info.name}</span>
              <span class="g-scale"><span class="g-mark" style="left:${((p[id] + 2) / 4) * 100}%"></span></span>
              <span class="g-pips">${pip(a)}${pip(b)}</span>
              ${mutated.has(id) ? `<span class="g-tag">突变</span>` : ""}
            </div>`;
          }).join("")}
        </div>
        <p class="note">每个位点两条链，小马从父母各继承一条。没有好基因，只有合适的基因。</p>`
      : `<div class="unknown">
          <p>基因型未知。外表只能看出个大概，同样长相的马，可能藏着完全不同的隐性基因。</p>
          <button class="btn primary" id="btn-seq">测序</button>
          <p class="note">原型阶段测序免费；正式版要花钱、花时间。</p>
        </div>`;

    el<HTMLElement>(root, "#detail").innerHTML = `
      <div class="d-head">
        <canvas class="portrait" width="150" height="110"></canvas>
        <div>
          <h2>${esc(h.name)}</h2>
          <p class="sub">${h.generation ? `第 ${h.generation} 代` : "初代"} · ${coat.name}马${h.parents ? ` · ${esc(h.parents[0])} × ${esc(h.parents[1])}` : ""}</p>
          <p class="sub">体重 ${Math.round(plan.totalMass)} 公斤 · 肩高 ${(Math.max(plan.legFront, plan.legRear) + plan.torsoHeight * 0.3).toFixed(2)} 米</p>
        </div>
      </div>
      <section>
        <h3>估算属性 <span class="hint">真实成绩以物理模拟为准</span></h3>
        ${bar("速度", stats.speed, "腿长、肌力、步频越高越快")}
        ${bar("稳定", stats.stability, "躯干厚、蹄宽越稳；腿长、头重容易翻")}
        ${bar("力量", stats.strength, "体型和肌力")}
        ${bar("耐力", stats.endurance, "体质；超出代谢预算会拖累")}
      </section>
      <section>
        <h3>代谢预算 <span class="hint ${budget.over ? "warn" : ""}">${budget.used} / ${budget.cap}${budget.over ? ` · 超支 ${budget.over}` : ""}</span></h3>
        <div class="budget"><span class="budget-fill ${budget.over ? "over" : ""}" style="width:${budgetPct}%"></span><span class="budget-cap" style="left:${capPct}%"></span></div>
        <p class="note">体型、肌力、步频都吃预算，体质决定上限。超支的马体力掉得快。</p>
      </section>
      <section>
        <h3>嵌合槽 <span class="hint">${slots} 个 · 由相容度决定</span></h3>
        <div class="slots">
          ${Array.from({ length: 4 }, (_, i) => `<span class="slot ${i < slots ? "open" : "locked"}">${i < slots ? "空" : "锁"}</span>`).join("")}
        </div>
        <p class="note">部件（鹿角、蹼足、鸟翼……）在下一阶段开放，装上会占代谢预算、改物理身体。</p>
      </section>
      <section>
        <h3>基因</h3>
        ${genes}
      </section>
      <section>
        <h3>成绩</h3>
        <p class="record">试跑 ${h.record.trials} 次${h.record.bestTrial ? `，最远 ${h.record.bestTrial.toFixed(1)} 米` : ""} · 平地赛 ${h.record.races} 场 ${h.record.wins} 冠 · 摔倒 ${h.record.falls} 次</p>
      </section>
      <section>
        <h3>繁育</h3>
        ${
          others.length
            ? `<div class="row breed">
                <span>和</span>
                <select id="mate">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select>
                <button class="btn" id="btn-breed">生一匹小马</button>
              </div>`
            : `<p class="note">马厩里只有它一匹，先去套一匹野马。</p>`
        }
      </section>
      <section>
        <h3>马码 <span class="hint">分享给朋友，对方导入就能得到同一匹马</span></h3>
        <div class="row code"><code>${code}</code><button class="btn ghost" id="btn-copy">复制</button></div>
      </section>
      <section class="danger">
        <button class="link" id="btn-release">放生这匹马</button>
      </section>
    `;
    const portrait = root.querySelector<HTMLCanvasElement>("#detail .portrait");
    if (portrait) drawPortrait(portrait, h.genome, game.time);

    root.querySelector("#btn-seq")?.addEventListener("click", () => {
      h.sequenced = true;
      persist();
      toast(`「${h.name}」的基因型测出来了`);
      renderDetail();
    });
    root.querySelector("#btn-copy")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(code).then(
        () => toast("马码已复制"),
        () => toast(code),
      ) ?? toast(code);
    });
    root.querySelector("#btn-breed")?.addEventListener("click", () => {
      const mate = el<HTMLSelectElement>(root, "#mate").value;
      const foal = breedFoal(game, h.id, mate);
      if (!foal) return toast(`马厩满了（最多 ${STABLE_LIMIT} 匹），先放生一匹吧`);
      game.selectedId = foal.id;
      persist();
      toast(foal.mutations.length ? `小马「${foal.name}」出生了，还带着突变！` : `小马「${foal.name}」出生了`);
      refreshAll();
    });
    root.querySelector("#btn-release")?.addEventListener("click", () => {
      if (game.horses.length <= 1) return toast("最后一匹马可不能放生");
      if (!window.confirm(`确定放生「${h.name}」吗？放生之后就找不回来了（除非你记下了马码）。`)) return;
      releaseHorse(game, h.id);
      persist();
      refreshAll();
    });
  };

  /* ---------------- 底部操作条 ---------------- */

  const renderBar = (): void => {
    const h = selected();
    const speedBtns = `<div class="speed">${[1, 2]
      .map((s) => `<button data-speed="${s}" class="${stage.speed === s ? "on" : ""}">${s}×</button>`)
      .join("")}</div>`;
    let html = "";
    if (tab === "stable") {
      html = `<p><strong>${esc(h.name)}</strong> 站在马厩前。去<button class="link" data-goto="trial">试跑场</button>看看它能跑多远，或者报名<button class="link" data-goto="race">平地赛</button>。</p>`;
    } else if (tab === "trial") {
      html = `<button class="btn primary" id="btn-go" ${running ? "disabled" : ""}>${running ? "试跑中…" : `让${esc(h.name)}跑 ${TRIAL_SECONDS} 秒`}</button>
        <p>同一匹马每次的跑法会有一点不同：物理世界里，绊跤和发呆都是随机的。</p>${speedBtns}`;
    } else {
      html = `<button class="btn primary" id="btn-go" ${running ? "disabled" : ""}>${running ? "比赛中…" : `报名平地赛 · ${RACE_DISTANCE} 米`}</button>
        <p>${esc(h.name)} 对阵 7 匹野马，先到终点者胜。</p>${speedBtns}`;
    }
    const barEl = el<HTMLDivElement>(root, "#arena-bar");
    barEl.innerHTML = html;
    barEl.querySelector("#btn-go")?.addEventListener("click", () => (tab === "race" ? startRace : startTrial)());
    barEl.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => {
        stage.speed = Number(b.dataset.speed);
        renderBar();
      }),
    );
    barEl.querySelectorAll<HTMLButtonElement>("[data-goto]").forEach((b) =>
      b.addEventListener("click", () => {
        tab = b.dataset.goto as Tab;
        showPreview();
        renderTop();
        renderBar();
      }),
    );
  };

  el(root, "#btn-reset").addEventListener("click", () => {
    if (!window.confirm("重开存档会清空马厩，回到最初的四匹马。确定吗？")) return;
    game = resetGame();
    stage.time = game.time;
    refreshAll();
  });

  const refreshAll = (): void => {
    renderTop();
    renderList();
    renderDetail();
    renderBar();
    if (!running) {
      overlay.hidden = true;
      showPreview();
    }
  };

  stage.time = game.time;
  refreshAll();
}
