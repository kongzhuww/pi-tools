import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { fetch as undiciFetch } from "undici";
import type {
  CodexUsageResponse,
  CodexWindowUsage,
  QuotaAdapter,
  QuotaStatusResult,
} from "../types.js";
import { formatEpochReset, renderProgressBar, resolveStatusColor } from "../utils/format.js";
import { getSharedDispatcher } from "../utils/http.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_AUTH_CLAIM = "https://api.openai.com/auth";
const CACHE_TTL_MS = 60 * 1000;

function codexRemaining(window?: CodexWindowUsage): number | undefined {
  if (typeof window?.used_percent !== "number") return undefined;
  return Math.max(0, Math.min(100, Math.round(100 - window.used_percent)));
}

function accountIdFromJwt(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Codex OAuth token 格式无效");
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  const accountId = payload?.[CODEX_AUTH_CLAIM]?.chatgpt_account_id;
  if (typeof accountId !== "string" || !accountId) {
    throw new Error("Codex token 缺少 account ID");
  }
  return accountId;
}

export class CodexAdapter implements QuotaAdapter {
  id = "openai-codex";
  name = "OpenAI Codex";

  private cachedData?: { data: CodexUsageResponse; fetchedAt: number };
  private pendingPromise?: Promise<CodexUsageResponse>;

  supports(model?: Model<any>): boolean {
    const provider = model?.provider || "";
    return /^(openai-)?codex$/i.test(provider);
  }

  async fetchUsage(ctx: ExtensionContext, force = false): Promise<CodexUsageResponse> {
    const now = Date.now();
    if (!force && this.cachedData && now - this.cachedData.fetchedAt < CACHE_TTL_MS) {
      return this.cachedData.data;
    }
    if (this.pendingPromise) return this.pendingPromise;

    this.pendingPromise = (async () => {
      const auth = await ctx.modelRegistry.getProviderAuth("openai-codex");
      const token = auth?.auth.apiKey;
      if (!token) throw new Error("请先运行 /login openai-codex 授权登录");

      const res = await undiciFetch(CODEX_USAGE_URL, {
        dispatcher: getSharedDispatcher(),
        headers: {
          Authorization: `Bearer ${token}`,
          "chatgpt-account-id": accountIdFromJwt(token),
          originator: "pi",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        throw new Error(`Codex 额度接口返回 HTTP ${res.status}`);
      }

      const data = (await res.json()) as CodexUsageResponse;
      this.cachedData = { data, fetchedAt: Date.now() };
      return data;
    })().finally(() => {
      this.pendingPromise = undefined;
    });

    return this.pendingPromise;
  }

  async getStatus(ctx: ExtensionContext, _model?: Model<any>, force = false): Promise<QuotaStatusResult> {
    const data = await this.fetchUsage(ctx, force);
    const primary = codexRemaining(data.rate_limit?.primary_window);
    const secondary = codexRemaining(data.rate_limit?.secondary_window);

    const parts = ["Codex"];
    if (primary !== undefined) parts.push(`5h ${primary}%`);
    if (secondary !== undefined) parts.push(`7d ${secondary}%`);
    const text = parts.length > 1 ? parts.join(" · ") : "Codex 额度未知";

    const minRemaining = Math.min(primary ?? 100, secondary ?? 100);
    return {
      text,
      color: resolveStatusColor(minRemaining),
    };
  }

  async getDetails(ctx: ExtensionContext, _model?: Model<any>, force = false): Promise<string> {
    const data = await this.fetchUsage(ctx, force);
    const primary = data.rate_limit?.primary_window;
    const secondary = data.rate_limit?.secondary_window;

    const pRem = codexRemaining(primary);
    const sRem = codexRemaining(secondary);

    const pBar = pRem !== undefined ? renderProgressBar(pRem) : "未知";
    const sBar = sRem !== undefined ? renderProgressBar(sRem) : "未知";

    return [
      "【OpenAI Codex 额度详情】",
      `套餐计划：${data.plan_type ?? "默认计划"}`,
      `• 5小时窗口：剩余 ${pBar} （${formatEpochReset(primary?.reset_at)}重置）`,
      `• 7天周窗口：剩余 ${sBar} （${formatEpochReset(secondary?.reset_at)}重置）`,
    ].join("\n");
  }
}
