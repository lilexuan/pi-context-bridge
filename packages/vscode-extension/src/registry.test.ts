import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAXIMUM_REGISTRY_FILE_BYTES,
  PROTOCOL_VERSION,
  type BridgeInstanceRecord,
} from "@pi-context-bridge/protocol";
import { InstanceRegistry } from "./registry.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function instanceId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function record(id: string, pid: number): BridgeInstanceRecord {
  return {
    protocolVersion: PROTOCOL_VERSION,
    instanceId: id,
    pid,
    endpoint: "http://127.0.0.1:1",
    token: "secret",
    appName: "Code",
    platform: process.platform,
    createdAt: new Date().toISOString(),
    lastFocusedAt: new Date().toISOString(),
    workspaceFolders: [],
  };
}

describe("InstanceRegistry", () => {
  it("writes its record and prunes invalid or dead records", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-context-registry-"));
    temporaryDirectories.push(directory);
    const invalidId = instanceId(1);
    const dead = record(instanceId(2), 2_147_483_647);
    await fs.writeFile(path.join(directory, `${invalidId}.json`), "not-json");
    await fs.writeFile(path.join(directory, `${dead.instanceId}.json`), JSON.stringify(dead));

    const currentId = instanceId(3);
    const registry = new InstanceRegistry(currentId, directory);
    await registry.initialize();
    expect(await fs.readdir(directory)).toEqual([]);

    const current = { ...dead, instanceId: currentId, pid: process.pid };
    await registry.write(current);
    expect(JSON.parse(await fs.readFile(registry.filePath, "utf8"))).toEqual(current);
    await registry.remove();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("ignores unrelated JSON files and removes oversized UUID records", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-context-registry-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, "note.json"), "user data");
    const oversizedId = instanceId(4);
    await fs.writeFile(
      path.join(directory, `${oversizedId}.json`),
      "x".repeat(MAXIMUM_REGISTRY_FILE_BYTES + 1),
    );

    await new InstanceRegistry(instanceId(5), directory).initialize();

    expect(await fs.readdir(directory)).toEqual(["note.json"]);
    expect(await fs.readFile(path.join(directory, "note.json"), "utf8")).toBe("user data");
  });

  it("bounds stale-instance health checks at eight and cancels response bodies", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-context-registry-"));
    temporaryDirectories.push(directory);
    for (let index = 10; index < 30; index += 1) {
      const candidate = record(instanceId(index), process.pid);
      await fs.writeFile(path.join(directory, `${candidate.instanceId}.json`), JSON.stringify(candidate));
    }

    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const cancel = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;
      return { ok: true, body: { cancel } } as unknown as Response;
    }));

    await new InstanceRegistry(instanceId(30), directory).initialize();

    expect(maximumActiveRequests).toBe(8);
    expect(cancel).toHaveBeenCalledTimes(20);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(20);
    expect(await fs.readdir(directory)).toHaveLength(20);
  });
});
