/**
 * Phase 10.1 — per-task counters.
 *
 * These assert PROPERTIES of the recorder, not numbers. There is deliberately no "a form task takes
 * N turns" assertion anywhere here: the whole point of this module is to discover that number, and
 * a test that pinned it now would pin whatever today's behavior happens to be — which is exactly
 * how two perf regressions previously shipped green.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { taskMetrics } from '../telemetry/task.metrics';
import { globalTelemetry } from '../telemetry/telemetry';

describe('task metrics', () => {
  beforeEach(() => {
    taskMetrics.reset();
    globalTelemetry.reset();
  });

  it('records nothing when no task is live', () => {
    // The forward from globalTelemetry must be a no-op outside a task, not a crash and not a
    // phantom run — an idle process should never accumulate task rows.
    globalTelemetry.recordToolCall('BashTool', 5);
    globalTelemetry.recordUsage(100, 0, 0);
    expect(taskMetrics.isRecording).toBe(false);
    expect(taskMetrics.getRuns()).toHaveLength(0);
  });

  it('counts turns, tool calls and tokens for one task', () => {
    taskMetrics.begin();
    taskMetrics.recordTurn();
    taskMetrics.recordTurn();
    globalTelemetry.recordToolCall('ReadFileTool', 3);
    globalTelemetry.recordToolCall('ReadFileTool', 4);
    globalTelemetry.recordToolCall('EditFileTool', 9);
    globalTelemetry.recordUsage(1200, 800, 50);
    const run = taskMetrics.end();

    expect(run).toBeDefined();
    expect(run!.turns).toBe(2);
    expect(run!.toolCalls).toBe(3);
    expect(run!.toolCallsByName).toEqual({ ReadFileTool: 2, EditFileTool: 1 });
    expect(run!.promptTokens).toBe(1200);
    expect(run!.cacheReadTokens).toBe(800);
    expect(run!.cacheCreationTokens).toBe(50);
    expect(run!.interrupted).toBe(false);
  });

  it('keeps the session-wide aggregate and the per-task count in agreement', () => {
    // The forward lives inside globalTelemetry precisely so these cannot drift. If someone later
    // adds a second call site that counts a tool call only one of these two ways, this fails.
    taskMetrics.begin();
    globalTelemetry.recordToolCall('BashTool', 10);
    globalTelemetry.recordToolCall('BashTool', 12);
    const run = taskMetrics.end();

    const sessionBash = globalTelemetry.getToolStats().find(t => t.name === 'BashTool');
    expect(sessionBash!.count).toBe(run!.toolCallsByName.BashTool);
  });

  it('derives surface from the tools that actually ran', () => {
    const surfaceFor = (tools: string[]) => {
      taskMetrics.begin();
      for (const t of tools) globalTelemetry.recordToolCall(t, 1);
      return taskMetrics.end()!.surface;
    };

    expect(surfaceFor([])).toBe('none');
    expect(surfaceFor(['ComputerTool'])).toBe('computer');
    expect(surfaceFor(['BrowserTool'])).toBe('browser');
    expect(surfaceFor(['ReadFileTool', 'EditFileTool'])).toBe('code');
    expect(surfaceFor(['BashTool'])).toBe('shell');
    expect(surfaceFor(['ComputerTool', 'BashTool'])).toBe('mixed');
    // A tool in no surface family (TodoWriteTool) must not invent one.
    expect(surfaceFor(['TodoWriteTool'])).toBe('none');
  });

  it('attributes the computer backend from the tool family', () => {
    taskMetrics.begin();
    globalTelemetry.recordToolCall('ComputerTool', 1);
    expect(taskMetrics.end()!.computerBackend).toBe('compatibility');

    taskMetrics.begin();
    globalTelemetry.recordToolCall('NativeComputerObserveTool', 1);
    expect(taskMetrics.end()!.computerBackend).toBe('native');

    taskMetrics.begin();
    globalTelemetry.recordToolCall('ReadFileTool', 1);
    expect(taskMetrics.end()!.computerBackend).toBeUndefined();
  });

  it('does not let a nested task steal the outer turn count', () => {
    // A sub-agent running inside a task must not rebind the recorder: the outer task is the one the
    // "fewer turns" criterion is about, and a silent rebind would under-count it.
    taskMetrics.begin('outer');
    taskMetrics.recordTurn();
    taskMetrics.begin('inner');   // ignored
    taskMetrics.recordTurn();
    const run = taskMetrics.end();

    expect(run!.label).toBe('outer');
    expect(run!.turns).toBe(2);
    expect(taskMetrics.isRecording).toBe(false);
  });

  it('flags an interrupted task so a short turn count is not read as efficiency', () => {
    taskMetrics.begin();
    taskMetrics.recordTurn();
    taskMetrics.markInterrupted();
    expect(taskMetrics.end()!.interrupted).toBe(true);
  });

  it('excludes interrupted tasks from the summary', () => {
    taskMetrics.begin('form');
    for (let i = 0; i < 10; i++) taskMetrics.recordTurn();
    globalTelemetry.recordToolCall('ComputerTool', 1);
    taskMetrics.end();

    taskMetrics.begin('form');
    taskMetrics.recordTurn();               // one turn, but stopped early
    globalTelemetry.recordToolCall('ComputerTool', 1);
    taskMetrics.markInterrupted();
    taskMetrics.end();

    const summary = taskMetrics.summarize();
    const form = summary.find(s => s.label === 'form');
    expect(form!.tasks).toBe(1);
    expect(form!.medianTurns).toBe(10);     // not 5.5 — the abandoned task must not flatter it
  });

  it('summarizes with a median, so one pathological task cannot move the number', () => {
    for (const turns of [4, 5, 6, 5, 40]) {
      taskMetrics.begin('menu');
      for (let i = 0; i < turns; i++) taskMetrics.recordTurn();
      globalTelemetry.recordToolCall('ComputerTool', 1);
      taskMetrics.end();
    }
    const menu = taskMetrics.summarize().find(s => s.label === 'menu');
    expect(menu!.tasks).toBe(5);
    expect(menu!.medianTurns).toBe(5);      // mean would be 12
  });

  it('end() is safe with no live task', () => {
    expect(taskMetrics.end()).toBeUndefined();
  });

  describe('disk append', () => {
    const dir = path.join(os.tmpdir(), `bimax-task-metrics-${process.pid}-${Date.now()}`);
    const file = path.join(dir, 'task-runs.jsonl');

    afterEach(() => {
      delete process.env.BIMAX_TASK_METRICS;
      delete process.env.BIMAX_TASK_METRICS_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes nothing unless explicitly opted in', () => {
      process.env.BIMAX_TASK_METRICS_DIR = dir;
      taskMetrics.begin();
      taskMetrics.recordTurn();
      taskMetrics.end();
      expect(fs.existsSync(file)).toBe(false);
    });

    it('appends one JSON line per task when opted in', () => {
      process.env.BIMAX_TASK_METRICS = '1';
      process.env.BIMAX_TASK_METRICS_DIR = dir;

      taskMetrics.begin('form');
      taskMetrics.recordTurn();
      globalTelemetry.recordToolCall('ComputerTool', 1);
      taskMetrics.end();

      taskMetrics.begin('menu');
      taskMetrics.recordTurn();
      taskMetrics.recordTurn();
      taskMetrics.end();

      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]);
      const second = JSON.parse(lines[1]);
      expect(first.label).toBe('form');
      expect(first.surface).toBe('computer');
      expect(first.computerBackend).toBe('compatibility');
      expect(second.label).toBe('menu');
      expect(second.turns).toBe(2);
      // Every row must carry an id and a finish time, or a run cannot be joined to anything later.
      expect(typeof first.id).toBe('string');
      expect(typeof first.finishedAt).toBe('string');
    });

    it('an unwritable metrics dir never fails the task', () => {
      process.env.BIMAX_TASK_METRICS = '1';
      // A path whose parent is a FILE cannot be mkdir'd — the realistic form of a bad config.
      const blocker = path.join(os.tmpdir(), `bimax-blocker-${process.pid}-${Date.now()}`);
      fs.writeFileSync(blocker, 'not a directory');
      process.env.BIMAX_TASK_METRICS_DIR = path.join(blocker, 'metrics');

      try {
        taskMetrics.begin();
        taskMetrics.recordTurn();
        // The task must still close and still be retained in memory.
        const run = taskMetrics.end();
        expect(run).toBeDefined();
        expect(run!.turns).toBe(1);
        expect(taskMetrics.getRuns()).toHaveLength(1);
      } finally {
        fs.rmSync(blocker, { force: true });
      }
    });
  });
});
