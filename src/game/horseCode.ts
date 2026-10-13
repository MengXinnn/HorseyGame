import { decodeGenome, encodeGenome, type Genome } from "../genome/genome";
import { hashSeed } from "../sim/rng";
const check = (value: string): string => hashSeed(value).toString(36).slice(-4).toUpperCase();
export function encodeHorseCode(horse: { genome: Genome; wingGenes?: readonly [0 | 1, 0 | 1] }): string {
  const base = encodeGenome(horse.genome);
  if (!horse.wingGenes?.includes(1)) return base;
  const payload = base.replace(/^TM2/,"TM3") + "-W" + horse.wingGenes.join("");
  return payload + "-" + check(payload);
}
export function decodeHorseCode(code: string): { genome: Genome; wingGenes: readonly [0 | 1, 0 | 1] } | null {
  const value = code.trim().toUpperCase().replace(/\s+/g,"");
  if (value.startsWith("TM2-")) {
    const genome = decodeGenome(value);
    return genome ? { genome, wingGenes: [0,0] } : null;
  }
  const match = /^(TM3-.+)-W([01])([01])-([A-Z0-9]{1,4})$/.exec(value);
  if (!match) return null;
  const payload = match[1] + "-W" + match[2] + match[3];
  if (check(payload) !== match[4]) return null;
  const genome = decodeGenome(match[1]!.replace(/^TM3/,"TM2"));
  return genome ? { genome, wingGenes: [Number(match[2]) as 0|1,Number(match[3]) as 0|1] } : null;
}
