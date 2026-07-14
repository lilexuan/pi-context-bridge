import os from "node:os";
import path from "node:path";

export const PROTOCOL_VERSION = 1 as const;
export const REGISTRY_DIRECTORY_NAME = "pi-context-bridge";

export interface Position {
  line: number;
  character: number;
}

export interface SelectionContext {
  start: Position;
  end: Position;
  isEmpty: boolean;
  text?: string;
  truncated?: boolean;
  originalCharacterCount?: number;
}

export interface WorkspaceFolderContext {
  name: string;
  uri: string;
  fsPath: string;
}

export interface EditorContext {
  uri: string;
  fsPath: string;
  relativePath?: string;
  languageId: string;
  isDirty: boolean;
  isActive: boolean;
  cursor?: Position;
  selection?: SelectionContext;
}

export interface EditorContextSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION;
  instanceId: string;
  capturedAt: string;
  appName: string;
  workspaceFolders: WorkspaceFolderContext[];
  activeEditor: EditorContext | null;
  openEditors: EditorContext[];
  selectionTextSharingEnabled: boolean;
}

export interface BridgeInstanceRecord {
  protocolVersion: typeof PROTOCOL_VERSION;
  instanceId: string;
  pid: number;
  endpoint: string;
  token: string;
  appName: string;
  platform: NodeJS.Platform;
  createdAt: string;
  lastFocusedAt: string;
  workspaceFolders: WorkspaceFolderContext[];
}

export interface BridgeHealth {
  ok: true;
  protocolVersion: typeof PROTOCOL_VERSION;
  instanceId: string;
  appName: string;
}

export function getRegistryDirectory(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  if (platform === "win32") {
    // AppContainer/MSIX hosts can virtualize writes under LOCALAPPDATA even when
    // addressed by an absolute path. Pi's user config directory under the stable
    // user profile remains shared between VS Code and ordinary terminals.
    const userProfile = env.USERPROFILE ?? homeDirectory;
    return path.join(userProfile, ".pi", "agent", REGISTRY_DIRECTORY_NAME, "instances");
  }
  const runtimeRoot = env.XDG_RUNTIME_DIR ?? path.join(homeDirectory, ".cache");
  return path.join(runtimeRoot, REGISTRY_DIRECTORY_NAME, "instances");
}

export function truncateSelection(text: string, maximumCharacters: number): Pick<SelectionContext, "text" | "truncated" | "originalCharacterCount"> {
  const limit = Math.max(0, maximumCharacters);
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: text.slice(0, limit),
    truncated: true,
    originalCharacterCount: text.length,
  };
}

export type InstanceRoute =
  | { kind: "matched"; instance: BridgeInstanceRecord }
  | { kind: "ambiguous"; instances: BridgeInstanceRecord[] }
  | { kind: "none" };

function normalizeForComparison(value: string, platform: NodeJS.Platform): string {
  const pathImplementation = platform === "win32" ? path.win32 : path.posix;
  const normalized = pathImplementation.normalize(pathImplementation.resolve(value)).replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function workspaceMatchScore(cwd: string, workspace: string, platform: NodeJS.Platform): number {
  const normalizedCwd = normalizeForComparison(cwd, platform);
  const normalizedWorkspace = normalizeForComparison(workspace, platform);
  const separator = platform === "win32" ? "\\" : "/";
  if (normalizedCwd === normalizedWorkspace) return normalizedWorkspace.length + 1;
  if (normalizedCwd.startsWith(`${normalizedWorkspace}${separator}`)) return normalizedWorkspace.length;
  return -1;
}

export function routeInstance(cwd: string, instances: BridgeInstanceRecord[], platform: NodeJS.Platform = process.platform): InstanceRoute {
  const scored = instances
    .map((instance) => ({
      instance,
      score: Math.max(-1, ...instance.workspaceFolders.map((folder) => workspaceMatchScore(cwd, folder.fsPath, platform))),
    }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.instance.lastFocusedAt) - Date.parse(a.instance.lastFocusedAt));

  if (scored.length === 0) return { kind: "none" };
  const first = scored[0]!;
  const tied = scored.filter(
    ({ score, instance }) => score === first.score && Date.parse(instance.lastFocusedAt) === Date.parse(first.instance.lastFocusedAt),
  );
  if (tied.length > 1) return { kind: "ambiguous", instances: tied.map(({ instance }) => instance) };
  return { kind: "matched", instance: first.instance };
}

export function isBridgeInstanceRecord(value: unknown): value is BridgeInstanceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BridgeInstanceRecord>;
  return (
    record.protocolVersion === PROTOCOL_VERSION &&
    typeof record.instanceId === "string" &&
    typeof record.pid === "number" &&
    typeof record.endpoint === "string" &&
    typeof record.token === "string" &&
    typeof record.lastFocusedAt === "string" &&
    Array.isArray(record.workspaceFolders)
  );
}
