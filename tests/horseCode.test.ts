import { describe, expect, it } from "vitest";
import { decodeHorseCode, encodeHorseCode } from "../src/game/horseCode";
import { importHorse, newGame } from "../src/game/state";
import { encodeGenome, makeGenome } from "../src/genome/genome";

describe("朋友的马码", () => {
  it("兼容旧码，带羽翼的马导入后保留材料等位基因", () => {
    const genome = makeGenome({ compat: [2, 1], courage: [1, 1] });
    const old = encodeGenome(genome);
    expect(decodeHorseCode(old)).toEqual({ genome, wingGenes: [0, 0] });
    const code = encodeHorseCode({ genome, wingGenes: [1, 0] });
    expect(decodeHorseCode(code)).toEqual({ genome, wingGenes: [1, 0] });
    const state = newGame();
    expect(importHorse(state, code)).toMatchObject({ genome, wingGenes: [1, 0] });
    expect(state.horses.at(-1)?.wingGenes).toEqual([1, 0]);
  });
  it("改动羽翼后校验失败，不能导入", () => {
    const code = encodeHorseCode({ genome: makeGenome({}), wingGenes: [1, 0] });
    expect(decodeHorseCode(code.replace("-W10-", "-W11-"))).toBeNull();
    expect(decodeHorseCode("TM3-invalid-W10-0000")).toBeNull();
  });
});
