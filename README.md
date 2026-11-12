# 🌐 pi-remote-mesh

> Multi-device remote SSH execution mesh & on-demand tool exposure for the [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent).  
> 专为 Pi 设计的多端 SSH 协同网格与按需工具调度中心：**一行配置管全家，按需唤醒省 Token，零泄露安全架构**。

---

## 🌟 核心特性 (Features)

- 🎯 **On-Demand Tool Exposure (按需工具暴露)**  
  传统方案会将所有设备的 SSH 工具（数十个 Schema）一股脑全塞进 System Prompt，每轮对话白白浪费数千 Token，且容易引起大模型工具幻觉。  
  `pi-remote-mesh` 默认只暴露一个极轻量的 `remote_enable` 统一调度入口；当模型或用户需要操作特定设备时（如 VPS 或开发板），**动态将该设备工具注入当前会话，用完随时关闭或在重启时自动重置**。

- 🌐 **Multi-Device Mesh Topology (多端网格拓扑)**  
  无论你有几台设备（云端 VPS、常驻 Mac mini、Windows 主力机、安卓 Termux、树莓派/Arduino 开发板），只需在本地配置中声明，即可获得对应的执行与传输能力。

- 🔒 **Zero-Secret Design (零凭证硬编码)**  
  完全解耦代码与隐私凭证。代码纯净开源，设备 IP、私钥路径及连接参数全部保存在本机 `~/.pi/remote-mesh.json`，支持 `chmod 600`，绝不上云、绝不入库。

- ⚡ **Persistent SSH & SFTP Engine (长连接与文件传输)**  
  支持维持低延迟长连接（Keepalive），避免频繁握手；支持 SFTP 读写（`read`/`write`，写入会直接覆盖目标文件，并非原子写入），并提供优雅断开连接命令。

- 🔄 **Local Loopback Bypass (智能防套娃检测)**  
  可配置 `localBypass`，当 Agent 在 Mac 本地运行时，自动识别并拒绝对 Mac 的 SSH 连接；请使用本地工具执行，防止自环回死锁。

---

## 📦 安装 (Installation)

在终端或 Pi 会话中一键安装：

```bash
pi install npm:pi-remote-mesh
```

---

## 🔒 SSH 主机身份验证

Every device requires `hostKeySha256` (OpenSSH `SHA256:...` fingerprint) or `hostFingerprint` (SHA-256 hex). Connections fail closed if it is absent or mismatched. Verify the fingerprint on the server or through an independent trusted channel before adding it to the local configuration; an unverified `ssh-keyscan` alone does not establish trust. For example, on the server, run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` and compare it independently. Host key rotation requires independently verifying and updating the pin. Existing devices without a pin cannot connect until configured.

## 🚀 快速上手 (Quickstart)

### 1. 初始化配置模板

在终端或 Pi 会话中运行：

```bash
/remote-mesh init
```

该命令将在 `~/.pi/remote-mesh.json` 生成一份标准的配置模板。

### 2. 填写设备信息

编辑 `~/.pi/remote-mesh.json`（支持 `~` 自动展开为用户家目录）：

```json
{
  "version": "1.0",
  "toolNamingStyle": "compact",
  "onDemandExposure": true,
  "devices": {
    "vps": {
      "name": "Tokyo Cloud VPS",
      "host": "1.2.3.4",
      "port": 22,
      "username": "ubuntu",
      "privateKeyPath": "~/.ssh/id_rsa",
      "hostKeySha256": "SHA256:REPLACE_WITH_INDEPENDENTLY_VERIFIED_FINGERPRINT",
      "features": ["exec", "sftp", "status"],
      "persistent": true,
      "defaultCwd": "/home/ubuntu"
    },
    "phone": {
      "name": "Android Termux",
      "host": "192.168.1.50",
      "port": 8022,
      "username": "u0_a100",
      "privateKeyPath": "~/.ssh/termux_key",
      "hostKeySha256": "SHA256:REPLACE_WITH_INDEPENDENTLY_VERIFIED_FINGERPRINT",
      "features": ["exec", "sftp"],
      "persistent": true
    },
    "mac": {
      "name": "Mac mini Host",
      "host": "mac-mini.local",
      "port": 22,
      "username": "developer",
      "privateKeyPath": "~/.ssh/id_ed25519",
      "hostKeySha256": "SHA256:REPLACE_WITH_INDEPENDENTLY_VERIFIED_FINGERPRINT",
      "features": ["exec", "status"],
      "persistent": false,
      "localBypass": true,
      "localHostnames": ["mac-mini", "mac-mini.local"]
    }
  }
}
```

### 3. 测试连通性

```bash
/remote-mesh test vps
```

测试成功后，运行 `/reload` 或重启 Pi 即可生效！

---

## 🛠️ 工具与命令速查

### 🤖 注册的 Agent Tools

| 工具名称 | 暴露时机 | 功能描述 |
| :--- | :--- | :--- |
| **`remote_enable`** | **始终激活 (Always Active)** | 调度中心。接受 `{ device: "vps", action: "enable" \| "disable" \| "disconnect" \| "status" }`。按需将目标设备工具暴露给下一轮对话，或断开连接。 |
| **`{device}_exec`** | **按需激活 (On-Demand)** | 在远程设备上执行 Bash / Shell 命令，返回 stdout、stderr 与 exitCode。 |
| **`{device}_read`** | **按需激活 (On-Demand)** | 通过 SFTP 读取远程文件内容（支持 UTF-8 文本与文件大小防爆保护）。 |
| **`{device}_write`** | **按需激活 (On-Demand)** | 通过 SFTP 直接写入并覆盖远程目标文件；写入不是原子的。 |
| **`{device}_status`**| **按需激活 (On-Demand)** | 实时检测并返回目标设备的 SSH 连接状态与网络连通性。 |

*(注：若配置 `"toolNamingStyle": "prefixed"`，工具名将变为 `remote_{device}_exec` 等。)*

---

### 💻 终端控制台命令

在 Pi 命令行输入 `/remote-mesh`（或兼容别名 `/remote-tools`）：

- `/remote-mesh status`：查看已配置的设备列表、连接状态及当前激活工具。
- `/remote-mesh enable <device|all>`：手动激活目标设备工具至会话。
- `/remote-mesh disable <device|all>`：手动隐藏目标设备工具以节省 Token。
- `/remote-mesh disconnect <device|all>`：关闭指定设备的持久化 SSH 连接并隐藏工具。
- `/remote-mesh test <device>`：发起一次快速网络与 SSH 连通性测试。
- `/remote-mesh init`：在 `~/.pi/remote-mesh.json` 创建初始模板。

---

## ⚙️ 完整配置项说明 (Schema)

| 字段 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `name` | string | `id` | 设备展示名称 |
| `host` | string | **必填** | 目标主机 IP、域名或 Tailscale 域名 |
| `port` | number | `22` | SSH 服务端口 |
| `username` | string | 当前系统用户 | 远程登录用户名 |
| `privateKeyPath`| string | 可选 | 私钥绝对路径或 `~/.ssh/...` 相对路径 |
| `hostKeySha256` / `hostFingerprint` | string | 二选一必填 | 分别接受 OpenSSH SHA256 base64 或 SHA-256 十六进制指纹，未匹配时拒绝连接 |
| `password` | string | 可选 | 密码认证（建议优先使用私钥） |
| `passphrase` | string | 可选 | 私钥解密密码 |
| `persistent` | boolean| `true` | 是否维持长连接复用（单次脚本建议设为 `false`） |
| `features` | array | `["exec", "sftp", "status"]` | 启用的功能模块列表 |
| `defaultCwd` | string | `"~"` | 远程命令默认执行工作目录 |
| `connectTimeoutMs` | number | `10000` | 连接超时时间（毫秒） |
| `maxOutputBytes` | number | `32768` | 终端最大截断字节数，防止长输出爆内存 |
| `maxOutputLines` | number | `300` | 终端最大输出行数 |
| `localBypass` | boolean| `false` | 若当前 Agent 就在该设备上运行，是否自动忽略 SSH |
| `localHostnames`| array | `[]` | 用于辅助识别本机的别名列表 |

---

## 🚢 发布到 npm (Publishing Guide)

如果你是维护者，将本项目发布到 npm 仅需以下步骤：

```bash
# 1. 登录 npm 账号
npm login

# 2. 检查构建与单元测试
npm test
npm run build

# 3. 发布公开包
npm publish --access public
```

---

## 📄 License

[MIT License](LICENSE) © 2025 kongzhu
