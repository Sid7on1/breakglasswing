import { GithubApiAdapter } from './plugins/github.api';
import { FileSystemAdapter } from './sandbox/fs.adapter';
import { Logger } from './utils';
import * as path from 'path';

async function main() {
  Logger.info('--- Initializing FINAL Live Integration Test ---');
  
  const github = new GithubApiAdapter();
  // We will write exactly to the project root directory
  const fsAdapter = new FileSystemAdapter('/Users/vishsiddharth/Desktop/breakglasswing'); 

  try {
    // 1. Fetch real live data from GitHub API
    Logger.info('[Test] Hitting live GitHub API...');
    const topRepo = await github.searchRepositories('language:typescript autonomous agent');
    
    // 2. Format the success payload
    const successMessage = `
    THE BREAKGLASSWING AGENT IS ALIVE!
    ----------------------------------
    Final Integration Test Success.
    
    I have officially hooked into the live GitHub API!
    The top autonomous agent repository right now is: ${topRepo.full_name}
    It has ${topRepo.stargazers_count} stars.

    I have also successfully bypassed the sandbox simulation and acquired 
    literal physical disk write access to your machine using Node.js 'fs'.
    `;

    // 3. Write physical file
    const targetFile = 'FINAL_TEST_SUCCESS.txt';
    Logger.info(`[Test] Utilizing physical disk access to write ${targetFile}...`);
    await fsAdapter.writeFile(targetFile, successMessage);
    
    Logger.info(`[Test] 🏁 ABSOLUTE SUCCESS! Check your /breakglasswing directory for the file!`);

  } catch (error: any) {
    Logger.error(`[Test] FAILED: ${error.message}`);
  }
}

main().catch(console.error);
