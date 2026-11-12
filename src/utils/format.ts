import type { QuotaColor } from "../types.js";

export function formatEpochReset(timestamp?: number): string {
  if (!timestamp) return "未知";
  const ms = timestamp * 1000 - Date.now();
  if (ms <= 0) return "即将重置";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}小时`;
  return `${Math.ceil(hours / 24)}天`;
}

export function formatIsoReset(resetTime?: string): string {
  if (!resetTime) return "未知";
  const ts = Date.parse(resetTime);
  if (!Number.isFinite(ts)) return resetTime;
  const delta = ts - Date.now();
  if (delta <= 0) return "即将重置";
  const totalMin = Math.ceil(delta / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${mins}分钟`;
  return `${mins}分钟`;
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
