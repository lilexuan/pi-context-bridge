import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getRegistryDirectory,
  isBridgeInstanceRecord,
  type BridgeInstanceRecord,
} from "@pi-context-bridge/protocol";

async function processExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function respondsToHealth(record: BridgeInstanceRecord): Promise<boolean> {
  try {
    const response = await fetch(`${record.endpoint}/v1/health`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
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
    await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map(async (entry) => {
      const filePath = path.join(this.directory, entry.name);
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
        if (!isBridgeInstanceRecord(parsed)) throw new Error("invalid record");
        if (parsed.instanceId === this.instanceId) return;
        if (!(await processExists(parsed.pid)) || !(await respondsToHealth(parsed))) await fs.rm(filePath, { force: true });
      } catch {
        await fs.rm(filePath, { force: true });
      }
    }));
  }
}
