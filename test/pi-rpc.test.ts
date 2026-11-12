import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const pi = process.env.PI_REMOTE_MESH_PI_BINARY;

test("real Pi RPC approves a device once per session and revokes on disconnect", { skip: !pi && "Set PI_REMOTE_MESH_PI_BINARY to run the real Pi integration test", timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-pi-rpc-"));
  const agent = path.join(root, "agent");
  fs.mkdirSync(agent);
  const config = path.join(root, "remote-mesh.json");
  fs.writeFileSync(config, JSON.stringify({ devices: { vps: { host: "example.invalid", username: "test", hostFingerprint: "00".repeat(32), features: ["exec"] } } }));
  const entry = process.env.PI_REMOTE_MESH_ENTRY ?? fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const child = spawn(pi!, ["--mode", "rpc", "--no-session", "--no-extensions", "--no-mcp", "-e", entry], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: agent, PI_REMOTE_MESH_CONFIG: config },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  let stderr = "";
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let confirms = 0;
  let allow = true;
  const notifications: string[] = [];
  const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + "\n");
  readline.createInterface({ input: child.stdout }).on("line", line => {
    let msg: any; try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === "extension_ui_request" && msg.method === "confirm") {
      confirms++;
      send({ type: "extension_ui_response", id: msg.id, confirmed: allow });
    }
    if (msg.type === "extension_ui_request" && msg.method === "notify") notifications.push(msg.message);
    if (msg.type === "response" && pending.has(msg.id)) {
      const wait = pending.get(msg.id)!; pending.delete(msg.id); wait.resolve(msg);
    }
  });
  child.on("exit", code => { for (const p of pending.values()) p.reject(new Error(`Pi exited ${code}: ${stderr}`)); pending.clear(); });
  let seq = 0;
  const request = (type: string, fields: object = {}) => new Promise<any>((resolve, reject) => {
    const id = String(++seq); pending.set(id, { resolve, reject }); send({ id, type, ...fields });
  });
  const command = async (message: string) => {
    const result = await request("prompt", { message });
    assert.equal(result.success, true, JSON.stringify(result));
  };
  const commands = await request("get_commands");
  assert.ok(commands.data.commands.some((c: any) => c.name === "remote-mesh"));
  await command("/remote-mesh enable vps"); assert.equal(confirms, 1);
  await command("/remote-mesh disable vps");
  await command("/remote-mesh enable vps"); assert.equal(confirms, 1);
  await command("/remote-mesh disconnect vps");
  await command("/remote-mesh enable vps"); assert.equal(confirms, 2);
  const next = await request("new_session"); assert.equal(next.success, true);
  await command("/remote-mesh enable vps"); assert.equal(confirms, 3);
  await command("/remote-mesh disconnect vps");
  allow = false;
  await command("/remote-mesh enable vps"); assert.equal(confirms, 4);
  assert.ok(notifications.some(message => message.includes("authorization declined")));
});
