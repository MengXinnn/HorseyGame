import { Edge, Vec2, World } from "planck";
import { bodyPlanFrom } from "../body/bodyPlan";
import { express, type Genome } from "../genome/genome";
import { CATEGORY_GROUND, HorseSim, type HorsePose } from "./horse";
import { createRng, type Rng } from "./rng";
import { groundHeight, terrainAt, TERRAIN_FRICTION, type Terrain } from "./terrain";

export const STEP = 1 / 60;
const SETTLE_TIME = 1.0;
/** 摔倒的马趴稳这么久之后才算出局，让倒地的过程演完。 */
const DOWN_OUT = 1.5;

export interface Entrant {
  id: string;
  name: string;
  genome: Genome;
  wings?: boolean;
}

export interface RaceOptions {
  distance: number;
  seed: number;
  /** 超时秒数；超时还没到终点的马（包括摔倒趴下的）按跑过的距离排名。 */
  timeLimit: number;
  gravity?: number;
  groundFriction?: number;
  /** 迎面风（米/秒²），把马往后推。 */
  wind?: number;
  /** 看台上的人多：胆小的马发呆的机会乘这个倍数。 */
  crowd?: number;
  terrains?: readonly Terrain[];
  /** 发令时间（秒）；之前马原地站稳。Infinity 表示只站着不跑（马厩展示用）。 */
  startAt?: number;
}

export interface Runner {
  entrant: Entrant;
  horse: HorseSim;
  startX: number;
  finishTime: number | null;
}

export interface RaceResult {
  id: string;
  name: string;
  rank: number;
  time: number | null;
  distance: number;
  falls: number;
  stalls: number;
  stumbles: number;
  flightTime: number;
}

/**
 * 一场比赛：每匹马在自己的「泳道」里跑（马与马之间不碰撞），固定步长推进，
 * 同样的种子和马匹永远得到同样的结果。
 */
export class Race {
  readonly world: World;
  readonly runners: Runner[];
  readonly options: RaceOptions;
  time = 0;
  private readonly rng: Rng;

  constructor(entrants: Entrant[], options: RaceOptions) {
    this.options = options;
    this.rng = createRng(options.seed);
    this.world = new World({ gravity: new Vec2(-(options.wind ?? 0), -(options.gravity ?? 9.8)) });
    const ground = this.world.createBody({ type: "static" });
    const height = (x: number): number => groundHeight(x, options.distance, options.terrains ?? ["grass"]);
    const fixture = {
      friction: options.groundFriction ?? 1,
      filterCategoryBits: CATEGORY_GROUND,
      filterMaskBits: 0xffff,
    };
    if (options.terrains?.includes("hill")) {
      for (let x = -50; x < options.distance + 200; x += 2) ground.createFixture(new Edge(new Vec2(x, height(x)), new Vec2(x + 2, height(x + 2))), fixture);
    } else ground.createFixture(new Edge(new Vec2(-50, 0), new Vec2(options.distance + 200, 0)), fixture);
    if (options.terrains?.includes("forest")) {
      for (let x = 8; x < options.distance; x += 15) {
        if (terrainAt(x, options.distance, options.terrains) === "forest") ground.createFixture(new Edge(new Vec2(x, 2.3), new Vec2(x + 3, 2.3)), fixture);
      }
    }
    this.runners = entrants.map((entrant, i) => {
      const plan = bodyPlanFrom(express(entrant.genome), entrant.wings);
      if (options.crowd) plan.stallPerSecond *= options.crowd;
      const horse = new HorseSim(this.world, plan, 0, i + 1, createRng(this.rng.int(1, 2 ** 31)));
      horse.groundHeight = height;
      horse.groundFriction = options.groundFriction ?? 1;
      return { entrant, horse, startX: horse.x, finishTime: null };
    });
  }

  get startAt(): number {
    return this.options.startAt ?? SETTLE_TIME;
  }

  get started(): boolean {
    return this.time >= this.startAt;
  }

  get raceTime(): number {
    return Math.max(0, this.time - this.startAt);
  }

  get finished(): boolean {
    return this.raceTime >= this.options.timeLimit || this.runners.every((r) => r.finishTime !== null || r.horse.downTime >= DOWN_OUT);
  }

  progress(r: Runner): number {
    return r.horse.x - r.startX;
  }

  step(): void {
    if (this.finished) return;
    const go = this.started;
    for (const r of this.runners) {
      r.horse.active = go && r.finishTime === null;
      if (this.options.terrains) {
        const terrain = terrainAt(this.progress(r), this.options.distance, this.options.terrains);
        r.horse.groundFriction = (this.options.groundFriction ?? 1) * TERRAIN_FRICTION[terrain];
        if (go && (terrain === "wetland" || terrain === "coast")) {
          const plan = r.horse.plan;
          const drag = terrain === "wetland" ? Math.max(0.08, 0.5 - plan.hoofRadius * 2) : 0.08 + plan.torsoHeight * 0.1;
          r.horse.torso.applyForceToCenter(new Vec2(-r.horse.torso.getLinearVelocity().x * plan.totalMass * drag, 0), true);
        }
      }
      r.horse.step(STEP);
    }
    this.world.step(STEP, 8, 3);
    this.time += STEP;
    if (go) {
      for (const r of this.runners) {
        if (r.finishTime === null && this.progress(r) >= this.options.distance) r.finishTime = this.raceTime;
      }
    }
  }

  runToEnd(maxSteps = 1_000_000): RaceResult[] {
    let n = 0;
    while (!this.finished && n++ < maxSteps) this.step();
    return this.results();
  }

  poses(): HorsePose[] {
    return this.runners.map((r) => r.horse.pose());
  }

  results(): RaceResult[] {
    const rows = this.runners.map((r) => ({
      id: r.entrant.id,
      name: r.entrant.name,
      rank: 0,
      time: r.finishTime,
      distance: Math.min(this.options.distance, Math.max(0, this.progress(r))),
      falls: r.horse.falls,
      stalls: r.horse.stalls,
      stumbles: r.horse.stumbles,
      flightTime: r.horse.flightTime,
    }));
    rows.sort((a, b) => {
      if (a.time !== null && b.time !== null) return a.time - b.time;
      if (a.time !== null) return -1;
      if (b.time !== null) return 1;
      return b.distance - a.distance;
    });
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }
}

/** 试跑：一匹马单独跑 seconds 秒，返回距离和摔倒次数。用于试跑场和平衡测试。 */
export function trial(genome: Genome, seconds = 10, seed = 1): RaceResult & { avgSpeed: number; finite: boolean } {
  const race = new Race([{ id: "trial", name: "试跑", genome }], { distance: 10_000, seed, timeLimit: seconds });
  const res = race.runToEnd();
  const r = res[0] as RaceResult;
  const finite = race.runners[0]!.horse.bodies.every((b) => {
    const p = b.getPosition();
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(b.getAngle());
  });
  return { ...r, avgSpeed: r.distance / seconds, finite };
}
