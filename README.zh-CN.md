# Pi Context Bridge

[English](README.md) | [简体中文](README.zh-CN.md)

让 [Pi coding agent](https://github.com/earendil-works/pi) 获取本机 VS Code 的实时编辑上下文——即使 Pi 运行在另一个终端中也可以。

Pi Context Bridge 由两个轻量、本地运行的扩展组成：

- **VS Code 扩展**采集工作区、当前文件、光标、选区、未保存状态和已打开的编辑器。
- **Pi 扩展**根据 Pi 的工作目录找到对应的 VS Code 窗口，并在每次提问前加入最新的编辑器上下文。

## 快速开始

> npm 和扩展市场暂未发布安装包。目前请从源码安装两个扩展。

### 环境要求

- [Node.js](https://nodejs.org/) 20 或更高版本，并启用 Corepack
- [Pi coding agent](https://github.com/earendil-works/pi)
- VS Code 1.95 或更高版本（也支持 VSCodium 和兼容的桌面发行版）

### 1. 构建扩展

```sh
git clone https://github.com/lilexuan/pi-context-bridge.git
cd pi-context-bridge
corepack pnpm install
corepack pnpm build
corepack pnpm package:vscode
```

### 2. 安装桥接两端

安装刚刚生成的 VS Code 扩展：

```sh
code --install-extension packages/vscode-extension/pi-context-bridge.vsix
```

如果没有 `code` 命令，请在 VS Code 命令面板中运行 **Extensions: Install from VSIX...**，然后选择同一个文件。

接着从仓库目录安装 Pi 扩展：

```sh
pi install ./packages/pi-extension
```

### 3. 验证连接

1. 在 VS Code 中打开一个项目。
2. 在任意本机终端中进入该项目（或它的子目录），然后启动 `pi`。
3. 在 Pi 中运行 `/vscode status`，此时应该能看到匹配的 VS Code 工作区。
4. 向 Pi 询问当前文件或选中的代码——编辑器上下文会自动加入对话。

Pi 会选择工作目录匹配最深的 VS Code 工作区，不要求从 VS Code 集成终端启动。

## 使用方法

Pi 扩展提供以下命令：

- `/vscode status` — 查看当前连接和选中文本共享状态
- `/vscode connect` — 手动选择一个 VS Code 窗口
- `/vscode disconnect` — 断开当前窗口
- `/vscode context` — 预览当前编辑器上下文
- `/vscode toggle-selection` — 开启或关闭选中文本共享

扩展还提供 `vscode_get_context` 工具，让 Pi 在工作过程中刷新编辑器上下文。

在 VS Code 中，可以点击 Pi Context Bridge 状态栏项目，或在命令面板中搜索 **Pi Context Bridge**，查看连接或调整选中文本共享。

## 安全与隐私

- HTTP 桥接仅监听 `127.0.0.1`，并使用随机端口。
- 每个 VS Code 窗口都会获得全新的 256 位 bearer token。
- Unix 上的发现文件使用 `0700`/`0600` 权限；Windows 上的文件位于 `%USERPROFILE%/.pi/agent`。
- 是否共享选中文本始终可见，并可在 VS Code 中或通过 `/vscode toggle-selection` 关闭。
- 不包含遥测，也不使用云服务。

## 支持的环境

版本 1 支持 Windows、macOS 和 Linux 上的 VS Code、VSCodium 以及兼容的本地桌面发行版，前提是 Pi 与编辑器处于相同的操作系统和网络命名空间。

目前会主动拒绝 WSL、Remote SSH 和 Dev Containers，避免 Pi 在无提示的情况下连接到错误的工作区。

## 常见问题

- **`/vscode status` 找不到窗口：**确认 VS Code 扩展已启用，并且 Pi 的工作目录位于一个已打开的工作区内。
- **连接到了错误的窗口：**运行 `/vscode connect`，手动选择目标工作区。
- **不想共享选中的文本：**运行 `/vscode toggle-selection`，或在 VS Code 中运行 **Pi Context Bridge: Toggle Selection Sharing**。
- **使用 VSCodium：**在 VSIX 安装命令中将 `code` 替换为 `codium`。

## 开发

安装依赖并运行全部检查：

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

在 `packages/vscode-extension` 中按 F5 可以启动扩展开发宿主。要打包两个扩展，请运行：

```sh
corepack pnpm package:vscode
corepack pnpm package:pi
```

如果只想临时加载 Pi 扩展而不修改设置：

```sh
pi --extension ./packages/pi-extension/dist/index.js
```

生成的 `.tgz` 用于发布到 npm。Pi 会把本地安装的 `.tgz` 直接当作扩展文件，而不会解包，因此本地测试时请使用扩展目录。

桥接协议和发现规则请参阅 [docs/protocol.md](docs/protocol.md)。
