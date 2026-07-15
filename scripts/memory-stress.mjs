import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import http from "node:http";
import process from "node:process";
import { setImmediate } from "node:timers/promises";
import { build } from "../packages/pi-extension/node_modules/esbuild/lib/main.js";

if (typeof globalThis.gc !== "function") {
  throw new Error("Run this test through `pnpm test:memory` so explicit GC is enabled.");
}

const clientEntry = process.env.PI_BRIDGE_CLIENT_ENTRY ?? "packages/pi-extension/src/client.ts";
const benchmarkLabel = process.env.PI_BRIDGE_BENCHMARK_LABEL ?? "optimized";
const [{ text: bundledClient }] = (await build({
  entryPoints: [clientEntry],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
})).outputFiles;
const clientUrl = `data:text/javascript;base64,${Buffer.from(bundledClient).toString("base64")}`;
const { getContext } = await import(clientUrl);

const baseSnapshot = {
  protocolVersion: 1,
  instanceId: "memory-test",
  capturedAt: "2026-01-01T00:00:00.000Z",
  appName: "Code",
  workspaceFolders: [],
  activeEditor: {
    uri: "file:///large.txt",
    fsPath: "/large.txt",
    languageId: "plaintext",
    isDirty: false,
    isActive: true,
    selection: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 500_000_000 },
      isEmpty: false,
    },
  },
  openEditors: [],
  selectionTextSharingEnabled: true,
};
const metadataBody = JSON.stringify(baseSnapshot);
const contextBody = JSON.stringify({
  ...baseSnapshot,
  activeEditor: {
    ...baseSnapshot.activeEditor,
    selection: {
      ...baseSnapshot.activeEditor.selection,
      text: "x".repeat(20_000),
      truncated: true,
      originalCharacterCount: 500_000_000,
    },
  },
});

const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(request.url?.includes("includeSelectionText=false") ? metadataBody : contextBody);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");

const instance = {
  endpoint: `http://127.0.0.1:${address.port}`,
  token: "secret",
};
const heapMiB = () => process.memoryUsage().heapUsed / 1024 / 1024;
const collect = async () => {
  await setImmediate();
  globalThis.gc();
  globalThis.gc();
  return heapMiB();
};
const exercise = async (count, includeSelectionText) => {
  for (let index = 0; index < count; index += 1) {
    await getContext(instance, undefined, includeSelectionText);
  }
};

try {
  // Warm up fetch/Undici connection pools before measuring retained heap.
  await exercise(500, false);
  const baseline = await collect();
  const samples = [];
  for (let round = 0; round < 10; round += 1) {
    await exercise(1_000, false);
    samples.push(await collect());
  }
  // Also cover user-triggered full context reads at the maximum default size.
  await exercise(2_000, true);
  const final = await collect();
  const retainedGrowth = final - baseline;

  // 10,000 background refreshes represent more than five hours at the new
  // interval. A generous ceiling avoids allocator noise while catching
  // accidentally retained responses, snapshots, or AbortControllers.
  assert.ok(
    retainedGrowth < 16,
    `retained heap grew by ${retainedGrowth.toFixed(2)} MiB (limit: 16 MiB)`,
  );
  process.stdout.write(`${JSON.stringify({
    benchmark: benchmarkLabel,
    backgroundRefreshes: 10_000,
    fullContextReads: 2_000,
    baselineHeapMiB: Number(baseline.toFixed(2)),
    peakSampleHeapMiB: Number(Math.max(...samples, final).toFixed(2)),
    finalHeapMiB: Number(final.toFixed(2)),
    retainedGrowthMiB: Number(retainedGrowth.toFixed(2)),
  }, null, 2)}\n`);
} finally {
  server.closeIdleConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
