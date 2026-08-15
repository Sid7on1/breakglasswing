/**
 * Phase 9 / V28B / S28-E — learned provenance output is explain/rank-only.
 *
 * A small, auditable k-nearest-neighbour ranker is used instead of an opaque model. It refuses to
 * score without a versioned minimum corpus, reports calibration separately, and has no API that can
 * block, isolate, repair, or mutate anything.
 */

export const ANOMALY_FEATURES = [
  'taskMismatch', 'credentialRead', 'persistenceWrite', 'undeclaredEndpoint',
  'signerNovelty', 'lineageRarity', 'evidenceGap',
] as const;
export type AnomalyFeature = (typeof ANOMALY_FEATURES)[number];
export type FeatureVector = Record<AnomalyFeature, number>;

export interface LabeledProvenanceExample {
  id: string;
  corpusVersion: string;
  label: 'benign' | 'suspicious';
  features: FeatureVector;
}

export interface RankedAnomaly {
  available: boolean;
  score: number | null;
  disposition: 'explain' | 'review';
  neighbours: string[];
  reasons: string[];
  corpusVersion: string | null;
}

const clamp = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function normalized(input: FeatureVector): FeatureVector {
  return Object.fromEntries(ANOMALY_FEATURES.map((key) => [key, clamp(input[key])])) as FeatureVector;
}

function distance(a: FeatureVector, b: FeatureVector): number {
  const sum = ANOMALY_FEATURES.reduce((total, key) => total + (a[key] - b[key]) ** 2, 0);
  return Math.sqrt(sum / ANOMALY_FEATURES.length);
}

export function rankAnomaly(
  input: FeatureVector,
  corpus: LabeledProvenanceExample[],
  options: { neighbours?: number; minimumCorpus?: number } = {},
): RankedAnomaly {
  const minimumCorpus = options.minimumCorpus ?? 8;
  const versions = [...new Set(corpus.map((row) => row.corpusVersion))];
  if (corpus.length < minimumCorpus || versions.length !== 1) {
    return {
      available: false, score: null, disposition: 'explain', neighbours: [],
      reasons: ['A single versioned labeled corpus with enough examples is not available.'],
      corpusVersion: versions.length === 1 ? versions[0] : null,
    };
  }
  const point = normalized(input);
  const k = Math.max(3, Math.min(options.neighbours ?? 5, corpus.length));
  const nearest = corpus
    .map((row) => ({ row, distance: distance(point, normalized(row.features)) }))
    .sort((a, b) => a.distance - b.distance || a.row.id.localeCompare(b.row.id))
    .slice(0, k);
  let suspiciousWeight = 0;
  let totalWeight = 0;
  for (const neighbour of nearest) {
    const weight = 1 / Math.max(0.025, neighbour.distance);
    totalWeight += weight;
    if (neighbour.row.label === 'suspicious') suspiciousWeight += weight;
  }
  const score = clamp(suspiciousWeight / totalWeight);
  const reasons = ANOMALY_FEATURES
    .filter((key) => point[key] >= 0.5)
    .sort((a, b) => point[b] - point[a])
    .slice(0, 4)
    .map((key) => `${key}=${point[key].toFixed(2)}`);
  return {
    available: true,
    score,
    disposition: score >= 0.55 ? 'review' : 'explain',
    neighbours: nearest.map(({ row }) => row.id),
    reasons,
    corpusVersion: versions[0],
  };
}

export interface CalibrationResult {
  total: number;
  falsePositiveRate: number;
  recall: number;
  threshold: number;
  passesBudget: boolean;
}

export function calibrateRanker(
  train: LabeledProvenanceExample[],
  holdout: LabeledProvenanceExample[],
  options: { threshold?: number; maxFalsePositiveRate: number },
): CalibrationResult {
  const threshold = options.threshold ?? 0.55;
  let benign = 0;
  let falsePositive = 0;
  let suspicious = 0;
  let detected = 0;
  for (const row of holdout) {
    const result = rankAnomaly(row.features, train);
    const flagged = result.available && (result.score ?? 0) >= threshold;
    if (row.label === 'benign') {
      benign += 1;
      if (flagged) falsePositive += 1;
    } else {
      suspicious += 1;
      if (flagged) detected += 1;
    }
  }
  const falsePositiveRate = benign ? falsePositive / benign : 1;
  return {
    total: holdout.length,
    falsePositiveRate,
    recall: suspicious ? detected / suspicious : 0,
    threshold,
    passesBudget: holdout.length > 0 && benign > 0 && suspicious > 0 && falsePositiveRate <= options.maxFalsePositiveRate,
  };
}

