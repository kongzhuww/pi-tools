import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sendNativeNotification } from "./drivers/index.js";
import { resolveWorkspaceTitle } from "./utils/workspace.js";
import type { ToastConfig } from "./types.js";

const DEFAULT_CONFIG: Required<ToastConfig> = {
  enabled: true,
  minDurationSeconds: 3,
  notifyOnSettled: true,
  notifyOnPrompt: true,
  notifyOnQuestion: true,
  sound: true,
};

export default function (pi: ExtensionAPI) {
  let turnStartTime = 0;
  const config = { ...DEFAULT_CONFIG };

  // 统一通知触发器
  const dispatchToast = async (
    category: string,
    body: string,
    subtitle?: string,
  ): Promise<boolean> => {
    if (!config.enabled) return false;
    const workspaceTitle = await resolveWorkspaceTitle();
    const fullTitle = `${workspaceTitle} · ${category}`;

    return sendNativeNotification({
      title: fullTitle,
      body,
      subtitle,
      sound: config.sound,
    });
  };

  // --- 事件监听 ---

  // 1. 记录本轮对话或任务开始时刻
  pi.on("agent_start", () => {
    turnStartTime = Date.now();
  });

  // 2. 任务执行完成
  pi.on("agent_settled", async (event) => {
    if (!config.notifyOnSettled || event?.aborted) return;

    const durationMs = turnStartTime > 0 ? Date.now() - turnStartTime : 0;
    const minMs = (config.minDurationSeconds ?? 0) * 1000;

    // 智能防打扰：如果任务极短（例如简单打招呼或瞬间完成的指令），跳过弹窗
    if (durationMs > 0 && durationMs < minMs) {
      return;
    }

    const durationSec = Math.round(durationMs / 1000);
    const timeHint = durationSec >= 1 ? `（耗时 ${durationSec}s）` : "";
    void dispatchToast("任务完成", `已执行完毕${timeHint}，请切回终端查看。`);
  });

  // 3. 等待人工审批/确认权限
  pi.on("ui_prompt_start", async (event) => {
    if (!config.notifyOnPrompt) return;
    const detail = event?.title
      ? `需要确认：${event.title}`
      : "Pi 正在等待你的审批或输入操作。";
    void dispatchToast("等待批准", detail);
  });

  // 4. Agent 主动提问待答
  pi.on("tool_execution_start", async (event) => {
    if (!config.notifyOnQuestion || event.toolName !== "ask_user_question") return;

    const question = event.args?.questions?.[0]?.question;
    const detail =
      typeof question === "string" && question.trim()
        ? `${question.trim()}`
        : "Pi 正在向你提问，等待你的回答。";

    void dispatchToast("提问待答", detail);
  });

  // --- 命令注册 ---

  // /toast-test 快速测试当前系统的通知通路
  pi.registerCommand("toast-test", {
    description: "发送一条测试桌面通知，验证系统通知中心与权限是否正常",
    handler: async (_args: string, ctx: ExtensionContext) => {
      ctx.ui.notify("正在发送系统级桌面通知测试…", "info");
      const ok = await dispatchToast("通知测试", "恭喜！你的系统原生桌面通知配置成功。");
      if (ok) {
        ctx.ui.notify("桌面通知已成功发出，请检查系统通知中心！", "info");
      } else {
        ctx.ui.notify("桌面通知发送失败，请检查系统设置中的通知权限。", "warning");
      }
    },
  });
}
