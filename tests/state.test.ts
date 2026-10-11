import { describe, expect, it } from "vitest";
import { breedFoal, catchWild, deserialize, importHorse, newGame, releaseHorse, serialize, STABLE_LIMIT, wildField } from "../src/game/state";
import { encodeGenome } from "../src/genome/genome";

describe("存档和马厩", () => {
  it("新档有四匹马：流星、磐石和两匹野马", () => {
    const g = newGame();
    expect(g.horses.map((h) => h.name).slice(0, 2)).toEqual(["流星", "磐石"]);
    expect(g.horses).toHaveLength(4);
    expect(g.horses.every((h) => !h.sequenced)).toBe(true);
  });

  it("存档序列化再读回来不丢东西", () => {
    const g = newGame();
    g.horses[0]!.sequenced = true;
    g.horses[0]!.record.bestTrial = 88.8;
    const back = deserialize(serialize(g));
    expect(back).not.toBeNull();
    expect(back!.horses.map((h) => encodeGenome(h.genome))).toEqual(g.horses.map((h) => encodeGenome(h.genome)));
    expect(back!.horses[0]!.sequenced).toBe(true);
    expect(back!.horses[0]!.record.bestTrial).toBe(88.8);
    expect(deserialize("{坏掉的存档")).toBeNull();
  });

  it("繁殖出的小马记录父母和代数", () => {
    const g = newGame();
    const foal = breedFoal(g, g.horses[0]!.id, g.horses[1]!.id)!;
    expect(foal.parents).toEqual(["流星", "磐石"]);
    expect(foal.generation).toBe(1);
    expect(g.horses).toContain(foal);
    expect(breedFoal(g, foal.id, foal.id)).toBeNull();
  });

  it("马厩有上限，导入马码要校验", () => {
    const g = newGame();
    expect(importHorse(g, "TM2-XXXX")).toBe("invalid");
    const code = encodeGenome(g.horses[0]!.genome);
    const imported = importHorse(g, code);
    expect(typeof imported).toBe("object");
    while (g.horses.length < STABLE_LIMIT) catchWild(g);
    expect(catchWild(g)).toBeNull();
    expect(importHorse(g, code)).toBe("full");
  });

  it("放生最后一匹马会被拒绝", () => {
    const g = newGame();
    while (g.horses.length > 1) expect(releaseHorse(g, g.horses[0]!.id)).toBe(true);
    expect(releaseHorse(g, g.horses[0]!.id)).toBe(false);
    expect(g.selectedId).toBe(g.horses[0]!.id);
  });

  it("同一个比赛种子，野马对手相同", () => {
    expect(wildField(5).map((h) => encodeGenome(h.genome))).toEqual(wildField(5).map((h) => encodeGenome(h.genome)));
    expect(wildField(5)).toHaveLength(7);
  });
});
