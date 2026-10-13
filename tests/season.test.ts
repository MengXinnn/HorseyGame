import { describe, expect, it } from "vitest";
import { betLimit, betPayout, daysUntilDebt, debtDue, eventFor, feedCost, formatClock, phaseOf, salePrice, weekOf } from "../src/game/season";
import { emptyPublicRecord, MAX_ODDS, MIN_ODDS, raceOdds, recordRace, sumoOdds } from "../src/game/odds";

describe("日程", () => {
  it("单日平地赛，双日相扑，每七天擂台", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(eventFor)).toEqual(["race", "sumo", "race", "sumo", "race", "sumo", "boss", "sumo"]);
  });

  it("7、14、21、31日还款", () => {
    expect([1, 7, 8, 14, 21, 28, 29, 31, 32].map(debtDue)).toEqual([2000, 2000, 8000, 8000, 20000, 30000, 30000, 30000, 0]);
    expect(weekOf(7)).toBe(1);
    expect(daysUntilDebt(1)).toBe(6);
    expect(daysUntilDebt(7)).toBe(0);
  });

  it("时钟和时段", () => {
    expect(formatClock(6 * 60)).toBe("06:00");
    expect(formatClock(17 * 60 + 5.7)).toBe("17:05");
    expect(phaseOf(7 * 60)).toBe("dawn");
    expect(phaseOf(12 * 60)).toBe("noon");
    expect(phaseOf(17 * 60)).toBe("dusk");
    expect(phaseOf(21 * 60)).toBe("night");
  });
});

describe("钱", () => {
  it("大马吃得多，小马吃得少", () => {
    expect(feedCost(2, 2, false)).toBeGreaterThan(feedCost(-2, -2, false));
    expect(feedCost(2, 2, true)).toBe(5);
  });

  it("马市价格看属性和战绩，小马半价", () => {
    expect(salePrice(260, 2, 3, false)).toBeGreaterThan(salePrice(260, 0, 0, false));
    expect(salePrice(260, 0, 0, true)).toBeLessThan(salePrice(260, 0, 0, false));
    expect(salePrice(0, 0, 0, false)).toBe(40);
  });

  it("下注上限随名望涨，保险输了退一半赢了拿八成", () => {
    expect(betLimit(0)).toBe(100);
    expect(betLimit(3)).toBe(400);
    expect(betPayout(100, 5, true, false)).toBe(500);
    expect(betPayout(100, 5, true, true)).toBe(400);
    expect(betPayout(100, 5, false, true)).toBe(50);
    expect(betPayout(100, 5, false, false)).toBe(0);
  });
});

describe("赔率", () => {
  it("常胜马赔率低，新马是黑马", () => {
    const champ = emptyPublicRecord();
    for (let i = 0; i < 6; i++) recordRace(champ, 1);
    const loser = emptyPublicRecord();
    for (let i = 0; i < 6; i++) recordRace(loser, 8);
    const odds = raceOdds([
      { record: champ, key: "a" },
      { record: loser, key: "b" },
      { record: emptyPublicRecord(), key: "c" },
    ]);
    expect(odds[0]).toBeLessThan(odds[1]!);
    expect(odds[2]).toBeGreaterThanOrEqual(12);
    for (const o of odds) {
      expect(o).toBeGreaterThanOrEqual(MIN_ODDS);
      expect(o).toBeLessThanOrEqual(MAX_ODDS);
    }
  });

  it("新马的赔率同一天不变", () => {
    const e = [{ record: emptyPublicRecord(), key: "x:1" }];
    expect(raceOdds(e)).toEqual(raceOdds(e));
  });

  it("相扑看体重，重的赔率低", () => {
    const [heavy, light] = sumoOdds({ record: emptyPublicRecord(), mass: 900 }, { record: emptyPublicRecord(), mass: 500 });
    expect(heavy).toBeLessThan(light);
  });
});
