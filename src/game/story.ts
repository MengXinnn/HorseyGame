/** 用户润色正文为内容源，成功动作与实际赛果决定场景。 */
import script from "./script.json";
import { SPEAKERS } from "./speakers";
import { WEATHER_HINTS, WEATHER_LABELS, weatherFor } from "./calendar";
import { EVENT_LABELS, eventFor, type EventKind } from "./season";
import { findHorse, grant, type GameState, type NightReport } from "./state";

export interface Line { who: string; text: string; actor?: string; sceneDay?: number; sceneTitle?: string }
export type StoryEvent =
  | { t: "interact" | "near"; id: string }
  | { t: "catch" | "lasso" | "mate" | "register" | "sequence" | "bet" | "sell" | "sleep" | "morning" }
  | { t: "detail"; horseId: string }
  | { t: "trial"; horseId?: string; flew?: boolean }
  | { t: "outcome"; kind: EventKind; rank: number | null; stalls?: number; flew?: boolean }
  | { t: "work"; id: string }
  | { t: "circus"; success: boolean }
  | { t: "terrain"; id: string }
  | { t: "edit" | "chimera" | "practice" }
  | { t: "sample"; caught: boolean }
  | { t: "choice"; id: string; value: string };
export type Spot = "mail" | "sleep" | "barn" | "sequence" | "market" | "bookie" | "sumo" | "race" | "laozhao" | "wilds" | "circus" | "wetland" | "hill" | "coast" | "forest" | "mountain";
export const YOU = "你";
export const DIARY_WHO = "外婆的日记";
export const IOU_WHO = "借据";
export type SlidePic = "office" | "summer" | "photo" | "phone";
export interface Slide { pic: SlidePic; text: string }
export const FLASHBACK: Slide[] = [
  { pic: "office", text: "来城里的第五年，你又在改那份已经改过五遍的表格。" },
  { pic: "summer", text: "小时候，每个暑假你都在外婆的牧场。" },
  { pic: "photo", text: "镇上说她养过一匹会飞的马，叫踏云。" },
  { pic: "phone", text: "手机亮了。老赵。" },
];
const clean = (text: string): string => text
  .replace(/^\*\*[^*]+：\*\*/, "")
  .replace(/(?:当天交接，|当天交接后，)?接“[^”]+”结局[。]?/g, "")
  .replace(/^### .*/, "").trim();
const paragraphs = (day: number, indices: number[]): Line[] => indices.flatMap((i) => {
  const text = clean(script[day - 1]?.paragraphs[i] ?? "");
  const actor=SPEAKERS[day]?.[i];
  const quote=/^“([^“”]+)”$/.exec(text);
  return text ? [{ who: quote&&actor?actor:"", text:quote&&actor?quote[1]!:text, actor }] : [];
});
const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);
const P = (day: number, a: number, b = a + 1): Line[] => paragraphs(day, range(a, b));
export const PICKUP: Line[] = [{ who: "老赵", text: "你外婆昨天夜里走了。你回来一趟吧。" }, ...P(1, 2, 5)];
export const DIARY: Record<number, string> = {
  1: clean(script[2]!.paragraphs[1]!), 2: clean(script[5]!.paragraphs[5]!),
  3: clean(script[10]!.paragraphs[9]!), 4: clean(script[14]!.paragraphs[5]!),
  5: clean(script[18]!.paragraphs[2]!), 6: clean(script[20]!.paragraphs[9]!),
  7: clean(script[21]!.paragraphs[1]!),
};
export interface Mail { from: string; title: string; lines: string[]; seal?: string }
const HEADLINES: Record<number, string> = {
  8: "马戏团进镇，广场搭起红帐篷", 10: "测序所重新开张，首测一百元",
  14: "豆包参加平地擂台赛", 17: "K先生到镇，寻找真实地面记录",
  19: "大风预警", 20: "完璧公开试跑", 21: "样本七号今晚参赛",
  22: "第二十八天六地貌接力，第三十一天天马杯", 28: "六地貌接力今晚开赛",
  30: "天马杯明日开赛", 31: "天马杯今日决赛：四百米，看台满座",
};
export function mailContent(id: string): Mail {
  if (id === "waipo") return { from: "云姑", title: "外婆的信", lines: P(1, 6).map(l => l.text), seal: "云" };
  if (id === "zhao") return { from: "老赵", title: "铁墩的战书", lines: ["明日，铁墩守擂。", "别迟到。"], seal: "赵" };
  if (id === "kdr") return { from: "K先生", title: "旧规划图", lines: ["找到了云姑当年的记录。来所里看看。"], seal: "K" };
  if (id.startsWith("paper:")) {
    const day = Number(id.slice(6));
    if (!Number.isInteger(day) || day < 1) return { from: "", title: "", lines: [] };
    const weather = weatherFor(day);
    return { from: "阿桃", title: `马蹄镇日报　第${Math.max(1, day - 7)}期`, seal: "桃", lines: [
      HEADLINES[day] ?? `今日${EVENT_LABELS[eventFor(day)]}，下午五点`,
      `天气：${WEATHER_LABELS[weather]} ${WEATHER_HINTS[weather]}`.trim(),
    ] };
  }
  return { from: "", title: "", lines: [] };
}
function deliverMail(s: GameState): void {
  const post = (id: string): void => { if (!s.story.read.includes(id) && !s.story.inbox.includes(id)) s.story.inbox.push(id); };
  if (s.day === 6) post("zhao");
  if (s.day === 19) post("kdr");
  if (s.day >= 8) post(`paper:${s.day}`);
}
export function readMail(s: GameState): Mail[] {
  const ids = s.story.inbox.splice(0);
  for (const id of ids) if (!s.story.read.includes(id)) s.story.read.push(id);
  return ids.map(mailContent);
}
export interface Quest {
  id: string; day: number; text: string; at?: Spot; diary?: number;
  check(e: StoryEvent, s: GameState): boolean;
  lines(s: GameState, e: StoryEvent): Line[];
}
const at = (id: string) => (e: StoryEvent): boolean => e.t === "interact" && e.id === id;
const is = (t: StoryEvent["t"]) => (e: StoryEvent): boolean => e.t === t;
const won = (e: StoryEvent): boolean => e.t === "outcome" && e.rank === 1;
const branch = (day: number, win: number, lose: number) => (_s: GameState, e: StoryEvent): Line[] =>
  e.t === "outcome" && e.rank === null ? [{ who: "", text: "你在场边看完这一轮，把真实结果记下来。今天没有自己的参赛成绩。" }] : P(day, won(e) ? win : lose);
const q = (day: number, key: string, text: string, spot: Spot | undefined, check: Quest["check"], a: number, b = a + 1, diary?: number): Quest =>
  ({ id: `d${day}-${key}`, day, text, at: spot, check, lines: () => P(day, a, b), diary });
const opening = (day: number, a: number, b: number): Quest => q(day, "morning", "清晨", undefined, is("morning"), a, b);
export const QUESTS: Quest[] = [
  q(1,"letter","打开信箱","mail",(e,s)=>at("mail")(e)&&s.story.read.includes("waipo"),5,7),
  q(1,"barn","去马厩看马","barn",(e,s)=>(e.t==="detail"||e.t==="near"&&e.id==="barn")&&!!s.story.played["d1-letter"],7,10),
  {...q(1,"iou","查看一匹马","barn",(e,s)=>e.t==="detail"&&!!s.story.played["d1-barn"],10,18),lines:()=>[
    ...P(1,10),{who:IOU_WHO,text:"六万元。7日2000、14日8000、21日20000、31日30000。前三笔仅一次三日宽限，加20%；最后一笔不延期。"},...P(1,11,18),
  ]},
  q(1,"lasso","去野原试一次套索","wilds",is("lasso"),18,20),q(1,"night","回家休息","sleep",is("sleep"),20,23),
  opening(2,0,4),q(2,"register","选一匹成年马报名","sumo",is("register"),4,11),
  {...q(2,"result","看完第一场相扑","sumo",is("outcome"),11),lines:branch(2,11,12)},q(2,"night","看看今天的账","sleep",is("sleep"),13,16),
  {...opening(3,0,6),diary:1},q(3,"mate","配种，或选择再等等","barn",is("mate"),6,9),
  q(3,"wait","再等等","barn",e=>e.t==="choice"&&e.id==="breed"&&e.value==="wait",12),q(3,"night","听听孩子的问题","sleep",is("sleep"),9,12),
  {...opening(4,1,7),lines:s=>[...(s.horses.some(h=>h.bornDay===4)?[]:P(4,0)),...P(4,1,7)]},
  q(4,"work","帮阿桃修围栏","race",e=>e.t==="work"&&e.id==="fence",7,10),q(4,"night","记下今天","sleep",is("sleep"),10),
  q(5,"bookie","去见钱四","bookie",at("bookie"),0,2),
  {...q(5,"trial","试跑后再看赔率","race",is("trial"),2,7),lines:()=>[{who:"",text:"你记下实际距离、停顿和摔倒，与已有的试跑记录放在一起。"},...P(5,3,7)]},
  q(5,"bet","自己决定下注","bookie",is("bet"),7),q(5,"no-bet","留着草料钱","bookie",e=>e.t==="choice"&&e.id==="bet"&&e.value==="no",8),
  q(5,"result","把结果记进账本","race",is("outcome"),9,12),
  opening(6,0,1),q(6,"zhao","看看铁墩，找老赵","laozhao",at("laozhao"),1,10,2),q(6,"work","帮老赵搭台","laozhao",e=>e.t==="work"&&e.id==="ring",10,13),
  opening(7,0,4),{...q(7,"result","挑战铁墩","sumo",is("outcome"),4),lines:branch(7,4,5)},
  q(8,"circus","去红帐篷见米娅","circus",at("circus"),0,10),q(8,"work","帮米娅搭帐篷","circus",e=>e.t==="work"&&e.id==="tent",10,14),
  q(9,"show","选一个演出项目","circus",at("circus"),0,10),
  {...q(9,"result","试一场演出","circus",is("circus"),10),lines:(_s,e)=>P(9,e.t==="circus"&&e.success?10:11)},q(9,"night","回去看马","sleep",is("sleep"),12,14),
  q(10,"lab","去重新开门的测序所","sequence",at("sequence"),0,6),q(10,"sample","送测一匹马，或暂缓","sequence",is("sequence"),6),
  q(10,"wait","暂缓测序","sequence",e=>e.t==="choice"&&e.id==="sequence"&&e.value==="wait",7),
  {...q(11,"report","看报告和踏云档案","sequence",at("sequence"),0,16,3),lines:s=>[...P(11,0,7),...(!s.horses.some(h=>h.sequenced)?P(11,7):[]),...P(11,8,16)]},
  q(12,"wetland","去湿地见孙婶","wetland",e=>e.t==="terrain"&&e.id==="wetland",0,8),q(12,"hill","看看丘陵上的步子","hill",e=>e.t==="terrain"&&e.id==="hill",8,11),
  q(13,"circus","再去看看米娅","circus",at("circus"),0,5),q(13,"show","按观察挑一个节目","circus",is("circus"),5,13),q(13,"mate","试一组新的亲本","barn",is("mate"),13,15),
  opening(14,0,2),{...q(14,"result","与豆包跑一场","race",is("outcome"),3),lines:branch(14,3,4)},
  q(15,"coast","去海边帮老舟修堤","coast",e=>e.t==="work"&&e.id==="levee",0,12,4),
  q(16,"plan","在林谷讨论接力","forest",at("forest"),0,5),q(16,"practice","试一次接力交接","forest",is("practice"),5,10),
  q(17,"k","去见K先生","sequence",at("sequence"),0,15),q(18,"plan","看一次编辑方案","sequence",at("sequence"),0,4),
  q(18,"edit","决定是否编辑一处","sequence",is("edit"),4),q(18,"keep","先看现有能力","sequence",e=>e.t==="choice"&&e.id==="edit"&&e.value==="no",5),q(18,"ma","带马回去","sleep",is("sleep"),6,12),
  q(19,"map","看旧规划图","sequence",at("sequence"),0,5,5),q(19,"past","去问老赵当年的事","laozhao",at("laozhao"),5,16),
  q(20,"demo","看完璧的展示","race",at("race"),0,14),q(20,"k","听K介绍样本七号","sequence",at("sequence"),14,20),
  opening(21,0,5),{...q(21,"result","与样本七号比赛","race",is("outcome"),5),lines:branch(21,5,6)},
  q(22,"legacy","查看踏云的旧缰绳","barn",at("barn"),0,11,7),q(22,"grave","去和外婆说说话","sleep",is("sleep"),11,15),
  q(23,"mountain","去雪山看日出","mountain",at("mountain"),0,5),
  {...q(23,"sample","带回一匹马，或拾一根羽毛","mountain",is("sample"),5),lines:(_s,e)=>[...P(23,e.t==="sample"&&e.caught?5:6),...P(23,7,10)]},
  q(24,"lab","把山里的材料带去测序所","sequence",at("sequence"),0,11),
  q(25,"plan","看看育种方案","barn",at("barn"),0,4),q(25,"chimera","尝试背部嵌合","barn",is("chimera"),4),q(25,"plain","选择普通育种","barn",is("mate"),5),
  q(25,"wait","安排好现有的马","barn",e=>e.t==="choice"&&e.id==="breed"&&e.value==="wait",6),q(25,"night","修好马具","sleep",is("sleep"),7,10),
  {...opening(26,0,1),lines:s=>{const h=s.horses.find(h=>h.bornDay===26);return h?[...P(26,0),...P(26,s.flags[`wings:${h.id}`]?1:s.flags[`chimera:${h.id}`]?3:2),...P(26,4)]:P(26,5);}},
  q(27,"demo","去满座看台看看完璧","race",at("race"),0),q(27,"help","帮完璧看清场边","race",e=>e.t==="choice"&&e.id==="wanbi"&&e.value==="help",1),q(27,"watch","记录这一次结果","race",e=>e.t==="choice"&&e.id==="wanbi"&&e.value==="watch",2),
  {...q(27,"home","回牧场看看自己的马","sleep",is("sleep"),3,9),lines:s=>s.horses.some(h=>h.bornDay===26)?P(27,3,9):P(27,9)},
  {...q(28,"trial","给成年马试跑","race",is("trial"),3),lines:(s,e)=>P(28,e.t==="trial"&&e.flew?1:s.flags[`wings:${e.t==="trial"?e.horseId:""}`]?2:3)},q(28,"relay","参加六地貌接力","race",is("register"),4),
  {...q(28,"result","看完接力结果","race",is("outcome"),5),lines:(s,e)=>[...branch(28,5,6)(s,e),...P(28,7)]},
  q(29,"candidate","与阿桃、K选一匹候选马","race",at("race"),0,13),q(29,"night","留下候选名字","sleep",is("sleep"),13,16),
  opening(30,0,2),opening(31,1,2),q(31,"register","为天马杯报名","race",is("register"),2,5),q(31,"start","走到杯赛起点","race",e=>e.t==="choice"&&e.id==="cup-start",6,11),
  {...q(31,"result","看完天马杯","race",is("outcome"),17),lines:(s,e)=>e.t!=="outcome"?[]:[...P(31,e.stalls?11:12),...P(31,13),...P(31,e.flew?14:15),...branch(31,17,18)(s,e),...P(31,19,22)]},
];

export interface StoryResult { lines: Line[]; diary: number[] }
function remember(s: GameState, id: string, day: number, lines: Line[]): void {
  if (!lines.length) return;
  const title = script[day - 1]?.title ?? "夜里";
  for (const line of lines) Object.assign(line, { sceneDay: day, sceneTitle: title });
  s.story.history.push({ id, day, title, lines });
  s.story.pending.push(...lines);
}
export function storyEvent(s: GameState, e: StoryEvent): StoryResult {
  const out: StoryResult = { lines: [], diary: [] };
  if (s.ending) return out;
  if (e.t === "morning") deliverMail(s);
  if (e.t === "choice") { s.story.choices[e.id] = e.value; s.story.choices[`${s.day}:${e.id}`] = e.value; }
  if(e.t==="trial"&&e.horseId)s.story.choices.horse=e.horseId;
  if(e.t==="register"&&s.entry)s.story.choices.horse=s.entry.horseId;
  if (e.t === "mate" || e.t === "chimera") s.flags[`mated:${s.day}`] = true;
  for (const scene of QUESTS) {
    if (scene.day !== s.day || s.story.played[scene.id] || !scene.check(e, s)) continue;
    s.story.played[scene.id] = true;
    let lines = scene.lines(s, e);
    if (scene.id === "d1-iou") s.flags["met:madong"] = true;
    if (scene.id === "d27-help") s.flags["wanbi:helped"] = true;
    const child = s.horses.find(h => h.bornDay === 4);
    if (child) lines = lines.map(l => ({ ...l, text: l.text.replaceAll("小板凳", child.name) }));
    if (scene.day === 2 && e.t === "register") {
      const horse = s.entry ? findHorse(s, s.entry.horseId) : undefined;
      if (horse) lines = lines.map(l => ({ ...l, text: l.text.replaceAll("磐石", horse.name) }));
    }
    if (scene.diary && !s.story.diary.includes(scene.diary)) {
      s.story.diary.push(scene.diary);
      out.diary.push(scene.diary);
    }
    remember(s, scene.id, s.day, lines);
    out.lines.push(...lines);
  }
  if(e.t==="interact"){
    const recover:Array<[Spot,number,number]>=[["barn",3,1],["laozhao",6,2],["sequence",11,3],["coast",15,4],["sequence",19,5],["barn",22,7]];
    if(s.debtsPaid>=3)recover.push(["sequence",21,6]);
    for(const [spot,day,page] of recover){
      if(e.id!==spot||s.day<day||s.story.diary.includes(page))continue;
      s.story.diary.push(page);out.diary.push(page);
      const lines=[{who:DIARY_WHO,text:DIARY[page]!}];
      remember(s,"diary:"+page,s.day,lines);out.lines.push(...lines);
    }
  }
  if(e.t==="sleep"&&s.day<=7&&!s.flags["met:madong"]){
    s.flags["met:madong"]=true;
    const lines=QUESTS.find(q=>q.id==="d1-iou")!.lines(s,e);
    remember(s,"d1-iou",s.day,lines);out.lines.push(...lines);s.story.played["d1-iou"]=true;
  }
  s.story.quest = activeQuest(s)?.id ?? null;
  return out;
}
export function activeQuest(s: GameState): Quest | null {
  if (s.ending || s.day > 31) return null;
  const excluded = /-(night|wait|keep|no-bet|watch)$/;
  const alternatives = [["d3-mate","d3-wait"],["d5-bet","d5-no-bet"],["d10-sample","d10-wait"],["d18-edit","d18-keep"],["d25-chimera","d25-plain","d25-wait"],["d27-help","d27-watch"]];
  const resolved = (id: string): boolean => alternatives.some(group => group.includes(id) && group.some(other => s.story.played[other]));
  return QUESTS.find(q => q.day === s.day && q.at && !s.story.played[q.id] && !excluded.test(q.id) && !resolved(q.id)) ?? null;
}
export interface Plaque { text: string; progress: number; count: number; waitDay: number | null; at: Spot | null }
export function plaque(s: GameState): Plaque | null {
  const quest = activeQuest(s);
  if (quest) return { text: quest.text, progress: 0, count: 1, waitDay: null, at: quest.at ?? null };
  if (s.ending || s.day >= 31) return null;
  return { text: "明天再继续", progress: 0, count: 1, waitDay: s.day + 1, at: null };
}
export function idleLines(s: GameState, who: string): Line[] {
  if (who !== "老赵") return [];
  return [{ who, text: s.day < 10 ? "先看它怎么跑，钱和草料记清楚。" : s.day < 31 ? "身体、地面、观众，都得看。你自己的记录别扔。" : "接着养。下一匹可以慢慢想。" }];
}
export function nightLines(r: NightReport): Line[] {
  if (r.ruined) return r.day === 31 ? [...P(31, 23), ...P(31, 25)] : P(35, 1, 14);
  if (r.day === 31 && r.debtPaid) return [...P(31, 23), ...P(31, 24)];
  if (r.day === 7) return [...P(7, 6, 10), ...P(7, r.grace ? 11 : 10), ...P(7, 12)];
  if (r.day === 14) return [...P(14, 5, 8), ...P(14, r.grace ? 9 : 8), ...P(14, 10)];
  if (r.day === 21) return [...P(21, 7), ...(r.grace ? P(21, 14) : P(21, 8, 14))];
  if (r.day === 10 && r.debtPaid === 2400) return P(10, 8);
  if (r.day === 17 && r.debtPaid === 9600) return P(17, 15);
  if (r.day === 24 && r.debtPaid === 24000) return P(24, 11);
  return [];
}
export function nightReward(s: GameState, r: NightReport): number[] {
  const thirdPaid = r.day === 21 && r.debtPaid === 20000 || r.day === 24 && r.debtPaid === 24000;
  if (thirdPaid && !s.story.diary.includes(6)) s.story.diary.push(6);
  remember(s, `night:${r.day}`, r.day, nightLines(r));
  return [];
}
export const OFFER_DAY = 30;
export const OFFER_LINES = P(30, 2, 17);
export function offerPending(s: GameState): boolean { return s.day === 30 && !s.ending && !s.flags["offer:done"]; }
export function offerPrelude(s: GameState): Line[] { return s.story.diary.length < 7 ? [...P(30, 19), ...OFFER_LINES] : OFFER_LINES; }
export function answerOffer(s: GameState, sign: boolean): Line[] {
  if (!offerPending(s)) return [];
  s.flags["offer:done"] = true;
  s.story.choices.offer = sign ? "sign" : "refuse";
  if (sign) {
    grant(s, "牧场收购款", 30000);
    s.debtsPaid = 4;
    s.grace = null;
    s.ending = "mascot";
    s.over = true;
  }
  const lines = sign ? P(30, 18) : [...P(30, 17), ...P(30, 20, 22)];
  remember(s, "offer", 30, lines);
  return lines;
}
export interface EndingText { title: string; lines: string[] }
export const ENDINGS: Record<"tianma" | "kept" | "mascot", EndingText> = {
  tianma: { title: "天马", lines: P(32, 0, 16).map(l => l.text) },
  kept: { title: "守住了", lines: P(33, 0, 17).map(l => l.text) },
  mascot: { title: "吉祥物", lines: P(34, 1, 14).map(l => l.text) },
};
export function endingText(s: GameState, ending: "tianma" | "kept" | "mascot"): EndingText {
  const text = ENDINGS[ending];
  if (ending === "mascot") return { ...text, lines: [...P(34, s.story.choices.offer === "sign" ? 0 : 1), ...P(34, 2, 14)].map(l => l.text) };
  return { ...text, lines: text.lines.filter(l => !l.startsWith("若你曾") || s.flags["wanbi:helped"])
    .map(l => l.replace(/^若你曾帮完璧试跑，/, "")) };
}

/** 结局也逐句演出、存档；重载只补完未读段落。 */
export function queueEnding(s: GameState, ending: "tianma" | "kept" | "mascot"): void {
  const id = `ending:${ending}`;
  if (s.story.played[id]) return;
  s.story.played[id] = true;
  const day = ending === "tianma" ? 32 : ending === "kept" ? 33 : 34;
  const texts = new Set(endingText(s, ending).lines);
  const lines = P(day, 0, script[day - 1]!.paragraphs.length).filter(l => texts.has(l.text.replace(/^若你曾帮完璧试跑，/, ""))).map(l => ({...l,text:l.text.replace(/^若你曾帮完璧试跑，/, "")}));
  remember(s, id, day, lines);
}
