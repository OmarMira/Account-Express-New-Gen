import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

export type FeedbackEvent = {
  timestamp: string;
  bankDescription: string;
  selectedGlAccountCode: string;
  confidence: number; // 0-1
  userId: string;
  companyId: string;
};

export async function recordFeedback(event: FeedbackEvent) {
  const configPath = join(process.cwd(), 'rules/learning-engine.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const logPath = join(process.cwd(), config.feedbackLogPath);

  mkdirSync(join(process.cwd(), 'rules'), { recursive: true });
  appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf-8');
}

export function generateCandidateRules(companyId: string) {
  const configPath = join(process.cwd(), 'rules/learning-engine.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const logPath = join(process.cwd(), config.feedbackLogPath);

  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  const events: FeedbackEvent[] = lines.map((l) => JSON.parse(l));
  const companyEvents = events.filter((e) => e.companyId === companyId);

  // Agrupar por cuenta GL -> descripción
  const grouped: Record<string, { descriptions: string[]; count: number }> = {};
  for (const e of companyEvents) {
    if (!grouped[e.selectedGlAccountCode])
      grouped[e.selectedGlAccountCode] = { descriptions: [], count: 0 };
    grouped[e.selectedGlAccountCode].descriptions.push(e.bankDescription);
    grouped[e.selectedGlAccountCode].count++;
  }

  const candidates = [];
  for (const [code, data] of Object.entries(grouped)) {
    if (data.count < config.minOccurrencesToGenerateRule) continue;

    // Extraer patrón común (intersección segura de palabras clave)
    const words = data.descriptions.map((d) =>
      d
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => !config.patternGeneration.ignoreStopWords.includes(w)),
    );
    const common = words[0].filter((w) => words.slice(1).every((arr) => arr.includes(w)));
    const pattern = common.slice(0, 3).join('.*'); // Ej: "zelle.*fabro"

    if (pattern.length > 0) {
      candidates.push({
        id: createHash('sha256').update(`${code}-${pattern}`).digest('hex').slice(0, 12),
        pattern: `(?i)${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, // Regex seguro
        glAccountCode: code,
        confidence: Math.min(1, data.count / (config.minOccurrencesToGenerateRule * 2)),
        occurrences: data.count,
        status: 'pending_review',
      });
    }
  }
  return candidates;
}
