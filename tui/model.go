package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/reflow/wordwrap"
)

// Bubble Tea messages wrapping engine events so they flow through Update like any other tea.Msg.
type engineMsg Outbound
type engineBatch []Outbound
type engineClosed struct{}

const transcriptWheelRows = 3

// tickMsg drives the chrome animation: the working-indicator elapsed clock and the
// thinking-phrase / dot rotation. Separate from the braille spinner.Tick (sub-second frames).
type tickMsg time.Time

func tickCmd(d time.Duration) tea.Cmd {
	return tea.Tick(d, func(t time.Time) tea.Msg { return tickMsg(t) })
}

// nextTick picks the animation cadence: 50ms while a turn is live (shimmer/pulse/elapsed clock all
// animate) or a resize is settling; 500ms when idle. An idle terminal app should be near-silent —
// the old unconditional 50ms tick woke the process 20×/s around the clock to redraw nothing (the
// heartbeat and status-expiry checks only need coarse ticks).
func (m model) nextTick() tea.Cmd {
	// Reduced motion: never run the 50ms animation cadence. The working line is static; the only
	// thing that changes is the whole-second elapsed clock, which 500ms ticks update precisely.
	if reducedMotion {
		return tickCmd(500 * time.Millisecond)
	}
	// Also run the fast cadence while sub-agents are working in the BACKGROUND — the parent turn may
	// have already ended (so m.working() is false), but their live panel still needs to animate.
	if m.working() || m.subAgentsRunning() {
		return tickCmd(50 * time.Millisecond)
	}
	return tickCmd(500 * time.Millisecond)
}

// subAgentsRunning reports whether any spawned sub-agent is still running — used to keep the animation
// cadence fast (and the panel live) even when the parent turn is idle.
func (m model) subAgentsRunning() bool {
	for _, s := range m.subagents {
		if s.Status == "running" {
			return true
		}
	}
	return false
}

// saSpinner returns the current braille frame for a running sub-agent, advanced off the 50ms chrome
// tick (~10fps). Static under reduced-motion so it never strobes for motion-sensitive users.
func (m model) saSpinner() string {
	if reducedMotion {
		return "●"
	}
	return brailleFrames[(m.thinkTick/2)%len(brailleFrames)]
}

// pasteChip is a collapsed multi-line paste: shown as "[Pasted text #N +L lines]" in the input and
// expanded back to its real text on submit (Claude-Code style).
type pasteChip struct {
	ID          int
	Lines       int
	Text        string
	Placeholder string
}

// brailleFrames is WorkingIndicator.tsx's spinner — cycled while a turn streams.
var brailleFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// spinnerVerbs — BiMax's own working vocabulary: calm, craftsmanlike, engineering-flavored.
// Deliberately short and curated (not a borrowed novelty list): every word should read like
// something a focused engineer is actually doing.
var spinnerVerbs = []string{
	"Thinking", "Tracing", "Mapping", "Weighing", "Sketching",
	"Wiring", "Shaping", "Sifting", "Stitching", "Tuning",
	"Distilling", "Untangling", "Surveying", "Charting", "Drafting",
	"Refining", "Assembling", "Balancing", "Reading", "Indexing",
	"Connecting", "Composing", "Measuring", "Polishing", "Aligning",
	"Focusing", "Resolving", "Verifying", "Reasoning", "Considering",
	"Piecing", "Planning", "Scanning", "Weaving", "Working",
	"Grounding", "Sequencing", "Sharpening", "Threading", "Calibrating",
}

// waitForEngine blocks on the engine channel and delivers the next message as a tea.Msg. Re-issued
// after every engine message so the stream is continuous — the standard Bubble Tea external-IO loop.
func waitForEngine(e *Engine) tea.Cmd {
	return func() tea.Msg {
		first, ok := <-e.Msgs
		if !ok {
			return engineClosed{}
		}
		// Coalesce every message ALREADY queued (a fast model floods stream_token events) into one
		// batch so Update re-renders ONCE per burst, not once per token. Without this the view
		// re-renders the whole transcript thousands of times for a single response — the engine
		// finishes in seconds but the TUI takes minutes to drain, and "Generating" hangs the whole time.
		batch := engineBatch{first}
		for len(batch) < 1024 {
			select {
			case m, ok := <-e.Msgs:
				if !ok {
					return batch // channel closed mid-drain; the next call's blocking read returns engineClosed
				}
				batch = append(batch, m)
			default:
				return batch // nothing more immediately available
			}
		}
		return batch
	}
}

type model struct {
	engine *Engine
	vp     viewport.Model
	input  textarea.Model // multi-line: Enter submits, Ctrl+J inserts a newline (paste code blocks)
	spin   spinner.Model  // animated while a turn runs (busy); idle otherwise

	// input history — up/down recalls past submissions (a ring buffer). histIdx == len(history)
	// means "editing a fresh line"; histStash holds that in-progress line while browsing back.
	history   []string
	histIdx   int
	histStash string

	lines   []string // the committed transcript (single source of truth; rendered by the viewport View, searched by Ctrl+F)
	started bool     // true once any transcript line has been emitted (for inter-turn spacing)
	// Alt-screen viewport scroll: 0 = pinned to the bottom (live tail); >0 = rows scrolled up into
	// the transcript. Clamped in View; PgUp/PgDn drive it. New content keeps the position stable
	// unless pinned to bottom (scrollOff == 0), which follows the live tail.
	scrollOff int
	// Tool calls for the current consecutive run, in START order, each updated IN PLACE by id as its
	// result arrives (pending → running → done/error). One ordered list — not two groups — so a tool
	// occupies a single fixed slot for its whole lifecycle and never jumps position when it resolves;
	// it just fills in (header → header + summary + diff). Running tools stay live in View; the
	// finished leading prefix commits to scrollback when non-tool content lands (flushToolRun), where
	// a long boring burst collapses to category counts ("⏺ 7 tools · 4 reads"). Ctrl+B toggles collapse.
	turnTools     []ToolCall
	collapseTools bool
	flushing      bool   // guard: flushToolRun appends via m.append, which must not re-enter the flush
	stream        string // in-flight assistant tokens for the current turn (full accumulation)
	// Progressive streaming: closed markdown blocks are committed to native scrollback as they
	// complete (formatted once, never to reflow), leaving only the trailing OPEN block live in
	// View. streamCommitted is the byte offset into stream already committed; turnAnswerStarted
	// tracks whether the turn's leading ⏺ marker + "Thought" line have been emitted yet.
	streamCommitted   int
	turnAnswerStarted bool
	status            string
	ready             bool
	terminalSized     bool
	// engine heartbeat — pingSeq numbers the probes; pingOutstanding is when the unanswered probe
	// went out (zero = none in flight); engineGone stops probing once the pipe closes; engineStalled
	// makes the "not responding" alarm fire once instead of every 50ms tick.
	pingSeq         int
	lastPingSent    time.Time
	pingOutstanding time.Time
	engineGone      bool
	engineStalled   bool
	busy            bool   // a turn is executing — Ctrl+C cancels it instead of quitting
	interrupting    bool   // interrupt sent, turn not yet ended → indicator shows "Stopping…" (truthful state)
	quitting        bool   // engine asked us to shut down — quit after this message
	cwd             string // working directory, updated by cwd_changed
	width           int
	height          int

	// live task list (todo_update). Rendered as a checklist panel; deduped so repeated identical
	// updates don't spam the transcript.
	todos          []TodoItem
	lastTodoRender string

	// live sub-agent coverage (subagent_update). Pinned as a live panel while any sub-agent runs.
	subagents []SubAgent
	// per-agent tool activity, keyed by the spawn taskId. Sub-agent tool calls (parentId set) are
	// routed HERE — nested under their agent — instead of the parent's flat turnTools run, so the
	// panel can show each agent's live action + full tool list without polluting the transcript.
	subAgentTools map[string][]ToolCall
	saSel         int             // selected agent row in the panel (for keyboard expand)
	saExpanded    map[string]bool // taskId → is this agent's card expanded
	saFocus       bool            // panel has keyboard focus (ctrl+a); ↑/↓ select, enter expand

	// task workspaces (ui_snapshot.tasks): background shell/browser/build tasks with an honest
	// action set. Rendered as a pinned bottom panel; Ctrl+E focuses it for keyboard actions.
	fTasks  []TaskStrip
	tkFocus bool // task panel has keyboard focus (ctrl+e); ↑/↓ select, action keys act
	tkSel   int  // selected task row while focused

	// pending approval (from a `request` message)
	reqOpen     bool
	reqID       int
	reqQ        string
	reqOpts     []string
	reqKind     string // "prompt" | "diff"
	reqBody     string // diff text for kind:"diff"
	reqIdx      int
	reqScroll   int // diff-approval scroll offset (PgUp/PgDn) so large diffs are reviewable
	reqIsMulti  bool
	reqSelected map[int]bool

	// autocomplete (slash commands + @-mentions), served by the engine
	comps    []CompletionItem
	compIdx  int
	compOpen bool
	queryID  int
	compSeq  int // debounce sequence: a newer keystroke invalidates an in-flight completion timer

	// interactive menu (command palette, pickers) — selecting sends the option's value as input.
	// menuFilter fuzzy-filters menuOpts as the user types (Ink InteractiveMenu enableSearch).
	menuOpen     bool
	menuID       string // correlates a selection back to the engine's onSelect (menuSelect message)
	menuTitle    string
	menuSubtitle string
	menuOpts     []menuOption
	menuIdx      int
	menuFilter   string
	// Category tabs: derived from the options' Category fields on open (order of first appearance).
	// menuTab 0 = "All"; >0 filters to menuTabs[menuTab]. ←/→ or Tab cycles.
	menuTabs []string
	menuTab  int

	// multi-line paste chips (SimpleInput.tsx): pastes holds the collapsed blobs; expanded on submit.
	pastes       []pasteChip
	pasteCounter int

	// input stash (Esc stashes the current line, Ctrl+R restores it).
	stash string

	// prompts submitted while a turn is running — dispatched one-by-one as each turn ends.
	queued []string

	// transcript/log search (Ctrl+F). searchSaved holds the input swapped out while searching.
	searchMode  bool
	searchQuery string
	searchIdx   int
	searchSaved string

	// structured log view (Ctrl+O toggles it in place of the transcript).
	showLogs    bool
	showFullMap bool
	// mind HUD overlay (Ctrl+X): the ◇ chip's explainable panel — weak spots with posterior
	// stats, drives with sparklines, compiled habits (v2 §3.11).
	showMind bool
	// Active HUD tab: 0 = overview (all sections), then weak spots / drives / ledger / habits.
	// Tab cycles forward, Shift+Tab back, while the HUD is open.
	mindTab int
	logs    []LogEntry

	// masked free-form prompt (API keys): render the typed value as bullets in promptView.
	reqMasked bool

	// codebase-map panel + token meter, fed by ui_snapshot.
	graph       GraphSummary
	ctxWindow   int
	ctxBaseline int // system prompt + tool schemas (fixed per-request cost), from ui_snapshot
	ctxSaved    int // cumulative tokens saved by Headroom backlog compression, from ui_snapshot
	histTokens  int // running estimate of the conversation tokens (sum of message contents / 4)

	// animation state (driven by tickMsg): per-turn elapsed clock + thinking phrase/dot rotation.
	busyStart   time.Time
	lastTokenAt time.Time
	elapsed     int
	phraseIdx   int
	thinkTick   int
	thinkDots   int
	thinkSnip   string
	thinkBuf    string // rolling tail of the model's live reasoning stream (rendered while thinking)
	sessionVerb string

	// thought-clock: measure reasoning time Go-side (the headless engine doesn't emit thoughtMs).
	// Clock starts on the first `thinking` token, stops at the first answer token; surfaced as the
	// "✻ Thought for Ns" line on the next assistant message.
	turnThinkStart time.Time
	turnThoughtMs  int

	bell bool // emit a terminal bell when a turn completes

	welcomed bool // the low-chrome welcome banner has been shown once at the top of the transcript
	// The banner waits for the first ui_snapshot after `ready` so it can name the model slots —
	// `ready` arrives first and rendering there showed "not chosen yet" to configured users. If no
	// snapshot lands by this deadline (old engine), the tick shows the banner anyway.
	welcomeBy time.Time
	// Exact consecutive system messages can arrive from both the command result and a live config
	// event. Keep one copy in scrollback; reset on any user/assistant message.
	lastSystemContent string

	// footer state (mirrors Ink's Footer.tsx)
	fTier      string         // "lite" | "heavy"
	fPinned    string         // pinned tier, if any
	fMode      string         // governor / agent mode
	fTokens    int            // running session token estimate
	fCoding    string         // coding model id
	fLite      string         // lite model id
	fVision    string         // vision model id ('' = no vision slot)
	fGoals     int            // active goal count
	fMcp       int            // connected (non-disabled) MCP server count
	fMind      MindStrip      // mind layer: weak spots / drive deviations / compiled habits
	fWorkspace WorkspaceStrip // multi-repo workspace: repo count/names for the status chip
	fComputer  *ComputerStrip // computer-use posture: live browser page / desktop driver / taint
	fOutcome   *OutcomeStrip  // active engine-owned outcome contract; nil for chat/simple questions

	// statusExpiry: when non-zero, the footer status reverts to "Ready" once this time passes. Used
	// for ephemeral one-liners (e.g. mode switches) that shouldn't linger or clutter the transcript.
	statusExpiry time.Time
}

func initialModel(e *Engine) model {
	ta := textarea.New()
	ta.Placeholder = "Ask BiMax…"
	ta.Prompt = "❯ "
	ta.CharLimit = 0
	ta.ShowLineNumbers = false
	ta.SetHeight(1) // grows up to inputMaxRows as the user adds lines
	// The bubbles default focused style paints CursorLine with a solid black background and fills the
	// end-of-buffer — which renders as a "black box" inside the input and a stray box at the right.
	// Strip all of that so the field is just the accent caret + bright text on the terminal bg.
	clean := func(s textarea.Style) textarea.Style {
		s.Base = lipgloss.NewStyle()
		s.CursorLine = lipgloss.NewStyle()
		s.CursorLineNumber = lipgloss.NewStyle()
		s.EndOfBuffer = lipgloss.NewStyle()
		s.Prompt = caretStyle
		s.Text = asstStyle
		s.Placeholder = subtleStyle
		return s
	}
	ta.FocusedStyle = clean(ta.FocusedStyle)
	ta.BlurredStyle = clean(ta.BlurredStyle)
	// Enter submits (handled in Update before the textarea sees it); Ctrl+J inserts a newline so
	// a pasted code block stays one input.
	ta.KeyMap.InsertNewline = key.NewBinding(key.WithKeys("ctrl+j"))
	ta.Focus()

	sp := spinner.New()
	// Braille frames at ~12fps, matching WorkingIndicator.tsx.
	sp.Spinner = spinner.Spinner{Frames: brailleFrames, FPS: time.Second / 12}
	sp.Style = workFrame

	hist := loadHistory()
	vp := viewport.New(80, 20) // kept only for render-width math (renderMarkdown etc.)
	return model{
		engine:        e,
		input:         ta,
		spin:          sp,
		history:       hist,
		histIdx:       len(hist),
		vp:            vp,
		collapseTools: true,
		subAgentTools: map[string][]ToolCall{},
		saExpanded:    map[string]bool{},
		status:        "Starting engine…",
		sessionVerb:   spinnerVerbs[time.Now().UnixNano()%int64(len(spinnerVerbs))],
		bell:          os.Getenv("BIMAX_ENABLE_NOTIFICATIONS") != "0",
		// Seed the default mode so the footer chip shows "GENERAL" from the first frame (a fresh
		// terminal starts in general mode — it just wasn't displayed before).
		fMode: "general",
		fMcp:  countMcpServers(cwdOrWD("")),
	}
}

// cwdOrWD returns p if set, else the process working directory (best-effort "").
func cwdOrWD(p string) string {
	if p != "" {
		return p
	}
	wd, _ := os.Getwd()
	return wd
}

func (m model) Init() tea.Cmd {
	return tea.Batch(
		waitForEngine(m.engine),
		textarea.Blink,
		m.spin.Tick,
		m.nextTick(),
	)
}

// Update delegates to the real handler. The alternate-screen renderer needs no commit/flush
// wrapper: the transcript lives in m.lines and every frame is a pure function of state (View),
// so committed output is never cleared, reprinted, or repaired — resize simply reflows state.
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	return m.update(msg)
}

func indentAwareWrap(text string, width int) string {
	var out []string
	lines := strings.Split(text, "\n")
	for _, line := range lines {
		clean := ansi.Strip(line)

		// A line that already fits within `width` is left EXACTLY as-is. This matters for content that
		// is pre-laid-out and hard-clamped to its own budget (diff rows: line-number gutter + green/red
		// background padded to a fixed width). Word-wrapping such a line at `width - indentStr` would
		// re-break it 1–2 cells early and spill its coloured background onto a bogus continuation row at
		// column 0 (the "green bleeds to the far left" bug). Only genuinely over-wide lines get wrapped.
		if lipgloss.Width(line) <= width {
			out = append(out, line)
			continue
		}

		indentStr := ""
		if strings.HasPrefix(clean, "● ") || strings.HasPrefix(clean, "❯ ") {
			indentStr = "  "
		} else {
			for _, r := range clean {
				if r == ' ' {
					indentStr += " "
				} else {
					break
				}
			}
		}

		if indentStr == "" || len(indentStr) >= width/2 {
			out = append(out, wordwrap.String(line, width))
			continue
		}

		// Wrap at a slightly narrower width to leave room for the injected indent on wrapped lines.
		wrapped := wordwrap.String(line, width-len(indentStr))
		parts := strings.Split(wrapped, "\n")

		// The first line natively has the original indent (e.g. "⏺ " or "  ").
		// We manually inject the matching indent into all subsequent lines created by the wrap.
		for i := 1; i < len(parts); i++ {
			parts[i] = indentStr + parts[i]
		}
		out = append(out, strings.Join(parts, "\n"))
	}
	return strings.Join(out, "\n")
}

func (m model) update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		prevWidth := m.width
		m.width, m.height = msg.Width, msg.Height
		m.vp.Width = msg.Width // kept only for render-width math (renderMarkdown etc.)
		m.input.SetWidth(msg.Width - 6)

		if m.width == 0 || m.height == 0 {
			return m, nil
		}

		if !m.terminalSized {
			m.terminalSized = true
			return m, nil
		}

		// Alternate-screen renderer: resize is a pure REFLOW of state. View() re-wraps the
		// transcript from its logical lines at the new width on the next frame; nothing is
		// cleared, reprinted, or repaired, and no settle/debounce machinery exists.
		_ = prevWidth
		return m, nil

	case spinner.TickMsg:
		// Animate (and re-arm) only while something is actually moving — when the turn ends the
		// chain dies here and is restarted by the engineMsg/engineBatch handlers the moment work
		// resumes. Idle means idle: no 12fps wakeups to paint a spinner nobody can see.
		if !m.working() {
			return m, nil
		}
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd

	case compTickMsg:
		// Debounce window elapsed: query the engine only if no newer keystroke superseded this tick.
		if msg.seq == m.compSeq {
			m.queryID++
			m.engine.Send(encodeQuery(m.queryID, msg.text))
		}
		return m, nil

	case tickMsg:
		// Welcome fallback: `ready` arrived but no ui_snapshot followed within the deadline
		// (pre-snapshot engine) — show the banner without model details rather than never.
		if !m.welcomeBy.IsZero() && time.Now().After(m.welcomeBy) {
			m.welcomeBy = time.Time{}
			m.showWelcome()
		}
		// 50ms animation chrome: elapsed clock + smooth shimmer/pulse animation.
		if m.busy && !m.busyStart.IsZero() {
			m.elapsed = int(time.Since(m.busyStart).Seconds())
		}
		if m.thinkTick%10 == 0 {
			m.thinkDots = (m.thinkDots + 1) % 4
		}
		m.thinkTick++
		// Expire an ephemeral status one-liner (mode switches etc.) back to idle.
		if !m.statusExpiry.IsZero() && time.Now().After(m.statusExpiry) {
			m.status = "Ready"
			m.statusExpiry = time.Time{}
		}
		// Heartbeat: probe the engine every 10s once ready. ANY inbound traffic proves liveness
		// (handleEngine clears the outstanding probe), so this only trips when the engine's event
		// loop is genuinely wedged or the process is a zombie whose pipe never closed — turning an
		// endless spinner into an actionable footer alarm.
		if m.ready && !m.engineGone && !m.quitting {
			now := time.Now()
			switch {
			case m.pingOutstanding.IsZero() && now.Sub(m.lastPingSent) > 10*time.Second:
				m.pingSeq++
				m.engine.Send(encodePing(m.pingSeq))
				m.lastPingSent = now
				m.pingOutstanding = now
			case !m.pingOutstanding.IsZero() && now.Sub(m.pingOutstanding) > 15*time.Second && !m.engineStalled:
				m.engineStalled = true
				m.status = "Engine not responding — Ctrl+C to quit if stuck"
			}
		}
		return m, m.nextTick()

	case tea.KeyMsg:
		return m.handleKey(msg)

	case tea.MouseMsg:
		// The alternate screen has no native terminal scrollback. Wheel and trackpad gestures must
		// therefore move the transcript's own viewport; otherwise only PgUp/PgDn can reach history.
		switch tea.MouseEvent(msg).Button {
		case tea.MouseButtonWheelUp:
			m.scrollOff += transcriptWheelRows
		case tea.MouseButtonWheelDown:
			m.scrollOff -= transcriptWheelRows
			if m.scrollOff < 0 {
				m.scrollOff = 0
			}
		}
		return m, nil

	case engineMsg:
		wasWorking := m.working()
		m.handleEngine(Outbound(msg))
		if m.quitting { // engine emitted `shutdown` — exit cleanly
			m.engine.Close()
			return m, tea.Quit
		}
		// Work just started: restart the spinner chain (it dies while idle — see spinner.TickMsg).
		if !wasWorking && m.working() {
			return m, tea.Batch(waitForEngine(m.engine), m.spin.Tick)
		}
		return m, waitForEngine(m.engine) // keep listening

	case engineBatch:
		// Apply a coalesced burst, then render once (see waitForEngine).
		wasWorking := m.working()
		for _, o := range msg {
			m.handleEngine(o)
			if m.quitting {
				m.engine.Close()
				return m, tea.Quit
			}
		}
		if !wasWorking && m.working() {
			return m, tea.Batch(waitForEngine(m.engine), m.spin.Tick)
		}
		return m, waitForEngine(m.engine)

	case engineClosed:
		m.engineGone = true // stop the heartbeat — there is nothing left to probe
		m.status = "Engine exited"
		if !m.ready {
			// Died during boot — surface the REAL cause (from the engine log), not just the symptom.
			// This is the difference between a baffling "engine exited" and an actionable error.
			m.append(errStyle.Render("— Engine failed to start —"))
			if tail := engineLogTail(12); tail != "" {
				m.append(errStyle.Render(tail))
			}
			if hasEmbeddedEngine() {
				m.append(errStyle.Render("Full log: " + engineLogPath()))
			} else {
				// Dev build only — source-tree remediation would be nonsense for an installed binary.
				m.append(errStyle.Render("Hint: try `npm run build`; if node_modules looks corrupt (iCloud can do this on ~/Desktop) reinstall it. Full log: " + engineLogPath()))
			}
		} else {
			m.append(errStyle.Render("— Engine exited —"))
		}
		return m, nil
	}

	return m, nil
}

func (m *model) handleEngine(o Outbound) {
	// Any inbound traffic proves the engine is alive — not just a pong. A busy engine streaming
	// tokens must never trip the heartbeat alarm, and a recovered one clears it here.
	m.pingOutstanding = time.Time{}
	if m.engineStalled {
		m.engineStalled = false
		if !m.busy {
			m.status = "Ready"
		}
	}
	switch o.T {
	case "pong":
		// Liveness bookkeeping above is the whole job.

	case "boot":
		// Startup phases stream in before `ready`. Surface them so a slow cold start (the 85MB
		// engine paging in under memory pressure) reads as visible progress, not a frozen spinner.
		if !m.ready {
			m.status = "Starting engine… " + bootPhaseLabel(o.Phase)
		}

	case "ready":
		m.ready = true
		m.status = "Ready"
		// Version-check the handshake: a stale engine build (or TUI binary) would otherwise fail as
		// baffling garbled/dropped messages. Protocol==0 means a pre-versioning engine — let it pass.
		if o.Protocol != 0 && o.Protocol != supportedProtocol {
			m.append(errStyle.Render(fmt.Sprintf(
				"⚠ Protocol mismatch: engine speaks v%d, this TUI speaks v%d — rebuild both (npm run build + go build ./tui) so they realign.",
				o.Protocol, supportedProtocol)))
		}
		// Don't render the banner yet: the first ui_snapshot (which carries the model slots) is
		// right behind this event — rendering now showed "model not chosen yet" to a fully
		// configured session. The snapshot handler shows it; the tick fallback covers an engine
		// that never sends one.
		m.welcomeBy = time.Now().Add(2 * time.Second)

	case "request":
		m.reqOpen = true
		m.reqID = o.ID
		m.reqQ = o.Question
		m.reqOpts = o.Options
		m.reqKind = o.Kind
		m.reqBody = o.Body
		m.reqIdx = 0
		m.reqScroll = 0
		m.reqIsMulti = o.IsMulti
		m.reqSelected = make(map[int]bool)
		// The turn-complete bell (events.go) never fires mid-turn: a multi-step gated task (e.g.
		// ComputerTool's open→observe→type→observe→key→close) needs several APPROVALS deep into one
		// long-running turn, each arriving after minutes of model reasoning between steps. Without
		// an audible cue here, only the FIRST approval — the one that lands while the user is still
		// watching right after they submit — ever gets noticed; later ones sit silently,
		// indistinguishable from the whole thing hanging.
		if m.bell {
			fmt.Print("\a")
		}
		// Masking is a wire contract (request.masked); the question-text regex stays only as a
		// safety net for engines older than the flag — a secret should never hinge on wording.
		m.reqMasked = o.Kind == "input" && (o.Masked || secretRE.MatchString(o.Question))

	case "queryResult":
		if o.ID == m.queryID { // ignore stale results from earlier keystrokes
			m.comps = o.Items
			m.compIdx = 0
			m.compOpen = len(o.Items) > 0
			m.relayout()
		}

	case "event":
		m.handleEvent(o)
	}
}

// append commits a transcript line: QUEUED for the terminal's native scrollback (flushed via
// tea.Println by the Update wrapper) and also kept in a bounded in-memory slice for Ctrl+F search.
// We never re-render committed lines — the terminal owns the visible transcript + its native scrollbar.
const (
	transcriptCap  = 2000
	transcriptKeep = 1500
)

func (m *model) append(line string) {
	// Any non-tool content marks the end of a consecutive tool run — flush it (collapsed or expanded)
	// so it lands in the transcript BEFORE this line, preserving order. Guarded against re-entry since
	// the flush itself appends.
	if !m.flushing {
		m.flushToolRun()
	}
	m.started = true
	m.lines = append(m.lines, line)
	if len(m.lines) > transcriptCap {
		drop := len(m.lines) - transcriptKeep
		m.lines = append(m.lines[:0:0], m.lines[drop:]...) // keep the tail in a fresh backing array
	}
}

// relayout / refresh are no-ops — the transcript is state (m.lines) and every frame re-derives the
// visible window from it, so there is no separate viewport buffer to rebuild. Kept so the many
// existing m.relayout()/m.refresh() call sites don't need touching.
func (m *model) relayout() {}
func (m *model) refresh()  {}

// chromeLines is the live region below the committed transcript: the pending (un-flushed) tool run +
// any in-flight running tool calls, then the ambient chrome (search/log panel, menu/completion
// dropdown, working/thinking indicator, task list, compact map, token meter, prompt box, footer).
func (m model) chromeLines() []string {
	var c []string
	// The whole current tool run — running and finished — in one start-ordered list, so each tool
	// holds its slot and fills in place. The finished leading prefix leaves for scrollback on flush.
	if tr := m.toolRunLive(); tr != "" {
		c = append(c, strings.Split(tr, "\n")...)
	}
	return append(c, m.belowSections()...)
}

// View renders the alternate-screen frame: the committed transcript re-wrapped at the CURRENT
// width (resize REFLOWS state — committed output is never cleared, reprinted, or repaired), then
// the live open stream block, with the chrome pinned at the bottom. Every frame is a pure
// function of model state, so there is no cursor math to desync and no ghost frames to repair.
func (m model) View() string {
	// Chrome (pinned at the bottom): pending tool run + panels + prompt + footer.
	chrome := strings.Join(m.chromeLines(), "\n")
	if m.width > 1 {
		// No chrome row may reach the last column (terminal auto-wrap would desync row math).
		chrome = ansi.Hardwrap(chrome, m.width-1, true)
	}
	chromeRows := strings.Split(chrome, "\n")

	// Body: the committed transcript (logical lines, re-wrapped at the current width every frame)
	// plus the trailing OPEN markdown block of the in-flight answer.
	var body []string
	for _, line := range m.lines {
		if m.width > 2 {
			body = append(body, strings.Split(indentAwareWrap(line, m.width-2), "\n")...)
		} else {
			body = append(body, line)
		}
	}
	if m.streamCommitted <= len(m.stream) {
		if open := m.stream[m.streamCommitted:]; strings.TrimSpace(open) != "" {
			md := indentLines(renderMarkdown(open), "  ")
			if !m.turnAnswerStarted {
				md = caretStyle.Render("● ") + strings.TrimPrefix(md, "  ")
			}
			if m.width > 1 {
				md = ansi.Hardwrap(md, m.width-1, true)
			}
			body = append(body, strings.Split(md, "\n")...)
		}
	}

	// Fit: chrome keeps the bottom (clipped from its own top only on tiny terminals); the
	// transcript window gets the remaining rows, honoring the scroll offset (0 = live tail).
	if m.height > 0 {
		for len(chromeRows) > 1 && len(chromeRows) > m.height {
			chromeRows = chromeRows[1:]
		}
	}
	avail := len(body)
	if m.height > 0 {
		avail = m.height - len(chromeRows)
		if avail < 0 {
			avail = 0
		}
	}
	maxOff := len(body) - avail
	if maxOff < 0 {
		maxOff = 0
	}
	off := m.scrollOff
	if off > maxOff {
		off = maxOff
	}
	start := len(body) - avail - off
	if start < 0 {
		start = 0
	}
	window := body[start : len(body)-off]

	rows := make([]string, 0, len(window)+len(chromeRows)+1)
	rows = append(rows, window...)
	if off > 0 {
		// Scrolled away from the live tail: say so, and how to get back.
		rows = append(rows, dimStyle.Render(fmt.Sprintf("  ▲ scrolled up %d line(s) — PgDn to return to the live view", off)))
		if m.height > 0 && len(rows)+len(chromeRows) > m.height && len(rows) > 1 {
			rows = rows[1:] // keep the frame within the terminal height
		}
	}
	rows = append(rows, chromeRows...)
	return strings.Join(rows, "\n")
}

// belowSections is everything rendered below the transcript viewport, top → bottom, mirroring Ink's
// FullScreen: the search/log panel, the live working/thinking + dropdown/menu region, a blank
// spacer, the codebase-map panel, the token meter, the prompt box, and the footer. Shared by View
// (to render) and refresh (to size the viewport against the real chrome height, so the frame never
// overflows the terminal — the source of the ghost/stuck-frame artifacts).
func (m model) belowSections() []string {
	var s []string
	if m.searchMode {
		s = append(s, m.searchView())
	} else if m.showLogs {
		s = append(s, m.logView())
	}
	// A blank line above an open menu / completion dropdown so it reads as a distinct panel instead
	// of butting straight up against the last transcript line (the "menu sticks to the text" report).
	if m.menuOpen || (m.compOpen && len(m.comps) > 0) {
		s = append(s, "")
	}
	// The mid-region (menu/completion/working-indicator) is only a row when there's something to show;
	// when idle it's blank, so skip it rather than pinning an empty status line above the input (P5 —
	// keeps the bottom chrome compact instead of a tall stack of near-empty rows).
	if mv := m.midView(); strings.TrimSpace(mv) != "" {
		s = append(s, mv)
	}
	// The map panel + token meter are ambient chrome — hide them while an overlay (menu, completion
	// dropdown, search, log view, or a request) is up, both to keep the focus on the overlay and to
	if m.showFullMap {
		if mp := m.mapPanelView(); mp != "" {
			s = append(s, mp)
		} else {
			s = append(s, dimStyle.Render("  no codebase map yet — run /index-ai to build it"))
		}
	}
	if m.showMind {
		if mh := m.mindHudView(); mh != "" {
			s = append(s, mh)
		}
	}

	overlay := m.menuOpen || m.compOpen || m.searchMode || m.showLogs || m.reqOpen || m.showFullMap || m.showMind
	if !overlay {
		td := m.activeTodoPanel()
		oc := m.outcomeStripView()
		// The outcome strip is the compact authoritative task surface. Keep TodoWrite as its backing
		// compatibility feed, but do not render a second tall checklist when a contract is active.
		if oc != "" {
			td = ""
		}
		sa := m.subAgentPanel()
		tk := m.taskPanel()
		cm := m.compactMapView()
		hl := m.healthLineView() // ambient repo-health: only non-empty when a drive is off setpoint

		// Add a blank spacer above the pinned panels so they don't stick directly to the transcript
		// or working indicators.
		if td != "" || oc != "" || sa != "" || tk != "" || cm != "" || hl != "" {
			s = append(s, "")
		}

		// Pin the live sub-agent coverage panel while any sub-agent is running, above the task list.
		if sa != "" {
			s = append(s, sa)
		}
		// Task workspaces (background shell/browser/build work) — below sub-agents, above the todo
		// checklist: it is runtime posture, not conversation content.
		if tk != "" {
			s = append(s, tk)
		}
		if oc != "" {
			s = append(s, oc)
		}

		// Pin the task list above the prompt while any task is unfinished (Claude-Code-style live
		// panel) so it doesn't scroll off into the transcript.
		if td != "" {
			s = append(s, td)
		}
		// Ambient repo-health line — the instrument watching the workshop. Silent when all drives are
		// at setpoint; speaks (build red / type errors / TODO debt, with sparklines) when one slips.
		if hl != "" {
			s = append(s, hl)
		}
		// Pin a COMPACT, left-aligned codebase-map line above the prompt (P2). It is deliberately short
		// and NOT padded to full width — a full-width line is what multiplied on zoom. The token meter
		// is intentionally NOT pinned: it was a fragile right-aligned full-width line AND it duplicates
		// the model + token count the footer already shows. Use /map for the full panel.
		if cm != "" {
			s = append(s, cm)
		}
	}
	// A blank spacer above the prompt box (Ink's marginTop on the input container) so the answer and
	// the input never butt up against each other.
	s = append(s, "", m.promptView(), m.footerLine())
	return s
}

// working reports whether the model is still mid-turn — either the engine flagged busy, or tools
// are running. Used to gate esc/Ctrl+C interrupt and to keep the "still working" indicator up
// continuously (incl. the tool-call phase), not just during text streaming.
func (m model) working() bool { return m.busy || m.hasRunningTool() }
