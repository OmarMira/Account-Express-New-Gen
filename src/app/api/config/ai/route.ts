import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AI_CONFIG } from '@/lib/constants/ai-config';

export async function GET() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      // Verificamos si existe la variable AI_API_KEY y tiene algo asignado que no sea el placeholder
      const keyMatch = envContent.match(/AI_API_KEY=(.+)/);
      if (keyMatch) {
        const apiKey = keyMatch[1].trim();
        if (apiKey.length > 0 && apiKey !== 'your_api_key_here') {
          const modelMatch = envContent.match(/AI_MODEL=(.+)/);
          const model = modelMatch ? modelMatch[1].trim() : AI_CONFIG.DEFAULT_MODEL;
          return NextResponse.json({ isSaved: true, apiKey, model });
        }
      }
    }
    return NextResponse.json({ isSaved: false });
  } catch (error) {
    return NextResponse.json({ isSaved: false });
  }
}

export async function POST(request: Request) {
  try {
    const { apiKey, model } = await request.json();
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

    // Mutar en memoria para efecto inmediato
    process.env.AI_API_KEY = apiKey;

    // Asegurarse de tener la URL base
    if (!envContent.includes('AI_BASE_URL=')) {
      envContent += `AI_BASE_URL=${AI_CONFIG.BASE_URL}\n`;
    }
    process.env.AI_BASE_URL = AI_CONFIG.BASE_URL;

    // Determinar el modelo a guardar
    const modelToUse = model || AI_CONFIG.DEFAULT_MODEL;

    // Reemplazar o agregar el modelo
    if (envContent.includes('AI_MODEL=')) {
      envContent = envContent.replace(/AI_MODEL=.*/g, `AI_MODEL=${modelToUse}`);
    } else {
      envContent += `AI_MODEL=${modelToUse}\n`;
    }

    // Mutar modelo en memoria
    process.env.AI_MODEL = modelToUse;

    fs.writeFileSync(envPath, envContent.trim() + '\n');

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Fallo al escribir en el archivo de configuración' },
      { status: 500 },
    );
  }
}
