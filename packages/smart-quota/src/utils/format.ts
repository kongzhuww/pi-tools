import type { QuotaColor } from "../types.js";

function formatLocalTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const isSameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (isSameDay) {
    return `今天 ${timeStr}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    tomorrow.getFullYear() === date.getFullYear() &&
    tomorrow.getMonth() === date.getMonth() &&
    tomorrow.getDate() === date.getDate()
  ) {
    return `明天 ${timeStr}`;
  }

  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${timeStr}`;
}

export function formatEpochReset(timestamp?: number, withExactTime = true): string {
  if (!timestamp) return "未知";
  const targetDate = new Date(timestamp * 1000);
  const ms = targetDate.getTime() - Date.now();
  if (ms <= 0) return "即将重置";

  let relative = "";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) {
    relative = `${minutes}分钟`;
  } else {
    const hours = Math.ceil(minutes / 60);
    relative = hours < 48 ? `${hours}小时` : `${Math.ceil(hours / 24)}天`;
  }

  return withExactTime ? `${relative}后 · ${formatLocalTime(targetDate)}` : `${relative}后`;
}

export function formatIsoReset(resetTime?: string, withExactTime = true): string {
  if (!resetTime) return "未知";
  const ts = Date.parse(resetTime);
  if (!Number.isFinite(ts)) return resetTime;
  const targetDate = new Date(ts);
  const delta = ts - Date.now();
  if (delta <= 0) return "即将重置";

  const totalMin = Math.ceil(delta / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;

  let relative = "";
  if (days > 0) relative = `${days}天${hours}小时`;
  else if (hours > 0) relative = `${hours}小时${mins}分钟`;
  else relative = `${mins}分钟`;

  return withExactTime ? `${relative}后 · ${formatLocalTime(targetDate)}` : `${relative}后`;
}

/**
 * 绘制 ASCII 进度条，例如 [██████░░░░] 60.0%
 */
export function renderProgressBar(percentage: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filledCount = Math.round((clamped / 100) * width);
  const emptyCount = width - filledCount;
  const bar = "█".repeat(filledCount) + "░".repeat(emptyCount);
  return `[${bar}] ${clamped.toFixed(1)}%`;
}

export function resolveStatusColor(minRemainingPercent: number): QuotaColor {
  if (minRemainingPercent <= 10) return "error";
  if (minRemainingPercent <= 25) return "warning";
  return "success";
}
