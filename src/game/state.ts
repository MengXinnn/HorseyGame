import { makeGenome, randomGenome, type Genome } from "../genome/genome";
import { createRng, hashSeed } from "../sim/rng";
import { walkable } from "../world/tiles";
import { DAY_START, MIDNIGHT, TRAVEL_MINUTES, TRAVEL_TILES } from "./season";

export const HOME = { x: 17.5, z: 69.6 };
const SAVE_KEY = "tianma.world.v1";

export interface WorldHorse {
  id: string;
  name: string;
  genome: Genome;
}

export interface GameState {
  version: 1;
  day: number;
  clock: number;
  player: { x: number; z: number };
  walked: number;
  horses: WorldHorse[];
}

/** 牧场里的两匹展示马，只参与世界动画。 */
export function newGame(): GameState {
  return {
    version: 1,
    day: 1,
    clock: DAY_START,
    player: { ...HOME },
    walked: 0,
    horses: [
      { id: "ranch-1", name: "流星", genome: makeGenome({ legF: [1, 2], legR: [1, 1], girth: [-1, 0], stride: [1, 0], coat: [1, 1] }) },
      { id: "ranch-2", name: "磐石", genome: makeGenome({ size: [1, 1], girth: [2, 1], legF: [-1, 0], legR: [-1, 0], coat: [-1, -1] }) },
    ],
  };
}

export function wildHerd(state: GameState): WorldHorse[] {
  const rng = createRng(hashSeed(`world-herd:${state.day}`));
  return Array.from({ length: 6 }, (_, i) => ({ id: `wild:${state.day}:${i}`, name: "野马", genome: randomGenome(rng) }));
}

/** 世界时钟循环推进，不包含结算或日期解锁。 */
export function advanceTime(state: GameState, minutes: number): void {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  state.clock += minutes;
  while (state.clock >= MIDNIGHT) {
    state.day++;
    state.clock = DAY_START + state.clock - MIDNIGHT;
  }
}

export function walk(state: GameState, distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  state.walked += distance;
  const steps = Math.floor(state.walked / TRAVEL_TILES);
  state.walked -= steps * TRAVEL_TILES;
  const minutes = steps * TRAVEL_MINUTES;
  advanceTime(state, minutes);
  return minutes;
}

/** 只写入世界位置和时钟；展示马每次载入重新创建。 */
export function serialize(state: GameState): string {
  return JSON.stringify({ version: 1, day: state.day, clock: state.clock, player: state.player, walked: state.walked });
}

export function deserialize(text: string): GameState | null {
  try {
    const raw = JSON.parse(text);
    if (!raw || raw.version !== 1 || !Number.isSafeInteger(raw.day) || raw.day < 1) return null;
    if (!Number.isFinite(raw.clock) || raw.clock < DAY_START || raw.clock >= MIDNIGHT) return null;
    if (!raw.player || !Number.isFinite(raw.player.x) || !Number.isFinite(raw.player.z)) return null;
    if (!Number.isFinite(raw.walked) || raw.walked < 0 || raw.walked >= TRAVEL_TILES) return null;
    const state = newGame();
    state.day = raw.day;
    state.clock = raw.clock;
    state.walked = raw.walked;
    state.player = walkable(raw.player.x, raw.player.z) ? { x: raw.player.x, z: raw.player.z } : { ...HOME };
    return state;
  } catch {
    return null;
  }
}

export function loadGame(): GameState {
  try {
    // 清除旧版本的全部游戏存档，保留当前世界存档和音乐设置。
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && /^tianma\.save(?:\.|$)/.test(key)) localStorage.removeItem(key);
    }
    const text = localStorage.getItem(SAVE_KEY);
    return (text && deserialize(text)) || newGame();
  } catch {
    return newGame();
  }
}

export function saveGame(state: GameState): void {
  try { localStorage.setItem(SAVE_KEY, serialize(state)); }
  catch { /* 存储不可用时仍可继续探索。 */ }
}
