import { describe, expect, it } from "vitest";
import { eventFor } from "../src/game/season";
import { mate, newGame, RESUME, sendToSequencing, sleep, type GameState } from "../src/game/state";
import {
  activeQuest,
  answerOffer,
  mailContent,
  nightLines,
  offerPending,
  plaque,
  QUESTS,
  readMail,
  storyEvent,
  type StoryEvent,
} from "../src/game/story";

const SPOTS = ["mail", "sleep", "barn", "sequence", "market", "bookie", "sumo", "race", "laozhao"];

/** 把能报的事都报一遍，哪个任务等的是哪件事都能接上。 */
function everything(g: GameState): StoryEvent[] {
  const foal = g.horses.find((h) => h.bornDay > 0);
  const seq = g.horses.find((h) => h.sequenced);
  return [
    ...SPOTS.map((id): StoryEvent => ({ t: "interact", id })),
    { t: "near", id: "barn" },
    { t: "catch" },
    { t: "detail", horseId: g.horses[0]!.id },
    ...(foal ? [{ t: "detail", horseId: foal.id } as StoryEvent] : []),
    ...(seq ? [{ t: "detail", horseId: seq.id } as StoryEvent] : []),
    { t: "mate" },
    { t: "register" },
    { t: "trial" },
    { t: "sequence" },
    { t: "bet" },
    { t: "outcome", kind: eventFor(g.day), rank: 1 },
  ];
}

describe("剧情", () => {
  it("新档从信箱开始，信箱里躺着外婆的信", () => {
    const g = newGame();
    expect(plaque(g)).toMatchObject({ text: "打开信箱", at: "mail", waitDay: null });
    const mails = readMail(g);
    expect(mails[0]!.title).toBe("外婆的信");
    expect(g.story.inbox).toEqual([]);
  });

  it("第一周不提基因：第十天以前的任务和对白里没有「基因」「测序」", () => {
    const g = newGame();
    const words = /基因|测序|说明书/;
    for (const q of QUESTS.filter((x) => x.day < 10)) {
      const lines = [...(q.intro ?? []), ...(q.talk?.lines ?? []), ...(q.outro?.(g, { t: "outcome", kind: "race", rank: 1 }) ?? [])];
      expect(q.text).not.toMatch(words);
      for (const l of lines) expect(l.text, q.id).not.toMatch(words);
    }
    for (let day = 1; day < 10; day++) {
      for (const line of mailContent(`paper:${day}`).lines) expect(line).not.toMatch(words);
    }
  });

  it("马董第一次登门把借据摆出来，讲清楚欠多少、怎么还", () => {
    const g = newGame();
    storyEvent(g, { t: "interact", id: "mail" });
    storyEvent(g, { t: "near", id: "barn" });
    const visit = storyEvent(g, { t: "detail", horseId: g.horses[0]!.id });
    const text = visit.lines.map((l) => l.text).join("");
    expect(visit.lines.some((l) => l.who === "借据")).toBe(true);
    expect(text).toContain("六万");
    expect(text).toContain("两千");
    expect(text).not.toContain("数字不会骗人");
    expect(g.flags["met:madong"]).toBe(true);
    expect(plaque(g)?.text).toBe("去马蹄镇找老赵");
  });

  it("做完当天的任务，木牌显示下一段剧情在第几天", () => {
    const g = newGame();
    for (let i = 0; i < 20 && activeQuest(g); i++) for (const e of everything(g)) storyEvent(g, e);
    storyEvent(g, { t: "sleep" });
    expect(plaque(g)).toMatchObject({ waitDay: 2, at: null });
  });

  it("过了日子的任务自动跳过，日记照给", () => {
    const g = newGame();
    g.story.quest = "q-warmup";
    g.day = 7;
    expect(activeQuest(g)?.id).toBe("q-tiedun");
    expect(g.story.diary).toContain(2);
  });

  it("旧存档从今天能做的第一个任务接着走", () => {
    const g = newGame();
    g.story.quest = RESUME;
    g.day = 9;
    expect(activeQuest(g)).toBeNull();
    expect(plaque(g)?.waitDay).toBe(10);
  });

  it("第八天起每天一份日报，读过不再重送；第六天收到老赵的战书", () => {
    const g = newGame();
    readMail(g);
    g.day = 6;
    storyEvent(g, { t: "morning" });
    expect(g.story.inbox).toEqual(["zhao"]);
    readMail(g);
    g.day = 8;
    storyEvent(g, { t: "morning" });
    expect(g.story.inbox).toEqual(["paper:8"]);
    readMail(g);
    storyEvent(g, { t: "morning" });
    expect(g.story.inbox).toEqual([]);
    expect(mailContent("paper:8").title).toContain("日报");
  });

  it("照着任务走 28 天，主线一路走到天马杯，不会卡住", () => {
    const g = newGame();
    g.money = 1_000_000;
    for (let day = 1; day <= 28; day++) {
      storyEvent(g, { t: "morning" });
      if (day === 3) mate(g, g.horses[0]!.id, g.horses[1]!.id);
      if (day >= 10) {
        const h = g.horses.find((x) => !x.sequenced && !x.sequencing);
        if (h) sendToSequencing(g, h.id);
      }
      for (let i = 0; i < 20 && activeQuest(g); i++) for (const e of everything(g)) storyEvent(g, e);
      storyEvent(g, { t: "sleep" });
      if (day < 28) {
        const r = sleep(g);
        expect(r.ruined, `第${day}天`).toBe(false);
      }
    }
    expect(g.story.quest).toBeNull();
    expect(g.story.diary).toEqual(expect.arrayContaining([1, 2, 3, 5]));
  });

  it("宽限那晚马董说清楚要多少、几天", () => {
    const lines = nightLines({ day: 7, ledger: [], foals: [], sequenced: [], grownUp: [], debtPaid: 0, grace: { amount: 2400, dueDay: 10 }, ruined: false, ending: null });
    const text = lines.map((l) => l.text).join("");
    expect(text).toContain("2400");
    expect(text).toContain("3天");
  });

  it("第二十七天马董出价：签字进吉祥物结局，不签接着比", () => {
    const g = newGame();
    g.day = 27;
    expect(offerPending(g)).toBe(true);
    answerOffer(g, false);
    expect(offerPending(g)).toBe(false);
    expect(g.ending).toBeNull();
    const h = newGame();
    h.day = 27;
    answerOffer(h, true);
    expect(h.ending).toBe("mascot");
    expect(h.over).toBe(true);
  });
});
