// Bounded staging — owner section 29 (V29B), slice S29-B, journey S29-04.
//
// §15 of docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md: "scan/decompress with
// path and size limits", and "reject path traversal, symlink escape, decompression bombs,
// undeclared executables". The journey grades the end state: "bounded staging rejects it; no
// escaped write".
//
// The design decision that makes that end state provable is that **nothing is written during
// inspection**. An archive is described as a list of entries first, the whole list is judged, and
// only an archive with zero rejections is extracted. A scanner that extracted as it went could not
// honestly claim "no escaped write" — it would only be claiming it noticed afterwards.

import { isInside, normalizePath } from '../evidence/path.class';

export interface ArchiveEntry {
  /** Path as the archive declares it. Untrusted: this is where traversal lives. */
  path: string;
  /** Uncompressed size in bytes as the archive declares it. */
  size: number;
  /** Compressed size, when the format reports it. Used for the compression-ratio bound. */
  compressedSize?: number;
  type: 'file' | 'directory' | 'symlink';
  /** For symlinks, the declared target. Untrusted. */
  linkTarget?: string;
  /** Whether the entry's mode marks it executable. */
  executable?: boolean;
}

export interface StagingLimits {
  /** Total uncompressed bytes the archive may expand to. */
  maxTotalBytes: number;
  /** Largest single entry. */
  maxEntryBytes: number;
  maxEntries: number;
  /** Refuse an entry that expands by more than this factor — the classic zip bomb signature. */
  maxCompressionRatio: number;
  maxPathDepth: number;
}

export const DEFAULT_LIMITS: StagingLimits = {
  maxTotalBytes: 512 * 1024 * 1024,
  maxEntryBytes: 128 * 1024 * 1024,
  maxEntries: 20_000,
  maxCompressionRatio: 200,
  maxPathDepth: 32,
};

export interface StagingRejection {
  entry: string;
  rule: 'traversal' | 'absolute-path' | 'symlink-escape' | 'entry-too-large' | 'archive-too-large'
    | 'too-many-entries' | 'compression-bomb' | 'path-too-deep' | 'undeclared-executable';
  detail: string;
}

export interface StagingVerdict {
  accepted: boolean;
  rejections: StagingRejection[];
  /** Total declared uncompressed bytes, for the disk-impact preview §18 requires before approval. */
  totalBytes: number;
  /** Entries that would be written, in archive order. Empty whenever `accepted` is false. */
  plan: ArchiveEntry[];
}

/**
 * Judge an archive against a staging root without writing anything.
 *
 * `declaredExecutables` comes from the capability manifest. §15 rejects "undeclared executables":
 * an archive that ships a binary its manifest never mentions is shipping something nobody reviewed,
 * and the manifest is the only place that review can have happened.
 */
export function inspectArchive(
  entries: ArchiveEntry[],
  stagingRoot: string,
  declaredExecutables: string[] = [],
  limits: StagingLimits = DEFAULT_LIMITS,
): StagingVerdict {
  const rejections: StagingRejection[] = [];
  const root = normalizePath(stagingRoot);
  const declared = new Set(declaredExecutables.map(p => normalizePath(`${root}/${p}`)));
  let totalBytes = 0;

  if (entries.length > limits.maxEntries) {
    rejections.push({
      entry: '(archive)', rule: 'too-many-entries',
      detail: `${entries.length} entries against a limit of ${limits.maxEntries}`,
    });
  }

  for (const entry of entries) {
    const declaredPath = entry.path;

    if (declaredPath.startsWith('/')) {
      rejections.push({
        entry: declaredPath, rule: 'absolute-path',
        detail: 'archive entries must be relative to the staging root',
      });
      continue;
    }

    const resolved = normalizePath(`${root}/${declaredPath}`);
    if (!isInside(resolved, root)) {
      rejections.push({
        entry: declaredPath, rule: 'traversal',
        detail: `resolves to ${resolved}, outside the staging root ${root}`,
      });
      continue;
    }

    const depth = resolved.slice(root.length).split('/').filter(Boolean).length;
    if (depth > limits.maxPathDepth) {
      rejections.push({
        entry: declaredPath, rule: 'path-too-deep',
        detail: `${depth} path segments against a limit of ${limits.maxPathDepth}`,
      });
      continue;
    }

    if (entry.type === 'symlink') {
      // A symlink is judged by where it would point after extraction, which is relative to the
      // link's own directory — the subtle case a naive check against the root misses.
      const linkDir = resolved.slice(0, resolved.lastIndexOf('/'));
      const target = entry.linkTarget ?? '';
      const resolvedTarget = target.startsWith('/')
        ? normalizePath(target)
        : normalizePath(`${linkDir}/${target}`);
      if (!isInside(resolvedTarget, root)) {
        rejections.push({
          entry: declaredPath, rule: 'symlink-escape',
          detail: `symlink would point at ${resolvedTarget}, outside the staging root`,
        });
      }
      continue;
    }

    if (entry.type === 'directory') continue;

    if (entry.size > limits.maxEntryBytes) {
      rejections.push({
        entry: declaredPath, rule: 'entry-too-large',
        detail: `${entry.size} bytes against a per-entry limit of ${limits.maxEntryBytes}`,
      });
      continue;
    }

    if (entry.compressedSize && entry.compressedSize > 0) {
      const ratio = entry.size / entry.compressedSize;
      if (ratio > limits.maxCompressionRatio) {
        rejections.push({
          entry: declaredPath, rule: 'compression-bomb',
          detail: `expands ${Math.round(ratio)}× against a limit of ${limits.maxCompressionRatio}×`,
        });
        continue;
      }
    }

    if (entry.executable && !declared.has(resolved)) {
      rejections.push({
        entry: declaredPath, rule: 'undeclared-executable',
        detail: 'the capability manifest does not declare this executable',
      });
      continue;
    }

    totalBytes += entry.size;
    if (totalBytes > limits.maxTotalBytes) {
      rejections.push({
        entry: declaredPath, rule: 'archive-too-large',
        detail: `expands past the ${limits.maxTotalBytes}-byte archive limit`,
      });
      break;
    }
  }

  const accepted = rejections.length === 0;
  return {
    accepted,
    rejections,
    totalBytes,
    // The plan is empty on rejection so a caller that ignores `accepted` still writes nothing.
    plan: accepted ? entries.filter(e => e.type !== 'directory') : [],
  };
}
