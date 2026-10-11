import { Edge, Vec2, World } from "planck";
import { describe, expect, it } from "vitest";
import { bodyPlanFrom } from "../src/body/bodyPlan";
import { express, makeGenome, randomGenome, type Genome } from "../src/genome/genome";
import { CATEGORY_GROUND, HorseSim } from "../src/sim/horse";
import { STEP } from "../src/sim/race";
import { createRng } from "../src/sim/rng";
import { SumoBout } from "../src/sim/sumo";

const E = (genome: Genome, id: string) => ({ id, name: id, genome });
const heavy = makeGenome({ size: [2, 2], girth: [2, 2], legF: [-1, -1], legR: [-1, -1], power: [2, 1], hoof: [2, 2] });
const leggy = makeGenome({ legF: [2, 2], legR: [2, 2], girth: [-2, -2], size: [-1, -1] });

/** 一匹马单独在平地上跑：先站稳 1 秒，再跑 seconds 秒，返回沿朝向前进的距离。 */
function soloRun(genome: Genome, facing: 1 | -1, seed: number, seconds: number): number {
  const world = new World({ gravity: new Vec2(0, -9.8) });
  const ground = world.createBody({ type: "static" });
  ground.createFixture(new Edge(new Vec2(-500, 0), new Vec2(500, 0)), { friction: 1, filterCategoryBits: CATEGORY_GROUND, filterMaskBits: 0xffff });
  const horse = new HorseSim(world, bodyPlanFrom(express(genome)), 0, 1, createRng(seed), { facing });
  const steps = Math.round((1 + seconds) / STEP);
  for (let i = 0; i < steps; i++) {
    horse.active = i >= Math.round(1 / STEP);
    horse.step(STEP);
    world.step(STEP, 8, 3);
  }
  return horse.progress;
}

describe("朝向镜像", () => {
  it("朝左的马是朝右的马的镜像：同一种子 5 秒跑的距离差不到 3%", () => {
    for (const [i, g] of [makeGenome({}), makeGenome({ legF: [1, 0], neck: [1, 1] })].entries()) {
      const right = soloRun(g, 1, 7 + i, 5);
      const left = soloRun(g, -1, 7 + i, 5);
      expect(right).toBeGreaterThan(10);
      expect(Math.abs(left - right) / right, `第 ${i} 匹`).toBeLessThan(0.03);
    }
  });

  it("朝左的马姿态里带着朝向，速度沿朝向为正", () => {
    const world = new World({ gravity: new Vec2(0, -9.8) });
    const ground = world.createBody({ type: "static" });
    ground.createFixture(new Edge(new Vec2(-100, 0), new Vec2(100, 0)), { friction: 1, filterCategoryBits: CATEGORY_GROUND, filterMaskBits: 0xffff });
    const horse = new HorseSim(world, bodyPlanFrom(express(makeGenome({}))), 0, 1, createRng(1), { facing: -1 });
    horse.active = true;
    for (let i = 0; i < 120; i++) {
      horse.step(STEP);
      world.step(STEP, 8, 3);
    }
    const pose = horse.pose();
    expect(pose.facing).toBe(-1);
    expect(horse.x).toBeLessThan(-1);
    expect(pose.speed).toBeGreaterThan(0);
    expect(pose.neck.x).toBeLessThan(pose.torso.x);
  });
});

describe("相扑", () => {
  it("同样的种子和马匹，胜负和姿态逐位相同", () => {
    const run = () => {
      const bout = new SumoBout(E(heavy, "a"), E(makeGenome({}), "b"), { seed: 42 });
      bout.runToEnd();
      return { winner: bout.winner, reason: bout.reason, time: bout.boutTime, poses: bout.poses() };
    };
    expect(run()).toEqual(run());
  });

  it("又矮又壮的重马顶得过细长腿的轻马（5 个种子里至少赢 4 场，左右换边都一样）", () => {
    let wins = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const left = new SumoBout(E(heavy, "heavy"), E(leggy, "leggy"), { seed });
      left.runToEnd();
      if (left.winner === 0) wins++;
      const right = new SumoBout(E(leggy, "leggy"), E(heavy, "heavy"), { seed: seed + 100 });
      right.runToEnd();
      if (right.winner === 1) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(8);
  });

  it("两匹一模一样的马，换种子胜负会变", () => {
    const g = makeGenome({});
    const winners = new Set<number | null>();
    for (let seed = 1; seed <= 8; seed++) {
      const bout = new SumoBout(E(g, "a"), E(g, "b"), { seed });
      bout.runToEnd();
      winners.add(bout.winner);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it("每场都在时限内结束，胜者和判定合法", () => {
    const rng = createRng(11);
    for (let i = 0; i < 20; i++) {
      const bout = new SumoBout(E(randomGenome(rng), "a"), E(randomGenome(rng), "b"), { seed: i, timeLimit: 30 });
      bout.runToEnd();
      expect(bout.finished).toBe(true);
      expect(bout.boutTime).toBeLessThanOrEqual(30 + STEP);
      expect(["ringout", "flip", "time", "draw"]).toContain(bout.reason);
      if (bout.reason === "draw") expect(bout.winner).toBeNull();
      else expect([0, 1]).toContain(bout.winner);
      if (bout.reason === "ringout") expect(Math.abs(bout.horses[1 - bout.winner!]!.x)).toBeGreaterThan(bout.ringRadius);
      if (bout.reason === "flip") expect(bout.horses[1 - bout.winner!]!.state).toBe("fallen");
    }
  });

  it("开打前两匹马站着不动，开打后才顶上去", () => {
    const bout = new SumoBout(E(makeGenome({}), "a"), E(makeGenome({}), "b"), { seed: 3, startAt: 2 });
    const x0 = bout.horses.map((h) => h.x);
    while (bout.time < 1.9) bout.step();
    expect(bout.started).toBe(false);
    expect(bout.boutTime).toBe(0);
    bout.horses.forEach((h, i) => expect(Math.abs(h.x - x0[i]!)).toBeLessThan(0.2));
    expect(x0[0]!).toBeLessThan(0);
    expect(x0[1]!).toBeGreaterThan(0);
    while (bout.time < 3) bout.step();
    expect(bout.started).toBe(true);
    expect(bout.horses[0].x).toBeGreaterThan(x0[0]! + 0.3);
    expect(bout.horses[1].x).toBeLessThan(x0[1]! - 0.3);
  });
});

describe("相扑稳定性：150 对随机马不炸", () => {
  it("所有刚体坐标有限，没有飞上天", () => {
    const rng = createRng(2027);
    for (let i = 0; i < 150; i++) {
      const bout = new SumoBout(E(randomGenome(rng), "a"), E(randomGenome(rng), "b"), { seed: i, timeLimit: 20 });
      let ok = true;
      while (!bout.finished && ok) {
        bout.step();
        for (const h of bout.horses)
          for (const b of h.bodies) {
            const p = b.getPosition();
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(b.getAngle()) || Math.abs(p.y) >= 50) ok = false;
          }
      }
      expect(ok, `第 ${i} 对`).toBe(true);
    }
  });
});
