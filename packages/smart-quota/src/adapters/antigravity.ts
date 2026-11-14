import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetch as undiciFetch } from "undici";
import type {
  AgyAccountsStore,
  AgyQuotaBucket,
  AgyQuotaGroup,
  AgyQuotaSummary,
  QuotaAdapter,
  QuotaStatusResult,
} from "../types.js";
import { formatIsoReset, renderProgressBar, resolveStatusColor } from "../utils/format.js";
import { getSharedDispatcher } from "../utils/http.js";

const AGY_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];
const CACHE_TTL_MS = 60 * 1000;
const USER_AGENT =
  "antigravity/cli/1.4.0 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)";

interface CachedAgy {
  token: string;
  data: AgyQuotaSummary;
  fetchedAt: number;
}

export class AntigravityAdapter implements QuotaAdapter {
  id = "antigravity";
  name = "Google Antigravity";

  private cache = new Map<string, CachedAgy>();
  private pendingRequests = new Map<string, Promise<AgyQuotaSummary>>();

  supports(model?: Model<any>): boolean {
    const provider = model?.provider || "";
    return /^(google-)?antigravity$|^agy$/i.test(provider);
  }

  /**
   * 通过指定的 OAuth access token 拉取配额
   */
  async fetchUsageWithToken(token: string, force = false, timeoutMs = 15_000): Promise<AgyQuotaSummary> {
    const now = Date.now();
    const cached = this.cache.get(token);
    if (!force && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data;
    }

    const pending = this.pendingRequests.get(token);
    if (pending) return pending;

    const promise = (async () => {
      let lastError = "";
      for (const endpoint of AGY_ENDPOINTS) {
        try {
          const res = await undiciFetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
            method: "POST",
            dispatcher: getSharedDispatcher(),
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent": USER_AGENT,
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(timeoutMs),
          });

          if (res.ok) {
            const data = (await res.json()) as AgyQuotaSummary;
            this.cache.set(token, { token, data, fetchedAt: Date.now() });
            return data;
          }
          lastError = `HTTP ${res.status}`;
        } catch (err: any) {
          lastError = err?.message || String(err);
        }
      }
      throw new Error(`AGY 额度接口请求失败 (${lastError})`);
    })().finally(() => {
      this.pendingRequests.delete(token);
    });

    this.pendingRequests.set(token, promise);
    return promise;
  }

  /**
   * 获取当前活动的 Antigravity Access Token
   */
  async getActiveToken(ctx: ExtensionContext): Promise<string> {
    const rawKey = await ctx.modelRegistry.getApiKeyForProvider("antigravity");
    if (!rawKey) {
      throw new Error("请先运行 /login antigravity 授权登录 Google 账号");
    }

    try {
      const parsed = JSON.parse(rawKey);
      return parsed.token || parsed.access || rawKey;
    } catch {
      return rawKey;
    }
  }

  /**
   * 尝试读取本地多账号存储（优先当前 profile，回退到 ~/.pi/agent）
   */
  async loadMultiAccounts(): Promise<AgyAccountsStore | null> {
    const candidates = [
      join(getAgentDir(), "antigravity-accounts.json"),
      join(homedir(), ".pi", "agent", "antigravity-accounts.json"),
    ];

    for (const filePath of candidates) {
      try {
        const content = await readFile(filePath, "utf8");
        const parsed = JSON.parse(content) as AgyAccountsStore;
        if (parsed?.accounts && typeof parsed.accounts === "object") {
          return parsed;
        }
      } catch {
        // 继续尝试下一个候选路径
      }
    }
    return null;
  }

  /**
   * 智能匹配当前模型的配额桶
   */
  resolveBuckets(summary: AgyQuotaSummary, modelId = ""): {
    groupName: string;
    shortGroup: string;
    bucket5h?: AgyQuotaBucket;
    bucketWeekly?: AgyQuotaBucket;
    argonWeekly?: AgyQuotaBucket;
  } {
    const groups = summary.groups || [];
    const isClaudeOrGpt = /claude|gpt/i.test(modelId);
    const isGemini4 = /gemini-4|argon/i.test(modelId);

    const argonGroup = groups.find(
      (g) =>
        /gemini\s*4|argon/i.test(g.displayName || "") ||
        (g.buckets || []).some((b) => /argon/i.test(b.bucketId || "")),
    );
    const argonWeekly = (argonGroup?.buckets || []).find(
      (b) => b.window === "weekly" || /week|argon/i.test(b.bucketId || ""),
    );

    let matchedGroup = isGemini4
      ? argonGroup ?? groups.find((g) => /gemini/i.test(g.displayName || ""))
      : groups.find((g) => {
          const name = g.displayName || "";
          return isClaudeOrGpt
            ? /claude|gpt/i.test(name)
            : /gemini/i.test(name) && !/gemini\s*4|argon/i.test(name);
        });

    if (!matchedGroup && groups.length > 0) {
      matchedGroup = groups[0];
    }

    const isMatchedArgon = matchedGroup === argonGroup && !!argonGroup;
    const shortGroup = isMatchedArgon ? "Gemini 4" : isClaudeOrGpt ? "Claude" : "Gemini";
    const groupName = matchedGroup?.displayName || shortGroup;
    const buckets = matchedGroup?.buckets || [];
    const bucket5h = buckets.find((b) => b.window === "5h" || /5h|five/i.test(b.bucketId || ""));
    const bucketWeekly = buckets.find((b) => b.window === "weekly" || /week/i.test(b.bucketId || ""));

    return {
      groupName,
      shortGroup,
      bucket5h,
      bucketWeekly,
      argonWeekly: isMatchedArgon ? undefined : argonWeekly,
    };
  }

  async getStatus(ctx: ExtensionContext, model?: Model<any>, force = false): Promise<QuotaStatusResult> {
    const token = await this.getActiveToken(ctx);
    const summary = await this.fetchUsageWithToken(token, force);
    const { shortGroup, bucket5h, bucketWeekly, argonWeekly } = this.resolveBuckets(
      summary,
      model?.id,
    );

    const p5h =
      typeof bucket5h?.remainingFraction === "number"
        ? Math.round(bucket5h.remainingFraction * 100)
        : undefined;
    const pWeekly =
      typeof bucketWeekly?.remainingFraction === "number"
        ? Math.round(bucketWeekly.remainingFraction * 100)
        : undefined;
    const pArgon =
      typeof argonWeekly?.remainingFraction === "number"
        ? Math.round(argonWeekly.remainingFraction * 100)
        : undefined;

    const parts = [`AGY (${shortGroup})`];
    if (p5h !== undefined) parts.push(`5h ${p5h}%`);
    if (pWeekly !== undefined) parts.push(`7d ${pWeekly}%`);
    if (pArgon !== undefined) parts.push(`G4 ${pArgon}%`);
    const text = parts.length > 1 ? parts.join(" · ") : "AGY 额度未知";

    const minRemaining = Math.min(p5h ?? 100, pWeekly ?? 100, pArgon ?? 100);
    return {
      text,
      color: resolveStatusColor(minRemaining),
    };
  }

  async getDetails(ctx: ExtensionContext, model?: Model<any>, force = false): Promise<string> {
    const activeToken = await this.getActiveToken(ctx);
    const store = await this.loadMultiAccounts();
    const activeEmail = store?.activeAccountId;

    const summary = await this.fetchUsageWithToken(activeToken, force);
    const lines = ["【Google Antigravity (AGY) 配额概览】"];

    if (activeEmail) {
      lines.push(`当前主账号：${activeEmail}`);
    }
    if (model?.id) {
      lines.push(`当前活动模型：${model.id}`);
    }

    for (const group of summary.groups || []) {
      lines.push(`\n▶ ${group.displayName || "配额组"}：`);
      for (const bucket of group.buckets || []) {
        const fraction = bucket.remainingFraction;
        const percent = typeof fraction === "number" ? fraction * 100 : undefined;
        const bar = percent !== undefined ? renderProgressBar(percent) : "未知";
        const reset = formatIsoReset(bucket.resetTime);
        lines.push(`  • ${bucket.displayName || bucket.bucketId || "限额"}：${bar} （${reset}重置）`);
      }
    }

    // 多账号感知扩展卡片：并发拉取 + Token 有效期预检
    if (store?.accounts) {
      const otherAccounts = Object.entries(store.accounts).filter(
        ([email]) => email !== activeEmail,
      );

      if (otherAccounts.length > 0) {
        lines.push(`\n${"-".repeat(32)}\n【备用 Google 账号状态 (${otherAccounts.length} 个)】`);

        const now = Date.now();
        const accountPromises = otherAccounts.map(async ([email, entry]) => {
          if (!entry.access) {
            return `• ${email} ➔ (未找到 Access Token)`;
          }

          // 预检 Token 过期时间戳（提前 30 秒认定过期）
          if (entry.expires && now >= entry.expires - 30_000) {
            return `• ${email} ➔ (Token 已过期，需在对应账号下激活)`;
          }

          try {
            // 备用账号超时设为 6 秒，防单一账号拖垮整体响应
            const accSummary = await this.fetchUsageWithToken(entry.access, force, 6_000);
            const { bucket5h, bucketWeekly } = this.resolveBuckets(accSummary, model?.id);
            const p5h =
              typeof bucket5h?.remainingFraction === "number"
                ? `${Math.round(bucket5h.remainingFraction * 100)}%`
                : "未知";
            const pWeekly =
              typeof bucketWeekly?.remainingFraction === "number"
                ? `${Math.round(bucketWeekly.remainingFraction * 100)}%`
                : "未知";
            return `• ${email} ➔ 5h: ${p5h} | 7d: ${pWeekly}`;
          } catch {
            return `• ${email} ➔ (Token 失效或网络超时)`;
          }
        });

        const settledResults = await Promise.allSettled(accountPromises);
        for (const res of settledResults) {
          if (res.status === "fulfilled") {
            lines.push(res.value);
          }
        }
      }
    }

    return lines.join("\n");
  }
}
