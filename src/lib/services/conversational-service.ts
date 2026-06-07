import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';
import { safeAuditLog } from './audit-service';
import { logger } from '@/lib/logger';

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

// Helper: Lógica dinámica para parsear descriptores basada en rules/assistant-config.json
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

export async function parseConversationalContext(
  companyId: string,
  pattern: string,
  userInput: string,
  userId?: string,
): Promise<ConversationalParseResult> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;
  let parsed: any = null;

  // Intento con IA externa
  if (apiKey && baseUrl && model) {
    const modelsToTry = [model];
    if (model === 'openrouter/free') {
      modelsToTry.push('google/gemini-2.5-flash:free');
      modelsToTry.push('qwen/qwen-2.5-72b-instruct:free');
    }

    const configPath = join(process.cwd(), 'rules/assistant-config.json');
    let assistantConfig: any = {};
    try {
      assistantConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {}

    for (const currentModel of modelsToTry) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout per model

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
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
              { role: 'system', content: assistantConfig.systemInstruction },
              {
                role: 'user',
                content: `Entidad: "${pattern}"\nDescripción del usuario: "${userInput}"\nRetorna solo el objeto JSON.`,
              },
            ],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          const resData = await response.json();
          const content = resData.choices?.[0]?.message?.content;
          if (content) {
            parsed = JSON.parse(content);
            if (parsed && parsed.role && parsed.glAccountCode) {
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
                    model: currentModel, // Log model, not API key
                    timestamp: new Date().toISOString(),
                  },
                }).catch((e) => logger.warn('[AI AUDIT LOG FAIL]', { error: String(e) }));
              }
              break; // Success! Break out of the model loop
            }
          }
        }
      } catch (err: unknown) {
        clearTimeout(timeout);
        // Catch AbortError separately and provide helpful message
        if (err instanceof Error && err.name === 'AbortError') {
          logger.warn(`[CONVERSATIONAL PARSE AI TIMEOUT FOR MODEL ${currentModel}]`, {
            model: currentModel,
            timeout: '10s',
          });
        } else {
          logger.warn(`[CONVERSATIONAL PARSE AI FAIL FOR MODEL ${currentModel}]`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Fallback a lógica local si la IA falla o no devuelve datos válidos
  if (!parsed || !parsed.role || !parsed.glAccountCode) {
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
  let glAccountId: string | null = null;
  let glAccountName = 'Cuenta No Clasificada';

  // Resolver nombre desde la BD. El hardcodeo anterior (código→nombre en español) se eliminó
  // porque la query a BD siempre lo pisaba — era dead code. Los nombres auténticos están en la BD.
  if (glAccountCode) {
    try {
      const acc = await db.glAccount.findFirst({
        where: { companyId, code: glAccountCode, isActive: true },
      });
      if (acc) {
        glAccountId = acc.id;
        glAccountName = acc.name;
      }
    } catch (dbErr) {
      logger.warn('GL_ACCOUNT_QUERY_FAIL', { companyId, glAccountCode, error: String(dbErr) });
    }
  }

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
    account: {
      code: glAccountCode,
      name: glAccountName,
    },
    conditions,
  };
}
