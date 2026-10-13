/**
 * 31天赛季：行动计时，傍晚5点开赛；7/14/21/31日还款。
 * 这里只放规则和数字，不碰界面，方便测试。
 */
import type { TimeOfDay } from "../render/scene";

export const DAY_START = 6 * 60;
export const EVENT_TIME = 17 * 60;
/** 比赛散场的钟点。 */
export const AFTER_EVENT = 19 * 60;
export const MIDNIGHT = 24 * 60;

/**
 * 时间不会自己走：做一件事才花一段时间（分钟）。逛、看马、翻马厩、聊天都不花时间。
 * 每件改变局面的事至少花十分钟；走路按路程算，每走 TRAVEL_TILES 格花一刻钟——
 * 在一片地方里转转花不了多少，跑远路日子才慢慢往前挪。想快进就歇一会儿，或者直接等到傍晚开赛。
 */
export const TIME_COST = {
  /** 每走 TRAVEL_TILES 格路。 */
  travel: 15,
  /** 扔一次套索。 */
  throwLasso: 10,
  /** 套中以后把马牵回去。 */
  catch: 30,
  mate: 60,
  sequence: 20,
  sell: 20,
  import: 20,
  register: 10,
  bet: 10,
  trial: 30,
  rest: 60,
  work: 30,
  circus: 90,
  edit: 60,
  sample: 10,
  chimera: 60,
  relay: 90,
} as const;

/** 走这么多格（大约走 9 秒、跑 5 秒）花 TIME_COST.travel 分钟。从家走到镇上的喷泉大约半小时。 */
export const TRAVEL_TILES = 40;

export const START_MONEY = 300;
export const LASSOS_PER_DAY = 3;
export const ENTRY_FEE = 50;
export const SEQUENCING_FEE = 200;
export const RACE_DISTANCE = 400;
export const RACE_PRIZES = [500, 250, 120];
export const SUMO_PRIZE = 400;
export const BOSS_PRIZE = 1000;
/** 7/14/21/31日的四笔本金，总计六万。 */
export const DEBT_SCHEDULE = [2000, 8000, 20000, 30000];
/** 一匹马从出生到成年要几天。 */
export const FOAL_DAYS = 2;

export type EventKind = "race" | "sumo" | "boss" | "relay" | "cup";

export const EVENT_LABELS: Record<EventKind, string> = { race: "平地赛", sumo: "相扑", boss: "擂台", relay: "六地貌接力", cup: "天马杯" };

/** 主线31天；28日接力，31日杯赛，之后继续普通经营。 */
export const SEASON_DAYS = 31;
export const DEBT_DAYS = [7, 14, 21, 31] as const;

/** 奇数日平地赛、偶数日相扑，主线的擂台、接力和杯赛覆盖对应日期。 */
export function eventFor(day: number): EventKind {
  if (day === SEASON_DAYS) return "cup";
  if (day === 28) return "relay";
  if (day === 7 || day === 14 || day === 21) return "boss";
  return day % 2 === 1 ? "race" : "sumo";
}

export function weekOf(day: number): number {
  return Math.min(4, Math.ceil(day / 7));
}

/** 这一周要还多少（第 5 周以后不再要债）。 */
export function debtDue(day: number): number {
  const index = DEBT_DAYS.findIndex((due) => due >= day);
  return DEBT_SCHEDULE[index] ?? 0;
}

export function daysUntilDebt(day: number): number {
  const next = DEBT_DAYS.find((due) => due >= day);
  return next === undefined ? 0 : next - day;
}

/** 时钟（分钟）对应的时段，用来换天色。 */
export function phaseOf(clock: number): TimeOfDay {
  if (clock < 10 * 60) return "dawn";
  if (clock < 16 * 60) return "noon";
  if (clock < 19 * 60) return "dusk";
  return "night";
}

/** 一段时间怎么写：15分、1小时、1小时30分。 */
export function formatSpan(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}分`;
  return m ? `${h}小时${m}分` : `${h}小时`;
}

export function formatClock(clock: number): string {
  const m = Math.floor(clock) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 养一匹马一晚上的饲料钱：体型大、肌力强的马吃得多，小马吃得少。 */
export function feedCost(size: number, power: number, foal: boolean): number {
  if (foal) return 5;
  return Math.round(8 + 3 * (size + 2) + 2 * (power + 2));
}

/** 马市收购价：看面板属性和公开战绩。 */
export function salePrice(statSum: number, wins: number, podiums: number, foal: boolean): number {
  const base = 80 + 1.6 * (statSum - 200) + 120 * wins + 40 * podiums;
  const price = Math.max(40, Math.min(3000, base));
  return Math.round((foal ? price / 2 : price) / 5) * 5;
}

/** 下注上限随声望增长。 */
export function betLimit(reputation: number): number {
  return 100 + 100 * reputation;
}

/** 押注保险：输了退一半本金，赢了只拿八成。 */
export const INSURED_REFUND = 0.5;
export const INSURED_PAYOUT = 0.8;

export function betPayout(stake: number, odds: number, won: boolean, insured: boolean): number {
  if (won) return Math.round(stake * odds * (insured ? INSURED_PAYOUT : 1));
  return insured ? Math.round(stake * INSURED_REFUND) : 0;
}
