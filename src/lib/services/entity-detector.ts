import { readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import { logger } from '../logger';

// ========== INTERFACES TIPIFICADAS (V3.0 Zero-Any) ==========
export interface EntityDetectionConfig {
  sanitization: {
    stripPatterns: Array<{
      name: string;
      regex: string;
      replacement: string;
      flags?: string;
    }>;
  };
  extraction: {
    strategies: Array<{
      priority: number;
      pattern: string;
      description: string;
    }>;
  };
  clustering: {
    algorithm: string;
    threshold: number;
    canonicalSelection: string;
    minLength: number;
    stopWords: string[];
  };
  validation: {
    minOccurrences: number;
    directionLockThreshold: number;
    ignorePatterns: string[];
  };
}

export interface BankTransactionRaw {
  description: string;
  amount: number;
  date: string;
  id?: string;
}

export interface EntityCandidate {
  id: string;
  canonicalName: string;
  occurrences: number;
  directionProfile: {
    creditPct: number;
    debitPct: number;
  };
  sampleDescriptions: string[];
}

// ========== CACHE DE CONFIGURACIÓN ==========
let cachedConfig: EntityDetectionConfig | null = null;

export function loadConfig(): EntityDetectionConfig {
  if (cachedConfig) return cachedConfig;
  const path = join(process.cwd(), 'rules/entity-detection.json');
  cachedConfig = JSON.parse(readFileSync(path, 'utf-8')) as EntityDetectionConfig;
  return cachedConfig;
}

// ========== ALGORITMO JARO (Helper para Jaro-Winkler) ==========
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);
  let matches = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (matches2[j]) continue;
      if (s1[i] === s2[j]) {
        matches1[i] = true;
        matches2[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

// ========== JARO-WINKLER ==========
export function jaroWinkler(s1: string, s2: string): number {
  const Jaro = jaro(s1, s2);
  if (Jaro < 0.7) return Jaro;

  let prefixLength = 0;
  const maxPrefix = 4;
  const minLen = Math.min(s1.length, s2.length, maxPrefix);
  for (let i = 0; i < minLen; i++) {
    if (s1[i] === s2[i]) prefixLength++;
    else break;
  }
  return Jaro + prefixLength * 0.1 * (1 - Jaro);
}

// ========== SANITIZACIÓN CON REGEX SEGURO ==========
export function sanitizeDescription(desc: string, config: EntityDetectionConfig): string {
  let cleaned = desc;
  for (const pattern of config.sanitization.stripPatterns) {
    try {
      const flags = pattern.flags || 'gi';
      const rx = new RegExp(pattern.regex, flags);
      cleaned = cleaned.replace(rx, pattern.replacement ?? '');
    } catch (err) {
      logger.warn('ENTITY_DETECTOR_INVALID_REGEX', { pattern: pattern.name, error: String(err) });
    }
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

// ========== EXTRACCIÓN CON ESTRATEGIAS PRIORIZADAS ==========
export function extractName(desc: string, config: EntityDetectionConfig): string | null {
  const strategies = [...config.extraction.strategies].sort((a, b) => a.priority - b.priority);

  for (const strategy of strategies) {
    try {
      const rx = new RegExp(strategy.pattern, 'i');
      const match = desc.match(rx);
      if (match) {
        const extracted = (match[1] || match[0]).trim();
        if (extracted.length >= config.clustering.minLength) {
          return extracted;
        }
      }
    } catch (err) {
      logger.warn('ENTITY_DETECTOR_INVALID_STRATEGY', { error: String(err) });
    }
  }
  return null;
}

// ========== CLUSTERING FUZZY CON DIRECCIONALIDAD ==========
export function clusterCandidates(
  transactions: BankTransactionRaw[],
  config: EntityDetectionConfig,
): EntityCandidate[] {
  const candidatesMap = new Map<
    string,
    {
      names: string[];
      count: number;
      credits: number;
      debits: number;
      samples: Set<string>;
    }
  >();

  const { stopWords, minLength, threshold } = config.clustering;
  const { minOccurrences, ignorePatterns } = config.validation;

  for (const tx of transactions) {
    const cleaned = sanitizeDescription(tx.description, config);
    const name = extractName(cleaned, config);
    if (!name) continue;

    const nameUpper = name.toUpperCase();
    if (name.length < minLength) continue;

    if (ignorePatterns.some((p) => new RegExp(`\\b${p}\\b`, 'i').test(nameUpper))) continue;
    if (stopWords.some((sw) => nameUpper === sw.toUpperCase())) continue;

    let foundClusterKey: string | null = null;
    for (const key of candidatesMap.keys()) {
      if (jaroWinkler(nameUpper, key) >= threshold) {
        foundClusterKey = key;
        break;
      }
    }

    const isCredit = tx.amount > 0;
    if (foundClusterKey) {
      const cluster = candidatesMap.get(foundClusterKey)!;
      cluster.names.push(name);
      cluster.count++;
      if (isCredit) cluster.credits++;
      else cluster.debits++;
      if (cluster.samples.size < 5) cluster.samples.add(tx.description);
    } else {
      candidatesMap.set(nameUpper, {
        names: [name],
        count: 1,
        credits: isCredit ? 1 : 0,
        debits: isCredit ? 0 : 1,
        samples: new Set([tx.description]),
      });
    }
  }

  const result: EntityCandidate[] = [];
  for (const [key, cluster] of candidatesMap.entries()) {
    if (cluster.count < minOccurrences) continue;

    const nameCounts: Record<string, number> = {};
    let canonicalName = cluster.names[0];
    let maxCount = 0;
    for (const name of cluster.names) {
      nameCounts[name] = (nameCounts[name] || 0) + 1;
      if (nameCounts[name] > maxCount) {
        maxCount = nameCounts[name];
        canonicalName = name;
      }
    }

    const total = cluster.count;
    const creditPct = total > 0 ? cluster.credits / total : 0;
    const debitPct = total > 0 ? cluster.debits / total : 0;

    result.push({
      id: crypto.createHash('sha256').update(canonicalName).digest('hex').slice(0, 12),
      canonicalName,
      occurrences: total,
      directionProfile: { creditPct, debitPct },
      sampleDescriptions: Array.from(cluster.samples),
    });
  }

  return result;
}
