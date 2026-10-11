import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.long.ts"],
    testTimeout: 600_000,
    reporters: ["verbose"],
  },
});
