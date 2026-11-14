import test from "node:test";
import assert from "node:assert/strict";
import {
  formatEpochReset,
  formatIsoReset,
  renderProgressBar,
  resolveStatusColor,
} from "../dist/utils/format.js";

test("renderProgressBar renders expected ascii progress", () => {
  assert.equal(renderProgressBar(0), "[░░░░░░░░░░] 0.0%");
  assert.equal(renderProgressBar(50), "[█████░░░░░] 50.0%");
  assert.equal(renderProgressBar(100), "[██████████] 100.0%");
});

test("resolveStatusColor returns correct levels", () => {
  assert.equal(resolveStatusColor(5), "error");
  assert.equal(resolveStatusColor(15), "warning");
  assert.equal(resolveStatusColor(80), "success");
});

test("formatEpochReset handles valid timestamp", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const result = formatEpochReset(future);
  assert.match(result, /小时|分钟/);
});

test("formatIsoReset handles valid ISO string", () => {
  const future = new Date(Date.now() + 7200 * 1000).toISOString();
  const result = formatIsoReset(future);
  assert.match(result, /小时|分钟/);
});
