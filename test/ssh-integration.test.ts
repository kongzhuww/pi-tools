import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import ssh2 from "ssh2";
const { Server, utils } = ssh2;
import { SshEngine } from "../src/ssh-engine.js";

test("real loopback SSH server verifies host key and closes one-shot command", async t => {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs1" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const parsed = utils.parseKey(key.privateKey);
  assert.ok(!Array.isArray(parsed) && !(parsed instanceof Error));
  const fingerprint = createHash("sha256").update(parsed.getPublicSSH()).digest("hex");
  const server = new Server({ hostKeys: [key.privateKey] });
  t.after(() => server.close());
  let received = "";
  server.on("connection", client => {
    client.on("error", () => {}); // Client rejecting a host key aborts key exchange on the server.
    client.on("authentication", ctx => ctx.accept());
    client.on("ready", () => client.on("session", accept => {
      const session = accept();
      session.on("exec", (acceptExec, _reject, info) => {
        received = info.command;
        const stream = acceptExec();
        stream.write("loopback-ok\n");
        stream.exit(0);
        stream.end();
      });
    }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const engine = new SshEngine({ test: { id: "test", host: "127.0.0.1", port: address.port, username: "test", password: "test-only", persistent: false, hostFingerprint: fingerprint } });
  const result = await engine.exec("test", "printf ok", "/tmp/$(echo unsafe)");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "loopback-ok\n");
  assert.equal(received, "cd -- '/tmp/$(echo unsafe)' && (printf ok)");
  const bad = new SshEngine({ test: { id: "test", host: "127.0.0.1", port: address.port, username: "test", password: "test-only", persistent: false, hostFingerprint: "00".repeat(32) } });
  await assert.rejects(bad.exec("test", "true"), /verification|denied/i);
});

test("disconnect cancels a persistent connection still authenticating", { timeout: 5000 }, async t => {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs1" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const parsed = utils.parseKey(key.privateKey);
  assert.ok(!Array.isArray(parsed) && !(parsed instanceof Error));
  const fingerprint = createHash("sha256").update(parsed.getPublicSSH()).digest("hex");
  const server = new Server({ hostKeys: [key.privateKey] });
  t.after(() => server.close());
  let signalAuth!: () => void;
  const authStarted = new Promise<void>(resolve => { signalAuth = resolve; });
  server.on("connection", client => {
    client.on("error", () => {});
    client.on("authentication", () => { signalAuth(); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const engine = new SshEngine({ test: { id: "test", host: "127.0.0.1", port: address.port, username: "test", password: "test-only", persistent: true, hostFingerprint: fingerprint } });
  const pending = engine.getClient("test");
  const rejected = assert.rejects(pending, /closed|cancelled|disconnect/i);
  await authStarted;
  assert.equal(await engine.disconnect("test"), true);
  await rejected;
  assert.equal(engine.isConnected("test"), false);
});
