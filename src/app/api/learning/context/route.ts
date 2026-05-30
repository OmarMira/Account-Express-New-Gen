import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/sessions';
import { findContext, saveContext } from '@/lib/services/entity-context-service';

// ─── GET /api/learning/context ──────────────────────────────────────
// Retrieve the entity context for a description.
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('companyId');
  const description = searchParams.get('description') || searchParams.get('pattern');

  if (!companyId || !description) {
    return NextResponse.json({ error: 'companyId and description are required' }, { status: 400 });
  }

  // Verify access
  const membership = await db.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const context = await findContext(companyId, description);
    return NextResponse.json({ data: context });
  } catch (error) {
    console.error('[GET ENTITY CONTEXT ERROR]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST /api/learning/context ─────────────────────────────────────
// Save or update an entity context.
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { companyId, pattern, role, glAccountId } = body;

    if (!companyId || !pattern || !role) {
      return NextResponse.json(
        { error: 'companyId, pattern, and role are required' },
        { status: 400 },
      );
    }

    // Verify access
    const membership = await db.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If glAccountId is provided, verify it exists and is active
    if (glAccountId) {
      const glAccount = await db.glAccount.findFirst({
        where: { id: glAccountId, companyId, isActive: true },
      });
      if (!glAccount) {
        return NextResponse.json({ error: 'GL Account not found or inactive' }, { status: 400 });
      }
    }

    const context = await saveContext({
      companyId,
      pattern,
      role,
      glAccountId: glAccountId || null,
      source: 'user',
      userId,
    });

    return NextResponse.json({ success: true, data: context });
  } catch (error: any) {
    console.error('[POST ENTITY CONTEXT ERROR]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
