# 📊 pi-smart-quota

> **Smart Adaptive Quota Monitor for Pi Coding Agent**  
> 专为 [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) 打造的自适应配额监控扩展。实时追踪 **OpenAI Codex** 与 **Google Antigravity (AGY)** 的剩余额度、配额池窗口与重置时间，并在终端 TUI 状态栏智能展示。

[![npm version](https://img.shields.io/npm/v/pi-smart-quota.svg)](https://www.npmjs.com/package/pi-smart-quota)
[![license](https://img.shields.io/github/license/kongzhuww/pi-smart-quota.svg)](LICENSE)
[![Pi Package](https://img.shields.io/badge/pi--package-extension-blue)](https://github.com/earendil-works/pi-coding-agent)

---

## ✨ 核心特性

- 🎯 **双主流提供商原生深度适配**：
  - **OpenAI Codex**：精准获取 5 小时与 7 天窗口剩余百分比及重置时间（自动解析 OAuth JWT 中的 Account ID）。
  - **Google Antigravity (AGY)**：深度解构配额桶，智能区分 **Gemini 4 (Argon) 独立周配额池** 与 **Claude / Gemini 5h & 7d 窗口**。
- 🔄 **模型切换实时自适应联动**：
  - 监听 Pi 的 `model_select` 事件，切换到 Codex 即刻显示 Codex 水位，切换到 Antigravity 即刻显示 AGY 水位，切换其他提供商时优雅静默隐藏。
- 👥 **Antigravity 多账号自动感知**：
  - 自动读取本地 Google 账号池（`antigravity-accounts.json`），在查看详情时同时汇总所有备用账号的健康度与剩余配额，方便负载调度。
- 📈 **ASCII 进度条与三色健康预警**：
  - TUI 状态栏与通知卡片集成高质感 ASCII 进度条（`[██████░░░░] 60.0%`），根据剩余额度呈现绿（充裕）、黄（告警 ≤25%）、红（紧急 ≤10%）颜色。
- ⚡ **高性能防击穿与缓存防抖**：
  - 内置 1 分钟请求防抖与并发 Promise 合并复用，防止高频触发或切换模型时击穿接口限流。
- 🌐 **代理感知**：
  - 原生支持 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量自动透传。

---

## 📦 安装方法

在 Pi 终端内运行以下命令一键安装：

```bash
pi install npm:pi-smart-quota
```

或者本地全局/项目引入：

```bash
npm install -g pi-smart-quota
```

---

## 🚀 常用命令

| 命令 | 说明 | 示例 |
| :--- | :--- | :--- |
| **`/quota`** | 智能查看当前活动模型提供商的配额详情与重置时间 | `/quota` |
| **`/quota all`** | 强制刷新并同时汇总展示所有已授权服务（Codex + AGY 所有账号） | `/quota all` |
| **`/quota codex`** | 强制刷新并仅查看 OpenAI Codex 配额卡片 | `/quota codex` |
| **`/quota agy`** | 强制刷新并仅查看 Google Antigravity 配额桶与所有备用账号 | `/quota agy` |
| **`/codex-quota`** | （快捷别名）强制刷新 Codex 配额 | `/codex-quota` |
| **`/antigravity-quota`** | （快捷别名）强制刷新 Antigravity 配额 | `/antigravity-quota` |

---

## 🖥️ 状态栏显示效果

- **OpenAI Codex 生效时**：  
  `Codex · 5h 98% · 7d 85%`
- **Google Antigravity (Gemini) 生效时**：  
  `AGY (Gemini) · 5h 92% · 7d 88% · G4 75%`
- **Google Antigravity (Claude) 生效时**：  
  `AGY (Claude) · 5h 80% · 7d 70%`

---

## 🛠️ 本地开发与构建

```bash
# 克隆仓库
git clone https://github.com/kongzhuww/pi-smart-quota.git
cd pi-smart-quota

# 安装依赖
npm install

# 运行构建 (tsup)
npm run build

# 运行单元测试
npm test

# 类型检查
npm run typecheck
```

---

## ⚠️ 免责声明 (Disclaimer)

本项目为社区非官方开源扩展。配额查询依赖各上游服务客户端内部接口（Internal Endpoints）。本项目不收集、不存储任何用户的 Token 或私有数据，所有凭据均直接由本地 Pi Agent 官方凭据管理器提供。

---

## 📄 License

[MIT License](LICENSE) © 2025 [kongzhu](https://github.com/kongzhuww)
