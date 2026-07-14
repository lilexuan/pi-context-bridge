import type { BridgeHealth, BridgeInstanceRecord, EditorContextSnapshot } from "@pi-context-bridge/protocol";

async function bridgeFetch<T>(
  instance: BridgeInstanceRecord,
  pathname: string,
  init: RequestInit = {},
  timeout = 1500,
): Promise<T> {
  const response = await fetch(`${instance.endpoint}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${instance.token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`VS Code bridge returned HTTP ${response.status}`);
  return await response.json() as T;
}

export function getContext(instance: BridgeInstanceRecord, signal?: AbortSignal): Promise<EditorContextSnapshot> {
  return bridgeFetch(instance, "/v1/context", { signal });
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
