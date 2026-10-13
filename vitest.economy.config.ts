import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.sim.ts"],
    testTimeout: 1_200_000,
    reporters: ["verbose"],
  },
});
