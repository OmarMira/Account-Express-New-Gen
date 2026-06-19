import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, createTestCompany, createTestCompanyMember, clearDatabase } from '../helpers/factories';
import { createSession } from '@/lib/sessions';

// ─── Helper ─────────────────────────────────────────────────────
async function makeRequest(
  body: unknown,
  token: string,
): Promise<NextRequest> {
  return new NextRequest('http://localhost/api/learning/suggest-role', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/learning/suggest-role — prompt construction', () => {
  let token: string;

  beforeAll(async () => {
    await clearDatabase();
    const user = await createTestUser('suggest-role-unit@example.com');
    const company = await createTestCompany('Suggest Role Unit Co');
    await createTestCompanyMember(user.id, company.id);
    token = await createSession(user.id);

    process.env.AI_API_KEY = 'test-key';
    process.env.AI_BASE_URL = 'https://api.test.openrouter.ai/v1';
    process.env.AI_MODEL = 'test-model';
  });

  afterAll(async () => {
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
    vi.restoreAllMocks();
    await clearDatabase();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('includes direction labels with percentages when directionProfile is provided', async () => {
    const { POST } = await import('@/app/api/learning/suggest-role/route');

    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            role: 'proveedor',
            confidence: 0.92,
            explanation: 'Parece un proveedor de servicios',
          }),
        },
      }],
    };

    let capturedBody: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: string, opts?: RequestInit) => {
      capturedBody = typeof opts?.body === 'string' ? opts.body : null;
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const req = await makeRequest({
      description: 'Paga servicios mensuales',
      directionProfile: { creditPct: 0, debitPct: 1 },
      sampleDescriptions: ['Pago de servicios', 'Servicio mensual', 'Pago recurrente'],
    }, token);

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!);
    const userPrompt: string = parsed.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content || '';

    expect(userPrompt).toContain('money OUT');
    expect(userPrompt).toContain('money IN');
    expect(userPrompt).toContain('This entity has');
    expect(userPrompt).toContain('100% debit');
    expect(userPrompt).toContain('0% credit');
  });

  it('includes up to 3 sample descriptions in the prompt', async () => {
    const { POST } = await import('@/app/api/learning/suggest-role/route');

    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            role: 'proveedor',
            confidence: 0.9,
            explanation: 'Servicios',
          }),
        },
      }],
    };

    let capturedBody: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: string, opts?: RequestInit) => {
      capturedBody = typeof opts?.body === 'string' ? opts.body : null;
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const req = await makeRequest({
      description: 'Paga servicios',
      directionProfile: { creditPct: 0, debitPct: 1 },
      sampleDescriptions: [
        'Pago de servicios mensuales',
        'Servicio eléctrico',
        'Agua potable',
        'Teléfono',
        'Internet',
      ],
    }, token);

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    const parsed = JSON.parse(capturedBody!);
    const userPrompt: string = parsed.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content || '';

    expect(userPrompt).toContain('Pago de servicios mensuales');
    expect(userPrompt).toContain('Servicio eléctrico');
    expect(userPrompt).toContain('Agua potable');
  });

  it('includes entity name and transaction count in prompt', async () => {
    const { POST } = await import('@/app/api/learning/suggest-role/route');

    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            role: 'proveedor',
            confidence: 0.85,
            explanation: 'test',
          }),
        },
      }],
    };

    let capturedBody: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: string, opts?: RequestInit) => {
      capturedBody = typeof opts?.body === 'string' ? opts.body : null;
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const req = await makeRequest({
      description: 'Servicios generales',
      directionProfile: { creditPct: 0, debitPct: 1 },
      sampleDescriptions: ['Pago de servicios'],
    }, token);

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    const parsed = JSON.parse(capturedBody!);
    const userPrompt: string = parsed.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content || '';

    expect(userPrompt).toContain('Description');
    expect(userPrompt).toContain('Servicios generales');
  });

  it('works without directionProfile (backward compat)', async () => {
    const { POST } = await import('@/app/api/learning/suggest-role/route');

    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            role: 'gasto_operativo',
            confidence: 0.9,
            explanation: 'Gasto operativo',
          }),
        },
      }],
    };

    let capturedBody: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: string, opts?: RequestInit) => {
      capturedBody = typeof opts?.body === 'string' ? opts.body : null;
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const req = await makeRequest({
      description: 'Gasto mensual',
    }, token);

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestedRole).toBe('GASTO_OPERATIVO');
  });
});
