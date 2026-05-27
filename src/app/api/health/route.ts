import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic'; // Evita caché estático

export async function GET() {
  const start = Date.now();
  let dbStatus: { connected: boolean; latency: number; error?: string } = {
    connected: false,
    latency: 0,
  };

  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = { connected: true, latency: Date.now() - start };
  } catch (e) {
    dbStatus = { connected: false, latency: 0, error: String(e) };
  }

  const status = dbStatus.connected ? 'healthy' : 'degraded';
  const httpCode = dbStatus.connected ? 200 : 503;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      database: dbStatus,
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      },
    },
    { status: httpCode },
  );
}
