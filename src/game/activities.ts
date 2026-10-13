import { makeGenome, express, type Allele } from "../genome/genome";
import { LOCUS_IDS, type LocusId } from "../genome/loci";
import { Race, type Entrant, type RaceResult } from "../sim/race";
import { hashSeed } from "../sim/rng";
import { RELAY_LEGS, type Terrain } from "../sim/terrain";
import { prizeScale } from "./calendar";
import { TIME_COST } from "./season";
import { addCaught, canCatch, charge, findHorse, grant, hasTime, isFoal, mate, passTime, register, rngFor, throwLasso, todaysField, type ActionResult, type GameState, type StableHorse } from "./state";

export const hasWings = (horse: { genome: StableHorse["genome"]; wingGenes?: readonly number[] }): boolean =>
  !!horse.wingGenes?.includes(1) && express(horse.genome).compat >= 1;
const fail = (reason: string): ActionResult => ({ ok: false, reason });
const ready = (s: GameState, day: number, minutes: number): ActionResult =>
  s.over ? fail("牧场已经交接") : s.day < day ? fail(`第${day}天开放`) : !hasTime(s, minutes) ? fail("今天来不及了") : { ok: true };
export const WORK = {
  fence: { label: "修赛场围栏", day: 4, pay: 100, minutes: 30 },
  ring: { label: "搭老赵的擂台", day: 6, pay: 80, minutes: 30 },
  tent: { label: "搭红帐篷", day: 8, pay: 100, minutes: 45 },
  levee: { label: "帮老舟修堤", day: 15, pay: 100, minutes: 30 },
} as const;
export type WorkId = keyof typeof WORK;
export function doWork(s: GameState, id: WorkId): ActionResult {
  const work = WORK[id];
  if (!work) return fail("没有这份工作");
  const ok = ready(s, work.day, work.minutes);
  if (!ok.ok) return ok;
  if (s.flags[`work:${id}`]) return fail("这份工作已经结清");
  passTime(s, work.minutes);
  s.flags[`work:${id}`] = true;
  grant(s, work.label, work.pay);
  return { ok: true };
}
export type Program = "haul" | "jump" | "balance";
export const PROGRAMS: Record<Program, string> = { haul: "拉车", jump: "越障", balance: "平衡台" };
export interface Performance { success: boolean; pay: number; result: RaceResult }
export function startPerformance(s: GameState, horseId: string, program: Program): ActionResult & { race?: Race } {
  if (!PROGRAMS[program]) return fail("选择一个节目");
  const ok = ready(s, 8, TIME_COST.circus);
  if (!ok.ok) return ok;
  if (s.performance) return fail("先完成上一场演出");
  const h = findHorse(s, horseId);
  if (!h || isFoal(h, s.day)) return fail("选一匹成年马");
  if (s.flags[`circus:${s.day}:2`]) return fail("今天两场演出已经结束");
  const count = s.flags[`circus:${s.day}:1`] ? 2 : 1;
  s.performance = { day: s.day, horseId, program, count };
  passTime(s, TIME_COST.circus);
  s.flags[`circus:${s.day}:${count}`] = true;
  return { ok: true, race: resumePerformance(s)! };
}
export function resumePerformance(s: GameState): Race | null {
  const ticket = s.performance;
  const h = ticket ? findHorse(s, ticket.horseId) : undefined;
  if (!h || !ticket) return null;
  const { program, count, day } = ticket;
  return new Race([{ id: h.id, name: h.name, genome: h.genome, wings: hasWings(h) }], {
    distance: 40, seed: hashSeed(`circus:${day}:${h.id}:${count}:${program}`), timeLimit: 12,
    wind: program === "haul" ? 2.2 : program === "balance" ? 0.6 : 0,
    crowd: 2, terrains: program === "jump" ? ["hill", "forest"] : ["grass"],
  });
}
export function completePerformance(s: GameState, race: Race): Performance | null {
  const ticket = s.performance;
  if (!ticket || ticket.day !== s.day || !race.finished || race.runners[0]?.entrant.id !== ticket.horseId || race.options.seed !== hashSeed(`circus:${ticket.day}:${ticket.horseId}:${ticket.count}:${ticket.program}`)) return null;
  const { program } = ticket;
  const result = race.runToEnd()[0]!;
  const success = result.falls === 0 && (program === "balance" ? race.runners[0]!.horse.maxTilt < 0.35 : result.distance >= (program === "haul" ? 12 : 24));
  const pay = Math.round((success ? 180 : 40 + Math.min(80, result.distance)) * prizeScale(s.day));
  grant(s, `马戏${PROGRAMS[program]}`, pay);
  s.performance = null;
  return { success, pay, result };
}
export function perform(s: GameState, horseId: string, program: Program): ActionResult & { performance?: Performance } {
  const start = startPerformance(s, horseId, program);
  if (!start.ok || !start.race) return start;
  start.race.runToEnd();
  return { ok: true, performance: completePerformance(s,start.race)! };
}
export function editGene(s: GameState, id: string, locus: LocusId, chain: 0 | 1, delta: -1 | 1): ActionResult {
  const ok = ready(s, 18, TIME_COST.edit);
  if (!ok.ok) return ok;
  if (!LOCUS_IDS.includes(locus) || ![0, 1].includes(chain) || ![-1, 1].includes(delta)) return fail("编辑方案无效");
  const h = findHorse(s, id);
  if (!h || isFoal(h, s.day)) return fail("选一匹成年马");
  if (!h.sequenced) return fail("先拿到这匹马的测序报告");
  if (s.performance?.horseId === id) return fail("先完成这匹马的演出");
  if (h.sequencing || s.entry?.horseId === id || s.entry?.team?.includes(id)) return fail("它正在测序或已报名");
  if (s.pregnancies.some(p => p.damId === id || p.sireId === id)) return fail("亲本正在等待小马出生");
  if (s.flags[`edit:${s.day}:${id}`]) return fail("今天先看这一处的结果");
  const value = h.genome[locus][chain] + delta;
  if (value < -2 || value > 2) return fail("已经到这一处的边界");
  const fee = s.flags["edit:coupon-used"] ? 1500 : 0;
  if (s.money < fee) return fail("钱不够");
  const pair: [Allele, Allele] = [...h.genome[locus]];
  pair[chain] = value as Allele;
  charge(s, `编辑 ${h.name}`, fee);
  h.genome = makeGenome({ ...h.genome, [locus]: pair });
  passTime(s, TIME_COST.edit);
  s.flags["edit:coupon-used"] = true;
  s.flags[`edit:${s.day}:${id}`] = true;
  return { ok: true };
}
export function prepareChimera(s: GameState, a: string, b: string): ActionResult {
  const ok = ready(s, 25, TIME_COST.mate + TIME_COST.chimera);
  if (!ok.ok) return ok;
  if (!s.flags["mountain:sample"]) return fail("先带回雪山材料");
  const fee = s.flags["chimera:coupon-used"] ? 1500 : 0;
  if (s.money < fee) return fail("钱不够");
  const result = mate(s, a, b);
  if (!result.ok) return result;
  const pregnancy = s.pregnancies.at(-1)!;
  pregnancy.prepared = true;
  pregnancy.wings = [1, pregnancy.wings?.[1] ?? 0];
  charge(s, "背部嵌合准备", fee);
  passTime(s, TIME_COST.chimera);
  s.flags["chimera:coupon-used"] = true;
  return { ok: true };
}
export function mountainSample(s: GameState, catchHorse: boolean): ActionResult & { caught?: boolean } {
  const ok = ready(s, 23, catchHorse ? TIME_COST.throwLasso + TIME_COST.catch : TIME_COST.sample);
  if (!ok.ok) return ok;
  if (s.flags["mountain:sample"]) return fail("已经带回了材料");
  if (!catchHorse) {
    passTime(s, TIME_COST.sample);
    s.flags["mountain:sample"] = true;
    return { ok: true, caught: false };
  }
  const allowed = canCatch(s);
  if (!allowed.ok) return allowed;
  throwLasso(s);
  if (!rngFor(s, "mountain-lasso").chance(0.62)) return { ok: true, caught: false };
  const horse = addCaught(s, "山岚", makeGenome({ size: [-1, -1], legF: [-1, 0], legR: [-1, 0], hoof: [2, 1], con: [1, 1], compat: [2, 1], courage: [0, 1] }));
  horse.wingGenes = [1, 0];
  s.flags["mountain:sample"] = true;
  s.flags[`wings:${horse.id}`] = true;
  return { ok: true, caught: true };
}
export function visitTerrain(s: GameState, terrain: Terrain, id: string): ActionResult & { result?: RaceResult } {
  const unlock: Record<Terrain, number> = { grass: 1, wetland: 12, hill: 12, coast: 15, forest: 16, mountain: 23 };
  const ok = ready(s, unlock[terrain] ?? 99, TIME_COST.trial);
  if (!ok.ok) return ok;
  const h = findHorse(s, id);
  if (!h || isFoal(h, s.day)) return fail("选一匹成年马");
  const race = new Race([{ id, name: h.name, genome: h.genome, wings: hasWings(h) }], {
    distance: 40, timeLimit: 12, seed: hashSeed(`terrain:${s.day}:${id}:${terrain}`), terrains: [terrain],
  });
  const result = race.runToEnd()[0]!;
  passTime(s, TIME_COST.trial);
  return { ok: true, result };
}
export function registerRelay(s: GameState, team: [string, string, string]): ActionResult {
  if (s.day !== 28) return fail("接力赛在第二十八天");
  if (new Set(team).size !== 3) return fail("每段选不同的马");
  if (team.some(id => !findHorse(s, id) || isFoal(findHorse(s, id)!, s.day))) return fail("三匹都要成年");
  return register(s, team[0], team);
}
export interface RelayTeam { id: string; name: string; horses: [Entrant, Entrant, Entrant] }
export function relayTeams(s: GameState): RelayTeam[] {
  return todaysField(s).map(f => {
    const ids = f.mine ? s.entry?.team : undefined;
    const horses = ids ? ids.map(id => {
      const h = findHorse(s, id)!;
      return { id: h.id, name: h.name, genome: h.genome, wings: hasWings(h) };
    }) : [0, 1, 2].map(i => ({ id: `${f.id}:leg:${i}`, name: f.name, genome: f.genome, wings: hasWings(f) }));
    return { id: f.id, name: `${f.owner}队`, horses: horses as [Entrant, Entrant, Entrant] };
  });
}
export function practiceRelay(s: GameState): ActionResult {
  const ok = ready(s, 16, TIME_COST.relay);
  if (!ok.ok) return ok;
  passTime(s, TIME_COST.relay);
  s.flags["relay:practiced"] = true;
  return { ok: true };
}
export function relayRace(teams: RelayTeam[], leg: number, seed: number): Race {
  return new Race(teams.map(t => ({ ...t.horses[leg]!, id: t.id, name: t.name })), {
    distance: 80, timeLimit: 45, seed: hashSeed(`${seed}:${leg}`), terrains: RELAY_LEGS[leg],
  });
}
/** 未完成路段按剩余距离加罚秒，不能靠提前摔倒拿到更短总时间。 */
export function relaySeconds(result: RaceResult): number { return result.time ?? 45 + (80 - result.distance) * 2; }
