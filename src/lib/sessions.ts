import { NextRequest } from 'next/server';

/**
 * Shared in-memory session store.
 * We use globalThis to persist sessions across hot-reloads in development.
 */
const globalForSessions = globalThis as unknown as {
  sessions: Map<string, { userId: string; createdAt: number }> | undefined;
};

const sessions = globalForSessions.sessions ?? new Map<string, { userId: string; createdAt: number }>();

if (process.env.NODE_ENV !== 'production') {
  globalForSessions.sessions = sessions;
}

export { sessions as sessionStore };

export function createSession(userId: string): string {
  const token = crypto.randomUUID();
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

export function getSessionUserId(request: NextRequest): string | null {
  const token =
    request.cookies.get('session')?.value ??
    request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  // Sessions expire after 7 days
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return null;
  }
  return session.userId;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

export function getSessionToken(request: NextRequest): string | null {
  return (
    request.cookies.get('session')?.value ??
    request.headers.get('authorization')?.replace('Bearer ', '') ??
    null
  );
}
