export type Terrain = "grass" | "wetland" | "hill" | "coast" | "forest" | "mountain";
export const TERRAIN_LABELS: Record<Terrain, string> = {
  grass: "草地", wetland: "湿地", hill: "丘陵", coast: "海岸", forest: "林谷", mountain: "雪山",
};
export const TERRAIN_FRICTION: Record<Terrain, number> = {
  grass: 1, wetland: 0.6, hill: 0.9, coast: 0.75, forest: 0.9, mountain: 0.3,
};
export const RELAY_LEGS: readonly (readonly [Terrain, Terrain])[] = [
  ["grass", "hill"], ["wetland", "coast"], ["forest", "mountain"],
];
export function terrainAt(x: number, distance: number, terrains: readonly Terrain[]): Terrain {
  const index = Math.max(0, Math.min(terrains.length - 1, Math.floor(x / distance * terrains.length)));
  return terrains[index] ?? "grass";
}
export function groundHeight(x: number, distance: number, terrains: readonly Terrain[]): number {
  if (x < 0 || x > distance || terrainAt(x, distance, terrains) !== "hill") return 0;
  const length = distance / terrains.length;
  return 0.35 * Math.sin((x % length) / length * Math.PI * 4);
}
