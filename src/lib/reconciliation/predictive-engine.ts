import { db } from '@/lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';

// Levenshtein distance optimizado (cero deps)
function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]) + 1;
  return dp[m][n];
}

export type PredictiveSuggestion = {
  bankTxId: string;
  journalEntryId: string;
  confidence: number;
  reason: string;
};

export async function generateSuggestions(
  companyId: string,
  bankAccountId: string,
): Promise<PredictiveSuggestion[]> {
  const configPath = join(process.cwd(), 'rules/predictive-recon.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const { weights, dateWindowDays, confidenceThreshold, maxSuggestionsPerTx } = config;

  // 1. Transacciones bancarias no conciliadas
  const unreconciled = await db.bankTransaction.findMany({
    where: { statement: { bankAccountId }, isReconciled: false },
    orderBy: { date: 'asc' },
  });

  if (unreconciled.length === 0) return [];

  // 2. Asientos posteados en ventana temporal ampliada
  const allDates = unreconciled.map((t) => t.date);
  const minDate = new Date(
    Math.min(...allDates.map((d) => d.getTime())) - dateWindowDays * 86400000,
  );
  const maxDate = new Date(
    Math.max(...allDates.map((d) => d.getTime())) + dateWindowDays * 86400000,
  );

  const candidates = await db.journalEntry.findMany({
    where: {
      companyId,
      status: 'posted',
      date: { gte: minDate, lte: maxDate },
    },
    include: { lines: { include: { glAccount: true } } },
  });

  const suggestions: PredictiveSuggestion[] = [];

  for (const tx of unreconciled) {
    let txSuggestions: { entryId: string; score: number; reasons: string[] }[] = [];

    for (const entry of candidates) {
      // a) Score Monto (1.0 si exacto, decae linealmente hasta 5%)
      const entryAmount = (entry.lines[0]?.debit ?? 0) - (entry.lines[0]?.credit ?? 0);
      const amountMatch =
        1 - Math.min(1, Math.abs(tx.amount - entryAmount) / Math.max(0.01, Math.abs(tx.amount)));
      const amountScore = amountMatch < 0.95 ? 0 : amountMatch; // Umbral mínimo de monto

      // b) Score Fecha (1.0 si mismo día, 0 si fuera de ventana)
      const dayDiff = Math.abs(tx.date.getTime() - entry.date.getTime()) / 86400000;
      const dateScore = Math.max(0, 1 - dayDiff / dateWindowDays);

      // c) Score Descripción (Levenshtein simplificado)
      const desc1 = (tx.description || '').toLowerCase();
      const desc2 = (entry.description || '').toLowerCase();
      const maxLen = Math.max(desc1.length, desc2.length);
      const textScore = maxLen === 0 ? 1 : 1 - levenshtein(desc1, desc2) / maxLen;

      // d) Score Histórico
      const historyScore = 0.5;

      const totalScore =
        weights.amount * amountScore +
        weights.date * dateScore +
        weights.description * textScore +
        weights.historicalFrequency * historyScore;

      if (totalScore >= confidenceThreshold) {
        txSuggestions.push({
          entryId: entry.id,
          score: totalScore,
          reasons: [
            amountScore > 0.9 ? 'monto_exacto' : '',
            dateScore > 0.8 ? 'fecha_cercana' : '',
            textScore > 0.7 ? 'descripcion_similar' : '',
          ].filter(Boolean),
        });
      }
    }

    // Top N por transacción
    txSuggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSuggestionsPerTx)
      .forEach((s) =>
        suggestions.push({
          bankTxId: tx.id,
          journalEntryId: s.entryId,
          confidence: s.score,
          reason: s.reasons.join(', '),
        }),
      );
  }

  return suggestions;
}
