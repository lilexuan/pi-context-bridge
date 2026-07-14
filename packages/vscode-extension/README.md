# Pi Context Bridge for VS Code

The VS Code companion for `pi-context-bridge`. It exposes the active file, cursor, selection, selected text, dirty state, workspace folders, and open text editors to authenticated Pi sessions on the same machine.

The bridge listens only on `127.0.0.1`, uses a per-window random token, and sends no telemetry.

Install the Pi companion separately:

```sh
pi install npm:pi-context-bridge
```
