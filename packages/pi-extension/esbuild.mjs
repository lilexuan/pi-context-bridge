import { build } from "esbuild";
import path from "node:path";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@earendil-works/pi-coding-agent", "typebox"],
  alias: {
    "@pi-context-bridge/protocol": path.resolve("../protocol/src/index.ts"),
  },
  sourcemap: true,
});
