import type * as vscode from "vscode";

type StatusBarTarget = Pick<vscode.StatusBarItem, "text" | "tooltip" | "show">;

/** Avoids sending identical status updates across the extension-host IPC bridge. */
export function createStatusBarUpdater(target: StatusBarTarget) {
  let previousText: string | undefined;
  let previousTooltip: vscode.StatusBarItem["tooltip"];
  let visible = false;

  return (text: string, tooltip: vscode.StatusBarItem["tooltip"]): void => {
    if (text !== previousText) {
      target.text = text;
      previousText = text;
    }
    if (tooltip !== previousTooltip) {
      target.tooltip = tooltip;
      previousTooltip = tooltip;
    }
    if (!visible) {
      target.show();
      visible = true;
    }
  };
}
