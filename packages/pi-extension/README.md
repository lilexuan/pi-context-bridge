# pi-context-bridge

Give Pi coding agent live VS Code context even when Pi runs in a separate local terminal.

## Install

```sh
pi install npm:pi-context-bridge
```

Install **Pi Context Bridge** separately from the VS Code Marketplace or Open VSX, then open the same project in VS Code and run Pi from any terminal.

Pi automatically matches its working directory to the deepest VS Code workspace. It injects lightweight editor context transiently for the current agent turn (without appending a hidden session-history message) and exposes `vscode_get_context` for live refreshes.

Commands:

- `/vscode status`
- `/vscode connect`
- `/vscode disconnect`
- `/vscode context`
- `/vscode toggle-selection`

The bridge is local-only, authenticated, and sends no telemetry. WSL, Remote SSH, and Dev Containers are not supported in v1.
