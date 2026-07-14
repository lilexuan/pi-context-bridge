# Pi Context Bridge

[English](README.md) | [简体中文](README.zh-CN.md)

Give [Pi coding agent](https://github.com/earendil-works/pi) the live context of your local VS Code window—even when Pi is running in a different terminal.

Pi Context Bridge is a small, local-only pair of extensions:

- The **VS Code extension** captures your workspace, active file, cursor, selection, dirty state, and open editors.
- The **Pi extension** finds the VS Code window that matches Pi's working directory and adds the latest editor context to each prompt.

## Quickstart

> Packages have not been published to npm or the extension marketplaces yet. For now, install both extensions from source.

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer, with Corepack
- [Pi coding agent](https://github.com/earendil-works/pi)
- VS Code 1.95 or newer (VSCodium and compatible desktop forks are also supported)

### 1. Build the extensions

```sh
git clone https://github.com/lilexuan/pi-context-bridge.git
cd pi-context-bridge
corepack pnpm install
corepack pnpm build
corepack pnpm package:vscode
```

### 2. Install both sides of the bridge

Install the generated VS Code extension:

```sh
code --install-extension packages/vscode-extension/pi-context-bridge.vsix
```

If the `code` command is unavailable, run **Extensions: Install from VSIX...** from the VS Code Command Palette and select the same file.

Then install the Pi extension from the repository directory:

```sh
pi install ./packages/pi-extension
```

### 3. Try it

1. Open a project in VS Code.
2. In any local terminal, change to that project (or one of its subdirectories) and start `pi`.
3. Run `/vscode status` in Pi. It should show the matching VS Code workspace.
4. Ask Pi about the current file or selection—editor context is now added automatically.

Pi matches its working directory to the deepest open VS Code workspace. You do not need to start Pi from VS Code's integrated terminal.

## Usage

The Pi extension provides these commands:

- `/vscode status` — show the current connection and selection-sharing state
- `/vscode connect` — choose a VS Code window manually
- `/vscode disconnect` — disconnect the current window
- `/vscode context` — preview the current editor context
- `/vscode toggle-selection` — enable or disable sharing selected text

It also exposes the `vscode_get_context` tool so Pi can refresh editor context while working.

In VS Code, click the Pi Context Bridge status-bar item or search for **Pi Context Bridge** in the Command Palette to inspect the connection and change selection sharing.

## Security and privacy

- The HTTP bridge listens only on `127.0.0.1` and uses a random port.
- Every VS Code window receives a fresh 256-bit bearer token.
- Unix discovery files use `0700`/`0600` permissions; Windows files live under `%USERPROFILE%/.pi/agent`.
- Selected text sharing is visible and can be disabled from VS Code or with `/vscode toggle-selection`.
- No telemetry or cloud service is used.

## Supported environments

Version 1 supports VS Code, VSCodium, and compatible local desktop forks on Windows, macOS, and Linux when Pi runs in the same OS and network namespace.

WSL, Remote SSH, and Dev Containers are intentionally rejected to prevent Pi from silently connecting to the wrong workspace.

## Troubleshooting

- **`/vscode status` finds no window:** confirm the VS Code extension is enabled and that Pi's working directory is inside an open workspace.
- **The wrong window is selected:** run `/vscode connect` and choose the desired workspace.
- **You do not want to share selected text:** run `/vscode toggle-selection`, or use **Pi Context Bridge: Toggle Selection Sharing** in VS Code.
- **You use VSCodium:** replace `code` with `codium` in the VSIX installation command.

## Development

Install dependencies and run all checks:

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

Press F5 from `packages/vscode-extension` to run an Extension Development Host. To package both artifacts:

```sh
corepack pnpm package:vscode
corepack pnpm package:pi
```

For a one-off Pi run without changing its settings:

```sh
pi --extension ./packages/pi-extension/dist/index.js
```

The generated `.tgz` is intended for npm publication. Pi treats a directly installed local `.tgz` as an extension file rather than unpacking it, so use the package directory for local testing.

See [docs/protocol.md](docs/protocol.md) for the bridge protocol and discovery rules.
