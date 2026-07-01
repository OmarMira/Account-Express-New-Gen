import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCompanyContext } from '@/lib/context-storage';
import { loadConfig, clusterByBehavior } from '@/lib/services/entity-detector';
import { logger } from '@/lib/logger';
import { toNum } from '@/lib/utils/decimal';
import { analyzeEntityHistoryForCompany } from '@/lib/services/entity-history-analyzer';
import { classifyEntityFromHistory } from '@/lib/services/smart-entity-classifier';

// ─── GET /api/learning/smart-classify ─────────────────────────────────
// Returns enriched suggestions (role, confidence, reviewQuestion, etc.)
// from the smart-entity-classifier for new and migrated pending entities.
export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('companyId') || requireCompanyContext().companyId;

  if (!companyId) {
    return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
  }

  try {
    // Fetch unclassified, unreconciled bank transactions for this company
    const transactions = await db.bankTransaction.findMany({
      where: {
        statement: {
          bankAccount: {
            companyId,
          },
        },
        isReconciled: false,
        glAccountId: null,
      },
      select: {
        description: true,
        amount: true,
        date: true,
      },
    });

    // Convert Prisma models to the raw format expected by clusterByBehavior
    const rawTransactions = transactions.map((t) => ({
      description: t.description,
      amount: toNum(t.amount),
      date: t.date.toISOString(),
    }));

    const config = loadConfig();
    const candidates = clusterByBehavior(rawTransactions, config);

    if (candidates.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Enrich each candidate with smart classification suggestions
    const enrichedCandidates = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const history = await analyzeEntityHistoryForCompany({
            companyId,
            entityKey: candidate.canonicalName.toLowerCase(),
            canonicalName: candidate.canonicalName,
          });

          const suggestion = classifyEntityFromHistory({ history });

          return {
            ...candidate,
            suggestedRole: suggestion.suggestedRole,
            suggestedIntent: suggestion.suggestedIntent,
            confidence: suggestion.confidence,
            confidenceLabel: suggestion.confidenceLabel,
            requiresConfirmation: suggestion.requiresConfirmation,
            reviewQuestion: suggestion.reviewQuestion,
            explanation: suggestion.explanation,
            lifecycle: suggestion.lifecycle,
            confirmedClassificationProtected: suggestion.confirmedClassificationProtected,
            updateSuggestion: suggestion.updateSuggestion,
          };
        } catch (enrichError: unknown) {
          const msg = enrichError instanceof Error ? enrichError.message : 'Enrichment failed';
          logger.warn('SMART_CLASSIFY_ENRICH_ERROR', { entity: candidate.canonicalName, error: msg });
          // Return candidate without enrichment on error — does not fail the whole request
          return candidate;
        }
      }),
    );

    return NextResponse.json({ data: enrichedCandidates });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    logger.error('SMART_CLASSIFY_ERROR', { error: msg });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
