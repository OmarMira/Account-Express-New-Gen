import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';

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
}

// Helper: Lógica mejorada para priorizar TIPO DE TRANSACCIÓN sobre ROL
export function localHeuristicParse(userInput: string): { role: string; glAccountCode: string } {
  const text = userInput.toLowerCase().trim();

  // PRIORIDAD 1: Detectar TIPO DE TRANSACCIÓN (Gasto vs Ingreso) ANTES que el rol
  if (
    text.includes('gasto') ||
    text.includes('pago') ||
    text.includes('compra') ||
    text.includes('vehículo') ||
    text.includes('auto') ||
    text.includes('transporte')
  ) {
    return { role: 'GASTO_OPERATIVO', glAccountCode: '5000' }; // Expense
  }

  if (
    text.includes('ingreso') ||
    text.includes('venta') ||
    text.includes('cobro') ||
    text.includes('alquiler') ||
    text.includes('renta')
  ) {
    return { role: 'INGRESO', glAccountCode: '4010' }; // Revenue
  }

  // PRIORIDAD 2: Si no especificó tipo, buscar el ROL
  if (text.includes('inquilino') || text.includes('propiedad')) {
    return { role: 'INQUILINO', glAccountCode: '6010' }; // Rent Expense
  }

  if (
    text.includes('socio') ||
    text.includes('dueño') ||
    text.includes('capital') ||
    text.includes('extracción') ||
    text.includes('retiro')
  ) {
    return { role: 'SOCIO', glAccountCode: '3010' }; // Owner's Equity
  }

  if (text.includes('cliente')) {
    return { role: 'CLIENTE', glAccountCode: '4010' }; // Sales Revenue
  }

  if (
    text.includes('empleado') ||
    text.includes('salario') ||
    text.includes('sueldo') ||
    text.includes('nómina') ||
    text.includes('nomina')
  ) {
    return { role: 'EMPLEADO', glAccountCode: '6030' }; // Salaries
  }

  // Default fallback
  return { role: 'PROVEEDOR', glAccountCode: '6070' };
}

export async function parseConversationalContext(
  companyId: string,
  pattern: string,
  userInput: string,
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
  else if (glAccountCode === '3010') glAccountName = 'Capital Social / Aportes de Socios';
  else if (glAccountCode === '4010') glAccountName = 'Ingresos por Servicios / Ventas';
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
      console.warn('[DB GL ACCOUNT QUERY FAIL]', dbErr);
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
  };
}
