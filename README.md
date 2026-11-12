# 🔔 pi-desktop-toast

> **Zero-Dependency Native OS Desktop Notifications for Pi Coding Agent**  
> 专为 [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) 打造的跨平台系统原生桌面通知扩展。无需安装任何繁重的本地 C++ 依赖或第三方守护进程，原生调用 macOS 通知中心、Windows WinRT Toast 以及 Linux notify-send。

[![npm version](https://img.shields.io/npm/v/pi-desktop-toast.svg)](https://www.npmjs.com/package/pi-desktop-toast)
[![license](https://img.shields.io/github/license/kongzhuww/pi-desktop-toast.svg)](LICENSE)
[![Pi Package](https://img.shields.io/badge/pi--package-extension-blue)](https://github.com/earendil-works/pi-coding-agent)

---

## ✨ 核心特性

- 🚀 **极轻量零依赖 (Zero-Dependency)**：
  - 不引入任何 native 编译二进制或繁重三方库，仅 7KB 纯净打包体积。
- 🖥️ **跨平台原生驱动**：
  - **macOS**：直接桥接 macOS 系统通知中心（支持标题、副标题与系统默认 Chime 提示音）；
  - **Windows 10 / 11**：原生 WinRT `ToastNotificationManager`，支持带应用图标的富文本磁贴通知，后台静默触发；
  - **Linux**：标准 `notify-send` 协议接入，兼容 GNOME / KDE / Wayland 桌面通知规范。
- 🛡️ **智能防打扰 (Smart Threshold)**：
  - 内置任务耗时阈值（默认 3 秒）：极短的单次打招呼或瞬间完成的指令**自动静音不弹窗**，只有真正耗时执行的代码任务才会在完成时提醒。
- 🎯 **全链路关键节点提醒**：
  - **任务完成 (`agent_settled`)**：执行完成时弹窗提醒，并标注任务耗时；
  - **等待批准 (`ui_prompt_start`)**：遇到需要人工确认的高危操作或授权时即时弹窗；
  - **提问待答 (`ask_user_question`)**：Agent 遇到需求歧义主动向你发问时弹出具体问题。
- 📂 **工作区与上下文感知**：
  - 自动识别当前 Pi 所属的工作区（支持 Herdr 工作区标签或当前项目目录 CWD），多终端并发展开时一眼分清是哪个任务跑完了。

---

## 📦 安装使用

在 Pi 终端内运行：

```bash
pi install npm:pi-desktop-toast
```

或者本地全局安装：

```bash
npm install -g pi-desktop-toast
```

---

## 🚀 命令

| 命令 | 说明 |
| :--- | :--- |
| **`/toast-test`** | 立即发送一条测试系统桌面通知，用于验证通知中心通道与系统权限是否正常 |

---

## ⚙️ 可配置选项

你可以在 Pi 的全局 `settings.json` 中按需定制选项（支持开箱默认值）：

```json
{
  "desktopToast": {
    "enabled": true,
    "minDurationSeconds": 3,
    "sound": true,
    "notifyOnSettled": true,
    "notifyOnPrompt": true,
    "notifyOnQuestion": true
  }
}
```

---

## 🛠️ 本地开发与构建

```bash
# 克隆仓库
git clone https://github.com/kongzhuww/pi-desktop-toast.git
cd pi-desktop-toast

# 安装构建依赖
npm install

# 编译打包 (tsup)
npm run build

# 运行单测
npm test
```

---

## 📄 License

[MIT License](LICENSE) © 2025 [kongzhu](https://github.com/kongzhuww)
