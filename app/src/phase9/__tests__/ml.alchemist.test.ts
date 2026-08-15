import {
  runCoreMLDeploymentWorkflow, runMlxResearchWorkflow, validateArtifact,
  type AlchemistBackend, type AlchemistWorker, type EvaluationContract, type ModelArtifact, type ModelMetrics,
} from '../ml.alchemist';

const hex = (char: string): string => char.repeat(64);
const input: ModelArtifact = {
  handle: 'artifact_baseline01', digest: `sha256:${hex('a')}`, format: 'safetensors',
  sizeBytes: 1_000_000, provenance: 'fixture/source@1', immutable: true,
};
const contract: EvaluationContract = {
  datasetDigest: `sha256:${hex('d')}`, evaluatorVersion: 'fixture-eval/1', minimumQuality: 0.8,
  maximumQualityLoss: 0.02, requiredDevices: ['m3'], repetitions: 5, seed: 42,
};
const baseline: ModelMetrics = {
  quality: 0.9, behaviorPassed: true, coldP95Ms: 50, warmP95Ms: 30,
  peakMemoryBytes: 1_000_000, energyProxy: 10, artifactSizeBytes: 1_000_000,
  supportedDevices: ['m3'], fallback: 'cpu', warnings: [],
};

function worker(backend: AlchemistBackend, quality: number, digestChar = 'b'): AlchemistWorker {
  const candidate: ModelArtifact = {
    handle: `artifact_candidate_${backend}`, digest: `sha256:${hex(digestChar)}`,
    format: backend === 'mlx' ? 'mlx' : 'mlpackage', sizeBytes: 500_000,
    provenance: 'fixture/transform@1', immutable: true,
  };
  return {
    backend, isolated: true,
    inspect: async () => ({ architecture: 'tiny-transformer', parameterCount: 1000, warnings: [] }),
    evaluate: async (artifact) => artifact.handle === input.handle ? baseline : {
      ...baseline, quality, warmP95Ms: 20, peakMemoryBytes: 600_000,
      artifactSizeBytes: candidate.sizeBytes, energyProxy: 7,
    },
    transform: async () => candidate,
    export: async (artifact) => ({ digest: artifact.digest, integrityVerified: true }),
  };
}

describe('Phase 9 ML Alchemist (S29-E)', () => {
  test('rejects corrupted or executable-by-loading artifact formats before worker execution', () => {
    expect(validateArtifact({ ...input, digest: 'bad' })).toContain('The artifact digest is invalid.');
    expect(['pickle', 'pt', 'pth']).not.toContain(input.format);
  });

  test('MLX research selects a bounded transform only when quality and behavior survive', async () => {
    const receipt = await runMlxResearchWorkflow({
      artifact: input, contract,
      candidates: [{ id: 'mlx-int4', kind: 'quantize-int4', parameters: { groupSize: 64 } }],
      worker: worker('mlx', 0.89),
    });
    expect(receipt).toMatchObject({ workflow: 'mlx-research', selectedCandidateId: 'mlx-int4', exportVerified: true });
  });

  test('a smaller but degraded model loses and the baseline remains untouched', async () => {
    const receipt = await runMlxResearchWorkflow({
      artifact: input, contract,
      candidates: [{ id: 'too-small', kind: 'quantize-int4', parameters: {} }],
      worker: worker('mlx', 0.4),
    });
    expect(receipt.selectedCandidateId).toBeNull();
    expect(receipt.comparisons[0]).toMatchObject({ accepted: false });
    expect(receipt.inputDigest).toBe(input.digest);
  });

  test('Core ML deployment verifies device support and exported digest', async () => {
    const receipt = await runCoreMLDeploymentWorkflow({
      artifact: input, contract,
      candidates: [{ id: 'coreml-int8', kind: 'convert-coreml', parameters: { computeUnits: 'all' } }],
      worker: worker('coreml', 0.9, 'c'),
    });
    expect(receipt).toMatchObject({ workflow: 'coreml-deployment', outputDigest: `sha256:${hex('c')}`, exportVerified: true });
  });
});

