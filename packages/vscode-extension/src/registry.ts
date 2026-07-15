import { promises as fs } from "node:fs";
import path from "node:path";
import {
  MAXIMUM_REGISTRY_FILE_BYTES,
  getRegistryDirectory,
  isBridgeInstanceRecord,
  isRegistryInstanceFileName,
  type BridgeInstanceRecord,
} from "@pi-context-bridge/protocol";

const HEALTH_TIMEOUT_MS = 500;
const PRUNE_CONCURRENCY = 8;

async function processExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function respondsToHealth(record: BridgeInstanceRecord): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  timeout.unref();
  try {
    const response = await fetch(`${record.endpoint}/v1/health`, { signal: controller.signal });
    const healthy = response.ok;
    if (response.body) await response.body.cancel().catch(() => undefined);
    return healthy;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithConcurrency<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++]!;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export class InstanceRegistry {
  readonly filePath: string;

  constructor(private readonly instanceId: string, readonly directory = getRegistryDirectory()) {
    this.filePath = path.join(this.directory, `${instanceId}.json`);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await fs.chmod(this.directory, 0o700);
    await this.pruneStaleInstances();
  }

  async write(record: BridgeInstanceRecord): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
    if (process.platform !== "win32") await fs.chmod(this.filePath, 0o600);
  }

  async remove(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }

  private async pruneStaleInstances(): Promise<void> {
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isFile() && isRegistryInstanceFileName(entry.name));
    await runWithConcurrency(candidates, PRUNE_CONCURRENCY, async (entry) => {
      const filePath = path.join(this.directory, entry.name);
      try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) return;
        if (stats.size > MAXIMUM_REGISTRY_FILE_BYTES) {
          await fs.rm(filePath, { force: true });
          return;
        }
        const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
        if (!isBridgeInstanceRecord(parsed)) throw new Error("invalid record");
        if (`${parsed.instanceId}.json`.toLowerCase() !== entry.name.toLowerCase()) throw new Error("instance ID mismatch");
        if (parsed.instanceId === this.instanceId) return;
        if (!(await processExists(parsed.pid)) || !(await respondsToHealth(parsed))) await fs.rm(filePath, { force: true });
      } catch {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
      }
    });
  }
}
