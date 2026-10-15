import type { TimeOfDay } from "../render/scene";

export const DAY_START = 6 * 60;
export const MIDNIGHT = 24 * 60;
export const TRAVEL_TILES = 40;
export const TRAVEL_MINUTES = 15;

export function phaseOf(clock: number): TimeOfDay {
  if (clock < 10 * 60) return "dawn";
  if (clock < 16 * 60) return "noon";
  if (clock < 19 * 60) return "dusk";
  return "night";
}

export function formatClock(clock: number): string {
  const m = Math.floor(clock) % MIDNIGHT;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
