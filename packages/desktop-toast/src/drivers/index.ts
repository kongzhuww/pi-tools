import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NotificationOptions } from "../types.js";

const execFileAsync = promisify(execFile);
const NOTIFY_TIMEOUT_MS = 10_000;

export function buildWindowsToastScript(title: string, body: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "$manager = [Windows.UI.Notifications.ToastNotificationManager]",
    "$template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02",
    "$xml = $manager::GetTemplateContent($template)",
    "$texts = $xml.GetElementsByTagName('text')",
    `$null = $texts.Item(0).AppendChild($xml.CreateTextNode(${quote(title)}))`,
    `$null = $texts.Item(1).AppendChild($xml.CreateTextNode(${quote(body)}))`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    "$toast.SuppressPopup = $false",
    "$manager::CreateToastNotifier('Pi').Show($toast)",
  ].join("; ");
}

export function buildMacOsScript(options: NotificationOptions): string {
  const escapeMac = (text: string) =>
    text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const cleanTitle = escapeMac(options.title);
  const cleanBody = escapeMac(options.body);

  const parts = [`display notification "${cleanBody}" with title "${cleanTitle}"`];
  if (options.subtitle) {
    parts.push(`subtitle "${escapeMac(options.subtitle)}"`);
  }
  if (options.sound !== false) {
    parts.push('sound name "default"');
  }

  return parts.join(" ");
}

export async function sendNativeNotification(
  options: NotificationOptions,
  platform = process.platform,
): Promise<boolean> {
  try {
    if (platform === "darwin") {
      const script = buildMacOsScript(options);
      await execFileAsync("osascript", ["-e", script], {
        timeout: NOTIFY_TIMEOUT_MS,
      });
      return true;
    }

    if (platform === "win32") {
      const script = buildWindowsToastScript(options.title, options.body);
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          script,
        ],
        { timeout: NOTIFY_TIMEOUT_MS, windowsHide: true },
      );
      return true;
    }

    if (platform === "linux") {
      const args = ["--app-name=Pi", options.title, options.body];
      await execFileAsync("notify-send", args, {
        timeout: NOTIFY_TIMEOUT_MS,
      });
      return true;
    }

    return false;
  } catch {
    // 系统不支持或用户禁用了通知权限，优雅失败
    return false;
  }
}
