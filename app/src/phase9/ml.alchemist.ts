/**
 * Phase 9 / V29B / S29-E — ML Alchemist's bounded research-to-deployment contract.
 *
 * Models are untrusted data. Workers are injected out-of-process capabilities; this module sees
 * opaque artifact handles, never filesystem paths, and it never loads Python pickle. Every
 * candidate competes against the baseline on quality, behavior, latency, memory, size, device
 * support, provenance, and reproducibility. The only input checkpoint is never overwritten.
 */

export type ModelFormat = 'safetensors' | 'mlx' | 'mlmodel' | 'mlpackage';
export type AlchemistBackend = 'mlx' | 'coreml';
export type TransformKind = 'quantize-int4' | 'quantize-int8' | 'prune' | 'palettize' | 'convert-coreml';

export interface ModelArtifact {
  handle: string;
  digest: string;
  format: ModelFormat;
  sizeBytes: number;
  provenance: string;
  immutable: true;
}

export interface EvaluationContract {
  datasetDigest: string;
  evaluatorVersion: string;
  minimumQuality: number;
  maximumQualityLoss: number;
  requiredDevices: string[];
  repetitions: number;
  seed: number;
}

export interface ModelMetrics {
  quality: number;
  behaviorPassed: boolean;
  coldP95Ms: number;
  warmP95Ms: number;
  peakMemoryBytes: number;
  energyProxy: number;
  artifactSizeBytes: number;
  supportedDevices: string[];
  fallback: string | null;
  warnings: string[];
}

export interface TransformCandidate {
  id: string;
  kind: TransformKind;
  parameters: Record<string, number | string | boolean>;
}

export interface AlchemistWorker {
  backend: AlchemistBackend;
  isolated: boolean;
  inspect(artifact: ModelArtifact, signal: AbortSignal): Promise<{ architecture: string; parameterCount: number; warnings: string[] }>;
  evaluate(artifact: ModelArtifact, contract: EvaluationContract, signal: AbortSignal): Promise<ModelMetrics>;
  transform(artifact: ModelArtifact, candidate: TransformCandidate, signal: AbortSignal): Promise<ModelArtifact>;
  export(artifact: ModelArtifact, signal: AbortSignal): Promise<{ digest: string; integrityVerified: boolean }>;
}

export interface CandidateComparison {
  candidate: TransformCandidate;
  artifact: ModelArtifact | null;
  metrics: ModelMetrics | null;
  accepted: boolean;
  reasons: string[];
}

export interface AlchemistReceipt {
  backend: AlchemistBackend;
  workflow: 'mlx-research' | 'coreml-deployment';
  inputDigest: string;
  architecture: string | null;
  baseline: ModelMetrics | null;
  comparisons: CandidateComparison[];
  selectedCandidateId: string | null;
  outputDigest: string | null;
  exportVerified: boolean;
  reproducibility: { datasetDigest: string; evaluatorVersion: string; repetitions: number; seed: number };
  problems: string[];
}

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024 * 1024;
const HANDLE = /^artifact_[a-zA-Z0-9_-]{8,160}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export function validateArtifact(artifact: ModelArtifact): string[] {
  const problems: string[] = [];
  if (!HANDLE.test(artifact.handle)) problems.push('The artifact handle is invalid.');
  if (!DIGEST.test(artifact.digest)) problems.push('The artifact digest is invalid.');
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0 || artifact.sizeBytes > MAX_ARTIFACT_BYTES) problems.push('The artifact size is outside the bounded parser limit.');
  if (!artifact.provenance.trim()) problems.push('Artifact provenance is missing.');
  return problems;
}

function compare(
  candidate: TransformCandidate,
  artifact: ModelArtifact,
  metrics: ModelMetrics,
  baseline: ModelMetrics,
  contract: EvaluationContract,
): CandidateComparison {
  const reasons: string[] = [];
  const qualityFloor = Math.max(contract.minimumQuality, baseline.quality - contract.maximumQualityLoss);
  if (!metrics.behaviorPassed) reasons.push('Behavior evaluator failed.');
  if (metrics.quality < qualityFloor) reasons.push(`Quality ${metrics.quality} is below the ${qualityFloor} contract floor.`);
  const missingDevices = contract.requiredDevices.filter((device) => !metrics.supportedDevices.includes(device));
  if (missingDevices.length) reasons.push(`Missing required device support: ${missingDevices.join(', ')}.`);
  if (artifact.digest === '') reasons.push('The candidate has no output identity.');
  if (!DIGEST.test(artifact.digest)) reasons.push('The candidate output digest is invalid.');
  const improvesCost = metrics.warmP95Ms < baseline.warmP95Ms
    || metrics.peakMemoryBytes < baseline.peakMemoryBytes
    || metrics.artifactSizeBytes < baseline.artifactSizeBytes
    || metrics.energyProxy < baseline.energyProxy;
  if (!improvesCost) reasons.push('The candidate does not improve a measured deployment cost.');
  return { candidate, artifact, metrics, accepted: reasons.length === 0, reasons };
}

async function runWorkflow(input: {
  workflow: AlchemistReceipt['workflow'];
  requiredBackend: AlchemistBackend;
  artifact: ModelArtifact;
  contract: EvaluationContract;
  candidates: TransformCandidate[];
  worker: AlchemistWorker;
  signal?: AbortSignal;
}): Promise<AlchemistReceipt> {
  const problems = validateArtifact(input.artifact);
  if (input.worker.backend !== input.requiredBackend) problems.push(`This workflow requires ${input.requiredBackend}, not ${input.worker.backend}.`);
  if (!input.worker.isolated) problems.push('The model worker is not isolated.');
  if (!DIGEST.test(input.contract.datasetDigest)) problems.push('The evaluation dataset digest is invalid.');
  if (input.contract.repetitions < 3) problems.push('At least three repetitions are required.');
  if (input.candidates.length === 0 || input.candidates.length > 12) problems.push('The candidate set must contain 1–12 bounded transforms.');
  const receipt: AlchemistReceipt = {
    backend: input.requiredBackend, workflow: input.workflow, inputDigest: input.artifact.digest,
    architecture: null, baseline: null, comparisons: [], selectedCandidateId: null,
    outputDigest: null, exportVerified: false,
    reproducibility: {
      datasetDigest: input.contract.datasetDigest, evaluatorVersion: input.contract.evaluatorVersion,
      repetitions: input.contract.repetitions, seed: input.contract.seed,
    },
    problems,
  };
  if (problems.length) return receipt;
  const signal = input.signal ?? new AbortController().signal;
  try {
    const inspection = await input.worker.inspect(input.artifact, signal);
    receipt.architecture = inspection.architecture;
    receipt.problems.push(...inspection.warnings.map((warning) => `Inspection: ${warning}`));
    const baseline = await input.worker.evaluate(input.artifact, input.contract, signal);
    receipt.baseline = baseline;
    for (const candidate of input.candidates) {
      try {
        const artifact = await input.worker.transform(input.artifact, candidate, signal);
        const artifactProblems = validateArtifact(artifact);
        if (artifact.handle === input.artifact.handle || artifact.digest === input.artifact.digest) artifactProblems.push('The worker attempted to reuse or overwrite the input checkpoint.');
        if (artifactProblems.length) {
          receipt.comparisons.push({ candidate, artifact: null, metrics: null, accepted: false, reasons: artifactProblems });
          continue;
        }
        const metrics = await input.worker.evaluate(artifact, input.contract, signal);
        receipt.comparisons.push(compare(candidate, artifact, metrics, baseline, input.contract));
      } catch (error) {
        receipt.comparisons.push({ candidate, artifact: null, metrics: null, accepted: false, reasons: [error instanceof Error ? error.message : String(error)] });
      }
    }
    const accepted = receipt.comparisons.filter((row) => row.accepted && row.metrics && row.artifact);
    accepted.sort((a, b) => {
      const am = a.metrics!; const bm = b.metrics!;
      return am.warmP95Ms - bm.warmP95Ms
        || am.peakMemoryBytes - bm.peakMemoryBytes
        || am.artifactSizeBytes - bm.artifactSizeBytes
        || a.candidate.id.localeCompare(b.candidate.id);
    });
    const selected = accepted[0];
    if (!selected?.artifact) return receipt;
    const exported = await input.worker.export(selected.artifact, signal);
    if (!exported.integrityVerified || exported.digest !== selected.artifact.digest) {
      receipt.problems.push('Export integrity did not match the selected artifact.');
      return receipt;
    }
    receipt.selectedCandidateId = selected.candidate.id;
    receipt.outputDigest = exported.digest;
    receipt.exportVerified = true;
    return receipt;
  } catch (error) {
    receipt.problems.push(error instanceof Error ? error.message : String(error));
    return receipt;
  }
}

export function runMlxResearchWorkflow(input: Omit<Parameters<typeof runWorkflow>[0], 'workflow' | 'requiredBackend'>): Promise<AlchemistReceipt> {
  return runWorkflow({ ...input, workflow: 'mlx-research', requiredBackend: 'mlx' });
}

export function runCoreMLDeploymentWorkflow(input: Omit<Parameters<typeof runWorkflow>[0], 'workflow' | 'requiredBackend'>): Promise<AlchemistReceipt> {
  return runWorkflow({ ...input, workflow: 'coreml-deployment', requiredBackend: 'coreml' });
}

