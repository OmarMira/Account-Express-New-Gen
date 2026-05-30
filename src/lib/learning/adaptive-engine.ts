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
  amount?: number; // Optional transaction amount
};

export async function recordFeedback(event: FeedbackEvent) {
  const configPath = join(process.cwd(), 'rules/learning-engine.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const logPath = join(process.cwd(), config.feedbackLogPath);

  mkdirSync(join(process.cwd(), 'rules'), { recursive: true });
  appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf-8');
}

export function sanitizeDescription(desc: string, config: any): string {
  let cleaned = desc.toLowerCase().trim();

  // Apply configured noise sanitizers
  if (config.sanitizeNoise) {
    for (const pattern of Object.values(config.sanitizeNoise)) {
      const rx = new RegExp(pattern as string, 'gi');
      cleaned = cleaned.replace(rx, ' ');
    }
  }

  // Remove ignoreStopWords and clean spacing
  const words = cleaned.split(/\s+/).filter(Boolean);
  const filtered = words.filter((w) => !config.patternGeneration.ignoreStopWords.includes(w));

  return filtered.join(' ').trim();
}

export function generateCandidateRules(companyId: string) {
  const configPath = join(process.cwd(), 'rules/learning-engine.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const logPath = join(process.cwd(), config.feedbackLogPath);

  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  const events: FeedbackEvent[] = lines.map((l) => JSON.parse(l));
  const companyEvents = events.filter((e) => e.companyId === companyId);

  // Group by sanitized pattern
  const patternGroups: Record<string, { events: FeedbackEvent[]; count: number }> = {};

  for (const e of companyEvents) {
    const patternKey = sanitizeDescription(e.bankDescription, config);
    if (patternKey.length < 3) continue;

    if (!patternGroups[patternKey]) {
      patternGroups[patternKey] = { events: [], count: 0 };
    }
    patternGroups[patternKey].events.push(e);
    patternGroups[patternKey].count++;
  }

  const candidates: any[] = [];

  for (const [pattern, data] of Object.entries(patternGroups)) {
    if (data.count < config.minOccurrencesToGenerateRule) continue;

    // Check Account Consistency Score
    const accountCounts: Record<string, number> = {};
    let debitCount = 0;
    let creditCount = 0;

    data.events.forEach((ev) => {
      accountCounts[ev.selectedGlAccountCode] = (accountCounts[ev.selectedGlAccountCode] || 0) + 1;
      if (ev.amount !== undefined) {
        if (ev.amount < 0) debitCount++;
        else creditCount++;
      }
    });

    // Find most common account
    let bestAccount = '';
    let maxCount = 0;
    for (const [code, cnt] of Object.entries(accountCounts)) {
      if (cnt > maxCount) {
        maxCount = cnt;
        bestAccount = code;
      }
    }

    const consistencyScore = maxCount / data.count;
    const threshold = config.consistencyScoreThreshold || 0.85;

    // Discard if inconsistent
    if (consistencyScore < threshold) continue;

    // Determine direction lock
    let direction: 'debit' | 'credit' | 'any' = 'any';
    if (debitCount > 0 && creditCount === 0) {
      direction = 'debit';
    } else if (creditCount > 0 && debitCount === 0) {
      direction = 'credit';
    } else if (debitCount > 0 && creditCount > 0) {
      // Mixed signs -> discard or manual review
      continue;
    }

    // Dynamic priority: longer/more specific patterns get lower priority numbers (higher execution order)
    const priority = Math.max(1, Math.min(19, 20 - Math.floor(pattern.length / 3)));

    candidates.push({
      id: createHash('sha256').update(`${bestAccount}-${pattern}`).digest('hex').slice(0, 12),
      pattern: `(?i)${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, // Safe regex
      glAccountCode: bestAccount,
      confidence: consistencyScore,
      occurrences: data.count,
      direction,
      priority,
      status: 'pending_review',
    });
  }

  return candidates;
}
