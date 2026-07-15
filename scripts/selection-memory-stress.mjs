import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import process from "node:process";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "../packages/pi-extension/node_modules/esbuild/lib/main.js";

const MEMORY_KEYS = ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers"];
const MEBIBYTE = 1024 * 1024;
const mode = process.env.PI_BRIDGE_SELECTION_BENCHMARK_MODE;
const selectionCharacters = positiveInteger("PI_BRIDGE_SELECTION_CHARACTERS", 64 * MEBIBYTE);
const maximumCharacters = positiveInteger("PI_BRIDGE_SELECTION_LIMIT", 20_000);
const selectionEntry = process.env.PI_BRIDGE_SELECTION_ENTRY ?? "packages/vscode-extension/src/selection.ts";
const skipAssertions = /^(?:1|true|yes)$/i.test(process.env.PI_BRIDGE_SKIP_MEMORY_ASSERTIONS ?? "");

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received ${JSON.stringify(raw)}`);
  }
  return value;
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return Object.fromEntries(MEMORY_KEYS.map((key) => [key, usage[key]]));
}

function memoryMiB(snapshot) {
  return Object.fromEntries(MEMORY_KEYS.map((key) => [key, Number((snapshot[key] / MEBIBYTE).toFixed(2))]));
}

function memoryDeltaMiB(snapshot, baseline) {
  return Object.fromEntries(
    MEMORY_KEYS.map((key) => [key, Number(((snapshot[key] - baseline[key]) / MEBIBYTE).toFixed(2))]),
  );
}

async function collectMemory() {
  await setImmediate();
  globalThis.gc();
  globalThis.gc();
  await setImmediate();
  return memorySnapshot();
}

async function importSelectionPlanner() {
  const [{ text: bundledSelection }] = (await build({
    absWorkingDir: process.cwd(),
    entryPoints: [selectionEntry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
  })).outputFiles;
  return import(`data:text/javascript;base64,${Buffer.from(bundledSelection).toString("base64")}`);
}

async function runWorker(workerMode) {
  if (typeof globalThis.gc !== "function") {
    throw new Error("Selection benchmark workers require --expose-gc.");
  }

  let planSelectionRead;
  if (workerMode === "bounded") {
    ({ planSelectionRead } = await importSelectionPlanner());
  }

  let requestedCharacters = 0;
  let afterRead;
  const document = {
    offsetAt(position) { return position.character; },
    positionAt(offset) { return { line: 0, character: offset }; },
    getText(range) {
      requestedCharacters = range.end.character - range.start.character;
      const text = "x".repeat(requestedCharacters);
      // Force V8 to flatten and materialize the repeated string before sampling.
      text.charCodeAt(text.length - 1);
      afterRead = memorySnapshot();
      return text;
    },
  };
  const selection = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: selectionCharacters },
    isEmpty: false,
  };

  const baseline = await collectMemory();
  let plan;
  const readLegacySelection = () => {
    const text = document.getText(selection);
    return text.length <= maximumCharacters ? text : text.slice(0, maximumCharacters);
  };
  const readBoundedSelection = () => {
    plan = planSelectionRead(document, selection, maximumCharacters);
    return document.getText({ start: selection.start, end: plan.end });
  };

  let selectedText = workerMode === "legacy" ? readLegacySelection() : readBoundedSelection();
  const retained = await collectMemory();
  selectedText = undefined;
  const released = await collectMemory();
  // Keep the assignment observable until after both collections.
  void selectedText;

  const peak = Object.fromEntries(
    MEMORY_KEYS.map((key) => [key, Math.max(baseline[key], afterRead[key], retained[key], released[key])]),
  );
  return {
    mode: workerMode,
    selectionCharacters,
    maximumCharacters,
    requestedCharacters,
    plan: plan
      ? { truncated: plan.truncated, originalCharacterCount: plan.originalCharacterCount }
      : { truncated: selectionCharacters > maximumCharacters, originalCharacterCount: selectionCharacters },
    baselineMiB: memoryMiB(baseline),
    afterReadMiB: memoryMiB(afterRead),
    sampledPeakMiB: memoryMiB(peak),
    retainedPostGcMiB: memoryMiB(retained),
    retainedDeltaMiB: memoryDeltaMiB(retained, baseline),
    releasedPostGcMiB: memoryMiB(released),
  };
}

function spawnWorker(workerMode) {
  const scriptPath = fileURLToPath(import.meta.url);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, PI_BRIDGE_SELECTION_BENCHMARK_MODE: workerMode },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(new Error(
          `selection ${workerMode} worker failed (${signal ?? `exit ${code}`}): ${stderr || stdout}`,
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`selection ${workerMode} worker returned invalid JSON: ${stdout}`, { cause: error }));
      }
    });
  });
}

if (mode) {
  if (mode !== "legacy" && mode !== "bounded") throw new Error(`Unknown selection benchmark mode: ${mode}`);
  process.stdout.write(JSON.stringify(await runWorker(mode)));
} else {
  // Run sequentially so the legacy allocation and bounded allocation cannot
  // overlap or contaminate one another's V8 heap/RSS high-water marks.
  const legacy = await spawnWorker("legacy");
  const bounded = await spawnWorker("bounded");
  const comparison = {
    benchmark: "large-selection",
    selectionCharacters,
    maximumCharacters,
    assertionsSkipped: skipAssertions,
    legacy,
    bounded,
    savedMiB: {
      sampledPeakHeapUsed: Number((legacy.sampledPeakMiB.heapUsed - bounded.sampledPeakMiB.heapUsed).toFixed(2)),
      sampledPeakRss: Number((legacy.sampledPeakMiB.rss - bounded.sampledPeakMiB.rss).toFixed(2)),
      retainedHeapUsed: Number((legacy.retainedPostGcMiB.heapUsed - bounded.retainedPostGcMiB.heapUsed).toFixed(2)),
      retainedRss: Number((legacy.retainedPostGcMiB.rss - bounded.retainedPostGcMiB.rss).toFixed(2)),
    },
  };
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);

  if (!skipAssertions) {
    assert.equal(legacy.requestedCharacters, selectionCharacters, "legacy path must read the entire selection");
    assert.equal(bounded.requestedCharacters, maximumCharacters, "bounded path must read only the configured limit");
    assert.equal(bounded.plan.truncated, true, "bounded path must report truncation");
    assert.equal(
      bounded.plan.originalCharacterCount,
      selectionCharacters,
      "bounded path must preserve the original selection length",
    );
    assert.ok(
      legacy.sampledPeakMiB.heapUsed - legacy.baselineMiB.heapUsed > 32,
      "legacy path should demonstrate a large whole-selection allocation",
    );
    assert.ok(
      bounded.sampledPeakMiB.heapUsed - bounded.baselineMiB.heapUsed < 8,
      "bounded path allocated more than 8 MiB of heap",
    );
  }
}
