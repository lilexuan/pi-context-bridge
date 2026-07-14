import * as vscode from "vscode";
import {
  PROTOCOL_VERSION,
  truncateSelection,
  type EditorContext,
  type EditorContextSnapshot,
  type WorkspaceFolderContext,
} from "@pi-context-bridge/protocol";

export function workspaceFolders(): WorkspaceFolderContext[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name,
    uri: folder.uri.toString(),
    fsPath: folder.uri.fsPath,
  }));
}

function relativePath(uri: vscode.Uri): string | undefined {
  return vscode.workspace.getWorkspaceFolder(uri) ? vscode.workspace.asRelativePath(uri, false) : undefined;
}

function serializeDocument(document: vscode.TextDocument, isActive: boolean): EditorContext {
  return {
    uri: document.uri.toString(),
    fsPath: document.uri.fsPath,
    relativePath: relativePath(document.uri),
    languageId: document.languageId,
    isDirty: document.isDirty,
    isActive,
  };
}

function openTextUris(): vscode.Uri[] {
  const result = new Map<string, vscode.Uri>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) result.set(tab.input.uri.toString(), tab.input.uri);
      if (tab.input instanceof vscode.TabInputTextDiff) {
        result.set(tab.input.original.toString(), tab.input.original);
        result.set(tab.input.modified.toString(), tab.input.modified);
      }
    }
  }
  return [...result.values()];
}

export function captureContext(instanceId: string): EditorContextSnapshot {
  const configuration = vscode.workspace.getConfiguration("piContextBridge");
  const shareSelectionText = configuration.get<boolean>("shareSelectionText", true);
  const maximumSelectionCharacters = configuration.get<number>("maxSelectionChars", 20000);
  const active = vscode.window.activeTextEditor;
  let activeEditor: EditorContext | null = null;

  if (active) {
    const selection = active.selection;
    const textDetails = !selection.isEmpty && shareSelectionText
      ? truncateSelection(active.document.getText(selection), maximumSelectionCharacters)
      : {};
    activeEditor = {
      ...serializeDocument(active.document, true),
      cursor: { line: selection.active.line, character: selection.active.character },
      selection: {
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character },
        isEmpty: selection.isEmpty,
        ...textDetails,
      },
    };
  }

  const activeUri = active?.document.uri.toString();
  const openEditors = openTextUris().map((uri) => {
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
    if (document) return serializeDocument(document, uri.toString() === activeUri);
    return {
      uri: uri.toString(),
      fsPath: uri.fsPath,
      relativePath: relativePath(uri),
      languageId: "unknown",
      isDirty: false,
      isActive: uri.toString() === activeUri,
    };
  });

  return {
    protocolVersion: PROTOCOL_VERSION,
    instanceId,
    capturedAt: new Date().toISOString(),
    appName: vscode.env.appName,
    workspaceFolders: workspaceFolders(),
    activeEditor,
    openEditors,
    selectionTextSharingEnabled: shareSelectionText,
  };
}
