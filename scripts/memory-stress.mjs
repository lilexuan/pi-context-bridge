import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearInterval, setInterval } from "node:timers";
import { setImmediate } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { build } from "../packages/pi-extension/node_modules/esbuild/lib/main.js";

if (typeof globalThis.gc !== "function") {
  throw new Error("Run this test through `pnpm test:memory` so explicit GC is enabled.");
}

const MEMORY_KEYS = ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers"];
const MEBIBYTE = 1024 * 1024;
const benchmarkLabel = process.env.PI_BRIDGE_BENCHMARK_LABEL ?? "optimized";
const clientEntry = process.env.PI_BRIDGE_CLIENT_ENTRY ?? "packages/pi-extension/src/client.ts";
const pluginEntry = process.env.PI_BRIDGE_PLUGIN_ENTRY ?? "packages/pi-extension/src/index.ts";
const skipAssertions = /^(?:1|true|yes)$/i.test(process.env.PI_BRIDGE_SKIP_MEMORY_ASSERTIONS ?? "");
const backgroundRefreshes = positiveInteger("PI_BRIDGE_BACKGROUND_REFRESHES", 10_000);
const fullContextReads = positiveInteger("PI_BRIDGE_FULL_CONTEXT_READS", 2_000);
const pluginTurns = positiveInteger("PI_BRIDGE_PLUGIN_TURNS", 1_000);
const instanceId = "00000000-0000-4000-8000-000000000001";

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

function heapSlopeMiBPer100(samples, operationCount) {
  if (samples.length < 2) return 0;
  const spacing = operationCount / samples.length;
  const points = samples.map((sample, index) => ({
    x: (index + 1) * spacing,
    y: sample.heapUsed,
  }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  return Number(((numerator / denominator) * 100 / MEBIBYTE).toFixed(3));
}

function updatePeak(peak) {
  const sample = memorySnapshot();
  for (const key of MEMORY_KEYS) peak[key] = Math.max(peak[key], sample[key]);
}

function startMemorySampler(initial) {
  const peak = { ...initial };
  const sample = () => updatePeak(peak);
  const timer = setInterval(sample, 1);
  timer.unref();
  return {
    sample,
    stop() {
      clearInterval(timer);
      sample();
      return peak;
    },
  };
}

async function collectMemory() {
  await setImmediate();
  globalThis.gc();
  globalThis.gc();
  await setImmediate();
  return memorySnapshot();
}

const benchmarkStubs = {
  name: "memory-benchmark-stubs",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^@earendil-works\/pi-tui$/ }, () => ({
      path: "pi-tui",
      namespace: "memory-benchmark-stub",
    }));
    buildApi.onResolve({ filter: /^typebox$/ }, () => ({
      path: "typebox",
      namespace: "memory-benchmark-stub",
    }));
    buildApi.onLoad({ filter: /.*/, namespace: "memory-benchmark-stub" }, ({ path: stubPath }) => {
      if (stubPath === "typebox") {
        return { contents: "export const Type = { Object: (properties) => ({ type: 'object', properties }) };" };
      }
      return {
        contents: [
          "export const visibleWidth = (value) => String(value).length;",
          "export const truncateToWidth = (value, width) => String(value).slice(0, Math.max(0, width));",
        ].join("\n"),
      };
    });
  },
};

async function importBundled(entry, includePluginRuntime = false) {
  const buildResult = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    alias: includePluginRuntime
      ? { "@pi-context-bridge/protocol": path.resolve("packages/protocol/src/index.ts") }
      : undefined,
    plugins: includePluginRuntime ? [benchmarkStubs] : undefined,
    nodePaths: [path.resolve("packages/pi-extension/node_modules")],
  });
  const [{ text: bundledModule }] = buildResult.outputFiles;
  return import(`data:text/javascript;base64,${Buffer.from(bundledModule).toString("base64")}`);
}

async function runInBatches(total, operation) {
  const samples = [];
  let completed = 0;
  for (let batch = 1; batch <= 10; batch += 1) {
    const target = Math.round((total * batch) / 10);
    await operation(target - completed);
    completed = target;
    samples.push(await collectMemory());
  }
  return samples;
}

const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-context-memory-"));
const workspace = path.join(runtimeRoot, "workspace");
await fs.mkdir(workspace, { recursive: true });
const previousUserProfile = process.env.USERPROFILE;
const previousXdgRuntimeDirectory = process.env.XDG_RUNTIME_DIR;
if (process.platform === "win32") process.env.USERPROFILE = runtimeRoot;
else process.env.XDG_RUNTIME_DIR = runtimeRoot;

const selectionPrefix = "x".repeat(19_984);
let responseSequence = 0;
const createSnapshot = (includeSelectionText) => {
  const sequence = String(responseSequence++).padStart(16, "0");
  const selection = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 500_000_000 },
    isEmpty: false,
    ...(includeSelectionText
      ? {
          text: `${selectionPrefix}${sequence}`,
          truncated: true,
          originalCharacterCount: 500_000_000,
        }
      : {}),
  };
  return {
    protocolVersion: 1,
    instanceId,
    capturedAt: `2026-01-01T00:00:00.${sequence.slice(-6)}Z`,
    appName: "Code",
    workspaceFolders: [{
      name: "workspace",
      uri: pathToFileURL(workspace).href,
      fsPath: workspace,
    }],
    activeEditor: {
      uri: pathToFileURL(path.join(workspace, "large.txt")).href,
      fsPath: path.join(workspace, "large.txt"),
      relativePath: "large.txt",
      languageId: "plaintext",
      isDirty: false,
      isActive: true,
      cursor: { line: 0, character: 0 },
      selection,
    },
    openEditors: [],
    selectionTextSharingEnabled: true,
  };
};

const server = http.createServer((request, response) => {
  const includeSelectionText = !request.url?.includes("includeSelectionText=false");
  const body = JSON.stringify(createSnapshot(includeSelectionText));
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");

const instance = {
  protocolVersion: 1,
  instanceId,
  pid: process.pid,
  endpoint: `http://127.0.0.1:${address.port}`,
  token: "secret",
  appName: "Code",
  platform: process.platform,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastFocusedAt: "2026-01-01T00:00:00.000Z",
  workspaceFolders: [{
    name: "workspace",
    uri: pathToFileURL(workspace).href,
    fsPath: workspace,
  }],
};

let pluginHandlers;
let pluginContext;
let pluginShutdown = false;
let results;
try {
  const registryDirectory = process.platform === "win32"
    ? path.join(runtimeRoot, ".pi", "agent", "pi-context-bridge", "instances")
    : path.join(runtimeRoot, "pi-context-bridge", "instances");
  await fs.mkdir(registryDirectory, { recursive: true });
  await fs.writeFile(path.join(registryDirectory, `${instance.instanceId}.json`), JSON.stringify(instance));

  const { getContext } = await importBundled(clientEntry);
  const exerciseClient = async (count, includeSelectionText, sampler) => {
    for (let index = 0; index < count; index += 1) {
      await getContext(instance, undefined, includeSelectionText);
      sampler.sample();
    }
  };

  await exerciseClient(500, false, { sample() {} });
  const clientBaseline = await collectMemory();
  const clientSampler = startMemorySampler(clientBaseline);
  const backgroundPostGc = await runInBatches(
    backgroundRefreshes,
    (count) => exerciseClient(count, false, clientSampler),
  );
  const fullContextPostGc = await runInBatches(
    fullContextReads,
    (count) => exerciseClient(count, true, clientSampler),
  );
  const clientFinal = await collectMemory();
  const clientPeak = clientSampler.stop();

  const pluginModule = await importBundled(pluginEntry, true);
  if (typeof pluginModule.default !== "function") throw new Error(`${pluginEntry} has no default plugin function`);

  pluginHandlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const extensionApi = {
    on(name, handler) {
      const handlers = pluginHandlers.get(name) ?? [];
      handlers.push(handler);
      pluginHandlers.set(name, handlers);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
  };
  pluginModule.default(extensionApi);

  const contextAbortController = new globalThis.AbortController();
  pluginContext = {
    cwd: workspace,
    signal: contextAbortController.signal,
    ui: {
      setWidget() {},
      notify() {},
      async select(_title, options) { return options[0]; },
    },
  };
  const emit = async (name, event) => {
    const eventResults = [];
    for (const handler of pluginHandlers.get(name) ?? []) {
      eventResults.push(await handler(event, pluginContext));
    }
    return eventResults;
  };
  const emitContext = async (messages) => {
    let currentMessages = globalThis.structuredClone(messages);
    for (const handler of pluginHandlers.get("context") ?? []) {
      const eventResult = await handler({ type: "context", messages: currentMessages }, pluginContext);
      if (eventResult?.messages) currentMessages = eventResult.messages;
    }
    return currentMessages;
  };

  await emit("session_start", { type: "session_start" });
  const pluginBaseline = await collectMemory();
  const pluginSampler = startMemorySampler(pluginBaseline);
  const retainedMessages = [];
  const pluginPostGc = [];
  const transientCounts = [];
  const postSettledCounts = [];
  const isBridgeMessage = (message) => message?.role === "custom" && message.customType === "pi-context-bridge";
  const continuationMessages = [
    { role: "user", content: [{ type: "text", text: "Inspect the current editor." }], timestamp: 1 },
    {
      role: "custom",
      customType: "pi-context-bridge",
      content: "stale persistent context from an older plugin version",
      display: false,
      timestamp: 1.5,
    },
    { role: "assistant", content: [], timestamp: 2 },
    { role: "toolResult", toolCallId: "memory-tool", toolName: "memory-tool", content: [], isError: false, timestamp: 3 },
  ];

  for (let turn = 1; turn <= pluginTurns; turn += 1) {
    const beforeResults = await emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Inspect the current editor.",
      systemPrompt: "You are a coding agent.",
      systemPromptOptions: {},
    });
    for (const eventResult of beforeResults) {
      if (!eventResult?.message) continue;
      retainedMessages.push({
        role: "custom",
        ...eventResult.message,
        timestamp: turn,
      });
    }

    const duringTurn = await emitContext(continuationMessages);
    transientCounts.push(duringTurn.filter(isBridgeMessage).length);
    await emit("agent_settled", { type: "agent_settled" });
    const afterSettled = await emitContext(continuationMessages);
    postSettledCounts.push(afterSettled.filter(isBridgeMessage).length);
    pluginSampler.sample();
    if (turn % Math.max(1, Math.round(pluginTurns / 10)) === 0) {
      pluginPostGc.push(await collectMemory());
    }
  }

  await emit("session_shutdown", { type: "session_shutdown" });
  pluginShutdown = true;
  const pluginFinal = await collectMemory();
  const pluginPeak = pluginSampler.stop();

  results = {
    benchmark: benchmarkLabel,
    assertionsSkipped: skipAssertions,
    client: {
      backgroundRefreshes,
      fullContextReads,
      baselineMiB: memoryMiB(clientBaseline),
      sampledPeakMiB: memoryMiB(clientPeak),
      backgroundPostGcMiB: backgroundPostGc.map(memoryMiB),
      fullContextPostGcMiB: fullContextPostGc.map(memoryMiB),
      finalPostGcMiB: memoryMiB(clientFinal),
      retainedDeltaMiB: memoryDeltaMiB(clientFinal, clientBaseline),
    },
    pluginLifecycle: {
      turns: pluginTurns,
      retainedMessages: retainedMessages.length,
      transientBridgeMessagesPerContext: {
        minimum: Math.min(...transientCounts),
        maximum: Math.max(...transientCounts),
      },
      bridgeMessagesAfterAgentSettled: {
        minimum: Math.min(...postSettledCounts),
        maximum: Math.max(...postSettledCounts),
      },
      heapSlopeMiBPer100Turns: heapSlopeMiBPer100(pluginPostGc, pluginTurns),
      baselineMiB: memoryMiB(pluginBaseline),
      sampledPeakMiB: memoryMiB(pluginPeak),
      postGcMiB: pluginPostGc.map(memoryMiB),
      finalPostGcMiB: memoryMiB(pluginFinal),
      retainedDeltaMiB: memoryDeltaMiB(pluginFinal, pluginBaseline),
    },
  };
} finally {
  if (pluginHandlers && pluginContext && !pluginShutdown) {
    for (const handler of pluginHandlers.get("session_shutdown") ?? []) {
      try {
        await handler({ type: "session_shutdown" }, pluginContext);
      } catch {
        // Preserve the original benchmark failure while still closing resources.
      }
    }
  }
  server.closeIdleConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  if (previousXdgRuntimeDirectory === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = previousXdgRuntimeDirectory;
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

if (!skipAssertions) {
  assert.ok(
    results.client.retainedDeltaMiB.heapUsed < 16,
    `client retained heap grew by ${results.client.retainedDeltaMiB.heapUsed.toFixed(2)} MiB (limit: 16 MiB)`,
  );
  assert.ok(
    results.client.retainedDeltaMiB.heapTotal < 16,
    `client reserved heap grew by ${results.client.retainedDeltaMiB.heapTotal.toFixed(2)} MiB (limit: 16 MiB)`,
  );
  assert.equal(
    results.pluginLifecycle.retainedMessages,
    0,
    "before_agent_start must not return persistent VS Code context messages",
  );
  assert.deepEqual(
    results.pluginLifecycle.transientBridgeMessagesPerContext,
    { minimum: 1, maximum: 1 },
    "each active agent turn must expose exactly one transient VS Code context message",
  );
  assert.deepEqual(
    results.pluginLifecycle.bridgeMessagesAfterAgentSettled,
    { minimum: 0, maximum: 0 },
    "agent_settled must release the transient VS Code context message",
  );
  assert.ok(
    results.pluginLifecycle.retainedDeltaMiB.heapUsed < 8,
    `plugin lifecycle retained heap grew by ${results.pluginLifecycle.retainedDeltaMiB.heapUsed.toFixed(2)} MiB (limit: 8 MiB)`,
  );
  assert.ok(
    results.pluginLifecycle.retainedDeltaMiB.heapTotal < 24,
    `plugin lifecycle reserved heap grew by ${results.pluginLifecycle.retainedDeltaMiB.heapTotal.toFixed(2)} MiB (limit: 24 MiB)`,
  );
  if (pluginTurns >= 500) {
    assert.ok(
      results.pluginLifecycle.heapSlopeMiBPer100Turns < 0.5,
      `plugin retained heap slope was ${results.pluginLifecycle.heapSlopeMiBPer100Turns.toFixed(3)} MiB per 100 turns (limit: 0.5 MiB)`,
    );
  }
}

if (!/^(?:0|false|no)$/i.test(process.env.PI_BRIDGE_RUN_SELECTION_BENCHMARK ?? "")) {
  await import("./selection-memory-stress.mjs");
}
