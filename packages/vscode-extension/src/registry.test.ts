import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type BridgeInstanceRecord } from "@pi-context-bridge/protocol";
import { InstanceRegistry } from "./registry.js";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))));

describe("InstanceRegistry", () => {
  it("writes its record and prunes invalid or dead records", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-context-registry-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, "invalid.json"), "not-json");
    const dead: BridgeInstanceRecord = {
      protocolVersion: PROTOCOL_VERSION,
      instanceId: "dead",
      pid: 2_147_483_647,
      endpoint: "http://127.0.0.1:1",
      token: "secret",
      appName: "Code",
      platform: process.platform,
      createdAt: new Date().toISOString(),
      lastFocusedAt: new Date().toISOString(),
      workspaceFolders: [],
    };
    await fs.writeFile(path.join(directory, "dead.json"), JSON.stringify(dead));

    const registry = new InstanceRegistry("current", directory);
    await registry.initialize();
    expect(await fs.readdir(directory)).toEqual([]);

    const current = { ...dead, instanceId: "current", pid: process.pid };
    await registry.write(current);
    expect(JSON.parse(await fs.readFile(registry.filePath, "utf8"))).toEqual(current);
    await registry.remove();
    expect(await fs.readdir(directory)).toEqual([]);
  });
});
