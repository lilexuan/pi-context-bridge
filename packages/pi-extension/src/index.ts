import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  BridgeInstanceRecord,
  EditorContextSnapshot,
  EditorStatusSnapshot,
} from "@pi-context-bridge/protocol";
import { getContext, getHealth, getStatus, setSelectionSharing } from "./client.js";
import { discoverInstance, loadInstances } from "./discovery.js";
import { formatContext, instanceLabel, statusLabel } from "./format.js";
import { createStatusWidget } from "./status-widget.js";

const STATUS_ID = "pi-context-bridge";
// Agent starts and explicit context requests always fetch immediately. The
// background refresh only keeps the small status widget current, so a slower
// cadence avoids unnecessary HTTP/JSON/GC churn while Pi is idle.
const LIVE_REFRESH_INTERVAL_MS = 2_000;
const MAXIMUM_RECONNECT_INTERVAL_MS = 30_000;

function minimalStatus(
  snapshot: EditorContextSnapshot | EditorStatusSnapshot,
): EditorStatusSnapshot {
  const editor = snapshot.activeEditor;
  const cursor = editor?.cursor ?? editor?.selection?.end ?? { line: 0, character: 0 };
  return {
    protocolVersion: snapshot.protocolVersion,
    instanceId: snapshot.instanceId,
    capturedAt: snapshot.capturedAt,
    appName: snapshot.appName,
    activeEditor: editor
      ? {
          uri: editor.uri,
          fsPath: editor.fsPath,
          relativePath: editor.relativePath,
          cursor: { ...cursor },
          selection: editor.selection
            ? {
                start: { ...editor.selection.start },
                end: { ...editor.selection.end },
                isEmpty: editor.selection.isEmpty,
              }
            : { start: { ...cursor }, end: { ...cursor }, isEmpty: true },
        }
      : null,
    selectionTextSharingEnabled: snapshot.selectionTextSharingEnabled,
  };
}

export default function piContextBridge(pi: ExtensionAPI): void {
  let connected: BridgeInstanceRecord | undefined;
  let latestStatus: EditorStatusSnapshot | undefined;
  let manuallyDisconnected = false;
  let discoveryNoticeShown = false;
  let liveRefreshTimer: NodeJS.Timeout | undefined;
  let liveRefreshAbortController: AbortController | undefined;
  let liveRefreshRunId = 0;
  let lifecycleGeneration = 0;
  let lastStatusLabel: string | undefined;
  let transientContext: { content: string; timestamp: number } | undefined;

  const updateStatus = (ctx: ExtensionContext): void => {
    const label = statusLabel(latestStatus, connected);
    if (label === lastStatusLabel) return;
    lastStatusLabel = label;
    ctx.ui.setWidget(STATUS_ID, createStatusWidget(label), { placement: "aboveEditor" });
  };

  const stopLiveRefresh = (): void => {
    liveRefreshRunId += 1;
    if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
    liveRefreshAbortController?.abort();
    liveRefreshTimer = undefined;
    liveRefreshAbortController = undefined;
  };

  const connectAutomatically = async (
    cwd: string,
    ctx: ExtensionContext,
    generation: number,
  ): Promise<BridgeInstanceRecord | undefined> => {
    const route = await discoverInstance(cwd);
    if (generation !== lifecycleGeneration) return undefined;
    if (route.kind === "matched") {
      connected = route.instance;
      discoveryNoticeShown = false;
      return connected;
    }
    connected = undefined;
    latestStatus = undefined;
    updateStatus(ctx);
    if (!discoveryNoticeShown) {
      const message = route.kind === "ambiguous"
        ? "Multiple VS Code windows match this working directory. Use /vscode connect to choose one."
        : "No matching VS Code window found. Install/enable Pi Context Bridge in VS Code, or use /vscode connect.";
      ctx.ui.notify(message, "warning");
      discoveryNoticeShown = true;
    }
    return undefined;
  };

  const ensureConnection = async (
    ctx: ExtensionContext,
    generation: number,
  ): Promise<BridgeInstanceRecord | undefined> => {
    if (manuallyDisconnected) return undefined;
    if (connected) return connected;
    return connectAutomatically(ctx.cwd, ctx, generation);
  };

  const requestBridge = async <T>(
    ctx: ExtensionContext,
    request: (instance: BridgeInstanceRecord) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T | undefined> => {
    const generation = lifecycleGeneration;
    const instance = await ensureConnection(ctx, generation);
    if (!instance || generation !== lifecycleGeneration) return undefined;
    try {
      const result = await request(instance);
      return generation === lifecycleGeneration ? result : undefined;
    } catch {
      if (signal?.aborted || generation !== lifecycleGeneration) return undefined;
      if (connected?.instanceId === instance.instanceId && connected.endpoint === instance.endpoint) {
        connected = undefined;
      }
      latestStatus = undefined;
      const replacement = await connectAutomatically(ctx.cwd, ctx, generation);
      if (!replacement || generation !== lifecycleGeneration) return undefined;
      if (replacement.instanceId === instance.instanceId && replacement.endpoint === instance.endpoint) {
        connected = undefined;
        updateStatus(ctx);
        return undefined;
      }
      try {
        const result = await request(replacement);
        return generation === lifecycleGeneration ? result : undefined;
      } catch {
        if (signal?.aborted || generation !== lifecycleGeneration) return undefined;
        if (connected?.instanceId === replacement.instanceId && connected.endpoint === replacement.endpoint) {
          connected = undefined;
        }
        latestStatus = undefined;
        updateStatus(ctx);
        return undefined;
      }
    }
  };

  const refreshContext = async (
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<EditorContextSnapshot | undefined> => {
    const snapshot = await requestBridge(ctx, (instance) => getContext(instance, signal), signal);
    if (!snapshot) return undefined;
    latestStatus = minimalStatus(snapshot);
    updateStatus(ctx);
    return snapshot;
  };

  const refreshStatus = async (
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<EditorStatusSnapshot | undefined> => {
    const status = await requestBridge(ctx, (instance) => getStatus(instance, signal), signal);
    if (!status) return undefined;
    latestStatus = minimalStatus(status);
    updateStatus(ctx);
    return status;
  };

  const startLiveRefresh = (ctx: ExtensionContext): void => {
    stopLiveRefresh();
    const runId = liveRefreshRunId;
    const schedule = (delay: number): void => {
      liveRefreshTimer = setTimeout(() => {
        if (manuallyDisconnected || runId !== liveRefreshRunId) return;
        const controller = new AbortController();
        liveRefreshAbortController = controller;
        void refreshStatus(ctx, controller.signal).finally(() => {
          if (runId !== liveRefreshRunId) return;
          liveRefreshAbortController = undefined;
          const nextDelay = connected
            ? LIVE_REFRESH_INTERVAL_MS
            : Math.min(delay * 2, MAXIMUM_RECONNECT_INTERVAL_MS);
          schedule(nextDelay);
        });
      }, delay);
      liveRefreshTimer.unref();
    };
    schedule(LIVE_REFRESH_INTERVAL_MS);
  };

  pi.on("session_start", async (_event, ctx) => {
    lifecycleGeneration += 1;
    const generation = lifecycleGeneration;
    stopLiveRefresh();
    manuallyDisconnected = false;
    discoveryNoticeShown = false;
    transientContext = undefined;
    latestStatus = undefined;
    await refreshStatus(ctx);
    if (generation !== lifecycleGeneration) return;
    startLiveRefresh(ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const generation = lifecycleGeneration;
    transientContext = undefined;
    const snapshot = await refreshContext(ctx, ctx.signal);
    if (!snapshot || generation !== lifecycleGeneration) return;
    transientContext = { content: formatContext(snapshot), timestamp: Date.now() };
  });

  // before_agent_start messages are persisted in Pi's append-only session even
  // when display=false. Injecting the live editor state through the context
  // hook keeps it available for every model call in this turn without retaining
  // one copy per prompt in memory and on disk.
  pi.on("context", async (event) => {
    const messages = event.messages.filter(
      (message) => message.role !== "custom" || message.customType !== STATUS_ID,
    );
    if (!transientContext) {
      return messages.length === event.messages.length ? undefined : { messages };
    }

    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    const insertionIndex = lastUserIndex + 1;
    const message = {
      role: "custom" as const,
      customType: STATUS_ID,
      content: transientContext.content,
      display: false,
      timestamp: transientContext.timestamp,
    };
    return {
      messages: [
        ...messages.slice(0, insertionIndex),
        message,
        ...messages.slice(insertionIndex),
      ],
    };
  });

  pi.on("agent_settled", async () => {
    transientContext = undefined;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    lifecycleGeneration += 1;
    stopLiveRefresh();
    transientContext = undefined;
    latestStatus = undefined;
    connected = undefined;
    lastStatusLabel = undefined;
    ctx.ui.setWidget(STATUS_ID, undefined);
  });

  pi.registerTool({
    name: "vscode_get_context",
    label: "VS Code Context",
    description: "Get the live active file, cursor, selection, selected text (when sharing is enabled), workspace folders, and open editors from VS Code.",
    // This is the exact JSON schema emitted by Type.Object({}). Keeping the
    // trivial schema inline avoids loading an entire schema-builder package.
    parameters: { type: "object", properties: {} },
    async execute(_toolCallId, _parameters, signal, _onUpdate, ctx) {
      const snapshot = await refreshContext(ctx, signal);
      if (!snapshot) {
        return {
          content: [{ type: "text", text: "No matching VS Code window is connected. Use /vscode connect or open the Pi working directory in VS Code." }],
          details: { connected: false },
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: formatContext(snapshot) }],
        // Tool details are persisted by Pi but are not sent to the model. Keep
        // only routing metadata instead of storing selected text a second time.
        details: {
          connected: true,
          instanceId: snapshot.instanceId,
          capturedAt: snapshot.capturedAt,
        },
      };
    },
  });

  pi.registerCommand("vscode", {
    description: "Manage the VS Code context bridge (status, connect, disconnect, context, toggle-selection)",
    handler: async (rawArguments, ctx) => {
      const [subcommand = "status"] = rawArguments.trim().split(/\s+/);
      const commandGeneration = lifecycleGeneration;
      if (subcommand === "status") {
        const health = await requestBridge(ctx, (instance) => getHealth(instance, ctx.signal), ctx.signal);
        if (commandGeneration !== lifecycleGeneration) return;
        if (!health || !connected) {
          ctx.ui.notify("The selected VS Code bridge is no longer responding.", "warning");
          return;
        }
        ctx.ui.notify(`Connected to ${instanceLabel(connected)}. Selection text sharing is ${latestStatus?.selectionTextSharingEnabled ?? "unknown"}.`, "info");
        return;
      }

      if (subcommand === "connect") {
        const instances = await loadInstances();
        if (commandGeneration !== lifecycleGeneration) return;
        if (instances.length === 0) {
          ctx.ui.notify("No Pi Context Bridge instances found. Install and enable the VS Code extension first.", "warning");
          return;
        }
        const labels = instances.map(instanceLabel);
        const selected = await ctx.ui.select("Connect to a VS Code window", labels);
        if (commandGeneration !== lifecycleGeneration) return;
        if (!selected) return;
        lifecycleGeneration += 1;
        const generation = lifecycleGeneration;
        stopLiveRefresh();
        connected = instances[labels.indexOf(selected)];
        latestStatus = undefined;
        transientContext = undefined;
        manuallyDisconnected = false;
        discoveryNoticeShown = false;
        await refreshStatus(ctx);
        if (generation !== lifecycleGeneration) return;
        startLiveRefresh(ctx);
        ctx.ui.notify(`Connected to ${selected}.`, "info");
        return;
      }

      if (subcommand === "disconnect") {
        lifecycleGeneration += 1;
        stopLiveRefresh();
        connected = undefined;
        latestStatus = undefined;
        transientContext = undefined;
        manuallyDisconnected = true;
        updateStatus(ctx);
        ctx.ui.notify("Disconnected from VS Code for this Pi session.", "info");
        return;
      }

      if (subcommand === "context") {
        const snapshot = await refreshContext(ctx, ctx.signal);
        if (commandGeneration !== lifecycleGeneration) return;
        ctx.ui.notify(snapshot ? formatContext(snapshot) : "No matching VS Code window is connected.", snapshot ? "info" : "warning");
        return;
      }

      if (subcommand === "toggle-selection") {
        const status = await refreshStatus(ctx, ctx.signal);
        if (commandGeneration !== lifecycleGeneration) return;
        if (!connected || !status) {
          ctx.ui.notify("No matching VS Code window is connected.", "warning");
          return;
        }
        const generation = lifecycleGeneration;
        const instance = connected;
        const result = await setSelectionSharing(instance, !status.selectionTextSharingEnabled, ctx.signal);
        if (generation !== lifecycleGeneration) return;
        await refreshStatus(ctx, ctx.signal);
        if (generation !== lifecycleGeneration) return;
        ctx.ui.notify(`VS Code selection text sharing ${result.enabled ? "enabled" : "disabled"}.`, "info");
        return;
      }

      ctx.ui.notify("Usage: /vscode [status|connect|disconnect|context|toggle-selection]", "warning");
    },
  });
}
