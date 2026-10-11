/**
 * 16 个基因位点。等位基因是 −2..+2 的「方向值」，没有好坏之分：
 * 每个方向都有收益和代价（设计书 v0.2「没有好基因，只有合适的基因」）。
 */
export const LOCUS_IDS = [
  "size", // 体型
  "torso", // 躯干长
  "girth", // 躯干厚
  "legF", // 前腿长
  "legR", // 后腿长
  "hoof", // 蹄宽
  "neck", // 颈长
  "head", // 头重
  "tail", // 尾长
  "power", // 肌力
  "stride", // 步频
  "con", // 体质
  "courage", // 胆量
  "compat", // 相容度
  "coat", // 毛色
  "pattern", // 花纹
] as const;

export type LocusId = (typeof LOCUS_IDS)[number];

export interface LocusInfo {
  id: LocusId;
  name: string;
  plus: string;
  minus: string;
}

export const LOCI: Record<LocusId, LocusInfo> = {
  size: { id: "size", name: "体型", plus: "力量、相扑重量、拉车", minus: "敏捷、跳水、饲料费" },
  torso: { id: "torso", name: "躯干长", plus: "步幅、稳定", minus: "转体慢、体重" },
  girth: { id: "girth", name: "躯干厚", plus: "稳定、体重", minus: "速度、耐力" },
  legF: { id: "legF", name: "前腿长", plus: "速度、跨栏", minus: "稳定性" },
  legR: { id: "legR", name: "后腿长", plus: "推进、起跳", minus: "稳定性" },
  hoof: { id: "hoof", name: "蹄宽", plus: "抓地、稳定", minus: "步频" },
  neck: { id: "neck", name: "颈长", plus: "拉车配重、选美", minus: "容易把自己甩翻" },
  head: { id: "head", name: "头重", plus: "相扑顶撞", minus: "前倾、易栽倒" },
  tail: { id: "tail", name: "尾长", plus: "空中姿态", minus: "风阻" },
  power: { id: "power", name: "肌力", plus: "力量、加速", minus: "耐力、饲料费" },
  stride: { id: "stride", name: "步频", plus: "速度", minus: "稳定、耐力" },
  con: { id: "con", name: "体质", plus: "代谢上限、耐力、寿命", minus: "略微增重、降速" },
  courage: { id: "courage", name: "胆量", plus: "听话、不怯场", minus: "会停下吃草、发呆" },
  compat: { id: "compat", name: "相容度", plus: "嵌合槽数量、排异风险低", minus: "无" },
  coat: { id: "coat", name: "毛色", plus: "外观", minus: "外观" },
  pattern: { id: "pattern", name: "花纹", plus: "外观", minus: "外观" },
};

export const ALLELE_MIN = -2;
export const ALLELE_MAX = 2;
