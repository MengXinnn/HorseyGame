/**
 * 剧情：主线任务、对白、信箱和外婆的日记。全部写成数据，规则是纯函数，不碰界面。
 *
 * 一次只挂一个主线任务。界面把玩家做的事（交互、套马、配种、比赛、睡觉……）
 * 以 StoryEvent 报给 storyEvent()，拿回要演的对白和要弹的提示。
 * 剧本见 Claude Doc《天马行空》剧本。还没做出来的系统（马戏、嵌合、六地貌、基因剪刀、接力）
 * 对应的任务先不进表，主线照样能从第 1 天走到第 28 天。
 *
 * 节奏：第一周只有比赛、配种、下注，一个字不提基因；第 10 天测序所开门，
 * 第 11 天拿到第一份测序结果，马的面板才多出「基因」一栏。
 */
import { bossFor, WEATHER_HINTS, WEATHER_LABELS, weatherFor, sportOf } from "./calendar";
import { debtDue, EVENT_LABELS, eventFor, weekOf, type EventKind } from "./season";
import { findHorse, RESUME, type GameState, type NightReport } from "./state";

/** 一句对白。who 为空是旁白。 */
export interface Line {
  who: string;
  text: string;
}

export type StoryEvent =
  | { t: "interact"; id: string }
  | { t: "near"; id: string }
  | { t: "catch" }
  | { t: "detail"; horseId: string }
  | { t: "mate" }
  | { t: "register" }
  | { t: "trial" }
  | { t: "sequence" }
  | { t: "bet" }
  | { t: "sell" }
  | { t: "outcome"; kind: EventKind; rank: number | null }
  | { t: "sleep" }
  | { t: "morning" };

/** 地图箭头指向哪：一个交互点，或者野原。 */
export type Spot = "mail" | "sleep" | "barn" | "sequence" | "market" | "bookie" | "sumo" | "race" | "laozhao" | "wilds";

interface Reward {
  rep?: number;
  diary?: number;
  flag?: string;
}

export interface Quest {
  id: string;
  /** 最早第几天出现。 */
  day: number;
  /** 过了这天还没做完就跳过（日记照给）。 */
  until?: number;
  text: string;
  count?: number;
  at?: Spot | ((s: GameState) => Spot);
  /** 任务出现时演的对白。 */
  intro?: Line[];
  /** 在 talk.id 这个地方交互时，先演这段对白再打开面板。 */
  talk?: { id: string; lines: Line[] };
  check(e: StoryEvent, s: GameState): boolean;
  outro?: (s: GameState, e: StoryEvent) => Line[];
  reward?: Reward;
}

const say = (who: string, ...texts: string[]): Line[] => texts.map((text) => ({ who, text }));
const note = (...texts: string[]): Line[] => say("", ...texts);

export const YOU = "你";
const ZHAO = "老赵";
const MA = "马董";
const TAO = "阿桃";
const QIAN = "钱四";
const BAI = "小白";
const MIA = "米娅";
const KDR = "K博士";
export const DIARY_WHO = "外婆的日记";
export const IOU_WHO = "借据";

/* ---------------- 序章：城里的回忆和老赵接站 ---------------- */

export type SlidePic = "office" | "summer" | "photo" | "phone";

export interface Slide {
  pic: SlidePic;
  text: string;
}

/** 开场黑底像素画，一张一张翻。 */
export const FLASHBACK: Slide[] = [
  { pic: "office", text: "你在城里工作的第五年，已经很久没回过马蹄镇了。" },
  { pic: "summer", text: "小时候每个暑假，你都在外婆的天马牧场过。" },
  { pic: "photo", text: "镇上的人都说，外婆年轻时养出过一匹会飞的马，叫踏云。没人知道是真是假。" },
  { pic: "phone", text: "桌上的手机亮了。来电显示：马蹄镇　老赵。" },
];

/** 电话，然后老赵赶着铁墩来车站接你，一路送到牧场门口。 */
export const PICKUP: Line[] = [
  ...say(ZHAO, "是我，老赵。你外婆……昨天夜里走了，走得很安详。", "牧场的事得有人管。你回来一趟吧，我去车站接你。"),
  ...note("清晨六点，马蹄镇车站。一匹胖得像小山的马拉着板车，车上坐着一个白胡子老头。"),
  ...say(ZHAO, "上车。这是铁墩，镇上力气最大的马，拉人是屈才了。", "你外婆在镇上养了五十年马，镇上一半的马都是她接生的。", "这两年她不太顺，马一匹一匹地卖，最后就剩两匹。我问她缺不缺钱，她只是笑。"),
  ...say(ZHAO, "到了。我住镇东头，挂「赵」字牌子那个院子。有事来找我。"),
  ...note("牧场大门。院子里的草长高了，门口的信箱插着一面小红旗。"),
];

/* ---------------- 外婆的日记 ---------------- */

export const DIARY: Record<number, string> = {
  1: "流星跑得飘，磐石站得稳。两匹配在一起，生出来的不是平均数，是一次抽签。养马的人，只管把签做好。",
  2: "老赵那小子又输给我了，哭得鼻涕泡都出来了。他不服，说我的马腿短得像板凳。腿短怎么了？板凳最稳。",
  3: "踏云的相容度高得出奇，头、背、四肢、尾四个槽全开。别人都说它是怪物。它在天马杯上长出了翅膀，所有人都闭嘴了。",
  4: "野原上的马不是野的，是自由的。沼泽里的胖、雪山上的矮、海边的会游泳。每一块地都养出一种马，少了哪块都可惜。",
  5: "小马又来了，还想要踏云的样本。他说用剪刀改上几刀，就能做出一匹没有缺点的马。我没给。他走的时候说，等我老了，野原迟早是他的。我把能借的钱都借了，把野原从他公司手里买了回来。欠条写的是他的名字。",
  6: "小马是个好孩子，只是太怕输。他要是哪天明白，马不需要完美，也能跑到天上去，就好了。",
  7: "踏云老了以后，我把它放回了雪山。它的孩子还在那儿跑，一代一代，没人管，也没人改。要是哪天牧场需要它们，就去山顶看日出。",
};

/* ---------------- 信 ---------------- */

export interface Mail {
  from: string;
  title: string;
  lines: string[];
  /** 落款处的印章字。 */
  seal?: string;
}

/** 日报头条：剧本里写好的几天，其余按当天赛事自动排版。 */
const HEADLINES: Record<number, string> = {
  8: "马戏团进镇！广场上搭起了红帐篷",
  10: "测序所重新开张，小白进修归来",
  14: "今晚擂台：马戏团米娅和迷你马豆包",
  17: "K博士归来！测序所后院的灯亮了一整夜",
  19: "大风天！又高又轻的马当心被吹翻",
  20: "马董的完美马「完璧」今日试跑",
  21: "K博士照着全镇最强的马，配出了「样本七号」",
  22: "第四十届天马杯开始报名！第二十八天傍晚决赛",
  28: "天马杯决赛今晚开跑！马董：完璧没有缺点",
};

export function mailContent(id: string): Mail {
  if (id === "waipo") {
    return {
      from: "云姑",
      title: "外婆的信",
      lines: [
        "乖，你能看到这封信，外婆就放心了。",
        "牧场交给你了。流星和磐石在马厩，它们小时候你都抱过，认得你的味道。",
        "养马没有什么诀窍，多看、多试，马长什么样，就让它什么样地跑。",
        "有件事外婆没来得及跟你说，对不起。",
      ],
      seal: "云",
    };
  }
  if (id === "zhao") {
    return { from: ZHAO, title: "战书", lines: ["明晚擂台，铁墩候着。", "别迟到，也别哭鼻子。"], seal: "赵" };
  }
  if (id === "kdr") {
    return { from: KDR, title: "牛皮纸信封", lines: ["在实验室抽屉里翻到的，是云姑的字。", "我想，这该归你。"], seal: "K" };
  }
  if (id.startsWith("paper:")) {
    const day = Number(id.slice(6));
    const kind = eventFor(day);
    const boss = bossFor(day);
    const weather = weatherFor(day);
    const nextBossDay = Math.ceil(day / 7) * 7;
    const nextBoss = bossFor(nextBossDay);
    const lines = [
      HEADLINES[day] ?? (boss ? `今晚擂台：${boss.owner}的${boss.horse}` : `今日${EVENT_LABELS[kind]}，傍晚五点开赛`),
      `天气：${WEATHER_LABELS[weather]}${WEATHER_HINTS[weather] ? `，${WEATHER_HINTS[weather]}` : ""}`,
    ];
    if (nextBoss && nextBossDay !== day && nextBossDay % 28 !== 0) lines.push(`第${nextBossDay}天擂台：${nextBoss.owner}的${nextBoss.horse}`);
    if (day % 28 !== 0 && weekOf(day) % 4 === 0) lines.push("天马杯：第二十八天傍晚，马董的完璧参赛");
    return { from: TAO, title: `马蹄镇日报　第${day - 7}期`, lines, seal: "桃" };
  }
  return { from: "", title: "", lines: [] };
}

/** 早上送信：第 6 天老赵的战书，第 19 天 K 博士的信封，第 8 天起每天一份日报（旧报纸收走）。 */
function deliverMail(s: GameState): void {
  const post = (id: string): void => {
    if (!s.story.read.includes(id) && !s.story.inbox.includes(id)) s.story.inbox.push(id);
  };
  if (s.day === 6) post("zhao");
  if (s.day === 19) post("kdr");
  if (s.day >= 8) {
    s.story.inbox = s.story.inbox.filter((id) => !id.startsWith("paper:"));
    post(`paper:${s.day}`);
  }
}

/** 读信：从信箱挪到读过的信里。 */
export function readMail(s: GameState): Mail[] {
  const ids = s.story.inbox;
  s.story.inbox = [];
  for (const id of ids) if (!s.story.read.includes(id)) s.story.read.push(id);
  return ids.map((id) => mailContent(id));
}

/* ---------------- 主线任务 ---------------- */

const isFoalId = (s: GameState, id: string): boolean => (findHorse(s, id)?.bornDay ?? 0) > 0;
const won = (e: StoryEvent): boolean => e.t === "outcome" && e.rank === 1;

/** 马董第一次登门：亮借据，讲清楚这笔债。 */
const MADONG_VISIT: Line[] = [
  ...note("从马厩出来，一辆漆黑锃亮的马车停在门口，四匹一模一样的白马拉车，车门上烫着金字「马氏庄园」。", "一个穿西装、油头锃亮的中年人跳下车，用手帕捂着鼻子。"),
  ...say(MA, "哟，这就是云姑的接班人？比我想的还要……朴素。", "鄙人马董，马氏庄园的董事长。镇上最大的牧场、最快的马、最贵的马车，都是我的。"),
  ...say(YOU, "……您有什么事吗？"),
  ...say(MA, "生意上的事。（从怀里抽出一张纸，在你眼前晃了晃）"),
  ...say(IOU_WHO, "今借到马董人民币陆万元整，以天马牧场作抵押，分四期归还。借款人：云姑。三年前立。"),
  ...say(YOU, "外婆借了六万？她借这么多钱干什么？"),
  ...say(MA, "那我可管不着。白纸黑字，她签的字，她按的手印。", "我这人最讲道理。四个礼拜分四笔还清，头一笔两千，第七天夜里我亲自来取。"),
  ...say(YOU, "要是还不上呢？"),
  ...say(MA, "那这块地就归我。乐园的图纸我早画好了，这个破马厩，正好拆了盖旋转木马。哈哈哈！"),
  ...say(MA, "哦对了，四个礼拜后的天马杯，我的「完璧」也会参赛。到时候让你开开眼，什么叫真正的好马。"),
  ...note("马车扬长而去，扬起一路尘土。磐石冲着车屁股打了个响鼻。"),
];

export const QUESTS: Quest[] = [
  /* 序章：第 1 天 */
  {
    id: "q-mail",
    day: 1,
    text: "打开信箱",
    at: "mail",
    check: (e) => e.t === "interact" && e.id === "mail",
  },
  {
    id: "q-barn",
    day: 1,
    text: "去马厩看看外婆的马",
    at: "barn",
    check: (e) => e.t === "near" && e.id === "barn",
    outro: () => note("流星是一匹灰色母马，腿长，抬头嗅了嗅你。磐石是一匹黑公马，又矮又壮，拱了拱门。"),
  },
  {
    id: "q-detail",
    day: 1,
    text: "点一匹马看详情",
    at: "barn",
    check: (e) => e.t === "detail",
    outro: () => MADONG_VISIT,
    reward: { flag: "met:madong" },
  },
  {
    id: "q-zhao",
    day: 1,
    text: "去马蹄镇找老赵",
    at: "laozhao",
    check: (e) => e.t === "interact" && e.id === "laozhao",
    outro: () => [
      ...say(ZHAO, "马董来过了？……唉，我就怕这个。", "他年轻时在你外婆这儿当过学徒，后来去城里发了财。他俩之间的事，我也说不清。"),
      ...say(ZHAO, "两千块不算多。镇上天天有比赛，单日跑平地，双日比相扑，赢了有奖金。", "可你就两匹马，不够用。先去野原套几匹，就在你家牧场东边。"),
    ],
  },
  {
    id: "q-lasso",
    day: 1,
    text: "去野原套一匹野马",
    at: "wilds",
    intro: note("走近马群，点一匹马扔套索。拉绳时把指针保持在绿区。套索一天三根。"),
    check: (e) => e.t === "catch",
  },
  {
    id: "q-sleep1",
    day: 1,
    text: "回家睡觉",
    at: "sleep",
    check: (e) => e.t === "sleep",
    outro: () => [
      ...note("马越多，饲料费越多。"),
      ...note("风里有一股青草味。你想起小时候，外婆坐在门口给你剥花生，流星的妈妈就在栏杆那边吃草。"),
    ],
  },

  /* 第 2 天：第一场比赛 */
  {
    id: "q-tao",
    day: 2,
    text: "去赛马场报名亭找阿桃",
    at: "race",
    check: (e) => e.t === "interact" && e.id === "race",
    outro: () =>
      say(TAO, "新面孔！你是云姑家的？节哀。", "今天是相扑日，单日跑平地，双日比相扑。报名费五十，傍晚五点开打，赢了有奖金。", "我还写《马蹄镇日报》，下礼拜开始天天送到你信箱。"),
  },
  {
    id: "q-sumo",
    day: 2,
    text: "报名今天的相扑",
    at: "sumo",
    intro: note("相扑推出圈或者掀翻就赢。又矮又沉的马站得稳。"),
    check: (e, s) => e.t === "register" && sportOf(s.day) === "sumo",
  },
  {
    id: "q-bout",
    day: 2,
    text: "傍晚五点去相扑台比赛",
    at: "sumo",
    check: (e) => e.t === "outcome",
    outro: (_s, e) => (won(e) ? say(ZHAO, "有两下子。云姑的血没白流。") : say(ZHAO, "腿太长了，一推就倒。相扑要找矮的、沉的。")),
  },

  /* 第 3 天：配种 */
  {
    id: "q-diary1",
    day: 3,
    text: "去马厩看看",
    at: "barn",
    check: (e) => e.t === "near" && e.id === "barn",
    outro: () => note("草堆里掉出一张发黄的纸。是外婆的日记。"),
    reward: { diary: 1 },
  },
  {
    id: "q-mate",
    day: 3,
    text: "让流星和磐石配种",
    at: "barn",
    intro: [...say(YOU, "抽签？什么意思？"), ...note("配种当晚怀上，明早出生。每匹马一天只能配一次。")],
    check: (e) => e.t === "mate",
  },
  {
    id: "q-race",
    day: 3,
    text: "报名平地赛，傍晚比赛",
    at: "race",
    intro: note("平地赛八匹马跑四百米，前三名有奖金。"),
    check: (e, s) => e.t === "outcome" && sportOf(s.day) === "race",
  },

  /* 第 4 天：小马谁都不像 */
  {
    id: "q-foal",
    day: 4,
    until: 6,
    text: "看看刚出生的小马",
    at: "barn",
    check: (e, s) => e.t === "detail" && isFoalId(s, e.horseId),
    outro: () => [...note("小马的腿比流星短、比磐石长，毛色却谁都不像。"), ...say(YOU, "同一对爹妈……怎么生出来一个谁都不像的？")],
  },
  {
    id: "q-ask",
    day: 4,
    text: "去问问老赵",
    at: "laozhao",
    check: (e) => e.t === "interact" && e.id === "laozhao",
    outro: () => [
      ...say(ZHAO, "这就是养马的学问。同一对爹妈，生十匹十个样，有的跑得飞快，有的走两步就摔。", "你外婆管这叫抽签。签是怎么做的……她那套东西，我从来没学会。"),
      ...say(ZHAO, "我只知道一条笨办法：挑你想要的那样的马配，一代一代来，总会越来越像。"),
      ...note("小马两天后成年。小马不能参赛，饲料费只要五块。"),
    ],
  },

  /* 第 5 天：试跑和下注 */
  {
    id: "q-trial",
    day: 5,
    text: "在报名亭给马试跑",
    count: 2,
    at: "race",
    intro: note("试跑十秒，看看能跑多远。两匹看着差不多的马，能差出好几米。"),
    check: (e) => e.t === "trial",
  },
  {
    id: "q-bet",
    day: 5,
    text: "去赌马摊下一注",
    at: "bookie",
    talk: {
      id: "bookie",
      lines: say(QIAN, "赢过的马赔率低，没跑过的新马赔率高。押冷门，赚得多，亏得也快。", "头一回的客人，教你个乖：开个「保」，输了退一半。", "注码上限看名望，名望靠比赛名次涨。"),
    },
    check: (e) => e.t === "bet",
  },

  /* 第 6 天：战书 */
  {
    id: "q-intel",
    day: 6,
    text: "去老赵那儿打听铁墩",
    at: "laozhao",
    check: (e) => e.t === "interact" && e.id === "laozhao",
    outro: () => say(ZHAO, "铁墩一吨重，站得比石头还稳。想推它，你的马得矮、得沉、得宽。", "别急着跟它硬顶。它脑袋重，往前冲的时候最容易栽。"),
  },
  {
    id: "q-warmup",
    day: 6,
    until: 6,
    text: "在相扑赛里赢一场",
    at: "sumo",
    check: (e, s) => e.t === "outcome" && sportOf(s.day) === "sumo" && e.rank === 1,
    outro: () => note("相扑台边上，捡到外婆日记的又一页。"),
    reward: { diary: 2 },
  },

  /* 第 7 天：铁墩擂台 */
  {
    id: "q-tiedun",
    day: 7,
    until: 7,
    text: "擂台：击败铁墩",
    at: "sumo",
    check: (e) => e.t === "outcome" && e.kind === "boss",
    outro: (_s, e) =>
      won(e)
        ? say(ZHAO, "行啊你！铁墩好些年没输过了。", "下个礼拜我可不管你了，马戏团要来了，那帮人才难缠。")
        : say(ZHAO, "输给铁墩不丢人。跟你外婆一样，越输越有劲。"),
  },

  /* 第 10 天：测序所开门，基因第一次出现 */
  {
    id: "q-xiaobai",
    day: 10,
    text: "去测序所看看",
    at: "sequence",
    talk: {
      id: "sequence",
      lines: [
        ...say(BAI, "你就是老赵说的，那个整天问「小马为什么谁都不像」的人？", "我是小白，测序所的助手，前两个礼拜跟博士去城里进修了。"),
        ...say(BAI, "你问的事有答案。每匹马身体里都有一本看不见的说明书，叫基因。腿多长、身子多沉、胆子大不大，都写在里面。"),
        ...say(BAI, "说明书有两份，爸爸一份，妈妈一份。小马从两份里各抄一半，抄哪一半全凭运气。你外婆说的「抽签」，就是这个。"),
        ...say(BAI, "我这台机器能把说明书读出来。测一匹两百，明早出结果。头一回给你打对折。"),
      ],
    },
    check: (e) => e.t === "interact" && e.id === "sequence",
    reward: { flag: "seq:half" },
  },
  {
    id: "q-seq",
    day: 10,
    text: "送一匹马去测序",
    at: "sequence",
    check: (e) => e.t === "sequence",
  },

  /* 第 11 天：基因栏解锁 */
  {
    id: "q-genes",
    day: 11,
    text: "看看测好的那匹马的基因",
    at: "barn",
    check: (e, s) => e.t === "detail" && !!findHorse(s, e.horseId)?.sequenced,
    outro: () => [
      ...say(BAI, "（纸条）每条基因是个方向，往 + 走有好处也有代价，没有哪边是最好。", "（纸条）体型、肌力、步频会吃代谢点，上限看体质。"),
      ...note("没测过的马，基因栏还是问号。"),
    ],
  },
  {
    id: "q-seq2",
    day: 11,
    text: "再测一匹马，比比说明书",
    at: "sequence",
    check: (e) => e.t === "sequence",
  },

  /* 第 12 天：云姑的样本柜（谱系树做好以前先从这里拿日记） */
  {
    id: "q-cabinet",
    day: 12,
    text: "去测序所找小白",
    at: "sequence",
    check: (e) => e.t === "interact" && e.id === "sequence",
    outro: () => say(BAI, "你来得正好。这是云姑的样本柜，她让我等你来了再打开。", "柜子最底下压着一张纸。"),
    reward: { diary: 3 },
  },

  /* 第 14 天：米娅的擂台 */
  {
    id: "q-doubao",
    day: 14,
    until: 14,
    text: "擂台：赢过米娅的豆包",
    at: "race",
    intro: say(MIA, "你就是云姑的后人？我是米娅，这是豆包。小就是灵！", "马董也要把马戏团从广场赶走，说要盖乐园。今晚擂台，赢了我，我们就是一条船上的。"),
    check: (e) => e.t === "outcome" && e.kind === "boss",
    outro: (_s, e) => (won(e) ? say(MIA, "好吧好吧，你比我会养马。不过豆包比你的马可爱！") : say(MIA, "小就是灵嘛。下次再来！")),
  },

  /* 第 19 天：外婆的秘密 */
  {
    id: "q-diary5",
    day: 19,
    until: 20,
    text: "打开信箱",
    at: "mail",
    check: (e) => e.t === "interact" && e.id === "mail",
    reward: { diary: 5 },
  },
  {
    id: "q-past",
    day: 19,
    until: 20,
    text: "去问老赵当年的事",
    at: "laozhao",
    intro: say(YOU, "原来外婆借钱，是为了野原……"),
    check: (e) => e.t === "interact" && e.id === "laozhao",
    outro: () => say(ZHAO, "小马？马董小时候就叫小马，跟着你外婆学了十年。", "人聪明，就是太怕输。"),
  },

  /* 第 21 天：K 博士的擂台 */
  {
    id: "q-sample7",
    day: 21,
    until: 21,
    text: "擂台：赢过K博士的样本七号",
    at: "race",
    intro: say(KDR, "我是K博士，马董请来的顾问。不过别紧张，我只对数字感兴趣。", "样本七号是照着全镇战绩最好的马配的。也包括你的。别生气，我谁的都抄。"),
    check: (e) => e.t === "outcome" && e.kind === "boss",
    outro: (_s, e) => (won(e) ? say(KDR, "模仿只能追上，追不过。好，我服。") : say(KDR, "同一套基因，看来不只是数字的事。我记下了。")),
  },

  /* 第 22–28 天：天马杯 */
  {
    id: "q-cup",
    day: 22,
    until: 28,
    text: "天马杯决赛：第二十八天傍晚",
    at: "race",
    intro: say(TAO, "头条新闻！第四十届天马杯开始报名，第二十八天傍晚决赛！", "马董的完璧也报了名。听说它跑得飞快，就是胆子小，看台一喊就发呆。"),
    check: (e) => e.t === "outcome" && e.kind === "cup",
    outro: (_s, e) =>
      won(e) ? [...note("完璧站在终点线前发呆，你的怪马冲了过去。"), ...say(MA, "……她是对的。")] : note("马董没有走过来，只是远远点了点头。"),
  },
];

const questById = (id: string | null): Quest | undefined => QUESTS.find((q) => q.id === id);

/** 旧存档：从今天还能做的第一个任务接着走，过期的跳过。 */
function resolve(s: GameState): void {
  if (s.story.quest === RESUME) {
    s.story.quest = QUESTS.find((q) => q.day >= s.day)?.id ?? null;
    s.story.progress = 0;
  }
  let q = questById(s.story.quest);
  while (q && q.until !== undefined && s.day > q.until) {
    if (q.reward?.diary && !s.story.diary.includes(q.reward.diary)) s.story.diary.push(q.reward.diary);
    if (q.reward?.flag) s.flags[q.reward.flag] = true;
    q = QUESTS[QUESTS.indexOf(q) + 1];
    s.story.quest = q?.id ?? null;
    s.story.progress = 0;
  }
}

/** 现在挂在木牌上的任务（还没到日子的不算）。 */
export function activeQuest(s: GameState): Quest | null {
  resolve(s);
  const q = questById(s.story.quest);
  return q && q.day <= s.day ? q : null;
}

export interface Plaque {
  text: string;
  progress: number;
  count: number;
  /** 还没到日子：第几天开始。 */
  waitDay: number | null;
  at: Spot | null;
}

/** 任务木牌上显示什么：当前任务，或者下一个任务还要等几天。 */
export function plaque(s: GameState): Plaque | null {
  resolve(s);
  const q = questById(s.story.quest);
  if (!q) return null;
  const waiting = q.day > s.day;
  return {
    text: q.text,
    progress: s.story.progress,
    count: q.count ?? 1,
    waitDay: waiting ? q.day : null,
    at: waiting || !q.at ? null : typeof q.at === "function" ? q.at(s) : q.at,
  };
}

export interface StoryResult {
  lines: Line[];
  /** 新找到的日记页。 */
  diary: number[];
}

function applyReward(s: GameState, r: Reward | undefined, out: StoryResult): void {
  if (!r) return;
  if (r.rep) s.reputation += r.rep;
  if (r.flag) s.flags[r.flag] = true;
  if (r.diary && !s.story.diary.includes(r.diary)) {
    s.story.diary.push(r.diary);
    out.diary.push(r.diary);
  }
}

function introOf(s: GameState, q: Quest | null): Line[] {
  if (!q?.intro || s.flags[`intro:${q.id}`]) return [];
  s.flags[`intro:${q.id}`] = true;
  return q.intro;
}

/** 报一件玩家做的事，推进剧情，返回要演的对白。 */
export function storyEvent(s: GameState, e: StoryEvent): StoryResult {
  const out: StoryResult = { lines: [], diary: [] };
  if (e.t === "morning") deliverMail(s);
  const q = activeQuest(s);
  if (!q) return out;
  if (e.t === "morning") {
    out.lines.push(...introOf(s, q));
    return out;
  }
  if (e.t === "interact" && q.talk?.id === e.id && !s.flags[`talk:${q.id}`]) {
    s.flags[`talk:${q.id}`] = true;
    out.lines.push(...q.talk.lines);
  }
  if (!q.check(e, s)) return out;
  s.story.progress++;
  if (s.story.progress < (q.count ?? 1)) return out;
  out.lines.push(...(q.outro?.(s, e) ?? []));
  applyReward(s, q.reward, out);
  for (const page of out.diary) out.lines.push({ who: DIARY_WHO, text: DIARY[page] as string });
  s.story.quest = QUESTS[QUESTS.indexOf(q) + 1]?.id ?? null;
  s.story.progress = 0;
  out.lines.push(...introOf(s, activeQuest(s)));
  return out;
}

/* ---------------- 闲聊 ---------------- */

/** 老赵的经验之谈。第 10 天测序所开门以前，不提基因。 */
const ZHAO_TIPS = [
  "庄家只认战绩。没跑过的新马，赔率高得吓人。",
  "腿长的马跑得快，可一绊就翻。上相扑台要矮、要沉。",
  "野原上的马胆子小，套索扔近一点才套得住。",
  "马董每七天夜里来收钱。钱不够，他也就宽限一回。",
  "配种当晚怀上，第二天一早小马就落地，两天长成。",
  "押注上限看你的名望。赢得多了，庄家才肯收你的大注。",
];
const ZHAO_TIPS_LATER = ["日报上的天气别不当回事。雨天地滑，蹄子宽的马才站得住。", "测序贵是贵，看清了说明书再配种，少走弯路。"];

/** 没有任务对白时，跟人说话听到的一句。 */
export function idleLines(s: GameState, who: string): Line[] {
  if (who === ZHAO) {
    if (eventFor(s.day) === "boss" && bossFor(s.day)?.owner === ZHAO) return say(ZHAO, "今天擂台。铁墩一吨重，你那几匹够它推的吗？");
    if (s.flags["beat:tiedun"] && !s.flags["zhao:beaten"]) {
      s.flags["zhao:beaten"] = true;
      return say(ZHAO, "行啊你。铁墩好些年没输过了。");
    }
    const tips = s.day >= 10 ? [...ZHAO_TIPS, ...ZHAO_TIPS_LATER] : ZHAO_TIPS;
    return say(ZHAO, tips[(s.day - 1) % tips.length] as string);
  }
  return [];
}

/* ---------------- 夜里：马董来收债 ---------------- */

/** 睡觉以后、账本之前演的一段：马董来收债，或者给宽限。 */
export function nightLines(r: NightReport): Line[] {
  if (r.ruined) {
    return [...note("黑马车又停在了门口。马董这回带了一队工人。"), ...say(MA, "宽限也给过了，钱还是不够？啧啧。", "明天起，这儿就叫马董天马乐园。门票我送你一张。")];
  }
  if (r.grace) {
    return [
      ...note("夜里，黑马车停在门口。马董没下车，只摇下车窗，伸出一只戴着金戒指的手。"),
      ...say(MA, `不够？啧。我马某人做生意最讲体面，宽限你${r.grace.dueDay - r.day}天。`, `到时候连本带利，${r.grace.amount}。只此一回。`),
    ];
  }
  if (!r.debtPaid) return [];
  if (r.ending) return note("马董数完最后一笔钱，把欠条撕成两半，留了一半在桌上。");
  const next = debtDue(r.day + 1);
  const lines = [...note("夜里，黑马车停在门口。马董没下车，只摇下车窗，伸出一只戴着金戒指的手。")];
  if (r.day === 7) {
    lines.push(...say(MA, `${r.debtPaid}，不多不少。`, `就这几匹？下礼拜${next}，我看你拿什么还。`), ...note("车窗摇上之前，他又看了一眼流星，没说话。"));
  } else if (r.day === 14) {
    lines.push(
      ...note("马董这回下了车，皮鞋在门口的泥地上蹭了又蹭。"),
      ...say(MA, `${r.debtPaid}，收好了。听说你跟马戏团那丫头走得挺近？她的租约下个月就到期，我劝你少掺和。`),
      ...say(MA, "下礼拜K博士回镇。他是我请来的顾问，那才叫科学养马，不像你们这样碰运气。"),
    );
  } else if (r.day === 21) {
    lines.push(...say(MA, `${r.debtPaid}。`), ...note("他这回没有冷嘲热讽，从口袋里拿出一张发黄的纸放在桌上，没说话就走了。"));
  } else {
    lines.push(...say(MA, `${r.debtPaid}，正好。下礼拜${next}，可没这么轻松了。`));
  }
  return lines;
}

/** 第 21 天夜里马董留下日记第 6 页。 */
export function nightReward(s: GameState, r: NightReport): number[] {
  if (r.day === 21 && r.debtPaid && !s.story.diary.includes(6)) {
    s.story.diary.push(6);
    return [6];
  }
  return [];
}

/* ---------------- 第 27 天：大家来打气，马董最后出价 ---------------- */

export const OFFER_DAY = 27;

export function offerPending(s: GameState): boolean {
  return s.day === OFFER_DAY && !s.ending && !s.flags["offer:done"];
}

export const OFFER_LINES: Line[] = [
  ...note("傍晚，老赵牵着铁墩、米娅带着豆包、小白陆续来到牧场。"),
  ...say(ZHAO, "明天别哭鼻子。……哭也行，赢了再哭。"),
  ...say(MIA, "豆包给你的马加油！小就是灵，怪就是强！"),
  ...say(BAI, "我把你所有马的测序结果打印出来了，贴在马厩墙上。"),
  ...note("大家走后，黑马车停在门口。"),
  ...say(MA, "三万，买下这块破地。欠款一笔勾销，你拿着钱回城里上班去。够大方吧？", "明天你赢不了。完璧是我花了二十万一刀一刀改出来的，全身上下没有一个缺点。"),
];

/** 签字：牧场归马董，进「吉祥物」结局。 */
export function answerOffer(s: GameState, sign: boolean): Line[] {
  s.flags["offer:done"] = true;
  if (sign) {
    s.ending = "mascot";
    s.over = true;
    return say(MA, "识时务。明天来乐园报到，驯马员的制服我给你留了一套。");
  }
  return say(MA, "行，有骨气。明天看台上，我请全镇的人看你出丑。");
}

/* ---------------- 结局 ---------------- */

export interface EndingText {
  title: string;
  lines: string[];
}

export const ENDINGS: Record<"tianma" | "kept" | "mascot", EndingText> = {
  tianma: {
    title: "天马行空",
    lines: ["你的怪马驮着奖杯绕场一圈。", "马董第一次笑了：「她是对的。」他问能不能买一匹你的小马。", "牧场是你的了。明年的天马杯，还在等你。"],
  },
  kept: {
    title: "守住了",
    lines: ["四笔债都还清了。", "马董把半张欠条留在桌上：「牧场是你的了。明年天马杯，我还会来。」"],
  },
  mascot: {
    title: "吉祥物",
    lines: ["牧场变成了「马董天马乐园」。", "你成了乐园的驯马员。你最丑的那匹马被印在门票上。", "孩子们最喜欢它。"],
  },
};
