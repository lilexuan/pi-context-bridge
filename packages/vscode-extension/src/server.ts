import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import * as vscode from "vscode";
import { PROTOCOL_VERSION, type BridgeHealth } from "@pi-context-bridge/protocol";
import { captureContext, captureStatus } from "./context.js";
import { isAuthorized } from "./auth.js";

const MAXIMUM_CONNECTIONS = 32;
const SERVER_TIMEOUT_MS = 5_000;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export interface RunningBridgeServer {
  endpoint: string;
  token: string;
  dispose(): Promise<void>;
}

export async function startBridgeServer(instanceId: string): Promise<RunningBridgeServer> {
  const token = crypto.randomBytes(32).toString("base64url");
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/health") {
        const health: BridgeHealth = { ok: true, protocolVersion: PROTOCOL_VERSION, instanceId, appName: vscode.env.appName };
        sendJson(response, 200, health);
        return;
      }
      if (!isAuthorized(request.headers.authorization, token)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (!vscode.workspace.getConfiguration("piContextBridge").get<boolean>("enabled", true)) {
        sendJson(response, 503, { error: "bridge disabled" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/context") {
        // Full context remains the default for clients predating the lightweight status detail.
        if (url.searchParams.get("detail") === "status") {
          sendJson(response, 200, captureStatus(instanceId));
          return;
        }
        const includeSelectionText = url.searchParams.get("includeSelectionText") !== "false";
        sendJson(response, 200, captureContext(instanceId, includeSelectionText));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/settings/selection-sharing") {
        const body = await readJson(request) as { enabled?: unknown };
        if (typeof body.enabled !== "boolean") {
          sendJson(response, 400, { error: "enabled must be a boolean" });
          return;
        }
        await vscode.workspace.getConfiguration("piContextBridge").update(
          "shareSelectionText",
          body.enabled,
          vscode.ConfigurationTarget.Workspace,
        );
        sendJson(response, 200, { enabled: body.enabled });
        return;
      }
      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "internal error" });
    }
  });
  // The bridge is local and normally has a single Pi client. Explicit bounds
  // prevent slow or accidental clients from retaining many serialized context
  // responses in the shared VS Code extension host.
  server.maxConnections = MAXIMUM_CONNECTIONS;
  server.headersTimeout = SERVER_TIMEOUT_MS;
  server.requestTimeout = SERVER_TIMEOUT_MS;
  server.keepAliveTimeout = SERVER_TIMEOUT_MS;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Bridge did not receive a TCP port");
  let disposePromise: Promise<void> | undefined;
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    dispose: () => {
      disposePromise ??= new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return disposePromise;
    },
  };
}
