import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type BridgeInstanceRecord } from "@pi-context-bridge/protocol";
import { getContext, getStatus, setSelectionSharing } from "./client.js";

const servers: http.Server[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

async function fixtureServer(
  onRequest?: (url: string) => void,
  responseBody?: string,
  handleRequest?: (request: http.IncomingMessage, response: http.ServerResponse) => boolean,
): Promise<BridgeInstanceRecord> {
  const server = http.createServer((request, response) => {
    onRequest?.(request.url ?? "");
    if (request.headers.authorization !== "Bearer secret") {
      response.writeHead(401).end();
      return;
    }
    if (handleRequest?.(request, response)) return;
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/settings/selection-sharing") response.end(JSON.stringify({ enabled: false }));
    else response.end(responseBody ?? JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      instanceId: "test",
      capturedAt: new Date().toISOString(),
      appName: "Code",
      workspaceFolders: [],
      activeEditor: null,
      openEditors: [],
      selectionTextSharingEnabled: true,
    }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    protocolVersion: PROTOCOL_VERSION,
    instanceId: "test",
    pid: process.pid,
    endpoint: `http://127.0.0.1:${address.port}`,
    token: "secret",
    appName: "Code",
    platform: process.platform,
    createdAt: new Date().toISOString(),
    lastFocusedAt: new Date().toISOString(),
    workspaceFolders: [],
  };
}

describe("bridge client", () => {
  it("authenticates and fetches context", async () => expect((await getContext(await fixtureServer())).instanceId).toBe("test"));
  it("can omit selection text from lightweight background refreshes", async () => {
    const urls: string[] = [];
    const instance = await fixtureServer((url) => urls.push(url));

    await getContext(instance, undefined, false);

    expect(urls).toEqual(["/v1/context?includeSelectionText=false"]);
  });
  it("uses the compact status detail for background refreshes", async () => {
    const urls: string[] = [];
    const instance = await fixtureServer((url) => urls.push(url));

    await getStatus(instance);

    expect(urls).toEqual(["/v1/context?includeSelectionText=false&detail=status"]);
  });
  it("rejects unexpectedly large responses instead of retaining them", async () => {
    const instance = await fixtureServer(undefined, "x".repeat(2 * 1024 * 1024 + 1));
    await expect(getContext(instance)).rejects.toThrow("response is too large");
  });
  it("keeps the bridge timeout when a caller also supplies an abort signal", async () => {
    const instance = await fixtureServer(undefined, undefined, (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write("{");
      return true;
    });
    const startedAt = Date.now();

    await expect(getContext(instance, new AbortController().signal)).rejects.toThrow("timed out");

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
  it("lets caller cancellation win over the bridge timeout", async () => {
    const instance = await fixtureServer(undefined, undefined, (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write("{");
      return true;
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await expect(getContext(instance, controller.signal)).rejects.toThrow(/abort/i);
  });
  it("changes selection sharing", async () => expect(await setSelectionSharing(await fixtureServer(), false)).toEqual({ enabled: false }));
});
