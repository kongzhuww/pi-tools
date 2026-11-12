import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RemoteMeshConfig } from "./types.js";
import { SshEngine } from "./ssh-engine.js";
import { isLocalHost } from "./config.js";

function getDeviceStatusLabel(id: string, name?: string): string {
  const cleanId = id.toLowerCase();
  let prefix = id.toUpperCase();

  if (cleanId === "vps" || cleanId.includes("tokyo")) {
    prefix = "VPS";
  } else if (cleanId === "win" || cleanId.includes("pc")) {
    prefix = "Win";
  } else if (cleanId === "phone" || cleanId.includes("termux")) {
    prefix = "Phone";
  } else if (cleanId === "mac") {
    prefix = "Mac";
  }

  const shortName = (name || id).replace(/\s+(VPS|Host|PC)$/i, "").trim();
  return `${prefix}: ${shortName}`;
}

export function updateMeshStatusBar(
  ctx: ExtensionContext,
  config: RemoteMeshConfig,
  engine: SshEngine,
): void {
  if (!ctx?.ui) return;

  for (const [id, dev] of Object.entries(config.devices)) {
    const statusKey = `mesh-${id}`;

    // 如果设备配置了本地直连绕过（例如本机是 Mac，目标也是 Mac），则在本地不占状态栏
    if (isLocalHost(dev)) {
      ctx.ui.setStatus(statusKey, undefined);
      continue;
    }

    const isConnected = engine.isConnected(id);
    const label = getDeviceStatusLabel(id, dev.name);
    const text = isConnected ? `${label} 已连接` : `${label} 按需连接`;
    const color = isConnected ? "success" : "dim";

    ctx.ui.setStatus(statusKey, ctx.ui.theme.fg(color, text));
  }
}

export function clearMeshStatusBar(ctx: ExtensionContext, config: RemoteMeshConfig): void {
  if (!ctx?.ui) return;
  for (const id of Object.keys(config.devices)) {
    ctx.ui.setStatus(`mesh-${id}`, undefined);
  }
}
