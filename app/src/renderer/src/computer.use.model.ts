import type { CatalogModelEntry, EngineCatalog, EngineConfig } from './protocol';

export interface ComputerUseModelReadiness {
  ready: boolean;
  work?: CatalogModelEntry;
  vision?: CatalogModelEntry;
  reasons: string[];
}

/**
 * Fail-closed model preflight for Control Mac.
 *
 * A configured string is not a route. The active provider must have a key, its live catalogue must
 * confirm the work model, and screenshots must have a confirmed vision-capable route (either the
 * work model itself or the dedicated Vision slot). This check happens before the task reaches the
 * engine so an incompatible model cannot start a half-working Computer Use turn.
 */
export function computerUseModelReadiness(
  config: EngineConfig | null,
  catalog: EngineCatalog | null,
): ComputerUseModelReadiness {
  const reasons: string[] = [];
  if (!config) reasons.push('The engine configuration is not available.');
  if (!catalog) reasons.push('The provider catalogue has not loaded.');
  if (catalog?.error) reasons.push('The active provider could not be verified.');

  const provider = catalog?.providers.find((entry) => entry.active);
  if (catalog && !provider) reasons.push('Choose an active provider.');
  if (provider && !provider.hasKey) reasons.push(`Add an API key for ${provider.label}.`);

  const rows = new Map((catalog?.models ?? []).map((entry) => [entry.id, entry]));
  const workId = String(config?.model || '').trim();
  const work = rows.get(workId);
  if (!workId) reasons.push('Choose a Work model.');
  else if (!work || !work.served) reasons.push('Choose a Work model confirmed by this provider.');
  else if (work.avoidAutoSelect) reasons.push('Choose a Work model verified for agent tool use.');

  const visionId = work?.capabilities?.visionInput
    ? work.id
    : String(config?.visionModel || '').trim();
  const vision = rows.get(visionId);
  if (!visionId) reasons.push('Choose a Vision model for screenshot grounding.');
  else if (!vision || !vision.served || !vision.capabilities?.visionInput) {
    reasons.push('Choose a served model that supports image input for Vision.');
  }

  return { ready: reasons.length === 0, work, vision, reasons };
}
