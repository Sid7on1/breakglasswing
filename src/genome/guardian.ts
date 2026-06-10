import { GraphStore } from '../graph/graph.store';
import { StaticAnalyzer } from '../graph/static.analyzer';
import { Logger } from '../utils';
import * as path from 'path';
import { IGenomeRepository } from './genome.repository';

export interface IArchitectureGuardian {
  validateCandidate(componentName: string, candidateFilePath: string): Promise<boolean>;
}

export class ArchitectureGuardian implements IArchitectureGuardian {
  constructor(private projectRoot: string, private genomeRepo: IGenomeRepository) {}

  public async validateCandidate(componentName: string, candidateFilePath: string): Promise<boolean> {
    Logger.info(`[ArchitectureGuardian] Validating candidate for ${componentName}: ${candidateFilePath}`);
    
    // 1. Load Contract from Repository
    const contract = await this.genomeRepo.getContract(componentName);
    if (!contract) {
      Logger.warn(`[ArchitectureGuardian] No contract found for ${componentName}. Proceeding with caution.`);
      return true; // If no strict contract, allow
    }

    // 2. Parse the Candidate File
    // We create a temporary graph just for this file
    const store = new GraphStore(':memory:');
    const analyzer = new StaticAnalyzer(this.projectRoot, store);
    analyzer.analyzeProject(); // For MVP, we re-parse. In production, we'd parse just the file.

    const relPath = path.relative(this.projectRoot, candidateFilePath);
    const classId = `class:${relPath}:${componentName}`;

    const candidateNode = store.getNode(classId);
    if (!candidateNode) {
      Logger.error(`[ArchitectureGuardian] ❌ Validation Failed: Candidate does not export class ${componentName}`);
      return false;
    }

    // 3. Validate Emits Contract
    if (contract.emits && contract.emits.length > 0) {
      // Methods iteration removed as we scan all file edges

      for (const requiredEvent of contract.emits) {
        let eventFound = false;
        const expectedEventId = `event:${requiredEvent}`;

        // Look for any edge originating from this file that PUBLISHES_TO the required event
        for (const edge of store.getGraph().edges) {
          if (edge.type === 'PUBLISHES_TO' && edge.targetId === expectedEventId) {
            if (edge.sourceId.includes(`:${relPath}:`)) {
              eventFound = true;
              break;
            }
          }
        }

        if (!eventFound) {
          Logger.error(`[ArchitectureGuardian] ❌ Contract Violation: ${componentName} must emit '${requiredEvent}' but no PUBLISHES_TO edge was found!`);
          return false;
        }
      }
    }

    Logger.info(`[ArchitectureGuardian] ✅ Candidate validated successfully against genome contract.`);
    return true;
  }
}
