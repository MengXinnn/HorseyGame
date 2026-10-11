import { describe, expect, it } from "vitest";
import { bodyPlanFrom } from "../src/body/bodyPlan";
import { CUP_CROWD, sportOf, WEATHER_PHYSICS, weatherFor } from "../src/game/calendar";
import { betLimit, debtDue, ENTRY_FEE, eventFor, RACE_DISTANCE } from "../src/game/season";
import {
  addCaught,
  applyOutcome,
  isFoal,
  mate,
  newGame,
  placeBet,
  register,
  sellHorse,
  sellPrice,
  sleep,
  todaysField,
  todaysOdds,
  wildHerd,
  type FieldEntry,
  type GameState,
  type StableHorse,
} from "../src/game/state";
import { express, type Genome } from "../src/genome/genome";
import { displayStats } from "../src/genome/traits";
import { Race, trial } from "../src/sim/race";
import { hashSeed } from "../src/sim/rng";
import { SumoBout } from "../src/sim/sumo";

/**
 * 经济模拟：一个会算计的玩家照着日历过 28 天，看四笔债还不还得上。
 * 它会套马、配种、挑当天最合适的马报名，私下先模拟几遍，觉得稳赢才押注。
 * 跑得慢，单独用 `npm run sim:economy` 执行，调奖金和债务时看它。
 */

const KEEP = 8;
const mass = (g: Genome): number => bodyPlanFrom(express(g)).totalMass;
const scores = new WeakMap<Genome, number>();
/** 试跑十秒的距离（同一匹马只算一次）。 */
const raceScore = (g: Genome): number => {
  let d = scores.get(g);
  if (d === undefined) {
    d = trial(g, 10, 7).distance;
    scores.set(g, d);
  }
  return d;
};

/** 跑一场（和界面里 runEvent 一样的规则），返回名次顺序。 */
function runField(field: FieldEntry[], day: number, seed: number): string[] | null {
  const phys = WEATHER_PHYSICS[weatherFor(day)];
  if (sportOf(day) === "race") {
    const race = new Race(
      field.map((f) => ({ id: f.id, name: f.name, genome: f.genome })),
      { distance: RACE_DISTANCE, seed, timeLimit: 120, gravity: phys.gravity, groundFriction: phys.friction, wind: phys.wind, crowd: eventFor(day) === "cup" ? CUP_CROWD : undefined },
    );
    return [...race.runToEnd()].sort((a, b) => a.rank - b.rank).map((r) => r.id);
  }
  const [a, b] = field as [FieldEntry, FieldEntry];
  const bout = new SumoBout(a, b, { seed, gravity: phys.gravity, groundFriction: phys.friction });
  bout.runToEnd();
  return bout.winner === null ? null : bout.winner === 0 ? [a.id, b.id] : [b.id, a.id];
}

function pickFor(g: GameState): StableHorse | undefined {
  const ready = g.horses.filter((h) => !isFoal(h, g.day));
  const score = (h: StableHorse): number => {
    if (sportOf(g.day) === "sumo") {
      const s = displayStats(express(h.genome));
      return mass(h.genome) * (s.stability + 20);
    }
    return raceScore(h.genome);
  };
  return ready.sort((a, b) => score(b) - score(a))[0];
}

interface Week {
  day: number;
  money: number;
  paid: number;
  grace: boolean;
}

function playSeason(tag: string): { weeks: Week[]; ending: string | null; ruinedDay: number | null; wins: number; bets: number } {
  const g = newGame();
  const weeks: Week[] = [];
  let wins = 0;
  let bets = 0;
  for (let day = 1; day <= 28; day++) {
    // 套马：每天从野马群里挑一匹看着最快的。
    if (g.horses.length < KEEP) {
      const herd = wildHerd(g, hashSeed(tag) % 3, 6);
      const best = herd.sort((a, b) => raceScore(b.genome) - raceScore(a.genome))[0];
      if (best) addCaught(g, best.name, best.genome);
    }
    // 配种：最快的两匹配一窝。
    const adults = g.horses.filter((h) => !isFoal(h, g.day)).sort((a, b) => raceScore(b.genome) - raceScore(a.genome));
    if (adults.length >= 2 && g.horses.length + g.pregnancies.length < KEEP + 2) mate(g, adults[0]!.id, adults[1]!.id);
    // 马太多就卖掉最便宜的。
    while (g.horses.length > KEEP) {
      const cheap = [...g.horses].sort((a, b) => sellPrice(g, a) - sellPrice(g, b))[0]!;
      if (!sellHorse(g, cheap.id).ok) break;
    }

    const mine = pickFor(g);
    if (mine && g.money >= ENTRY_FEE && register(g, mine.id).ok) {
      const field = todaysField(g);
      // 私下模拟两遍，都赢才押。
      let privWins = 0;
      for (let i = 0; i < 2; i++) if (runField(field, day, hashSeed(`${tag}:priv:${day}:${i}`))?.[0] === mine.id) privWins++;
      const odds = todaysOdds(g)[field.findIndex((f) => f.mine)] ?? 1;
      // 还债那天留够钱，平时押一半家当。
      const reserve = day % 7 === 0 ? debtDue(day) : 0;
      const stake = Math.min(betLimit(g.reputation), Math.floor(Math.max(0, g.money - reserve) / 2));
      if (privWins === 2 && odds >= 1.5 && stake >= 10 && placeBet(g, mine.id, stake, false).ok) bets++;
    }
    const field = todaysField(g);
    const order = runField(field, day, hashSeed(`${tag}:event:${day}`));
    const out = applyOutcome(g, eventFor(day), order);
    if (out.myRank === 1) wins++;
    const night = sleep(g);
    if (day % 7 === 0 || night.ruined || night.grace) weeks.push({ day, money: g.money, paid: night.debtPaid, grace: !!night.grace });
    if (night.ruined) return { weeks, ending: g.ending, ruinedDay: day, wins, bets };
  }
  return { weeks, ending: g.ending, ruinedDay: null, wins, bets };
}

describe("经济：会算计的玩家能不能还清四笔债", () => {
  it("跑四个存档，打印每周还债情况", () => {
    const results = ["a", "b", "c", "d"].map((tag) => ({ tag, ...playSeason(tag) }));
    for (const r of results) {
      const weeks = r.weeks.map((w) => `第${w.day}天 还${w.paid} 剩${w.money}${w.grace ? " 宽限" : ""}`).join("　");
      console.log(`存档 ${r.tag}：${r.ending ?? "未完"}${r.ruinedDay ? `（第${r.ruinedDay}天被收走）` : ""}　赢 ${r.wins} 场　押 ${r.bets} 次　${weeks}`);
    }
    // 第一笔两千，会玩的人不该还不上。
    for (const r of results) expect(r.ruinedDay === null || r.ruinedDay > 7, r.tag).toBe(true);
  });
});
