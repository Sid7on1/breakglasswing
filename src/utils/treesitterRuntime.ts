import * as fs from 'fs';

let cached: boolean | null = null;

/**
 * Whether the web-tree-sitter WASM runtime is actually loadable in THIS process.
 *
 * In the bun-compiled standalone binary, require.resolve still returns the build machine's
 * absolute node_modules path baked in at compile time — a path that doesn't exist where the
 * binary runs. Calling Parser.init() there makes Emscripten abort with an unhandled rejection
 * ("Aborted(... ENOENT ... web-tree-sitter/tree-sitter.wasm)") that escapes every try/catch.
 * So every Parser.init() call site must consult this first and fall back (regex analysis /
 * no graph indexing) when the wasm file isn't really on disk.
 */
export function treeSitterRuntimeAvailable(): boolean {
  if (cached !== null) return cached;
  try {
    cached = fs.existsSync(require.resolve('web-tree-sitter/tree-sitter.wasm'));
  } catch {
    cached = false;
  }
  return cached;
}
