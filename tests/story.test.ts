import { describe, expect, it } from "vitest";
import { doWork, editGene, mountainSample, prepareChimera, registerRelay } from "../src/game/activities";
import { eventFor } from "../src/game/season";
import { applyOutcome, deserialize, isFoal, mate, newGame, register, sendToSequencing, serialize, sleep, throwLasso, todaysField } from "../src/game/state";
import { answerOffer, mailContent, nightReward, offerPending, plaque, QUESTS, queueEnding, readMail, storyEvent } from "../src/game/story";

describe("31天剧情", () => {
  it("信、借据和第一次落空的套索按玩家动作推进", () => {
    const g=newGame();
    expect(plaque(g)?.at).toBe("mail");
    expect(readMail(g)[0]?.title).toBe("外婆的信");
    storyEvent(g,{t:"interact",id:"mail"});
    storyEvent(g,{t:"near",id:"barn"});
    const loan=storyEvent(g,{t:"detail",horseId:g.horses[0]!.id}).lines.map(l=>l.text).join("");
    expect(loan).toContain("第三十一天");
    expect(loan).toContain("最后一笔不能延期");
    expect(throwLasso(g).ok).toBe(true);
    storyEvent(g,{t:"lasso"});
    expect(g.story.played["d1-lasso"]).toBe(true);
    expect(g.horses).toHaveLength(2);
  });
  it("第一周仍只讲外形和经营，没有提前显示基因教学",()=>{
    const g=newGame();
    for(const scene of QUESTS.filter(q=>q.day<10)){
      g.day=scene.day;
      for(const line of scene.lines(g,{t:"outcome",kind:eventFor(g.day),rank:2}))expect(line.text).not.toMatch(/基因|测序|相容度/);
    }
  });
  it("败、胜和旁观三种真实结果使用不同对白",()=>{
    const text=(rank:number|null)=>{
      const g=newGame();g.day=14;
      return storyEvent(g,{t:"outcome",kind:"boss",rank}).lines.map(l=>l.text).join("");
    };
    expect(text(1)).toContain("你的马先过线");
    expect(text(2)).toContain("豆包先到终点");
    expect(text(null)).toContain("没有自己的参赛成绩");
    expect(text(2)).not.toContain("你的马先过线");
  });
  it("重复交互不重播，未读对白和回看记录可恢复",()=>{
    const g=newGame();g.day=17;
    const first=storyEvent(g,{t:"interact",id:"sequence"});
    expect(first.lines.length).toBeGreaterThan(8);
    expect(storyEvent(g,{t:"interact",id:"sequence"}).lines).toEqual([]);
    const restored=deserialize(serialize(g))!;
    expect(restored.story.pending).toEqual(g.story.pending);
    expect(restored.story.history).toEqual(g.story.history);
    expect(storyEvent(restored,{t:"interact",id:"sequence"}).lines).toEqual([]);
    expect(restored.story.pending[0]?.sceneDay).toBe(17);
  });
  it("选择暂缓育种、测序、编辑后不再催做替代动作",()=>{
    for(const [day,id,value,blocked] of [[3,"breed","wait","d3-mate"],[5,"bet","no","d5-bet"],[10,"sequence","wait","d10-sample"],[18,"edit","no","d18-edit"],[25,"breed","wait","d25-chimera"],[27,"wanbi","watch","d27-help"]] as const){
      const g=newGame();g.day=day;
      for(const q of QUESTS.filter(q=>q.day===day&&!q.id.endsWith("-"+blocked.split("-")[1]))) if(q.check({t:"interact",id:q.at??""},g)) storyEvent(g,{t:"interact",id:q.at??""});
      storyEvent(g,{t:"choice",id,value});
      expect(g.story.quest).not.toBe(blocked);
    }
  });
  it("结局正文可恢复且只入列一次",()=>{
    const g=newGame();g.day=32;g.ending="kept";
    queueEnding(g,"kept");const count=g.story.pending.length;
    expect(count).toBeGreaterThan(8);
    g.story.pending.shift();const restored=deserialize(serialize(g))!;
    queueEnding(restored,"kept");expect(restored.story.pending).toHaveLength(count-1);
    expect(restored.story.history.filter(h=>h.id==="ending:kept")).toHaveLength(1);
  });
  it("晚拿报告仍能找回日记，不能错过一日就丢关键纸页",()=>{
    const g=newGame();g.day=24;g.debtsPaid=3;
    storyEvent(g,{t:"interact",id:"sequence"});
    storyEvent(g,{t:"interact",id:"barn"});
    storyEvent(g,{t:"interact",id:"laozhao"});
    storyEvent(g,{t:"interact",id:"coast"});
    expect(g.story.diary).toEqual(expect.arrayContaining([1,2,3,4,5,6,7]));
  });
  it("读过日报不重送，22日和28日报纸写正确的赛事",()=>{
    const g=newGame();g.day=8;
    storyEvent(g,{t:"morning"});readMail(g);storyEvent(g,{t:"morning"});
    expect(g.story.inbox).toEqual([]);
    expect(mailContent("paper:22").lines.join("")).toContain("第三十一天");
    expect(mailContent("paper:28").lines.join("")).toContain("接力");
  });
  it("三十日签字只支付一次收购款；其他日期不能签",()=>{
    const g=newGame();g.day=29;
    const money=g.money;
    expect(answerOffer(g,true)).toEqual([]);
    expect(g.money).toBe(money);
    g.day=30;expect(offerPending(g)).toBe(true);
    answerOffer(g,true);answerOffer(g,true);
    expect(g.money).toBe(money+30000);
    expect(g.ending).toBe("mascot");
    expect(g.debtsPaid).toBe(4);
    expect(g.ledger.filter(l=>l.label==="牧场收购款")).toHaveLength(1);
  });
  it("配种、普通马与一次落败均不阻塞31天主线",()=>{
    const g=newGame();g.money=1_000_000;
    for(let day=1;day<=31;day++){
      expect(g.day).toBe(day);
      storyEvent(g,{t:"morning"});
      if(day===1){readMail(g);storyEvent(g,{t:"interact",id:"mail"});storyEvent(g,{t:"detail",horseId:g.horses[0]!.id});}
      if(day===3){expect(mate(g,g.horses[0]!.id,g.horses[1]!.id).ok).toBe(true);storyEvent(g,{t:"mate"});}
      if(day===4){expect(g.horses.at(-1)?.bornDay).toBe(4);doWork(g,"fence");storyEvent(g,{t:"work",id:"fence"});}
      if(day===6){expect(isFoal(g.horses.at(-1)!,day)).toBe(false);storyEvent(g,{t:"interact",id:"laozhao"});}
      if(day===10){sendToSequencing(g,g.horses[0]!.id);storyEvent(g,{t:"sequence"});}
      if([11,17,19,24].includes(day))storyEvent(g,{t:"interact",id:"sequence"});
      if(day===15){doWork(g,"levee");storyEvent(g,{t:"work",id:"levee"});}
      if(day===19)storyEvent(g,{t:"interact",id:"laozhao"});
      if(day===18){expect(editGene(g,g.horses[0]!.id,"power",0,1).ok).toBe(true);storyEvent(g,{t:"edit"});}
      if(day===22)storyEvent(g,{t:"interact",id:"barn"});
      if(day===23){expect(mountainSample(g,false).ok).toBe(true);storyEvent(g,{t:"sample",caught:false});}
      if(day===25){expect(prepareChimera(g,g.horses[0]!.id,g.horses[1]!.id).ok).toBe(true);storyEvent(g,{t:"chimera"});}
      if(day===28){expect(g.horses.at(-1)?.bornDay).toBe(26);expect(isFoal(g.horses.at(-1)!,day)).toBe(false);expect(registerRelay(g,g.horses.slice(0,3).map(h=>h.id) as [string,string,string]).ok).toBe(true);}
      if(day===30)answerOffer(g,false);
      if(day===31){expect(register(g,g.horses[0]!.id).ok).toBe(true);const field=todaysField(g);const order=field.slice(1).map(h=>h.id).concat(field[0]!.id);const result=applyOutcome(g,"cup",order);expect(result.myRank).toBe(8);storyEvent(g,{t:"outcome",kind:"cup",rank:result.myRank,stalls:0});}
      storyEvent(g,{t:"sleep"});const report=sleep(g);nightReward(g,report);
      expect(report.ruined,`第${day}天`).toBe(false);
      if(day===28)expect(report.debtPaid).toBe(0);
    }
    expect(g.ending).toBe("kept");expect(g.day).toBe(32);
    expect(g.story.diary).toEqual(expect.arrayContaining([1,2,3,4,5,6,7]));
    expect(storyEvent(g,{t:"morning"}).lines).toEqual([]);
  });
});
