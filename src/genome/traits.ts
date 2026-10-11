import { express, type Genome, type Phenotype } from "./genome";

/** 代谢预算：体型、肌力、步频（以及以后的嵌合部件）消耗代谢点，上限由体质决定。 */
export interface Budget {
  used: number;
  cap: number;
  over: number;
}

export function metabolicBudget(p: Phenotype, extraCost = 0): Budget {
  const used = Math.round(10 * (p.size + 2) + 9 * (p.power + 2) + 7 * (p.stride + 2) + extraCost);
  const cap = Math.round(60 + 10 * p.con);
  return { used, cap, over: Math.max(0, used - cap) };
}

/** 嵌合槽数量 0–4，由相容度决定。 */
export function chimeraSlots(p: Phenotype): number {
  return Math.max(0, Math.min(4, Math.round(p.compat + 2)));
}

/**
 * 面板上展示的估算属性（0–100）。真正的成绩由物理模拟决定，
 * 这些数字只是给玩家的「直觉提示」，和模拟方向一致但不精确。
 */
export interface DisplayStats {
  speed: number;
  stability: number;
  strength: number;
  endurance: number;
}

const clamp100 = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

export function displayStats(p: Phenotype): DisplayStats {
  const leg = (p.legF + p.legR) / 2;
  const legDiff = Math.abs(p.legF - p.legR);
  const budget = metabolicBudget(p);
  return {
    speed: clamp100(50 + 9 * leg + 7 * p.power + 7 * p.stride - 6 * p.girth - 4 * p.size - 3 * p.con),
    stability: clamp100(50 + 10 * p.girth - 9 * leg - 6 * legDiff + 4 * p.size + 3 * p.hoof - 3 * p.neck - 4 * p.stride),
    strength: clamp100(50 + 9 * p.power + 8 * p.size + 3 * p.girth + 2 * p.neck),
    endurance: clamp100(50 + 9 * p.con - 5 * p.size - 4 * p.power - 4 * p.stride + 2 * leg - 3 * p.girth - 0.6 * budget.over),
  };
}

export function phenotypeOf(genome: Genome): Phenotype {
  return express(genome);
}
