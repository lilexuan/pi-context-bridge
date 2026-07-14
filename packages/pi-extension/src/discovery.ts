import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getRegistryDirectory,
  isBridgeInstanceRecord,
  routeInstance,
  type BridgeInstanceRecord,
  type InstanceRoute,
} from "@pi-context-bridge/protocol";

export async function loadInstances(directory = getRegistryDirectory()): Promise<BridgeInstanceRecord[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
      return isBridgeInstanceRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }));
  return records.filter((record): record is BridgeInstanceRecord => Boolean(record));
}

export async function discoverInstance(cwd: string): Promise<InstanceRoute> {
  return routeInstance(cwd, await loadInstances());
}
