import { describe, expect, it, vi, afterEach } from "vitest";
import { deserialize, HOME, loadGame, newGame, saveGame, serialize, wildHerd } from "../src/game/state";

afterEach(() => vi.unstubAllGlobals());

describe("世界存档", () => {
  it("启动时清除全部旧版存档，保留世界进度和其他设置", () => {
    const state = newGame();
    state.day = 12;
    const items = new Map([
      ["tianma.save", "old"],
      ["tianma.save.v2", "old"],
      ["tianma.save.v3", "old"],
      ["tianma.save.v4", "old"],
      ["tianma.world.v1", serialize(state)],
      ["tianma:music", "music settings"],
      ["other-app", "unrelated data"],
    ]);
    vi.stubGlobal("localStorage", {
      get length() { return items.size; },
      key: (index: number) => [...items.keys()][index] ?? null,
      getItem: (key: string) => items.get(key) ?? null,
      removeItem: (key: string) => items.delete(key),
    });
    expect(loadGame()).toEqual(state);
    expect([...items.keys()]).toEqual(["tianma.world.v1", "tianma:music", "other-app"]);
    expect(loadGame()).toEqual(state);
  });

  it("保存位置和时间，载入后恢复相同的展示马", () => {
    const state = newGame();
    state.day = 42;
    state.clock = 900;
    state.player = { x: HOME.x + 1, z: HOME.z };
    state.walked = 12.5;
    expect(deserialize(serialize(state))).toEqual(state);
    expect(wildHerd(state)).toEqual(wildHerd(deserialize(serialize(state))!));
  });

  it("只接收当前世界格式，损坏或非法状态不会进入世界", () => {
    expect(deserialize("bad json")).toBeNull();
    expect(deserialize("null")).toBeNull();
    const state = JSON.parse(serialize(newGame()));
    for (const change of [{ version: 4 }, { day: -1 }, { clock: 1440 }, { walked: -1 }, { player: null }]) {
      expect(deserialize(JSON.stringify({ ...state, ...change }))).toBeNull();
    }
    expect(deserialize(JSON.stringify({ ...state, player: { x: -100, z: -100 } }))?.player).toEqual(HOME);
  });

  it("存档只写入世界字段，额外字段不会随载入保留", () => {
    const state = newGame();
    const restored = deserialize(JSON.stringify({ ...JSON.parse(serialize(state)), flags: { locked: true }, over: true }));
    expect(restored).toEqual(state);
    expect(Object.keys(JSON.parse(serialize(state))).sort()).toEqual(["clock", "day", "player", "version", "walked"]);
  });

  it("浏览器存储不可用时仍能启动和保存", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("unavailable"); }, setItem: () => { throw new Error("unavailable"); } });
    expect(loadGame()).toEqual(newGame());
    expect(() => saveGame(newGame())).not.toThrow();
  });
});
