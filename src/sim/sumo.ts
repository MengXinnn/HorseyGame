import { Edge, Vec2, World } from "planck";
import { bodyPlanFrom, type BodyPlan } from "../body/bodyPlan";
import { express } from "../genome/genome";
import { CATEGORY_GROUND, HorseSim, type HorsePose } from "./horse";
import { STEP, type Entrant } from "./race";
import { createRng, type Rng } from "./rng";

export interface SumoOptions {
  seed: number;
  /** 土俵半径（米），默认 4。躯干中心出圈就输。 */
  ringRadius?: number;
  /** 比赛时限（秒，不含站稳时间），默认 60。 */
  timeLimit?: number;
  /** 开打时间（秒）；之前两匹马原地站稳，默认 1。 */
  startAt?: number;
}

/** ringout 出圈，flip 摔倒，time 时间到按离圈心远近判，draw 平局。 */
export type SumoReason = "ringout" | "flip" | "time" | "draw";

/** 顶牛时的目标速度（米/秒）：慢慢拱过去，推不动时推进力就顶满。 */
const PUSH_SPEED = 2.75;
/** 每匹马听到开打后的反应时间上限（秒）。 */
const MAX_REACTION = 0.3;
/** 发力有起伏：每隔一阵换一个劲头，劲头在这个范围里（相对 PUSH_SPEED）。 */
const HEAVE_MIN = 0.3;
const HEAVE_HOLD = [0.4, 1.4] as const;
const HEAVE_RATE = 4;
/** 站稳后两匹马鼻尖之间的空隙（米）。 */
const NOSE_GAP = 1.0;
/** 时间到时，离圈心近这么多（米）以上才算赢。 */
const TIME_MARGIN = 0.3;

/** 鼻尖在躯干中心前方多远（米），和 HorseSim 里颈、头的搭法一致。 */
function noseReach(plan: BodyPlan): number {
  return plan.torsoLength * 0.4 + Math.cos(0.95) * plan.neckLength + plan.headLength * (0.32 + 0.5 * Math.cos(0.6));
}

/**
 * 相扑：两匹马在土俵上面对面顶牛。左边的马朝右，右边的马朝左，两马相撞；
 * 躯干中心被推出圈或者摔倒就输。固定步长推进，同样的种子永远得到同样的结果。
 */
export class SumoBout {
  readonly world: World;
  readonly horses: [HorseSim, HorseSim];
  readonly entrants: [Entrant, Entrant];
  readonly ringRadius: number;
  readonly timeLimit: number;
  readonly startAt: number;
  time = 0;
  winner: 0 | 1 | null = null;
  reason: SumoReason | null = null;
  /** 分出胜负时的比赛时刻（秒，从开打算起）；没结束时为 null。 */
  private endedAt: number | null = null;
  private readonly rng: Rng;
  private readonly reaction: [number, number];
  private readonly heave = [1, 1];
  private readonly heaveGoal = [1, 1];
  private readonly heaveLeft = [0, 0];

  constructor(a: Entrant, b: Entrant, opts: SumoOptions) {
    this.entrants = [a, b];
    this.ringRadius = opts.ringRadius ?? 4;
    this.timeLimit = opts.timeLimit ?? 60;
    this.startAt = opts.startAt ?? 1.0;
    this.rng = createRng(opts.seed);
    this.world = new World({ gravity: new Vec2(0, -9.8) });
    const ground = this.world.createBody({ type: "static" });
    const half = this.ringRadius + 40;
    ground.createFixture(new Edge(new Vec2(-half, 0), new Vec2(half, 0)), {
      friction: 1,
      filterCategoryBits: CATEGORY_GROUND,
      filterMaskBits: 0xffff,
    });
    const planA = bodyPlanFrom(express(a.genome));
    const planB = bodyPlanFrom(express(b.genome));
    const xa = -(noseReach(planA) + NOSE_GAP / 2);
    const xb = noseReach(planB) + NOSE_GAP / 2;
    this.horses = [
      new HorseSim(this.world, planA, xa, 1, createRng(this.rng.int(1, 2 ** 31)), { facing: 1, collideHorses: true }),
      new HorseSim(this.world, planB, xb, 2, createRng(this.rng.int(1, 2 ** 31)), { facing: -1, collideHorses: true }),
    ];
    for (const h of this.horses) h.targetSpeed = PUSH_SPEED;
    this.reaction = [this.rng.next() * MAX_REACTION, this.rng.next() * MAX_REACTION];
  }

  get started(): boolean {
    return this.time >= this.startAt;
  }

  /** 开打后经过的时间；分出胜负后停在那一刻。 */
  get boutTime(): number {
    return this.endedAt ?? Math.max(0, this.time - this.startAt);
  }

  get finished(): boolean {
    return this.reason !== null;
  }

  /**
   * 推进一步。分出胜负后仍可继续调用：结果不再改变，两匹马收劲站着（或趴着），
   * 物理接着演，方便界面把输家倒地、滑出圈的过程播完。
   */
  step(): void {
    const go = this.started && !this.finished;
    this.horses.forEach((h, i) => {
      h.active = go && this.time >= this.startAt + this.reaction[i]!;
      if (h.active) {
        // 一口气一口气地拱：劲头隔一阵变一次，两匹一样的马也会分出高下。
        this.heaveLeft[i]! -= STEP;
        if (this.heaveLeft[i]! <= 0) {
          this.heaveGoal[i] = HEAVE_MIN + (1 - HEAVE_MIN) * this.rng.next();
          this.heaveLeft[i] = HEAVE_HOLD[0] + (HEAVE_HOLD[1] - HEAVE_HOLD[0]) * this.rng.next();
        }
        this.heave[i]! += (this.heaveGoal[i]! - this.heave[i]!) * Math.min(1, HEAVE_RATE * STEP);
        h.targetSpeed = PUSH_SPEED * this.heave[i]!;
      }
      h.step(STEP);
    });
    this.world.step(STEP, 8, 3);
    this.time += STEP;
    if (go) this.judge();
  }

  runToEnd(maxSteps = 1_000_000): void {
    let n = 0;
    while (!this.finished && n++ < maxSteps) this.step();
  }

  poses(): HorsePose[] {
    return this.horses.map((h) => h.pose());
  }

  private judge(): void {
    const R = this.ringRadius;
    const out = this.horses.map((h) => Math.abs(h.x) > R);
    const down = this.horses.map((h) => h.state === "fallen");
    const lose = [out[0]! || down[0]!, out[1]! || down[1]!];
    if (lose[0] && lose[1]) {
      // 同一步都输了：都出圈比谁更远，一个出圈一个摔倒算出圈的输，都摔倒算平局。
      const d0 = Math.abs(this.horses[0].x);
      const d1 = Math.abs(this.horses[1].x);
      if (out[0] && out[1] && d0 !== d1) this.end(d0 > d1 ? 1 : 0, "ringout");
      else if (out[0] !== out[1]) this.end(out[0] ? 1 : 0, "ringout");
      else this.end(null, "draw");
    } else if (lose[0]) this.end(1, out[0] ? "ringout" : "flip");
    else if (lose[1]) this.end(0, out[1] ? "ringout" : "flip");
    else if (this.boutTime >= this.timeLimit) {
      const d0 = Math.abs(this.horses[0].x);
      const d1 = Math.abs(this.horses[1].x);
      if (Math.abs(d0 - d1) > TIME_MARGIN) this.end(d0 < d1 ? 0 : 1, "time");
      else this.end(null, "draw");
    }
  }

  private end(winner: 0 | 1 | null, reason: SumoReason): void {
    this.winner = winner;
    this.reason = reason;
    this.endedAt = Math.max(0, this.time - this.startAt);
  }
}
