import { describe, expect, it } from "vitest";
import { breed, decodeGenome, encodeGenome, express, makeGenome, randomGenome, type Genome } from "../src/genome/genome";
import { LOCUS_IDS } from "../src/genome/loci";
import { chimeraSlots, displayStats, metabolicBudget } from "../src/genome/traits";
import { createRng, hashSeed } from "../src/sim/rng";

const inRange = (g: Genome): boolean => LOCUS_IDS.every((id) => g[id].every((a) => Number.isInteger(a) && a >= -2 && a <= 2));

describe("基因组", () => {
  it("表现值是两条链的平均", () => {
    const g = makeGenome({ size: [2, -1], legF: [1, 1] });
    const p = express(g);
    expect(p.size).toBe(0.5);
    expect(p.legF).toBe(1);
    expect(p.neck).toBe(0);
  });

  it("makeGenome 把越界的等位基因夹回 −2..+2", () => {
    const g = makeGenome({ size: [9, -9], power: [1.4, -0.6] });
    expect(g.size).toEqual([2, -2]);
    expect(g.power).toEqual([1, -1]);
  });

  it("随机野马的所有位点都在合法范围内", () => {
    const rng = createRng(42);
    for (let i = 0; i < 500; i++) expect(inRange(randomGenome(rng))).toBe(true);
  });

  it("繁殖：每条链来自父母之一，突变最多偏一格", () => {
    const rng = createRng(7);
    const dam = randomGenome(rng);
    const sire = randomGenome(rng);
    for (let i = 0; i < 300; i++) {
      const { genome, mutations } = breed(dam, sire, rng, 0.05);
      expect(inRange(genome)).toBe(true);
      for (const id of LOCUS_IDS) {
        const [a, b] = genome[id];
        const near = (x: number, pool: readonly number[]): boolean => pool.some((v) => Math.abs(v - x) <= (mutations.includes(id) ? 1 : 0));
        expect(near(a, dam[id])).toBe(true);
        expect(near(b, sire[id])).toBe(true);
      }
    }
  });

  it("突变率为 0 时不会突变，同样的种子繁殖结果一样", () => {
    const dam = randomGenome(createRng(1));
    const sire = randomGenome(createRng(2));
    const a = breed(dam, sire, createRng(99), 0);
    const b = breed(dam, sire, createRng(99), 0);
    expect(a.mutations).toEqual([]);
    expect(a.genome).toEqual(b.genome);
  });
});

describe("马码", () => {
  it("编码再解码得到同一匹马", () => {
    const rng = createRng(hashSeed("马码"));
    for (let i = 0; i < 300; i++) {
      const g = randomGenome(rng, 0.4);
      const code = encodeGenome(g);
      expect(code).toMatch(/^TM2-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]$/);
      expect(decodeGenome(code)).toEqual(g);
    }
  });

  it("容忍小写和多余空格", () => {
    const g = randomGenome(createRng(5));
    expect(decodeGenome(`  ${encodeGenome(g).toLowerCase()} `)).toEqual(g);
  });

  it("抄错一个字符会被校验位发现", () => {
    const g = randomGenome(createRng(11));
    const code = encodeGenome(g);
    const i = code.indexOf("-") + 1;
    const swapped = code.slice(0, i) + (code[i] === "A" ? "B" : "A") + code.slice(i + 1);
    expect(decodeGenome(swapped)).toBeNull();
    expect(decodeGenome("TM2-ABCD")).toBeNull();
    expect(decodeGenome("胡说八道")).toBeNull();
  });
});

describe("代谢预算和嵌合槽", () => {
  it("体型、肌力、步频越高越吃预算，体质抬高上限", () => {
    const lean = express(makeGenome({ size: [-2, -2], power: [-2, -2], stride: [-2, -2] }));
    const greedy = express(makeGenome({ size: [2, 2], power: [2, 2], stride: [2, 2] }));
    expect(metabolicBudget(lean).used).toBeLessThan(metabolicBudget(greedy).used);
    expect(metabolicBudget(greedy).over).toBeGreaterThan(0);
    expect(metabolicBudget(express(makeGenome({ con: [2, 2] }))).cap).toBeGreaterThan(metabolicBudget(express(makeGenome({}))).cap);
  });

  it("嵌合槽 0–4 个，由相容度决定", () => {
    expect(chimeraSlots(express(makeGenome({ compat: [-2, -2] })))).toBe(0);
    expect(chimeraSlots(express(makeGenome({})))).toBe(2);
    expect(chimeraSlots(express(makeGenome({ compat: [2, 2] })))).toBe(4);
  });

  it("面板属性都在 0–100 之间", () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const s = displayStats(express(randomGenome(rng, 0.5)));
      for (const v of Object.values(s)) expect(v >= 0 && v <= 100).toBe(true);
    }
  });
});
