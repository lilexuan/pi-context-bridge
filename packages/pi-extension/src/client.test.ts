import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type BridgeInstanceRecord } from "@pi-context-bridge/protocol";
import { getContext, setSelectionSharing } from "./client.js";

const servers: http.Server[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

async function fixtureServer(): Promise<BridgeInstanceRecord> {
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== "Bearer secret") {
      response.writeHead(401).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/settings/selection-sharing") response.end(JSON.stringify({ enabled: false }));
    else response.end(JSON.stringify({
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
  it("changes selection sharing", async () => expect(await setSelectionSharing(await fixtureServer(), false)).toEqual({ enabled: false }));
});
