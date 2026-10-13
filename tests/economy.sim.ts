import { describe, expect, it } from "vitest";
import { bodyPlanFrom } from "../src/body/bodyPlan";
import { doWork, hasWings, perform, registerRelay, relayRace, relaySeconds, relayTeams, WORK, type WorkId } from "../src/game/activities";
import { CUP_CROWD, sportOf, WEATHER_PHYSICS, weatherFor } from "../src/game/calendar";
import { DEBT_DAYS, ENTRY_FEE, EVENT_TIME, eventFor, RACE_DISTANCE } from "../src/game/season";
import { addCaught, applyOutcome, canCatch, isFoal, mate, newGame, register, sellHorse, sellPrice, sleep, throwLasso, todaysField, wildHerd, type GameState, type StableHorse } from "../src/game/state";
import { express, type Genome } from "../src/genome/genome";
import { displayStats } from "../src/genome/traits";
import { Race, trial } from "../src/sim/race";
import { createRng, hashSeed } from "../src/sim/rng";
import { SumoBout } from "../src/sim/sumo";

/** 31日经营压力检查：实际奖金、饲料、劳动、演出与三棒接力，不预演赛果下注。
 * 捕获按50%成功率简化套索操作；试跑观察用于选马；未模拟走路，不能据此断言新手难度。 */
const KEEP = 5;
const scores = new WeakMap<Genome, number>();
const raceScore = (g: Genome): number => {
  let d = scores.get(g);
  if (d === undefined) { d = trial(g, 10, 7).distance; scores.set(g, d); }
  return d;
};
function pickFor(g: GameState): StableHorse | undefined {
  return g.horses.filter(h => !isFoal(h,g.day)).sort((a,b) => {
    const score=(h:StableHorse):number => sportOf(g.day)==="sumo" ? bodyPlanFrom(express(h.genome)).totalMass * (displayStats(express(h.genome)).stability+20) : raceScore(h.genome);
    return score(b)-score(a);
  })[0];
}
function runField(g: GameState): string[] | null {
  const seed=hashSeed(`event:${g.day}:${todaysField(g).map(f=>f.id).join(",")}`);
  if(eventFor(g.day)==="relay"){
    const teams=relayTeams(g),seconds=new Map(teams.map(t=>[t.id,0]));
    for(let leg=0;leg<3;leg++)for(const r of relayRace(teams,leg,hashSeed(`relay:${g.day}`)).runToEnd())seconds.set(r.id,seconds.get(r.id)!+relaySeconds(r));
    return teams.sort((a,b)=>seconds.get(a.id)!-seconds.get(b.id)!).map(t=>t.id);
  }
  const field=todaysField(g),phys=WEATHER_PHYSICS[weatherFor(g.day)];
  if(sportOf(g.day)==="race") return new Race(field.map(f=>({...f,wings:hasWings(g.horses.find(h=>h.id===f.id)??f)})),{
    distance:RACE_DISTANCE,timeLimit:120,seed,gravity:phys.gravity,groundFriction:phys.friction,wind:phys.wind,crowd:eventFor(g.day)==="cup"?CUP_CROWD:undefined,
  }).runToEnd().sort((a,b)=>a.rank-b.rank).map(r=>r.id);
  const [a,b]=field;
  const bout=new SumoBout(a!,b!,{seed,gravity:phys.gravity,groundFriction:phys.friction});bout.runToEnd();
  return bout.winner===null?null:bout.winner===0?[a!.id,b!.id]:[b!.id,a!.id];
}
function playSeason(tag:string): { ending:string|null; ruinedDay:number|null; paid:number; milestones:string[] } {
  const g=newGame(),rng=createRng(hashSeed(tag)),milestones:string[]=[];
  for(let day=1;day<=31;day++){
    for(const id of Object.keys(WORK) as WorkId[]) if(WORK[id].day===day)doWork(g,id);
    if(g.horses.length+g.pregnancies.length<KEEP && canCatch(g).ok){
      const herd=wildHerd(g,hashSeed(tag)%3,6).sort((a,b)=>raceScore(b.genome)-raceScore(a.genome));
      throwLasso(g);if(rng.chance(0.5))addCaught(g,herd[0]!.name,herd[0]!.genome);
    }
    const adults=g.horses.filter(h=>!isFoal(h,day)).sort((a,b)=>raceScore(b.genome)-raceScore(a.genome));
    if([3,13,25].includes(day)&&adults.length>=2&&g.horses.length+g.pregnancies.length<KEEP)mate(g,adults[0]!.id,adults[1]!.id);
    if(day>10&&g.horses.length>=KEEP){
      const cheap=[...g.horses].sort((a,b)=>sellPrice(g,a)-sellPrice(g,b))[0]!;
      if(raceScore(cheap.genome)<raceScore(pickFor(g)!.genome)*0.6)sellHorse(g,cheap.id);
    }
    const mine=pickFor(g);
    if(mine&&g.money>=ENTRY_FEE){
      if(day===28&&adults.length>=3)registerRelay(g,adults.slice(0,3).map(h=>h.id) as [string,string,string]);
      else if(day!==28)register(g,mine.id);
    }
    g.clock=EVENT_TIME;g.flags[`ev:${day}`]=true;
    applyOutcome(g,eventFor(day),runField(g));
    if(day>=8&&mine){perform(g,mine.id,"haul");perform(g,mine.id,"balance");}
    const night=sleep(g);
    if(DEBT_DAYS.some(d=>d===day)||night.grace||night.debtPaid||night.ruined)milestones.push(`${day}日 还${night.debtPaid} 剩${g.money}${night.grace?" 宽限":""}`);
    if(night.ruined)return {ending:g.ending,ruinedDay:day,paid:g.debtsPaid,milestones};
  }
  return {ending:g.ending,ruinedDay:null,paid:g.debtsPaid,milestones};
}
describe("31日经济压力检查",()=>{
  it("两个不借款、不预判下注的经营存档走完结算",()=>{
    const realNow=Date.now;
    // 直接替换，避免spy记录物理引擎每步的性能计时调用而积累内存。
    Date.now=()=>1791849600000;
    try {
      const results=["a","b"].map(tag=>({tag,...playSeason(tag)}));
      for(const r of results){
        console.log(`存档${r.tag} ${r.ending} ${r.milestones.join("；")}`);
        expect(r.ending).toMatch(/tianma|kept|mascot/);
        expect(r.ruinedDay===null||r.ruinedDay>7).toBe(true);
      }
      expect(results.some(r=>r.paid===4),"至少一条经营路径还清四笔").toBe(true);
    } finally { Date.now=realNow; }
  });
});
