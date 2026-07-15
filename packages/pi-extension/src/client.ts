import http from "node:http";
import type {
  BridgeHealth,
  BridgeInstanceRecord,
  EditorContextSnapshot,
  EditorStatusSnapshot,
} from "@pi-context-bridge/protocol";

// A 200k-character selection can expand to roughly 1.2 MB when every
// character needs a six-byte JSON escape. Keep the response bounded while
// allowing the VS Code extension's documented hard selection limit.
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;

interface BridgeRequestOptions {
  method?: string;
  body?: string;
  signal?: AbortSignal;
}

async function bridgeFetch<T>(
  instance: BridgeInstanceRecord,
  pathname: string,
  init: BridgeRequestOptions = {},
  timeout = 1500,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      operation();
    };
    const fail = (error: unknown): void => finish(() => reject(error));

    const request = http.request(`${instance.endpoint}${pathname}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${instance.token}`,
        "Content-Type": "application/json",
      },
      signal: init.signal,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        const error = new Error(`VS Code bridge returned HTTP ${status}`);
        response.destroy();
        fail(error);
        return;
      }

      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_RESPONSE_BYTES) {
        const error = new Error("VS Code bridge response is too large");
        response.destroy(error);
        fail(error);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAXIMUM_RESPONSE_BYTES) {
          chunks.length = 0;
          const error = new Error("VS Code bridge response is too large");
          response.destroy(error);
          fail(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("aborted", () => fail(new Error("VS Code bridge response was aborted")));
      response.on("end", () => {
        if (settled) return;
        try {
          const body = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, size);
          const parsed = JSON.parse(body.toString("utf8")) as T;
          chunks.length = 0;
          finish(() => resolve(parsed));
        } catch (error) {
          chunks.length = 0;
          fail(error);
        }
      });
    });
    request.on("error", fail);
    const timeoutHandle = setTimeout(() => {
      const error = new Error(`VS Code bridge request timed out after ${timeout} ms`);
      request.destroy(error);
      fail(error);
    }, timeout);
    timeoutHandle.unref();
    request.end(init.body);
  });
}

export function getContext(
  instance: BridgeInstanceRecord,
  signal?: AbortSignal,
  includeSelectionText = true,
): Promise<EditorContextSnapshot> {
  const query = includeSelectionText ? "" : "?includeSelectionText=false";
  return bridgeFetch(instance, `/v1/context${query}`, { signal });
}

export function getStatus(instance: BridgeInstanceRecord, signal?: AbortSignal): Promise<EditorStatusSnapshot> {
  // Bridge versions without compact-status support return a structurally
  // compatible full context. The caller immediately normalizes that response
  // to metadata only, including for very old versions that ignore both params.
  return bridgeFetch(instance, "/v1/context?includeSelectionText=false&detail=status", { signal });
}

export function getHealth(instance: BridgeInstanceRecord, signal?: AbortSignal): Promise<BridgeHealth> {
  return bridgeFetch(instance, "/v1/health", { signal }, 500);
}

export function setSelectionSharing(
  instance: BridgeInstanceRecord,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<{ enabled: boolean }> {
  return bridgeFetch(instance, "/v1/settings/selection-sharing", {
    method: "POST",
    body: JSON.stringify({ enabled }),
    signal,
  });
}
