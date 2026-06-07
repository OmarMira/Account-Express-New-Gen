import { NextResponse } from 'next/server';
import { readJsonConfig } from '@/lib/config-loader';

export async function GET() {
  try {
    const profiles = await readJsonConfig('direction-profiles.json');
    return NextResponse.json({ success: true, data: profiles });
  } catch (err) {
    console.error('[DIRECTION PROFILES CONFIG ERROR]', err);
    return NextResponse.json({ error: 'Direction profiles unavailable' }, { status: 500 });
  }
}
