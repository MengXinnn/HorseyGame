import { describe, expect, it } from "vitest";
import { AFTER_EVENT, DAY_START, EVENT_TIME, formatSpan, MIDNIGHT, TIME_COST } from "../src/game/season";
import {
  addCaught,
  importHorse,
  mate,
  newGame,
  placeBet,
  register,
  rest,
  sellHorse,
  sendToSequencing,
  sleep,
  startTrial,
  throwLasso,
  todaysField,
  travel,
  waitForEvent,
  type GameState,
} from "../src/game/state";
import { encodeGenome, randomGenome } from "../src/genome/genome";
import { createRng } from "../src/sim/rng";
import { arrivedRegion, REGIONS } from "../src/world/tiles";

const fresh = (): GameState => {
  const g = newGame();
  g.money = 5000;
  return g;
};
const [a, b] = [0, 1];

describe("时间只在做事的时候走", () => {
  it("每件事花固定的时间", () => {
    const g = fresh();
    const ids = g.horses.map((h) => h.id);
    const steps: Array<[() => unknown, number]> = [
      [() => mate(g, ids[a]!, ids[b]!), TIME_COST.mate],
      [() => sendToSequencing(g, ids[a]!), TIME_COST.sequence],
      [() => startTrial(g, ids[b]!), TIME_COST.trial],
      [() => register(g, ids[b]!), TIME_COST.register],
      [() => placeBet(g, todaysField(g)[0]!.id, 50, false), TIME_COST.bet],
      [() => throwLasso(g), TIME_COST.throwLasso],
      [() => addCaught(g, "新马", randomGenome(createRng(1))), TIME_COST.catch],
      [() => importHorse(g, encodeGenome(randomGenome(createRng(2)))), TIME_COST.import],
      [() => travel(g), TIME_COST.travel],
      [() => rest(g), TIME_COST.rest],
    ];
    for (const [act, minutes] of steps) {
      const before = g.clock;
      act();
      expect(g.clock - before).toBe(minutes);
    }
  });

  it("每件改变局面的事至少花十分钟", () => {
    for (const minutes of Object.values(TIME_COST)) expect(minutes).toBeGreaterThanOrEqual(10);
  });

  it("做不完的事不让做，钱和马都不动", () => {
    const g = fresh();
    const ids = g.horses.map((h) => h.id);
    g.clock = MIDNIGHT - 15;
    const money = g.money;
    expect(mate(g, ids[a]!, ids[b]!).ok).toBe(false);
    expect(g.pregnancies).toHaveLength(0);
    expect(sendToSequencing(g, ids[a]!).ok).toBe(false);
    expect(g.money).toBe(money);
    expect(startTrial(g, ids[a]!).ok).toBe(false);
    expect(throwLasso(g).ok).toBe(false);
    expect(g.lassos).toBe(3);
    expect(rest(g).ok).toBe(false);
    expect(importHorse(g, encodeGenome(randomGenome(createRng(3))))).toBe("late");
    expect(g.clock).toBe(MIDNIGHT - 15);
  });

  it("走路不会被拦下，过了午夜也只到午夜", () => {
    const g = fresh();
    g.clock = MIDNIGHT - 5;
    travel(g);
    expect(g.clock).toBe(MIDNIGHT);
  });

  it("卖马要留出讨价还价的工夫", () => {
    const g = fresh();
    g.clock = MIDNIGHT - TIME_COST.sell + 1;
    expect(sellHorse(g, g.horses[0]!.id).ok).toBe(false);
    expect(g.horses).toHaveLength(2);
  });

  it("等开赛：一下跳到傍晚五点；开过赛就不能再等", () => {
    const g = fresh();
    expect(waitForEvent(g).ok).toBe(true);
    expect(g.clock).toBe(EVENT_TIME);
    expect(waitForEvent(g).ok).toBe(false);
    const h = fresh();
    h.flags[`ev:${h.day}`] = true;
    expect(waitForEvent(h).ok).toBe(false);
  });

  it("五点以后报不了名、下不了注", () => {
    const g = fresh();
    g.clock = AFTER_EVENT;
    expect(register(g, g.horses[0]!.id).ok).toBe(false);
    expect(placeBet(g, todaysField(g)[0]!.id, 50, false).ok).toBe(false);
  });

  it("睡一觉回到第二天清晨", () => {
    const g = fresh();
    rest(g);
    sleep(g);
    expect(g.clock).toBe(DAY_START);
  });

  it("时间的写法", () => {
    expect(formatSpan(15)).toBe("15分");
    expect(formatSpan(60)).toBe("1小时");
    expect(formatSpan(90)).toBe("1小时30分");
  });
});

describe("走到另一片地方才算赶路", () => {
  it("在边上蹭不算到了，走进去两格才算", () => {
    const town = REGIONS.find((r) => r.id === "town")!;
    const z = (town.rect.z0 + town.rect.z1) / 2;
    expect(arrivedRegion(town.rect.x0 + 0.5, z)).toBeUndefined();
    expect(arrivedRegion(town.rect.x0 + 3, z)?.id).toBe("town");
  });
});
