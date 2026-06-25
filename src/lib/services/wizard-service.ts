import type { EntityCandidate } from '@/lib/services/entity-detector';
import type { ProposedRule } from '@/lib/stores/wizard-store';

// ─── Types ───────────────────────────────────────────────────────────
export interface SuggestRoleResponse {
  suggestedRole: string;
  confidence: number;
  explanation: string;
}

export interface ApplyAllResponse {
  matched: number;
  total: number;
}

export interface RuleCreationResult {
  status: 'fulfilled' | 'rejected';
  value?: unknown;
  reason?: unknown;
}

// ─── Base fetch helper ───────────────────────────────────────────────
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body as T;
}

// ─── Minimal rule type for delta filter ──────────────────────────────
interface BankRuleMeta {
  conditionValue: string;
  isActive: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────
export const wizardService = {
  /**
   * Fetch unique entity names from existing bank rules for a company.
   * Used by the delta filter to exclude entities that already have rules.
   * Falls back to empty array on error — the wizard still works, just without filtering.
   */
  async fetchExistingEntityNames(companyId: string): Promise<string[]> {
    try {
      const result = await apiFetch<{ data: BankRuleMeta[] }>(
        `/api/bank-rules?companyId=${encodeURIComponent(companyId)}`,
      );
      const names = new Set<string>();
      for (const rule of result.data ?? []) {
        const val = rule.conditionValue?.trim();
        if (val) {
          names.add(val.toLowerCase());
        }
      }
      return Array.from(names);
    } catch {
      // If the rules API fails, return empty so entities still load
      return [];
    }
  },
  /**
   * Fetch entity candidates from the smart-classify endpoint.
   * Uses clusterByBehavior() under the hood for behavior-based clustering.
   */
  async fetchEntities(companyId: string): Promise<EntityCandidate[]> {
    const result = await apiFetch<{ data: EntityCandidate[] }>(
      `/api/learning/smart-classify?companyId=${encodeURIComponent(companyId)}`,
    );

    if (!result.data) {
      throw new Error('No data returned from smart-classify');
    }

    return result.data;
  },

  /**
   * Suggest a role for a single entity candidate using the AI-powered suggest-role endpoint.
   */
  async suggestRoleForEntity(
    candidate: EntityCandidate,
    companyId: string,
  ): Promise<SuggestRoleResponse> {
    return apiFetch<SuggestRoleResponse>('/api/learning/suggest-role', {
      method: 'POST',
      body: JSON.stringify({
        description: candidate.canonicalName,
        companyId,
        directionProfile: candidate.directionProfile,
        sampleDescriptions: candidate.sampleDescriptions,
        occurrences: candidate.occurrences,
        totalAmount: {
          min: candidate.totalAmount ?? 0,
          max: candidate.totalAmount ?? 0,
        },
      }),
    });
  },

  /**
   * Create bank rules for each proposed rule.
   * Uses Promise.allSettled so partial failures are visible.
   * Returns an array of per-rule results.
   */
  async createRules(
    rules: ProposedRule[],
    companyId: string,
  ): Promise<PromiseSettledResult<unknown>[]> {
    const results = await Promise.allSettled(
      rules.map((rule) =>
        apiFetch('/api/bank-rules', {
          method: 'POST',
          body: JSON.stringify({
            companyId,
            name: rule.entityName,
            conditionType: rule.conditionType,
            conditionValue: rule.conditionValue,
            transactionDirection: rule.transactionDirection,
            glAccountCode: rule.debitGlAccountId ?? rule.creditGlAccountId,
          }),
        }),
      ),
    );

    return results;
  },

  /**
   * Apply all active rules to historical uncategorized transactions.
   */
  async applyAll(companyId: string): Promise<ApplyAllResponse> {
    return apiFetch<ApplyAllResponse>('/api/bank-rules/apply-all', {
      method: 'POST',
      body: JSON.stringify({ companyId }),
    });
  },
};
