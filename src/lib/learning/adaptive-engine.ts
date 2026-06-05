import {
  readFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  writeFileSync,
  readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { sanitizeDescriptionForAdaptive as sanitizeDescription } from '@/lib/services/pattern-normalizer';

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

  // Rotate log if it exceeds 5MB
  if (existsSync(logPath)) {
    try {
      const stats = statSync(logPath);
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (stats.size > maxSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = dirname(logPath);
        const archivePath = join(dir, `learning-events-archive-${timestamp}.jsonl`);
        renameSync(logPath, archivePath);
        // Create new empty active log
        writeFileSync(logPath, '', 'utf-8');
      }
    } catch (err) {
      // Ignore rotation errors to avoid failing the record
    }
  }

  appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf-8');
}

export function generateCandidateRules(companyId: string) {
  const configPath = join(process.cwd(), 'rules/learning-engine.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const logPath = join(process.cwd(), config.feedbackLogPath);

  const allEvents: FeedbackEvent[] = [];

  // Read active log
  if (existsSync(logPath)) {
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        allEvents.push(JSON.parse(line));
      } catch (e) {
        // Ignore parse error on single line
      }
    }
  }

  // Scan and read rotated archives in the last 30 days
  const logDir = dirname(logPath);
  if (existsSync(logDir)) {
    try {
      const files = readdirSync(logDir);
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (file.startsWith('learning-events-archive-') && file.endsWith('.jsonl')) {
          const filePath = join(logDir, file);
          try {
            const stats = statSync(filePath);
            const createdTime =
              stats.birthtimeMs ||
              stats.birthtime?.getTime() ||
              stats.mtimeMs ||
              stats.mtime?.getTime() ||
              Date.now();
            if (createdTime >= thirtyDaysAgo) {
              const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
              for (const line of lines) {
                try {
                  allEvents.push(JSON.parse(line));
                } catch (e) {
                  // Ignore parse error
                }
              }
            }
          } catch (err) {
            // Ignore stats/read issues
          }
        }
      }
    } catch (err) {
      // Ignore readdir issues
    }
  }

  const companyEvents = allEvents.filter((e) => e.companyId === companyId);

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
