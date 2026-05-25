import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { apiKey } = await request.json();
    if (!apiKey) {
      return NextResponse.json({ error: 'La clave no puede estar vacía' }, { status: 400 });
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });

    if (res.ok) {
      return NextResponse.json({ success: true });
    }

    const errorData = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: errorData.error?.message || 'Clave rechazada por OpenRouter' },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json({ error: 'No se pudo contactar al servidor de IA' }, { status: 500 });
  }
}
