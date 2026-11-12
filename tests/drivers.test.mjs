import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMacOsScript,
  buildWindowsToastScript,
} from "../dist/drivers/index.js";

test("buildWindowsToastScript escapes single quotes correctly", () => {
  const script = buildWindowsToastScript("Pi's Alert", "It's a test: 'hello'");
  assert.match(script, /Pi''s Alert/);
  assert.match(script, /It''s a test: ''hello''/);
  assert.match(script, /ToastNotificationManager/);
});

test("buildMacOsScript escapes quotes and includes sound", () => {
  const script = buildMacOsScript({
    title: 'Pi "Project"',
    body: 'Say "Hello"',
    sound: true,
  });
  assert.match(script, /with title "Pi \\"Project\\""/);
  assert.match(script, /display notification "Say \\"Hello\\""/);
  assert.match(script, /sound name "default"/);
});

test("buildMacOsScript respects optional subtitle and sound=false", () => {
  const script = buildMacOsScript({
    title: "Pi",
    body: "Done",
    subtitle: "Sub-Title",
    sound: false,
  });
  assert.match(script, /subtitle "Sub-Title"/);
  assert.doesNotMatch(script, /sound name/);
});
