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
    try {
      const configPath = join(process.cwd(), 'rules/assistant-config.json');
      const assistantConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
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
      });

      if (response.ok) {
        const resData = await response.json();
        const content = resData.choices?.[0]?.message?.content;
        if (content) {
          parsed = JSON.parse(content);

          // 🔍 AUDITORÍA: Registrar respuesta cruda de IA externa
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
                timestamp: new Date().toISOString(),
              },
            }).catch((e) => console.warn('[AI AUDIT LOG FAIL]', e));
          }
        }
      }
    } catch (err) {
      console.warn('[CONVERSATIONAL PARSE AI FAIL, FALLING BACK]', err);
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

  // Buscar el nombre default por el código
  if (glAccountCode === '5000') glAccountName = 'Gastos Operativos / Generales';
  else if (glAccountCode === '4000') glAccountName = 'Ingresos Operativos / Ventas';
  else if (glAccountCode === '4010') glAccountName = 'Ingresos por Servicios / Ventas';
  else if (glAccountCode === '4020') glAccountName = 'Ingresos por Renta / Alquiler';
  else if (glAccountCode === '2020') glAccountName = 'Tarjetas de Crédito por Pagar';
  else if (glAccountCode === '2040') glAccountName = 'Préstamos por Pagar';
  else if (glAccountCode === '3010') glAccountName = 'Capital Social / Aportes de Socios';
  else if (glAccountCode === '6030') glAccountName = 'Sueldos, Salarios y Beneficios';
  else if (glAccountCode === '6070') glAccountName = 'Gasto Proveedores y Servicios';

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
    conditions: parsed.conditions || null,
  };
}
