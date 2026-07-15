import * as vscode from "vscode";
import {
  PROTOCOL_VERSION,
  type EditorContext,
  type EditorContextSnapshot,
  type EditorStatusContext,
  type EditorStatusSnapshot,
  type WorkspaceFolderContext,
} from "@pi-context-bridge/protocol";
import { DEFAULT_MAXIMUM_SELECTION_CHARACTERS, planSelectionRead } from "./selection.js";

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

function serializeStatusEditor(editor: vscode.TextEditor): EditorStatusContext {
  const { document, selection } = editor;
  return {
    uri: document.uri.toString(),
    fsPath: document.uri.fsPath,
    relativePath: relativePath(document.uri),
    cursor: { line: selection.active.line, character: selection.active.character },
    selection: {
      start: { line: selection.start.line, character: selection.start.character },
      end: { line: selection.end.line, character: selection.end.character },
      isEmpty: selection.isEmpty,
    },
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

export function captureContext(instanceId: string, includeSelectionText = true): EditorContextSnapshot {
  const configuration = vscode.workspace.getConfiguration("piContextBridge");
  const shareSelectionText = configuration.get<boolean>("shareSelectionText", true);
  const maximumSelectionCharacters = configuration.get<number>(
    "maxSelectionChars",
    DEFAULT_MAXIMUM_SELECTION_CHARACTERS,
  );
  const active = vscode.window.activeTextEditor;
  let activeEditor: EditorContext | null = null;

  if (active) {
    const selection = active.selection;
    let textDetails = {};
    if (!selection.isEmpty && shareSelectionText && includeSelectionText) {
      const plan = planSelectionRead(active.document, selection, maximumSelectionCharacters);
      const text = active.document.getText(new vscode.Range(selection.start, plan.end));
      textDetails = plan.truncated
        ? { text, truncated: true, originalCharacterCount: plan.originalCharacterCount }
        : { text, truncated: false };
    }
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
  const documentsByUri = new Map(
    vscode.workspace.textDocuments.map((document) => [document.uri.toString(), document]),
  );
  const openEditors = openTextUris().map((uri) => {
    const uriString = uri.toString();
    const document = documentsByUri.get(uriString);
    if (document) return serializeDocument(document, uriString === activeUri);
    return {
      uri: uriString,
      fsPath: uri.fsPath,
      relativePath: relativePath(uri),
      languageId: "unknown",
      isDirty: false,
      isActive: uriString === activeUri,
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

export function captureStatus(instanceId: string): EditorStatusSnapshot {
  const shareSelectionText = vscode.workspace
    .getConfiguration("piContextBridge")
    .get<boolean>("shareSelectionText", true);
  const active = vscode.window.activeTextEditor;
  return {
    protocolVersion: PROTOCOL_VERSION,
    instanceId,
    capturedAt: new Date().toISOString(),
    appName: vscode.env.appName,
    activeEditor: active ? serializeStatusEditor(active) : null,
    selectionTextSharingEnabled: shareSelectionText,
  };
}
