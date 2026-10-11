import { breed, decodeGenome, encodeGenome, makeGenome, randomGenome, type Genome } from "../genome/genome";
import type { TimeOfDay } from "../render/scene";
import { createRng, hashSeed } from "../sim/rng";
import { horseName } from "./names";

export interface HorseRecord {
  trials: number;
  /** 试跑 10 秒的最好距离（米）。 */
  bestTrial: number;
  races: number;
  wins: number;
  falls: number;
}

export interface StableHorse {
  id: string;
  name: string;
  genome: Genome;
  /** 测序之后才能看到基因型；没测序只能看外表和跑出来的成绩。 */
  sequenced: boolean;
  generation: number;
  parents: [string, string] | null;
  /** 这匹马的突变位点（来自繁殖）。 */
  mutations: string[];
  record: HorseRecord;
}

export interface GameState {
  version: 1;
  horses: StableHorse[];
  selectedId: string;
  time: TimeOfDay;
  /** 下一次随机事件（繁殖、野马）的种子计数器，保证存档可复现。 */
  counter: number;
}

const SAVE_KEY = "tianma.save.v1";
export const STABLE_LIMIT = 12;

const emptyRecord = (): HorseRecord => ({ trials: 0, bestTrial: 0, races: 0, wins: 0, falls: 0 });

let idCounter = 0;
function newId(): string {
  idCounter++;
  return `h${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function createHorse(name: string, genome: Genome, extra: Partial<StableHorse> = {}): StableHorse {
  return { id: newId(), name, genome, sequenced: false, generation: 0, parents: null, mutations: [], record: emptyRecord(), ...extra };
}

/** 开局的四匹马：两匹老赵送的、性格鲜明的马，加两匹刚套回来的野马。 */
export function newGame(): GameState {
  const rng = createRng(hashSeed("天马行空"));
  const horses = [
    createHorse(
      "流星",
      makeGenome({ legF: [1, 2], legR: [1, 1], girth: [-1, 0], stride: [1, 0], power: [1, 0], neck: [1, 0], courage: [0, 1], coat: [1, 1], pattern: [1, 2], compat: [0, 1] }),
    ),
    createHorse(
      "磐石",
      makeGenome({ size: [1, 1], girth: [2, 1], legF: [-1, 0], legR: [-1, 0], hoof: [1, 1], power: [1, 1], con: [1, 0], stride: [-1, 0], coat: [-1, -1], pattern: [-1, -2] }),
    ),
  ];
  const taken = new Set(horses.map((h) => h.name));
  for (let i = 0; i < 2; i++) {
    const name = horseName(rng, taken);
    taken.add(name);
    horses.push(createHorse(name, randomGenome(rng)));
  }
  return { version: 1, horses, selectedId: horses[0]!.id, time: "dusk", counter: 1 };
}

interface SavedHorse extends Omit<StableHorse, "genome"> {
  code: string;
}

export function serialize(state: GameState): string {
  const horses: SavedHorse[] = state.horses.map(({ genome, ...rest }) => ({ ...rest, code: encodeGenome(genome) }));
  return JSON.stringify({ ...state, horses });
}

export function deserialize(text: string): GameState | null {
  try {
    const raw = JSON.parse(text) as Omit<GameState, "horses"> & { horses: SavedHorse[] };
    if (raw.version !== 1 || !Array.isArray(raw.horses)) return null;
    const horses: StableHorse[] = [];
    for (const h of raw.horses) {
      const genome = decodeGenome(h.code);
      if (!genome) continue;
      const { code: _code, ...rest } = h;
      horses.push({ ...rest, genome, record: { ...emptyRecord(), ...rest.record } });
    }
    if (horses.length === 0) return null;
    const selectedId = horses.some((h) => h.id === raw.selectedId) ? raw.selectedId : horses[0]!.id;
    const time = (["dawn", "noon", "dusk", "night"] as const).includes(raw.time) ? raw.time : "dusk";
    return { version: 1, horses, selectedId, time, counter: Number(raw.counter) || 1 };
  } catch {
    return null;
  }
}

export function loadGame(): GameState {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (text) {
      const state = deserialize(text);
      if (state) return state;
    }
  } catch {
    // 隐私模式或禁用存储时直接开新档。
  }
  return newGame();
}

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state));
  } catch {
    // 存不了就算了，游戏照常进行。
  }
}

export function resetGame(): GameState {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // 同上。
  }
  return newGame();
}

/** 繁殖一匹小马。返回 null 表示马厩满了。 */
export function breedFoal(state: GameState, damId: string, sireId: string): StableHorse | null {
  if (state.horses.length >= STABLE_LIMIT) return null;
  const dam = state.horses.find((h) => h.id === damId);
  const sire = state.horses.find((h) => h.id === sireId);
  if (!dam || !sire || dam === sire) return null;
  const rng = createRng(hashSeed(`${dam.id}:${sire.id}:${state.counter++}`));
  const { genome, mutations } = breed(dam.genome, sire.genome, rng);
  const name = horseName(rng, new Set(state.horses.map((h) => h.name)));
  const foal = createHorse(name, genome, {
    generation: Math.max(dam.generation, sire.generation) + 1,
    parents: [dam.name, sire.name],
    mutations: [...mutations],
  });
  state.horses.push(foal);
  return foal;
}

/** 套一匹野马。 */
export function catchWild(state: GameState): StableHorse | null {
  if (state.horses.length >= STABLE_LIMIT) return null;
  const rng = createRng(hashSeed(`wild:${state.counter++}`));
  const horse = createHorse(horseName(rng, new Set(state.horses.map((h) => h.name))), randomGenome(rng));
  state.horses.push(horse);
  return horse;
}

/** 用马码导入一匹马（朋友分享的马）。 */
export function importHorse(state: GameState, code: string): StableHorse | "full" | "invalid" {
  if (state.horses.length >= STABLE_LIMIT) return "full";
  const genome = decodeGenome(code.trim());
  if (!genome) return "invalid";
  const rng = createRng(hashSeed(`import:${code}:${state.counter++}`));
  const horse = createHorse(horseName(rng, new Set(state.horses.map((h) => h.name))), genome);
  state.horses.push(horse);
  return horse;
}

export function releaseHorse(state: GameState, id: string): boolean {
  if (state.horses.length <= 1) return false;
  const i = state.horses.findIndex((h) => h.id === id);
  if (i < 0) return false;
  state.horses.splice(i, 1);
  if (state.selectedId === id) state.selectedId = state.horses[Math.max(0, i - 1)]!.id;
  return true;
}

/** 平地赛的七匹野马对手，由比赛种子决定。 */
export function wildField(seed: number, count = 7): Array<{ name: string; genome: Genome }> {
  const rng = createRng(seed);
  const taken = new Set<string>();
  const field: Array<{ name: string; genome: Genome }> = [];
  for (let i = 0; i < count; i++) {
    const name = horseName(rng, taken);
    taken.add(name);
    field.push({ name, genome: randomGenome(rng) });
  }
  return field;
}
