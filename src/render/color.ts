type Rgb = [number, number, number];

function hexToRgb(h: string): Rgb {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function rgbToHex(r: Rgb): string {
  return "#" + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function shade(c: string, k: number): string {
  return k < 0 ? mix(c, "#000000", -k) : mix(c, "#ffffff", k);
}

export function rgba(c: string, a: number): string {
  const [r, g, b] = hexToRgb(c);
  return `rgba(${r},${g},${b},${a})`;
}

export interface Coat {
  name: string;
  light: string;
  dark: string;
  mane: string;
}

/** 毛色位点 −2..+2 映射到 6 种毛色。 */
export const COATS: Coat[] = [
  { name: "青", light: "#8d97b8", dark: "#4b5376", mane: "#2d3150" },
  { name: "乌", light: "#4a4048", dark: "#1d1820", mane: "#120e14" },
  { name: "骝", light: "#b4703f", dark: "#6b3a1f", mane: "#2a1a14" },
  { name: "栗", light: "#c8693a", dark: "#7c341a", mane: "#7a2f17" },
  { name: "银鬃", light: "#e7c27c", dark: "#a7783a", mane: "#fbf0d4" },
  { name: "白", light: "#d9d6d0", dark: "#8f8a86", mane: "#f4f1ea" },
];

export function coatFor(value: number): Coat {
  const i = Math.max(0, Math.min(COATS.length - 1, Math.round(((value + 2) / 4) * (COATS.length - 1))));
  return COATS[i] as Coat;
}
