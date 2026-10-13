import { bodyPlanFrom } from "../body/bodyPlan";
import { breed, decodeGenome, encodeGenome, express, makeGenome, randomGenome, type Genome } from "../genome/genome";
import { displayStats } from "../genome/traits";
import { createRng, hashSeed, type Rng } from "../sim/rng";
import { horseName } from "./names";
import { decodeHorseCode } from "./horseCode";
import { emptyPublicRecord, raceOdds, recordRace, recordSumo, sumoOdds, type PublicRecord } from "./odds";
import { bossFor, CUP, prizeFor, sportOf, STORY_HORSES } from "./calendar";
import {
  DAY_START,
  DEBT_SCHEDULE,
  DEBT_DAYS,
  debtDue,
  ENTRY_FEE,
  EVENT_TIME,
  EVENT_LABELS,
  eventFor,
  feedCost,
  FOAL_DAYS,
  LASSOS_PER_DAY,
  MIDNIGHT,
  salePrice,
  SEASON_DAYS,
  SEQUENCING_FEE,
  START_MONEY,
  TIME_COST,
  TRAVEL_TILES,
  betLimit,
  betPayout,
  type EventKind,
} from "./season";

export interface HorseRecord {
  trials: number;
  /** 试跑 10 秒的最好距离（米）。 */
  bestTrial: number;
  falls: number;
}

export interface StableHorse {
  id: string;
  name: string;
  genome: Genome;
  /** 测序之后才能看到基因型；没测序只能看外表和跑出来的成绩。 */
  sequenced: boolean;
  /** 送去测序了，第二天早上出结果。 */
  sequencing: boolean;
  generation: number;
  parents: [string, string] | null;
  /** 这匹马的突变位点（来自繁殖）。 */
  mutations: string[];
  /** 出生在第几天；野马和开局的马是 0（已经成年）。 */
  bornDay: number;
  /** 最近一次配种是第几天（每匹马一天只能配一次）。 */
  bredDay: number;
  record: HorseRecord;
  pub: PublicRecord;
  parentIds: [string, string] | null;
  /** 背部羽翼的两条遗传链；载有材料不代表一定表现。 */
  wingGenes: readonly [0 | 1, 0 | 1];
}

/** 镇上其他人的马：有名字、有主人、有公开战绩，是你在赛场上反复遇到的对手。 */
export interface RivalHorse {
  id: string;
  name: string;
  owner: string;
  genome: Genome;
  wingGenes?: readonly [0 | 1, 0 | 1];
  pub: PublicRecord;
}

export interface Entry {
  day: number;
  kind: EventKind;
  horseId: string;
  team?: [string, string, string];
}

export interface Bet {
  day: number;
  /** 押的是哪匹马（可以是自己的，也可以是对手的）。 */
  horseId: string;
  amount: number;
  odds: number;
  insured: boolean;
}

export interface Pregnancy {
  damId: string;
  sireId: string;
  dueDay: number;
  snapshots?: [Genome, Genome];
  wings?: readonly [0 | 1, 0 | 1];
  prepared?: boolean;
}

export interface LedgerLine {
  label: string;
  amount: number;
}

/** 剧情进度：当前主线任务、找到的日记、信箱。 */
export interface StoryState {
  /** 当前主线任务的 id；全部做完是 null。 */
  quest: string | null;
  /** 当前任务完成了几次（例如「套 0/1 匹」）。 */
  progress: number;
  /** 找到的外婆日记页码。 */
  diary: number[];
  /** 信箱里还没读的信。 */
  inbox: string[];
  /** 读过的信，可以在日记本里翻。 */
  read: string[];
  played: Record<string, boolean>;
  choices: Record<string, string>;
  history: Array<{ id: string; day: number; title: string; lines: Array<{ who: string; text: string }> }>;
  pending: Array<{ who: string; text: string; actor?: string; sceneDay?: number; sceneTitle?: string }>;
}

/** 欠债没还上时马董给的宽限：连本带利，几天后再来收。 */
export interface Grace {
  amount: number;
  dueDay: number;
}

export type Ending = "tianma" | "kept" | "mascot";

export interface GameState {
  version: 4;
  horses: StableHorse[];
  archive: StableHorse[];
  selectedId: string;
  day: number;
  /** 当天时钟，单位分钟（6:00 = 360）。 */
  clock: number;
  money: number;
  reputation: number;
  lassos: number;
  player: { x: number; z: number };
  /** 上一次记时间以后又走了多少格路（不满 TRAVEL_TILES 的零头）。 */
  walked: number;
  pregnancies: Pregnancy[];
  entry: Entry | null;
  bet: Bet | null;
  rivals: RivalHorse[];
  /** 今天的钱进钱出，晚上结算时展示。 */
  ledger: LedgerLine[];
  /** 已经说过的对白、看过的提示。 */
  flags: Record<string, boolean>;
  /** 欠债没还上，牧场被收走了。 */
  over: boolean;
  story: StoryState;
  grace: Grace | null;
  /** 宽限只给一次。 */
  graceUsed: boolean;
  /** 已经还清了几笔债（4 笔还完就是牧场的主人）。 */
  debtsPaid: number;
  /** 天马杯拿过冠军。 */
  cupWon: boolean;
  /** 赛季结局；之后进入无尽模式。 */
  ending: Ending | null;
  performance: { day: number; horseId: string; program: "haul" | "jump" | "balance"; count: number } | null;
  /** 随机事件的种子计数器，保证存档可复现。 */
  counter: number;
}

const SAVE_KEY = "tianma.save.v4";
const OLD_SAVE_KEYS = ["tianma.save.v3", "tianma.save.v2"];
export const STABLE_LIMIT = 12;
export const HOME = { x: 17.5, z: 69.6 };

const emptyRecord = (): HorseRecord => ({ trials: 0, bestTrial: 0, falls: 0 });

let idCounter = 0;
function newId(prefix = "h"): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function createHorse(name: string, genome: Genome, extra: Partial<StableHorse> = {}): StableHorse {
  return {
    id: newId(),
    name,
    genome,
    sequenced: false,
    sequencing: false,
    generation: 0,
    parents: null,
    mutations: [],
    bornDay: 0,
    bredDay: 0,
    record: emptyRecord(),
    pub: emptyPublicRecord(),
    parentIds: null,
    wingGenes: [0, 0],
    ...extra,
  };
}

export const isFoal = (h: StableHorse, day: number): boolean => h.bornDay > 0 && day < h.bornDay + FOAL_DAYS;

/** 老赵的两匹马：一吨重的相扑马「铁墩」，和陪他跑平地赛的「老黄」。 */
export const LAOZHAO = "老赵";
export const TIEDUN = "铁墩";

function makeRivals(): RivalHorse[] {
  const rng = createRng(hashSeed("马蹄镇"));
  const owners = ["孙婶", "钱掌柜", "周家", "小吴", "郑屠户", "王秀才", "冯镖头", "陈阿婆"];
  const rivals: RivalHorse[] = [
    {
      id: "r-tiedun",
      name: TIEDUN,
      owner: LAOZHAO,
      genome: makeGenome({ size: [2, 2], girth: [2, 2], legF: [-1, -1], legR: [-1, 0], hoof: [2, 1], power: [2, 1], con: [2, 1], stride: [-1, -1], courage: [1, 1], coat: [-1, 0] }),
      pub: { ...emptyPublicRecord(), sumo: 9, sumoWins: 8 },
    },
    {
      id: "r-laohuang",
      name: "老黄",
      owner: LAOZHAO,
      genome: makeGenome({ legF: [1, 0], legR: [1, 1], stride: [1, 0], con: [1, 1], coat: [0, 1], courage: [1, 1] }),
      pub: { ...emptyPublicRecord(), races: 6, wins: 2, podiums: 4, rankSum: 15 },
    },
  ];
  const taken = new Set(rivals.map((r) => r.name).concat(["流星", "磐石"]));
  for (let i = 0; i < 12; i++) {
    const genome = randomGenome(rng);
    const name = horseName(rng, taken);
    taken.add(name);
    // 公开战绩大致跟真实水平挂钩，但带噪声：庄家也会看走眼。
    const speed = displayStats(express(genome)).speed;
    const races = rng.int(0, 7);
    const pub = emptyPublicRecord();
    for (let k = 0; k < races; k++) {
      const rank = Math.max(1, Math.min(8, Math.round(4.5 - (speed - 50) / 10 + (rng.next() - 0.5) * 5)));
      recordRace(pub, rank);
    }
    const sumo = rng.int(0, 4);
    const strength = displayStats(express(genome)).strength;
    for (let k = 0; k < sumo; k++) recordSumo(pub, rng.next() < strength / 100);
    rivals.push({ id: `r-${i}`, name, owner: owners[i % owners.length] as string, genome, pub });
  }
  return ensureStoryRivals(rivals);
}

/**
 * 剧情里的对手马：米娅的迷你杂技马「豆包」、K 博士的「样本七号」（擂台前一晚照全镇最强的马复制）、
 * 马董的完美马「完璧」（数值顶格，胆子极小）。旧存档读进来时补上。
 */
export function ensureStoryRivals(rivals: RivalHorse[]): RivalHorse[] {
  const story: RivalHorse[] = [
    {
      id: "r-chaosheng", name: "潮生", owner: "老舟",
      genome: makeGenome({ size: [0, 1], legF: [0, 1], legR: [0, 1], hoof: [2, 1], con: [2, 1], courage: [1, 1], power: [0, 1], coat: [-1, 0] }),
      pub: { ...emptyPublicRecord(), races: 4, wins: 1, podiums: 3, rankSum: 12 },
    },
    {
      id: "r-doubao",
      name: "豆包",
      owner: "米娅",
      genome: makeGenome({ size: [-2, -2], torso: [-1, -1], legF: [0, 1], legR: [1, 1], hoof: [1, 1], stride: [2, 1], power: [1, 1], con: [1, 1], courage: [2, 2], tail: [1, 2], coat: [2, 1], pattern: [2, 2] }),
      pub: { ...emptyPublicRecord(), races: 5, wins: 2, podiums: 4, rankSum: 11 },
    },
    {
      id: "r-sample7",
      name: "样本七号",
      owner: "K博士",
      genome: makeGenome({ legF: [1, 1], legR: [1, 1], stride: [1, 1], power: [1, 0], con: [1, 1], girth: [0, 1], courage: [1, 1] }),
      pub: emptyPublicRecord(),
    },
    {
      id: "r-wanbi",
      name: CUP.horse,
      owner: CUP.owner,
      genome: makeGenome({ legF: [2, 2], legR: [2, 2], stride: [2, 1], power: [2, 2], con: [2, 2], girth: [1, 0], hoof: [1, 1], courage: [-2, -2], coat: [2, 2], pattern: [0, 0] }),
      pub: { ...emptyPublicRecord(), races: 3, wins: 3, podiums: 3, rankSum: 3 },
    },
  ];
  for (const r of story) if (!rivals.some((x) => x.id === r.id)) rivals.push(r);
  return rivals;
}

/** 旧存档读进来时的占位任务：由剧情模块换成当天该做的任务。 */
export const RESUME = "@resume";

/** 新的剧情进度：从第一个任务开始，信箱里躺着外婆的信。 */
export function newStory(): StoryState {
  return { quest: "d1-letter", progress: 0, diary: [], inbox: ["waipo"], read: [], played: {}, choices: {}, history: [], pending: [] };
}

/** 开局：外婆留下的牧场、两匹马、三百块钱，和一屁股债。 */
export function newGame(): GameState {
  const horses = [
    createHorse(
      "流星",
      makeGenome({ legF: [1, 2], legR: [1, 1], girth: [-1, 0], stride: [1, 0], power: [1, 0], neck: [1, 0], courage: [0, 1], coat: [1, 1], pattern: [1, 2], compat: [0, 1] }),
    ),
    createHorse(
      "磐石",
      makeGenome({ size: [1, 1], girth: [2, 1], legF: [-1, 0], legR: [-1, 0], hoof: [1, 1], power: [1, 1], con: [1, 0], stride: [-1, 0], coat: [-1, -1], pattern: [-1, -2] }),
    ),
  ];
  return {
    version: 4,
    horses,
    archive: [...horses],
    selectedId: horses[0]!.id,
    day: 1,
    clock: DAY_START,
    money: START_MONEY,
    reputation: 0,
    lassos: LASSOS_PER_DAY,
    player: { ...HOME },
    walked: 0,
    pregnancies: [],
    entry: null,
    bet: null,
    rivals: makeRivals(),
    ledger: [],
    flags: {},
    over: false,
    counter: 1,
    story: newStory(),
    grace: null,
    graceUsed: false,
    debtsPaid: 0,
    cupWon: false,
    ending: null,
    performance: null,
  };
}

/* ---------------- 存档 ---------------- */

interface Saved<T> {
  code: string;
  rest: Omit<T, "genome">;
}

export function serialize(state: GameState): string {
  const pack = <T extends { genome: Genome }>(x: T): Saved<T> => {
    const { genome, ...rest } = x;
    return { code: encodeGenome(genome), rest };
  };
  return JSON.stringify({ ...state, horses: state.horses.map(pack), archive: state.archive.map(pack), rivals: state.rivals.map(pack) });
}

export function deserialize(text: string): GameState | null {
  try {
    const raw = JSON.parse(text) as Omit<GameState, "version" | "horses" | "rivals" | "archive"> & { version: number; horses: Saved<StableHorse>[]; archive?: Saved<StableHorse>[]; rivals: Saved<RivalHorse>[] };
    if (![2, 3, 4].includes(raw.version)) return null;
    if (!Array.isArray(raw.horses) || !Array.isArray(raw.rivals)) return null;
    const unpack = <T>(list: Saved<T>[]): T[] => {
      const out: T[] = [];
      for (const s of list) {
        const genome = decodeGenome(s.code);
        if (genome) out.push({ ...(s.rest as T), genome } as T);
      }
      return out;
    };
    const fresh = newGame();
    const horses = unpack<StableHorse>(raw.horses).map((h) => ({ ...createHorse(h.name, h.genome), ...h, record: { ...emptyRecord(), ...h.record }, pub: { ...emptyPublicRecord(), ...h.pub } }));
    if (horses.length === 0) return null;
    const rivals = unpack<RivalHorse>(raw.rivals);
    // 第2版存档没有剧情：从当前日期的事件继续，不补演已经过去的章节。
    const story: StoryState = raw.story ? { ...newStory(), ...raw.story } : { ...newStory(), quest: RESUME, inbox: [] };
    // v2在7/14/21/28日晚强制还款；存档日期已经进入次晨。
    // 失败旧档的最后一笔并未支付，显式保存的进度则始终优先。
    const paymentDays = raw.version === 2 ? [7, 14, 21, 28] : DEBT_DAYS;
    const passedPayments = paymentDays.filter(day => day < raw.day).length;
    const debtsPaid = raw.debtsPaid ?? Math.max(0, passedPayments - (raw.version === 2 && raw.over ? 1 : 0));
    return {
      ...fresh,
      ...raw,
      version: 4,
      horses,
      archive: [...horses, ...unpack<StableHorse>(raw.archive ?? []).filter(h => !horses.some(live => live.id === h.id))],
      rivals: rivals.length ? ensureStoryRivals(rivals) : fresh.rivals,
      story,
      debtsPaid,
      flags: raw.day > 1 ? { ...raw.flags, intro: true } : raw.flags ?? {},
      walked: raw.walked ?? 0,
      selectedId: horses.some((h) => h.id === raw.selectedId) ? raw.selectedId : horses[0]!.id,
    };
  } catch {
    return null;
  }
}

export function loadGame(): GameState {
  try {
    for (const key of [SAVE_KEY, ...OLD_SAVE_KEYS]) {
      const text = localStorage.getItem(key);
      const state = text ? deserialize(text) : null;
      if (state) return state;
    }
  } catch {
    // 隐私模式或禁用存储时直接开新档。
  }
  return newGame();
}

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state));
  } catch {
    // 存不了就算了，游戏照常进行。
  }
}

export function resetGame(): GameState {
  try {
    for (const key of [SAVE_KEY, ...OLD_SAVE_KEYS]) localStorage.removeItem(key);
  } catch {
    // 同上。
  }
  return newGame();
}

/* ---------------- 钱 ---------------- */

function spend(state: GameState, label: string, amount: number): boolean {
  if (state.money < amount) return false;
  state.money -= amount;
  state.ledger.push({ label, amount: -amount });
  return true;
}

function earn(state: GameState, label: string, amount: number): void {
  if (amount <= 0) return;
  state.money += amount;
  state.ledger.push({ label, amount });
}

/** 剧情奖励的钱，记进当天的账。 */
export const grant = earn;
export const charge = spend;

/** 测序所第 10 天才开门（小白进城进修了）；旧存档里测过序的照常开。 */
export const SEQ_OPEN_DAY = 10;

export function sequencingOpen(state: GameState): boolean {
  return state.day >= SEQ_OPEN_DAY || state.horses.some((h) => h.sequenced || h.sequencing);
}

/** 马的详情里有没有「基因」一栏：拿到第一份测序结果以后才有。 */
export function genesUnlocked(state: GameState): boolean {
  return !!state.flags.genes || state.horses.some((h) => h.sequenced);
}

/** 第一次测序小白给打对折。 */
export function sequencingFee(state: GameState): number {
  return !state.flags["seq:half-used"] ? SEQUENCING_FEE / 2 : SEQUENCING_FEE;
}

/* ---------------- 马厩 ---------------- */

export function findHorse(state: GameState, id: string): StableHorse | undefined {
  return state.horses.find((h) => h.id === id);
}

export function rngFor(state: GameState, tag: string): Rng {
  return createRng(hashSeed(`${tag}:${state.day}:${state.counter++}`));
}

export type ActionResult = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): ActionResult => ({ ok: false, reason });
const OK: ActionResult = { ok: true };

/* ---------------- 时间 ---------------- */

const TOO_LATE = "太晚了，明天再说";

/** 还来得及做这件事吗：做完不能过午夜。 */
export function hasTime(state: GameState, minutes: number): boolean {
  return state.clock + minutes <= MIDNIGHT;
}

/** 花掉一段时间，最多到午夜。 */
export function passTime(state: GameState, minutes: number): void {
  state.clock = Math.min(MIDNIGHT, state.clock + minutes);
}

/** 赶一段路（TRAVEL_TILES 格）。走路不会被拦下；走过了午夜就累倒在路边。 */
export function travel(state: GameState): void {
  passTime(state, TIME_COST.travel);
}

/** 走了 tiles 格路。攒够一段就花一段路的时间，返回这次花了几段。 */
export function walk(state: GameState, tiles: number): number {
  state.walked = (state.walked ?? 0) + Math.max(0, tiles);
  let legs = 0;
  while (state.walked >= TRAVEL_TILES) {
    state.walked -= TRAVEL_TILES;
    travel(state);
    legs++;
  }
  return legs;
}

/** 歇一会儿。 */
export function rest(state: GameState, minutes: number = TIME_COST.rest): ActionResult {
  if (!hasTime(state, minutes)) return fail(TOO_LATE);
  passTime(state, minutes);
  return OK;
}

/** 今天的赛事还没开吗。 */
export const eventPending = (state: GameState): boolean => !state.flags[`ev:${state.day}`] && state.clock < EVENT_TIME;

/** 一直等到傍晚开赛。 */
export function waitForEvent(state: GameState): ActionResult {
  if (!eventPending(state)) return fail("今天已经开过赛了");
  state.clock = EVENT_TIME;
  return OK;
}

/** 试跑一趟。 */
export function startTrial(state: GameState, horseId: string): ActionResult {
  const horse = findHorse(state, horseId);
  if (!horse) return fail("找不到这匹马");
  if (isFoal(horse, state.day)) return fail("小马还没长大");
  if (!hasTime(state, TIME_COST.trial)) return fail(TOO_LATE);
  passTime(state, TIME_COST.trial);
  return OK;
}

/** 配种：当晚怀上，第二天早上小马出生。 */
export function mate(state: GameState, damId: string, sireId: string): ActionResult {
  const dam = findHorse(state, damId);
  const sire = findHorse(state, sireId);
  if (!dam || !sire || dam === sire) return fail("选两匹不同的马");
  if (isFoal(dam, state.day) || isFoal(sire, state.day)) return fail("小马还没长大");
  if (dam.bredDay === state.day || sire.bredDay === state.day) return fail("今天配过了");
  if (state.horses.length + state.pregnancies.length >= STABLE_LIMIT) return fail("马厩满了");
  if (!hasTime(state, TIME_COST.mate)) return fail(TOO_LATE);
  passTime(state, TIME_COST.mate);
  dam.bredDay = state.day;
  sire.bredDay = state.day;
  const rng = rngFor(state, "wing-inheritance");
  state.pregnancies.push({ damId, sireId, dueDay: state.day + 1,
    snapshots: [structuredClone(dam.genome), structuredClone(sire.genome)],
    wings: [rng.pick(dam.wingGenes), rng.pick(sire.wingGenes)],
  });
  return OK;
}

/** 测序：交钱，第二天早上出结果。 */
export function sendToSequencing(state: GameState, id: string): ActionResult {
  const h = findHorse(state, id);
  if (!h) return fail("找不到这匹马");
  if (!sequencingOpen(state)) return fail("博士出门，暂停营业");
  if (h.sequenced || h.sequencing) return fail("已经测过了");
  if (!hasTime(state, TIME_COST.sequence)) return fail(TOO_LATE);
  const fee = sequencingFee(state);
  if (!spend(state, `测序 ${h.name}`, fee)) return fail("钱不够");
  if (fee < SEQUENCING_FEE) state.flags["seq:half-used"] = true;
  passTime(state, TIME_COST.sequence);
  h.sequencing = true;
  return OK;
}

export function sellPrice(state: GameState, h: StableHorse): number {
  const s = displayStats(express(h.genome));
  return salePrice(s.speed + s.stability + s.strength + s.endurance, h.pub.wins + h.pub.sumoWins, h.pub.podiums, isFoal(h, state.day));
}

/** 卖到马市。 */
export function sellHorse(state: GameState, id: string): ActionResult {
  const h = findHorse(state, id);
  if (!h) return fail("找不到这匹马");
  if (state.horses.length <= 1) return fail("最后一匹马不能卖");
  if (state.performance?.horseId === id) return fail("它正在演出");
  if (state.entry?.horseId === id || state.entry?.team?.includes(id)) return fail("它报名了今天的比赛");
  if (state.pregnancies.some((p) => p.damId === id || p.sireId === id)) return fail("它刚配过种");
  if (!hasTime(state, TIME_COST.sell)) return fail(TOO_LATE);
  passTime(state, TIME_COST.sell);
  earn(state, `卖掉 ${h.name}`, sellPrice(state, h));
  state.horses = state.horses.filter((x) => x.id !== id);
  if (state.selectedId === id) state.selectedId = state.horses[0]!.id;
  return OK;
}

export function canCatch(state: GameState): ActionResult {
  if (state.lassos <= 0) return fail("今天的套索用完了");
  if (state.horses.length + state.pregnancies.length >= STABLE_LIMIT) return fail("马厩满了");
  // 扔出去万一套中，还得留出牵马回去的工夫。
  if (!hasTime(state, TIME_COST.throwLasso + TIME_COST.catch)) return fail(TOO_LATE);
  return OK;
}

/** 扔一次套索：用掉一根，花一点时间。 */
export function throwLasso(state: GameState): ActionResult {
  const ok = canCatch(state);
  if (!ok.ok) return ok;
  state.lassos--;
  passTime(state, TIME_COST.throwLasso);
  return OK;
}

/** 套中一匹野马，牵回牧场。 */
export function addCaught(state: GameState, name: string, genome: Genome): StableHorse {
  const taken = new Set(state.horses.map((h) => h.name).concat(state.rivals.map((r) => r.name)));
  const finalName = taken.has(name) ? horseName(rngFor(state, "rename"), taken) : name;
  const horse = createHorse(finalName, genome);
  state.horses.push(horse);
  state.archive.push(horse);
  passTime(state, TIME_COST.catch);
  return horse;
}

/** 野原上的野马群：每天早上换一批。 */
export function wildHerd(state: GameState, region: number, count: number): Array<{ name: string; genome: Genome }> {
  const rng = createRng(hashSeed(`wild:${state.day}:${region}`));
  const taken = new Set(state.horses.map((h) => h.name).concat(state.rivals.map((r) => r.name)));
  return Array.from({ length: count }, () => {
    const name = horseName(rng, taken);
    taken.add(name);
    return { name, genome: randomGenome(rng) };
  });
}

/** 用马码导入一匹马（朋友分享的马）。 */
export function importHorse(state: GameState, code: string): StableHorse | "full" | "invalid" | "late" {
  if (state.horses.length + state.pregnancies.length >= STABLE_LIMIT) return "full";
  const decoded = decodeHorseCode(code);
  if (!decoded) return "invalid";
  if (!hasTime(state, TIME_COST.import)) return "late";
  passTime(state, TIME_COST.import);
  const rng = rngFor(state, `import:${code}`);
  const horse = createHorse(horseName(rng, new Set(state.horses.map((h) => h.name))), decoded.genome, { wingGenes: decoded.wingGenes });
  state.horses.push(horse);
  state.archive.push(horse);
  return horse;
}

/* ---------------- 赛事 ---------------- */

export interface FieldEntry {
  id: string;
  name: string;
  owner: string;
  genome: Genome;
  wingGenes?: readonly [0 | 1, 0 | 1];
  pub: PublicRecord;
  mine: boolean;
}

/** 今天赛事的对手：由日期决定，同一天怎么看都一样。 */
export function todaysRivals(state: GameState, kind: EventKind = eventFor(state.day)): RivalHorse[] {
  const pool = state.rivals.filter((r) => !STORY_HORSES.includes(r.name));
  const star = kind === "boss" ? bossFor(state.day)?.horse : kind === "cup" ? CUP.horse : undefined;
  const picked = star ? state.rivals.filter((r) => r.name === star) : [];
  if (kind === "boss" && sportOf(state.day) === "sumo") return picked;
  if (kind === "cup") {
    // 正文的豆包、阿七和潮生在场，其余名额按公开战绩邀请。
    const score = (r: RivalHorse): number => r.pub.wins * 3 + r.pub.podiums + r.pub.sumoWins;
    const guests = state.rivals.filter(r => ["r-doubao", "r-sample7", "r-chaosheng"].includes(r.id));
    return picked.concat(guests, [...pool].filter(r => !guests.includes(r)).sort((a, b) => score(b) - score(a)).slice(0, CUP.rivals - guests.length));
  }
  const rng = createRng(hashSeed(`field:${state.day}`));
  const want = sportOf(state.day) === "race" ? 7 : 1;
  while (picked.length < want && pool.length) {
    picked.push(pool.splice(rng.int(0, pool.length - 1), 1)[0] as RivalHorse);
  }
  return picked;
}

/** 今天的完整出场名单（报了名的话包括你的马）。没报名时平地赛由镇上 8 匹马跑。 */
export function todaysField(state: GameState): FieldEntry[] {
  const kind = eventFor(state.day);
  const rivals = todaysRivals(state, kind);
  const field: FieldEntry[] = [];
  const mine = state.entry && state.entry.day === state.day ? findHorse(state, state.entry.horseId) : undefined;
  if (mine) field.push({ id: mine.id, name: mine.name, owner: "你", genome: mine.genome, wingGenes: mine.wingGenes, pub: mine.pub, mine: true });
  for (const r of rivals) field.push({ id: r.id, name: r.name, owner: r.owner, genome: r.genome, wingGenes: r.wingGenes, pub: r.pub, mine: false });
  // 没报名时空出来的位置由镇上另一匹马补上：平地赛凑满 8 匹，相扑和擂台凑成一对。
  if (!mine) {
    const pool = state.rivals.filter((r) => !STORY_HORSES.includes(r.name) && !rivals.includes(r));
    const extra = pool.length ? pool[hashSeed(`extra:${state.day}`) % pool.length] : undefined;
    if (extra) field.push({ id: extra.id, name: extra.name, owner: extra.owner, genome: extra.genome, pub: extra.pub, mine: false });
  }
  return field;
}

/** 今天的赔率，和 todaysField 一一对应。 */
export function todaysOdds(state: GameState): number[] {
  const field = todaysField(state);
  if (sportOf(state.day) === "race") return raceOdds(field.map((f) => ({ record: f.pub, key: `${f.id}:${state.day}` })));
  if (field.length < 2) return field.map(() => 1);
  const mass = (g: Genome): number => bodyPlanFrom(express(g)).totalMass;
  return sumoOdds({ record: field[0]!.pub, mass: mass(field[0]!.genome) }, { record: field[1]!.pub, mass: mass(field[1]!.genome) });
}

/** 报名今天的赛事。 */
export function register(state: GameState, horseId: string, team?: [string, string, string]): ActionResult {
  const h = findHorse(state, horseId);
  if (!h) return fail("找不到这匹马");
  if (isFoal(h, state.day)) return fail("小马不能参赛");
  if (eventFor(state.day) === "relay" && (!team || team[0] !== horseId || new Set(team).size !== 3 || team.some(id => !findHorse(state, id) || isFoal(findHorse(state, id)!, state.day)))) return fail("接力需要三匹不同的成年马");
  if (state.entry?.day === state.day) return fail("今天已经报过名");
  if (state.bet?.day === state.day) return fail("先报名再下注");
  if (!eventPending(state)) return fail("今天的报名截止了");
  if (state.clock + TIME_COST.register > EVENT_TIME) return fail("来不及报名了");
  if (!spend(state, "报名费", ENTRY_FEE)) return fail("钱不够");
  passTime(state, TIME_COST.register);
  state.entry = { day: state.day, kind: eventFor(state.day), horseId, ...(team ? { team: [...team] } : {}) };
  return OK;
}

/** 下注。 */
export function placeBet(state: GameState, horseId: string, amount: number, insured: boolean): ActionResult {
  if (state.bet?.day === state.day) return fail("今天已经下过注");
  if (!eventPending(state)) return fail("收摊了，明天请早");
  if (state.clock + TIME_COST.bet > EVENT_TIME) return fail("来不及下注了");
  const field = todaysField(state);
  const i = field.findIndex((f) => f.id === horseId);
  if (i < 0) return fail("这匹马今天不上场");
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) return fail("押多少？");
  if (amount > betLimit(state.reputation)) return fail("超过下注上限");
  const odds = todaysOdds(state)[i] as number;
  if (!spend(state, "下注", amount)) return fail("钱不够");
  passTime(state, TIME_COST.bet);
  state.bet = { day: state.day, horseId, amount, odds, insured };
  return OK;
}

export interface EventOutcome {
  kind: EventKind;
  /** 按名次排的出场马 id。相扑只有两匹，平局时 order 为 null。 */
  order: string[] | null;
  /** 你的马的名次（没参赛为 null）。 */
  myRank: number | null;
  prize: number;
  betReturn: number;
  reputation: number;
}

/** 名望：平地赛进前三、相扑赢了 +1，擂台赢了 +3，天马杯冠军 +10、进前三 +3。 */
export function reputationFor(kind: EventKind, sport: "race" | "sumo", rank: number): number {
  if (kind === "cup") return rank === 1 ? 10 : rank <= 3 ? 3 : 0;
  if (kind === "boss") return rank === 1 ? 3 : 0;
  if (sport === "race") return rank <= 3 ? 1 : 0;
  return rank === 1 ? 1 : 0;
}

/** 比赛结束后结算：奖金、赌注、声望、公开战绩。 */
export function applyOutcome(state: GameState, kind: EventKind, order: string[] | null): EventOutcome {
  const field = todaysField(state);
  const out: EventOutcome = { kind, order, myRank: null, prize: 0, betReturn: 0, reputation: 0 };
  if (state.flags[`settled:${state.day}`]) return out;
  if(order&&(order.length!==field.length||new Set(order).size!==order.length||order.some(id=>!field.some(f=>f.id===id))))return out;
  state.flags[`settled:${state.day}`]=true;
  const sport = sportOf(state.day);
  const recordOf = (id: string): PublicRecord | undefined => findHorse(state, id)?.pub ?? state.rivals.find((r) => r.id === id)?.pub;
  if (order) {
    order.forEach((id, i) => {
      const rec = recordOf(id);
      if (!rec) return;
      if (sport === "race") recordRace(rec, i + 1);
      else recordSumo(rec, i === 0);
    });
  }
  const mine = field.find((f) => f.mine);
  if (mine && order) {
    const rank = order.indexOf(mine.id) + 1;
    if(rank===0)return out;
    out.myRank = rank;
    out.prize = prizeFor(state.day, rank);
    out.reputation = reputationFor(kind, sport, rank);
    if (rank === 1) {
      const star = field.find((f) => !f.mine && STORY_HORSES.includes(f.name));
      if (star) state.flags[`beat:${star.name}`] = true;
      if (star?.name === "铁墩") state.flags["beat:tiedun"] = true;
      if (kind === "cup") state.cupWon = true;
    }
  }
  if (out.prize) earn(state, sport === "race" && kind !== "boss" ? `${EVENT_LABELS[kind]}第 ${out.myRank} 名` : `${EVENT_LABELS[kind]}奖金`, out.prize);
  state.reputation += out.reputation;
  const bet = state.bet;
  if (bet && bet.day === state.day) {
    const won = !!order && order[0] === bet.horseId;
    out.betReturn = betPayout(bet.amount, bet.odds, won, bet.insured);
    earn(state, won ? "赢了赌注" : "押注保险退款", out.betReturn);
  }
  state.entry = null;
  state.bet = null;
  return out;
}

/* ---------------- 夜晚结算 ---------------- */

export interface NightReport {
  day: number;
  ledger: LedgerLine[];
  foals: StableHorse[];
  sequenced: StableHorse[];
  grownUp: StableHorse[];
  debtPaid: number;
  /** 这一晚还不上，马董给了宽限。 */
  grace: Grace | null;
  /** 宽限过后还是还不上（或第二次还不上），牧场被收走。 */
  ruined: boolean;
  /** 这一晚定下的结局。 */
  ending: Ending | null;
}

/** 宽限的利息：三天后连本带利多两成。 */
export const GRACE_DAYS = 3;
export const GRACE_RATE = 1.2;

/** 夜里还债：先还到期的宽限，再还这周的；还不上第一次给宽限，第二次收牧场。四笔还清定结局。 */
function settleDebt(state: GameState, day: number, report: NightReport): void {
  if (state.ending) return;
  const finish = (): void => {
    state.ending = state.cupWon ? "tianma" : "kept";
    report.ending = state.ending;
  };
  // 已还清的迁移存档停止扣款，但要等最终杯赛结束后再判定结局。
  if (state.debtsPaid >= DEBT_SCHEDULE.length) {
    if (day >= SEASON_DAYS) finish();
    return;
  }
  const ruin = (): void => {
    report.ruined = true;
    state.over = true;
    state.ending = "mascot";
    report.ending = "mascot";
  };
  const g = state.grace;
  if (g && g.dueDay <= day) {
    if (!spend(state, "还债（宽限）", g.amount)) return ruin();
    report.debtPaid += g.amount;
    state.grace = null;
    state.debtsPaid++;
  }
  const due = (DEBT_DAYS as readonly number[]).includes(day) ? debtDue(day) : 0;
  if (due > 0) {
    if (spend(state, "还债", due)) {
      report.debtPaid += due;
      state.debtsPaid++;
    } else if (!state.graceUsed && day < 31) {
      state.graceUsed = true;
      state.grace = { amount: Math.round((due * GRACE_RATE) / 10) * 10, dueDay: day + GRACE_DAYS };
      report.grace = state.grace;
    } else return ruin();
  }
  if (state.debtsPaid >= DEBT_SCHEDULE.length && day >= SEASON_DAYS) {
    finish();
  }
}

/** K 博士在擂台前一晚，照着全镇（包括你）战绩最好的那匹马复制出「样本七号」。 */
export function copyBestForK(state: GameState): void {
  const sample = state.rivals.find((r) => r.name === "样本七号");
  if (!sample) return;
  const score = (p: PublicRecord): number => p.wins * 3 + p.podiums + p.sumoWins * 2;
  const pool: Array<{ genome: Genome; wingGenes?: readonly [0 | 1, 0 | 1]; pub: PublicRecord }> = [...state.horses, ...state.rivals.filter((r) => !["样本七号", CUP.horse].includes(r.name))];
  const best = pool.reduce((a, b) => (score(b.pub) > score(a.pub) ? b : a), pool[0]!);
  sample.genome = JSON.parse(JSON.stringify(best.genome)) as Genome;
  sample.wingGenes = [...(best.wingGenes ?? [0, 0])] as [0 | 1, 0 | 1];
}

/** 睡觉：结算饲料、生小马、出测序结果、周日还债，然后进入第二天清晨。 */
export function sleep(state: GameState): NightReport {
  if (state.performance) throw new Error("先完成正在进行的演出");
  if (state.over) throw new Error("牧场已经交接");
  const day = state.day;
  for (const h of state.horses) {
    const p = express(h.genome);
    spend(state, `饲料 ${h.name}`, Math.min(state.money, feedCost(p.size, p.power, isFoal(h, day))));
  }
  const report: NightReport = { day, ledger: [], foals: [], sequenced: [], grownUp: [], debtPaid: 0, grace: null, ruined: false, ending: null };

  const next = day + 1;
  for (const preg of state.pregnancies.filter((p) => p.dueDay <= next)) {
    const dam = findHorse(state, preg.damId);
    const sire = findHorse(state, preg.sireId);
    if (!dam || !sire) continue;
    const rng = rngFor(state, `foal:${dam.id}:${sire.id}`);
    const { genome, mutations } = breed(preg.snapshots?.[0] ?? dam.genome, preg.snapshots?.[1] ?? sire.genome, rng);
    const taken = new Set(state.horses.map((h) => h.name).concat(state.rivals.map((r) => r.name)));
    const name=next===4&&!taken.has("小板凳")?"小板凳":horseName(rng,taken);
    const foal = createHorse(name, genome, {
      generation: Math.max(dam.generation, sire.generation) + 1,
      parents: [dam.name, sire.name],
      parentIds: [dam.id, sire.id],
      wingGenes: preg.wings ?? [0, 0],
      mutations: [...mutations],
      bornDay: next,
    });
    state.horses.push(foal);
    state.archive.push(foal);
    if (preg.prepared) state.flags[`chimera:${foal.id}`] = true;
    if (foal.wingGenes.includes(1) && express(foal.genome).compat >= 1) state.flags[`wings:${foal.id}`] = true;
    report.foals.push(foal);
  }
  state.pregnancies = state.pregnancies.filter((p) => p.dueDay > next);
  for (const h of state.horses) {
    if (h.sequencing) {
      h.sequencing = false;
      h.sequenced = true;
      report.sequenced.push(h);
      state.flags.genes = true;
    }
    if (h.bornDay > 0 && h.bornDay + FOAL_DAYS === next) report.grownUp.push(h);
  }

  settleDebt(state, day, report);
  if (bossFor(next)?.horse === "样本七号") copyBestForK(state);

  report.ledger = state.ledger;
  state.ledger = [];
  state.day = next;
  state.clock = DAY_START;
  state.lassos = LASSOS_PER_DAY;
  state.player = { ...HOME };
  if (state.entry && state.entry.day < next) state.entry = null;
  if (state.bet && state.bet.day < next) state.bet = null;
  return report;
}
