import React, { useCallback, useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useEngine } from './useEngine';
import { useSupervisor } from './useSupervisor';
import { useGit } from './useGit';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { Dock, DockTab } from './components/Dock';
import { CommandPalette } from './components/CommandPalette';
import { Transcript } from './components/Transcript';
import { Composer } from './components/Composer';
import { RequestModal } from './components/RequestModal';
import { SettingsDialog } from './components/SettingsDialog';
import { EditorPane } from './components/EditorPane';
import { HomeView } from './components/HomeView';
import { ProjectWelcome } from './components/ProjectWelcome';
import { GalleryView } from './components/GalleryView';
import { Appearance, savedAppearance } from './appearance';

// Shift+Tab cycles agent modes — same order and gesture as the Go TUI.
const MODES = ['general', 'explore', 'sketch', 'code', 'beast'];

export function App(): React.ReactElement {
  const { state, submit, interrupt, setControls, sendCommand, query, reply, menuSelect, clearCompletions, configGet, configSet } = useEngine();
  const { status: supervisorStatus } = useSupervisor();
  const { status: gitStatus, refresh: refreshGit } = useGit(state.project);
  const busy = state.spinner.state !== 'idle' && state.spinner.state !== '';

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>('agents');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance);

  useEffect(() => {
    localStorage.setItem('bimax:appearance', appearance);
    document.documentElement.classList.remove('theme-graphite', 'theme-linen', 'theme-ink', 'theme-cloud', 'theme-midnight', 'theme-aurora');
    document.documentElement.classList.add(`theme-${appearance}`);
  }, [appearance]);

  // Center view: chat (default; shows Home while the transcript is empty) or the sessions gallery.
  const [view, setView] = useState<'chat' | 'gallery'>('chat');

  // Right pane: the dock's panels, or the IDE editor once files are opened from the tree.
  const [rightMode, setRightMode] = useState<'panels' | 'editor'>('panels');
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const openTab = useCallback((t: DockTab) => {
    setDockTab(t);
    setRightMode('panels');
    setDockOpen(true);
  }, []);

  const openFile = useCallback((rel: string) => {
    setOpenFiles((f) => (f.includes(rel) ? f : [...f, rel]));
    setActiveFile(rel);
    setRightMode('editor');
    setDockOpen(true);
  }, []);

  const closeFile = useCallback((rel: string) => {
    setOpenFiles((f) => {
      const next = f.filter((p) => p !== rel);
      setActiveFile((a) => (a === rel ? next[next.length - 1] ?? null : a));
      if (next.length === 0) setRightMode('panels');
      return next;
    });
  }, []);

  // New project → the open files belong to the old tree.
  useEffect(() => {
    setOpenFiles([]);
    setActiveFile(null);
    setRightMode('panels');
    setView('chat');
  }, [state.project]);

  // Typed protocol resume (v3 additive) — same engine code path as /resume, but no slash-command
  // text is synthesized by the UI.
  const resumeSession = useCallback((id: string) => {
    window.bimax.send({ t: 'resume', id });
    setView('chat');
  }, []);

  // Crash recovery lives in the main-process Engine Supervisor now: "Restart & resume" is a typed
  // recovery action; the supervisor restarts the engine, waits for the NEW child's ready (stale
  // generations are ignored), and sends a protocol-level `resume` — transcript and context both
  // come back from the session file (the single source of truth).

  // Global keyboard map: ⌘B sidebar, ⌘J dock, ⌘K palette, ⌘O project, ⌘T terminal,
  // ⌘E editor⇄panels, Shift+Tab mode cycle (outside inputs).
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'b') { e.preventDefault(); setSidebarOpen((v) => !v); return; }
      if (mod && key === 'j') { e.preventDefault(); setDockOpen((v) => !v); return; }
      if (mod && key === 'k') { e.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (mod && key === 'o') { e.preventDefault(); void window.bimax.pickFolder(); return; }
      if (mod && key === 't') { e.preventDefault(); openTab('terminal'); return; }
      if (mod && key === 'e' && openFiles.length > 0) {
        e.preventDefault();
        setRightMode((m) => (m === 'editor' ? 'panels' : 'editor'));
        setDockOpen(true);
        return;
      }
      if (e.key === 'Tab' && e.shiftKey && !mod) {
        const target = e.target as HTMLElement | null;
        const inField = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
        if (!inField) {
          e.preventDefault();
          // mode_change carries UPPERCASE labels ('' = general, 'PLAN' is governor, not a mode).
          const cur = MODES.indexOf((state.mode || 'general').toLowerCase());
          const next = MODES[(cur + 1) % MODES.length];
          setControls({ mode: next as 'general' | 'explore' | 'sketch' | 'code' | 'beast' });
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [state.mode, setControls, openTab, openFiles.length]);

  // Background project work (indexing, recovery, startup checks) must never turn an empty task
  // into a blank transcript. Keep the home canvas visible until conversation content exists.
  const showHome = view === 'chat' && state.items.length === 0 && !state.streaming && !state.thinking;
  const showEditor = dockOpen && rightMode === 'editor' && openFiles.length > 0;
  const hasProject = state.project.length > 0;
  const latestProblem = [...state.diagnostics].reverse().find((entry) => entry.level !== 'info');

  return (
    <div className={`theme-${appearance} flex h-screen flex-col`}>
      <TitleBar
        project={state.project}
        protocolMismatch={state.protocolMismatch}
        gitStatus={gitStatus}
        review={state.review}
        sidebarOpen={sidebarOpen}
        dockOpen={dockOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onToggleDock={() => setDockOpen((v) => !v)}
        onOpenReview={() => openTab('review')}
        appearance={appearance}
        onAppearance={setAppearance}
      />

      {hasProject && state.engine.state !== 'exited' && latestProblem?.level === 'error' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber/25 bg-amber/8 px-4 py-1.5 text-[12px] text-amber">
          <span className="min-w-0 flex-1 truncate">{latestProblem.text.replace(/engine/gi, 'Bimax').replace(/supervisor/gi, 'app')}</span>
          <button onClick={() => openTab('health')} className="cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium hover:bg-amber/10">
            Open support
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <Group orientation="horizontal" className="h-full">
          {hasProject && sidebarOpen && (
            <>
              <Panel id="sidebar" defaultSize="17%" minSize="180px" maxSize="30%">
                <Sidebar
                  project={state.project}
                  snapshot={state.snapshot}
                  // With durable threads, clearing is non-destructive (the thread stays in the
                  // sidebar, resumable) — so New task skips the confirm menu.
                  onNewTask={() => { sendCommand('/clear force'); setView('chat'); }}
                  onOpenPalette={() => setPaletteOpen(true)}
                  onResume={resumeSession}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenGallery={() => setView('gallery')}
                  activeTool={dockOpen && rightMode === 'panels' ? dockTab : null}
                  onOpenTool={openTab}
                  changedFiles={gitStatus?.files.length ?? 0}
                  runningAgents={state.subagents.filter((agent) => agent.status === 'running').length}
                />
              </Panel>
              <Separator className="w-px bg-line hover:bg-ember/50 data-[separator-active]:bg-ember" />
            </>
          )}
          <Panel id="center" minSize="30%">
            <div className="flex h-full flex-col">
              {!hasProject ? (
                <ProjectWelcome />
              ) : view === 'gallery' ? (
                <GalleryView project={state.project} onResume={resumeSession} onBack={() => setView('chat')} />
              ) : showHome ? (
                <HomeView
                  project={state.project}
                  sessionsTick={state.snapshot?.sessions?.length ?? 0}
                  onBrowseSessions={() => setView('gallery')}
                  onResume={resumeSession}
                />
              ) : (
                <Transcript
                  items={state.items}
                  streaming={state.streaming}
                  thinking={state.thinking}
                  onMenuSelect={menuSelect}
                />
              )}
              {hasProject && view !== 'gallery' && (
                <Composer
                  busy={busy}
                  mode={state.mode}
                  tier={state.tier}
                  snapshot={state.snapshot}
                  streamedChars={state.streamedChars}
                  completions={state.completions.items}
                  onSubmit={submit}
                  onInterrupt={interrupt}
                  onControls={setControls}
                  onCommand={sendCommand}
                  onQuery={query}
                  onClearCompletions={clearCompletions}
                  runtime={supervisorStatus}
                />
              )}
            </div>
          </Panel>
          {hasProject && dockOpen && (
            <>
              <Separator className="w-px bg-line hover:bg-ember/50 data-[separator-active]:bg-ember" />
              {/* Distinct ids: the editor deserves IDE width, panels stay compact; remounting on
                  mode switch applies each default without fighting the user's drag size. */}
              {showEditor ? (
                <Panel id="editor" defaultSize="46%" minSize="320px" maxSize="65%">
                  <EditorPane
                    open={openFiles}
                    active={activeFile}
                    project={state.project}
                    onSelect={setActiveFile}
                    onClose={closeFile}
                    onBackToPanels={() => setRightMode('panels')}
                  />
                </Panel>
              ) : (
                <Panel id="dock" defaultSize="34%" minSize="300px" maxSize="56%">
                  <Dock
                    tab={dockTab}
                    onTab={setDockTab}
                    snapshot={state.snapshot}
                    review={state.review}
                    subagents={state.subagents}
                    todos={state.todos}
                    project={state.project}
                    gitStatus={gitStatus}
                    onRefreshGit={refreshGit}
                    onCommand={sendCommand}
                    onOpenFile={openFile}
                    editorFileCount={openFiles.length}
                    onShowEditor={() => setRightMode('editor')}
                    diagnostics={state.diagnostics}
                    runtime={supervisorStatus}
                    onClose={() => setDockOpen(false)}
                  />
                </Panel>
              )}
            </>
          )}
        </Group>
      </div>

      {hasProject && <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false); clearCompletions(); }}
        onOpenTab={openTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewTask={() => { sendCommand('/clear force'); setView('chat'); }}
      />}

      {hasProject && <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenHealth={() => openTab('health')}
        configGet={configGet}
        configSet={configSet}
      />}

      {state.request && <RequestModal req={state.request} onReply={reply} />}
    </div>
  );
}
