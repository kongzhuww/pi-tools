import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { SshEngine } from "../src/ssh-engine.js";

test("aborting while an ephemeral connection is pending closes it when it arrives", async () => {
  const engine = new SshEngine({ dev: { id: "dev", host: "example", username: "user", persistent: false } });
  let finish!: (value: any) => void;
  let closed = 0;
  (engine as any).getClient = () => new Promise(resolve => { finish = resolve; });
  const controller = new AbortController();
  const result = engine.exec("dev", "true", undefined, controller.signal);
  controller.abort();
  await assert.rejects(result, /abort/i);
  finish({ end() { closed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1);
});

test("aborting while stat is pending rejects without starting the read", async () => {
  const engine = new SshEngine({});
  let callback!: (err: null, stats: { size: number }) => void;
  let started = false;
  const sftp = { stat(_p: string, cb: typeof callback) { callback = cb; }, createReadStream() { started = true; throw new Error("unexpected"); } };
  (engine as any).getSftp = async () => sftp;
  const controller = new AbortController();
  const result = engine.readFile("dev", "/test", 100, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(result, /aborted/i);
  callback(null, { size: 1 });
  assert.equal(started, false);
});

test("aborting a pending directory stat does not start mkdir", async () => {
  const engine = new SshEngine({});
  let callback!: (err: Error) => void;
  let mkdirCalls = 0;
  const sftp = { stat(_p: string, cb: typeof callback) { callback = cb; }, mkdir() { mkdirCalls++; } };
  const controller = new AbortController();
  const pending = engine.ensureRemoteDir(sftp as any, "/folder", controller.signal);
  controller.abort();
  callback(new Error("missing"));
  await assert.rejects(pending, /abort/i);
  assert.equal(mkdirCalls, 0);
});

test("nonpersistent SFTP owner is closed after read", async () => {
  const engine = new SshEngine({});
  let closed = 0;
  const sftp = {
    stat(_p: string, cb: Function) { cb(null, { size: 1 }); },
    createReadStream() { const stream = new EventEmitter(); setImmediate(() => { stream.emit("data", Buffer.from("x")); stream.emit("end"); }); return stream; },
    end() { closed++; },
  };
  (engine as any).ephemeralSftpClients.set(sftp, { end() { closed++; } });
  (engine as any).getSftp = async () => sftp;
  assert.deepEqual(await engine.readFile("dev", "/test"), { content: "x", bytes: 1 });
  assert.equal(closed, 2);
});

test("write uses exclusive private temporary file and cleans up rename failure", async () => {
  const engine = new SshEngine({});
  let opts: any, temp = "", unlinked = "";
  const stream = new EventEmitter() as any;
  stream.end = () => { setImmediate(() => { stream.emit("open"); stream.emit("close"); }); };
  stream.destroy = () => {};
  const sftp = {
    createWriteStream(p: string, options: unknown) { temp = p; opts = options; return stream; },
    rename(_from: string, _to: string, cb: Function) { cb(new Error("rename denied")); },
    unlink(p: string, cb: Function) { unlinked = p; cb(null); },
  };
  (engine as any).getSftp = async () => sftp;
  await assert.rejects(engine.writeFile("dev", "file", "data"), /rename denied/);
  assert.deepEqual(opts, { flags: "wx", mode: 0o600 });
  assert.match(temp, /^file\.pi-remote-mesh-[a-f0-9]{32}$/);
  assert.equal(unlinked, temp);
});
