import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadMeshConfig } from "./config.js";
import { SshEngine } from "./ssh-engine.js";
import { registerMeshTools } from "./tool-registry.js";
import { registerMeshCommands } from "./commands.js";
import { updateMeshStatusBar, clearMeshStatusBar } from "./status-bar.js";

export * from "./types.js";
export * from "./config.js";
export * from "./ssh-engine.js";
export * from "./tool-registry.js";
export * from "./commands.js";
export * from "./status-bar.js";

export default function (pi: ExtensionAPI) {
  const { config, loadedFrom } = loadMeshConfig();
  const engine = new SshEngine(config.devices);

  const { handleControl } = registerMeshTools(pi, config, engine);
  registerMeshCommands(pi, config, loadedFrom, engine, handleControl);

  // 初始化会话时渲染状态栏设备指示器
  pi.on("session_start", (_event, ctx) => {
    updateMeshStatusBar(ctx, config, engine);
  });

  // 会话关闭时清理状态栏与持久连接
  pi.on("session_shutdown", async (_event, ctx) => {
    clearMeshStatusBar(ctx, config);
  });
}
