import { Box, Circle, RevoluteJoint, Vec2, type Body, type World } from "planck";
import type { BodyPlan } from "../body/bodyPlan";
import type { Rng } from "./rng";

export const CATEGORY_GROUND = 0x0001;
export const CATEGORY_HORSE = 0x0002;

const GRAVITY = 9.8;
const HIP_GAIN = 10;
const KNEE_GAIN = 12;
const BAL_P = 2.5;
const BAL_D = 0.5;
const SUPPORT_K = 40;
const SUPPORT_D = 6;
const HOOF_SLIP = 0.1;
const BODY_FRICTION = 0.15;
const MAX_JOINT_SPEED = 14;
/** 落脚反射：蹄子平均落在髋（肩）正下方偏前一点，身体才不会往前栽。 */
const LEG_REACH_TARGET = { front: 0.04, rear: 0.06 };
const LEG_REACH_GAIN = 1.2;
/** 摔倒后关节只留这么一点劲，腿软软地瘫着。 */
const FALLEN_GRIP = 0.06;
/** 摔倒后把身体放平的力度（相对平衡反射）。 */
const FALLEN_SETTLE = 0.5;
/** 摔倒后身体在地上滑行的阻尼。 */
const FALLEN_DRAG = 2;
/** 蹄子离地多高以内仍能借上力（米）。 */
const REACH = 0.3;

export interface LegPose {
  hip: Vec2Like;
  knee: Vec2Like;
  foot: Vec2Like;
  front: boolean;
  far: boolean;
}
export interface Vec2Like {
  x: number;
  y: number;
}

/** 渲染层需要的全部姿态信息（物理坐标，y 向上）。 */
export interface HorsePose {
  torso: { x: number; y: number; angle: number };
  neck: { x: number; y: number; angle: number };
  legs: LegPose[];
  stalled: boolean;
  stumbling: boolean;
  fallen: boolean;
  phase: number;
  /** 沿朝向的速度（米/秒），朝左的马往左跑也是正的。 */
  speed: number;
  /** 朝向：1 头朝右（+x），-1 头朝左（-x）。 */
  facing: 1 | -1;
}

export interface HorseOptions {
  /** 朝向：1 头朝右（默认），-1 整匹马镜像，头朝左。 */
  facing?: 1 | -1;
  /** 是否和别的马相撞（相扑用）；默认 false，比赛里每匹马各跑各的泳道。 */
  collideHorses?: boolean;
}

interface Leg {
  thigh: Body;
  shin: Body;
  hip: RevoluteJoint;
  knee: RevoluteJoint;
  phaseOffset: number;
  front: boolean;
  far: boolean;
  upper: number;
  lower: number;
  grounded: boolean;
}

export type HorseState = "running" | "stalled" | "stumbling" | "fallen";

/**
 * 一匹物理马：躯干、颈头、四条两节腿。玩家不操控马，马由步态振荡器自己跑；
 * 玩家决定的是这副身体。
 */
export class HorseSim {
  readonly plan: BodyPlan;
  /** 朝向：1 头朝右，-1 头朝左。所有左右相关的量都乘以它，朝左的马就是朝右的马的镜像。 */
  readonly facing: 1 | -1;
  /** 出生时躯干的 x，用于计算沿朝向前进了多远。 */
  readonly startX: number;
  readonly torso: Body;
  readonly neck: Body;
  private readonly legs: Leg[] = [];
  private readonly neckJoint: RevoluteJoint;
  private readonly world: World;
  private readonly rng: Rng;
  private time = 0;
  private phase = 0;
  private stallLeft = 0;
  private stumbleLeft = 0;
  /** 前后腿不一样长时，身体的自然俯仰角；平衡反射以它为目标，而不是硬掰成水平。 */
  private readonly restAngle: number;
  private readonly standHeight: number;
  private fallenFor = 0;
  stamina: number;
  falls = 0;
  /** 摔倒后已经趴了多久（秒）。 */
  downTime = 0;
  /** 跑动中偏离自然姿态的最大角度，用于平衡测试。 */
  maxTilt = 0;
  stalls = 0;
  stumbles = 0;
  state: HorseState = "running";
  /** 起跑前为 false，马原地站立。 */
  active = false;
  /** 赛场地面摩擦（雨天泥地、冰面等修正会改它）。 */
  groundFriction = 1;
  groundHeight: (x: number) => number = () => 0;
  flightTime = 0;
  private lifted = false;
  private contact = 1;
  /** 前腿、后腿的落脚前移量（弧度），由落脚反射慢慢调出来。 */
  private reachFront = 0.05;
  private reachRear = -0.05;
  /** 目标速度（米/秒）；为 null 时用身体的极速。野马群溜达、相扑顶牛都靠它压低速度。 */
  targetSpeed: number | null = null;

  constructor(world: World, plan: BodyPlan, x: number, group: number, rng: Rng, opts: HorseOptions = {}) {
    this.world = world;
    this.plan = plan;
    this.rng = rng;
    this.stamina = plan.stamina;
    const s = (this.facing = opts.facing ?? 1);
    this.startX = x;

    // 自己的零件同属一个负组，永远互不相撞；开了 collideHorses 才和别的马撞。
    const mask = opts.collideHorses ? CATEGORY_GROUND | CATEGORY_HORSE : CATEGORY_GROUND;
    const filter = { filterGroupIndex: -group, filterCategoryBits: CATEGORY_HORSE, filterMaskBits: mask };
    const L = plan.torsoLength;
    const H = plan.torsoHeight;
    const legTop = Math.max(plan.legFront, plan.legRear);
    const torsoY = legTop + H * 0.3;
    this.restAngle = s * Math.atan2(plan.legFront - plan.legRear, L * 0.68);
    this.standHeight = (plan.legFront + plan.legRear) / 2 + H * 0.3 - 0.06;

    this.torso = world.createBody({ type: "dynamic", position: new Vec2(x, torsoY), angularDamping: 0.6 });
    this.torso.createFixture(new Box(L / 2, H / 2), { density: plan.torsoMass / (L * H), friction: BODY_FRICTION, ...filter });

    // 颈和头合成一个刚体，用一个硬马达关节连在肩上，跑起来会自然点头。
    const neckRoot = new Vec2(x + s * L * 0.4, torsoY + H * 0.3);
    this.neck = world.createBody({ type: "dynamic", position: neckRoot, angularDamping: 2 });
    const nl = plan.neckLength;
    const neckAngle = 0.95;
    const neckW = H * 0.32;
    const neckCenter = new Vec2(s * Math.cos(neckAngle) * nl * 0.5, Math.sin(neckAngle) * nl * 0.5);
    const headCenter = new Vec2(s * (Math.cos(neckAngle) * nl + plan.headLength * 0.32), Math.sin(neckAngle) * nl - plan.headLength * 0.1);
    const neckArea = nl * neckW;
    const headArea = plan.headLength * plan.headLength * 0.45;
    const density = plan.headMass / (neckArea + headArea);
    this.neck.createFixture(new Box(nl / 2, neckW / 2, neckCenter, s * neckAngle), { density, friction: BODY_FRICTION, ...filter });
    this.neck.createFixture(new Box(plan.headLength / 2, plan.headLength * 0.225, headCenter, s * -0.6), { density, friction: BODY_FRICTION, ...filter });
    this.neckJoint = world.createJoint(
      new RevoluteJoint(
        { enableMotor: true, maxMotorTorque: plan.hipTorque * 0.8, enableLimit: true, ...this.mirrorLimits(-0.35, 0.3) },
        this.torso,
        this.neck,
        neckRoot,
      ),
    ) as RevoluteJoint;

    // 对角小跑：左前 + 右后同相，右前 + 左后同相。
    const specs: Array<{ front: boolean; far: boolean; offset: number }> = [
      { front: true, far: false, offset: 0 },
      { front: false, far: true, offset: 0 },
      { front: true, far: true, offset: Math.PI },
      { front: false, far: false, offset: Math.PI },
    ];
    for (const spec of specs) {
      const len = spec.front ? plan.legFront : plan.legRear;
      const upper = len * 0.5;
      const lower = len - upper;
      const hx = x + s * (spec.front ? L * 0.34 : -L * 0.34);
      const hy = torsoY - H * 0.3;
      const w = plan.legWidth;
      const legDensity = plan.legMass / (w * len * 0.5);

      const thigh = world.createBody({ type: "dynamic", position: new Vec2(hx, hy - upper / 2), angularDamping: 0.5 });
      thigh.createFixture(new Box(w / 2, upper / 2), { density: legDensity, friction: BODY_FRICTION, ...filter });
      const shin = world.createBody({ type: "dynamic", position: new Vec2(hx, hy - upper - lower / 2), angularDamping: 0.5 });
      shin.createFixture(new Box((w * 0.7) / 2, lower / 2), { density: legDensity, friction: BODY_FRICTION, ...filter });
      shin.createFixture(new Circle(new Vec2(0, -lower / 2), plan.hoofRadius), { density: legDensity, friction: HOOF_SLIP, ...filter });

      const hip = world.createJoint(
        new RevoluteJoint(
          { enableMotor: true, maxMotorTorque: plan.hipTorque, enableLimit: true, ...this.mirrorLimits(-1.1, 1.1) },
          this.torso,
          thigh,
          new Vec2(hx, hy),
        ),
      ) as RevoluteJoint;
      const knee = world.createJoint(
        new RevoluteJoint(
          { enableMotor: true, maxMotorTorque: plan.kneeTorque, enableLimit: true, ...this.mirrorLimits(spec.front ? -1.7 : -0.15, spec.front ? 0.15 : 1.7) },
          thigh,
          shin,
          new Vec2(hx, hy - upper),
        ),
      ) as RevoluteJoint;
      this.legs.push({ thigh, shin, hip, knee, phaseOffset: spec.offset, front: spec.front, far: spec.far, upper, lower, grounded: false });
    }
  }

  get x(): number {
    return this.torso.getPosition().x;
  }

  /** 沿朝向前进了多远（米）：朝左的马往左走是正的。 */
  get progress(): number {
    return this.facing * (this.x - this.startX);
  }

  /** 镜像关节限位：角度取反，上下限对调。 */
  private mirrorLimits(lo: number, hi: number): { lowerAngle: number; upperAngle: number } {
    return this.facing > 0 ? { lowerAngle: lo, upperAngle: hi } : { lowerAngle: -hi, upperAngle: -lo };
  }

  private setLimits(joint: RevoluteJoint, lo: number, hi: number): void {
    const m = this.mirrorLimits(lo, hi);
    joint.setLimits(m.lowerAngle, m.upperAngle);
  }

  get bodies(): Body[] {
    return [this.torso, this.neck, ...this.legs.flatMap((l) => [l.thigh, l.shin])];
  }

  step(dt: number): void {
    this.time += dt;
    const p = this.plan;
    const s = this.facing;
    const angle = this.torso.getAngle();
    const tilt = Math.atan2(Math.sin(angle), Math.cos(angle));

    if (this.active) this.maxTilt = Math.max(this.maxTilt, Math.abs(tilt - this.restAngle));
    // 摔倒检测：躯干翻过 75° 持续一段时间，或者绊跤时脑袋、肚子着地，就算摔倒。
    // 摔倒的马就趴在原地，这一场不再起来。
    if (this.state === "fallen") this.downTime += dt;
    else {
      const headDown = touchingGround(this.torso) || touchingGround(this.neck);
      const down = Math.abs(tilt) > 1.3 || headDown;
      this.fallenFor = down ? this.fallenFor + dt : 0;
      if (this.fallenFor > 0.5 || (this.state === "stumbling" && headDown)) this.collapse();
    }

    // 跑得越快越容易绊跤；绊跤时身体往前一扑，平衡差的马就真的摔个嘴啃泥。
    if (this.active && this.state === "running") {
      const pace = Math.max(0, Math.min(1, (s * this.torso.getLinearVelocity().x) / p.topSpeed));
      if (this.rng.chance(p.stumblePerSecond * pace * pace * dt)) {
        this.state = "stumbling";
        this.stumbles++;
        this.stumbleLeft = 0.6 + this.rng.next() * 0.3;
        const spin = p.stumbleSpin * (0.7 + this.rng.next() * 0.6);
        this.torso.setAngularVelocity(this.torso.getAngularVelocity() - s * spin);
      }
    }
    if (this.state === "stumbling") {
      this.stumbleLeft -= dt;
      if (this.stumbleLeft <= 0) this.state = "running";
    }

    // 胆量低的马偶尔会停下来发呆。
    if (this.active && this.state === "running" && this.rng.chance(p.stallPerSecond * dt)) {
      this.state = "stalled";
      this.stalls++;
      this.stallLeft = 0.8 + this.rng.next() * 1.4;
    }
    if (this.state === "stalled") {
      this.stallLeft -= dt;
      if (this.stallLeft <= 0) this.state = "running";
    }

    const running = this.active && this.state === "running";
    const tired = this.stamina <= 0;
    const effort = running ? (tired ? 0.55 : 1) : 0;
    if (running) {
      // 步频跟着实际速度走：蹄子在地上向后扫的速度 ≈ 身体前进的速度，腿不会变成刹车。
      const vx = Math.max(0, s * this.torso.getLinearVelocity().x);
      const legAvg = (p.legFront + p.legRear) / 2;
      const cadence = Math.max(p.gaitHz * 0.7, (vx + 1.2) / (4 * p.hipAmplitude * legAvg * 0.95));
      this.phase += 2 * Math.PI * Math.min(cadence, 6) * dt;
      this.stamina = Math.max(0, this.stamina - 2.4 * p.staminaDrain * dt);
    }

    // 落脚反射：蹄子在地上会被往后拖，腿平均斜向身后，整匹马看着就往前栽。
    // 这里盯着腿的平均倾角，慢慢把落脚点往前调，让蹄子回到肩、髋的正下方。
    if (running) {
      let front = 0;
      let rear = 0;
      for (const l of this.legs) {
        const hip = l.hip.getAnchorA();
        const foot = l.shin.getWorldPoint(new Vec2(0, -l.lower / 2));
        const slant = Math.atan2(s * (foot.x - hip.x), hip.y - foot.y) / 2;
        if (l.front) front += slant;
        else rear += slant;
      }
      this.reachFront = clamp(this.reachFront + (LEG_REACH_TARGET.front - front) * LEG_REACH_GAIN * dt, -0.1, 0.5);
      this.reachRear = clamp(this.reachRear + (LEG_REACH_TARGET.rear - rear) * LEG_REACH_GAIN * dt, -0.2, 0.4);
    }

    const amp = p.hipAmplitude * effort;
    for (const leg of this.legs) {
      const ph = this.phase + leg.phaseOffset;
      // 支撑相（髋角下降）蹬地，摆动相（髋角上升）屈膝抬脚。
      const hipTarget = amp * Math.sin(ph) + (leg.front ? this.reachFront : this.reachRear) * effort;
      const lift = Math.max(0, Math.cos(ph)) * effort;
      const kneeTarget = leg.front ? -1.0 * lift : 0.9 * lift;
      leg.grounded = touchingGround(leg.shin);
      // 支撑相锁膝（马腿的「悬挂装置」）：膝盖只能伸直、不能被压弯，否则快跑时前腿会折。
      const k = leg.knee.getJointAngle();
      if (lift < 0.05 && effort > 0) {
        if (leg.front) this.setLimits(leg.knee, Math.min(-0.08, s * k), 0.15);
        else this.setLimits(leg.knee, -0.15, Math.max(0.08, s * k));
      } else if (leg.front) this.setLimits(leg.knee, -1.7, 0.15);
      else this.setLimits(leg.knee, -0.15, 1.7);
      drive(leg.hip, s * hipTarget, HIP_GAIN);
      drive(leg.knee, s * kneeTarget, KNEE_GAIN);
    }
    drive(this.neckJoint, s * (running ? 0.06 * Math.sin(this.phase * 2) : this.state === "stalled" ? -0.3 : 0), 6);

    // 着地推进：着地的蹄子越多，地面给的推力越大；推力作用在地面高度，
    // 所以腿越长、重心越高的马越容易被自己的冲劲掀得前蹄离地甚至后翻。
    if (running) {
      // 蹄子贴地或离地很近都算「能蹬到地」：真实的马腿有弹性，蹬地不只发生在接触的那一帧。
      let reach = 0;
      for (const l of this.legs) {
        const foot = l.shin.getWorldPoint(new Vec2(0, -l.lower / 2));
        const gap = foot.y - p.hoofRadius - this.groundHeight(foot.x);
        reach += l.grounded ? 1 : Math.max(0, 1 - gap / REACH);
      }
      const vx = s * this.torso.getLinearVelocity().x;
      const target = (this.targetSpeed ?? p.topSpeed) * (tired ? 0.72 : 1);
      const want = Math.max(-0.3, Math.min(1, (target - vx) / 1.5));
      const grip = Math.min(1, p.hoofFriction * this.groundFriction);
      // 腾空的瞬间不会立刻失去推力：用一个短暂的「着地记忆」平滑。
      this.contact += (Math.min(1, reach / 2) - this.contact) * Math.min(1, dt * 6);
      const force = p.totalMass * p.acceleration * want * this.contact * grip;
      if (force !== 0) {
        const at = this.torso.getWorldPoint(new Vec2(0, 0));
        this.torso.applyForce(new Vec2(s * force, 0), new Vec2(at.x, Math.max(0, at.y - p.pushHeight)), true);
      }
    }

    // 平衡反射：像骑手一样把身体往回扶，但扶不住太离谱的身体。
    const w = this.torso.getAngularVelocity();
    const k = p.balance * p.totalMass * GRAVITY * p.torsoLength * 0.55;
    const torque = Math.max(-k, Math.min(k, -((tilt - this.restAngle) * BAL_P + w * BAL_D) * k));
    if (this.state === "fallen") {
      // 趴下：栽倒后屁股慢慢落地，整匹马平趴在地上（四脚朝天的就不管了）。
      if (Math.abs(tilt) < 1.7) this.torso.applyTorque(torque * FALLEN_SETTLE, true);
    } else this.torso.applyTorque(this.state === "stumbling" ? 0 : torque, true);

    // 腿部支撑：身体被压低到站姿高度以下时，着地的腿像弹簧一样把它托回去。
    if (this.state !== "fallen" && this.contact > 0.2) {
      const pos = this.torso.getPosition();
      const stand = this.standHeight + this.groundHeight(pos.x);
      const sag = stand - pos.y;
      if (sag > 0) {
        const vy = this.torso.getLinearVelocity().y;
        const f = p.totalMass * (SUPPORT_K * sag - SUPPORT_D * Math.min(0, vy)) * this.contact;
        this.torso.applyForceToCenter(new Vec2(0, Math.min(f, p.totalMass * GRAVITY * 2.5)), true);
      }
    }
    if (running && p.wings && this.stamina > p.stamina * 0.25) {
      const pos = this.torso.getPosition();
      const speed = Math.abs(this.torso.getLinearVelocity().x);
      if (speed > 5 && Math.abs(tilt) < 0.35) {
        if (!this.lifted) {
          this.torso.applyLinearImpulse(new Vec2(0, p.totalMass * 1.2), pos, true);
          this.lifted = true;
        }
        const lift = Math.min(0.88, speed / 14) * p.totalMass * GRAVITY;
        this.torso.applyForceToCenter(new Vec2(0, lift), true);
        this.stamina = Math.max(0, this.stamina - p.staminaDrain * dt * 0.25);
        if (pos.y > this.standHeight + this.groundHeight(pos.x) + 0.15) this.flightTime += dt;
      }
    }
  }

  /** 摔倒：关节全部松劲，马就趴在地上不再起来。 */
  private collapse(): void {
    this.state = "fallen";
    this.falls++;
    for (const l of this.legs) {
      l.hip.setMaxMotorTorque(this.plan.hipTorque * FALLEN_GRIP);
      l.knee.setMaxMotorTorque(this.plan.kneeTorque * FALLEN_GRIP);
      this.setLimits(l.knee, l.front ? -1.7 : -0.15, l.front ? 0.15 : 1.7);
    }
    this.neckJoint.setMaxMotorTorque(this.plan.hipTorque * FALLEN_GRIP);
    // 倒在地上会被地面磨停，不会一路滑出去。
    for (const b of this.bodies) b.setLinearDamping(FALLEN_DRAG);
  }

  pose(): HorsePose {
    const t = this.torso.getPosition();
    const n = this.neck.getPosition();
    return {
      torso: { x: t.x, y: t.y, angle: this.torso.getAngle() },
      neck: { x: n.x, y: n.y, angle: this.neck.getAngle() },
      legs: this.legs.map((l) => {
        const hip = l.hip.getAnchorA();
        const knee = l.knee.getAnchorA();
        const foot = l.shin.getWorldPoint(new Vec2(0, -l.lower / 2));
        return { hip: { x: hip.x, y: hip.y }, knee: { x: knee.x, y: knee.y }, foot: { x: foot.x, y: foot.y }, front: l.front, far: l.far };
      }),
      stalled: this.state === "stalled",
      stumbling: this.state === "stumbling",
      fallen: this.state === "fallen",
      phase: this.phase,
      speed: this.facing * this.torso.getLinearVelocity().x,
      facing: this.facing,
    };
  }

  destroy(): void {
    for (const b of this.bodies) this.world.destroyBody(b);
  }
}

function touchingGround(body: Body): boolean {
  for (let ce = body.getContactList(); ce; ce = ce.next ?? null) {
    const c = ce.contact;
    if (!c.isTouching()) continue;
    const other = ce.other;
    if (other && other.getType() === "static") return true;
  }
  return false;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function drive(joint: RevoluteJoint, target: number, gain: number): void {
  const err = target - joint.getJointAngle();
  joint.setMotorSpeed(Math.max(-MAX_JOINT_SPEED, Math.min(MAX_JOINT_SPEED, err * gain)));
}
