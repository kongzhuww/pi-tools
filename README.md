<div align="center">

# 🛠️ pi-tools

**The Official Monorepo Suite for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) Extensions**

*A modular collection of high-performance, developer-first extensions for terminal workflows, multi-device orchestration, notifications, and AI quota tracking.*

[![license](https://img.shields.io/github/license/kongzhuww/pi-tools.svg?style=flat-square)](LICENSE)
[![Pi Package](https://img.shields.io/badge/pi--package-extension-blue?style=flat-square)](https://github.com/earendil-works/pi-coding-agent)
[![npm suite](https://img.shields.io/badge/npm-workspaces-CB3837?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/~kongzhuww)

</div>

---

## 📦 Packages in this Suite

All packages in this monorepo are independently published to npm and can be installed directly into Pi Coding Agent:

| Package | npm Version | Description | Quick Install |
| :--- | :--- | :--- | :--- |
| **[`pi-command-aliases`](packages/command-aliases)** | [![npm](https://img.shields.io/npm/v/pi-command-aliases.svg?style=flat-square)](https://www.npmjs.com/package/pi-command-aliases) | **Interactive TUI Command Alias Manager**<br>Split-pane visual manager and argument forwarding suite for complex slash commands. | `pi install npm:pi-command-aliases` |
| **[`pi-remote-mesh`](packages/remote-mesh)** | [![npm](https://img.shields.io/npm/v/pi-remote-mesh.svg?style=flat-square)](https://www.npmjs.com/package/pi-remote-mesh) | **Multi-Device SSH Remote Execution Mesh**<br>One config to orchestrate VPS, Windows, and remote development boards with on-demand tool exposure. | `pi install npm:pi-remote-mesh` |
| **[`pi-desktop-toast`](packages/desktop-toast)** | [![npm](https://img.shields.io/npm/v/pi-desktop-toast.svg?style=flat-square)](https://www.npmjs.com/package/pi-desktop-toast) | **Zero-Dependency Native Desktop Notifications**<br>Native macOS Chime alerts, Windows WinRT toasts, and Linux notify-send for long agent tasks. | `pi install npm:pi-desktop-toast` |
| **[`pi-smart-quota`](packages/smart-quota)** | [![npm](https://img.shields.io/npm/v/pi-smart-quota.svg?style=flat-square)](https://www.npmjs.com/package/pi-smart-quota) | **Smart Adaptive Quota Monitor**<br>Real-time OpenAI Codex and Google Antigravity (AGY) quota tracking directly in the Pi statusline. | `pi install npm:pi-smart-quota` |

---

## 🚀 Quick Start

### Installing in Pi Coding Agent

You can install any of the packages individually:

```bash
# Command alias manager & TUI
pi install npm:pi-command-aliases

# Multi-device remote mesh orchestration
pi install npm:pi-remote-mesh

# Native OS notifications on task settlement
pi install npm:pi-desktop-toast

# Statusline AI quota monitoring
pi install npm:pi-smart-quota
```

---

## 🏗️ Development & Monorepo Architecture

This monorepo uses native **npm workspaces** to share common developer dependencies (`typescript`, `tsup`, `@earendil-works/pi-coding-agent`).

### Prerequisites
* Node.js >= 20
* npm >= 10

### Setup

```bash
# Clone the repository
git clone https://github.com/kongzhuww/pi-tools.git
cd pi-tools

# Install all workspace dependencies
npm install

# Build all packages across the workspace
npm run build

# Run all test suites across the workspace
npm test

# Typecheck all packages
npm run typecheck
```

---

## 🔄 Publishing & Release Workflow

Packages are published to npm using GitHub Actions:
- To publish an updated package, bump its version in `packages/<pkg>/package.json` and push a Git Tag (e.g., `v0.1.3` or `remote-mesh-v0.1.3`).
- The automated CI/CD pipeline tests, builds, and pushes only packages with updated versions to npm.

---

## 📄 License

MIT © [kongzhuww](https://github.com/kongzhuww)
