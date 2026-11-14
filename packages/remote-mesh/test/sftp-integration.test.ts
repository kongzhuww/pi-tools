import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import ssh2 from "ssh2";
import { SshEngine } from "../src/ssh-engine.js";

const { Server, utils } = ssh2;

test("one-shot SFTP writes and reads through an in-memory loopback SSH server", { timeout: 10000 }, async t => {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs1" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const parsed = utils.parseKey(key.privateKey);
  assert.ok(!Array.isArray(parsed) && !(parsed instanceof Error));
  const fingerprint = createHash("sha256").update(parsed.getPublicSSH()).digest("hex");
  const files = new Map<string, Buffer>();
  const server = new Server({ hostKeys: [key.privateKey] });
  t.after(() => server.close());
  let opens = 0, tempFlags = 0, tempMode = 0;
  server.on("connection", client => {
    client.on("error", () => {});
    client.on("authentication", ctx => ctx.accept());
    client.on("ready", () => client.on("session", accept => {
      const session = accept();
      session.on("sftp", acceptSftp => {
        const sftp = acceptSftp();
        const handles = new Map<string, string>();
        let next = 0;
        sftp.on("STAT", (id, name) => {
          const data = files.get(name);
          if (!data) return sftp.status(id, 2);
          sftp.attrs(id, { mode: 0o100600, size: data.length });
        });
        sftp.on("OPEN", (id, name, flags, attrs) => {
          opens++;
          if ((flags & 2) !== 0) {
            tempFlags = flags; tempMode = attrs.mode ?? 0;
            if (files.has(name)) return sftp.status(id, 4);
            files.set(name, Buffer.alloc(0));
          } else if (!files.has(name)) return sftp.status(id, 2);
          const handle = Buffer.from(String(++next)); handles.set(handle.toString(), name); sftp.handle(id, handle);
        });
        sftp.on("WRITE", (id, handle, offset, data) => {
          const name = handles.get(handle.toString())!; const previous = files.get(name)!;
          const nextData = Buffer.alloc(Math.max(previous.length, offset + data.length)); previous.copy(nextData); data.copy(nextData, offset); files.set(name, nextData); sftp.status(id, 0);
        });
        sftp.on("READ", (id, handle, offset, length) => {
          const data = files.get(handles.get(handle.toString())!)!;
          if (offset >= data.length) return sftp.status(id, 1);
          sftp.data(id, data.subarray(offset, offset + length));
        });
        sftp.on("CLOSE", (id, handle) => { handles.delete(handle.toString()); sftp.status(id, 0); });
        sftp.on("RENAME", (id, oldPath, newPath) => {
          const data = files.get(oldPath); if (!data) return sftp.status(id, 2);
          files.set(newPath, data); files.delete(oldPath); sftp.status(id, 0);
        });
      });
    }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const engine = new SshEngine({ test: { id: "test", host: "127.0.0.1", port: address.port, username: "test", password: "test-only", persistent: false, hostFingerprint: fingerprint } });
  assert.deepEqual(await engine.writeFile("test", "result.txt", "hello 世界"), { bytes: Buffer.byteLength("hello 世界") });
  assert.deepEqual(await engine.readFile("test", "result.txt"), { content: "hello 世界", bytes: Buffer.byteLength("hello 世界") });
  assert.equal(opens, 2);
  assert.ok((tempFlags & 32) !== 0, "exclusive-create flag");
  assert.equal(tempMode & 0o777, 0o600);
  assert.deepEqual([...files.keys()], ["result.txt"]);
});
