import { bodyPlanFrom } from "../body/bodyPlan";
import { breed, decodeGenome, encodeGenome, express, makeGenome, randomGenome, type Genome } from "../genome/genome";
import { displayStats } from "../genome/traits";
import { createRng, hashSeed, type Rng } from "../sim/rng";
import { horseName } from "./names";
import { emptyPublicRecord, raceOdds, recordRace, recordSumo, sumoOdds, type PublicRecord } from "./odds";
import {
  BOSS_PRIZE,
  DAY_START,
  debtDue,
  ENTRY_FEE,
  eventFor,
  feedCost,
  FOAL_DAYS,
  LASSOS_PER_DAY,
  RACE_PRIZES,
  salePrice,
  SEQUENCING_FEE,
  START_MONEY,
  SUMO_PRIZE,
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
}

/** 镇上其他人的马：有名字、有主人、有公开战绩，是你在赛场上反复遇到的对手。 */
export interface RivalHorse {
  id: string;
  name: string;
  owner: string;
  genome: Genome;
  pub: PublicRecord;
}

export interface Entry {
  day: number;
  kind: EventKind;
  horseId: string;
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
}

export interface LedgerLine {
  label: string;
  amount: number;
}

export interface GameState {
  version: 2;
  horses: StableHorse[];
  selectedId: string;
  day: number;
  /** 当天时钟，单位分钟（6:00 = 360）。 */
  clock: number;
  money: number;
  reputation: number;
  lassos: number;
  player: { x: number; z: number };
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
  /** 随机事件的种子计数器，保证存档可复现。 */
  counter: number;
}

const SAVE_KEY = "tianma.save.v2";
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
  return rivals;
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
    version: 2,
    horses,
    selectedId: horses[0]!.id,
    day: 1,
    clock: DAY_START,
    money: START_MONEY,
    reputation: 0,
    lassos: LASSOS_PER_DAY,
    player: { ...HOME },
    pregnancies: [],
    entry: null,
    bet: null,
    rivals: makeRivals(),
    ledger: [],
    flags: {},
    over: false,
    counter: 1,
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
  return JSON.stringify({ ...state, horses: state.horses.map(pack), rivals: state.rivals.map(pack) });
}

export function deserialize(text: string): GameState | null {
  try {
    const raw = JSON.parse(text) as Omit<GameState, "horses" | "rivals"> & { horses: Saved<StableHorse>[]; rivals: Saved<RivalHorse>[] };
    if (raw.version !== 2 || !Array.isArray(raw.horses) || !Array.isArray(raw.rivals)) return null;
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
    return {
      ...fresh,
      ...raw,
      version: 2,
      horses,
      rivals: rivals.length ? rivals : fresh.rivals,
      selectedId: horses.some((h) => h.id === raw.selectedId) ? raw.selectedId : horses[0]!.id,
    };
  } catch {
    return null;
  }
}

export function loadGame(): GameState {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (text) {
      const state = deserialize(text);
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
    localStorage.removeItem(SAVE_KEY);
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

/** 配种：当晚怀上，第二天早上小马出生。 */
export function mate(state: GameState, damId: string, sireId: string): ActionResult {
  const dam = findHorse(state, damId);
  const sire = findHorse(state, sireId);
  if (!dam || !sire || dam === sire) return fail("选两匹不同的马");
  if (isFoal(dam, state.day) || isFoal(sire, state.day)) return fail("小马还没长大");
  if (dam.bredDay === state.day || sire.bredDay === state.day) return fail("今天配过了");
  if (state.horses.length + state.pregnancies.length >= STABLE_LIMIT) return fail("马厩满了");
  dam.bredDay = state.day;
  sire.bredDay = state.day;
  state.pregnancies.push({ damId, sireId, dueDay: state.day + 1 });
  return OK;
}

/** 测序：交钱，第二天早上出结果。 */
export function sendToSequencing(state: GameState, id: string): ActionResult {
  const h = findHorse(state, id);
  if (!h) return fail("找不到这匹马");
  if (h.sequenced || h.sequencing) return fail("已经测过了");
  if (!spend(state, `测序 ${h.name}`, SEQUENCING_FEE)) return fail("钱不够");
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
  if (state.entry?.horseId === id) return fail("它报名了今天的比赛");
  if (state.pregnancies.some((p) => p.damId === id || p.sireId === id)) return fail("它刚配过种");
  earn(state, `卖掉 ${h.name}`, sellPrice(state, h));
  state.horses = state.horses.filter((x) => x.id !== id);
  if (state.selectedId === id) state.selectedId = state.horses[0]!.id;
  return OK;
}

export function canCatch(state: GameState): ActionResult {
  if (state.lassos <= 0) return fail("今天的套索用完了");
  if (state.horses.length + state.pregnancies.length >= STABLE_LIMIT) return fail("马厩满了");
  return OK;
}

/** 套中一匹野马，牵回牧场。 */
export function addCaught(state: GameState, name: string, genome: Genome): StableHorse {
  const taken = new Set(state.horses.map((h) => h.name).concat(state.rivals.map((r) => r.name)));
  const finalName = taken.has(name) ? horseName(rngFor(state, "rename"), taken) : name;
  const horse = createHorse(finalName, genome);
  state.horses.push(horse);
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
export function importHorse(state: GameState, code: string): StableHorse | "full" | "invalid" {
  if (state.horses.length + state.pregnancies.length >= STABLE_LIMIT) return "full";
  const genome = decodeGenome(code.trim());
  if (!genome) return "invalid";
  const rng = rngFor(state, `import:${code}`);
  const horse = createHorse(horseName(rng, new Set(state.horses.map((h) => h.name))), genome);
  state.horses.push(horse);
  return horse;
}

/* ---------------- 赛事 ---------------- */

export interface FieldEntry {
  id: string;
  name: string;
  owner: string;
  genome: Genome;
  pub: PublicRecord;
  mine: boolean;
}

/** 今天赛事的对手：由日期决定，同一天怎么看都一样。 */
export function todaysRivals(state: GameState, kind: EventKind = eventFor(state.day)): RivalHorse[] {
  if (kind === "boss") return state.rivals.filter((r) => r.name === TIEDUN);
  const rng = createRng(hashSeed(`field:${state.day}`));
  const pool = state.rivals.filter((r) => r.name !== TIEDUN);
  const picked: RivalHorse[] = [];
  const want = kind === "race" ? 7 : 1;
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
  if (mine) field.push({ id: mine.id, name: mine.name, owner: "你", genome: mine.genome, pub: mine.pub, mine: true });
  for (const r of rivals) field.push({ id: r.id, name: r.name, owner: r.owner, genome: r.genome, pub: r.pub, mine: false });
  // 没报名时空出来的位置由镇上另一匹马补上：平地赛凑满 8 匹，相扑和擂台凑成一对。
  if (!mine) {
    const pool = state.rivals.filter((r) => r.name !== TIEDUN && !rivals.includes(r));
    const extra = pool.length ? pool[hashSeed(`extra:${state.day}`) % pool.length] : undefined;
    if (extra) field.push({ id: extra.id, name: extra.name, owner: extra.owner, genome: extra.genome, pub: extra.pub, mine: false });
  }
  return field;
}

/** 今天的赔率，和 todaysField 一一对应。 */
export function todaysOdds(state: GameState): number[] {
  const field = todaysField(state);
  if (eventFor(state.day) === "race") return raceOdds(field.map((f) => ({ record: f.pub, key: `${f.id}:${state.day}` })));
  if (field.length < 2) return field.map(() => 1);
  const mass = (g: Genome): number => bodyPlanFrom(express(g)).totalMass;
  return sumoOdds({ record: field[0]!.pub, mass: mass(field[0]!.genome) }, { record: field[1]!.pub, mass: mass(field[1]!.genome) });
}

/** 报名今天的赛事。 */
export function register(state: GameState, horseId: string): ActionResult {
  const h = findHorse(state, horseId);
  if (!h) return fail("找不到这匹马");
  if (isFoal(h, state.day)) return fail("小马不能参赛");
  if (state.entry?.day === state.day) return fail("今天已经报过名");
  if (state.bet?.day === state.day) return fail("先报名再下注");
  if (!spend(state, "报名费", ENTRY_FEE)) return fail("钱不够");
  state.entry = { day: state.day, kind: eventFor(state.day), horseId };
  return OK;
}

/** 下注。 */
export function placeBet(state: GameState, horseId: string, amount: number, insured: boolean): ActionResult {
  if (state.bet?.day === state.day) return fail("今天已经下过注");
  const field = todaysField(state);
  const i = field.findIndex((f) => f.id === horseId);
  if (i < 0) return fail("这匹马今天不上场");
  if (amount <= 0) return fail("押多少？");
  if (amount > betLimit(state.reputation)) return fail("超过下注上限");
  const odds = todaysOdds(state)[i] as number;
  if (!spend(state, "下注", amount)) return fail("钱不够");
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

/** 比赛结束后结算：奖金、赌注、声望、公开战绩。 */
export function applyOutcome(state: GameState, kind: EventKind, order: string[] | null): EventOutcome {
  const field = todaysField(state);
  const out: EventOutcome = { kind, order, myRank: null, prize: 0, betReturn: 0, reputation: 0 };
  const recordOf = (id: string): PublicRecord | undefined => findHorse(state, id)?.pub ?? state.rivals.find((r) => r.id === id)?.pub;
  if (order) {
    order.forEach((id, i) => {
      const rec = recordOf(id);
      if (!rec) return;
      if (kind === "race") recordRace(rec, i + 1);
      else recordSumo(rec, i === 0);
    });
  }
  const mine = field.find((f) => f.mine);
  if (mine && order) {
    const rank = order.indexOf(mine.id) + 1;
    out.myRank = rank;
    if (kind === "race") out.prize = RACE_PRIZES[rank - 1] ?? 0;
    else if (rank === 1) out.prize = kind === "boss" ? BOSS_PRIZE : SUMO_PRIZE;
    if (kind === "race" ? rank <= 3 : rank === 1) out.reputation = kind === "boss" ? 3 : 1;
    if (kind === "boss" && rank === 1) state.flags["beat:tiedun"] = true;
  }
  if (out.prize) earn(state, kind === "race" ? `平地赛第 ${out.myRank} 名` : kind === "boss" ? "擂台奖金" : "相扑奖金", out.prize);
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
  /** 还不上债，游戏结束。 */
  ruined: boolean;
}

/** 睡觉：结算饲料、生小马、出测序结果、周日还债，然后进入第二天清晨。 */
export function sleep(state: GameState): NightReport {
  const day = state.day;
  for (const h of state.horses) {
    const p = express(h.genome);
    spend(state, `饲料 ${h.name}`, Math.min(state.money, feedCost(p.size, p.power, isFoal(h, day))));
  }
  const report: NightReport = { day, ledger: [], foals: [], sequenced: [], grownUp: [], debtPaid: 0, ruined: false };

  const next = day + 1;
  for (const preg of state.pregnancies.filter((p) => p.dueDay <= next)) {
    const dam = findHorse(state, preg.damId);
    const sire = findHorse(state, preg.sireId);
    if (!dam || !sire) continue;
    const rng = rngFor(state, `foal:${dam.id}:${sire.id}`);
    const { genome, mutations } = breed(dam.genome, sire.genome, rng);
    const taken = new Set(state.horses.map((h) => h.name).concat(state.rivals.map((r) => r.name)));
    const foal = createHorse(horseName(rng, taken), genome, {
      generation: Math.max(dam.generation, sire.generation) + 1,
      parents: [dam.name, sire.name],
      mutations: [...mutations],
      bornDay: next,
    });
    state.horses.push(foal);
    report.foals.push(foal);
  }
  state.pregnancies = state.pregnancies.filter((p) => p.dueDay > next);
  for (const h of state.horses) {
    if (h.sequencing) {
      h.sequencing = false;
      h.sequenced = true;
      report.sequenced.push(h);
    }
    if (h.bornDay > 0 && h.bornDay + FOAL_DAYS === next) report.grownUp.push(h);
  }

  const due = day % 7 === 0 ? debtDue(day) : 0;
  if (due > 0) {
    if (state.money >= due) {
      spend(state, "还债", due);
      report.debtPaid = due;
    } else {
      report.ruined = true;
      state.over = true;
    }
  }

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
