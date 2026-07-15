import { describe, expect, it } from "vitest";
import {
  MAXIMUM_REGISTRY_FILE_BYTES,
  PROTOCOL_VERSION,
  isRegistryInstanceFileName,
  routeInstance,
  truncateSelection,
  type BridgeInstanceRecord,
} from "./index.js";

function instance(id: string, folder: string, focused: string): BridgeInstanceRecord {
  return {
    protocolVersion: PROTOCOL_VERSION,
    instanceId: id,
    pid: 1,
    endpoint: "http://127.0.0.1:1",
    token: "token",
    appName: "Code",
    platform: "linux",
    createdAt: focused,
    lastFocusedAt: focused,
    workspaceFolders: [{ name: id, uri: `file://${folder}`, fsPath: folder }],
  };
}

describe("routeInstance", () => {
  it("chooses the deepest matching workspace", () => {
    const result = routeInstance("/repo/packages/app", [
      instance("root", "/repo", "2026-01-01T00:00:00Z"),
      instance("app", "/repo/packages", "2025-01-01T00:00:00Z"),
    ], "linux");
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.instance.instanceId).toBe("app");
  });

  it("uses focus time for equal matches", () => {
    const result = routeInstance("/repo", [
      instance("old", "/repo", "2025-01-01T00:00:00Z"),
      instance("new", "/repo", "2026-01-01T00:00:00Z"),
    ], "linux");
    expect(result.kind === "matched" && result.instance.instanceId).toBe("new");
  });

  it("reports a true tie as ambiguous", () => {
    const focused = "2026-01-01T00:00:00Z";
    expect(routeInstance("/repo", [instance("a", "/repo", focused), instance("b", "/repo", focused)], "linux").kind).toBe("ambiguous");
  });

  it("does not match sibling directories", () => {
    expect(routeInstance("/repository", [instance("a", "/repo", "2026-01-01T00:00:00Z")], "linux").kind).toBe("none");
  });

  it("matches Windows paths without case sensitivity", () => {
    const win = instance("win", "C:\\Users\\Me\\Repo", "2026-01-01T00:00:00Z");
    expect(routeInstance("c:\\users\\me\\repo\\src", [win], "win32").kind).toBe("matched");
  });
});

describe("truncateSelection", () => {
  it("leaves short text intact", () => expect(truncateSelection("hello", 10)).toEqual({ text: "hello", truncated: false }));
  it("marks truncated text", () => expect(truncateSelection("hello", 3)).toEqual({ text: "hel", truncated: true, originalCharacterCount: 5 }));
});

describe("registry instance file names", () => {
  it("recognizes only canonical UUID JSON file names", () => {
    expect(isRegistryInstanceFileName("123e4567-e89b-12d3-a456-426614174000.json")).toBe(true);
    expect(isRegistryInstanceFileName("123E4567-E89B-12D3-A456-426614174000.JSON")).toBe(true);
    expect(isRegistryInstanceFileName("note.json")).toBe(false);
    expect(isRegistryInstanceFileName("123e4567-e89b-12d3-a456-426614174000.json.tmp")).toBe(false);
  });

  it("caps registry files at 64 KiB", () => {
    expect(MAXIMUM_REGISTRY_FILE_BYTES).toBe(65_536);
  });
});
