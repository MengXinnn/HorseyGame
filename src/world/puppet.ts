import { Edge, Vec2, World } from "planck";
import { bodyPlanFrom, type BodyPlan } from "../body/bodyPlan";
import { express, type Genome } from "../genome/genome";
import { drawHorsePose, lookFor } from "../render/horseArt";
import { CATEGORY_GROUND, HorseSim, type HorsePose } from "../sim/horse";
import { STEP } from "../sim/race";
import { createRng, hashSeed } from "../sim/rng";
import { project, type Camera } from "./camera";

/**
 * 大世界里的一匹马。马在世界里的位置（x, z）由 AI 决定；
 * 它的腿怎么动，则交给一个只属于它自己的小物理世界去算（马在跑步机上跑），
 * 所以大世界里的马和赛场上的马是同一套身体、同一种步态。
 */
export class HorsePuppet {
  readonly id: string;
  readonly name: string;
  readonly genome: Genome;
  readonly plan: BodyPlan;
  x: number;
  z: number;
  vx = 0;
  vz = 0;
  facing: 1 | -1 = 1;
  /** 画的时候缩放（小马 0.62）。 */
  scale: number;
  /** AI 用的计时器和目标点。 */
  timer = 0;
  tx: number;
  tz: number;
  /** 被套住了：AI 停下，由套马逻辑控制。 */
  roped = false;
  private world!: World;
  private sim!: HorseSim;
  private acc = 0;
  private readonly seed: number;

  constructor(id: string, name: string, genome: Genome, x: number, z: number, scale = 1) {
    this.id = id;
    this.name = name;
    this.genome = genome;
    this.plan = bodyPlanFrom(express(genome));
    this.x = x;
    this.z = z;
    this.tx = x;
    this.tz = z;
    this.scale = scale;
    this.seed = hashSeed(id);
    this.facing = this.seed % 2 === 0 ? 1 : -1;
    this.build();
    // 先让它站稳，免得一出场腿还在抖。
    for (let i = 0; i < 30; i++) this.stepPhysics(0);
  }

  private build(): void {
    this.world = new World({ gravity: new Vec2(0, -9.8) });
    const ground = this.world.createBody({ type: "static" });
    ground.createFixture(new Edge(new Vec2(-50, 0), new Vec2(100000, 0)), { friction: 1, filterCategoryBits: CATEGORY_GROUND, filterMaskBits: 0xffff });
    this.sim = new HorseSim(this.world, this.plan, 0, 1, createRng(this.seed));
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  private stepPhysics(target: number): void {
    const sim = this.sim;
    sim.active = target > 0.4;
    (sim as { targetSpeed?: number | null }).targetSpeed = Math.max(0.5, target);
    sim.step(STEP);
    this.world.step(STEP, 8, 3);
  }

  /** 推进 dt 秒：位置按速度走，腿的动作交给物理。 */
  update(dt: number): void {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (Math.abs(this.vx) > 0.2) this.facing = this.vx > 0 ? 1 : -1;
    // 物理马跑的是「身体前进的速度」，侧着看只看得到 x 方向，但步子要配合总速度。
    const target = this.speed / this.scale;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < 6) {
      this.stepPhysics(target);
      this.acc -= STEP;
    }
    if (n >= 6) this.acc = 0;
    // 物理马摔倒了就换一副新身体（大世界里的马不会一直趴着）。
    if (this.sim.state === "fallen" || this.sim.torso.getPosition().x > 50000) this.build();
  }

  pose(): HorsePose {
    return this.sim.pose();
  }

  /** 屏幕上的包围盒，用来点选。 */
  bounds(cam: Camera): { x: number; y: number; w: number; h: number } | null {
    const p = project(cam, this.x, this.z, 0);
    if (!p) return null;
    const s = p.scale * this.scale;
    const w = (this.plan.torsoLength + this.plan.neckLength) * s * 1.1;
    const h = (Math.max(this.plan.legFront, this.plan.legRear) + this.plan.torsoHeight + this.plan.neckLength * 0.8) * s;
    return { x: p.x - w / 2, y: p.y - h, w, h };
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, rim: string): void {
    const p = project(cam, this.x, this.z, 0);
    if (!p) return;
    const ppm = p.scale * this.scale;
    if (ppm < 0.8) return;
    const pose = this.pose();
    const view = { camX: pose.torso.x, ppm, groundY: p.y, width: 1, anchor: p.x };
    ctx.save();
    if (this.facing < 0) {
      ctx.translate(p.x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-p.x, 0);
    }
    drawHorsePose(ctx, pose, this.plan, lookFor(this.plan, rim), view);
    ctx.restore();
  }
}
