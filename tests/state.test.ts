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
  genesUnlocked,
  SEQ_OPEN_DAY,
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
import { BOSS_PRIZE, DAY_START, debtDue, ENTRY_FEE, eventFor, feedCost, RACE_PRIZES, SEQUENCING_FEE, START_MONEY } from "../src/game/season";
import { express } from "../src/genome/genome";
import { createRng } from "../src/sim/rng";
import { answerOffer, offerPending, storyEvent } from "../src/game/story";

const ids = (g: GameState): [string, string] => [g.horses[0]!.id, g.horses[1]!.id];

/** v2没有剧情、宽限、结局或已还款计数，只有每周强制结算后的日期。 */
function v2Save(day: number, over = false): string {
  const raw = JSON.parse(serialize(newGame()));
  raw.version = 2;
  raw.day = day;
  raw.money = 1000;
  raw.over = over;
  for (const key of ["archive", "story", "grace", "graceUsed", "debtsPaid", "cupWon", "ending", "performance"]) delete raw[key];
  for (const horse of raw.horses) {
    delete horse.rest.parentIds;
    delete horse.rest.wingGenes;
  }
  return JSON.stringify(raw);
}

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

  it.each([29, 30, 31])("v2第%d天已付第四笔，迁移和再次读档后只扣草料", (day) => {
    let g = deserialize(v2Save(day))!;
    expect(g.debtsPaid).toBe(4);
    expect(g.money).toBe(1000);
    while (g.day <= 32) {
      g = deserialize(serialize(g))!;
      const money = g.money;
      const feed = g.horses.reduce((sum, h) => {
        const p = express(h.genome);
        return sum + feedCost(p.size, p.power, isFoal(h, g.day));
      }, 0);
      const report = sleep(g);
      expect(report.debtPaid).toBe(0);
      expect(report.grace).toBeNull();
      expect(report.ruined).toBe(false);
      expect(report.ledger.some(line => line.label.startsWith("还债"))).toBe(false);
      expect(g.money).toBe(money - feed);
      expect(g.debtsPaid).toBe(4);
      expect(g.over).toBe(false);
      expect(g.ending).toBe(report.day < 31 ? null : "kept");
      expect(report.ending).toBe(report.day === 31 ? "kept" : null);
    }
    expect(g.ending).toBe("kept");
  });

  it.each([[29, 1], [30, 1], [29, 8], [30, 8]])("v2第%d天已还清旧档继续收购剧情与杯赛，第%d名在31日晚判定结局", (day, rank) => {
    let g = deserialize(v2Save(day))!;
    if (day === 29) {
      expect(storyEvent(g, { t: "interact", id: "race" }).lines.length).toBeGreaterThan(0);
      expect(sleep(g).ending).toBeNull();
    }
    expect(g.day).toBe(30);
    expect(g.ending).toBeNull();
    expect(storyEvent(g, { t: "morning" }).lines.length).toBeGreaterThan(0);
    expect(offerPending(g)).toBe(true);
    expect(answerOffer(g, false).length).toBeGreaterThan(0);
    expect(sleep(g).ending).toBeNull();

    // 午夜前后刷新也不能提前进入结局或丢掉最终比赛分支。
    g = deserialize(serialize(g))!;
    expect(g.day).toBe(31);
    expect(g.ending).toBeNull();
    expect(storyEvent(g, { t: "morning" }).lines.length).toBeGreaterThan(0);
    expect(register(g, g.horses[0]!.id).ok).toBe(true);
    const field = todaysField(g);
    const order = rank === 1 ? field.map(h => h.id) : field.slice(1).map(h => h.id).concat(field[0]!.id);
    const outcome = applyOutcome(g, "cup", order);
    expect(outcome.myRank).toBe(rank);
    expect(storyEvent(g, { t: "outcome", kind: "cup", rank }).lines.length).toBeGreaterThan(0);
    expect(g.ending).toBeNull();
    const report = sleep(g);
    expect(report.day).toBe(31);
    expect(report.debtPaid).toBe(0);
    expect(report.ending).toBe(rank === 1 ? "tianma" : "kept");
    expect(report.ruined).toBe(false);
    expect(g.debtsPaid).toBe(4);
    expect(g.over).toBe(false);
  });

  it("v2第28天尚未付第四笔，迁移后在31日付一次三万元", () => {
    const g = deserialize(v2Save(28))!;
    expect(g.debtsPaid).toBe(3);
    g.money = 100_000;
    for (const day of [28, 29, 30, 31]) {
      const report = sleep(g);
      expect(report.day).toBe(day);
      expect(report.debtPaid).toBe(day === 31 ? 30000 : 0);
      expect(g.debtsPaid).toBe(day === 31 ? 4 : 3);
    }
    expect(sleep(g).debtPaid).toBe(0);
  });

  it.each([[7, 0], [8, 1], [14, 1], [15, 2], [21, 2], [22, 3]])("v2第%d天只继承此前已经完成的还款", (day, paid) => {
    expect(deserialize(v2Save(day))?.debtsPaid).toBe(paid);
  });

  it("v2第28日晚失败的存档保留失败，不把未付第四笔记为已付", () => {
    const g = deserialize(v2Save(29, true))!;
    expect(g.over).toBe(true);
    expect(g.debtsPaid).toBe(3);
  });

  it("新版31日待还款和显式保存的已还款进度不被旧规则覆盖", () => {
    const g = newGame();g.day = 31;g.debtsPaid = 3;g.money = 100_000;
    const raw = JSON.parse(serialize(g));
    for (const version of [3, 4]) {
      raw.version = version;
      const restored = deserialize(JSON.stringify(raw))!;
      expect(restored.debtsPaid).toBe(3);
      expect(sleep(restored).debtPaid).toBe(30000);
    }
  });

  it("即使已还清存档尚无结局，31日也不能再收第四笔", () => {
    const g = newGame();g.day = 31;g.debtsPaid = 4;g.money = 1000;g.cupWon = true;
    const report = sleep(g);
    expect(report.debtPaid).toBe(0);
    expect(report.ruined).toBe(false);
    expect(report.ending).toBe("tianma");
    expect(g.debtsPaid).toBe(4);
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

  it("测序所第十天开门；测序交钱，第二天早上出结果，基因栏跟着解锁", () => {
    const g = newGame();
    const id = g.horses[0]!.id;
    expect(sendToSequencing(g, id).ok).toBe(false);
    expect(genesUnlocked(g)).toBe(false);
    g.day = SEQ_OPEN_DAY;
    expect(sendToSequencing(g, id).ok).toBe(true);
    expect(g.money).toBe(START_MONEY - SEQUENCING_FEE / 2);
    expect(g.horses[0]!.sequenced).toBe(false);
    expect(sendToSequencing(g, id).ok).toBe(false);
    const night = sleep(g);
    expect(night.sequenced.map((h) => h.id)).toEqual([id]);
    expect(g.horses[0]!.sequenced).toBe(true);
    expect(genesUnlocked(g)).toBe(true);
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

  it("钱不够，马董宽限三天多收两成；宽限到了还不上，牧场被收走", () => {
    const g = newGame();
    g.day = 7;
    g.money = 500;
    const night = sleep(g);
    expect(night.ruined).toBe(false);
    expect(night.grace).toEqual({ amount: 2400, dueDay: 10 });
    g.money = 0;
    sleep(g);
    sleep(g);
    const due = sleep(g);
    expect(due.day).toBe(10);
    expect(due.ruined).toBe(true);
    expect(g.over).toBe(true);
    expect(g.ending).toBe("mascot");
  });

  it("宽限期里还上了就接着过；宽限只给一次", () => {
    const g = newGame();
    g.day = 7;
    g.money = 500;
    sleep(g);
    g.money = 5000;
    sleep(g);
    sleep(g);
    const paid = sleep(g);
    expect(paid.debtPaid).toBe(2400);
    expect(g.grace).toBeNull();
    expect(g.debtsPaid).toBe(1);
    g.day = 14;
    g.money = 0;
    const second = sleep(g);
    expect(second.grace).toBeNull();
    expect(second.ruined).toBe(true);
  });

  it("四笔都还清定结局：拿了天马杯是天马行空，没拿是守住了", () => {
    const g = newGame();
    g.debtsPaid = 3;
    g.day = 31;
    g.money = 100_000;
    expect(sleep(g).ending).toBe("kept");
    const h = newGame();
    h.debtsPaid = 3;
    h.cupWon = true;
    h.day = 31;
    h.money = 100_000;
    expect(sleep(h).ending).toBe("tianma");
    expect(h.over).toBe(false);
  });

  it("当天没比的报名和赌注过夜作废", () => {
    const g = newGame();
    register(g, g.horses[0]!.id);
    sleep(g);
    expect(g.entry).toBeNull();
  });
});
