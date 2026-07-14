# Pi Context Bridge

Pi Context Bridge lets [Pi coding agent](https://github.com/earendil-works/pi) see the live context of a local VS Code window even when Pi is running in a different terminal application.

It is a small, local-only pair of extensions:

- **Pi Context Bridge for VS Code** captures workspace, active file, cursor, selection, selected text, dirty state, and open editors.
- **`pi-context-bridge` for Pi** discovers matching VS Code windows by working directory and injects the current snapshot before each prompt.

## Security and privacy

- The HTTP bridge binds only to `127.0.0.1` on a random port.
- Every VS Code window receives a fresh 256-bit bearer token.
- Unix discovery files use `0700`/`0600` permissions; Windows files live under the shared `%USERPROFILE%/.pi/agent` configuration tree.
- Selected text sharing is visible and can be disabled from VS Code or with `/vscode toggle-selection`.
- No telemetry or cloud service is used.

## Development

Requirements: Node.js 20+ and Corepack.

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

Press F5 from `packages/vscode-extension` to run an Extension Development Host, or package both artifacts:

```sh
corepack pnpm package:vscode
corepack pnpm package:pi
```

For local Pi development, load the bundled extension directly:

```sh
pi install ./packages/pi-extension
# Or load it for one run without changing settings:
pi --extension ./packages/pi-extension/dist/index.js
```

The generated `.tgz` is intended for npm publication. Pi treats a directly installed local `.tgz` as an extension file rather than unpacking it, so use the package directory for local testing.

## Supported environments

Version 1 supports VS Code, VSCodium, and compatible local desktop forks on Windows, macOS, and Linux when Pi runs in the same OS/network namespace. WSL, Remote SSH, and Dev Containers are intentionally rejected rather than silently connecting to the wrong workspace.

See [docs/protocol.md](docs/protocol.md) for the bridge protocol and discovery rules.
