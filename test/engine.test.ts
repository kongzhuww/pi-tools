import test from "node:test";
import assert from "node:assert/strict";
import { SshEngine, quotePosixShell } from "../src/ssh-engine.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

test("POSIX directory quoting prevents interpolation and preserves literal content", () => {
  const value = `literal ' \" $(printf injected) \`printf injected\` $HOME`;
  const result = spawnSync("sh", ["-c", `printf %s ${quotePosixShell(value)}`], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, value);
  assert.throws(() => quotePosixShell("a\0b"), /NUL/);
});

test("pinned host key accepts the expected key and rejects a different key", () => {
  const key = Buffer.from("example host key");
  const fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
  const device = { id: "win", host: "example", username: "user", hostKeySha256: fingerprint };
  const engine = new SshEngine({ win: device });
  const config = (engine as any).buildConnectConfig(device);
  assert.equal(config.hostVerifier(key), true);
  assert.equal(config.hostVerifier(Buffer.from("different key")), false);
  const hex = createHash("sha256").update(key).digest("hex");
  const hexConfig = (engine as any).buildConnectConfig({ ...device, hostKeySha256: undefined, hostFingerprint: hex });
  assert.equal(hexConfig.hostVerifier(key), true);
  assert.equal(hexConfig.hostVerifier(Buffer.from("different key")), false);
  assert.throws(() => (engine as any).buildConnectConfig({ ...device, hostKeySha256: "bad" }), /Invalid SHA256/);
  assert.throws(() => (engine as any).buildConnectConfig({ ...device, hostKeySha256: undefined }), /Missing hostKeySha256/);
});

test("ensureRemoteDir parses nested directories and invokes mkdir sequentially", async () => {
  const engine = new SshEngine({});

  const calls: string[] = [];
  const fakeSftp = {
    stat: (path: string, cb: Function) => {
      // Simulate that directory doesn't exist yet
      cb(new Error("File not found"));
    },
    mkdir: (path: string, cb: Function) => {
      calls.push(path);
      cb(null);
    },
  };

  await engine.ensureRemoteDir(fakeSftp as any, "/home/ubuntu/app/configs");

  assert.deepEqual(calls, [
    "/home",
    "/home/ubuntu",
    "/home/ubuntu/app",
    "/home/ubuntu/app/configs",
  ]);
});

test("exec throws immediately if AbortSignal is already aborted", async () => {
  const engine = new SshEngine({
    vps: {
      id: "vps",
      host: "10.0.0.1",
      username: "user",
    },
  });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    async () => {
      await engine.exec("vps", "echo 1", undefined, controller.signal);
    },
    (err: any) => {
      return err.name === "AbortError" || err.message.includes("aborted");
    }
  );
});
