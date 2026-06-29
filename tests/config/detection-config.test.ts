import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';

// ── Hoisted: shared mock refs ─────────────────────────────────────────────
const { mockFindUnique, mockExistsSync } = vi.hoisted(() => ({
  mockFindUnique: vi.fn<(args: unknown) => unknown>(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => ({
  db: {
    detectionConfig: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

// Import AFTER mocks
import {
  loadDetectionConfig,
  loadDetectionConfigSync,
  checkDeprecatedConfigFiles,
  DEFAULT_DETECTION_CONFIG,
  clearDetectionConfigCache,
} from '@/lib/config/detection-config';

// ── Helper ────────────────────────────────────────────────────────────────
function mockDbRow(overrides: Partial<{
  companyId: string;
  threshold: number | null;
  clusterMode: string | null;
  minOccurrences: number | null;
  updatedBy: string | null;
}> | null) {
  if (overrides === null) {
    mockFindUnique.mockResolvedValue(null);
    return;
  }
  mockFindUnique.mockResolvedValue({
    companyId: overrides.companyId ?? 'comp_test',
    threshold: overrides.threshold ?? null,
    clusterMode: overrides.clusterMode ?? null,
    minOccurrences: overrides.minOccurrences ?? null,
    updatedBy: overrides.updatedBy ?? null,
    updatedAt: new Date(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('DEFAULT_DETECTION_CONFIG', () => {
  it('exports the expected default values', () => {
    expect(DEFAULT_DETECTION_CONFIG).toEqual({
      threshold: 0.85,
      clusterMode: 'fuzzy',
      minOccurrences: 2,
    });
  });
});

describe('loadDetectionConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDetectionConfigCache();
  });

  it('returns defaults when no company override exists', async () => {
    mockDbRow(null);

    const config = await loadDetectionConfig('comp_missing');
    expect(config).toEqual({
      threshold: 0.85,
      clusterMode: 'fuzzy',
      minOccurrences: 2,
    });
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { companyId: 'comp_missing' },
    });
  });

  it('returns defaults when called without companyId', async () => {
    const config = await loadDetectionConfig();
    expect(config).toEqual(DEFAULT_DETECTION_CONFIG);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('overrides threshold only, rest default', async () => {
    mockDbRow({ companyId: 'comp_1', threshold: 0.92, clusterMode: null, minOccurrences: null });

    const config = await loadDetectionConfig('comp_1');
    expect(config).toEqual({
      threshold: 0.92,
      clusterMode: 'fuzzy',
      minOccurrences: 2,
    });
  });

  it('overrides all fields', async () => {
    mockDbRow({ companyId: 'comp_2', threshold: 0.80, clusterMode: 'hybrid', minOccurrences: 5 });

    const config = await loadDetectionConfig('comp_2');
    expect(config).toEqual({
      threshold: 0.80,
      clusterMode: 'hybrid',
      minOccurrences: 5,
    });
  });

  it('falls back to default when threshold is out of range [2.5]', async () => {
    mockDbRow({ companyId: 'comp_1', threshold: 2.5, clusterMode: 'fuzzy', minOccurrences: null });

    const config = await loadDetectionConfig('comp_1');
    expect(config.threshold).toBe(0.85);
  });

  it('falls back to fuzzy when clusterMode is invalid', async () => {
    mockDbRow({ companyId: 'comp_1', threshold: null, clusterMode: 'levenshtein', minOccurrences: null });

    const config = await loadDetectionConfig('comp_1');
    expect(config.clusterMode).toBe('fuzzy');
  });

  it('falls back to 2 when minOccurrences is invalid (0)', async () => {
    mockDbRow({ companyId: 'comp_1', threshold: null, clusterMode: null, minOccurrences: 0 });

    const config = await loadDetectionConfig('comp_1');
    expect(config.minOccurrences).toBe(2);
  });

  it('falls back to 2 when minOccurrences is negative', async () => {
    mockDbRow({ companyId: 'comp_1', threshold: null, clusterMode: null, minOccurrences: -1 });

    const config = await loadDetectionConfig('comp_1');
    expect(config.minOccurrences).toBe(2);
  });

  it('falls back to 2 when minOccurrences is a float', async () => {
    mockDbRow({ companyId: 'comp_1', threshold: null, clusterMode: null, minOccurrences: 3.7 });

    const config = await loadDetectionConfig('comp_1');
    expect(config.minOccurrences).toBe(2);
  });
});

describe('loadDetectionConfigSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDetectionConfigCache();
  });

  it('returns defaults before cache is populated — no I/O', () => {
    const config = loadDetectionConfigSync('comp_1');
    expect(config).toEqual(DEFAULT_DETECTION_CONFIG);
    // Should NOT call findUnique — that's async I/O
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('returns defaults for unknown company even after cache populated', async () => {
    mockDbRow({ companyId: 'comp_1', threshold: 0.92, clusterMode: null, minOccurrences: null });
    await loadDetectionConfig('comp_1');

    // comp_2 was not cached
    const config = loadDetectionConfigSync('comp_2');
    expect(config).toEqual(DEFAULT_DETECTION_CONFIG);
    // No additional DB call
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('returns cached values after async load', async () => {
    mockDbRow({ companyId: 'comp_1', threshold: 0.92, clusterMode: 'hybrid', minOccurrences: 5 });
    await loadDetectionConfig('comp_1');

    // Sync load should return cached value
    const config = loadDetectionConfigSync('comp_1');
    expect(config).toEqual({
      threshold: 0.92,
      clusterMode: 'hybrid',
      minOccurrences: 5,
    });
    // Should not call findUnique again
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('does not throw when called before cache', () => {
    expect(() => loadDetectionConfigSync()).not.toThrow();
    expect(() => loadDetectionConfigSync('any')).not.toThrow();
  });

  it('returns defaults when called without companyId before cache', () => {
    const config = loadDetectionConfigSync();
    expect(config).toEqual(DEFAULT_DETECTION_CONFIG);
  });
});

describe('checkDeprecatedConfigFiles', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs 3 warnings when all 3 JSON files exist', () => {
    mockExistsSync.mockReturnValue(true);

    checkDeprecatedConfigFiles();

    expect(mockExistsSync).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('rules/entity-detection.json'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('rules/learning-engine.json'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('rules/predictive-recon.json'),
    );
  });

  it('logs only 1 warning when only entity-detection.json exists', () => {
    mockExistsSync.mockImplementation((path: string) =>
      path.includes('entity-detection.json'),
    );

    checkDeprecatedConfigFiles();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('rules/entity-detection.json'),
    );
  });

  it('logs no warnings when no JSON files exist', () => {
    mockExistsSync.mockReturnValue(false);

    checkDeprecatedConfigFiles();

    expect(mockExistsSync).toHaveBeenCalledTimes(3);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('each warning mentions the file is deprecated', () => {
    mockExistsSync.mockReturnValue(true);

    checkDeprecatedConfigFiles();

    const calls = warnSpy.mock.calls;
    expect(calls.length).toBe(3);
    for (const call of calls) {
      expect(call[0]).toContain('deprecated');
    }
  });
});
