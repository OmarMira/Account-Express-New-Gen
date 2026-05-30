import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';

// ─── Request schema ─────────────────────────────────────────────────
const RequestBodySchema = z.object({
  message: z.string().min(1, 'Message is required'),
  mode: z.enum(['chat', 'create-rule']).default('chat'),
  companyId: z.string().optional(),
});

// ─── AI response schema ─────────────────────────────────────────────
const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});
const AIChoiceSchema = z.object({
  message: z.object({
    role: z.string().optional(),
    content: z.string().nullable().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
  }),
});
const AIResponseSchema = z.object({
  choices: z.array(AIChoiceSchema).optional(),
});

// ─── Parsed rule schema ─────────────────────────────────────────────
const ConditionTypeSchema = z.enum([
  'contains',
  'starts_with',
  'ends_with',
  'equals',
  'amount_greater',
  'amount_less',
]);
const ParsedRuleSchema = z.object({
  name: z.string().min(1),
  conditionType: ConditionTypeSchema,
  conditionValue: z.union([z.string(), z.number()]),
  transactionDirection: z.enum(['any', 'debit', 'credit']).default('any'),
  glAccountName: z.string().default(''),
  priority: z.number().int().min(0).max(20).default(10),
});

// ─── TOOLS definition ───────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_company_summary',
      description:
        'Obtiene un resumen de la empresa actual, incluyendo nombre legal, RFC/taxId, cantidad de cuentas bancarias y cantidad total de transacciones registradas.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bank_accounts',
      description:
        'Obtiene la lista de cuentas bancarias de la empresa actual con sus detalles: nombre, banco, número de cuenta, saldo actual y moneda.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bank_rules',
      description: 'Obtiene las reglas de categorización automática de la empresa.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_gl_accounts',
      description: 'Obtiene el Plan de Cuentas (Cuentas de Mayor / GL Accounts) de la empresa.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bank_transactions',
      description:
        'Busca y filtra transacciones bancarias de la empresa actual. Permite filtrar por texto en la descripción (búsqueda parcial), rango de montos, rango de fechas y si están conciliadas.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Texto a buscar en la descripción de la transacción.',
          },
          minAmount: {
            type: 'number',
            description: 'Monto mínimo de la transacción.',
          },
          maxAmount: {
            type: 'number',
            description: 'Monto máximo de la transacción.',
          },
          startDate: {
            type: 'string',
            description: 'Fecha de inicio en formato ISO (YYYY-MM-DD).',
          },
          endDate: {
            type: 'string',
            description: 'Fecha de fin en formato ISO (YYYY-MM-DD).',
          },
          isReconciled: {
            type: 'boolean',
            description: 'Filtrar por estado de conciliación (true/false).',
          },
          limit: {
            type: 'number',
            description: 'Límite de transacciones a retornar (por defecto 50, máximo 100).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transaction_stats',
      description:
        'Calcula estadísticas acumuladas de las transacciones (total count, sumas, mínimos, máximos y promedios) para responder preguntas sobre totales generales.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

// Local execution of DB queries using Prisma
async function executeTool(name: string, args: any, companyId: string) {
  try {
    switch (name) {
      case 'get_company_summary': {
        const bankAccountCount = await db.bankAccount.count({ where: { companyId } });
        const transactionCount = await db.bankTransaction.count({
          where: { statement: { companyId } },
        });
        const ruleCount = await db.bankRule.count({ where: { companyId } });
        const glAccountCount = await db.glAccount.count({ where: { companyId } });
        const company = await db.company.findUnique({
          where: { id: companyId },
          select: { legalName: true, taxId: true, address: true, phone: true, email: true },
        });
        return {
          companyName: company?.legalName || 'Desconocida',
          taxId: company?.taxId || 'No asignado',
          totalBankAccounts: bankAccountCount,
          totalTransactions: transactionCount,
          totalRules: ruleCount,
          totalGlAccounts: glAccountCount,
        };
      }

      case 'get_bank_accounts': {
        const accounts = await db.bankAccount.findMany({
          where: { companyId, isActive: true },
          select: {
            id: true,
            accountName: true,
            bankName: true,
            accountNo: true,
            balance: true,
            currency: true,
          },
        });
        return accounts;
      }

      case 'get_bank_rules': {
        const rules = await db.bankRule.findMany({
          where: { companyId, isActive: true },
          include: {
            glAccount: {
              select: { name: true, code: true },
            },
          },
          orderBy: { priority: 'desc' },
        });
        return rules.map((r) => ({
          id: r.id,
          name: r.name,
          conditionType: r.conditionType,
          conditionValue: r.conditionValue,
          transactionDirection: r.transactionDirection,
          glAccount: r.glAccount ? `${r.glAccount.code} - ${r.glAccount.name}` : 'Ninguna',
          priority: r.priority,
        }));
      }

      case 'get_gl_accounts': {
        const glAccounts = await db.glAccount.findMany({
          where: { companyId, isActive: true },
          select: {
            id: true,
            code: true,
            name: true,
            accountType: true,
            normalBalance: true,
          },
          orderBy: { code: 'asc' },
        });
        return glAccounts;
      }

      case 'get_bank_transactions': {
        const { description, minAmount, maxAmount, startDate, endDate, isReconciled, limit } = args;
        const where: any = {
          statement: { companyId },
        };

        if (description) {
          where.description = { contains: description };
        }
        if (isReconciled !== undefined) {
          where.isReconciled = isReconciled;
        }
        if (minAmount !== undefined || maxAmount !== undefined) {
          where.amount = {};
          if (minAmount !== undefined) where.amount.gte = minAmount;
          if (maxAmount !== undefined) where.amount.lte = maxAmount;
        }
        if (startDate || endDate) {
          where.date = {};
          if (startDate) where.date.gte = new Date(startDate);
          if (endDate) where.date.lte = new Date(endDate);
        }

        const limitVal = Math.min(limit || 50, 100);

        const transactions = await db.bankTransaction.findMany({
          where,
          take: limitVal,
          orderBy: { date: 'desc' },
          select: {
            id: true,
            date: true,
            description: true,
            amount: true,
            isReconciled: true,
            reference: true,
            glAccount: {
              select: { name: true, code: true },
            },
          },
        });

        return transactions.map((t) => ({
          id: t.id,
          date: t.date.toISOString().split('T')[0],
          description: t.description,
          amount: t.amount,
          isReconciled: t.isReconciled,
          reference: t.reference,
          glAccount: t.glAccount ? `${t.glAccount.code} - ${t.glAccount.name}` : 'Sin clasificar',
        }));
      }

      case 'get_transaction_stats': {
        const totalCount = await db.bankTransaction.count({ where: { statement: { companyId } } });
        const reconciledCount = await db.bankTransaction.count({
          where: { statement: { companyId }, isReconciled: true },
        });
        const unreconciledCount = totalCount - reconciledCount;

        const aggregations = await db.bankTransaction.aggregate({
          where: { statement: { companyId } },
          _sum: {
            amount: true,
          },
          _avg: {
            amount: true,
          },
          _min: {
            amount: true,
          },
          _max: {
            amount: true,
          },
        });

        return {
          totalCount,
          reconciledCount,
          unreconciledCount,
          sumOfAmounts: aggregations._sum.amount || 0,
          averageAmount: aggregations._avg.amount || 0,
          minAmount: aggregations._min.amount || 0,
          maxAmount: aggregations._max.amount || 0,
        };
      }

      default:
        return { error: `Tool ${name} not found` };
    }
  } catch (error: any) {
    console.error(`[Error executing tool ${name}]`, error);
    return { error: error.message || 'Error executing query' };
  }
}

// ─── POST /api/ai-assistant ────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const raw: unknown = await request.json();
    const parsed = RequestBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues?.[0]?.message || 'Invalid request format' },
        { status: 400 },
      );
    }
    const { message, mode, companyId: bodyCompanyId } = parsed.data;

    let companyId = bodyCompanyId;
    if (!companyId) {
      const userId = await getSessionUserId(request);
      if (userId) {
        const membership = await db.companyMember.findFirst({
          where: { userId },
          select: { companyId: true },
        });
        if (membership) {
          companyId = membership.companyId;
        }
      }
    }

    if (mode === 'create-rule') {
      return handleCreateRule(message);
    }
    return handleChat(message, companyId);
  } catch (error) {
    console.error('[AI ASSISTANT ERROR]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Helper to call the LLM via fetch with timeout, tool definition and error handling
async function callAI(messages: { role: string; content: string }[], tools?: any[]) {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!apiKey || !baseUrl || !model) {
    throw new Error('AI configuration missing');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout for tool calling
  try {
    const body: any = { model, messages };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`AI service error ${response.status}: ${txt}`);
    }
    const data = await response.json();
    const parsed = AIResponseSchema.safeParse(data);
    if (!parsed.success) {
      console.error('[AI RESPONSE PARSE ERROR]', parsed.error);
      throw new Error('Invalid AI response format');
    }
    return parsed.data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── Chat Mode ─────────────────────────────────────────────────────
async function handleChat(message: string, companyId?: string) {
  const systemPrompt = `You are "Asistente Contable", a helpful and professional AI accounting assistant for the AccountExpress platform.

LANGUAGE RULES:
- Speak Spanish by default.
- If the user writes in English, respond in English.
- Be concise, clear, and professional.

YOUR CAPABILITIES:
- Answer accounting questions (GAAP, IFRS, tax, financial statements)
- Help classify transactions into correct chart of accounts
- Provide financial analysis guidance
- Suggest journal entry structures
- Explain reconciliation procedures
- Help with bank rule creation guidance
- Explain accounting concepts in simple terms
- Answer real-time specific questions about the company's accounts, rules, and bank transactions using the available tools.

ASSISTANT ACTIONS:
- Cuando sugieras crear una cuenta de banco específica en el Plan de Cuentas (por ejemplo, como subcuenta de Cash & Cash Equivalents 1010), al final de tu respuesta de sugerencia debes agregar de manera exacta e invariable la etiqueta: [Te ayudo a crearla](action:create-account)
- No agregues explicaciones adicionales después de esa etiqueta.

DATABASE ACCESS GUIDELINES:
- When the user asks about system-specific counts, balances, rules, accounts, or transactions, ALWAYS call the appropriate tool.
- Do NOT guess or hallucinate any numbers; use the tools to get exact and true information.
- Format all numeric values (currency balances, transaction counts) clearly and beautifully (e.g. $1,250.00).
- If no companyId or active company is linked, explain that you need a selected company to view details.

YOUR STYLE:
- Friendly but professional
- Use accounting terminology correctly
- Provide actionable advice
- When unsure, suggest consulting their CPA or tax advisor
- Format responses with clear structure when needed (bullet points, numbered lists)
- Keep responses concise but thorough.`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ];

  for (let i = 0; i < 5; i++) {
    const response = await callAI(messages, TOOLS);
    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No choice in AI response');
    }

    const aiMessage = choice.message;
    messages.push(aiMessage);

    if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      if (!companyId) {
        return NextResponse.json({
          reply:
            'Lo siento, para consultar los datos del sistema necesitas tener una empresa activa seleccionada.',
        });
      }

      for (const toolCall of aiMessage.tool_calls) {
        let args = {};
        try {
          args =
            typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
        } catch (e) {
          console.error('[Failed to parse tool arguments]', e);
        }

        const result = await executeTool(toolCall.function.name, args, companyId);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    const reply =
      aiMessage.content ?? 'Lo siento, no pude procesar tu solicitud. Intenta de nuevo.';
    return NextResponse.json({ reply });
  }

  throw new Error('Too many tool iterations');
}

// ─── Create Rule Mode ──────────────────────────────────────────────
async function handleCreateRule(message: string) {
  const systemPrompt = `You are a rule parser for the AccountExpress accounting platform. The user will describe a bank categorization rule in natural language. You must parse it into a structured JSON object.

VALID conditionType values:
- "contains" (description contains text)
- "starts_with" (description starts with text)
- "ends_with" (description ends with text)
- "equals" (description exactly matches text)
- "amount_greater" (amount is greater than value)
- "amount_less" (amount is less than value)

VALID transactionDirection values:
- "debit" (outflow/payment)
- "credit" (inflow/deposit)
- "any" (both directions)

RULES:
1. Parse the user's description to extract: name, conditionType, conditionValue, transactionDirection, glAccountName, priority
2. "priority" should be an integer from 0 to 20 (default 10 if not specified)
3. "name" should be a descriptive name for the rule
4. "conditionValue" is the text/number to match against
5. "glAccountName" is the GL account name to assign
6. Respond ONLY with a valid JSON object, no markdown, no explanation
7. If a field cannot be determined, use a reasonable default

EXAMPLE INPUT: "Contiene 'AMAZON', cuenta 'Office Supplies', prioridad 5"
EXAMPLE OUTPUT:
{"name":"AMAZON - Office Supplies","conditionType":"contains","conditionValue":"AMAZON","transactionDirection":"any","glAccountName":"Office Supplies","priority":5}

EXAMPLE INPUT: "Si el concepto comienza con 'RENTA', asignar a Rent Expense, prioridad 3"
EXAMPLE OUTPUT:
{"name":"RENTA - Rent Expense","conditionType":"starts_with","conditionValue":"RENTA","transactionDirection":"any","glAccountName":"Rent Expense","priority":3}

Respond ONLY with the JSON object.`;
  const aiData = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ]);
  const rawReply = aiData.choices?.[0]?.message?.content ?? '';
  let parsedRule: any = null;
  let reply = rawReply;
  try {
    const jsonMatch = rawReply.match(/```(?:json)?\s*([\s\S]*?)```/) ?? null;
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawReply.trim();
    const jsonUnknown = JSON.parse(jsonStr);
    const ruleResult = ParsedRuleSchema.safeParse(jsonUnknown);
    if (ruleResult.success) {
      parsedRule = ruleResult.data;
      reply = '✅ Regla analizada exitosamente. Revisa los campos y guarda la regla.';
    } else {
      reply =
        '⚠️ No se pudo interpretar completamente la regla. Por favor, verifica el formato e intenta de nuevo.\n\nFormato sugerido: \'Contiene "TEXTO", cuenta "Nombre de Cuenta", prioridad 5\'';
    }
  } catch {
    reply =
      '⚠️ Error al analizar la regla. Por favor, describe la regla con más detalle.\n\nEjemplo: \'Contiene "AMAZON", cuenta "Office Supplies", prioridad 5\'';
  }
  return NextResponse.json({
    reply,
    ...(parsedRule ? { parsedRule } : {}),
  });
}
