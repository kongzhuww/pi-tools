export interface NotificationOptions {
  title: string;
  body: string;
  subtitle?: string;
  sound?: boolean;
}

export interface ToastConfig {
  /** 是否启用桌面通知（默认 true） */
  enabled?: boolean;
  /** 任务持续时长阈值（秒），任务耗时超过该值才发送完成通知，避免极短任务频繁打扰（默认 3 秒） */
  minDurationSeconds?: number;
  /** 任务执行完毕时通知（默认 true） */
  notifyOnSettled?: boolean;
  /** 需要用户确认/审批权限时通知（默认 true） */
  notifyOnPrompt?: boolean;
  /** Agent 提问等待回答时通知（默认 true） */
  notifyOnQuestion?: boolean;
  /** 是否伴随提示音（默认 true） */
  sound?: boolean;
}
