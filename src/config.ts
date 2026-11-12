import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { RemoteMeshConfig, DeviceConfig } from "./types.js";

export const DEFAULT_CONFIG_FILENAME = "remote-mesh.json";
export const LEGACY_CONFIG_FILENAME = "remote-devices.json";

export function resolveUserPath(filepath: string): string {
  if (!filepath) return filepath;
  if (filepath.startsWith("~")) {
    return path.join(os.homedir(), filepath.slice(1).replace(/^[/\\]+/, ""));
  }
  return path.resolve(filepath);
}

export function getConfigPaths(): string[] {
  const envPath = process.env.PI_REMOTE_MESH_CONFIG;
  const paths: string[] = [];

  if (envPath) {
    paths.push(resolveUserPath(envPath));
  }

  const piDir = path.join(os.homedir(), ".pi");
  paths.push(path.join(piDir, DEFAULT_CONFIG_FILENAME));
  paths.push(path.join(piDir, LEGACY_CONFIG_FILENAME));
  paths.push(path.join(process.cwd(), DEFAULT_CONFIG_FILENAME));

  return paths;
}

export function findConfigFile(): string | null {
  for (const candidate of getConfigPaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function normalizeDeviceConfig(id: string, raw: Partial<DeviceConfig>): DeviceConfig {
  const auth = raw.auth || {};
  const privateKeyPath = resolveUserPath(raw.privateKeyPath || auth.privateKeyPath || "");

  return {
    id,
    name: raw.name || id,
    host: raw.host || "127.0.0.1",
    port: raw.port || 22,
    username: raw.username || os.userInfo().username || "root",
    auth: {
      type: raw.auth?.type || (privateKeyPath ? "key" : "agent"),
      privateKeyPath: privateKeyPath || undefined,
      passphrase: raw.passphrase || auth.passphrase,
      password: raw.password || auth.password,
      agent: raw.auth?.agent,
    },
    privateKeyPath: privateKeyPath || undefined,
    persistent: raw.persistent !== false, // default true
    features: raw.features || ["exec", "sftp", "status"],
    defaultCwd: raw.defaultCwd || "~",
    connectTimeoutMs: raw.connectTimeoutMs || 10000,
    keepaliveIntervalMs: raw.keepaliveIntervalMs || 10000,
    keepaliveCountMax: raw.keepaliveCountMax || 3,
    maxOutputBytes: raw.maxOutputBytes || 32768,
    maxOutputLines: raw.maxOutputLines || 300,
    env: raw.env || {},
    localBypass: raw.localBypass ?? false,
    localHostnames: raw.localHostnames || [],
    toolPrefix: raw.toolPrefix,
  };
}

export function loadMeshConfig(): { config: RemoteMeshConfig; loadedFrom: string | null } {
  const configPath = findConfigFile();
  if (!configPath) {
    return {
      config: {
        version: "1.0",
        toolNamingStyle: "compact",
        onDemandExposure: true,
        devices: {},
      },
      loadedFrom: null,
    };
  }

  try {
    const rawContent = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(rawContent) as Partial<RemoteMeshConfig>;

    const devices: Record<string, DeviceConfig> = {};
    if (parsed.devices && typeof parsed.devices === "object") {
      for (const [id, dev] of Object.entries(parsed.devices)) {
        devices[id] = normalizeDeviceConfig(id, dev);
      }
    }

    return {
      config: {
        version: parsed.version || "1.0",
        toolNamingStyle: parsed.toolNamingStyle || "compact",
        onDemandExposure: parsed.onDemandExposure !== false,
        devices,
      },
      loadedFrom: configPath,
    };
  } catch (err) {
    console.error(`[pi-remote-mesh] Failed to parse config file at ${configPath}:`, err);
    return {
      config: {
        version: "1.0",
        toolNamingStyle: "compact",
        onDemandExposure: true,
        devices: {},
      },
      loadedFrom: null,
    };
  }
}

export function isLocalHost(device: DeviceConfig): boolean {
  if (!device.localBypass) return false;

  const currentHost = os.hostname().toLowerCase();
  const targetHost = device.host.toLowerCase();

  // 跨平台自动特征探测：Mac 本机上目标是 mac；Windows 本机上目标是 win
  if (process.platform === "darwin" && /mac/i.test(device.id)) {
    return true;
  }
  if (process.platform === "win32" && /win/i.test(device.id)) {
    return true;
  }

  if (targetHost === "localhost" || targetHost === "127.0.0.1" || targetHost === "::1") {
    return true;
  }

  if (currentHost === targetHost || currentHost.split(".")[0] === targetHost.split(".")[0]) {
    return true;
  }

  if (device.localHostnames && device.localHostnames.length > 0) {
    const match = device.localHostnames.some(
      (h) => h.toLowerCase() === currentHost || currentHost.includes(h.toLowerCase()) || h.toLowerCase() === targetHost
    );
    if (match) return true;
  }

  return false;
}

export function generateTemplateConfig(): RemoteMeshConfig {
  return {
    version: "1.0",
    toolNamingStyle: "compact",
    onDemandExposure: true,
    devices: {
      vps: {
        id: "vps",
        name: "Cloud VPS Server",
        host: "1.2.3.4",
        port: 22,
        username: "ubuntu",
        privateKeyPath: "~/.ssh/id_rsa",
        features: ["exec", "sftp", "status"],
        persistent: true,
        defaultCwd: "/home/ubuntu",
      },
      mac: {
        id: "mac",
        name: "Mac mini Workstation",
        host: "mac-mini.local",
        port: 22,
        username: "developer",
        privateKeyPath: "~/.ssh/id_ed25519",
        features: ["exec", "status"],
        persistent: false,
        localBypass: true,
        localHostnames: ["mac-mini", "mac-mini.local"],
      },
    },
  };
}
