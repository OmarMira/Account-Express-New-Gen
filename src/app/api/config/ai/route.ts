import { NextRequest, NextResponse } from 'next/server';
import { readFile, access, writeFile } from 'fs/promises';
import path from 'path';
import { AI_CONFIG } from '@/lib/constants/ai-config';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { requireCurrentUserId } from '@/lib/context-storage';
import { decrypt, encrypt } from '@/lib/crypto';
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
      const envPath = path.join(process.cwd(), '.env');
      let envContent: string;
      try {
        envContent = await readFile(envPath, 'utf8');
      } catch {
        return NextResponse.json({ isSaved: false });
      }

      // Try encrypted key first, fall back to plaintext (legacy)
      const encryptedMatch = envContent.match(/AI_API_KEY_ENCRYPTED=(.+)/);
      if (encryptedMatch) {
        try {
          const apiKey = decrypt(encryptedMatch[1].trim());
          if (apiKey.length > 0) {
            const modelMatch = envContent.match(/AI_MODEL=(.+)/);
            const model = modelMatch ? modelMatch[1].trim() : AI_CONFIG.DEFAULT_MODEL;
            const maskedKey =
              apiKey.length > 8 ? apiKey.slice(0, 4) + '...' + apiKey.slice(-4) : '...';
            return NextResponse.json({ isSaved: true, apiKey: maskedKey, model });
          }
        } catch {
          // decryption failed, fall through
        }
      }

      const keyMatch = envContent.match(/AI_API_KEY=(.+)/);
      if (keyMatch) {
        const apiKey = keyMatch[1].trim();
        if (apiKey.length > 0 && apiKey !== 'your_api_key_here') {
          const modelMatch = envContent.match(/AI_MODEL=(.+)/);
          const model = modelMatch ? modelMatch[1].trim() : AI_CONFIG.DEFAULT_MODEL;
          const maskedKey =
            apiKey.length > 8 ? apiKey.slice(0, 4) + '...' + apiKey.slice(-4) : '...';
          return NextResponse.json({ isSaved: true, apiKey: maskedKey, model });
        }
      }
      return NextResponse.json({ isSaved: false });
    } catch (error) {
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

      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';

      try {
        await access(envPath);
        envContent = await readFile(envPath, 'utf8');
      } catch {
        /* file doesn't exist yet, envContent stays empty */
      }

      // Encrypt key before writing to disk
      const encryptedKey = encrypt(apiKey);

      // Remove old plaintext key, write encrypted
      if (envContent.includes('AI_API_KEY=')) {
        envContent = envContent.replace(/AI_API_KEY=.*/g, `AI_API_KEY_ENCRYPTED=${encryptedKey}`);
        envContent = envContent.replace(
          /AI_API_KEY_ENCRYPTED=.*/g,
          `AI_API_KEY_ENCRYPTED=${encryptedKey}`,
        );
      } else if (envContent.includes('AI_API_KEY_ENCRYPTED=')) {
        envContent = envContent.replace(
          /AI_API_KEY_ENCRYPTED=.*/g,
          `AI_API_KEY_ENCRYPTED=${encryptedKey}`,
        );
      } else {
        envContent += `\nAI_API_KEY_ENCRYPTED=${encryptedKey}\n`;
      }

      // Clean up any remaining plaintext key (migration safeguard)
      if (envContent.includes('AI_API_KEY=') && envContent.includes('AI_API_KEY_ENCRYPTED=')) {
        envContent = envContent.replace(/^AI_API_KEY=.*$/m, '');
        envContent = envContent.replace(/\n{2,}/g, '\n');
      }

      // Mutar en memoria para efecto inmediato (decrypted)
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

      await writeFile(envPath, envContent.trim() + '\n');

      return NextResponse.json({ success: true });
    } catch (error) {
      return NextResponse.json(
        { error: 'Fallo al escribir en el archivo de configuración' },
        { status: 500 },
      );
    }
  },
  { requireMembership: false },
);
