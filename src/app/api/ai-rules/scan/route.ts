import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { normalizePattern } from '@/lib/services/pattern-normalizer';
import { loadConfig, sanitizeDescription, extractName } from '@/lib/services/entity-detector';
import { ROLE_ACCOUNT_MAP } from '@/lib/constants/role-account-map';
import { loadRolePriorities, entityFirstCheck } from '@/lib/services/rule-matching-engine';

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
      .replace(/\b\d[\d.,/-]*\b/g, '') // remove numbers / amounts
      .replace(/\s{2,}/g, ' ')
      .trim()
      .toLowerCase();
  }

  interface Entry {
    entityName: string;
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

    const sanitized = sanitizeDescription(tx.description ?? '', entityConfig);
    const rawName = extractName(sanitized, entityConfig);
    if (!rawName) continue; // Skip if no identifiable entity

    // Strip numbers and clean up spaces to get a clean entity name
    const entityName = rawName
      .replace(/\b\d[\d.,\/-]*\b/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (entityName.length < 2) continue; // Skip if it becomes too short after stripping numbers

    const entityKey = entityName.toLowerCase();
    const existing = map.get(entityKey);
    const isDebit = tx.amount < 0;
    if (existing) {
      existing.count++;
      existing.totalAmount += Math.abs(tx.amount);
      if (isDebit) existing.debitCount++;
      else existing.creditCount++;
    } else {
      map.set(entityKey, {
        entityName,
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

  const contexts = await db.entityContext.findMany({
    where: { companyId },
    include: { glAccount: true },
  });

  interface ScanPattern {
    id: string;
    description: string;
    rawDescription: string;
    occurrences: number;
    direction: string;
    averageAmount: number;
    suggestedAccount: string;
    suggestedAccountCode: string;
    suggestedAccountId: string;
    hasContext: boolean;
    contextRole: string;
  }

  const patterns: ScanPattern[] = [];

  for (const [entityKey, entry] of map.entries()) {
    const entityName = entry.entityName;

    // Look up entity context in memory
    const normalized = normalizePattern(entry.sample);
    const entityNameLower = entityName.toLowerCase();
    let matchingContexts = contexts.filter((ctx) =>
      normalized.includes(ctx.pattern.toLowerCase()) ||
      entityNameLower.includes(ctx.pattern.toLowerCase()) ||
      ctx.pattern.toLowerCase().includes(entityNameLower)
    );

    // Conflict detection: Merchant vs Socio
    const knownSocioPatterns = contexts
      .filter((ctx) => ctx.role.toUpperCase() === 'SOCIO')
      .map((ctx) => ctx.pattern.toLowerCase());

    if (knownSocioPatterns.length > 0) {
      const check = entityFirstCheck({ description: entry.sample, amount: 0 }, knownSocioPatterns, true);
      if (check.skipSocioRules) {
        // Exclude SOCIO contexts from matchingContexts
        matchingContexts = matchingContexts.filter((ctx) => ctx.role.toUpperCase() !== 'SOCIO');
      }
    }

    let context = null;
    if (matchingContexts.length === 1) {
      context = matchingContexts[0];
    } else if (matchingContexts.length > 1) {
      const rolePriorities = loadRolePriorities();
      const sorted = [...matchingContexts].sort((a, b) => {
        const prioA = rolePriorities[a.role.toUpperCase()] ?? 99;
        const prioB = rolePriorities[b.role.toUpperCase()] ?? 99;
        return prioA - prioB; // Higher priority (lower index value) wins
      });
      context = sorted[0];
    }

    // Smart frequency logic:
    // If a transaction matches an existing EntityContext, the minimum occurrences required is 1.
    // If it does not, the minimum occurrences required is 2.
    const requiredOccurrences = context ? 1 : 2;
    if (entry.count < requiredOccurrences) continue;

    // OPCION A ESTRICTA: Si no tiene un rol asignado, lo ignoramos para el Generador IA
    if (!context) continue;

    // Skip if an existing rule covers this pattern
    const alreadyHasRule = existingRules.some((r) => {
      const cond = r.conditionValue.toLowerCase().trim();
      const entName = entityName.toLowerCase().trim();
      const rawSample = entry.sample.toLowerCase().trim();
      
      const nameMatch = entName.includes(cond) || cond.includes(entName);
      const rawMatch = r.conditionType === 'contains'
        ? rawSample.includes(cond) || cond.includes(rawSample)
        : r.conditionType === 'equals'
        ? rawSample === cond
        : r.conditionType === 'starts_with'
        ? rawSample.startsWith(cond) || cond.startsWith(rawSample)
        : false;

      return nameMatch || rawMatch;
    });
    if (alreadyHasRule) continue;

    const isDebit = entry.debitCount >= entry.creditCount;

    let suggested: { name: string; code: string; id: string } | null = null;
    let hasContext = false;
    let contextRole = '';

    if (context) {
      hasContext = true;
      contextRole = context.role;
      if (context.glAccount) {
        suggested = {
          name: context.glAccount.name,
          code: context.glAccount.code,
          id: context.glAccount.id,
        };
      } else {
        // Resolve default GL account dynamically based on the assigned role
        const mapping = ROLE_ACCOUNT_MAP[context.role.toUpperCase()];
        if (mapping) {
          const defaultCode = isDebit ? mapping.debit : mapping.credit;
          let account = glAccounts.find((a) => a.code === defaultCode);
          if (!account && defaultCode !== mapping.fallback) {
            account = glAccounts.find((a) => a.code === mapping.fallback);
          }
          if (account) {
            suggested = {
              name: account.name,
              code: account.code,
              id: account.id,
            };
          }
        }
        if (!suggested) {
          suggested = suggestAccount(entry.sample, isDebit);
        }
      }
    } else {
      suggested = suggestAccount(entry.sample, isDebit);
    }

    patterns.push({
      id: Buffer.from(entityKey).toString('base64').replace(/=/g, ''),
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
