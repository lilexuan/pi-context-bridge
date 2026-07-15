import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BridgeInstanceRecord, EditorContextSnapshot } from "@pi-context-bridge/protocol";
import { getContext, getHealth, setSelectionSharing } from "./client.js";
import { discoverInstance, loadInstances } from "./discovery.js";
import { formatContext, instanceLabel, statusLabel } from "./format.js";
import { createStatusWidget } from "./status-widget.js";

const STATUS_ID = "pi-context-bridge";
// Agent starts and explicit context requests always fetch immediately. The
// background refresh only keeps the small status widget current, so a slower
// cadence avoids unnecessary HTTP/JSON/GC churn while Pi is idle.
const LIVE_REFRESH_INTERVAL_MS = 2_000;

export default function piContextBridge(pi: ExtensionAPI): void {
  let connected: BridgeInstanceRecord | undefined;
  let latestSnapshot: EditorContextSnapshot | undefined;
  let manuallyDisconnected = false;
  let discoveryNoticeShown = false;
  let liveRefreshTimer: NodeJS.Timeout | undefined;
  let liveRefreshAbortController: AbortController | undefined;
  let liveRefreshInFlight = false;
  let liveRefreshRunId = 0;
  let lastStatusLabel: string | undefined;

  const updateStatus = (ctx: ExtensionContext): void => {
    const label = statusLabel(latestSnapshot, connected);
    if (label === lastStatusLabel) return;
    lastStatusLabel = label;
    ctx.ui.setWidget(STATUS_ID, createStatusWidget(label), { placement: "aboveEditor" });
  };

  const stopLiveRefresh = (): void => {
    liveRefreshRunId += 1;
    if (liveRefreshTimer) clearInterval(liveRefreshTimer);
    liveRefreshAbortController?.abort();
    liveRefreshTimer = undefined;
    liveRefreshAbortController = undefined;
    liveRefreshInFlight = false;
  };

  const connectAutomatically = async (cwd: string, ctx: ExtensionContext): Promise<BridgeInstanceRecord | undefined> => {
    const route = await discoverInstance(cwd);
    if (route.kind === "matched") {
      connected = route.instance;
      manuallyDisconnected = false;
      discoveryNoticeShown = false;
      return connected;
    }
    connected = undefined;
    latestSnapshot = undefined;
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

  const ensureConnection = async (ctx: ExtensionContext): Promise<BridgeInstanceRecord | undefined> => {
    if (connected) return connected;
    if (manuallyDisconnected) return undefined;
    return connectAutomatically(ctx.cwd, ctx);
  };

  const refreshContext = async (
    ctx: ExtensionContext,
    signal?: AbortSignal,
    includeSelectionText = true,
  ): Promise<EditorContextSnapshot | undefined> => {
    const instance = await ensureConnection(ctx);
    if (!instance) return undefined;
    try {
      latestSnapshot = await getContext(instance, signal, includeSelectionText);
      updateStatus(ctx);
      return latestSnapshot;
    } catch {
      if (signal?.aborted) return undefined;
      connected = undefined;
      latestSnapshot = undefined;
      const replacement = await connectAutomatically(ctx.cwd, ctx);
      if (!replacement) return undefined;
      try {
        latestSnapshot = await getContext(replacement, signal, includeSelectionText);
        updateStatus(ctx);
        return latestSnapshot;
      } catch {
        connected = undefined;
        latestSnapshot = undefined;
        updateStatus(ctx);
        return undefined;
      }
    }
  };

  const startLiveRefresh = (ctx: ExtensionContext): void => {
    stopLiveRefresh();
    const runId = liveRefreshRunId;
    liveRefreshTimer = setInterval(() => {
      if (liveRefreshInFlight || manuallyDisconnected) return;
      liveRefreshInFlight = true;
      const controller = new AbortController();
      liveRefreshAbortController = controller;
      void refreshContext(ctx, controller.signal, false).finally(() => {
        if (runId !== liveRefreshRunId) return;
        liveRefreshAbortController = undefined;
        liveRefreshInFlight = false;
      });
    }, LIVE_REFRESH_INTERVAL_MS);
    liveRefreshTimer.unref();
  };

  pi.on("session_start", async (_event, ctx) => {
    stopLiveRefresh();
    manuallyDisconnected = false;
    discoveryNoticeShown = false;
    await refreshContext(ctx, undefined, false);
    startLiveRefresh(ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const snapshot = await refreshContext(ctx, ctx.signal);
    if (!snapshot) return;
    return {
      message: {
        customType: "pi-context-bridge",
        content: formatContext(snapshot),
        display: false,
      },
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopLiveRefresh();
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
        details: snapshot,
      };
    },
  });

  pi.registerCommand("vscode", {
    description: "Manage the VS Code context bridge (status, connect, disconnect, context, toggle-selection)",
    handler: async (rawArguments, ctx) => {
      const [subcommand = "status"] = rawArguments.trim().split(/\s+/);
      if (subcommand === "status") {
        if (!connected) await ensureConnection(ctx);
        if (!connected) {
          ctx.ui.notify("No matching VS Code window. Open this working directory in VS Code or run /vscode connect.", "warning");
          return;
        }
        try {
          await getHealth(connected);
          ctx.ui.notify(`Connected to ${instanceLabel(connected)}. Selection text sharing is ${latestSnapshot?.selectionTextSharingEnabled ?? "unknown"}.`, "info");
        } catch {
          connected = undefined;
          latestSnapshot = undefined;
          updateStatus(ctx);
          ctx.ui.notify("The selected VS Code bridge is no longer responding.", "warning");
        }
        return;
      }

      if (subcommand === "connect") {
        const instances = await loadInstances();
        if (instances.length === 0) {
          ctx.ui.notify("No Pi Context Bridge instances found. Install and enable the VS Code extension first.", "warning");
          return;
        }
        const labels = instances.map(instanceLabel);
        const selected = await ctx.ui.select("Connect to a VS Code window", labels);
        if (!selected) return;
        connected = instances[labels.indexOf(selected)];
        latestSnapshot = undefined;
        manuallyDisconnected = false;
        discoveryNoticeShown = false;
        await refreshContext(ctx, undefined, false);
        startLiveRefresh(ctx);
        ctx.ui.notify(`Connected to ${selected}.`, "info");
        return;
      }

      if (subcommand === "disconnect") {
        stopLiveRefresh();
        connected = undefined;
        latestSnapshot = undefined;
        manuallyDisconnected = true;
        updateStatus(ctx);
        ctx.ui.notify("Disconnected from VS Code for this Pi session.", "info");
        return;
      }

      if (subcommand === "context") {
        const snapshot = await refreshContext(ctx, ctx.signal);
        ctx.ui.notify(snapshot ? formatContext(snapshot) : "No matching VS Code window is connected.", snapshot ? "info" : "warning");
        return;
      }

      if (subcommand === "toggle-selection") {
        const snapshot = await refreshContext(ctx, ctx.signal);
        if (!connected || !snapshot) {
          ctx.ui.notify("No matching VS Code window is connected.", "warning");
          return;
        }
        const result = await setSelectionSharing(connected, !snapshot.selectionTextSharingEnabled);
        latestSnapshot = await getContext(connected, ctx.signal, false);
        updateStatus(ctx);
        ctx.ui.notify(`VS Code selection text sharing ${result.enabled ? "enabled" : "disabled"}.`, "info");
        return;
      }

      ctx.ui.notify("Usage: /vscode [status|connect|disconnect|context|toggle-selection]", "warning");
    },
  });
}
