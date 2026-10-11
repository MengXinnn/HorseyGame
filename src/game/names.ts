import type { Rng } from "../sim/rng";

const FIRST = ["赤", "青", "乌", "白", "飞", "追", "踏", "奔", "惊", "绝", "照", "逐", "凌", "啸", "卷", "疾", "望", "醉", "小", "大"];
const SECOND = ["云", "风", "电", "影", "雪", "霜", "月", "星", "尘", "焰", "霞", "雷", "川", "岚", "羽", "沙", "夜", "光", "豆", "饼"];

/** 随机马名：两个字，避开已经用过的名字。 */
export function horseName(rng: Rng, taken: ReadonlySet<string> = new Set()): string {
  for (let i = 0; i < 40; i++) {
    const name = rng.pick(FIRST) + rng.pick(SECOND);
    if (!taken.has(name)) return name;
  }
  let n = 2;
  const base = rng.pick(FIRST) + rng.pick(SECOND);
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}
