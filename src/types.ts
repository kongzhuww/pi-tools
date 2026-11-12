export type DeviceFeature = "exec" | "sftp" | "status";

export type AuthType = "key" | "agent" | "password";

export interface SshAuthConfig {
  type?: AuthType;
  privateKeyPath?: string;
  passphrase?: string;
  password?: string;
  agent?: string;
}

export interface DeviceConfig {
  id: string;
  name?: string;
  host: string;
  port?: number;
  username: string;
  auth?: SshAuthConfig;
  /** SHA-256 host-key fingerprint in hexadecimal form, as accepted by ssh2. */
  hostFingerprint?: string;
  // Fallback direct properties for easy configuration
  privateKeyPath?: string;
  passphrase?: string;
  password?: string;
  persistent?: boolean;
  features?: DeviceFeature[];
  defaultCwd?: string;
  connectTimeoutMs?: number;
  keepaliveIntervalMs?: number;
  keepaliveCountMax?: number;
  maxOutputBytes?: number;
  maxOutputLines?: number;
  env?: Record<string, string>;
  // Automatically bypass or skip SSH if running locally on this machine
  localBypass?: boolean;
  localHostnames?: string[];
  // Custom tool prefix (default is either compact "{id}_" or prefixed "remote_{id}_")
  toolPrefix?: string;
}

export interface RemoteMeshConfig {
  version?: string;
  toolNamingStyle?: "compact" | "prefixed"; // "compact": vps_exec; "prefixed": remote_vps_exec
  onDemandExposure?: boolean; // Default true: tool definitions hidden until enabled
  devices: Record<string, DeviceConfig>;
}

export interface DeviceStatus {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  isLocal: boolean;
  isConnected: boolean;
  persistent: boolean;
  features: DeviceFeature[];
  activeTools: string[];
  availableTools: string[];
  lastError?: string;
}
