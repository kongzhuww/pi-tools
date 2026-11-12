import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { resolveUserPath, normalizeDeviceConfig, isLocalHost } from "../src/config.js";
import { getToolNamesForDevice } from "../src/tool-registry.js";

test("resolveUserPath expands tilde correctly", () => {
  const resolved = resolveUserPath("~/test-key.pem");
  assert.equal(resolved, path.join(os.homedir(), "test-key.pem"));

  const normalPath = resolveUserPath("/var/log/app.log");
  assert.equal(normalPath, path.resolve("/var/log/app.log"));
});

test("normalizeDeviceConfig applies defaults properly", () => {
  const normalized = normalizeDeviceConfig("dev1", {
    host: "10.0.0.1",
    username: "user1",
  });

  assert.equal(normalized.id, "dev1");
  assert.equal(normalized.host, "10.0.0.1");
  assert.equal(normalized.port, 22);
  assert.equal(normalized.username, "user1");
  assert.equal(normalized.persistent, true);
  assert.deepEqual(normalized.features, ["exec", "sftp", "status"]);
});

test("getToolNamesForDevice generates compact names by default", () => {
  const dev = normalizeDeviceConfig("vps", {
    host: "1.2.3.4",
    features: ["exec", "sftp", "status"],
  });

  const tools = getToolNamesForDevice(dev, "compact");
  assert.equal(tools.exec, "vps_exec");
  assert.equal(tools.read, "vps_read");
  assert.equal(tools.write, "vps_write");
  assert.equal(tools.status, "vps_status");
  assert.deepEqual(tools.all, ["vps_exec", "vps_read", "vps_write", "vps_status"]);
});

test("getToolNamesForDevice generates prefixed names when configured", () => {
  const dev = normalizeDeviceConfig("vps", {
    host: "1.2.3.4",
    features: ["exec", "status"],
  });

  const tools = getToolNamesForDevice(dev, "prefixed");
  assert.equal(tools.exec, "remote_vps_exec");
  assert.equal(tools.status, "remote_vps_status");
  assert.equal(tools.read, undefined);
  assert.deepEqual(tools.all, ["remote_vps_exec", "remote_vps_status"]);
});

test("isLocalHost detects localhost targets when localBypass is enabled", () => {
  const localDev = normalizeDeviceConfig("local", {
    host: "127.0.0.1",
    localBypass: true,
  });
  assert.equal(isLocalHost(localDev), true);

  const bypassOff = normalizeDeviceConfig("local", {
    host: "127.0.0.1",
    localBypass: false,
  });
  assert.equal(isLocalHost(bypassOff), false);
});
