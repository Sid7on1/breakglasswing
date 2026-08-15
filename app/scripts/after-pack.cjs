'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

/**
 * Strip extended attributes from the packed app before it is signed.
 *
 * `codesign` refuses any file carrying a resource fork or Finder info:
 *
 *   Bimax Helper (GPU): resource fork, Finder information, or similar detritus not allowed
 *
 * On this project that is not a stray file someone touched in Finder — the repository lives under
 * an iCloud-synced Desktop, so the sync client stamps `com.apple.fileprovider.fpfs#P` and
 * `com.apple.FinderInfo` onto files as they are written. Every helper unpacked from the Electron zip
 * inherits them, which makes the failure reproducible on this machine and invisible on CI.
 *
 * Clearing them is safe: none of these attributes carry app content, and the signature that matters
 * is applied immediately after this hook. Doing it here rather than by hand means the fix survives
 * the next build instead of being re-discovered.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('xattr', ['-cr', bundle], { stdio: 'inherit' });
  console.log(`  • cleared extended attributes  bundle=${bundle}`);
};
