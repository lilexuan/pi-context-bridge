import crypto from "node:crypto";
import * as vscode from "vscode";
import { PROTOCOL_VERSION, type BridgeInstanceRecord } from "@pi-context-bridge/protocol";
import { workspaceFolders } from "./context.js";
import { InstanceRegistry } from "./registry.js";
import { startBridgeServer, type RunningBridgeServer } from "./server.js";

const INSTALLATION_INSTRUCTIONS = "Install the Pi extension with: pi install npm:pi-context-bridge";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "piContextBridge.toggleSelectionSharing";
  context.subscriptions.push(status);

  if (vscode.env.remoteName) {
    status.text = "$(debug-disconnect) Pi Context: remote unsupported";
    status.tooltip = `Pi Context Bridge does not support ${vscode.env.remoteName} in v1.`;
    status.show();
    registerCommands(context, status, undefined);
    return;
  }

  const enabled = vscode.workspace.getConfiguration("piContextBridge").get<boolean>("enabled", true);
  if (!enabled) {
    status.text = "$(circle-slash) Pi Context: disabled";
    status.show();
    registerCommands(context, status, undefined);
    return;
  }

  const instanceId = crypto.randomUUID();
  const registry = new InstanceRegistry(instanceId);
  await registry.initialize();
  const bridge = await startBridgeServer(instanceId);
  const createdAt = new Date().toISOString();
  let lastFocusedAt = createdAt;

  const writeRecord = async (): Promise<void> => {
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
  };

  const updateStatus = (): void => {
    const configuration = vscode.workspace.getConfiguration("piContextBridge");
    const enabledNow = configuration.get<boolean>("enabled", true);
    const sharing = configuration.get<boolean>("shareSelectionText", true);
    if (!enabledNow) {
      status.text = "$(circle-slash) Pi Context: disabled";
      status.tooltip = "Pi Context Bridge is disabled. Re-enable it in settings to resume sharing.";
      status.show();
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const location = editor
      ? `${vscode.workspace.asRelativePath(editor.document.uri, false)}:${editor.selection.active.line + 1}`
      : "no active file";
    status.text = `${sharing ? "$(eye)" : "$(eye-closed)"} Pi Context: ${location}`;
    status.tooltip = `Bridge: ${bridge.endpoint}\nSelection text sharing: ${sharing ? "on" : "off"}\nClick to toggle selection text sharing.`;
    status.show();
  };

  await writeRecord();
  updateStatus();
  registerCommands(context, status, bridge);

  const refresh = (): void => updateStatus();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.window.onDidChangeTextEditorSelection(refresh),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("piContextBridge")) updateStatus();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void writeRecord()),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        lastFocusedAt = new Date().toISOString();
        void writeRecord();
      }
    }),
    { dispose: () => { void registry.remove(); void bridge.dispose(); } },
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

export function deactivate(): void {}
