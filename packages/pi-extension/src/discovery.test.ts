import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type BridgeInstanceRecord } from "@pi-context-bridge/protocol";
import { loadInstances } from "./discovery.js";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))));

describe("loadInstances", () => {
  it("loads bounded UUID records and ignores unrelated or oversized JSON files", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-context-bridge-"));
    temporaryDirectories.push(directory);
    const instanceId = "123e4567-e89b-42d3-a456-426614174000";
    const record: BridgeInstanceRecord = {
      protocolVersion: PROTOCOL_VERSION,
      instanceId,
      pid: process.pid,
      endpoint: "http://127.0.0.1:1234",
      token: "token",
      appName: "Code",
      platform: process.platform,
      createdAt: new Date().toISOString(),
      lastFocusedAt: new Date().toISOString(),
      workspaceFolders: [],
    };
    await fs.writeFile(path.join(directory, `${instanceId}.json`), JSON.stringify(record));
    await fs.writeFile(path.join(directory, "note.json"), "x".repeat(128 * 1024));
    await fs.writeFile(
      path.join(directory, "223e4567-e89b-42d3-a456-426614174000.json"),
      "x".repeat(65_537),
    );
    expect(await loadInstances(directory)).toEqual([record]);
  });

  it("returns an empty list when the directory is absent", async () => {
    expect(await loadInstances(path.join(os.tmpdir(), `missing-${Date.now()}`))).toEqual([]);
  });
});
