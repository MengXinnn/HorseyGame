import type { Phenotype } from "../genome/genome";
import { metabolicBudget } from "../genome/traits";

/**
 * 基因 → 身体参数（单位：米、千克、秒）。
 * 所有数值都被夹在物理引擎稳定的范围内：相邻刚体质量比 ≤ 10:1，
 * 尺寸不会为零或无限大，所以任何基因组都能被稳定模拟。
 */
export interface BodyPlan {
  scale: number;
  torsoLength: number;
  torsoHeight: number;
  torsoMass: number;
  legFront: number;
  legRear: number;
  legWidth: number;
  legMass: number;
  hoofRadius: number;
  hoofFriction: number;
  neckLength: number;
  headLength: number;
  headMass: number;
  tailLength: number;
  /** 关节马达扭矩上限（N·m）。 */
  hipTorque: number;
  kneeTorque: number;
  /** 步态频率（Hz）。 */
  gaitHz: number;
  /** 髋关节摆幅（弧度）。 */
  hipAmplitude: number;
  /** 极速（米/秒）：步幅 × 步频，由腿长和步频基因决定。 */
  topSpeed: number;
  /** 加速度（米/秒²）：由肌力决定，体型越大越难起步。 */
  acceleration: number;
  /** 推力作用点在躯干中心以下多少米（越高的马越容易被冲劲掀翻）。 */
  pushHeight: number;
  /** 体力池；跑动按扭矩消耗。 */
  stamina: number;
  staminaDrain: number;
  /** 平衡反射强度（相对体重）。 */
  balance: number;
  /** 每秒「发呆」的概率。 */
  stallPerSecond: number;
  /** 全速时每秒绊一跤的概率；头重脚轻、腿长、前后腿不齐的马更容易绊倒。 */
  stumblePerSecond: number;
  /** 绊跤时身体前扑的猛烈程度（弧度/秒）。 */
  stumbleSpin: number;
  /** 超出代谢预算的点数，会削弱体力。 */
  budgetOver: number;
  totalMass: number;
  coat: number;
  pattern: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function bodyPlanFrom(p: Phenotype): BodyPlan {
  const scale = clamp(1 + 0.12 * p.size, 0.72, 1.3);
  const torsoLength = 1.7 * scale * (1 + 0.08 * p.torso);
  const torsoHeight = 0.72 * scale * (1 + 0.15 * p.girth);
  const legFront = 1.05 * scale * (1 + 0.17 * p.legF);
  const legRear = 1.05 * scale * (1 + 0.17 * p.legR);
  const legWidth = 0.15 * scale * (1 + 0.1 * p.girth);
  const torsoMass = 380 * scale ** 3 * (1 + 0.08 * p.torso) * (1 + 0.16 * p.girth) * (1 + 0.04 * p.con);
  const legMass = clamp(torsoMass * 0.035, torsoMass / 10, torsoMass);
  const headMass = clamp(torsoMass * 0.09 * (1 + 0.25 * p.head), torsoMass / 10, torsoMass / 2);
  const legAvg = (legFront + legRear) / 2;
  const budget = metabolicBudget(p);

  // 力量和体重成正比，再乘以肌力系数：大马不会因为太重而站不起来。
  const muscle = 1 + 0.22 * p.power;
  const totalMass = torsoMass + headMass + legMass * 8;
  const hipTorque = 4.2 * totalMass * muscle;
  const kneeTorque = 3.0 * totalMass * muscle;

  // 腿越长，自然摆动越慢（单摆）；步频基因在此基础上调快或调慢。
  const gaitHz = clamp((2.1 * (1 + 0.16 * p.stride)) / (legAvg / 1.05) ** 0.25, 1.2, 4);

  // 前后腿差得越多，步伐越别扭，极速打折。
  const legMismatch = Math.abs(legFront - legRear) / legAvg;
  const topSpeed = clamp(legAvg * gaitHz * 4 * (1 - 0.6 * legMismatch), 3, 16);
  const balance = clamp(1 + 0.12 * p.girth + 0.08 * p.hoof - 0.06 * p.neck - 0.06 * p.head, 0.6, 1.4);
  const instability = clamp(1.1 - balance + legMismatch * 1.5 + (legAvg / 1.05 - 1) * 0.8 + 0.04 * p.head, 0, 1.2);
  const acceleration = clamp(5 * (1 + 0.22 * p.power) * (1 - 0.06 * p.size), 2, 9);

  return {
    scale,
    torsoLength,
    torsoHeight,
    torsoMass,
    legFront,
    legRear,
    legWidth,
    legMass,
    hoofRadius: legWidth * (0.55 + 0.08 * p.hoof),
    hoofFriction: clamp(1.0 + 0.15 * p.hoof, 0.6, 1.4),
    neckLength: 0.85 * scale * (1 + 0.2 * p.neck),
    headLength: 0.55 * scale,
    headMass,
    tailLength: 0.7 * scale * (1 + 0.2 * p.tail),
    hipTorque,
    kneeTorque,
    gaitHz,
    topSpeed,
    acceleration,
    pushHeight: legAvg * 0.85 + torsoHeight * 0.3,
    hipAmplitude: clamp(0.5 + 0.03 * p.stride, 0.38, 0.62),
    stamina: 100 * (1 + 0.2 * p.con),
    staminaDrain: (1 + 0.1 * p.power + 0.1 * p.stride) * (1 + budget.over / 40),
    balance,
    stallPerSecond: clamp(0.035 * (1 - (p.courage + 2) / 4), 0, 0.05),
    stumblePerSecond: 0.015 + 0.14 * instability,
    stumbleSpin: 2.2 + 3.6 * instability,
    budgetOver: budget.over,
    totalMass,
    coat: p.coat,
    pattern: p.pattern,
  };
}
