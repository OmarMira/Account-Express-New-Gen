import { logger } from '@/lib/logger';

/**
 * Centralizes pattern normalization for all matching operations.
 * Applied before fuzzy matching AND before exact lookup in context storage.
 * Ensures: lowercase, trim, collapse spaces, remove metadata patterns.
 */
export function normalizePattern(desc: string): string {
  let cleaned = desc.toLowerCase().trim();

  // Remove common prefixes
  cleaned = cleaned.replace(/^(zelle\s+)?payment\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^(zelle\s+)?transfer\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^check\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^transfer\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^withdrawal\s+(to|from)\s+/g, '');
  cleaned = cleaned.replace(/^deposit\s+(to|from)\s+/g, '');

  // Generic metadata patterns (DES:/ID:/INDN: from bank feeds)
  cleaned = cleaned.replace(/des:[\w\s\.-]+id:[\w\d-]+(indn:)?/g, '');
  cleaned = cleaned.replace(/indn:/g, '');

  // Remove common suffixes
  cleaned = cleaned.replace(/(;\s*|\s+)conf#\s*[\w\d]+/g, '');
  cleaned = cleaned.replace(/\s+for\s+\"[^\"]+\"/g, '');

  // Final normalization: trim and collapse multiple spaces to single space
  return cleaned.trim().replace(/\s+/g, ' ');
}

/**
 * Sanitizes description for entity detection.
 */
export function sanitizeDescriptionForDetection(desc: string, config: any): string {
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

/**
 * Sanitizes description for adaptive learning engine.
 */
export function sanitizeDescriptionForAdaptive(desc: string, config: any): string {
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
