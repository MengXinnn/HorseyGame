import { describe, expect, it } from "vitest";
import {
  addCaught,
  applyOutcome,
  deserialize,
  importHorse,
  isFoal,
  mate,
  newGame,
  placeBet,
  register,
  sellHorse,
  sendToSequencing,
  serialize,
  sleep,
  STABLE_LIMIT,
  todaysField,
  todaysOdds,
  wildHerd,
  type GameState,
} from "../src/game/state";
import { encodeGenome, randomGenome } from "../src/genome/genome";
import { BOSS_PRIZE, DAY_START, debtDue, ENTRY_FEE, eventFor, RACE_PRIZES, SEQUENCING_FEE, START_MONEY } from "../src/game/season";
import { laozhaoLines } from "../src/game/laozhao";
import { createRng } from "../src/sim/rng";

const ids = (g: GameState): [string, string] => [g.horses[0]!.id, g.horses[1]!.id];

describe("存档", () => {
  it("新档：流星和磐石，三百块，第一天清晨", () => {
    const g = newGame();
    expect(g.horses.map((h) => h.name)).toEqual(["流星", "磐石"]);
    expect(g.money).toBe(START_MONEY);
    expect(g.day).toBe(1);
    expect(g.clock).toBe(DAY_START);
    expect(g.rivals.some((r) => r.name === "铁墩")).toBe(true);
  });

  it("序列化再读回来不丢东西", () => {
    const g = newGame();
    g.horses[0]!.sequenced = true;
    g.horses[0]!.record.bestTrial = 88.8;
    g.money = 1234;
    g.flags.intro = true;
    const back = deserialize(serialize(g));
    expect(back).not.toBeNull();
    expect(back!.horses.map((h) => encodeGenome(h.genome))).toEqual(g.horses.map((h) => encodeGenome(h.genome)));
    expect(back!.rivals.map((r) => encodeGenome(r.genome))).toEqual(g.rivals.map((r) => encodeGenome(r.genome)));
    expect(back!.horses[0]!.sequenced).toBe(true);
    expect(back!.money).toBe(1234);
    expect(back!.flags.intro).toBe(true);
  });

  it("坏存档返回 null", () => {
    expect(deserialize("{")).toBeNull();
    expect(deserialize(JSON.stringify({ version: 1, horses: [] }))).toBeNull();
  });
});

describe("马厩", () => {
  it("配种当晚怀上，第二天早上出生，两天后长大", () => {
    const g = newGame();
    const [a, b] = ids(g);
    expect(mate(g, a, b)).toEqual({ ok: true });
    expect(mate(g, a, b).ok).toBe(false);
    const night = sleep(g);
    expect(night.foals).toHaveLength(1);
    const foal = night.foals[0]!;
    expect(foal.parents).toEqual(["流星", "磐石"]);
    expect(foal.generation).toBe(1);
    expect(isFoal(foal, g.day)).toBe(true);
    expect(register(g, foal.id).ok).toBe(false);
    sleep(g);
    const grown = sleep(g);
    expect(grown.grownUp.map((h) => h.id)).toEqual([foal.id]);
    expect(isFoal(foal, g.day)).toBe(false);
  });

  it("测序交钱，第二天早上出结果", () => {
    const g = newGame();
    const id = g.horses[0]!.id;
    expect(sendToSequencing(g, id).ok).toBe(true);
    expect(g.money).toBe(START_MONEY - SEQUENCING_FEE);
    expect(g.horses[0]!.sequenced).toBe(false);
    expect(sendToSequencing(g, id).ok).toBe(false);
    const night = sleep(g);
    expect(night.sequenced.map((h) => h.id)).toEqual([id]);
    expect(g.horses[0]!.sequenced).toBe(true);
  });

  it("马厩有上限，怀着的小马也算", () => {
    const g = newGame();
    const rng = createRng(3);
    while (g.horses.length < STABLE_LIMIT - 1) addCaught(g, "野马", randomGenome(rng));
    const [a, b] = ids(g);
    expect(mate(g, a, b).ok).toBe(true);
    expect(importHorse(g, encodeGenome(randomGenome(rng)))).toBe("full");
  });

  it("卖马拿钱，最后一匹不能卖", () => {
    const g = newGame();
    const before = g.money;
    expect(sellHorse(g, g.horses[1]!.id).ok).toBe(true);
    expect(g.money).toBeGreaterThan(before);
    expect(sellHorse(g, g.horses[0]!.id).ok).toBe(false);
  });

  it("套到的马名字不和镇上的马重名", () => {
    const g = newGame();
    const h = addCaught(g, "流星", randomGenome(createRng(9)));
    expect(h.name).not.toBe("流星");
  });

  it("野马群由日期决定", () => {
    const g = newGame();
    const a = wildHerd(g, 0, 6).map((w) => encodeGenome(w.genome));
    expect(wildHerd(g, 0, 6).map((w) => encodeGenome(w.genome))).toEqual(a);
    g.day = 2;
    expect(wildHerd(g, 0, 6).map((w) => encodeGenome(w.genome))).not.toEqual(a);
  });
});

describe("赛事和下注", () => {
  it("单日平地赛 8 匹，双日相扑 2 匹，第七天擂台对铁墩", () => {
    const g = newGame();
    expect(eventFor(1)).toBe("race");
    expect(todaysField(g)).toHaveLength(8);
    register(g, g.horses[0]!.id);
    const field = todaysField(g);
    expect(field).toHaveLength(8);
    expect(field[0]!.mine).toBe(true);

    g.day = 2;
    g.entry = null;
    expect(todaysField(g)).toHaveLength(2);
    g.day = 7;
    const boss = todaysField(g);
    expect(boss).toHaveLength(2);
    expect(boss.some((f) => f.name === "铁墩")).toBe(true);
  });

  it("没比过赛的新马是黑马，赔率高", () => {
    const g = newGame();
    register(g, g.horses[0]!.id);
    const odds = todaysOdds(g);
    expect(odds[0]).toBeGreaterThanOrEqual(12);
    expect(odds.length).toBe(todaysField(g).length);
  });

  it("报名交费，平地赛拿名次奖金和名望", () => {
    const g = newGame();
    const mine = g.horses[0]!.id;
    expect(register(g, mine).ok).toBe(true);
    expect(g.money).toBe(START_MONEY - ENTRY_FEE);
    const order = todaysField(g).map((f) => f.id);
    const out = applyOutcome(g, "race", order);
    expect(out.myRank).toBe(1);
    expect(out.prize).toBe(RACE_PRIZES[0]);
    expect(g.reputation).toBe(1);
    expect(g.horses[0]!.pub.wins).toBe(1);
    expect(g.entry).toBeNull();
  });

  it("押中拿赔率，保险输了退一半", () => {
    const g = newGame();
    const field = todaysField(g);
    const target = field[2]!.id;
    expect(placeBet(g, target, 100, false).ok).toBe(true);
    const odds = g.bet!.odds;
    const after = g.money;
    applyOutcome(g, "race", [target, ...field.filter((f) => f.id !== target).map((f) => f.id)]);
    expect(g.money).toBe(after + Math.round(100 * odds));

    const h = newGame();
    const f2 = todaysField(h);
    placeBet(h, f2[0]!.id, 100, true);
    const m = h.money;
    applyOutcome(h, "race", f2.map((f) => f.id).reverse());
    expect(h.money).toBe(m + 50);
  });

  it("下注不能超过名望上限，下了注就不能再报名", () => {
    const g = newGame();
    const field = todaysField(g);
    expect(placeBet(g, field[0]!.id, 150, false).ok).toBe(false);
    expect(placeBet(g, field[0]!.id, 100, false).ok).toBe(true);
    expect(register(g, g.horses[0]!.id).ok).toBe(false);
  });

  it("赢了擂台拿一千，记住打败过铁墩", () => {
    const g = newGame();
    g.day = 7;
    g.money = 5000;
    const mine = g.horses[1]!.id;
    register(g, mine);
    const [a, b] = todaysField(g);
    const out = applyOutcome(g, "boss", [a!.id, b!.id]);
    expect(out.prize).toBe(BOSS_PRIZE);
    expect(g.flags["beat:tiedun"]).toBe(true);
  });

  it("相扑平局没有奖金", () => {
    const g = newGame();
    g.day = 2;
    register(g, g.horses[1]!.id);
    const out = applyOutcome(g, "sumo", null);
    expect(out.prize).toBe(0);
    expect(out.myRank).toBeNull();
  });
});

describe("夜晚结算和还债", () => {
  it("每晚扣饲料钱，进入第二天清晨，套索补满", () => {
    const g = newGame();
    g.lassos = 0;
    g.clock = 1300;
    const night = sleep(g);
    expect(night.ledger.every((l) => l.amount < 0)).toBe(true);
    expect(g.money).toBeLessThan(START_MONEY);
    expect(g.day).toBe(2);
    expect(g.clock).toBe(DAY_START);
    expect(g.lassos).toBe(3);
  });

  it("第七天夜里还第一笔债，钱够就还上", () => {
    const g = newGame();
    g.day = 7;
    g.money = 5000;
    const night = sleep(g);
    expect(night.debtPaid).toBe(debtDue(7));
    expect(night.ruined).toBe(false);
    expect(g.over).toBe(false);
    expect(g.money).toBeLessThan(5000 - debtDue(7) + 1);
  });

  it("钱不够，牧场被收走", () => {
    const g = newGame();
    g.day = 7;
    g.money = 500;
    const night = sleep(g);
    expect(night.ruined).toBe(true);
    expect(g.over).toBe(true);
  });

  it("当天没比的报名和赌注过夜作废", () => {
    const g = newGame();
    register(g, g.horses[0]!.id);
    sleep(g);
    expect(g.entry).toBeNull();
  });
});

describe("老赵", () => {
  it("第一次见面自我介绍，之后说经验之谈，擂台日下战书", () => {
    const g = newGame();
    const first = laozhaoLines(g);
    expect(first.length).toBeGreaterThan(1);
    expect(laozhaoLines(g)).toHaveLength(1);
    g.day = 7;
    expect(laozhaoLines(g).join("")).toContain("擂台");
    g.flags["beat:tiedun"] = true;
    expect(laozhaoLines(g).join("")).toContain("铁墩");
  });
});
