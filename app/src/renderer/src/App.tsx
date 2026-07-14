import React, { useCallback, useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useEngine } from './useEngine';
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
import { GalleryView } from './components/GalleryView';
import { Footer } from './components/Footer';
import { Button } from './components/ui/button';

// Shift+Tab cycles agent modes — same order and gesture as the Go TUI.
const MODES = ['general', 'explore', 'sketch', 'code', 'beast'];

export function App(): React.ReactElement {
  const { state, submit, interrupt, sendCommand, query, reply, menuSelect, clearCompletions, configGet, configSet } = useEngine();
  const { status: gitStatus, refresh: refreshGit } = useGit(state.project);
  const busy = state.spinner.state !== 'idle' && state.spinner.state !== '';

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>('agents');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const resumeSession = useCallback((id: string) => {
    sendCommand(`/resume ${id}`);
    setView('chat');
  }, [sendCommand]);

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
          sendCommand(`/mode ${next}`);
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [state.mode, sendCommand, openTab, openFiles.length]);

  const showHome = view === 'chat' && state.items.length === 0 && !state.streaming && !state.thinking && !busy;
  const showEditor = dockOpen && rightMode === 'editor' && openFiles.length > 0;

  return (
    <div className="flex h-screen flex-col">
      <TitleBar
        project={state.project}
        engineState={state.engine.state}
        protocolMismatch={state.protocolMismatch}
        gitStatus={gitStatus}
        sidebarOpen={sidebarOpen}
        dockOpen={dockOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onToggleDock={() => setDockOpen((v) => !v)}
        onOpenReview={() => openTab('review')}
      />

      {state.engine.state === 'exited' && (
        <div className="flex shrink-0 items-center gap-3 border-b border-rust/30 bg-rust/10 px-4 py-2 text-[13px] text-rust">
          Engine exited ({state.engine.detail}).
          <Button size="sm" onClick={() => void window.bimax.restartEngine()}>
            Restart
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <Group orientation="horizontal" className="h-full">
          {sidebarOpen && (
            <>
              <Panel id="sidebar" defaultSize="17%" minSize="180px" maxSize="30%">
                <Sidebar
                  project={state.project}
                  snapshot={state.snapshot}
                  onNewTask={() => { sendCommand('/clear'); setView('chat'); }}
                  onOpenPalette={() => setPaletteOpen(true)}
                  onCommand={sendCommand}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenGallery={() => setView('gallery')}
                />
              </Panel>
              <Separator className="w-px bg-line hover:bg-ember/50 data-[separator-active]:bg-ember" />
            </>
          )}
          <Panel id="center" minSize="30%">
            <div className="flex h-full flex-col">
              {view === 'gallery' ? (
                <GalleryView project={state.project} onResume={resumeSession} onBack={() => setView('chat')} />
              ) : showHome ? (
                <HomeView
                  project={state.project}
                  sessionsTick={state.snapshot?.sessions?.length ?? 0}
                  onBrowseSessions={() => setView('gallery')}
                />
              ) : (
                <Transcript
                  items={state.items}
                  streaming={state.streaming}
                  thinking={state.thinking}
                  onMenuSelect={menuSelect}
                />
              )}
              {view !== 'gallery' && (
                <Composer
                  busy={busy}
                  mode={state.mode}
                  tier={state.tier}
                  snapshot={state.snapshot}
                  streamedChars={state.streamedChars}
                  completions={state.completions.items}
                  onSubmit={submit}
                  onInterrupt={interrupt}
                  onCommand={sendCommand}
                  onQuery={query}
                  onClearCompletions={clearCompletions}
                />
              )}
            </div>
          </Panel>
          {dockOpen && (
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
                <Panel id="dock" defaultSize="28%" minSize="220px" maxSize="50%">
                  <Dock
                    tab={dockTab}
                    onTab={setDockTab}
                    snapshot={state.snapshot}
                    subagents={state.subagents}
                    todos={state.todos}
                    project={state.project}
                    gitStatus={gitStatus}
                    onRefreshGit={refreshGit}
                    onCommand={sendCommand}
                    onOpenFile={openFile}
                    editorFileCount={openFiles.length}
                    onShowEditor={() => setRightMode('editor')}
                  />
                </Panel>
              )}
            </>
          )}
        </Group>
      </div>

      <Footer state={state} onOpenTab={openTab} />

      <CommandPalette
        open={paletteOpen}
        completions={state.completions.items}
        onClose={() => { setPaletteOpen(false); clearCompletions(); }}
        onQuery={query}
        onExec={sendCommand}
        onOpenTab={openTab}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onCommand={sendCommand}
        configGet={configGet}
        configSet={configSet}
      />

      {state.request && <RequestModal req={state.request} onReply={reply} />}
    </div>
  );
}
