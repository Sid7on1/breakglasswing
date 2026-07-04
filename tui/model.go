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
	if m.working() || !m.resizeAt.IsZero() {
		return tickCmd(50 * time.Millisecond)
	}
	return tickCmd(500 * time.Millisecond)
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

	lines    []string // bounded in-memory copy of the transcript (kept only for Ctrl+F search)
	printQueue []string // committed lines to flush into the terminal's native scrollback (tea.Println)
	pendingClear bool   // /clear requested: wipe the physical screen + scrollback before re-banner
	started  bool     // true once any transcript line has been emitted (for inter-turn spacing)
	// Tool calls for the current consecutive run, in START order, each updated IN PLACE by id as its
	// result arrives (pending → running → done/error). One ordered list — not two groups — so a tool
	// occupies a single fixed slot for its whole lifecycle and never jumps position when it resolves;
	// it just fills in (header → header + summary + diff). Running tools stay live in View; the
	// finished leading prefix commits to scrollback when non-tool content lands (flushToolRun), where
	// a long boring burst collapses to category counts ("⏺ 7 tools · 4 reads"). Ctrl+B toggles collapse.
	turnTools     []ToolCall
	collapseTools bool
	flushing      bool // guard: flushToolRun appends via m.append, which must not re-enter the flush
	stream   string   // in-flight assistant tokens for the current turn (full accumulation)
	// Progressive streaming: closed markdown blocks are committed to native scrollback as they
	// complete (formatted once, never to reflow), leaving only the trailing OPEN block live in
	// View. streamCommitted is the byte offset into stream already committed; turnAnswerStarted
	// tracks whether the turn's leading ⏺ marker + "Thought" line have been emitted yet.
	streamCommitted   int
	turnAnswerStarted bool
	status        string
	ready         bool
	terminalSized bool
	// engine heartbeat — pingSeq numbers the probes; pingOutstanding is when the unanswered probe
	// went out (zero = none in flight); engineGone stops probing once the pipe closes; engineStalled
	// makes the "not responding" alarm fire once instead of every 50ms tick.
	pingSeq         int
	lastPingSent    time.Time
	pingOutstanding time.Time
	engineGone      bool
	engineStalled   bool
	busy          bool   // a turn is executing — Ctrl+C cancels it instead of quitting
	resizeAt time.Time // last WindowSizeMsg; non-zero = a resize is settling (repaint on the tick after 250ms)
	quitting bool   // engine asked us to shut down — quit after this message
	cwd      string // working directory, updated by cwd_changed
	width    int
	height   int

	// live task list (todo_update). Rendered as a checklist panel; deduped so repeated identical
	// updates don't spam the transcript.
	todos          []TodoItem
	lastTodoRender string

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
	menuOpen   bool
	menuID     string // correlates a selection back to the engine's onSelect (menuSelect message)
	menuTitle  string
	menuOpts   []menuOption
	menuIdx    int
	menuFilter string

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
	showLogs bool
	showFullMap bool
	// mind HUD overlay (Ctrl+X): the 🧠 chip's explainable panel — weak spots with posterior
	// stats, drives with sparklines, compiled habits (v2 §3.11).
	showMind bool
	logs     []LogEntry

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
	sessionVerb string

	// thought-clock: measure reasoning time Go-side (the headless engine doesn't emit thoughtMs).
	// Clock starts on the first `thinking` token, stops at the first answer token; surfaced as the
	// "✻ Thought for Ns" line on the next assistant message.
	turnThinkStart time.Time
	turnThoughtMs  int

	bell bool // emit a terminal bell when a turn completes

	welcomed bool // the low-chrome welcome banner has been shown once at the top of the transcript

	// footer state (mirrors Ink's Footer.tsx)
	fTier   string // "lite" | "heavy"
	fPinned string // pinned tier, if any
	fMode   string // governor / agent mode
	fTokens int    // running session token estimate
	fCoding string // coding model id
	fLite   string // lite model id
	fGoals  int    // active goal count
	fMcp    int    // connected (non-disabled) MCP server count
	fMind   MindStrip // mind layer: weak spots / drive deviations / compiled habits

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
		engine:   e,
		input:    ta,
		spin:     sp,
		history:  hist,
		histIdx:  len(hist),
		vp:            vp,
		collapseTools: true,
		status:       "Starting engine…",
		sessionVerb:  spinnerVerbs[time.Now().UnixNano()%int64(len(spinnerVerbs))],
		bell:         os.Getenv("BIMAX_ENABLE_NOTIFICATIONS") != "0",
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
	// Deliberately NO screen/scrollback clear at launch: the terminal's existing content (the
	// user's shell history) is theirs, not ours. The welcome banner simply prints inline below
	// whatever was already there — the same quiet entrance Claude Code makes.
	return tea.Batch(
		waitForEngine(m.engine),
		textarea.Blink,
		m.spin.Tick,
		m.nextTick(),
	)
}

// Update wraps the real handler (update) and flushes any committed transcript lines it queued into
// the terminal's native scrollback via tea.Println — so committed output scrolls/copies natively
// while the redrawn View stays just the live region. /clear additionally wipes screen + scrollback.
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	res, cmd := m.update(msg)
	nm, ok := res.(model)
	if !ok {
		return res, cmd
	}
	// /clear: wipe the visible screen BEFORE the new banner is flushed, else the banner would be erased.
	// tea.Sequence guarantees the order. (tea.ClearScreen clears only the visible screen — scrollback
	// is never wiped; the terminal's history belongs to the user.)
	var clearCmd tea.Cmd
	if nm.pendingClear {
		nm.pendingClear = false
		clearCmd = tea.ClearScreen
	}
	if len(nm.printQueue) == 0 {
		switch {
		case clearCmd == nil:
			return nm, cmd
		case cmd == nil:
			return nm, clearCmd
		default:
			return nm, tea.Batch(clearCmd, cmd)
		}
	}
	// COMMIT wrap. Must stay in parity with the LIVE wrap in View() (ansi.Hardwrap at width-1):
	// content that fits and renders clean while streaming must fit and render clean once committed
	// to scrollback, or coloured backgrounds bleed to column 0 on a phantom continuation row. The
	// invariant (a line already within budget is never re-wrapped) is enforced for BOTH paths by
	// TestWrapPathParityNoBleed — preserve it if you touch either wrap.
	for i, line := range nm.printQueue {
		if nm.width > 2 {
			nm.printQueue[i] = indentAwareWrap(line, nm.width-2)
		}
	}
	joined := strings.Join(nm.printQueue, "\n")
	nm.printQueue = nil
	printCmd := tea.Println(joined)
	if clearCmd != nil {
		printCmd = tea.Sequence(clearCmd, printCmd)
	}
	if cmd == nil {
		return nm, printCmd
	}
	return nm, tea.Batch(printCmd, cmd)
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

		// In inline mode, resizing narrower makes previously painted live-region rows wrap, breaking
		// the renderer's cursor math and leaving ghost overlay frames. The old fix wiped the ENTIRE
		// scrollback (\033[3J) and reprinted the whole transcript — destroying the user's pre-BiMax
		// terminal history on every resize. Instead: debounce until the drag settles (see tickMsg),
		// then clear only the visible screen and reprint just the last screenful. The user's
		// scrollback — theirs and ours — is never touched.
		m.resizeAt = time.Now()
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
		// Resize settled (no WindowSizeMsg for 250ms): clear the visible screen once to remove any
		// ghost frames from the drag, and reprint only the last screenful of transcript so the view
		// isn't left blank. Never wipes scrollback — bounded duplication (≤1 screenful per gesture)
		// beats destroying the user's terminal history.
		if !m.resizeAt.IsZero() && time.Since(m.resizeAt) > 250*time.Millisecond {
			m.resizeAt = time.Time{}
			m.pendingClear = true
			if n := len(m.lines); n > 0 && m.height > 1 {
				keep := m.height - 1
				if keep > n {
					keep = n
				}
				m.printQueue = append(m.printQueue, m.lines[n-keep:]...)
			}
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
		m.showWelcome()

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
	m.printQueue = append(m.printQueue, line)
	m.started = true
	m.lines = append(m.lines, line)
	if len(m.lines) > transcriptCap {
		drop := len(m.lines) - transcriptKeep
		m.lines = append(m.lines[:0:0], m.lines[drop:]...) // keep the tail in a fresh backing array
	}
}

// relayout / refresh are no-ops in inline mode — the committed transcript lives in the terminal's own
// scrollback (printed via tea.Println), so there is no viewport buffer to rebuild. Kept so the many
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

// View renders ONLY the live region — the in-flight streamed answer plus the chrome. Everything
// committed is already in the terminal's native scrollback (printed via tea.Println), so the terminal
// owns the visible transcript, its NATIVE scrollbar, and scrolling. Redrawn in place each frame.
func (m model) View() string {
	var rows []string
	// Only the trailing OPEN block is live — every closed block above it is already committed to
	// scrollback (formatted). Render the open block through the SAME markdown renderer the commit
	// uses, so when it closes and commits there is no raw→formatted snap. The turn's leading ⏺
	// marker rides on the open block until the first block commits and takes it over.
	if m.streamCommitted <= len(m.stream) {
		if open := m.stream[m.streamCommitted:]; strings.TrimSpace(open) != "" {
			md := indentLines(renderMarkdown(open), "  ")
			if !m.turnAnswerStarted {
				md = caretStyle.Render("● ") + strings.TrimPrefix(md, "  ")
			}
			rows = append(rows, md)
		}
	}
	rows = append(rows, m.chromeLines()...)
	out := strings.Join(rows, "\n")
	if m.width > 1 {
		// Wrap the live region to width-1 so no line reaches the last column. A full-width line trips
		// the terminal's auto-wrap at the last column (cursor slides to the next row), which desyncs
		// Bubble Tea's inline cursor-up clear → the footer/meter/input "multiply" or leave a mirror box
		// on resize/zoom. width-1 keeps logical rows == physical rows so the renderer clears exactly.
		// Parity with the COMMIT wrap in Update() is enforced by TestWrapPathParityNoBleed — a line
		// that fits here must also fit once committed, or the diff background bleeds to column 0.
		out = ansi.Hardwrap(out, m.width-1, true)
	}
	// Never emit more rows than the terminal has, or the renderer pushes the top of the live region into
	// scrollback every frame (the "footer multiplies itself" bug). Clip whole lines from the TOP, keeping
	// the prompt + footer visible.
	if m.height > 0 && m.width > 0 {
		lines := strings.Split(out, "\n")
		for len(lines) > 1 && len(lines) > m.height {
			lines = lines[1:]
		}
		out = strings.Join(lines, "\n")
	}
	return out
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
		cm := m.compactMapView()
		hl := m.healthLineView() // ambient repo-health: only non-empty when a drive is off setpoint

		// Add a blank spacer above the pinned panels so they don't stick directly to the transcript
		// or working indicators.
		if td != "" || cm != "" || hl != "" {
			s = append(s, "")
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
