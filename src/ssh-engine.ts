import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DeviceConfig, DeviceStatus } from "./types.js";
import { isLocalHost, resolveUserPath } from "./config.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  isTruncated?: boolean;
}

export class SshEngine {
  private clients = new Map<string, Client>();
  private sftpWrappers = new Map<string, SFTPWrapper>();
  private connecting = new Map<string, Promise<Client>>();

  constructor(private devices: Record<string, DeviceConfig>) {}

  public updateDevices(devices: Record<string, DeviceConfig>) {
    this.devices = devices;
  }

  public getDevice(id: string): DeviceConfig {
    const dev = this.devices[id];
    if (!dev) {
      throw new Error(`Device "${id}" is not configured in remote-mesh.`);
    }
    return dev;
  }

  public isConnected(id: string): boolean {
    const client = this.clients.get(id);
    return !!client;
  }

  private buildConnectConfig(device: DeviceConfig): ConnectConfig {
    const config: ConnectConfig = {
      host: device.host,
      port: device.port || 22,
      username: device.username,
      readyTimeout: device.connectTimeoutMs || 10000,
      keepaliveInterval: device.keepaliveIntervalMs || 10000,
      keepaliveCountMax: device.keepaliveCountMax || 3,
    };

    const privateKeyPath = device.privateKeyPath || device.auth?.privateKeyPath;
    if (privateKeyPath) {
      const resolvedKeyPath = resolveUserPath(privateKeyPath);
      if (fs.existsSync(resolvedKeyPath)) {
        config.privateKey = fs.readFileSync(resolvedKeyPath);
      } else {
        throw new Error(`Private key file not found at: ${resolvedKeyPath} for device "${device.id}"`);
      }
    }

    if (device.passphrase || device.auth?.passphrase) {
      config.passphrase = device.passphrase || device.auth?.passphrase;
    }

    if (device.password || device.auth?.password) {
      config.password = device.password || device.auth?.password;
    }

    if (device.auth?.agent || (!config.privateKey && !config.password)) {
      config.agent = device.auth?.agent || process.env.SSH_AUTH_SOCK;
    }

    return config;
  }

  public async getClient(id: string): Promise<Client> {
    const device = this.getDevice(id);

    if (isLocalHost(device)) {
      throw new Error(`Device "${id}" is marked as local machine. Use local bash/tools instead of SSH.`);
    }

    if (device.persistent && this.clients.has(id)) {
      return this.clients.get(id)!;
    }

    if (this.connecting.has(id)) {
      return this.connecting.get(id)!;
    }

    const connectPromise = new Promise<Client>((resolve, reject) => {
      const client = new Client();
      let connected = false;

      client
        .on("ready", () => {
          connected = true;
          if (device.persistent) {
            this.clients.set(id, client);
          }
          this.connecting.delete(id);
          resolve(client);
        })
        .on("error", (err) => {
          this.connecting.delete(id);
          this.clients.delete(id);
          this.sftpWrappers.delete(id);
          if (!connected) {
            reject(err);
          }
        })
        .on("close", () => {
          this.clients.delete(id);
          this.sftpWrappers.delete(id);
        })
        .on("end", () => {
          this.clients.delete(id);
          this.sftpWrappers.delete(id);
        });

      try {
        const connectConfig = this.buildConnectConfig(device);
        client.connect(connectConfig);
      } catch (err) {
        this.connecting.delete(id);
        reject(err);
      }
    });

    this.connecting.set(id, connectPromise);
    return connectPromise;
  }

  public async exec(id: string, command: string, customCwd?: string): Promise<ExecResult> {
    const device = this.getDevice(id);
    const client = await this.getClient(id);
    const startTime = Date.now();

    const cwd = customCwd || device.defaultCwd;
    let fullCommand = command;
    if (cwd && cwd !== "~") {
      fullCommand = `cd ${JSON.stringify(cwd)} && (${command})`;
    }

    return new Promise<ExecResult>((resolve, reject) => {
      client.exec(fullCommand, { env: device.env }, (err, stream) => {
        if (err) {
          if (!device.persistent) client.end();
          return reject(err);
        }

        let stdoutBuf = "";
        let stderrBuf = "";
        let isTruncated = false;
        const maxBytes = device.maxOutputBytes || 32768;

        stream
          .on("close", (code: number) => {
            if (!device.persistent) {
              client.end();
            }

            // Cap output lines if configured
            const maxLines = device.maxOutputLines || 300;
            const lines = stdoutBuf.split("\n");
            let finalStdout = stdoutBuf;
            if (lines.length > maxLines) {
              finalStdout = lines.slice(-maxLines).join("\n");
              isTruncated = true;
            }

            resolve({
              stdout: finalStdout,
              stderr: stderrBuf,
              exitCode: typeof code === "number" ? code : 0,
              durationMs: Date.now() - startTime,
              isTruncated,
            });
          })
          .on("data", (data: Buffer) => {
            if (stdoutBuf.length < maxBytes) {
              stdoutBuf += data.toString("utf-8");
              if (stdoutBuf.length >= maxBytes) {
                stdoutBuf = stdoutBuf.slice(0, maxBytes) + "\n... [output truncated by pi-remote-mesh]";
                isTruncated = true;
              }
            }
          })
          .stderr.on("data", (data: Buffer) => {
            if (stderrBuf.length < maxBytes) {
              stderrBuf += data.toString("utf-8");
            }
          });
      });
    });
  }

  public async getSftp(id: string): Promise<SFTPWrapper> {
    const device = this.getDevice(id);
    if (device.persistent && this.sftpWrappers.has(id)) {
      return this.sftpWrappers.get(id)!;
    }

    const client = await this.getClient(id);
    return new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        if (device.persistent) {
          this.sftpWrappers.set(id, sftp);
        }
        resolve(sftp);
      });
    });
  }

  public async readFile(id: string, remotePath: string, maxBytes = 64 * 1024): Promise<{ content: string; bytes: number }> {
    const sftp = await this.getSftp(id);
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(new Error(`Remote file not found: ${remotePath} (${err.message})`));

        if (stats.size > maxBytes) {
          return reject(new Error(`Remote file is too large (${stats.size} bytes > limit ${maxBytes} bytes)`));
        }

        const stream = sftp.createReadStream(remotePath, { encoding: "utf-8" });
        let content = "";
        stream.on("data", (chunk: string) => {
          content += chunk;
        });
        stream.on("end", () => {
          resolve({ content, bytes: Buffer.byteLength(content) });
        });
        stream.on("error", (streamErr: Error) => {
          reject(streamErr);
        });
      });
    });
  }

  public async writeFile(id: string, remotePath: string, content: string): Promise<{ bytes: number }> {
    const sftp = await this.getSftp(id);
    const buffer = Buffer.from(content, "utf-8");

    return new Promise((resolve, reject) => {
      // Ensure directory exists or write directly
      const writeStream = sftp.createWriteStream(remotePath, { flags: "w", mode: 0o644 });
      writeStream.on("close", () => {
        resolve({ bytes: buffer.length });
      });
      writeStream.on("error", (err: Error) => {
        reject(err);
      });
      writeStream.end(buffer);
    });
  }

  public async disconnect(id: string): Promise<boolean> {
    const client = this.clients.get(id);
    if (!client) return false;

    return new Promise((resolve) => {
      this.sftpWrappers.delete(id);
      this.clients.delete(id);
      client.once("close", () => resolve(true));
      client.end();
      // Safeguard timeout
      setTimeout(() => resolve(true), 1500);
    });
  }

  public async disconnectAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const id of this.clients.keys()) {
      results[id] = await this.disconnect(id);
    }
    return results;
  }

  public getStatus(id: string, activeTools: string[] = [], availableTools: string[] = []): DeviceStatus {
    const dev = this.getDevice(id);
    const isLocal = isLocalHost(dev);
    const isConnected = this.isConnected(id);

    return {
      id: dev.id,
      name: dev.name || dev.id,
      host: dev.host,
      port: dev.port || 22,
      username: dev.username,
      isLocal,
      isConnected,
      persistent: dev.persistent ?? true,
      features: dev.features || ["exec", "sftp", "status"],
      activeTools,
      availableTools,
    };
  }
}
