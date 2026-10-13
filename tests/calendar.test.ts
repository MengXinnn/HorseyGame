import { describe, expect, it } from "vitest";
import { bossFor, CUP, prizeFor, sportOf, weatherFor } from "../src/game/calendar";
import { eventFor } from "../src/game/season";
import { newGame, register, todaysField } from "../src/game/state";

describe("赛季日历", () => {
  it("每周第七天擂台：老赵、米娅、K博士；第二十八天接力、第三十一天天马杯", () => {
    expect(bossFor(7)?.owner).toBe("老赵");
    expect(bossFor(14)?.owner).toBe("米娅");
    expect(bossFor(21)?.owner).toBe("K博士");
    expect(eventFor(28)).toBe("relay");
    expect(eventFor(31)).toBe("cup");
    expect(bossFor(28)).toBeNull();
    expect(sportOf(7)).toBe("sumo");
    expect(sportOf(14)).toBe("race");
    expect(sportOf(28)).toBe("race");
  });

  it("奖金随周上涨，天马杯冠军一万五", () => {
    expect(prizeFor(1, 1)).toBeLessThan(prizeFor(15, 1));
    expect(prizeFor(31, 1)).toBe(CUP.prizes[0]);
    expect(prizeFor(7, 2)).toBe(0);
  });

  it("杯赛有八匹，正文中的豆包、阿七、潮生和完璧都在场", () => {
    const g=newGame();g.day=31;register(g,g.horses[0]!.id);
    const field=todaysField(g);
    expect(field).toHaveLength(8);
    expect(field.map(f=>f.name)).toEqual(expect.arrayContaining(["豆包","样本七号","潮生","完璧"]));
  });

  it("第一周天天晴；第十天下雨，第十九天大风，天马杯当天晴", () => {
    for (let d = 1; d <= 7; d++) expect(weatherFor(d)).toBe("clear");
    expect(weatherFor(10)).toBe("rain");
    expect(weatherFor(19)).toBe("wind");
    expect(weatherFor(31)).toBe("clear");
  });
});
