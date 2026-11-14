import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { CodexAdapter } from "./adapters/codex.js";
import { AntigravityAdapter } from "./adapters/antigravity.js";
import type { QuotaAdapter } from "./types.js";
import { closeSharedDispatcher } from "./utils/http.js";

const STATUS_ID = "smart-quota";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export default function (pi: ExtensionAPI) {
  const codex = new CodexAdapter();
  const antigravity = new AntigravityAdapter();
  const adapters: QuotaAdapter[] = [codex, antigravity];

  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  function findAdapter(model?: Model<any>): QuotaAdapter | undefined {
    return adapters.find((a) => a.supports(model));
  }

  async function updateStatusBar(
    ctx: ExtensionContext,
    targetModel?: Model<any>,
    force = false,
  ): Promise<void> {
    if (!ctx.hasUI) return;
    const model = targetModel ?? ctx.model;
    const adapter = findAdapter(model);

    if (!adapter) {
      // 当前模型无适配额度监控时，优雅清空状态槽
      ctx.ui.setStatus(STATUS_ID, undefined);
      return;
    }

    try {
      const { text, color } = await adapter.getStatus(ctx, model, force);
      ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg(color, text));
    } catch {
      ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", `${adapter.name} 额度不可用`));
    }
  }

  // --- 生命周期挂钩 ---

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const model = ctx.model;
    const adapter = findAdapter(model);
    if (adapter) {
      ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", `${adapter.name} 额度…`));
    }
    await updateStatusBar(ctx);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => void updateStatusBar(ctx), REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
  });

  pi.on("model_select", async (event, ctx) => {
    if (!ctx.hasUI) return;
    const nextModel = event.model;
    const adapter = findAdapter(nextModel);
    if (adapter) {
      ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", `${adapter.name} 额度…`));
    } else {
      ctx.ui.setStatus(STATUS_ID, undefined);
    }
    await updateStatusBar(ctx, nextModel);
  });

  pi.on("session_shutdown", async () => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = undefined;
    await closeSharedDispatcher();
  });

  // --- 命令注册 ---

  // 1. 统一主命令 /quota
  pi.registerCommand("quota", {
    description: "查看当前或全部模型提供商（Codex、Antigravity）配额与重置时间（参数: all | codex | agy）",
    handler: async (args, ctx) => {
      const target = (args || "").trim().toLowerCase();
      const currentModel = ctx.model;

      if (target === "all") {
        ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", "刷新全部配额…"));
        const details = await Promise.all(
          adapters.map(async (adapter) => {
            try {
              return await adapter.getDetails(ctx, currentModel, true);
            } catch (err: any) {
              return `【${adapter.name}】获取失败: ${err?.message || err}`;
            }
          }),
        );
        await updateStatusBar(ctx, undefined, false);
        ctx.ui.notify(details.join("\n\n" + "=".repeat(36) + "\n\n"), "info");
        return;
      }

      if (target === "codex" || (!target && codex.supports(currentModel))) {
        ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", "Codex 刷新中…"));
        try {
          const detail = await codex.getDetails(ctx, currentModel, true);
          await updateStatusBar(ctx, undefined, false);
          ctx.ui.notify(detail, "info");
        } catch (error: any) {
          ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("error", "Codex 额度获取失败"));
          ctx.ui.notify(error?.message || String(error), "error");
        }
        return;
      }

      if (
        target === "agy" ||
        target === "antigravity" ||
        (!target && antigravity.supports(currentModel))
      ) {
        ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", "AGY 刷新中…"));
        try {
          const detail = await antigravity.getDetails(ctx, currentModel, true);
          await updateStatusBar(ctx, undefined, false);
          ctx.ui.notify(detail, "info");
        } catch (error: any) {
          ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("error", "AGY 额度获取失败"));
          ctx.ui.notify(error?.message || String(error), "error");
        }
        return;
      }

      ctx.ui.notify(
        `当前模型提供商为 [${currentModel?.provider || "未知"}]，暂未配置独立额度接口。\n可运行 /quota all 查看所有已授权服务（Codex / AGY）的配额概况。`,
        "info",
      );
    },
  });

  // 2. 独立便捷命令 /codex-quota
  pi.registerCommand("codex-quota", {
    description: "强制刷新并查看 OpenAI Codex 剩余额度与窗口详情",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", "Codex 刷新中…"));
      try {
        const detail = await codex.getDetails(ctx, ctx.model, true);
        await updateStatusBar(ctx, undefined, false);
        ctx.ui.notify(detail, "info");
      } catch (error: any) {
        ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("error", "Codex 额度不可用"));
        ctx.ui.notify(error?.message || String(error), "error");
      }
    },
  });

  // 3. 独立便捷别名 /antigravity-quota 与 /agy-quota
  const handleAgy = async (_args: string, ctx: ExtensionContext) => {
    ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", "AGY 刷新中…"));
    try {
      const detail = await antigravity.getDetails(ctx, ctx.model, true);
      await updateStatusBar(ctx, undefined, false);
      ctx.ui.notify(detail, "info");
    } catch (error: any) {
      ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("error", "AGY 额度不可用"));
      ctx.ui.notify(error?.message || String(error), "error");
    }
  };

  pi.registerCommand("antigravity-quota", {
    description: "强制刷新并查看 Google Antigravity (AGY) 剩余额度与配额池详情",
    handler: handleAgy,
  });

  pi.registerCommand("agy-quota", {
    description: "强制刷新并查看 Google Antigravity (AGY) 剩余额度（简短别名）",
    handler: handleAgy,
  });
}
