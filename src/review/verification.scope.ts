import * as path from 'path';

// Successful writes to prose/media are real task changes, but a compiler or test suite cannot
// verify them. Keep them in the review change list while excluding them from the epistemic
// build/test ledger so a story.txt edit never ends with "run a build/test to confirm".
const NON_BUILD_ARTIFACTS = new Set([
  '.txt', '.md', '.rtf', '.doc', '.docx', '.odt', '.pdf',
  '.csv', '.tsv',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.mp3', '.wav', '.m4a', '.mp4', '.mov', '.webm',
]);

export function requiresBuildVerification(file?: string): boolean {
  if (!file) return false;
  const ext = path.extname(file).toLowerCase();
  // Extensionless artifacts remain conservative: they may be scripts, Dockerfiles, Makefiles, etc.
  return ext === '' || !NON_BUILD_ARTIFACTS.has(ext);
}
