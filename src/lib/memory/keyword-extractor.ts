import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function extractKeywords(text: string, locale: 'es' | 'en' = 'es'): string[] {
  const configPath = join(process.cwd(), 'rules/memory-config.json');
  if (!existsSync(configPath)) return [];

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const stopWords = new Set(config.stopWords[locale] || []);

    return text
      .toLowerCase()
      .replace(/[^\w\sáéíóúñü]/gi, ' ') // Reemplazar puntuación por espacios, mantener acentos y eñes
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= (config.minKeywordLength || 3) &&
          !stopWords.has(word) &&
          !/^\d+$/.test(word), // Excluir números puros
      )
      .slice(0, config.maxKeywordsToExtract || 10);
  } catch (err) {
    console.error('[KEYWORD EXTRACTOR ERROR]', err);
    return [];
  }
}
