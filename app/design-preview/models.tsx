import React, { useCallback, useMemo, useState } from 'react';
import { ModelDialog } from '../src/renderer/src/components/ModelDialog';
import type { EngineCatalog, EngineConfig } from '../src/renderer/src/protocol';

/**
 * Model-window harness.
 *
 * The catalogue here is a FIXTURE, but it is shaped from the real engine's own recorded findings so
 * the states that matter are actually representable: a curated model the provider has stopped
 * serving, a served id we have never measured, and a model the catalogue bars from auto-selection
 * because a live probe timed out on it. A fixture that only contained healthy rows would let the
 * window look finished while every warning path went unrendered.
 */

const MODELS: EngineCatalog['models'] = [
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b',
    label: 'Nemotron 3 Nano 30B',
    desc: 'Fast, calls tools reliably. The shipped default for Work.',
    tier: 'coding', served: true, curated: true,
    capabilities: { visionInput: false, reasoningEffortKnob: true, thinking: true, structuredOutputs: true, parallelToolCalls: true, contextWindow: 131072 },
  },
  {
    id: 'qwen/qwen3-coder-480b-a35b-instruct',
    label: 'Qwen3 Coder 480B',
    desc: 'Strongest code model here; slower first token.',
    tier: 'coding', served: true, curated: true,
    capabilities: { visionInput: false, reasoningEffortKnob: false, thinking: false, structuredOutputs: true, parallelToolCalls: true, contextWindow: 262144 },
  },
  {
    id: 'stepfun-ai/step-3.7-flash',
    label: 'Step 3.7 Flash',
    desc: 'Timed out (180s, no response headers) on three separate live probes.',
    tier: 'coding', served: true, curated: true, avoidAutoSelect: true,
    capabilities: { visionInput: false, reasoningEffortKnob: true, thinking: true, structuredOutputs: false, parallelToolCalls: false, contextWindow: 65536 },
  },
  {
    id: 'mistralai/mistral-nemotron',
    label: 'Mistral Nemotron',
    desc: 'Declares no Function Calling — prints bare tool JSON as prose.',
    tier: 'coding', served: false, curated: true, avoidAutoSelect: true,
    capabilities: { visionInput: false, reasoningEffortKnob: false, thinking: false, structuredOutputs: false, parallelToolCalls: false, contextWindow: 131072 },
  },
  {
    id: 'meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B',
    desc: 'Plain model, never a reasoner. Live exact reply 0.61s.',
    tier: 'lite', served: true, curated: true,
    capabilities: { visionInput: false, reasoningEffortKnob: false, thinking: false, structuredOutputs: true, parallelToolCalls: false, contextWindow: 131072 },
  },
  {
    id: 'nvidia/nemotron-nano-12b-v2-vl',
    label: 'Nemotron Nano 12B VL',
    desc: 'Grounded a real composer action and refused the unproven-recipient trap.',
    tier: 'vision', served: true, curated: true,
    capabilities: { visionInput: true, reasoningEffortKnob: false, thinking: false, structuredOutputs: true, parallelToolCalls: false, contextWindow: 131072 },
  },
  {
    id: 'nvidia/nemotron-3-nano-omni',
    label: 'Nemotron 3 Nano Omni',
    desc: 'Faster on paper, but chose a WRONG click on both grounded frames.',
    tier: 'vision', served: true, curated: true, avoidAutoSelect: true,
    capabilities: { visionInput: true, reasoningEffortKnob: false, thinking: false, structuredOutputs: true, parallelToolCalls: false, contextWindow: 131072 },
  },
  {
    id: 'deepseek-ai/deepseek-v3.2',
    label: 'deepseek-ai/deepseek-v3.2',
    desc: 'Served by this provider — not measured by us',
    tier: 'other', served: true, curated: false,
    capabilities: { visionInput: false, reasoningEffortKnob: false, thinking: true, structuredOutputs: false, parallelToolCalls: true, contextWindow: 163840 },
  },
];

const PROVIDERS: EngineCatalog['providers'] = [
  { name: 'nvidia', label: 'NVIDIA NIM', baseURL: 'https://integrate.api.nvidia.com/v1', apiKeyEnv: 'NVIDIA_API_KEY', hasKey: true, keyCount: 3, keyHint: '…4f2a', active: true },
  { name: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', hasKey: true, keyCount: 1, keyHint: '…9c11', active: false },
  { name: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', hasKey: false, keyCount: 0, active: false },
  { name: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', hasKey: false, keyCount: 0, active: false },
];

/** Mimics the engine seam: the write is echoed from LOADED state, so a rejected slot can be shown. */
export function ModelsPreview(): React.ReactElement {
  const [open, setOpen] = useState(true);
  const [config, setConfig] = useState<EngineConfig>({
    model: 'nvidia/nemotron-3-nano-30b-a3b',
    liteModel: 'meta/llama-3.1-8b-instruct',
    visionModel: 'nvidia/nemotron-nano-12b-v2-vl',
    subagentModel: '',
    fallbackModel: '',
    reasoningEffort: '',
    maxThinkingTokens: 0,
  } as EngineConfig);
  const [providers, setProviders] = useState(PROVIDERS);

  const configGet = useCallback(async () => config, [config]);
  const configSet = useCallback(async (patch: EngineConfig) => {
    const next = { ...config, ...patch };
    setConfig(next);
    return next;
  }, [config]);

  const catalog = useMemo<EngineCatalog>(() => ({ providers, models: MODELS }), [providers]);
  const catalogGet = useCallback(async () => catalog, [catalog]);
  const providerSet = useCallback(async ({ name }: { name: string }) => {
    const next = providers.map((p) => ({ ...p, active: p.name === name }));
    setProviders(next);
    return { providers: next, models: MODELS };
  }, [providers]);

  return (
    <div style={{ minHeight: 560 }}>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{ padding: '8px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid #8884', background: 'transparent', color: 'inherit', font: '500 12px/1.4 system-ui' }}
        >
          Open the model window
        </button>
      )}
      <ModelDialog
        open={open}
        onClose={() => setOpen(false)}
        configGet={configGet}
        configSet={configSet}
        catalogGet={catalogGet}
        providerSet={providerSet}
      />
    </div>
  );
}
