import type { Rng } from "../sim/rng";
import { ALLELE_MAX, ALLELE_MIN, LOCUS_IDS, type LocusId } from "./loci";

export type Allele = -2 | -1 | 0 | 1 | 2;
export type AllelePair = readonly [Allele, Allele];
export type Genome = Readonly<Record<LocusId, AllelePair>>;
/** 外形表现值：两条链的平均，范围 −2..+2。 */
export type Phenotype = Readonly<Record<LocusId, number>>;

export function clampAllele(v: number): Allele {
  return Math.max(ALLELE_MIN, Math.min(ALLELE_MAX, Math.round(v))) as Allele;
}

export function makeGenome(values: Partial<Record<LocusId, readonly [number, number]>>): Genome {
  const g = {} as Record<LocusId, AllelePair>;
  for (const id of LOCUS_IDS) {
    const v = values[id] ?? [0, 0];
    g[id] = [clampAllele(v[0]), clampAllele(v[1])];
  }
  return g;
}

export function express(genome: Genome): Phenotype {
  const p = {} as Record<LocusId, number>;
  for (const id of LOCUS_IDS) {
    const [a, b] = genome[id];
    p[id] = (a + b) / 2;
  }
  return p;
}

/** 野马：大多数位点接近 0，偶尔带极端等位基因（外形平平，却可能藏着宝）。 */
export function randomGenome(rng: Rng, extremeChance = 0.12): Genome {
  const g = {} as Record<LocusId, AllelePair>;
  const roll = (): Allele => {
    if (rng.chance(extremeChance)) return rng.pick([-2, 2] as const);
    return rng.pick([-1, 0, 0, 1] as const);
  };
  for (const id of LOCUS_IDS) g[id] = [roll(), roll()];
  return g;
}

export interface BreedResult {
  genome: Genome;
  mutations: LocusId[];
}

/** 每个位点从父母各随机取一条链；每条链有 mutationRate 的概率向相邻方向突变一格。 */
export function breed(dam: Genome, sire: Genome, rng: Rng, mutationRate = 0.02): BreedResult {
  const g = {} as Record<LocusId, AllelePair>;
  const mutations: LocusId[] = [];
  for (const id of LOCUS_IDS) {
    const pair: Allele[] = [rng.pick(dam[id]), rng.pick(sire[id])];
    for (let i = 0; i < 2; i++) {
      if (rng.chance(mutationRate)) {
        const before = pair[i] as Allele;
        const after = clampAllele(before + (rng.chance(0.5) ? 1 : -1));
        if (after !== before) {
          pair[i] = after;
          mutations.push(id);
        }
      }
    }
    g[id] = [pair[0] as Allele, pair[1] as Allele];
  }
  return { genome: g, mutations };
}

/* ---------- 马码：16 个位点各编码成一个 base32 字符 + 1 位校验 ---------- */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混的 I O 0 1
const PREFIX = "TM2";

export function encodeGenome(genome: Genome): string {
  let body = "";
  let sum = 0;
  for (const id of LOCUS_IDS) {
    const [a, b] = genome[id];
    const idx = (a + 2) * 5 + (b + 2);
    body += ALPHABET[idx];
    sum = (sum * 31 + idx) % 32;
  }
  const check = ALPHABET[sum];
  return `${PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${check}`;
}

export function decodeGenome(code: string): Genome | null {
  const clean = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!clean.startsWith(PREFIX + "-")) return null;
  const chars = clean.slice(PREFIX.length + 1).replace(/-/g, "");
  if (chars.length !== LOCUS_IDS.length + 1) return null;
  const g = {} as Record<LocusId, AllelePair>;
  let sum = 0;
  for (let i = 0; i < LOCUS_IDS.length; i++) {
    const idx = ALPHABET.indexOf(chars[i] as string);
    if (idx < 0 || idx > 24) return null;
    sum = (sum * 31 + idx) % 32;
    g[LOCUS_IDS[i] as LocusId] = [(Math.floor(idx / 5) - 2) as Allele, ((idx % 5) - 2) as Allele];
  }
  if (ALPHABET[sum] !== chars[LOCUS_IDS.length]) return null;
  return g;
}
