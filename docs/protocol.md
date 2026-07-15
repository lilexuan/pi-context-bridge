# Bridge protocol

Protocol version 1 uses a per-window HTTP server bound to `127.0.0.1` and a JSON instance record in the user registry directory.

## Discovery directories

- Windows: `%USERPROFILE%/.pi/agent/pi-context-bridge/instances` (outside AppContainer-virtualized `LOCALAPPDATA`)
- Unix with `XDG_RUNTIME_DIR`: `$XDG_RUNTIME_DIR/pi-context-bridge/instances`
- Unix fallback: `~/.cache/pi-context-bridge/instances`

Each UUID-named `<instanceId>.json` record includes the endpoint, bearer token, process ID, application name, focus timestamp, and workspace folders. Clients must treat the file as a secret. Discovery ignores unrelated files and records over 64 KiB; records with invalid JSON, incompatible protocol versions, dead processes, or failed health checks are ignored or pruned.

Pi selects the workspace containing its current working directory with the longest path prefix. Equal workspace matches use `lastFocusedAt`; a true tie requires `/vscode connect`.

## Endpoints

### `GET /v1/health`

Unauthenticated so stale discovery records can be checked. Returns only the instance ID, application name, and protocol version.

### `GET /v1/context`

Requires `Authorization: Bearer <token>`. Returns an `EditorContextSnapshot` with workspace folders, active editor, open editors, cursor, selection, and privacy state. Selected text is omitted when sharing is disabled and truncated at the configured character limit when enabled.

`includeSelectionText=false` omits selected text regardless of the sharing setting. `detail=status` returns a compact `EditorStatusSnapshot` containing only the active editor and selection metadata needed by live status polling; older servers safely ignore this parameter and return the full structurally compatible snapshot.

### `POST /v1/settings/selection-sharing`

Requires authentication and a JSON body `{ "enabled": boolean }`. Updates the workspace-scoped VS Code privacy setting.

All responses use JSON and `Cache-Control: no-store`.
