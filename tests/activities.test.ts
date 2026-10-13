import { describe, expect, it } from "vitest";
import { bodyPlanFrom } from "../src/body/bodyPlan";
import { completePerformance, doWork, editGene, hasWings, mountainSample, perform, prepareChimera, registerRelay, relaySeconds, resumePerformance, startPerformance } from "../src/game/activities";
import { DEBT_DAYS, EVENT_TIME, TIME_COST } from "../src/game/season";
import { addCaught, applyOutcome, deserialize, isFoal, mate, newGame, register, sellHorse, serialize, sleep, todaysField } from "../src/game/state";
import { express, makeGenome } from "../src/genome/genome";
import { Race, type RaceResult } from "../src/sim/race";
import { type Terrain } from "../src/sim/terrain";

describe("经营动作和重入",()=>{
  it("劳务成功才扣时间并支付一次工钱",()=>{
    const g=newGame();const before=serialize(g);
    expect(doWork(g,"fence").ok).toBe(false);expect(serialize(g)).toBe(before);
    g.day=4;const money=g.money,clock=g.clock;
    expect(doWork(g,"fence").ok).toBe(true);expect(g.money).toBe(money+100);expect(g.clock-clock).toBe(30);
    const paid=serialize(g);expect(doWork(g,"fence").ok).toBe(false);expect(serialize(g)).toBe(paid);
  });
  it("演出用真实模拟结果结算，读档不多扣90分钟，也不重复发钱",()=>{
    const g=newGame();g.day=8;
    const start=startPerformance(g,g.horses[0]!.id,"haul");expect(start.ok).toBe(true);
    const clock=g.clock;const restored=deserialize(serialize(g))!;
    const pendingSave=serialize(restored);expect(()=>sleep(restored)).toThrow("先完成");expect(serialize(restored)).toBe(pendingSave);
    expect(sellHorse(restored,restored.horses[0]!.id).ok).toBe(false);
    const race=resumePerformance(restored)!;expect(restored.clock).toBe(clock);
    expect(race.runToEnd()).toEqual(start.race!.runToEnd());
    const result=completePerformance(restored,race)!;expect(result.pay).toBeGreaterThan(0);
    const money=restored.money;expect(completePerformance(restored,race)).toBeNull();expect(restored.money).toBe(money);
    expect(restored.clock).toBe(clock);
  });
  it("每天两场；失败动作不扣时间、不改随机计数",()=>{
    const g=newGame();g.day=8;
    perform(g,g.horses[0]!.id,"haul");perform(g,g.horses[1]!.id,"balance");
    const before=serialize(g);expect(perform(g,g.horses[0]!.id,"jump").ok).toBe(false);expect(serialize(g)).toBe(before);
  });
});
describe("育种和编辑",()=>{
  it("只改选定的一条链，边界或待产亲本不能改变",()=>{
    const g=newGame();g.day=18;g.money=10000;const h=g.horses[0]!;h.sequenced=true;
    const original=structuredClone(h.genome),clock=g.clock;
    expect(editGene(g,h.id,"power",0,1).ok).toBe(true);
    expect(h.genome.power).toEqual([2,original.power[1]]);
    expect(h.genome.legF).toEqual(original.legF);expect(h.id).toBe(g.horses[0]!.id);expect(g.clock-clock).toBe(60);
    const after=serialize(g);expect(editGene(g,h.id,"power",0,1).ok).toBe(false);expect(serialize(g)).toBe(after);
    g.day=19;mate(g,h.id,g.horses[1]!.id);expect(editGene(g,h.id,"con",0,1).ok).toBe(false);
  });
  it("25日准备、26日出生、28日成年；亲本快照保存且羽翼不强制表现",()=>{
    const g=newGame();g.day=25;g.flags["mountain:sample"]=true;
    g.horses.forEach(h=>h.genome=makeGenome({compat:[-2,-2]}));
    expect(prepareChimera(g,g.horses[0]!.id,g.horses[1]!.id).ok).toBe(true);
    expect(g.clock).toBe(360+TIME_COST.mate+TIME_COST.chimera);
    expect(g.pregnancies[0]!.snapshots).toBeDefined();
    const restored=deserialize(serialize(g))!;const foal=sleep(restored).foals[0]!;
    expect(foal.bornDay).toBe(26);expect(foal.wingGenes).toContain(1);expect(hasWings(foal)).toBe(false);
    expect(isFoal(foal,27)).toBe(true);expect(isFoal(foal,28)).toBe(false);
    expect(foal.parentIds).toEqual(g.horses.map(h=>h.id));
  });
  it("马厩满了仍可拾羽毛，不必为主线抓稀有马",()=>{
    const g=newGame();g.day=23;
    while(g.horses.length<12)addCaught(g,"已有马",makeGenome({}));
    const count=g.horses.length;expect(mountainSample(g,false).ok).toBe(true);
    expect(g.horses).toHaveLength(count);expect(g.flags["mountain:sample"]).toBe(true);
  });
  it("羽翼占代谢预算；相容度不足只携带材料",()=>{
    const p=express(makeGenome({size:[2,2],power:[2,2],stride:[2,2]}));
    const normal=bodyPlanFrom(p),winged=bodyPlanFrom(p,true);
    expect(winged.budgetOver-normal.budgetOver).toBe(18);expect(winged.stamina).toBeLessThanOrEqual(normal.stamina);
  });
});
describe("赛历、接力和最后还款",()=>{
  it("接力需三匹不同成年马，报名后不能卖队员",()=>{
    const g=newGame();g.day=28;g.money=1000;
    const h=addCaught(g,"第三匹",makeGenome({}));
    const ids:[string,string,string]=[g.horses[0]!.id,g.horses[1]!.id,h.id];
    const before=serialize(g);expect(registerRelay(g,[ids[0],ids[0],ids[2]]).ok).toBe(false);expect(serialize(g)).toBe(before);
    expect(register(g,ids[0]).ok).toBe(false);expect(serialize(g)).toBe(before);
    expect(registerRelay(g,ids).ok).toBe(true);expect(sellHorse(g,ids[2]).ok).toBe(false);
    expect(g.entry?.team).toEqual(ids);
  });
  it("提前摔倒不会被当成最快完成路段",()=>{
    const base={id:"x",name:"x",rank:1,distance:80,time:12,falls:0,stalls:0,stumbles:0,flightTime:0} satisfies RaceResult;
    expect(relaySeconds({...base,time:null,distance:8,falls:1})).toBeGreaterThan(relaySeconds(base));
  });
  it("普通比赛重复回调不重复发钱或战绩",()=>{
    const g=newGame();register(g,g.horses[0]!.id);const order=todaysField(g).map(f=>f.id);
    applyOutcome(g,"race",order);const before=serialize(g);applyOutcome(g,"race",order);expect(serialize(g)).toBe(before);
  });
  it("16:51开始报名来不及，钱和报名记录不变",()=>{
    const g=newGame();g.clock=EVENT_TIME-9;const before=serialize(g);
    expect(register(g,g.horses[0]!.id).ok).toBe(false);expect(serialize(g)).toBe(before);
  });
  it("28日不收最后一笔，31日饲料先扣且不再宽限",()=>{
    expect(DEBT_DAYS).toEqual([7,14,21,31]);
    const g=newGame();g.day=28;g.debtsPaid=3;g.money=30000;
    expect(sleep(g).debtPaid).toBe(0);
    g.day=31;g.money=30000;const report=sleep(g);
    expect(report.grace).toBeNull();expect(report.ruined).toBe(true);expect(g.graceUsed).toBe(false);
  });
  it("结局后不再收债，32日仍可经营",()=>{
    const g=newGame();g.day=31;g.debtsPaid=3;g.money=40000;sleep(g);expect(g.ending).toBe("kept");
    const report=sleep(g);expect(report.debtPaid).toBe(0);expect(g.day).toBe(33);expect(g.over).toBe(false);
  });
});
describe("六种地貌的物理",()=>{
  it("同种子可复现且均有限，地貌会改变实际结果",()=>{
    const genome=makeGenome({courage:[2,2],con:[2,2]});
    const outcomes:number[]=[];
    for(const terrain of ["grass","wetland","hill","coast","forest","mountain"] as Terrain[]){
      const options={distance:40,timeLimit:8,seed:91,terrains:[terrain]};
      const first=new Race([{id:"h",name:"h",genome}],options).runToEnd();
      const second=new Race([{id:"h",name:"h",genome}],options).runToEnd();
      expect(second).toEqual(first);expect(Number.isFinite(first[0]!.distance)).toBe(true);outcomes.push(first[0]!.distance);
    }
    expect(new Set(outcomes).size).toBeGreaterThan(2);
  });
});
