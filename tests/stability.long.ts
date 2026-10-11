import { describe, expect, it } from "vitest";
import { randomGenome } from "../src/genome/genome";
import { trial } from "../src/sim/race";
import { createRng } from "../src/sim/rng";

/**
 * M0 验收：1000 匹随机马各跑 10 秒，模拟全部稳定（没有 NaN、没有飞出地图）。
 * 跑得比较久，单独用 `npm run sim:stability` 执行，CI 里也会跑。
 */
describe("稳定性：1000 匹随机马", () => {
  it("全部稳定，并且成绩分布铺得开", () => {
    const rng = createRng(20261011);
    const distances: number[] = [];
    let falls = 0;
    for (let i = 0; i < 1000; i++) {
      const r = trial(randomGenome(rng, 0.3), 10, i);
      expect(r.finite, `第 ${i} 匹`).toBe(true);
      expect(r.distance).toBeLessThan(300);
      distances.push(r.distance);
      falls += r.falls;
    }
    distances.sort((a, b) => a - b);
    const pct = (q: number): number => distances[Math.floor(q * (distances.length - 1))]!;
    console.log(
      `1000 匹随机马 10 秒成绩：最慢 ${pct(0).toFixed(1)} 米，P10 ${pct(0.1).toFixed(1)}，中位 ${pct(0.5).toFixed(1)}，P90 ${pct(0.9).toFixed(1)}，最快 ${pct(1).toFixed(1)}；共摔倒 ${falls} 次`,
    );
    expect(pct(0.9)).toBeGreaterThan(pct(0.1) * 1.3);
  });
});
