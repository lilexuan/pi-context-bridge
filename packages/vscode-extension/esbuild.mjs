import { build } from "esbuild";
import path from "node:path";

await build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  alias: {
    "@pi-context-bridge/protocol": path.resolve("../protocol/src/index.ts"),
  },
  sourcemap: true,
});
