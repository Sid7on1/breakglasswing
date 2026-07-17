import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FileText, AtSign, RefreshCw, Database } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Files panel — Electron-native lazy tree (main process ignores node_modules/.git). Clicking a
 * file opens it in the IDE-style EditorPane (right side, full height); the "@" hover action
 * inserts the path into the composer via the bimax:compose-insert CustomEvent.
 */

export function insertIntoComposer(text: string): void {
  window.dispatchEvent(new CustomEvent('bimax:compose-insert', { detail: text }));
}

interface DirState { entries: { name: string; dir: boolean }[]; open: boolean }

// Bimax-owned workspace state is useful for debugging, but it should not dominate the project
// explorer. Keep it one click away instead of pretending generated databases are source files.
const GENERATED_ROOTS = new Set(['.agents', '.bimax', '.breakglass', '.breakglass_graph']);

export function FilesPanel({
  project, onOpenFile,
}: {
  project: string;
  onOpenFile: (rel: string) => void;
}): React.ReactElement {
  // rel dir path → listing; '' is the project root.
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [showGenerated, setShowGenerated] = useState(false);

  const loadDir = useCallback((rel: string, open = true) => {
    void window.bimax.files.list(rel)
      .then((entries) => setDirs((d) => ({ ...d, [rel]: { entries, open } })))
      .catch(() => setDirs((d) => ({ ...d, [rel]: { entries: [], open } })));
  }, []);

  // Root (re)load on project change; watcher refreshes every open directory in place.
  useEffect(() => {
    setDirs({});
    if (!project) return;
    loadDir('');
    const off = window.bimax.files.onChanged(() => {
      setDirs((d) => {
        for (const rel of Object.keys(d)) if (d[rel].open) loadDir(rel, true);
        return d;
      });
    });
    return off;
  }, [project, loadDir]);

  const root = dirs[''];
  const generatedCount = root?.entries.filter((entry) => GENERATED_ROOTS.has(entry.name)).length ?? 0;
  const visibleDirs = root && !showGenerated
    ? { ...dirs, '': { ...root, entries: root.entries.filter((entry) => !GENERATED_ROOTS.has(entry.name)) } }
    : dirs;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex shrink-0 items-center">
        <span className="text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">Files</span>
        {generatedCount > 0 && (
          <button
            onClick={() => setShowGenerated((value) => !value)}
            aria-pressed={showGenerated}
            className={cn(
              'ml-2 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[10px] transition-colors',
              showGenerated ? 'bg-ember/10 text-ember' : 'text-faint hover:bg-hover hover:text-ink',
            )}
            title={showGenerated ? 'Hide Bimax-generated workspace data' : 'Show Bimax-generated workspace data'}
          >
            <Database size={11} /> Generated {generatedCount}
          </button>
        )}
        <button
          onClick={() => loadDir('')}
          className="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-hover hover:text-ink"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!root ? (
          <div className="py-2 text-xs text-faint">Loading…</div>
        ) : root.entries.length === 0 ? (
          <div className="py-2 text-xs text-faint">Empty project.</div>
        ) : (
          <Tree rel="" dirs={visibleDirs} depth={0} onToggle={(r, open) => {
            if (open && !dirs[r]) loadDir(r);
            else setDirs((d) => (d[r] ? { ...d, [r]: { ...d[r], open } } : d));
          }} onSelect={onOpenFile} />
        )}
      </div>
    </div>
  );
}

function Tree({
  rel, dirs, depth, onToggle, onSelect,
}: {
  rel: string;
  dirs: Record<string, DirState>;
  depth: number;
  onToggle: (rel: string, open: boolean) => void;
  onSelect: (rel: string) => void;
}): React.ReactElement | null {
  const state = dirs[rel];
  if (!state) return null;
  return (
    <>
      {state.entries.map((e) => {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const open = dirs[childRel]?.open ?? false;
        return (
          <React.Fragment key={childRel}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => (e.dir ? onToggle(childRel, !open) : onSelect(childRel))}
              onKeyDown={(ev) => { if (ev.key === 'Enter') (e.dir ? onToggle(childRel, !open) : onSelect(childRel)); }}
              className="group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-[3px] text-left text-xs text-dim hover:bg-hover hover:text-ink"
              style={{ paddingLeft: `${6 + depth * 14}px` }}
              title={e.dir ? childRel : `${childRel} — open in editor`}
            >
              {e.dir ? (
                <>
                  {open ? <ChevronDown size={12} className="shrink-0 text-faint" /> : <ChevronRight size={12} className="shrink-0 text-faint" />}
                  <Folder size={13} className="shrink-0 text-ember/70" />
                </>
              ) : (
                <FileText size={13} className="ml-[14px] shrink-0 text-faint" />
              )}
              <span className={cn('min-w-0 truncate font-mono')}>{e.name}</span>
              {!e.dir && (
                <button
                  onClick={(ev) => { ev.stopPropagation(); insertIntoComposer(`@${childRel} `); }}
                  title="Insert @path into composer"
                  className="ml-auto hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded text-faint group-hover:flex hover:bg-line hover:text-ink"
                >
                  <AtSign size={11} />
                </button>
              )}
            </div>
            {e.dir && open && (
              <Tree rel={childRel} dirs={dirs} depth={depth + 1} onToggle={onToggle} onSelect={onSelect} />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
