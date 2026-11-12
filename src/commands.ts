import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RemoteMeshConfig } from "./types.js";
import { SshEngine } from "./ssh-engine.js";
import { DEFAULT_CONFIG_FILENAME, generateTemplateConfig } from "./config.js";

export function registerMeshCommands(
  pi: ExtensionAPI,
  config: RemoteMeshConfig,
  loadedFrom: string | null,
  engine: SshEngine,
  handleControl: (device: string, action: "enable" | "disable" | "disconnect" | "status") => Promise<any>
) {
  const deviceList = Object.keys(config.devices);

  const commandHandler = async (args: string, ctx: ExtensionContext) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const action = parts[0] || "status";
    const target = parts[1] || "all";

    if (action === "init") {
      const targetDir = path.join(os.homedir(), ".pi");
      const targetFile = path.join(targetDir, DEFAULT_CONFIG_FILENAME);

      if (fs.existsSync(targetFile)) {
        ctx.ui.notify(`Config file already exists at: ${targetFile}`, "warning");
        return;
      }

      fs.mkdirSync(targetDir, { recursive: true });
      const template = generateTemplateConfig();
      fs.writeFileSync(targetFile, JSON.stringify(template, null, 2), "utf-8");
      ctx.ui.notify(`Generated template configuration at: ${targetFile}`, "info");
      return;
    }

    if (action === "test") {
      if (!parts[1]) {
        ctx.ui.notify(`Usage: /remote-mesh test <device_id>`, "warning");
        return;
      }
      const devId = parts[1];
      if (!config.devices[devId]) {
        ctx.ui.notify(`Device "${devId}" not found in config. Available: ${deviceList.join(", ")}`, "error");
        return;
      }
      ctx.ui.notify(`Testing SSH connection to "${devId}" (${config.devices[devId].host})...`, "info");
      try {
        const res = await engine.exec(devId, "echo 'SSH_CONNECTION_SUCCESS' && uname -a || ver");
        ctx.ui.notify(`[${devId}] Connected successfully!\n${res.stdout.trim()}`, "info");
      } catch (err) {
        ctx.ui.notify(`[${devId}] Connection failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
      return;
    }

    if (["enable", "disable", "disconnect", "status"].includes(action)) {
      try {
        const res = await handleControl(target, action as any);
        if (action === "status") {
          const configInfo = loadedFrom ? `Config: ${loadedFrom}` : "Config: (none loaded, run /remote-mesh init)";
          const statusOutput = JSON.stringify(res.summary, null, 2);
          ctx.ui.notify(`${configInfo}\n${statusOutput}`, "info");
        } else {
          ctx.ui.notify(`[Remote Mesh] ${action} on "${target}" completed.`, "info");
        }
      } catch (err) {
        ctx.ui.notify(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
      return;
    }

    ctx.ui.notify(
      `Usage: /remote-mesh [status | enable | disable | disconnect | test | init] [device | all]`,
      "warning"
    );
  };

  const completions = [
    { value: "status", label: "status - Show device and tool status" },
    { value: "init", label: "init - Create ~/.pi/remote-mesh.json template" },
    ...deviceList.flatMap((d) => [
      { value: `enable ${d}`, label: `enable ${d} - Expose ${d} tools to model` },
      { value: `disable ${d}`, label: `disable ${d} - Hide ${d} tools` },
      { value: `disconnect ${d}`, label: `disconnect ${d} - Disconnect persistent SSH` },
      { value: `test ${d}`, label: `test ${d} - Test connectivity` },
    ]),
    { value: "enable all", label: "enable all - Expose all tools" },
    { value: "disable all", label: "disable all - Hide all tools" },
    { value: "disconnect all", label: "disconnect all - Disconnect all devices" },
  ];

  // Register primary command: /remote-mesh
  pi.registerCommand("remote-mesh", {
    description: "Manage multi-device SSH mesh: /remote-mesh [status|enable|disable|disconnect|test|init]",
    getArgumentCompletions(prefix) {
      return completions.filter((c) => c.value.startsWith(prefix));
    },
    handler: commandHandler,
  });

  // Register alias for backwards compatibility: /remote-tools
  pi.registerCommand("remote-tools", {
    description: "Manage SSH tools (alias for /remote-mesh)",
    getArgumentCompletions(prefix) {
      return completions.filter((c) => c.value.startsWith(prefix));
    },
    handler: commandHandler,
  });
}
