import { describe, expect, it } from "vitest";
import { DAY_START, formatClock, MIDNIGHT, phaseOf, TRAVEL_TILES } from "../src/game/season";
import { advanceTime, newGame, walk } from "../src/game/state";

describe("世界时钟", () => {
  it("移动距离累计推进时间", () => {
    const state = newGame();
    expect(walk(state, TRAVEL_TILES - 1)).toBe(0);
    expect(walk(state, 2)).toBe(15);
    expect(state.clock).toBe(DAY_START + 15);
    expect(state.walked).toBe(1);
  });
  it("到午夜后进入次日，超过31天仍可继续探索", () => {
    const state = newGame();
    state.day = 31;
    state.clock = MIDNIGHT - 5;
    advanceTime(state, 65);
    expect(state.day).toBe(32);
    expect(state.clock).toBe(DAY_START + 60);
    advanceTime(state, (MIDNIGHT - DAY_START) * 10);
    expect(state.day).toBe(42);
    expect(state.clock).toBe(DAY_START + 60);
  });
  it("无效时间与距离不会污染世界状态", () => {
    const state = newGame();
    for (const n of [-1, NaN, Infinity]) { advanceTime(state, n); walk(state, n); }
    expect(state).toEqual(newGame());
  });
  it("格式和日照时段一致", () => {
    expect(formatClock(DAY_START)).toBe("06:00");
    expect(phaseOf(7 * 60)).toBe("dawn");
    expect(phaseOf(12 * 60)).toBe("noon");
    expect(phaseOf(17 * 60)).toBe("dusk");
    expect(phaseOf(21 * 60)).toBe("night");
  });
});
