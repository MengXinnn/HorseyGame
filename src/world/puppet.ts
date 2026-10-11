import { Edge, Vec2, World } from "planck";
import { bodyPlanFrom, type BodyPlan } from "../body/bodyPlan";
import { express, type Genome } from "../genome/genome";
import { drawHorsePose, lookFor } from "../render/horseArt";
import { CATEGORY_GROUND, HorseSim, type HorsePose } from "../sim/horse";
import { STEP } from "../sim/race";
import { createRng, hashSeed } from "../sim/rng";
import { canvas, outline } from "./sprites";
import { METERS_PER_TILE } from "./tiles";

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

  /** 推进 dt 秒：位置按速度走（格/秒），腿的动作交给物理。 */
  update(dt: number): void {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (Math.abs(this.vx) > 0.15) this.facing = this.vx > 0 ? 1 : -1;
    // 物理马跑的是「身体前进的速度」（米/秒）；俯视时上下走也要迈步，所以按总速度算。
    const target = (this.speed * METERS_PER_TILE) / this.scale;
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

  private buf: HTMLCanvasElement | null = null;

  /**
   * 画成像素小马：先在一张小画布上画出物理姿态，描一圈深色轮廓，
   * 再贴到 (sx, sy)（脚底中心）。返回贴图占的矩形，用来点选。
   */
  drawPixel(ctx: CanvasRenderingContext2D, sx: number, sy: number, ppm: number): { x: number; y: number; w: number; h: number } {
    const plan = this.plan;
    const k = ppm * this.scale;
    const w = Math.ceil((plan.torsoLength + plan.neckLength + plan.tailLength + 1.4) * k) + 6;
    const h = Math.ceil((Math.max(plan.legFront, plan.legRear) + plan.torsoHeight + plan.neckLength + 0.5) * k) + 6;
    if (!this.buf || this.buf.width !== w || this.buf.height !== h) this.buf = canvas(w, h)[0];
    const bctx = this.buf.getContext("2d") as CanvasRenderingContext2D;
    bctx.clearRect(0, 0, w, h);
    const pose = this.pose();
    drawHorsePose(bctx, pose, plan, lookFor(plan, "#fff3d6"), { camX: pose.torso.x, ppm: k, groundY: h - 3, width: w, anchor: 0.5 });
    outline(this.buf, "#2a1a12", 120);
    const x = Math.round(sx - w / 2);
    const y = Math.round(sy - (h - 3));
    ctx.save();
    if (this.facing < 0) {
      ctx.translate(Math.round(sx) * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.buf, x, y);
    ctx.restore();
    return { x, y, w, h };
  }

  private inkTop = -1;

  /**
   * 上一次 drawPixel 画出来的马，最高的不透明像素离脚底多高（缓冲像素）。名牌就放在它上面。
   * 低头抬头时会变，慢慢跟过去，免得名牌一跳一跳。
   */
  headHeight(): number {
    const c = this.buf;
    if (!c) return 0;
    const { width: w, height: h } = c;
    const d = (c.getContext("2d") as CanvasRenderingContext2D).getImageData(0, 0, w, h).data;
    let row = h - 3;
    for (let i = 3; i < d.length; i += 4)
      if (d[i]! > 0) {
        row = Math.floor((i - 3) / 4 / w);
        break;
      }
    const height = h - 3 - row;
    this.inkTop = this.inkTop < 0 ? height : this.inkTop + (height - this.inkTop) * 0.15;
    return Math.round(this.inkTop);
  }
}
