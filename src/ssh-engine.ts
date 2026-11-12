import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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

export function quotePosixShell(value: string): string {
  if (value.includes("\0")) throw new Error("NUL is not allowed in a remote working directory");
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function awaitAbortable<T>(promise: Promise<T>, signal?: AbortSignal, onLate?: (value: T) => void): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const onAbort = () => { if (!finished) { finished = true; reject(signal.reason ?? new Error("Aborted")); } };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(value => {
      signal.removeEventListener("abort", onAbort);
      if (finished) { onLate?.(value); return; }
      finished = true;
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", onAbort);
      if (!finished) { finished = true; reject(error); }
    });
  });
}

export class SshEngine {
  private clients = new Map<string, Client>();
  private sftpWrappers = new Map<string, SFTPWrapper>();
  private connecting = new Map<string, Promise<Client>>();
  private pendingClients = new Map<string, Client>();
  private ephemeralSftpClients = new WeakMap<SFTPWrapper, Client>();
  private generations = new Map<string, number>();

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

    let pinned: Buffer;
    if (device.hostKeySha256) {
      const expected = device.hostKeySha256.replace(/^SHA256:/, "").replace(/=+$/, "");
      if (!/^[A-Za-z0-9+/]{43}$/.test(expected)) {
        throw new Error(`Invalid SHA256 host key fingerprint for device "${device.id}"`);
      }
      pinned = Buffer.from(expected, "base64");
    } else if (device.hostFingerprint) {
      const expected = device.hostFingerprint.replace(/:/g, "");
      if (!/^[a-fA-F0-9]{64}$/.test(expected)) {
        throw new Error(`Invalid SHA256 host key fingerprint for device "${device.id}"`);
      }
      pinned = Buffer.from(expected, "hex");
    } else {
      throw new Error(`Missing hostKeySha256 or hostFingerprint for device "${device.id}". Verify the host fingerprint independently before connecting.`);
    }
    config.hostVerifier = (key: Buffer) => {
      const actual = createHash("sha256").update(key).digest();
      return pinned.length === actual.length && timingSafeEqual(actual, pinned);
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

    if (device.persistent && this.connecting.has(id)) {
      return this.connecting.get(id)!;
    }

    const generation = this.generations.get(id) ?? 0;
    let connectPromise!: Promise<Client>;
    connectPromise = new Promise<Client>((resolve, reject) => {
      const client = new Client();
      if (device.persistent) this.pendingClients.set(id, client);
      let connected = false;

      client
        .on("ready", () => {
          if (this.pendingClients.get(id) === client) this.pendingClients.delete(id);
          if ((this.generations.get(id) ?? 0) !== generation) {
            client.end();
            reject(new Error(`Connection to "${id}" was cancelled by disconnect.`));
            return;
          }
          connected = true;
          if (device.persistent) {
            this.clients.set(id, client);
            if (this.connecting.get(id) === connectPromise) this.connecting.delete(id);
          }
          resolve(client);
        })
        .on("error", (err) => {
          if (device.persistent) {
            if (this.pendingClients.get(id) === client) this.pendingClients.delete(id);
            if (this.connecting.get(id) === connectPromise) this.connecting.delete(id);
            if (this.clients.get(id) === client) {
              this.clients.delete(id);
              this.sftpWrappers.delete(id);
            }
          }
          if (!connected) {
            reject(err);
          }
        })
        .on("close", () => {
          if (this.pendingClients.get(id) === client) this.pendingClients.delete(id);
          if (!connected) reject(new Error(`SSH connection closed before ready for "${id}".`));
          if (this.clients.get(id) === client) {
            this.clients.delete(id);
            this.sftpWrappers.delete(id);
          }
        })
        .on("end", () => {
          if (this.clients.get(id) === client) {
            this.clients.delete(id);
            this.sftpWrappers.delete(id);
          }
        });

      try {
        const connectConfig = this.buildConnectConfig(device);
        client.connect(connectConfig);
      } catch (err) {
        if (this.pendingClients.get(id) === client) this.pendingClients.delete(id);
        reject(err);
      }
    });

    if (device.persistent) {
      this.connecting.set(id, connectPromise);
      void connectPromise.catch(() => {
        if (this.connecting.get(id) === connectPromise) this.connecting.delete(id);
      });
    }
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
    const client = await awaitAbortable(this.getClient(id), signal, late => { if (!device.persistent) late.end(); });
    const startTime = Date.now();

    const cwd = customCwd || device.defaultCwd;
    let fullCommand = command;
    if (cwd && cwd !== "~") {
      // POSIX single quotes prevent interpolation, command substitution and splitting.
      // For non-POSIX remote shells leave cwd unset and use their native syntax explicitly.
      const quotedCwd = quotePosixShell(cwd);
      fullCommand = `cd -- ${quotedCwd} && (${command})`;
    }

    if (signal?.aborted) {
      if (!device.persistent) client.end();
      signal.throwIfAborted();
    }

    return new Promise<ExecResult>((resolve, reject) => {
      let pendingAborted = false;
      const onPendingAbort = () => {
        pendingAborted = true;
        signal?.removeEventListener("abort", onPendingAbort);
        if (!device.persistent) client.end();
        reject(new Error("Command request aborted; remote execution may have started."));
      };
      signal?.addEventListener("abort", onPendingAbort, { once: true });
      if (signal?.aborted) { onPendingAbort(); return; }
      client.exec(fullCommand, { env: device.env }, (err, stream) => {
        signal?.removeEventListener("abort", onPendingAbort);
        if (pendingAborted) {
          if (stream) {
            try { stream.signal("INT"); stream.close(); } catch { /* best effort */ }
          }
          return;
        }
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

          reject(new Error(`Command aborted on remote device "${id}"; interruption requested, remote processes may continue.`));
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
        if (err) {
          if (!device.persistent) client.end();
          return reject(err);
        }
        if (device.persistent) {
          this.sftpWrappers.set(id, sftp);
        } else {
          this.ephemeralSftpClients.set(sftp, client);
        }
        resolve(sftp);
      });
    });
  }

  private releaseSftp(sftp: SFTPWrapper): void {
    const client = this.ephemeralSftpClients.get(sftp);
    if (!client) return;
    this.ephemeralSftpClients.delete(sftp);
    try { sftp.end(); } finally { client.end(); }
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
    const sftp = await awaitAbortable(this.getSftp(id), signal, late => this.releaseSftp(late));
    try {
      signal?.throwIfAborted();
      return await new Promise((resolve, reject) => {
        let settled = false;
        let stream: ReturnType<SFTPWrapper["createReadStream"]> | undefined;
        const finish = (error?: Error, result?: { content: string; bytes: number }) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          if (error) reject(error); else resolve(result!);
        };
        const onAbort = () => {
          stream?.destroy();
          finish(new Error("Read aborted by user"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) { onAbort(); return; }
        sftp.stat(remotePath, (err, stats) => {
          if (settled) return;
          if (err) return finish(new Error(`Remote file stat failed: ${remotePath} (${err.message})`));
          if (stats.size > maxBytes) return finish(new Error(`Remote file is too large (${stats.size} bytes > limit ${maxBytes} bytes)`));
          stream = sftp.createReadStream(remotePath);
          const chunks: Buffer[] = [];
          let bytes = 0;
          stream.on("data", (chunk: Buffer) => {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > maxBytes) {
              stream?.destroy();
              return finish(new Error(`Remote file exceeded the ${maxBytes}-byte limit while reading`));
            }
            chunks.push(chunk);
          });
          stream.on("end", () => finish(undefined, { content: Buffer.concat(chunks).toString("utf8"), bytes }));
          stream.on("error", (error: Error) => finish(error));
        });
      });
    } finally {
      this.releaseSftp(sftp);
    }
  }

  public async ensureRemoteDir(sftp: SFTPWrapper, remoteDir: string, signal?: AbortSignal): Promise<void> {
    const normalized = remoteDir.replace(/\\/g, "/");
    const isAbsolute = normalized.startsWith("/");
    const parts = normalized.split("/").filter(Boolean);

    let current = isAbsolute ? "" : ".";
    for (const part of parts) {
      signal?.throwIfAborted();
      current = isAbsolute ? `${current}/${part}` : `${current}/${part}`;

      await new Promise<void>((resolve, reject) => {
        sftp.stat(current, (err, stats) => {
          if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
          if (!err && stats?.isDirectory()) {
            return resolve();
          }
            sftp.mkdir(current, (mkdirErr) => {
              if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
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
    const sftp = await awaitAbortable(this.getSftp(id), signal, late => this.releaseSftp(late));
    try {
      const buffer = Buffer.from(content, "utf-8");
      const normalizedPath = remotePath.replace(/\\/g, "/");
      const parentDir = path.posix.dirname(normalizedPath);
      if (parentDir && parentDir !== "." && parentDir !== "/") {
        await awaitAbortable(this.ensureRemoteDir(sftp, parentDir, signal), signal);
      }
      signal?.throwIfAborted();
      return await new Promise((resolve, reject) => {
        const tempPath = `${remotePath}.pi-remote-mesh-${randomBytes(16).toString("hex")}`;
        const writeStream = sftp.createWriteStream(tempPath, { flags: "wx", mode: 0o600 });
        let settled = false;
        let opened = false;
        let committing = false;
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (opened) sftp.unlink(tempPath, () => reject(err));
          else reject(err);
        };
        const onAbort = () => {
          if (settled || committing) return;
          writeStream.destroy();
          fail(new Error("Write aborted by user; temporary-file cleanup is best effort"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        writeStream.on("open", () => { opened = true; if (settled) sftp.unlink(tempPath, () => undefined); });
        writeStream.on("close", () => {
          if (settled) return;
          if (signal?.aborted) return onAbort();
          // The server may commit after the request is sent: report the rename result,
          // rather than falsely claiming cancellation after the commit point.
          committing = true;
          cleanup();
          sftp.rename(tempPath, remotePath, (err) => {
            if (err) return fail(err);
            settled = true;
            resolve({ bytes: buffer.length });
          });
        });
        writeStream.on("error", (err: Error) => fail(err));
        if (signal?.aborted) onAbort(); else writeStream.end(buffer);
      });
    } finally {
      this.releaseSftp(sftp);
    }
  }

  public async disconnect(id: string): Promise<boolean> {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.connecting.delete(id);
    const client = this.clients.get(id) ?? this.pendingClients.get(id);
    this.pendingClients.delete(id);
    if (!client) return false;

    return new Promise((resolve, reject) => {
      this.sftpWrappers.delete(id);
      this.clients.delete(id);
      const timer = setTimeout(() => reject(new Error(`SSH disconnect timed out for "${id}"; closure is unconfirmed.`)), 1500);
      client.once("close", () => { clearTimeout(timer); resolve(true); });
      client.end();
    });
  }

  public async disconnectAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const id of new Set([...this.clients.keys(), ...this.connecting.keys()])) {
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
