import { describe, expect, it } from "vitest";
import { bodyPlanFrom } from "../src/body/bodyPlan";
import { express, makeGenome, randomGenome } from "../src/genome/genome";
import { LOCUS_IDS } from "../src/genome/loci";
import { createRng } from "../src/sim/rng";

describe("基因 → 身体", () => {
  it("极端基因组也给出有限、为正、物理引擎能承受的身体", () => {
    const extremes = [-2, 2].flatMap((a) => [makeGenome(Object.fromEntries(LOCUS_IDS.map((id) => [id, [a, a]])))]);
    const rng = createRng(17);
    const many = [...extremes, ...Array.from({ length: 300 }, () => randomGenome(rng, 0.6))];
    for (const g of many) {
      const plan = bodyPlanFrom(express(g));
      for (const [k, v] of Object.entries(plan)) {
        if (k === "wings") expect(typeof v).toBe("boolean");
        else expect(Number.isFinite(v), k).toBe(true);
      }
      for (const k of ["torsoLength", "torsoHeight", "torsoMass", "legFront", "legRear", "legWidth", "legMass", "hoofRadius", "neckLength", "headMass", "hipTorque", "gaitHz", "topSpeed", "acceleration", "stamina"] as const) {
        expect(plan[k], k).toBeGreaterThan(0);
      }
      // 相邻刚体质量比不超过 10:1，Box2D 才稳定。
      expect(plan.torsoMass / plan.legMass).toBeLessThanOrEqual(10.0001);
      expect(plan.torsoMass / plan.headMass).toBeLessThanOrEqual(10.0001);
      expect(plan.stumblePerSecond).toBeGreaterThanOrEqual(0);
      expect(plan.stallPerSecond).toBeGreaterThanOrEqual(0);
    }
  });

  it("基因的方向在身体上看得出来", () => {
    const base = bodyPlanFrom(express(makeGenome({})));
    expect(bodyPlanFrom(express(makeGenome({ legF: [2, 2] }))).legFront).toBeGreaterThan(base.legFront);
    expect(bodyPlanFrom(express(makeGenome({ size: [2, 2] }))).totalMass).toBeGreaterThan(base.totalMass);
    expect(bodyPlanFrom(express(makeGenome({ courage: [2, 2] }))).stallPerSecond).toBeLessThan(base.stallPerSecond);
    expect(bodyPlanFrom(express(makeGenome({ girth: [2, 2] }))).balance).toBeGreaterThan(base.balance);
    // 腿长、头重、脚轻的马更容易绊倒。
    const tippy = bodyPlanFrom(express(makeGenome({ legF: [2, 2], legR: [2, 2], girth: [-2, -2], head: [2, 2] })));
    expect(tippy.stumblePerSecond).toBeGreaterThan(base.stumblePerSecond);
  });
});
