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
  await handleControl("vps", "enable");
  assert.ok(mockPi.getActiveTools().includes("vps_exec"));
  assert.ok(mockPi.getActiveTools().includes("vps_read"));
  assert.ok(mockPi.getActiveTools().includes("vps_write"));
  // Phone tools should still be hidden
  assert.equal(mockPi.getActiveTools().includes("phone_exec"), false);

  // Disable VPS tools
  await handleControl("vps", "disable");
  assert.equal(mockPi.getActiveTools().includes("vps_exec"), false);
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
