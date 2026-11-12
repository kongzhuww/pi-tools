import test from "node:test";
import assert from "node:assert/strict";
import { registerMeshTools } from "../src/tool-registry.js";
import { SshEngine } from "../src/ssh-engine.js";
import type { RemoteMeshConfig } from "../src/types.js";

function createMockPi() {
  const registeredTools: any[] = [];
  let activeTools: string[] = ["bash", "read", "edit"];
  const listeners: Record<string, Function[]> = {};

  return {
    registeredTools,
    getActiveTools: () => [...activeTools],
    setActiveTools: (tools: string[]) => {
      activeTools = [...tools];
    },
    registerTool: (tool: any) => {
      registeredTools.push(tool);
    },
    on: (event: string, callback: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(callback);
    },
    emit: (event: string, ...args: any[]) => {
      for (const cb of listeners[event] || []) {
        cb(...args);
      }
    },
  };
}

test("registerMeshTools registers tools and controls visibility on-demand", async () => {
  const mockPi = createMockPi();
  const config: RemoteMeshConfig = {
    version: "1.0",
    toolNamingStyle: "compact",
    onDemandExposure: true,
    devices: {
      vps: {
        id: "vps",
        host: "10.0.0.1",
        username: "ubuntu",
        features: ["exec", "sftp"],
      },
      phone: {
        id: "phone",
        host: "10.0.0.2",
        username: "u0_a1",
        features: ["exec"],
      },
    },
  };

  const engine = new SshEngine(config.devices);
  const { handleControl, allMeshToolNames } = registerMeshTools(mockPi as any, config, engine);

  // Tools should be registered in Pi
  const toolNames = mockPi.registeredTools.map((t) => t.name);
  assert.ok(toolNames.includes("vps_exec"));
  assert.ok(toolNames.includes("vps_read"));
  assert.ok(toolNames.includes("vps_write"));
  assert.ok(toolNames.includes("phone_exec"));
  assert.ok(toolNames.includes("remote_enable"));

  // Initial session_start should hide mesh tools from active tools
  mockPi.emit("session_start");
  for (const name of allMeshToolNames) {
    assert.equal(mockPi.getActiveTools().includes(name), false);
  }

  // Enable VPS tools dynamically
  let confirmations = 0;
  const ctx = { hasUI: true, ui: { confirm: async () => { confirmations++; return true; } } } as any;
  await handleControl("vps", "enable", ctx);
  await handleControl("vps", "enable", ctx);
  assert.equal(confirmations, 1);
  assert.ok(mockPi.getActiveTools().includes("vps_exec"));
  assert.ok(mockPi.getActiveTools().includes("vps_read"));
  assert.ok(mockPi.getActiveTools().includes("vps_write"));
  // Phone tools should still be hidden
  assert.equal(mockPi.getActiveTools().includes("phone_exec"), false);

  // Disable VPS tools
  await handleControl("vps", "disable");
  assert.equal(mockPi.getActiveTools().includes("vps_exec"), false);
  await handleControl("vps", "enable", ctx);
  assert.equal(confirmations, 1);
  await handleControl("vps", "disconnect", ctx);
  await handleControl("vps", "enable", ctx);
  assert.equal(confirmations, 2);
  mockPi.emit("session_start");
  await assert.rejects(handleControl("vps", "enable"), /Interactive approval required/);
});

test("device authorization fails closed and cannot survive a session change", async () => {
  const pi = createMockPi();
  const config: RemoteMeshConfig = { devices: { vps: { id: "vps", host: "example", username: "user", features: ["exec"] } } };
  const engine = new SshEngine(config.devices);
  let commands = 0;
  engine.exec = async () => { commands++; return { stdout: "ok", stderr: "", exitCode: 0, durationMs: 0 }; };
  const { handleControl } = registerMeshTools(pi as any, config, engine);
  const tool = pi.registeredTools.find((item) => item.name === "vps_exec");
  assert.equal(tool.defaultActive, false);
  const before = await tool.execute("x", { command: "echo ok" }, undefined, undefined, {});
  assert.equal(before.isError, true);
  assert.equal(commands, 0);
  await assert.rejects(handleControl("vps", "enable", { hasUI: true, ui: { confirm: async () => false } } as any), /declined/);
  let finish!: (v: boolean) => void;
  const pending = handleControl("vps", "enable", { hasUI: true, ui: { confirm: () => new Promise<boolean>(r => { finish = r; }) } } as any);
  await new Promise(resolve => setImmediate(resolve));
  pi.emit("session_start");
  finish(true);
  await assert.rejects(pending, /Session or device authorization changed/);
  const disconnected = handleControl("vps", "enable", { hasUI: true, ui: { confirm: () => new Promise<boolean>(r => { finish = r; }) } } as any);
  await new Promise(resolve => setImmediate(resolve));
  await handleControl("vps", "disconnect");
  finish(true);
  await assert.rejects(disconnected, /authorization changed/);
  await handleControl("vps", "enable", { hasUI: true, ui: { confirm: async () => true } } as any);
  const after = await tool.execute("x", { command: "echo ok" }, undefined, undefined, {});
  assert.equal(after.isError, false);
  assert.equal(commands, 1);
});

test("concurrent enable requests share one confirmation", async () => {
  const pi = createMockPi();
  const config: RemoteMeshConfig = { devices: { vps: { id: "vps", host: "example", username: "user", features: ["exec"] } } };
  const { handleControl } = registerMeshTools(pi as any, config, new SshEngine(config.devices));
  let count = 0;
  let finish!: (v: boolean) => void;
  const ctx = { hasUI: true, ui: { confirm: () => { count++; return new Promise<boolean>(r => { finish = r; }); } } } as any;
  const first = handleControl("vps", "enable", ctx);
  const second = handleControl("vps", "enable", ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 1);
  finish(true);
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test("registerMeshTools rejects duplicate tool names", () => {
  const mockPi = createMockPi();
  const config: RemoteMeshConfig = {
    devices: {
      first: { id: "first", host: "10.0.0.1", username: "user", toolPrefix: "shared_" },
      second: { id: "second", host: "10.0.0.2", username: "user", toolPrefix: "shared_" },
    },
  };

  assert.throws(
    () => registerMeshTools(mockPi as any, config, new SshEngine(config.devices)),
    /Duplicate remote tool name/
  );
});
