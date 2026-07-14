import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@pi-context-bridge/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] }
  }
});
