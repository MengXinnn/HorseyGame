import { describe, expect, it } from "vitest";
import { makeGenome, randomGenome } from "../src/genome/genome";
import { Race, trial } from "../src/sim/race";
import { createRng } from "../src/sim/rng";

const field = (seed: number, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, (_, i) => ({ id: `h${i}`, name: `马${i}`, genome: randomGenome(rng) }));
};

describe("物理比赛", () => {
  it("同样的种子和马匹，结果逐位相同（回放和幽灵赛的基础）", () => {
    const run = () => {
      const race = new Race(field(5, 4), { distance: 60, seed: 123, timeLimit: 15 });
      const results = race.runToEnd();
      return { results, poses: race.poses() };
    };
    expect(run()).toEqual(run());
  });

  it("换一个种子，比赛过程会变（绊跤、发呆是随机的）", () => {
    const g = makeGenome({ legF: [2, 2], legR: [2, 2], girth: [-2, -2], courage: [-2, -2] });
    const a = trial(g, 15, 1);
    const b = trial(g, 15, 2);
    const c = trial(g, 15, 3);
    expect(new Set([a.distance, b.distance, c.distance]).size).toBeGreaterThan(1);
  });

  it("马在起跑前能稳稳站住", () => {
    const race = new Race(field(9, 6), { distance: 100, seed: 1, timeLimit: 5, startAt: Infinity });
    for (let i = 0; i < 180; i++) race.step();
    for (const r of race.runners) {
      expect(Math.abs(r.horse.x - r.startX)).toBeLessThan(0.5);
      expect(r.horse.state).not.toBe("fallen");
    }
  });

  it("摔倒的马趴在原地不再起来，只剩它一匹时比赛提前结束", () => {
    const rng = createRng(31);
    let endedEarly = 0;
    for (let i = 0; i < 60; i++) {
      const race = new Race([{ id: "a", name: "a", genome: randomGenome(rng, 0.4) }], { distance: 10_000, seed: i, timeLimit: 20 });
      race.runToEnd();
      const h = race.runners[0]!.horse;
      expect(h.falls).toBeLessThanOrEqual(1);
      if (h.falls) expect(h.state).toBe("fallen");
      if (race.raceTime < 20) {
        endedEarly++;
        expect(h.downTime).toBeGreaterThanOrEqual(1.5);
      }
    }
    expect(endedEarly).toBeGreaterThan(0);
  });

  it("跑起来蹄子落在身体下方，马不往前栽", () => {
    const rng = createRng(5);
    for (let i = 0; i < 8; i++) {
      const race = new Race([{ id: "a", name: "a", genome: randomGenome(rng, 0.3) }], { distance: 10_000, seed: 1, timeLimit: 10 });
      const h = race.runners[0]!.horse;
      let slant = 0;
      let n = 0;
      while (!race.finished) {
        race.step();
        if (race.raceTime < 2 || h.state !== "running") continue;
        for (const l of h.pose().legs) slant += Math.atan2(l.foot.x - l.hip.x, l.hip.y - l.foot.y);
        n += 4;
      }
      if (n) expect(slant / n, `第 ${i} 匹`).toBeGreaterThan(-0.05);
    }
  });

  it("比赛名次按完赛时间，没完赛的按距离", () => {
    const race = new Race(field(3, 5), { distance: 40, seed: 8, timeLimit: 12 });
    const res = race.runToEnd();
    expect(res.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < res.length; i++) {
      const prev = res[i - 1]!;
      const cur = res[i]!;
      if (prev.time !== null && cur.time !== null) expect(prev.time).toBeLessThanOrEqual(cur.time);
      if (prev.time === null) expect(cur.time).toBeNull();
      if (prev.time === null && cur.time === null) expect(prev.distance).toBeGreaterThanOrEqual(cur.distance);
    }
  });
});

describe("M0 验收：改一点基因就跑得明显不同", () => {
  it("长腿快马、矮壮马、头重脚轻的马跑出明显不同的成绩", () => {
    const sprinter = trial(makeGenome({ legF: [2, 1], legR: [2, 1], girth: [-1, -1], stride: [2, 1], power: [1, 0] }), 10, 1);
    const sumo = trial(makeGenome({ legF: [-2, -1], legR: [-2, -1], girth: [2, 1], size: [2, 1], power: [2, 1], stride: [-1, -2] }), 10, 1);
    const frontHeavy = trial(makeGenome({ legF: [-2, -2], legR: [2, 2] }), 10, 1);
    expect(sprinter.distance).toBeGreaterThan(sumo.distance * 1.3);
    expect(sumo.distance).toBeGreaterThan(frontHeavy.distance);
    expect(frontHeavy.distance).toBeGreaterThan(5);
  });

  it("只改腿长一个位点，成绩差 25% 以上", () => {
    const short = trial(makeGenome({ legF: [-2, -2], legR: [-2, -2] }), 10, 1);
    const long = trial(makeGenome({ legF: [1, 1], legR: [1, 1] }), 10, 1);
    expect(long.distance).toBeGreaterThan(short.distance * 1.25);
  });

  it("随机野马的成绩铺得开：最快的比最慢的远 60% 以上", () => {
    const rng = createRng(2026);
    const ds = Array.from({ length: 40 }, (_, i) => trial(randomGenome(rng), 10, i).distance).sort((a, b) => a - b);
    expect(ds[ds.length - 1]!).toBeGreaterThan(ds[0]! * 1.6);
    expect(ds[0]!).toBeGreaterThan(5);
  });
});

describe("稳定性：200 匹随机马跑完 10 秒不炸", () => {
  it("所有刚体坐标有限，没有飞出地图", () => {
    const rng = createRng(77);
    for (let i = 0; i < 200; i++) {
      const g = randomGenome(rng, 0.35);
      const r = trial(g, 10, i);
      expect(r.finite, `第 ${i} 匹`).toBe(true);
      expect(r.distance).toBeGreaterThanOrEqual(0);
      expect(r.distance).toBeLessThan(300);
    }
  });
});
