import { calibrateRanker, rankAnomaly, type FeatureVector, type LabeledProvenanceExample } from '../anomaly.ranker';

const vector = (values: Partial<FeatureVector> = {}): FeatureVector => ({
  taskMismatch: 0, credentialRead: 0, persistenceWrite: 0, undeclaredEndpoint: 0,
  signerNovelty: 0, lineageRarity: 0, evidenceGap: 0, ...values,
});
const row = (id: string, label: 'benign' | 'suspicious', features: Partial<FeatureVector>): LabeledProvenanceExample => ({
  id, label, corpusVersion: 'fixture-v1', features: vector(features),
});
const corpus: LabeledProvenanceExample[] = [
  row('b1', 'benign', {}), row('b2', 'benign', { undeclaredEndpoint: 0.1 }),
  row('b3', 'benign', { lineageRarity: 0.1 }), row('b4', 'benign', { signerNovelty: 0.1 }),
  row('s1', 'suspicious', { credentialRead: 1, undeclaredEndpoint: 1, taskMismatch: 1 }),
  row('s2', 'suspicious', { persistenceWrite: 1, taskMismatch: 1 }),
  row('s3', 'suspicious', { credentialRead: 1, signerNovelty: 1 }),
  row('s4', 'suspicious', { credentialRead: 1, lineageRarity: 1, undeclaredEndpoint: 1 }),
];

describe('Phase 9 learned provenance ranking (S28-E)', () => {
  test('refuses an unversioned or undersized corpus', () => {
    expect(rankAnomaly(vector({ credentialRead: 1 }), corpus.slice(0, 2)).available).toBe(false);
  });

  test('ranks a combined causal mismatch for review but exposes no block or repair disposition', () => {
    const result = rankAnomaly(vector({ credentialRead: 1, undeclaredEndpoint: 1, taskMismatch: 1 }), corpus);
    expect(result.available).toBe(true);
    expect(result.disposition).toBe('review');
    expect(JSON.stringify(result)).not.toMatch(/block|repair|isolate/);
  });

  test('calibration reports the false-positive budget instead of silently authorizing the model', () => {
    const holdout = [
      row('hb', 'benign', { lineageRarity: 0.05 }),
      row('hs', 'suspicious', { credentialRead: 1, undeclaredEndpoint: 1, taskMismatch: 1 }),
    ];
    const result = calibrateRanker(corpus, holdout, { maxFalsePositiveRate: 0 });
    expect(result).toMatchObject({ total: 2, falsePositiveRate: 0, recall: 1, passesBudget: true });
  });
});

