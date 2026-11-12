import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RemoteMeshConfig, DeviceConfig } from "./types.js";
import { SshEngine } from "./ssh-engine.js";

export function getToolNamesForDevice(device: DeviceConfig, style: "compact" | "prefixed" = "compact"): {
  exec?: string;
  read?: string;
  write?: string;
  status?: string;
  all: string[];
} {
  const prefix = device.toolPrefix || (style === "compact" ? `${device.id}_` : `remote_${device.id}_`);
  const features = new Set(device.features || ["exec", "sftp", "status"]);

  const names: { exec?: string; read?: string; write?: string; status?: string; all: string[] } = {
    all: [],
  };

  if (features.has("exec")) {
    names.exec = `${prefix}exec`;
    names.all.push(names.exec);
  }

  if (features.has("sftp")) {
    names.read = `${prefix}read`;
    names.write = `${prefix}write`;
    names.all.push(names.read, names.write);
  }

  if (features.has("status")) {
    names.status = `${prefix}status`;
    names.all.push(names.status);
  }

  return names;
}

export function registerMeshTools(pi: ExtensionAPI, config: RemoteMeshConfig, engine: SshEngine) {
  const allMeshToolNames = new Set<string>();
  const deviceToolMap = new Map<string, string[]>();

  for (const [id, dev] of Object.entries(config.devices)) {
    const toolNames = getToolNamesForDevice(dev, config.toolNamingStyle);
    deviceToolMap.set(id, toolNames.all);
    for (const name of toolNames.all) {
      allMeshToolNames.add(name);
    }

    // 1. Exec tool
    if (toolNames.exec) {
      pi.registerTool({
        name: toolNames.exec,
        label: `${dev.name || id} Exec`,
        description: `Execute a shell command on remote machine "${dev.name || id}" (${dev.host}). Returns stdout, stderr and exit code.`,
        parameters: Type.Object({
          command: Type.String({ description: "The shell command to execute remotely" }),
          cwd: Type.Optional(Type.String({ description: "Working directory on the remote machine (optional)" })),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        async execute(_id, params, _signal, _onUpdate, _ctx) {
          try {
            const res = await engine.exec(id, params.command, params.cwd);
            let text = res.stdout;
            if (res.stderr) {
              text += (text ? "\n" : "") + `[stderr]\n${res.stderr}`;
            }
            if (res.exitCode !== 0) {
              text += (text ? "\n" : "") + `[Process exited with code ${res.exitCode}]`;
            }
            return {
              content: [{ type: "text", text: text || "(command completed with empty output)" }],
              details: res,
              isError: res.exitCode !== 0,
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `SSH Error on ${id}: ${err instanceof Error ? err.message : String(err)}` }],
              details: { error: err instanceof Error ? err.message : String(err) },
              isError: true,
            };
          }
        },
      });
    }

    // 2. Read tool (SFTP)
    if (toolNames.read) {
      pi.registerTool({
        name: toolNames.read,
        label: `${dev.name || id} Read`,
        description: `Read text content of a remote file on "${dev.name || id}" (${dev.host}) via SFTP.`,
        parameters: Type.Object({
          path: Type.String({ description: "Remote absolute or relative file path" }),
          maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes to read (default 64KB)" })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute(_id, params, _signal, _onUpdate, _ctx) {
          try {
            const res = await engine.readFile(id, params.path, params.maxBytes);
            return {
              content: [{ type: "text", text: res.content }],
              details: { bytes: res.bytes, path: params.path },
              isError: false,
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `SFTP Read Error on ${id}: ${err instanceof Error ? err.message : String(err)}` }],
              details: { error: err instanceof Error ? err.message : String(err), path: params.path },
              isError: true,
            };
          }
        },
      });
    }

    // 3. Write tool (SFTP)
    if (toolNames.write) {
      pi.registerTool({
        name: toolNames.write,
        label: `${dev.name || id} Write`,
        description: `Write text content to a remote file on "${dev.name || id}" (${dev.host}) via SFTP.`,
        parameters: Type.Object({
          path: Type.String({ description: "Remote destination file path" }),
          content: Type.String({ description: "Content to write" }),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        async execute(_id, params, _signal, _onUpdate, _ctx) {
          try {
            const res = await engine.writeFile(id, params.path, params.content);
            return {
              content: [{ type: "text", text: `Successfully wrote ${res.bytes} bytes to ${params.path} on ${id}.` }],
              details: { bytes: res.bytes, path: params.path },
              isError: false,
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `SFTP Write Error on ${id}: ${err instanceof Error ? err.message : String(err)}` }],
              details: { error: err instanceof Error ? err.message : String(err), path: params.path },
              isError: true,
            };
          }
        },
      });
    }

    // 4. Status tool
    if (toolNames.status) {
      pi.registerTool({
        name: toolNames.status,
        label: `${dev.name || id} Status`,
        description: `Check connection and reachability status for remote machine "${dev.name || id}".`,
        parameters: Type.Object({}),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute(_id, _params, _signal, _onUpdate, _ctx) {
          const active = pi.getActiveTools();
          const status = engine.getStatus(id, active.filter((t) => toolNames.all.includes(t)), toolNames.all);
          return {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
            details: status,
            isError: false,
          };
        },
      });
    }
  }

  // Session start: if on-demand exposure is enabled, hide device tools by default
  pi.on("session_start", () => {
    if (config.onDemandExposure) {
      const currentActive = pi.getActiveTools();
      pi.setActiveTools(currentActive.filter((t) => !allMeshToolNames.has(t)));
    }
  });

  // Session shutdown: gracefully close all persistent connections
  pi.on("session_shutdown", async () => {
    await engine.disconnectAll();
  });

  // Controller function for enabling / disabling / disconnecting
  const handleControl = async (
    targetDevice: string,
    action: "enable" | "disable" | "disconnect" | "status"
  ) => {
    const activeSet = new Set(pi.getActiveTools());
    const validDeviceIds = Object.keys(config.devices);

    if (action === "status") {
      const summary: Record<string, any> = {};
      const targets = targetDevice === "all" ? validDeviceIds : [targetDevice];
      for (const devId of targets) {
        if (!config.devices[devId]) continue;
        const tools = deviceToolMap.get(devId) || [];
        summary[devId] = engine.getStatus(
          devId,
          tools.filter((t) => activeSet.has(t)),
          tools
        );
      }
      return { action, summary, isError: false };
    }

    const devicesToActOn = targetDevice === "all" ? validDeviceIds : [targetDevice];
    const affectedTools: string[] = [];
    const disconnectResults: Record<string, boolean> = {};

    for (const devId of devicesToActOn) {
      const tools = deviceToolMap.get(devId) || [];
      affectedTools.push(...tools);

      if (action === "enable") {
        for (const t of tools) activeSet.add(t);
      } else if (action === "disable" || action === "disconnect") {
        for (const t of tools) activeSet.delete(t);
      }

      if (action === "disconnect") {
        disconnectResults[devId] = await engine.disconnect(devId);
      }
    }

    pi.setActiveTools([...activeSet]);

    return {
      target: targetDevice,
      action,
      activeToolsCount: activeSet.size,
      affectedTools,
      disconnectResults: action === "disconnect" ? disconnectResults : undefined,
      isError: false,
    };
  };

  // Register master remote_enable dispatcher tool
  const deviceLiterals = Object.keys(config.devices).map((d) => Type.Literal(d));
  deviceLiterals.push(Type.Literal("all"));

  const deviceSchema = deviceLiterals.length > 0 ? Type.Union(deviceLiterals) : Type.String();

  pi.registerTool({
    name: "remote_enable",
    label: "Remote Devices Mesh Dispatcher",
    description: `Manage SSH mesh device tools (${Object.keys(config.devices).join(", ") || "none configured"}).
- action="enable": Expose the device tools to the model for the next request without reload.
- action="disable": Hide device tools to save prompt tokens.
- action="disconnect": Close persistent SSH connection and hide tools.
- action="status": Query device connectivity and tool activation states.`,
    parameters: Type.Object({
      device: deviceSchema,
      action: Type.Optional(
        Type.Union(
          [
            Type.Literal("enable"),
            Type.Literal("disable"),
            Type.Literal("disconnect"),
            Type.Literal("status"),
          ],
          { description: "Default is 'enable'" }
        )
      ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await handleControl(params.device as string, params.action || "enable");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2) +
                `\n[Notice: If enabled, targeted device tools will be accessible on the next turn. Tokens saved when inactive.]`,
            },
          ],
          details: result,
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Control error: ${err instanceof Error ? err.message : String(err)}` }],
          details: { error: err instanceof Error ? err.message : String(err) },
          isError: true,
        };
      }
    },
  });

  return {
    handleControl,
    allMeshToolNames,
    deviceToolMap,
  };
}
