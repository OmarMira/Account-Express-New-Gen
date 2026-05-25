import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      // Verificamos si existe la variable AI_API_KEY y tiene algo asignado
      const match = envContent.match(/AI_API_KEY=(.+)/);
      if (match && match[1].trim().length > 0) {
        return NextResponse.json({ isSaved: true, apiKey: match[1].trim() });
      }
    }
    return NextResponse.json({ isSaved: false });
  } catch (error) {
    return NextResponse.json({ isSaved: false });
  }
}

export async function POST(request: Request) {
  try {
    const { apiKey } = await request.json();
    if (!apiKey) {
      return NextResponse.json({ error: 'La clave no puede estar vacía' }, { status: 400 });
    }

    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Reemplazar o agregar la key
    if (envContent.includes('AI_API_KEY=')) {
      envContent = envContent.replace(/AI_API_KEY=.*/g, `AI_API_KEY=${apiKey}`);
    } else {
      envContent += `\nAI_API_KEY=${apiKey}\n`;
    }

    // Asegurarse de tener la URL base y modelo si no existen
    if (!envContent.includes('AI_BASE_URL=')) {
      envContent += `AI_BASE_URL=https://openrouter.ai/api/v1\n`;
    }
    if (!envContent.includes('AI_MODEL=')) {
      envContent += `AI_MODEL=deepseek/deepseek-chat\n`;
    }

    fs.writeFileSync(envPath, envContent.trim() + '\n');

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Fallo al escribir en el archivo de configuración' },
      { status: 500 },
    );
  }
}
