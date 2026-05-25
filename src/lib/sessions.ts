import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

/**
 * DB-backed session store using SQLite via Prisma.
 */

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  // Sessions expire after 7 days
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Run cleanup of expired sessions to keep the DB small
  await db.session
    .deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    })
    .catch((err) => console.error('[SESSION CLEANUP ERROR]', err));

  await db.session.create({
    data: {
      token,
      userId,
      expiresAt,
    },
  });

  return token;
}

export async function getSessionUserId(request: NextRequest): Promise<string | null> {
  const token = getSessionToken(request);
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
  });

  if (!session) return null;

  // Check if expired
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { token } }).catch(() => {});
    return null;
  }

  return session.userId;
}

export async function destroySession(token: string): Promise<void> {
  await db.session.delete({ where: { token } }).catch(() => {});
}

export function getSessionToken(request: NextRequest): string | null {
  return (
    request.cookies.get('session')?.value ??
    request.headers.get('authorization')?.replace('Bearer ', '') ??
    null
  );
}
