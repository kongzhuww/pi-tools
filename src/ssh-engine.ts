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
  exitSignal?: string;
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

    if (device.hostFingerprint) {
      config.hostHash = "sha256";
      config.hostVerifier = (fingerprint: string) =>
        fingerprint.toLowerCase() === device.hostFingerprint!.toLowerCase().replace(/:/g, "");
    }

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

  public async exec(
    id: string,
    command: string,
    customCwd?: string,
    signal?: AbortSignal
  ): Promise<ExecResult> {
    signal?.throwIfAborted();
    const device = this.getDevice(id);
    const client = await this.getClient(id);
    const startTime = Date.now();

    const cwd = customCwd || device.defaultCwd;
    let fullCommand = command;
    if (cwd && cwd !== "~") {
      fullCommand = `cd ${JSON.stringify(cwd)} && (${command})`;
    }

    signal?.throwIfAborted();

    return new Promise<ExecResult>((resolve, reject) => {
      client.exec(fullCommand, { env: device.env }, (err, stream) => {
        if (err) {
          if (!device.persistent) client.end();
          return reject(err);
        }

        let stdoutBuf = "";
        let stderrBuf = "";
        let isTruncated = false;
        let isAborted = false;
        const maxBytes = device.maxOutputBytes || 32768;

        const onAbort = () => {
          isAborted = true;
          try {
            // Send POSIX SIGINT to remote command
            stream.signal("INT");
          } catch {
            // ignore
          }
          try {
            // Send Ctrl+C character fallback
            stream.write("\x03");
          } catch {
            // ignore
          }
          setTimeout(() => {
            try {
              stream.close();
              stream.destroy();
            } catch {
              // ignore
            }
          }, 150);

          if (!device.persistent) {
            client.end();
          }

          reject(new Error(`Command aborted on remote device "${id}" (SIGINT sent).`));
        };

        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }

        stream
          .on("close", (code: number | null, exitSignal?: string) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            if (isAborted) return;

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
              exitCode: typeof code === "number" ? code : -1,
              durationMs: Date.now() - startTime,
              isTruncated,
              exitSignal,
            });
          })
          .on("data", (data: Buffer) => {
            if (Buffer.byteLength(stdoutBuf, "utf-8") < maxBytes) {
              const remaining = maxBytes - Buffer.byteLength(stdoutBuf, "utf-8");
              stdoutBuf += data.subarray(0, remaining).toString("utf-8");
              if (data.length > remaining) {
                stdoutBuf += "\n... [output truncated by pi-remote-mesh]";
                isTruncated = true;
              }
            }
          })
          .stderr.on("data", (data: Buffer) => {
            if (Buffer.byteLength(stderrBuf, "utf-8") < maxBytes) {
              const remaining = maxBytes - Buffer.byteLength(stderrBuf, "utf-8");
              stderrBuf += data.subarray(0, remaining).toString("utf-8");
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

  public async readFile(
    id: string,
    remotePath: string,
    maxBytes = 64 * 1024,
    signal?: AbortSignal
  ): Promise<{ content: string; bytes: number }> {
    signal?.throwIfAborted();
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new Error("maxBytes must be a positive finite number");
    }
    const sftp = await this.getSftp(id);
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(new Error(`Remote file not found: ${remotePath} (${err.message})`));

        if (stats.size > maxBytes) {
          return reject(new Error(`Remote file is too large (${stats.size} bytes > limit ${maxBytes} bytes)`));
        }

        const stream = sftp.createReadStream(remotePath);
        const onAbort = () => {
          try {
            stream.destroy();
          } catch {
            // ignore
          }
          reject(new Error("Read aborted by user"));
        };

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        let content = "";
        let bytes = 0;
        let overLimit = false;
        stream.on("data", (chunk: Buffer) => {
          if (overLimit) return;
          const remaining = maxBytes - bytes;
          const accepted = chunk.subarray(0, remaining);
          content += accepted.toString("utf-8");
          bytes += accepted.length;
          if (accepted.length < chunk.length) {
            overLimit = true;
            stream.destroy();
            reject(new Error(`Remote file exceeded the ${maxBytes}-byte limit while reading`));
          }
        });
        stream.on("end", () => {
          if (overLimit) return;
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve({ content, bytes });
        });
        stream.on("error", (streamErr: Error) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(streamErr);
        });
      });
    });
  }

  public async ensureRemoteDir(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
    const normalized = remoteDir.replace(/\\/g, "/");
    const isAbsolute = normalized.startsWith("/");
    const parts = normalized.split("/").filter(Boolean);

    let current = isAbsolute ? "" : ".";
    for (const part of parts) {
      current = isAbsolute ? `${current}/${part}` : `${current}/${part}`;

      await new Promise<void>((resolve, reject) => {
        sftp.stat(current, (err, stats) => {
          if (!err && stats?.isDirectory()) {
            return resolve();
          }
            sftp.mkdir(current, (mkdirErr) => {
              if (!mkdirErr) return resolve();
              sftp.stat(current, (retryErr, retryStats) => {
                if (!retryErr && retryStats?.isDirectory()) return resolve();
                reject(mkdirErr);
              });
            });
        });
      });
    }
  }

  public async writeFile(
    id: string,
    remotePath: string,
    content: string,
    signal?: AbortSignal
  ): Promise<{ bytes: number }> {
    signal?.throwIfAborted();
    const sftp = await this.getSftp(id);
    const buffer = Buffer.from(content, "utf-8");

    const normalizedPath = remotePath.replace(/\\/g, "/");
    const parentDir = path.posix.dirname(normalizedPath);
    if (parentDir && parentDir !== "." && parentDir !== "/") {
      await this.ensureRemoteDir(sftp, parentDir);
    }

    signal?.throwIfAborted();

    return new Promise((resolve, reject) => {
      const tempPath = `${remotePath}.pi-remote-mesh-${process.pid}-${Date.now()}`;
      const writeStream = sftp.createWriteStream(tempPath, { flags: "w", mode: 0o644 });
      let settled = false;

      const cleanup = () => {
        if (signal) signal.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        try {
          writeStream.destroy();
        } catch {
          // ignore
        }
        if (!settled) {
          settled = true;
          cleanup();
          sftp.unlink(tempPath, () => undefined);
          reject(new Error("Write aborted by user"));
        }
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      writeStream.on("close", () => {
        if (settled) return;
        sftp.rename(tempPath, remotePath, (err) => {
          settled = true;
          cleanup();
          if (err) return reject(err);
          resolve({ bytes: buffer.length });
        });
      });
      writeStream.on("error", (err: Error) => {
        settled = true;
        cleanup();
        sftp.unlink(tempPath, () => undefined);
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
