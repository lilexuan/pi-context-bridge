import { promises as fs } from "node:fs";
import path from "node:path";
import {
  MAXIMUM_REGISTRY_FILE_BYTES,
  getRegistryDirectory,
  isBridgeInstanceRecord,
  isRegistryInstanceFileName,
  routeInstance,
  type BridgeInstanceRecord,
  type InstanceRoute,
} from "@pi-context-bridge/protocol";

const LOAD_CONCURRENCY = 8;

export async function loadInstances(directory = getRegistryDirectory()): Promise<BridgeInstanceRecord[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const candidates = names.filter(isRegistryInstanceFileName);
  const records = new Array<BridgeInstanceRecord | undefined>(candidates.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      const name = candidates[index]!;
      try {
        const filePath = path.join(directory, name);
        const stats = await fs.stat(filePath);
        if (!stats.isFile() || stats.size > MAXIMUM_REGISTRY_FILE_BYTES) continue;
        const source = await fs.readFile(filePath, "utf8");
        if (Buffer.byteLength(source) > MAXIMUM_REGISTRY_FILE_BYTES) continue;
        const parsed: unknown = JSON.parse(source);
        if (!isBridgeInstanceRecord(parsed)) continue;
        if (`${parsed.instanceId}.json`.toLowerCase() !== name.toLowerCase()) continue;
        records[index] = parsed;
      } catch {
        records[index] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, candidates.length) }, worker));
  return records.filter((record): record is BridgeInstanceRecord => Boolean(record));
}

export async function discoverInstance(cwd: string): Promise<InstanceRoute> {
  return routeInstance(cwd, await loadInstances());
}
