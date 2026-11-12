import test from "node:test";
import assert from "node:assert/strict";
import { SshEngine } from "../src/ssh-engine.js";

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
