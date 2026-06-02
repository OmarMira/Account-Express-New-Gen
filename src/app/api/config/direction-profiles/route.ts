import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'rules/direction-profiles.json');
    const profiles = JSON.parse(readFileSync(filePath, 'utf-8'));
    return NextResponse.json({ success: true, data: profiles });
  } catch (err) {
    console.error('[DIRECTION PROFILES CONFIG ERROR]', err);
    return NextResponse.json({ error: 'Direction profiles unavailable' }, { status: 500 });
  }
}
