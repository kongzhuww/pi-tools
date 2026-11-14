import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

export type QuotaColor = "success" | "warning" | "error" | "dim";

export interface QuotaStatusResult {
  text: string;
  color: QuotaColor;
}

export interface QuotaAdapter {
  id: string;
  name: string;
  supports(model?: Model<any>): boolean;
  getStatus(ctx: ExtensionContext, model?: Model<any>, force?: boolean): Promise<QuotaStatusResult>;
  getDetails(ctx: ExtensionContext, model?: Model<any>, force?: boolean): Promise<string>;
}

// --- Codex Types ---
export interface CodexWindowUsage {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

export interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: CodexWindowUsage;
    secondary_window?: CodexWindowUsage;
  };
}

// --- Antigravity Types ---
export interface AgyQuotaBucket {
  bucketId?: string;
  displayName?: string;
  window?: string;
  resetTime?: string;
  description?: string;
  remainingFraction?: number;
}

export interface AgyQuotaGroup {
  displayName?: string;
  description?: string;
  buckets?: AgyQuotaBucket[];
}

export interface AgyQuotaSummary {
  groups?: AgyQuotaGroup[];
  description?: string;
}

export interface AgyAccountEntry {
  email?: string;
  accountId?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  lastUsedAt?: number;
}

export interface AgyAccountsStore {
  version?: number;
  activeAccountId?: string;
  accounts?: Record<string, AgyAccountEntry>;
}
