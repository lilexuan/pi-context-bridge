import crypto from "node:crypto";
import * as vscode from "vscode";
import { PROTOCOL_VERSION, type BridgeInstanceRecord } from "@pi-context-bridge/protocol";
import { workspaceFolders } from "./context.js";
import { InstanceRegistry } from "./registry.js";
import { startBridgeServer, type RunningBridgeServer } from "./server.js";
import { createStatusBarUpdater } from "./status.js";

const INSTALLATION_INSTRUCTIONS = "Install the Pi extension with: pi install npm:pi-context-bridge";
let deactivateActiveBridge: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "piContextBridge.toggleSelectionSharing";
  context.subscriptions.push(status);
  const renderStatus = createStatusBarUpdater(status);

  if (vscode.env.remoteName) {
    renderStatus(
      "$(debug-disconnect) Pi Context: remote unsupported",
      `Pi Context Bridge does not support ${vscode.env.remoteName} in v1.`,
    );
    registerCommands(context, status, undefined);
    return;
  }

  const enabled = vscode.workspace.getConfiguration("piContextBridge").get<boolean>("enabled", true);
  if (!enabled) {
    renderStatus("$(circle-slash) Pi Context: disabled", undefined);
    registerCommands(context, status, undefined);
    return;
  }

  const instanceId = crypto.randomUUID();
  const registry = new InstanceRegistry(instanceId);
  await registry.initialize();
  const bridge = await startBridgeServer(instanceId);
  const createdAt = new Date().toISOString();
  let lastFocusedAt = createdAt;
  let disposed = false;
  let writeQueue = Promise.resolve();
  let cleanupPromise: Promise<void> | undefined;

  const writeRecord = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    const operation = writeQueue.then(async () => {
      if (disposed) return;
      const record: BridgeInstanceRecord = {
        protocolVersion: PROTOCOL_VERSION,
        instanceId,
        pid: process.pid,
        endpoint: bridge.endpoint,
        token: bridge.token,
        appName: vscode.env.appName,
        platform: process.platform,
        createdAt,
        lastFocusedAt,
        workspaceFolders: workspaceFolders(),
      };
      await registry.write(record);
    });
    // Keep the queue usable after a transient write failure while returning the
    // original operation to callers that need to observe that failure.
    writeQueue = operation.catch(() => undefined);
    return operation;
  };
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      disposed = true;
      const closeBridge = bridge.dispose();
      await writeQueue;
      await Promise.all([closeBridge, registry.remove()]);
    })();
    return cleanupPromise;
  };
  deactivateActiveBridge = cleanup;

  const updateStatus = (): void => {
    const configuration = vscode.workspace.getConfiguration("piContextBridge");
    const enabledNow = configuration.get<boolean>("enabled", true);
    const sharing = configuration.get<boolean>("shareSelectionText", true);
    if (!enabledNow) {
      renderStatus(
        "$(circle-slash) Pi Context: disabled",
        "Pi Context Bridge is disabled. Re-enable it in settings to resume sharing.",
      );
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const location = editor
      ? `${vscode.workspace.asRelativePath(editor.document.uri, false)}:${editor.selection.active.line + 1}`
      : "no active file";
    renderStatus(
      `${sharing ? "$(eye)" : "$(eye-closed)"} Pi Context: ${location}`,
      `Bridge: ${bridge.endpoint}\nSelection text sharing: ${sharing ? "on" : "off"}\nClick to toggle selection text sharing.`,
    );
  };

  try {
    await writeRecord();
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
  updateStatus();
  registerCommands(context, status, bridge);

  const refresh = (): void => updateStatus();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === vscode.window.activeTextEditor) refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("piContextBridge")) updateStatus();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void writeRecord().catch(() => undefined)),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        lastFocusedAt = new Date().toISOString();
        void writeRecord().catch(() => undefined);
      }
    }),
    { dispose: () => { void cleanup().catch(() => undefined); } },
  );
}

function registerCommands(
  context: vscode.ExtensionContext,
  status: vscode.StatusBarItem,
  bridge: RunningBridgeServer | undefined,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("piContextBridge.showStatus", async () => {
      const sharing = vscode.workspace.getConfiguration("piContextBridge").get<boolean>("shareSelectionText", true);
      const message = bridge
        ? `Pi Context Bridge is listening on ${bridge.endpoint}. Selection text sharing is ${sharing ? "enabled" : "disabled"}.`
        : status.text.replace(/^\$\([^)]*\)\s*/, "");
      await vscode.window.showInformationMessage(message);
    }),
    vscode.commands.registerCommand("piContextBridge.toggleSelectionSharing", async () => {
      const configuration = vscode.workspace.getConfiguration("piContextBridge");
      const current = configuration.get<boolean>("shareSelectionText", true);
      await configuration.update("shareSelectionText", !current, vscode.ConfigurationTarget.Workspace);
      await vscode.window.showInformationMessage(`Pi Context Bridge selection text sharing ${!current ? "enabled" : "disabled"}.`);
    }),
    vscode.commands.registerCommand("piContextBridge.copyInstallationInstructions", async () => {
      await vscode.env.clipboard.writeText(INSTALLATION_INSTRUCTIONS);
      await vscode.window.showInformationMessage("Pi Context Bridge installation command copied.");
    }),
  );
}

export async function deactivate(): Promise<void> {
  const cleanup = deactivateActiveBridge;
  deactivateActiveBridge = undefined;
  await cleanup?.();
}
