import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { findContext } from '@/lib/services/entity-context-service';
import { loadConfig, sanitizeDescription, extractName } from '@/lib/services/entity-detector';

/**
 * POST /api/ai-rules/scan
 * Body: { companyId: string }
 *
 * Reads all bank transactions for a company and detects repetitive
 * description patterns (≥ 3 occurrences).  No external AI is used —
 * everything runs locally with pure string heuristics.
 */
export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { userId, companyId } = requireCompanyContext();
  const entityConfig = loadConfig();

  // ── 1. Get all bank accounts for the company ───────────────────
  const bankAccounts = await db.bankAccount.findMany({
    where: { companyId, isActive: true },
    select: { id: true },
  });
  const bankAccountIds = bankAccounts.map((a) => a.id);

  if (bankAccountIds.length === 0) {
    return NextResponse.json({ patterns: [] });
  }

  // ── 2. Fetch all transactions ──────────────────────────────────
  const transactions = await db.bankTransaction.findMany({
    where: {
      statement: { bankAccountId: { in: bankAccountIds } },
    },
    select: {
      id: true,
      description: true,
      amount: true,
      matchedRuleId: true, // skip already-ruled transactions
      glAccountId: true, // skip already-classified transactions
    },
  });

  // ── 3. Normalize & count descriptions ─────────────────────────
  // Remove transaction IDs / confirmation codes / amounts from description
  // so that "Zelle payment to Cliente X Conf# abc123" and
  //          "Zelle payment to Cliente X Conf# xyz999"
  // both normalize to "Zelle payment to Cliente X"
  function normalize(raw: string): string {
    return raw
      .replace(/conf#?\s*\S+/gi, '') // remove Conf# codes
      .replace(/\b[a-z0-9]{8,}\b/gi, '') // remove long alphanumeric tokens
      .replace(/\b\d[\d.,/\-]*\b/g, '') // remove numbers / amounts
      .replace(/\s{2,}/g, ' ')
      .trim()
      .toLowerCase();
  }

  interface Entry {
    count: number;
    sample: string; // original description sample
    totalAmount: number;
    debitCount: number;
    creditCount: number;
  }

  const map = new Map<string, Entry>();

  for (const tx of transactions) {
    if (tx.matchedRuleId || tx.glAccountId) continue;
    const key = normalize(tx.description ?? '');
    if (key.length < 4) continue; // too short to be meaningful

    const existing = map.get(key);
    const isDebit = tx.amount < 0;
    if (existing) {
      existing.count++;
      existing.totalAmount += Math.abs(tx.amount);
      if (isDebit) existing.debitCount++;
      else existing.creditCount++;
    } else {
      map.set(key, {
        count: 1,
        sample: tx.description ?? '',
        totalAmount: Math.abs(tx.amount),
        debitCount: isDebit ? 1 : 0,
        creditCount: isDebit ? 0 : 1,
      });
    }
  }

  const MIN_OCCURRENCES = 3;

  // Fetch existing active rules to avoid suggesting them
  const existingRules = await db.bankRule.findMany({
    where: { companyId, isActive: true },
    select: { conditionValue: true, conditionType: true },
  });

  // Fetch existing GL accounts to match against
  const glAccounts = await db.glAccount.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true, code: true, accountType: true },
  });

  // Heuristic GL account suggestions based on keywords mapping to actual GL accounts
  function suggestAccount(
    sample: string,
    isDebit: boolean,
  ): { name: string; code: string; id: string } | null {
    const desc = sample.toLowerCase();
    let matchedAcc: { id: string; name: string; code: string; accountType: string } | null = null;

    // Basic heuristic keywords (generic financial terms only)
    const keywords = {
      zelle: isDebit ? 'gasto' : 'ingreso',
      paypal: 'banco',
      fee: 'gasto',
      charge: 'gasto',
      comision: 'gasto',
      rent: 'gasto',
      insurance: 'gasto',
      seguro: 'gasto',
    };

    for (const [kw, typeHint] of Object.entries(keywords)) {
      if (desc.includes(kw)) {
        // Find an account whose name contains the keyword, or matches the hint
        matchedAcc =
          glAccounts.find((a) => a.name.toLowerCase().includes(kw)) ||
          glAccounts.find((a) =>
            typeHint === 'gasto' ? a.accountType === 'expense' : a.accountType === 'revenue',
          ) ||
          null;
        if (matchedAcc) break;
      }
    }

    // Fallback
    if (!matchedAcc) {
      matchedAcc =
        glAccounts.find((a) =>
          isDebit ? a.accountType === 'expense' : a.accountType === 'revenue',
        ) || null;
    }

    if (matchedAcc) {
      return { name: matchedAcc.name, code: matchedAcc.code, id: matchedAcc.id };
    }

    return null;
  }

  const patterns: any[] = [];

  for (const [key, entry] of map.entries()) {
    if (entry.count < MIN_OCCURRENCES) continue;

    // Skip if an existing rule covers this pattern
    const alreadyHasRule = existingRules.some((r) => {
      const cond = r.conditionValue.toLowerCase().trim();
      const k = key.toLowerCase().trim();
      if (r.conditionType === 'contains') return k.includes(cond) || cond.includes(k);
      if (r.conditionType === 'equals') return k === cond;
      if (r.conditionType === 'starts_with') return k.startsWith(cond) || cond.startsWith(k);
      return false;
    });
    if (alreadyHasRule) continue;

    const isDebit = entry.debitCount >= entry.creditCount;

    // Extract entity name from the raw sample — skip if no identifiable entity
    const sanitized = sanitizeDescription(entry.sample, entityConfig);
    const entityName = extractName(sanitized, entityConfig);
    if (!entityName) continue;

    // Look up entity context
    const context = await findContext(companyId, entry.sample);
    let suggested: { name: string; code: string; id: string } | null = null;
    let hasContext = false;
    let contextRole = '';

    if (context && context.glAccount) {
      suggested = {
        name: context.glAccount.name,
        code: context.glAccount.code,
        id: context.glAccount.id,
      };
      hasContext = true;
      contextRole = context.role;
    } else {
      suggested = suggestAccount(entry.sample, isDebit);
    }

    patterns.push({
      id: Buffer.from(key).toString('base64').replace(/=/g, ''),
      description: entityName,
      rawDescription: entry.sample,
      occurrences: entry.count,
      direction: isDebit ? 'debit' : 'credit',
      averageAmount: entry.totalAmount / entry.count,
      suggestedAccount: suggested ? suggested.name : '',
      suggestedAccountCode: suggested ? suggested.code : '',
      suggestedAccountId: suggested ? suggested.id : '',
      hasContext,
      contextRole,
    });
  }

  // Sort by most frequent first
  patterns.sort((a, b) => b.occurrences - a.occurrences);

  return NextResponse.json({ patterns });
});
