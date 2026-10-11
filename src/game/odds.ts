import { hashSeed } from "../sim/rng";

/** 庄家能看到的公开战绩。基因和测序结果庄家看不到，所以没比过赛的新马赔率最高。 */
export interface PublicRecord {
  races: number;
  wins: number;
  podiums: number;
  /** 所有平地赛名次之和，用来算平均名次。 */
  rankSum: number;
  sumo: number;
  sumoWins: number;
}

export const emptyPublicRecord = (): PublicRecord => ({ races: 0, wins: 0, podiums: 0, rankSum: 0, sumo: 0, sumoWins: 0 });

const MARGIN = 0.86;
export const MIN_ODDS = 1.2;
export const MAX_ODDS = 30;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const clampOdds = (v: number): number => round1(Math.max(MIN_ODDS, Math.min(MAX_ODDS, v)));

/** 一匹马的平地赛评分：赢得多、平均名次靠前就高。 */
function raceRating(r: PublicRecord, field: number): number {
  const avgRank = r.rankSum / r.races;
  const placing = 1 - (avgRank - 1) / Math.max(1, field - 1);
  return 2.4 * ((r.wins + 0.3) / (r.races + 1)) + 1.6 * placing + 0.6 * (r.podiums / r.races);
}

/**
 * 平地赛赔率。key 用来给新马一个稳定的「庄家直觉」，同一匹新马在同一天赔率不变。
 * 新马（没有战绩）被当成黑马，赔率在 12–30 倍之间。
 */
export function raceOdds(entries: Array<{ record: PublicRecord; key: string }>): number[] {
  const n = entries.length;
  const known = entries.map((e) => e.record.races > 0);
  const weights = entries.map((e) => (e.record.races > 0 ? Math.exp(1.4 * raceRating(e.record, n)) : 0));
  const unknownCount = known.filter((k) => !k).length;
  // 新马分走的总概率：每匹新马大约 1/(n·1.8)。
  const unknownShare = Math.min(0.6, unknownCount / (n * 1.8));
  const knownTotal = weights.reduce((a, b) => a + b, 0);
  return entries.map((e, i) => {
    if (!known[i]) {
      const hunch = (hashSeed(e.key) % 1000) / 1000;
      return clampOdds(12 + hunch * 18);
    }
    const p = ((weights[i] as number) / knownTotal) * (1 - (unknownCount ? unknownShare : 0));
    return clampOdds(MARGIN / p);
  });
}

/** 相扑赔率：庄家看得见体重，再看相扑战绩。 */
export function sumoOdds(a: { record: PublicRecord; mass: number }, b: { record: PublicRecord; mass: number }): [number, number] {
  const strength = (x: { record: PublicRecord; mass: number }): number => Math.pow(x.mass, 1.6) * (1 + (x.record.sumoWins + 0.5) / (x.record.sumo + 1));
  const sa = strength(a);
  const sb = strength(b);
  const pa = sa / (sa + sb);
  return [clampOdds(MARGIN / pa), clampOdds(MARGIN / (1 - pa))];
}

/** 比赛结束后更新公开战绩。 */
export function recordRace(r: PublicRecord, rank: number): void {
  r.races++;
  r.rankSum += rank;
  if (rank === 1) r.wins++;
  if (rank <= 3) r.podiums++;
}

export function recordSumo(r: PublicRecord, won: boolean): void {
  r.sumo++;
  if (won) r.sumoWins++;
}
