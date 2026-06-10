import { VectorStore } from './vector.store';

export class LongTermMemory {
  constructor(private vectorStore: VectorStore) {}

  async rememberSolution(bugId: string, symptoms: string, fixCode: string) {
    const documentText = `Symptoms: ${symptoms}\nFix: ${fixCode}`;
    await this.vectorStore.storeDocument(
      `solution-${bugId}`, 
      documentText, 
      ['bug-fix', 'solution', bugId]
    );
    console.log(`[LongTermMemory] Saved successful solution for bug ${bugId} to long-term storage.`);
  }

  async recallSimilarBugs(symptoms: string): Promise<string[]> {
    const matches = await this.vectorStore.semanticSearch(symptoms, 2);
    return matches.map(m => m.metadata.content);
  }
}
