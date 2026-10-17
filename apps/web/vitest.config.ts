import { fileURLToPath } from "node:url";
import { appVersionPlugin } from "./appVersion";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [await appVersionPlugin(fileURLToPath(new URL("../..", import.meta.url)))],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
