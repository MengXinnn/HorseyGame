import { eventFor } from "./season";
import type { GameState } from "./state";

/** 老赵轮着说的经验之谈，按天数换一句。 */
const TIPS = [
  "庄家只认战绩。没跑过的新马，赔率高得吓人。",
  "腿长的马跑得快，可一绊就翻。上相扑台要矮、要沉。",
  "测序贵是贵，看清了基因再配种，少走弯路。",
  "野原上的马胆子小，套索扔近一点才套得住。",
  "马董的人第七天夜里来收钱，钱不够，牧场就是他的了。",
  "配种当晚怀上，第二天一早小马就落地，两天长成。",
  "押注上限看你的名望。赢得多了，庄家才肯收你的大注。",
];

/** 马董的催债信，开局时读。 */
export const LETTER = [
  "外婆的牧场，连同她欠我的六万块，如今都归你了。",
  "每七天我来收一笔。头一笔两千，第七天夜里。",
  "还不上，这块地我就推平了盖乐园。",
];

/**
 * 跟老赵说话：第一次见面自我介绍，擂台日下战书，赢过铁墩后服气，
 * 其他时候说一句经验之谈。会写入 flags，记住说过什么。
 */
export function laozhaoLines(state: GameState): string[] {
  const f = state.flags;
  if (!f["zhao:intro"]) {
    f["zhao:intro"] = true;
    return [
      "外乡来的？我是老赵，镇上的赛事归我张罗。",
      "单日跑平地，双日比相扑，第七天我的铁墩摆擂台。",
      "赢了铁墩，给你一千。输了嘛，别哭鼻子。",
    ];
  }
  if (f["beat:tiedun"] && !f["zhao:beaten"]) {
    f["zhao:beaten"] = true;
    return ["行啊你。铁墩好些年没输过了。", "下礼拜我换一匹更沉的，你等着。"];
  }
  if (eventFor(state.day) === "boss") {
    return ["今天擂台。铁墩一吨重，你那几匹够它推的吗？", "报名在相扑台，傍晚五点开打。"];
  }
  return [TIPS[(state.day - 1) % TIPS.length] as string];
}
