import { describe, expect, it } from "vitest";
import { ambientAt } from "../src/world/lighting";
import { blocksSun, boxFootprint, roundFootprint, shadowPolygon, SolarField, sunAt, type SunCaster } from "../src/world/sunlight";
import { Raster } from "../src/world/raster";

const house: SunCaster = { id: "house", footprint: boxFootprint(0, 0, 20, 20), bottom: 0, height: 40 };
const sun = { dx: 1, dz: 0.5, power: 1 };

describe("世界日照", () => {
  it("早晚长影朝相反方向，正午影子短；夜间没有太阳投影", () => {
    const morning = sunAt(7.5 * 60);
    const noon = sunAt(12.75 * 60);
    const evening = sunAt(18 * 60);
    expect(morning.dx).toBeGreaterThan(0);
    expect(evening.dx).toBeLessThan(0);
    expect(morning.dx).toBeCloseTo(-evening.dx);
    expect(Math.hypot(noon.dx, noon.dz)).toBeLessThan(Math.hypot(morning.dx, morning.dz));
    for (const h of [0, 5, 6, 19.5, 21, 24]) expect(sunAt(h * 60).power).toBe(0);
    expect(sunAt(6.1 * 60).power).toBeLessThan(sunAt(7 * 60).power);
  });

  it("只有下游且低于遮挡物的接收点进入阴影，头部可先离开影区", () => {
    expect(blocksSun(house, sun, 35, 20)).toBe(true);
    expect(blocksSun(house, sun, -10, 10)).toBe(false);
    expect(blocksSun(house, sun, 35, 20, 30)).toBe(false);
    expect(blocksSun(house, sun, 10, 10, 45)).toBe(false);
    expect(blocksSun(house, { ...sun, power: 0 }, 35, 20)).toBe(false);
  });

  it("画在地上的影区与射线遮挡一致", () => {
    const raster = new Raster(90, 60);
    raster.poly(shadowPolygon(house, sun), "#ffffff");
    for (const [x, z] of [[10, 10], [35, 20], [50, 35], [70, 10], [30, 50]])
      expect(raster.get(x!, z!) !== 0).toBe(blocksSun(house, sun, x! + 0.5, z! + 0.5));
  });

  it("带偏移填多边形等同于先平移各点", () => {
    const polygon = shadowPolygon(house, sun);
    const shifted = new Raster(90, 60);
    shifted.poly(polygon.map(([x, z]): [number, number] => [x - 7, z - 5]), "#ffffff");
    const offset = new Raster(90, 60);
    offset.poly(polygon, "#ffffff", 7, 5);
    expect(offset.data).toEqual(shifted.data);
  });

    it("悬空树冠的投影保留高度，不当成落地的墙", () => {
    const tree: SunCaster = { id: "tree", footprint: roundFootprint(0, 0, 5), bottom: 20, height: 40 };
    const lowSun = { dx: 1, dz: 0, power: 1 };
    expect(blocksSun(tree, lowSun, 0, 0)).toBe(false);
    expect(blocksSun(tree, lowSun, 30, 0)).toBe(true);
  });

  it("画面外物体的长影进入视野；高处接收点和自遮挡排除也使用相同索引", () => {
    const tower = { ...house, height: 90 };
    const field = new SolarField([tower]);
    field.update(7 * 60);
    const x = 10 + field.sun.dx * 65;
    const z = 10 + field.sun.dz * 65;
    expect(x).toBeGreaterThan(96);
    expect(field.visible(x - 5, z - 5, 10, 10).map((p) => p.caster.id)).toContain("house");
    expect(field.shaded(x, z)).toBe(true);
    expect(field.shaded(10, 10, 80)).toBe(true);
    expect(field.shaded(10, 10, 80, "house")).toBe(false);
    field.update(21 * 60);
    expect(field.shaded(x, z)).toBe(false);
  });

  it("色调经过清晨暖色、正午冷白、傍晚金色和夜间蓝色，并连续过渡", () => {
    const morning = ambientAt(7.2 * 60);
    const noon = ambientAt(12 * 60);
    const evening = ambientAt(17.2 * 60);
    const night = ambientAt(21 * 60);
    expect(morning.color).toBe("#ffe3bc");
    expect(noon.color).toBe("#f4f8ff");
    expect(evening.color).toBe("#ffd39a");
    expect(night.color).toBe("#36427e");
    expect(ambientAt(10 * 60).color).not.toBe(ambientAt(11 * 60).color);
    for (const h of [6, 7.2, 9, 12, 15.5, 17.2, 18.6, 19.8, 21]) {
      const a = parseInt(ambientAt(h * 60 - 0.001).color.slice(1), 16);
      const b = parseInt(ambientAt(h * 60 + 0.001).color.slice(1), 16);
      for (const shift of [0, 8, 16]) expect(Math.abs(((a >> shift) & 255) - ((b >> shift) & 255))).toBeLessThanOrEqual(1);
    }
  });
});
