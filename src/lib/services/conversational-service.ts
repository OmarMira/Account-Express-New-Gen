import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';
import { safeAuditLog } from './audit-service';
import { logger } from '@/lib/logger';
import { checkPromptInjection, addSystemDelimiter } from '@/lib/guardrails';

export interface ConversationalParseResult {
  role: string;
  glAccountCode: string;
  glAccountId: string | null;
  suggestSubAccount: boolean;
  subAccountName: string | null;
  account: {
    code: string;
    name: string;
  };
  conditions?: any[] | null;
}

// ── Internal: read assistant config from disk ──
function readAssistantConfigSync(): any {
  try {
    const configPath = join(process.cwd(), 'rules/assistant-config.json');
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

// ── Fallback: Local heuristic parse (unchanged logic, readAssistantConfigSync) ──
export function localHeuristicParse(userInput: string): { role: string; glAccountCode: string } {
  const text = userInput.toLowerCase().trim();

  let priorities: string[] = [
    'SOCIO',
    'EMPLEADO',
    'INQUILINO',
    'CLIENTE',
    'GASTO_OPERATIVO',
    'INGRESO',
  ];
  let fallback = { role: 'PROVEEDOR', glAccountCode: '6070' };
  let rules: Array<{
    role: string;
    glAccountCode: string;
    keywords: { es: string[]; en: string[] };
  }> = [];

  try {
    const configPath = join(process.cwd(), 'rules/assistant-config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.heuristics) {
      if (Array.isArray(config.heuristics.priorities)) {
        priorities = config.heuristics.priorities;
      }
      if (config.heuristics.fallback) {
        fallback = config.heuristics.fallback;
      }
      if (Array.isArray(config.heuristics.rules)) {
        rules = config.heuristics.rules;
      }
    }
  } catch (err) {
    console.warn('[CONVERSATIONAL PARSE LOAD CONFIG FAIL, FALLING BACK TO DEFAULTS]', err);
  }

  // Detectar idioma usando las palabras clave configuradas dinámicamente
  const enKeywordsList: string[] = [];
  rules.forEach((rule) => {
    if (rule.keywords && Array.isArray(rule.keywords.en)) {
      enKeywordsList.push(...rule.keywords.en);
    }
  });

  const isEnglish =
    enKeywordsList.length > 0
      ? new RegExp(
          `\\b(${enKeywordsList.map((k) => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})\\b`,
          'i',
        ).test(text)
      : false;

  // Evaluar por orden estricto de prioridad configurado
  for (const roleName of priorities) {
    const rule = rules.find((r) => r.role === roleName);
    if (!rule) continue;

    const keywords = isEnglish ? rule.keywords.en : rule.keywords.es;
    if (Array.isArray(keywords) && keywords.some((k) => text.includes(k.toLowerCase()))) {
      return { role: rule.role, glAccountCode: rule.glAccountCode };
    }
  }

  return fallback;
}

// ── Layer 1: AI Parser ──
// Pure AI interaction layer: reads config, calls external chat API via fetch,
// returns parsed result or THROWS on failure (no silent fallback).
// Accepts optional deps for DI: fetch and readAssistantConfig.
export async function parseWithAI(
  pattern: string,
  userInput: string,
  deps: {
    apiKey: string;
    baseUrl: string;
    model: string;
    fetch?: typeof globalThis.fetch;
    readAssistantConfig?: () => any;
  },
): Promise<{
  role: string;
  glAccountCode: string;
  conditions?: any[];
  suggestSubAccount: boolean;
  subAccountName: string | null;
}> {
  const { apiKey, baseUrl, model } = deps;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const getConfig = deps.readAssistantConfig ?? readAssistantConfigSync;

  if (!apiKey || !baseUrl || !model) {
    throw new Error('AI configuration missing: AI_API_KEY, AI_BASE_URL, and AI_MODEL must be set');
  }

  // Prompt injection guardrails
  const patternCheck = checkPromptInjection(pattern);
  if (!patternCheck.passed) {
    logger.warn('PROMPT_INJECTION_BLOCKED', { reason: patternCheck.reason, pattern });
    throw new Error('Contenido no permitido detectado en la entrada del usuario.');
  }

  const inputCheck = checkPromptInjection(userInput);
  if (!inputCheck.passed) {
    logger.warn('PROMPT_INJECTION_BLOCKED', { reason: inputCheck.reason, pattern });
    throw new Error('Contenido no permitido detectado en la entrada del usuario.');
  }

  // Build model fallback list (preserving existing openrouter/free behavior)
  const modelsToTry = [model];
  if (model === 'openrouter/free') {
    modelsToTry.push('google/gemini-2.5-flash:free');
    modelsToTry.push('qwen/qwen-2.5-72b-instruct:free');
  }

  const assistantConfig = getConfig();
  const systemInstruction = addSystemDelimiter(assistantConfig.systemInstruction ?? '');

  for (const currentModel of modelsToTry) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout per model

    try {
      const response = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        },
        body: JSON.stringify({
          model: currentModel,
          temperature: assistantConfig.temperature ?? 0.1,
          max_tokens: assistantConfig.maxTokens ?? 300,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: `Entidad: "${pattern}"\nDescripción del usuario: "${userInput}"\nRetorna solo el objeto JSON.`,
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`AI API returned status ${response.status}`);
      }

      const resData = await response.json();
      const content = resData.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('AI response missing content');
      }

      const parsed = JSON.parse(content);

      // Validate that we have the minimum required fields
      if (!parsed.role || !parsed.glAccountCode) {
        throw new Error('AI returned incomplete result');
      }

      // Success — return parsed data
      return {
        role: parsed.role,
        glAccountCode: parsed.glAccountCode,
        conditions: parsed.conditions,
        suggestSubAccount: Boolean(parsed.suggestSubAccount),
        subAccountName: parsed.subAccountName ? String(parsed.subAccountName) : null,
      };
    } catch (err: unknown) {
      clearTimeout(timeout);

      // If this was the last model attempt, re-throw so the facade can fallback
      if (currentModel === modelsToTry[modelsToTry.length - 1]) {
        throw err;
      }

      // Otherwise log and try the next model
      logger.warn(`[CONVERSATIONAL PARSE AI FAIL FOR MODEL ${currentModel}]`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error('All AI models failed');
}

// ── Layer 2: GL Account Resolver ──
// Pure DB resolution: queries glAccount by companyId + code.
// Returns enriched data or default fallback. Accepts optional deps for DI.
export async function resolveGLAccount(
  companyId: string,
  glAccountCode: string,
  deps?: {
    db?: typeof db;
  },
): Promise<{
  glAccountId: string | null;
  account: { code: string; name: string };
}> {
  const dbClient = deps?.db ?? db;

  if (!glAccountCode) {
    return { glAccountId: null, account: { code: '', name: 'Cuenta No Clasificada' } };
  }

  try {
    const acc = await dbClient.glAccount.findFirst({
      where: { companyId, code: glAccountCode, isActive: true },
    });

    if (acc) {
      return { glAccountId: acc.id, account: { code: acc.code, name: acc.name } };
    }

    return { glAccountId: null, account: { code: glAccountCode, name: 'Cuenta No Clasificada' } };
  } catch (dbErr) {
    logger.warn('GL_ACCOUNT_QUERY_FAIL', { companyId, glAccountCode, error: String(dbErr) });
    return { glAccountId: null, account: { code: glAccountCode, name: 'Cuenta No Clasificada' } };
  }
}

// ── Facade: parseConversationalContext ──
// Orchestrates: try AI parser → fallback to heuristics → resolve GL account from DB.
// Preserves audit logging on successful AI response.
// Accepts optional DI params (fetchFn, prismaClient) that flow to layers.
export async function parseConversationalContext(
  companyId: string,
  pattern: string,
  userInput: string,
  userId?: string,
  fetchFn?: typeof globalThis.fetch,
  prismaClient?: typeof db,
): Promise<ConversationalParseResult> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;

  let parsed: {
    role: string;
    glAccountCode: string;
    conditions?: any[];
    suggestSubAccount: boolean;
    subAccountName: string | null;
  } | null = null;

  // Intento con IA externa
  if (apiKey && baseUrl && model) {
    try {
      parsed = await parseWithAI(pattern, userInput, {
        apiKey,
        baseUrl,
        model,
        fetch: fetchFn,
      });

      // 🔍 AUDITORÍA: Registrar respuesta de IA externa (sin exponer API key)
      if (userId) {
        safeAuditLog({
          companyId,
          userId,
          action: 'AI_EXTERNAL_RESPONSE_RECEIVED',
          entity: 'EntityContext',
          details: {
            pattern,
            userInput,
            aiResponse: parsed,
            model,
            timestamp: new Date().toISOString(),
          },
        }).catch((e) => logger.warn('[AI AUDIT LOG FAIL]', { error: String(e) }));
      }
    } catch {
      // AI failed — fall through to heuristic below
    }
  }

  // Fallback a lógica local si la IA falla o no está configurada
  if (!parsed) {
    const local = localHeuristicParse(userInput);
    parsed = {
      role: local.role,
      glAccountCode: local.glAccountCode,
      suggestSubAccount: false,
      subAccountName: null,
    };
  }

  // Normalización y búsqueda en BD
  const role = String(parsed.role).toUpperCase().trim();
  const glAccountCode = String(parsed.glAccountCode).trim();

  const { glAccountId, account } = await resolveGLAccount(companyId, glAccountCode, {
    db: prismaClient,
  });

  let conditions = parsed.conditions;
  if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
    conditions = [{ field: 'description', operator: 'contains', value: pattern }];
  }

  return {
    role,
    glAccountCode,
    glAccountId,
    suggestSubAccount: Boolean(parsed.suggestSubAccount),
    subAccountName: parsed.subAccountName ? String(parsed.subAccountName) : null,
    account,
    conditions,
  };
}
