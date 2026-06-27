import { NextRequest, NextResponse } from 'next/server';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCurrentUserId } from '@/lib/context-storage';
import { getAiConfig, setAiConfig } from '@/lib/ai-config';
import { db } from '@/lib/db';

async function requireAdminRole(userId: string): Promise<NextResponse | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || !['company_admin', 'super_admin'].includes(user.role)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  return null;
}

export const GET = apiHandler(
  async (request: NextRequest, context: RouteContext) => {
    const userId = requireCurrentUserId();
    const denied = await requireAdminRole(userId);
    if (denied) return denied;

    try {
      const config = await getAiConfig();
      const maskedKey =
        config.apiKey.length > 8
          ? config.apiKey.slice(0, 4) + '...' + config.apiKey.slice(-4)
          : '...';
      return NextResponse.json({ isSaved: true, apiKey: maskedKey, model: config.model });
    } catch {
      return NextResponse.json({ isSaved: false });
    }
  },
  { requireMembership: false },
);

export const POST = apiHandler(
  async (request: NextRequest, context: RouteContext) => {
    const userId = requireCurrentUserId();
    const denied = await requireAdminRole(userId);
    if (denied) return denied;

    try {
      const { apiKey, model } = await request.json();
      if (!apiKey) {
        return NextResponse.json({ error: 'La clave no puede estar vacía' }, { status: 400 });
      }

      // Persist to DB — encrypts internally via setAiConfig
      await setAiConfig({ apiKey, model });

      // Also mutate process.env for immediate in-process effect
      process.env.AI_API_KEY = apiKey;
      process.env.AI_MODEL = model || process.env.AI_MODEL;

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Error saving AI configuration:', error);
      return NextResponse.json(
        { error: 'Fallo al guardar la configuración' },
        { status: 500 },
      );
    }
  },
  { requireMembership: false },
);
