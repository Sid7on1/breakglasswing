import OpenAI from 'openai';
import { Logger } from '../utils';
import { ApiKeyManager } from '../credits/api.key.manager';

export class LlmAdapter {
  constructor(private apiKeyManager: ApiKeyManager) {}

  async generateTinyPlans(userPrompt: string, systemContext: string) {
    Logger.info(`[LlmAdapter] Dispatching request to NVIDIA NIM...`);
    Logger.info(`[LlmAdapter] Payload size: ${userPrompt.length + systemContext.length} chars`);

    // 1. Get the optimal key from the Load Balancer
    const { keyStr, idx, waitTimeSecs } = this.apiKeyManager.getNextKey();
    
    if (!keyStr || idx === null) {
      throw new Error(`[LlmAdapter] FATAL: No API keys configured in the ApiKeyManager.`);
    }

    // 2. Intelligent Sleep Threading if ALL keys are rate-limited
    if (waitTimeSecs > 0) {
      Logger.warn(`[LlmAdapter] All keys exhausted! Thread sleeping for ${waitTimeSecs.toFixed(1)}s to cool down...`);
      await new Promise(resolve => setTimeout(resolve, waitTimeSecs * 1000));
    }

    // 3. Dynamically instantiate the client for this specific request
    const client = new OpenAI({ 
      apiKey: keyStr,
      baseURL: 'https://integrate.api.nvidia.com/v1'
    });

    try {
      const response = await client.chat.completions.create({
        model: 'meta/llama3-70b-instruct',
        messages: [
          { role: 'system', content: systemContext },
          { role: 'user', content: userPrompt }
        ]
      }, {
        timeout: 15000 // 15 second timeout 
      });

      // Report Success!
      this.apiKeyManager.reportKeyResult(idx, 200);

      const content = response.choices[0].message.content;
      Logger.info(`[LlmAdapter] Success! Received payload from NVIDIA NIM using Key #${idx + 1}.`);
      return { status: 200, data: JSON.parse(content || "{}"), retryAfter: null };
      
    } catch (error: any) {
      Logger.error(`[LlmAdapter] Network Error: ${error.message}`);
      let status = 500;
      let retryAfter = null;

      if (error instanceof OpenAI.APIConnectionTimeoutError || error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        status = 408; // Request Timeout
      } else if (error.status) {
        status = error.status;
      }

      if (error.headers && error.headers['retry-after']) {
        retryAfter = parseFloat(error.headers['retry-after']);
      } else if (status === 429) {
        retryAfter = 5; // Default 5s backoff for rate limits missing headers
      }

      // Report Failure back to the mathematical back-off engine
      this.apiKeyManager.reportKeyResult(idx, status, retryAfter);

      return { status, data: null, retryAfter, error };
    }
  }
  async generateSemanticMetadata(nodeId: string, nodeName: string, type: string, codeSnippet: string) {
    const systemContext = `You are a structural semantic analyzer. Return a JSON object with:
    - purpose (string, max 15 words)
    - criticality (string: 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    - riskScore (number: 0 to 100)
    Based on the following code snippet.`;
    
    const userPrompt = `Node ID: ${nodeId}\nNode Name: ${nodeName}\nType: ${type}\nCode:\n${codeSnippet}`;
    
    // We can reuse the same infrastructure
    const { keyStr, idx, waitTimeSecs } = this.apiKeyManager.getNextKey();
    if (!keyStr || idx === null) throw new Error(`[LlmAdapter] FATAL: No API keys configured.`);
    if (waitTimeSecs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTimeSecs * 1000));
    }

    const client = new OpenAI({ apiKey: keyStr, baseURL: 'https://integrate.api.nvidia.com/v1' });
    try {
      const response = await client.chat.completions.create({
        model: 'meta/llama3-70b-instruct',
        messages: [
          { role: 'system', content: systemContext },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: "json_object" }
      }, { timeout: 15000 });

      this.apiKeyManager.reportKeyResult(idx, 200);
      const content = response.choices[0].message.content;
      return JSON.parse(content || "{}");
    } catch (e: any) {
      this.apiKeyManager.reportKeyResult(idx, 500);
      Logger.error(`[LlmAdapter] Failed semantic analysis for ${nodeId}`);
      return null;
    }
  }
}
