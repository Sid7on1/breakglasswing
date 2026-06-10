export class EmbeddingsGenerator {
  private readonly VECTOR_DIMENSIONS = 512; // High-resolution local vector size

  async generateEmbedding(text: string): Promise<number[]> {
    // A deterministic hashing algorithm to create a local "embedding"
    // We map words to specific buckets and count frequency, 
    // simulating a bag-of-words / TF-IDF style vector.
    
    const vector = new Array(this.VECTOR_DIMENSIONS).fill(0);
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    
    if (words.length === 0) return vector;

    const stopWords = new Set(['the','is','a','to','it','on','and','in','of','for','with','my','this','that','it','says']);
    for (const word of words) {
      if (word.length === 0 || stopWords.has(word)) continue;
      
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash) + word.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
      }
      
      // Map hash to a bucket
      const bucket = Math.abs(hash) % this.VECTOR_DIMENSIONS;
      vector[bucket] += 1;
    }

    // Normalize the vector (L2 norm) so cosine similarity calculations are stable
    let sumSquares = 0;
    for (let i = 0; i < this.VECTOR_DIMENSIONS; i++) {
      sumSquares += vector[i] * vector[i];
    }
    
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude > 0) {
      for (let i = 0; i < this.VECTOR_DIMENSIONS; i++) {
        vector[i] = vector[i] / magnitude;
      }
    }

    return vector;
  }
}
