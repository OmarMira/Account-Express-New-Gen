import { NextRequest, NextResponse } from 'next/server';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { ENTITY_ROLES } from '@/lib/constants/entity-roles';
import type { EntityRole } from '@/lib/constants/entity-roles';
import { checkPromptInjection } from '@/lib/guardrails';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { roleIsValidForDirection } from '@/lib/services/direction-filter';
import { searchEntity } from '@/lib/services/web-search-service';
import { analyzeEntityHistoryForCompany, analyzeEntityHistory } from '@/lib/services/entity-history-analyzer';
import { buildSmartClassificationPrompt, classifyEntityFromHistory } from '@/lib/services/smart-entity-classifier';

// ── POST /api/learning/suggest-role ──────────────────────────────────
// Hybrid suggest: searches local EntityContext first, falls back to smart
// classifier AI (delegates to buildSmartClassificationPrompt — no prompt
// logic duplicated here).
export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const body = await request.json();
    const { description, companyId, directionProfile, sampleDescriptions, totalAmount, occurrences } = body as {
      description?: string;
      companyId?: string;
      directionProfile?: { creditPct: number; debitPct: number };
      sampleDescriptions?: string[];
      totalAmount?: { min: number; max: number };
      occurrences?: number;
    };

    // Validate input: description is required, min 3 chars
    if (!description || typeof description !== 'string' || description.trim().length < 3) {
      return NextResponse.json(
        { error: 'Description is required (min 3 characters)' },
        { status: 400 },
      );
    }

    const trimmedDesc = description.trim();

    // ── Phase 1: local DB search (if companyId provided) ──────────────
    if (companyId) {
      const localMatch = await findLocalMatch(trimmedDesc, companyId);
      if (localMatch) {
        logger.info('[SUGGEST_ROLE LOCAL_MATCH]', {
          description: trimmedDesc,
          match: localMatch,
        });
        return NextResponse.json(localMatch);
      }
    }

    // ── Phase 2: Smart classifier AI fallback ─────────────────────────

    // Prompt injection guardrails
    const injectionCheck = checkPromptInjection(trimmedDesc);
    if (!injectionCheck.passed) {
      logger.warn('SUGGEST_ROLE_PROMPT_INJECTION_BLOCKED', { reason: injectionCheck.reason });
      return NextResponse.json(
        { error: 'Disallowed content detected in input.' },
        { status: 400 },
      );
    }

    // Read AI configuration from env vars
    const apiKey = process.env.AI_API_KEY;
    const baseUrl = process.env.AI_BASE_URL;
    const model = process.env.AI_MODEL;

    if (!apiKey || !baseUrl || !model) {
      logger.error('SUGGEST_ROLE_MISSING_AI_CONFIG');
      return NextResponse.json(
        { error: 'AI configuration not available' },
        { status: 502 },
      );
    }

    // Build entity history summary (from DB if companyId available, else synthetic)
    // Delegate prompt construction to smart-entity-classifier (no duplicate logic here)
    let historySummary;
    if (companyId) {
      historySummary = await analyzeEntityHistoryForCompany({
        companyId,
        entityKey: trimmedDesc.toLowerCase(),
        canonicalName: trimmedDesc,
      });
    } else {
      // Build a minimal cold-start summary from the request body when no companyId
      const creditPct = directionProfile?.creditPct ?? 0.5;
      const debitPct = directionProfile?.debitPct ?? 0.5;
      const dominant =
        creditPct >= 0.8 ? 'credit' : debitPct >= 0.8 ? 'debit' : 'mixed';
      const hasOccurrences = typeof occurrences === 'number' && occurrences > 0;
      const hasSamples = Array.isArray(sampleDescriptions) && sampleDescriptions.length > 0;
      historySummary = analyzeEntityHistory({
        entityKey: trimmedDesc.toLowerCase(),
        canonicalName: trimmedDesc,
        transactions:
          hasOccurrences || hasSamples
            ? Array.from({ length: hasOccurrences ? occurrences! : sampleDescriptions!.length }).map((_, i) => ({
                description: sampleDescriptions?.[i] ?? trimmedDesc,
                amount: totalAmount
                  ? -(totalAmount.min + totalAmount.max) / 2
                  : -100,
                date: new Date(
                  Date.now() - i * 30 * 86400 * 1000,
                ).toISOString(),
              }))
            : [
                {
                  description: trimmedDesc,
                  amount: creditPct >= 0.5 ? 100 : -100,
                  date: new Date().toISOString(),
                },
              ],
        priorContext: null,
      });
    }

    // Filter roles by direction profile (if provided in request)
    let candidateRoles: string[] = [...ENTITY_ROLES];
    if (directionProfile) {
      candidateRoles = ENTITY_ROLES.filter((role) => {
        const result = roleIsValidForDirection(role, directionProfile);
        return result.valid;
      });
    }

    // Build prompt via smart classifier — single source of truth for prompt construction
    const companyName = companyId ? 'Your company' : 'Unknown company';
    const { system: systemPrompt, user: userPrompt } = buildSmartClassificationPrompt({
      tenant: { companyName },
      history: {
        ...historySummary,
        // Override allowed roles from direction filter if applicable
      },
    });

    let aiResult: { role: string; confidence: number; explanation: string } | null = null;
    let lastError: string | null = null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 300,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`AI API returned status ${response.status}`);
      }

      const resData = await response.json();
      const content: string | undefined = resData.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('AI response missing content');
      }

      aiResult = parseSuggestion(content, candidateRoles);

      if (!aiResult) {
        logger.warn('[SUGGEST_ROLE PARSE_FAILED]', {
          preview: content.substring(0, 300),
          length: content.length,
        });
        throw new Error('Could not extract role from AI response');
      }

      // ── Phase 3: Web search fallback for low-confidence results ──
      if (aiResult.confidence < 0.80 && process.env.WEB_SEARCH_ENABLED === 'true') {
        const webResult = await searchEntity(trimmedDesc);

        if (webResult) {
          logger.info('[SUGGEST_ROLE WEB_SEARCH_REPROMPT]', {
            entity: trimmedDesc,
            title: webResult.title,
          });

          const rePrompt = `Web search result for "${trimmedDesc}":
Title: ${webResult.title}
Snippet: ${webResult.snippet}
Source: ${webResult.sourceUrl}

Based on this additional context, re-evaluate the role.`;

          const rePromptMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
            { role: 'user', content: rePrompt },
          ];

          const reController = new AbortController();
          const reTimeout = setTimeout(() => reController.abort(), 10000);

          try {
            const reResponse = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
              },
              body: JSON.stringify({
                model,
                temperature: 0.1,
                max_tokens: 300,
                messages: rePromptMessages,
              }),
              signal: reController.signal,
            });

            clearTimeout(reTimeout);

            if (reResponse.ok) {
              const reData = await reResponse.json();
              const reContent: string | undefined = reData.choices?.[0]?.message?.content;

              if (reContent) {
                const reResult = parseSuggestion(reContent, candidateRoles);

                if (reResult && reResult.confidence > aiResult.confidence) {
                  const previousConfidence = aiResult.confidence;
                  const originalReConfidence = reResult.confidence;

                  // Cap web-search-driven confidence at 0.70
                  reResult.confidence = Math.min(reResult.confidence, 0.70);

                  aiResult = reResult;

                  logger.info('[SUGGEST_ROLE WEB_SEARCH_IMPROVED]', {
                    entity: trimmedDesc,
                    previousConfidence,
                    newRole: reResult.role,
                    capApplied: originalReConfidence > 0.70,
                  });
                }
              }
            }
          } catch {
            logger.warn('[SUGGEST_ROLE WEB_SEARCH_REPROMPT_FAILED]', {
              entity: trimmedDesc,
            });
          } finally {
            clearTimeout(reTimeout);
          }
        }
      }
    } catch (err: unknown) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err.message : String(err);

      logger.warn('[SUGGEST_ROLE FAILED]', { error: lastError, model });
    }

    if (!aiResult) {
      // Last resort: try local fallback even without explicit companyId
      if (companyId) {
        const fallback = await findLocalMatch(trimmedDesc, companyId);
        if (fallback) {
          logger.info('[SUGGEST_ROLE AI_FAILED_LOCAL_FALLBACK]', {
            description: trimmedDesc,
            fallback,
          });
          return NextResponse.json(fallback);
        }
      }
      return NextResponse.json(
        { error: 'AI service failed to provide a suggestion' },
        { status: 502 },
      );
    }

    // Validate the returned role is a canonical ENTITY_ROLES value
    if (!ENTITY_ROLES.includes(aiResult.role as EntityRole)) {
      logger.warn('[SUGGEST_ROLE INVALID_ROLE]', { role: aiResult.role });
      return NextResponse.json(
        { error: 'AI returned an invalid role' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      suggestedRole: aiResult.role,
      confidence: aiResult.confidence,
      explanation: aiResult.explanation,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[SUGGEST_ROLE ERROR]', { error: msg });
    return NextResponse.json(
      { error: 'Failed to process suggestion request' },
      { status: 500 },
    );
  }
}, { requireMembership: false });

/**
 * Two-pass parser for AI suggestion responses.
 *
 * Pass 1 — JSON.parse: works when the model returns clean JSON.
 * Pass 2 — regex extraction: salvages truncated or malformed JSON
 *            by scanning for role, confidence, and explanation fields.
 *
 * Returns null if neither pass can extract the required fields.
 * Only returns roles that are in the candidateRoles list.
 */
function parseSuggestion(
  content: string,
  candidateRoles: string[],
): { role: string; confidence: number; explanation: string } | null {
  const allowedRoles = new Set(candidateRoles.map((r) => r.toUpperCase()));

  // ── Pass 1: strict JSON ──────────────────────────────────────────
  try {
    const parsed = JSON.parse(content);
    const role = parsed.role ?? parsed.suggestedRole ?? null;
    const confidence = parsed.confidence ?? null;
    const explanation = parsed.explanation ?? null;

    if (role && confidence !== null && explanation) {
      const normalizedRole = String(role).toUpperCase().trim();
      return {
        role: normalizedRole,
        confidence: Number(confidence),
        explanation: String(explanation),
      };
    }
  } catch {
    // Malformed JSON — fall through to regex pass
  }

  // ── Pass 2: regex extraction for truncated/malformed JSON ────────
  const roleMatch = content.match(/"role"\s*:\s*"([^"]+)"/i)
                ?? content.match(/"suggestedRole"\s*:\s*"([^"]+)"/i);
  const confidenceMatch = content.match(/"confidence"\s*:\s*([0-9]+\.?[0-9]*)/i);
  const explanationMatch = content.match(/"explanation"\s*:\s*"([^"]+)"/i);

  if (roleMatch && confidenceMatch) {
    const normalizedRole = roleMatch[1].toUpperCase().trim();
    return {
      role: normalizedRole,
      confidence: parseFloat(confidenceMatch[1]),
      explanation: explanationMatch?.[1] ?? '',
    };
  }

  return null;
}

// ── Local DB search ──────────────────────────────────────────────────
// Searches the company's existing EntityContext for a description that
// shares significant tokens with the input. Returns a match if the
// token overlap score meets the confidence threshold.
interface LocalMatchResult {
  suggestedRole: string;
  confidence: number;
  explanation: string;
}

/**
 * Tokenize a string into significant words (lowercased, length > 2).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,_\-]+/)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t));
}

/**
 * Jaccard similarity between two sets of tokens.
 * Returns 0–1 score measuring token overlap.
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = a.filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Enhanced score: max of Jaccard and containment (input-contained-in-pattern),
 * weighted toward direct token overlap. Prefers matches where significant
 * input tokens appear in the stored pattern.
 */
function scoreTokens(inputTokens: string[], patternTokens: string[]): number {
  const jaccard = jaccardSimilarity(inputTokens, patternTokens);

  // Containment: what fraction of input tokens appear in the pattern?
  const inputSet = new Set(inputTokens);
  const patternSet = new Set(patternTokens);
  const containment =
    inputTokens.length > 0
      ? inputTokens.filter((t) => patternSet.has(t)).length / inputTokens.length
      : 0;

  // Also check inverse containment (pattern fully contained in input)
  const invContainment =
    patternTokens.length > 0
      ? patternTokens.filter((t) => inputSet.has(t)).length / patternTokens.length
      : 0;

  return Math.max(jaccard, containment * 0.85, invContainment * 0.7);
}

async function findLocalMatch(
  description: string,
  companyId: string,
): Promise<LocalMatchResult | null> {
  const contexts = await db.entityContext.findMany({
    where: { companyId, role: { not: null }, classificationStatus: 'CONFIRMED' },
    select: { pattern: true, role: true },
  });

  if (contexts.length === 0) return null;

  const inputTokens = tokenize(description);
  // If description has no significant tokens, can't match
  if (inputTokens.length === 0) return null;

  let bestScore = 0;
  let bestMatch: { pattern: string; role: string } | null = null;

  for (const ctx of contexts) {
    if (!ctx.role) continue;
    const patternTokens = tokenize(ctx.pattern);
    if (patternTokens.length === 0) continue;

    // Exact match (ignoring case) → immediate return with max confidence
    if (ctx.pattern.toLowerCase() === description.toLowerCase()) {
      return {
        suggestedRole: ctx.role,
        confidence: 0.98,
        explanation: `Exact match with "${ctx.pattern}" in local context`,
      };
    }

    const score = scoreTokens(inputTokens, patternTokens);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { pattern: ctx.pattern, role: ctx.role };
    }
  }

  if (bestMatch && bestScore >= 0.45) {
    return {
      suggestedRole: bestMatch.role,
      confidence: Math.round(bestScore * 100) / 100,
      explanation: `Matched "${bestMatch.pattern}" in local context (${Math.round(bestScore * 100)}%)`,
    };
  }

  return null;
}
