import { Octokit } from '@octokit/rest';
import { Logger } from '../utils';

export class GithubApiAdapter {
  private octokit: Octokit;

  constructor() {
    // If auth token is provided, it runs authenticated (5000 req/hr rate limit)
    // Otherwise, it runs unauthenticated (60 req/hr rate limit)
    const auth = process.env.GITHUB_TOKEN;
    this.octokit = new Octokit(auth ? { auth } : {});
    
    if (auth) {
      Logger.info(`[GithubApi] Booted successfully using Authenticated Token (Limit: 5,000 requests/hr)`);
    } else {
      Logger.warn(`[GithubApi] Booted without Token! Running unauthenticated (Limit: 60 requests/hr)`);
    }
  }

  async searchRepositories(query: string) {
    Logger.info(`[GithubApi] Searching public repos for: "${query}"`);
    const result = await this.octokit.rest.search.repos({
      q: query,
      sort: 'stars',
      order: 'desc',
      per_page: 1
    });

    if (result.data.items.length === 0) {
      throw new Error("No repositories found.");
    }
    
    const repo = result.data.items[0];
    Logger.info(`[GithubApi] Found top match: ${repo.full_name} (${repo.stargazers_count} stars)`);
    return repo;
  }

  /**
   * Physically fetches and decodes a specific file from a remote GitHub repository.
   */
  async getFileContent(owner: string, repo: string, filePath: string): Promise<string> {
    Logger.info(`[GithubApi] Fetching raw file content: ${owner}/${repo}/${filePath}`);
    
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      const data = response.data as any;

      if (data.type === 'file' && data.encoding === 'base64') {
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        Logger.info(`[GithubApi] Successfully decoded file: ${filePath}`);
        return content;
      }
      
      throw new Error(`Target is not a parseable file (Type: ${data.type})`);
    } catch (e: any) {
      Logger.error(`[GithubApi] Failed to fetch file content: ${e.message}`);
      throw e;
    }
  }
}
