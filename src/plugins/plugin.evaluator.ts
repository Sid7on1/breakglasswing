export class PluginEvaluator {
  // Deterministic scoring rubric (PLUG-003)
  private static readonly RUBRIC = {
    riskLevel: { LOW: 30, MEDIUM: 15, HIGH: 0, CRITICAL: -20 } as Record<string, number>,
    capabilityBonus: 10,    // per matching capability
    maxCapabilityScore: 40, // cap
    lowDependencies: 15,    // <= 5 deps
    hasLicense: 10,
    passingThreshold: 60
  };

  evaluate(analysis: any): { approved: boolean; score: number; reason: string } {
    console.log(`[PluginEvaluator] Scoring utility of plugin: ${analysis.name}`);
    
    let score = 0;
    const reasons: string[] = [];

    // 1. Risk Level (0-30)
    const riskScore = PluginEvaluator.RUBRIC.riskLevel[analysis.riskLevel] ?? 0;
    score += riskScore;
    reasons.push(`Risk(${analysis.riskLevel}): ${riskScore}`);

    // 2. Capabilities (0-40)
    const capabilities: string[] = analysis.providesCapabilities || [];
    const capScore = Math.min(
      capabilities.length * PluginEvaluator.RUBRIC.capabilityBonus,
      PluginEvaluator.RUBRIC.maxCapabilityScore
    );
    score += capScore;
    reasons.push(`Capabilities(${capabilities.length}): ${capScore}`);

    // 3. Dependency count (0-15)
    const depCount = analysis.dependencyCount ?? Infinity;
    if (depCount <= 5) {
      score += PluginEvaluator.RUBRIC.lowDependencies;
      reasons.push(`LowDeps: +${PluginEvaluator.RUBRIC.lowDependencies}`);
    }

    // 4. License (0-10)
    if (analysis.license) {
      score += PluginEvaluator.RUBRIC.hasLicense;
      reasons.push(`License(${analysis.license}): +${PluginEvaluator.RUBRIC.hasLicense}`);
    }

    const approved = score >= PluginEvaluator.RUBRIC.passingThreshold;
    
    return {
      approved,
      score,
      reason: `${approved ? 'APPROVED' : 'REJECTED'} [${score}/${PluginEvaluator.RUBRIC.passingThreshold}] — ${reasons.join(', ')}`
    };
  }
}

