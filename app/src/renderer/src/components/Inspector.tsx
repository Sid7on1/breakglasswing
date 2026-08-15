import React from 'react';
import {
  Activity, Bot, ChevronDown, CircleCheck, CircleX, Code2, FileText, FlaskConical,
  FolderTree, Globe2, Laptop, PanelRightClose, ReceiptText, Search, TerminalSquare,
} from 'lucide-react';
import { cn } from '../lib/cn';
import type { InspectorTab, InspectorTabId } from '../inspector.model';
import type { MacSession } from '../mac.session.model';
import type { BrowserSession } from '../browser.session.model';
import type { FinalReceipt as FinalReceiptModel } from '../final.receipt.model';
import type { ReviewSnapshot, SubAgentClaim, UiSnapshotCheckpoint } from '../protocol';
import type { GitStatusResult } from '../global';
import { ReviewPanel } from './ReviewPanel';
import { FilesPanel } from './FilesPanel';
import { LiveTarget } from './LiveTarget';
import { FinalReceipt } from './FinalReceipt';
import { TeamPanel } from './TeamPanel';
import { RuntimePanel } from './RuntimePanel';
import { EnvironmentPanel } from './EnvironmentPanel';
import { AlchemistPanel } from './AlchemistPanel';
import type { Phase9View } from '../usePhase9';

const LANE_META: Record<InspectorTabId, { description: string; icon: React.ReactNode }> = {
  code: { description: 'Diffs, checks and review evidence', icon: <Code2 size={15} /> },
  mac: { description: 'Live target, takeover and Mac evidence', icon: <Laptop size={15} /> },
  browser: { description: 'Research trail and page health', icon: <Globe2 size={15} /> },
  team: { description: 'Specialist work and shared progress', icon: <Bot size={15} /> },
  runtime: { description: 'Hardware-aware runtime decisions', icon: <Activity size={15} /> },
  environment: { description: 'Read-only developer environment map', icon: <TerminalSquare size={15} /> },
  alchemist: { description: 'Local model experiment readiness', icon: <FlaskConical size={15} /> },
  receipt: { description: 'Final proof and verification record', icon: <ReceiptText size={15} /> },
  files: { description: 'Project files and editor entry point', icon: <FolderTree size={15} /> },
};

/** One contextual Evidence Studio. Lanes live in a picker instead of fighting for a tab strip. */
export function Inspector({
  tabs, active, onTab, onClose,
  review, gitStatus, checkpoints, onRefreshGit, onCommand,
  project, onOpenFile,
  mac, onPause, onResume,
  browser, receipt, subagents, todos, phase9,
}: {
  tabs: InspectorTab[];
  active: InspectorTabId | null;
  onTab: (tab: InspectorTabId) => void;
  onClose: () => void;
  review: ReviewSnapshot | null;
  gitStatus: GitStatusResult | null;
  checkpoints: UiSnapshotCheckpoint[] | undefined;
  onRefreshGit: () => void;
  onCommand: (cmd: string) => void;
  project: string;
  onOpenFile: (rel: string) => void;
  mac: MacSession;
  onPause: () => void;
  onResume: () => void;
  browser: BrowserSession;
  receipt: FinalReceiptModel;
  subagents: SubAgentClaim[];
  todos: { content?: string; status?: string }[];
  phase9: Phase9View;
}): React.ReactElement {
  const activeTab = tabs.find((tab) => tab.id === active) ?? null;
  const meta = activeTab ? LANE_META[activeTab.id] : null;

  // No entrance animation of its own: App.tsx wraps this in a SeedRegion, which owns the transform.
  // A second animation on the same property is a race decided by declaration order.
  return (
    <aside className="evidence-studio glass-lens flex h-full min-w-0 flex-col border-l border-line" aria-label="Evidence Studio">
      <header className="evidence-studio-header">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="evidence-studio-icon" aria-hidden>{meta?.icon ?? <Search size={15} />}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[12.5px] font-semibold text-ink">{activeTab?.label ?? 'Evidence Studio'}</span>
              {activeTab?.count !== null && activeTab?.count !== undefined ? (
                <span className="evidence-count">{activeTab.count}</span>
              ) : null}
              {activeTab?.attention ? <span className="size-1.5 rounded-full bg-amber" aria-label="Needs attention" /> : null}
            </div>
            <div className="truncate text-[9.5px] text-faint">{meta?.description ?? 'Task context appears as Bimax produces it'}</div>
          </div>
        </div>

        <div className="relative shrink-0">
          <select
            aria-label="Choose evidence lane"
            value={active ?? ''}
            onChange={(event) => onTab(event.target.value as InspectorTabId)}
            className="evidence-lane-select"
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id} disabled={!tab.available}>
                {tab.label}{tab.count !== null ? ` · ${tab.count}` : ''}{tab.available ? '' : ' · empty'}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-faint" />
        </div>
        <button onClick={onClose} title="Hide the inspector (⌘J)" aria-label="Hide the inspector" className="evidence-close pressable">
          <PanelRightClose size={15} />
        </button>
      </header>

      <div
        role="tabpanel"
        aria-label={activeTab?.label ?? 'Evidence'}
        className={cn('min-h-0 flex-1 p-3 text-[12.5px]', active === 'code' || active === 'files' ? 'overflow-hidden' : 'overflow-y-auto')}
      >
        {!activeTab || !activeTab.available ? (
          <div className="inspector-empty">
            <Search size={17} />
            <div>{activeTab?.emptyReason ?? 'Evidence appears here as the task produces it.'}</div>
          </div>
        ) : activeTab.id === 'code' ? (
          <ReviewPanel status={gitStatus} review={review} refresh={onRefreshGit} onCommand={onCommand} checkpoints={checkpoints} />
        ) : activeTab.id === 'files' ? (
          <FilesPanel project={project} onOpenFile={onOpenFile} />
        ) : activeTab.id === 'mac' ? (
          <LiveTarget session={mac} onPause={onPause} onResume={onResume} />
        ) : activeTab.id === 'browser' ? (
          <BrowserLane browser={browser} />
        ) : activeTab.id === 'team' ? (
          <TeamPanel subagents={subagents} todos={todos} />
        ) : activeTab.id === 'runtime' ? (
          <RuntimePanel view={phase9} />
        ) : activeTab.id === 'environment' ? (
          <EnvironmentPanel view={phase9} />
        ) : activeTab.id === 'alchemist' ? (
          <AlchemistPanel view={phase9} />
        ) : (
          <FinalReceipt receipt={receipt} />
        )}
      </div>
    </aside>
  );
}

function BrowserLane({ browser }: { browser: BrowserSession }): React.ReactElement {
  const origin = browser.currentUrl ? safeOrigin(browser.currentUrl) : 'No live page';
  const healthy = browser.consoleErrors === 0 && browser.failedRequests === 0;
  return (
    <div className="space-y-3">
      <section className="browser-frame">
        <div className="browser-toolbar">
          <span className="browser-dot bg-rust/70" /><span className="browser-dot bg-amber/70" /><span className="browser-dot bg-moss/70" />
          <div className="browser-address" title={browser.currentUrl}>
            <Globe2 size={11} /><span>{origin}</span>
          </div>
          <span className={cn('browser-live', browser.active && 'browser-live--active')}>{browser.active ? 'live' : 'idle'}</span>
        </div>
        {browser.screenshot ? (
          <img src={`file://${encodeURI(browser.screenshot)}`} alt="Latest browser research page" className="browser-preview" />
        ) : (
          <div className="browser-preview-empty"><Globe2 size={23} /><span>A page preview appears after the first browser capture.</span></div>
        )}
        <div className="border-t border-line/70 px-3 py-2.5">
          <div className="truncate text-[12px] font-medium text-ink">{browser.currentTitle || 'Structured browser research'}</div>
          <div className="mt-0.5 truncate font-mono text-[9.5px] text-faint" title={browser.currentUrl}>{browser.currentUrl || 'Waiting for BrowserTool evidence'}</div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-1.5">
        <Metric label="Steps" value={browser.steps.length} tone="neutral" />
        <Metric label="Passed" value={browser.successfulSteps} tone="ok" />
        <Metric label="Health" value={healthy ? 'Clean' : browser.consoleErrors + browser.failedRequests} tone={healthy ? 'ok' : 'warn'} />
      </div>

      <section className="inspector-section">
        <div className="inspector-section-title"><Search size={13} /><span>Research trail</span></div>
        <ol className="space-y-1.5">
          {[...browser.steps].reverse().map((step, index) => (
            <li key={step.id} className="browser-step anim-fade-up" style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}>
              <span className={cn('browser-step-state', step.status === 'success' ? 'text-moss' : step.status === 'error' ? 'text-rust' : 'text-amber')}>
                {step.status === 'success' ? <CircleCheck size={13} /> : step.status === 'error' ? <CircleX size={13} /> : <Activity size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium capitalize text-ink">{step.action.replaceAll('_', ' ')}</span>
                  {step.elementCount !== null ? <span className="evidence-pill">{step.elementCount} targets</span> : null}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[9.5px] leading-relaxed text-faint">{step.summary || step.title || step.url || 'Browser step completed.'}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex items-start gap-2 rounded-xl border border-line bg-well px-3 py-2.5 text-[10px] leading-relaxed text-dim">
        <FileText size={12} className="mt-0.5 shrink-0 text-faint" />
        <span>Each step is derived from BrowserTool receipts. Bimax keeps indexed targets, screenshots and page health with the task instead of using generic Mac clicks.</span>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: 'neutral' | 'ok' | 'warn' }): React.ReactElement {
  return (
    <div className={cn('browser-metric', tone === 'ok' && 'browser-metric--ok', tone === 'warn' && 'browser-metric--warn')}>
      <span className="font-mono text-[13px] font-semibold text-ink">{value}</span>
      <span className="text-[8.5px] tracking-[0.08em] text-faint uppercase">{label}</span>
    </div>
  );
}

function safeOrigin(raw: string): string {
  try { return new URL(raw).host || raw; } catch { return raw; }
}
