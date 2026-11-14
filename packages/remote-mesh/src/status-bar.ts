import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RemoteMeshConfig } from "./types.js";
import { SshEngine } from "./ssh-engine.js";
import { isLocalHost } from "./config.js";

function getLegacyStatusKey(id: string): string {
  const cleanId = id.toLowerCase();
  if (cleanId === "vps" || cleanId.includes("tokyo")) {
    return "or-tokyo-ssh";
  }
  if (cleanId === "win" || cleanId.includes("pc")) {
    return "win-pc-ssh";
  }
  if (cleanId === "phone" || cleanId.includes("termux")) {
    return "phone-termux-ssh";
  }
  if (cleanId === "mac") {
    return "mac-mini-ssh";
  }
  return `mesh-${id}`;
}

function getDeviceDisplayLabel(id: string, name?: string): string {
  const cleanId = id.toLowerCase();
  if (cleanId === "vps" || cleanId.includes("tokyo")) {
    return "VPS: or-tokyo";
  }
  if (cleanId === "win" || cleanId.includes("pc")) {
    return "Win: win-pc";
  }
  if (cleanId === "phone" || cleanId.includes("termux")) {
    return "手机: phone-termux";
  }
  if (cleanId === "mac") {
    return "Mac: mini";
  }

  const short = (name || id).replace(/\s+(VPS|Host|PC)$/i, "").trim();
  return `${id.toUpperCase()}: ${short}`;
}

export function updateMeshStatusBar(
  ctx: ExtensionContext,
  config: RemoteMeshConfig,
  engine: SshEngine,
): void {
  if (!ctx?.ui) return;

  for (const [id, dev] of Object.entries(config.devices)) {
    const statusKey = getLegacyStatusKey(id);

    // 1. 如果是本地机器直接跳过并清空对应状态，不占屏幕
    if (isLocalHost(dev)) {
      ctx.ui.setStatus(statusKey, undefined);
      continue;
    }

    const isConnected = engine.isConnected(id);
    const label = getDeviceDisplayLabel(id, dev.name);

    // 2. 核心常驻设备 (vps, win)：保持原版体验，显示「按需连接」或「已连接」
    // 3. 次要设备 (phone, unoq 等)：仅在连上时高亮显示，未连时不占用窄屏宽度
    const isPrimaryDevice = /vps|win|tokyo|pc/i.test(id);
    if (!isPrimaryDevice && !isConnected) {
      ctx.ui.setStatus(statusKey, undefined);
      continue;
    }

    const text = isConnected ? `${label} 已连接` : `${label} 按需连接`;
    const color = isConnected ? "success" : "dim";

    ctx.ui.setStatus(statusKey, ctx.ui.theme.fg(color, text));
  }
}

export function clearMeshStatusBar(ctx: ExtensionContext, config: RemoteMeshConfig): void {
  if (!ctx?.ui) return;
  for (const id of Object.keys(config.devices)) {
    ctx.ui.setStatus(getLegacyStatusKey(id), undefined);
    ctx.ui.setStatus(`mesh-${id}`, undefined);
  }
}
