import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function getThreshold(): number {
  try {
    const configPath = join(process.cwd(), 'rules/import-config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return config.accountHolderValidation?.threshold ?? 0.85;
    }
  } catch (err) {
    // ignore
  }
  return 0.85;
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinSimilarity(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return lenB === 0 ? 1 : 0;
  const dp = Array.from({ length: lenA + 1 }, (_, i) =>
    Array.from({ length: lenB + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[lenA][lenB] / Math.max(lenA, lenB);
}

export function isStrictModeEnabled(): boolean {
  try {
    const configPath = join(process.cwd(), 'rules/import-config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return config.accountHolderValidation?.strictMode ?? false;
    }
  } catch (err) {
    // ignore
  }
  return false;
}

export function validateAccountHolder(
  pdfHolder: string,
  companyLegalName: string,
): {
  matches: boolean;
  score: number;
  requiresApproval: boolean;
} {
  if (!pdfHolder || !companyLegalName) {
    return { matches: false, score: 0, requiresApproval: true };
  }

  const normPdf = normalize(pdfHolder);
  const normCompany = normalize(companyLegalName);
  const score = levenshteinSimilarity(normPdf, normCompany);
  const threshold = getThreshold();

  return {
    matches: score >= threshold,
    score,
    requiresApproval: score < threshold,
  };
}
