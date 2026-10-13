/**
 * 赛季日历：每周的擂台主、天马杯、《马蹄镇日报》登的天气修正，和随周上涨的奖金。
 * 只有规则和数字，不碰界面。
 */
import { hashSeed } from "../sim/rng";
import { eventFor, RACE_PRIZES, SUMO_PRIZE, weekOf } from "./season";

/** 比赛用哪套物理：跑道还是相扑台。 */
export type Sport = "race" | "sumo";

export interface Boss {
  owner: string;
  horse: string;
  sport: Sport;
  prize: number;
}

/** 前三笔还款当天的擂台主。 */
export const BOSSES: Boss[] = [
  { owner: "老赵", horse: "铁墩", sport: "sumo", prize: 1000 },
  { owner: "米娅", horse: "豆包", sport: "race", prize: 4000 },
  { owner: "K博士", horse: "样本七号", sport: "race", prize: 10000 },
];

/** 天马杯：马董带着完美马「完璧」，和镇上最好的几匹马一起跑。 */
export const CUP = { owner: "马董", horse: "完璧", prizes: [15000, 5000, 2000], rivals: 6 };

/** 天马杯看台坐满了人：胆小的马发呆的机会翻这么多倍。 */
export const CUP_CROWD = 3;

/** 剧情里出场的马，不进普通赛事的对手池。 */
export const STORY_HORSES = [...BOSSES.map((b) => b.horse), CUP.horse, "潮生"];

export function bossFor(day: number): Boss | null {
  if (eventFor(day) !== "boss") return null;
  return BOSSES[weekOf(day) - 1] ?? null;
}

export function sportOf(day: number): Sport {
  const kind = eventFor(day);
  if (kind === "sumo") return "sumo";
  if (kind === "boss") return (bossFor(day) as Boss).sport;
  return "race";
}

/** 经营阶段（1–4），22日以后维持第四阶段。 */
export function seasonWeek(day: number): number {
  return weekOf(day);
}

/** 平时比赛的奖金随周上涨：后面的赛事看的人多，彩头也大。 */
export const PRIZE_SCALE = [1, 3, 6, 10];

export function prizeScale(day: number): number {
  return PRIZE_SCALE[seasonWeek(day) - 1] as number;
}

/** 某个名次能拿多少奖金（rank 从 1 开始）。 */
export function prizeFor(day: number, rank: number): number {
  const kind = eventFor(day);
  if (kind === "cup") return CUP.prizes[rank - 1] ?? 0;
  if (kind === "relay") return ([10000, 5000, 2000][rank - 1] ?? 0);
  if (kind === "boss") return rank === 1 ? (bossFor(day) as Boss).prize : 0;
  if (kind === "sumo") return rank === 1 ? SUMO_PRIZE * prizeScale(day) : 0;
  return (RACE_PRIZES[rank - 1] ?? 0) * prizeScale(day);
}

/* ---------------- 天气 ---------------- */

export type Weather = "clear" | "rain" | "wind" | "moon" | "ice";

export const WEATHER_LABELS: Record<Weather, string> = {
  clear: "晴",
  rain: "雨天泥地",
  wind: "大风",
  moon: "赏月节低重力",
  ice: "冰面",
};

export const WEATHER_HINTS: Record<Weather, string> = {
  clear: "",
  rain: "地滑，蹄宽的马站得住",
  wind: "顶风，又高又轻的马容易被吹翻",
  moon: "重力小，一蹬就飘",
  ice: "地很滑，步子碎的马才不摔",
};

/** 物理参数：重力、地面摩擦、迎面风（米/秒²）。 */
export interface Physics {
  gravity: number;
  friction: number;
  wind: number;
}

export const WEATHER_PHYSICS: Record<Weather, Physics> = {
  clear: { gravity: 9.8, friction: 1, wind: 0 },
  rain: { gravity: 9.8, friction: 0.55, wind: 0 },
  wind: { gravity: 9.8, friction: 1, wind: 1.6 },
  moon: { gravity: 5.5, friction: 1, wind: 0 },
  ice: { gravity: 9.8, friction: 0.2, wind: 0 },
};

/** 剧本里写死的天气（第 10 天雨、第 19 天大风）。 */
const FIXED_WEATHER: Record<number, Weather> = { 10: "rain", 19: "wind" };
const RANDOM_WEATHER: Weather[] = ["clear", "clear", "clear", "rain", "wind", "moon", "ice"];

/** 第一周天天晴；之后由日报预报，天马杯当天总是晴天。 */
export function weatherFor(day: number): Weather {
  if (day <= 7 || eventFor(day) === "cup") return "clear";
  const fixed = FIXED_WEATHER[day];
  if (fixed) return fixed;
  return RANDOM_WEATHER[hashSeed(`weather:${day}`) % RANDOM_WEATHER.length] as Weather;
}
