import http from "node:http";
import type { BridgeHealth, BridgeInstanceRecord, EditorContextSnapshot } from "@pi-context-bridge/protocol";

const MAXIMUM_RESPONSE_BYTES = 1_048_576;

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
  const signal = init.signal ?? AbortSignal.timeout(timeout);
  return await new Promise<T>((resolve, reject) => {
    const request = http.request(`${instance.endpoint}${pathname}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${instance.token}`,
        "Content-Type": "application/json",
      },
      signal,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`VS Code bridge returned HTTP ${status}`));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAXIMUM_RESPONSE_BYTES) {
          response.destroy(new Error("VS Code bridge response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
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

export function getHealth(instance: BridgeInstanceRecord): Promise<BridgeHealth> {
  return bridgeFetch(instance, "/v1/health", {}, 500);
}

export function setSelectionSharing(instance: BridgeInstanceRecord, enabled: boolean): Promise<{ enabled: boolean }> {
  return bridgeFetch(instance, "/v1/settings/selection-sharing", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}
