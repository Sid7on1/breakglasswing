import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils';

export class GithubAnalyzer {
  async analyzeCodebase(dirPath: string): Promise<any> {
    Logger.info(`[GithubAnalyzer] Analyzing codebase at: ${dirPath}`);
    
    const pkgPath = path.join(dirPath, 'package.json');
    
    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      const analysis = {
        name: pkg.name || 'unknown-plugin',
        description: pkg.description || 'No description provided',
        providesCapabilities: pkg.keywords || ['generic-utility'],
        riskLevel: 'LOW' // In a real system, we might scan for process.exec or fs writes to assess risk
      };
      
      Logger.info(`[GithubAnalyzer] Parsed package.json: ${analysis.name} provides ${analysis.providesCapabilities.join(', ')}`);
      return analysis;
    } catch (e: any) {
      throw new Error(`[GithubAnalyzer] Failed to read or parse package.json: ${e.message}. Is this a valid Node.js plugin?`);
    }
  }
}
