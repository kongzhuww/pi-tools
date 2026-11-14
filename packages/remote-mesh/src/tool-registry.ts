import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RemoteMeshConfig, DeviceConfig } from "./types.js";
import { SshEngine } from "./ssh-engine.js";
import { updateMeshStatusBar } from "./status-bar.js";

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
  const approved = new Set<string>();
  let sessionGeneration = 0;
  const deviceGenerations = new Map<string, number>();
  let approvalQueue: Promise<void> = Promise.resolve();
  const requireApproval = (id: string) => {
    if (!approved.has(id)) throw new Error(`Device "${id}" is not authorized in this session. Enable it and approve first.`);
  };

  for (const [id, dev] of Object.entries(config.devices)) {
    const toolNames = getToolNamesForDevice(dev, config.toolNamingStyle);
    deviceToolMap.set(id, toolNames.all);
    for (const name of toolNames.all) {
      if (allMeshToolNames.has(name)) {
        throw new Error(`Duplicate remote tool name "${name}". Set unique toolPrefix values.`);
      }
      allMeshToolNames.add(name);
    }

    // 1. Exec tool
    if (toolNames.exec) {
      pi.registerTool({
        name: toolNames.exec,
        defaultActive: false,
        label: `${dev.name || id} Exec`,
        description: `Execute a shell command on remote machine "${dev.name || id}" (${dev.host}). Returns stdout, stderr and exit code.`,
        parameters: Type.Object({
          command: Type.String({ description: "The shell command to execute remotely" }),
          cwd: Type.Optional(Type.String({ description: "Working directory on the remote machine (optional)" })),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        async execute(_id, params, signal, _onUpdate, _ctx) {
          try {
            requireApproval(id);
            const res = await engine.exec(id, params.command, params.cwd, signal);
            if (_ctx?.ui) updateMeshStatusBar(_ctx, config, engine);
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
        defaultActive: false,
        label: `${dev.name || id} Read`,
        description: `Read text content of a remote file on "${dev.name || id}" (${dev.host}) via SFTP.`,
        parameters: Type.Object({
          path: Type.String({ description: "Remote absolute or relative file path" }),
          maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes to read (default 64KB)", minimum: 1 })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute(_id, params, signal, _onUpdate, _ctx) {
          try {
            requireApproval(id);
            const res = await engine.readFile(id, params.path, params.maxBytes, signal);
            if (_ctx?.ui) updateMeshStatusBar(_ctx, config, engine);
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
        defaultActive: false,
        label: `${dev.name || id} Write`,
        description: `Write text content to a remote file on "${dev.name || id}" (${dev.host}) via SFTP.`,
        parameters: Type.Object({
          path: Type.String({ description: "Remote destination file path" }),
          content: Type.String({ description: "Content to write" }),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        async execute(_id, params, signal, _onUpdate, _ctx) {
          try {
            requireApproval(id);
            const res = await engine.writeFile(id, params.path, params.content, signal);
            if (_ctx?.ui) updateMeshStatusBar(_ctx, config, engine);
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
        defaultActive: false,
        label: `${dev.name || id} Status`,
        description: `Check connection and reachability status for remote machine "${dev.name || id}".`,
        parameters: Type.Object({}),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute(_id, _params, _signal, _onUpdate, _ctx) {
          const active = pi.getActiveTools();
          const status = engine.getStatus(id, active.filter((t) => toolNames.all.includes(t)), toolNames.all);
          if (_ctx?.ui) updateMeshStatusBar(_ctx, config, engine);
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
    sessionGeneration++;
    approved.clear();
    if (config.onDemandExposure) {
      const currentActive = pi.getActiveTools();
      pi.setActiveTools(currentActive.filter((t) => !allMeshToolNames.has(t)));
    }
  });

  // Session shutdown: gracefully close all persistent connections
  pi.on("session_shutdown", async () => {
    sessionGeneration++;
    approved.clear();
    await engine.disconnectAll();
  });

  // Controller function for enabling / disabling / disconnecting
  const handleControl = async (
    targetDevice: string,
    action: "enable" | "disable" | "disconnect" | "status",
    ctx?: ExtensionContext
  ) => {
    if (targetDevice !== "all" && !Object.hasOwn(config.devices, targetDevice)) throw new Error(`Unknown device: ${targetDevice}`);
    if (!["enable", "disable", "disconnect", "status"].includes(action)) throw new Error(`Unknown action: ${action}`);
    const targets = targetDevice === "all" ? Object.keys(config.devices) : [targetDevice];
    if (action === "enable") {
      const generation = sessionGeneration;
      const deviceSnapshot = targets.map(id => deviceGenerations.get(id) ?? 0);
      const requestApproval = approvalQueue.then(async () => {
        ctx?.signal?.throwIfAborted();
        if (generation !== sessionGeneration || targets.some((id, i) => (deviceGenerations.get(id) ?? 0) !== deviceSnapshot[i])) {
          throw new Error("Session or device authorization changed while awaiting remote approval.");
        }
        const pending = targets.filter(id => !approved.has(id));
        if (!pending.length) return;
        if (!ctx?.hasUI) throw new Error("Interactive approval required; no UI is available.");
        const description = pending.map(id => `${id}: ${config.devices[id].username}@${config.devices[id].host}:${config.devices[id].port ?? 22}`).join("\n");
        const ok = await ctx.ui.confirm("Authorize remote devices for this session?", `${description}\n\nAfter approval, commands and file writes are permitted without further prompts until disconnect or session restart.`);
        ctx.signal?.throwIfAborted();
        if (generation !== sessionGeneration || targets.some((id, i) => (deviceGenerations.get(id) ?? 0) !== deviceSnapshot[i])) {
          throw new Error("Session or device authorization changed while awaiting remote approval.");
        }
        if (!ok) throw new Error("Remote device authorization declined.");
        for (const id of pending) approved.add(id);
      });
      approvalQueue = requestApproval.catch(() => {});
      await requestApproval;
    }
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
        approved.delete(devId);
        deviceGenerations.set(devId, (deviceGenerations.get(devId) ?? 0) + 1);
      }
    }

    // Hide tools before awaiting disconnect so new turns cannot start work.
    pi.setActiveTools([...activeSet]);
    if (action === "disconnect") {
      for (const devId of devicesToActOn) disconnectResults[devId] = await engine.disconnect(devId);
    }

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
        const result = await handleControl(params.device as string, params.action || "enable", _ctx);
        if (_ctx?.ui) updateMeshStatusBar(_ctx, config, engine);
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
