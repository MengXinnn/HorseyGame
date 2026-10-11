import { describe, expect, it } from "vitest";
import { HOME } from "../src/game/state";
import { crossesFence, INTERACTS, LAOZHAO_SPOT, MAP_H, MAP_W, PADDOCK, regionAt, TIEDUN_SPOT, walkable, WILDS, YARD } from "../src/world/tiles";

/** 人站得住：和 world.ts 里一样，左右各留 0.3 格的身宽。 */
const standable = (x: number, z: number): boolean => walkable(x - 0.3, z) && walkable(x + 0.3, z);

/** 从家门口出发，按半格一步能走到的地方（不穿墙、不跨栅栏、不下水）。 */
function reachable(): Set<string> {
  const step = 0.5;
  const key = (x: number, z: number): string => `${x},${z}`;
  const seen = new Set<string>();
  const sx = Math.round(HOME.x / step) * step;
  const sz = Math.round(HOME.z / step) * step;
  const queue: Array<[number, number]> = [[sx, sz]];
  seen.add(key(sx, sz));
  while (queue.length) {
    const [x, z] = queue.pop()!;
    for (const [dx, dz] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 1 || nz < 1 || nx > MAP_W - 1 || nz > MAP_H - 1) continue;
      const k = key(nx, nz);
      if (seen.has(k) || !standable(nx, nz) || crossesFence(x, z, nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

describe("大世界地图", () => {
  const seen = reachable();
  const near = (x: number, z: number, r: number): boolean => {
    for (let dz = -r; dz <= r; dz += 0.5) for (let dx = -r; dx <= r; dx += 0.5) if (Math.hypot(dx, dz) <= r && seen.has(`${Math.round((x + dx) * 2) / 2},${Math.round((z + dz) * 2) / 2}`)) return true;
    return false;
  };

  it("家门口站得住", () => {
    expect(standable(HOME.x, HOME.z)).toBe(true);
  });

  it("每个能互动的地方都走得到", () => {
    for (const it of INTERACTS) expect(near(it.x, it.z, it.radius * 0.9), it.id).toBe(true);
  });

  it("赛后传送回场边的位置站得住", () => {
    for (const id of ["race", "sumo"] as const) {
      const spot = INTERACTS.find((i) => i.id === id)!;
      expect(standable(spot.x, spot.z + 1), id).toBe(true);
    }
  });

  it("牧场、野原、老赵的院子都进得去", () => {
    expect(near((PADDOCK.x0 + PADDOCK.x1) / 2, (PADDOCK.z0 + PADDOCK.z1) / 2, 2)).toBe(true);
    expect(near((WILDS.x0 + WILDS.x1) / 2, (WILDS.z0 + WILDS.z1) / 2, 3)).toBe(true);
    expect(near((YARD.x0 + YARD.x1) / 2, (YARD.z0 + YARD.z1) / 2, 3)).toBe(true);
  });

  it("老赵和铁墩站的地方在对的区域里", () => {
    expect(regionAt(LAOZHAO_SPOT.x, LAOZHAO_SPOT.z)?.id).toBe("arena");
    expect(regionAt(TIEDUN_SPOT.x, TIEDUN_SPOT.z)?.id).toBe("arena");
  });

  it("研究所不在镇子里", () => {
    const seq = INTERACTS.find((i) => i.id === "sequence")!;
    expect(regionAt(seq.x, seq.z)?.id).toBe("lab");
  });
});
