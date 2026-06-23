package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// Bubble Tea messages wrapping engine events so they flow through Update like any other tea.Msg.
type engineMsg Outbound
type engineBatch []Outbound
type engineClosed struct{}

// tickMsg drives the once-a-second chrome animation: the working-indicator elapsed clock and the
// thinking-phrase / dot rotation. Separate from the braille spinner.Tick (sub-second frames).
type tickMsg time.Time

func tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg { return tickMsg(t) })
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

// thinkingPhrases mirrors ThinkingText.tsx — rotated before the first answer token.
var thinkingPhrases = []string{
	"Thinking", "Architecting", "Brewing", "Calculating", "Cogitating",
	"Composing", "Computing", "Considering", "Crafting", "Crunching",
	"Deciphering", "Deliberating", "Forging", "Hatching", "Inferring",
	"Mulling", "Musing", "Orchestrating", "Pondering", "Processing",
	"Puzzling", "Ruminating", "Synthesizing", "Tinkering", "Wrangling",
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
	// In-flight tool calls shown in the live region until their result arrives, then committed to
	// scrollback as one finished entry. Order keeps the render stable (map iteration would flicker).
	runningTools map[string]string
	runningOrder []string
	// Finished tool calls in the current consecutive run, held un-committed so a long burst can be
	// collapsed into category counts ("⏺ 7 tools · 4 reads · 2 edits"). Flushed into the transcript
	// when any non-tool content commits. Ctrl+B toggles collapse (collapseTools).
	toolRun       []ToolCall
	collapseTools bool
	flushing      bool // guard: flushToolRun appends via m.append, which must not re-enter the flush
	stream   string   // in-flight assistant tokens (replaced by the final message)
	status   string
	ready    bool
	busy     bool   // a turn is executing — Ctrl+C cancels it instead of quitting
	quitting bool   // engine asked us to shut down — quit after this message
	cwd      string // working directory, updated by cwd_changed
	width    int
	height   int

	// live task list (todo_update). Rendered as a checklist panel; deduped so repeated identical
	// updates don't spam the transcript.
	todos          []TodoItem
	lastTodoRender string

	// pending approval (from a `request` message)
	reqOpen bool
	reqID   int
	reqQ    string
	reqOpts []string
	reqKind string // "prompt" | "diff"
	reqBody string // diff text for kind:"diff"

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
	logs     []LogEntry

	// masked free-form prompt (API keys): render the typed value as bullets in promptView.
	reqMasked bool

	// codebase-map panel + token meter, fed by ui_snapshot.
	graph       GraphSummary
	ctxWindow   int
	ctxBaseline int // system prompt + tool schemas (fixed per-request cost), from ui_snapshot
	histTokens  int // running estimate of the conversation tokens (sum of message contents / 4)

	// animation state (driven by tickMsg): per-turn elapsed clock + thinking phrase/dot rotation.
	busyStart time.Time
	elapsed   int
	phraseIdx int
	thinkTick int
	thinkDots int
	thinkSnip string

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
		status:       "starting engine…",
		runningTools: map[string]string{},
		bell:         os.Getenv("BIMAX_ENABLE_NOTIFICATIONS") != "0",
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(waitForEngine(m.engine), textarea.Blink, m.spin.Tick, tick())
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
	// tea.Sequence guarantees the order. (tea.ClearScreen is the renderer-safe clear; the launch-time
	// scrollback lock lives in main.go, run before the program starts.)
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

func (m model) update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.vp.Width = msg.Width // kept only for render-width math (renderMarkdown etc.)
		// The input sits inside promptBox (rounded border + 1-col padding each side) whose total width
		// is m.width-2, so its content area — and thus the input — is m.width-6. Matching this exactly
		// stops the textarea from overrunning the right border into a stray box (the "mirror box" bug).
		m.input.SetWidth(msg.Width - 6)
		// Inline mode: the terminal owns scroll + reflow. We deliberately do NOT clear here (with native
		// scrollback that duplicates committed content on every zoom step). The live region is kept
		// small + width-clamped (View) so the resize ghost stays minimal.
		return m, nil

	case spinner.TickMsg:
		// Keep the frame animating; it's only painted while busy (see View).
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
		// Once-a-second chrome: elapsed clock + rotating thinking phrase/dots (Ink ThinkingText).
		if m.busy && !m.busyStart.IsZero() {
			m.elapsed = int(time.Since(m.busyStart).Seconds())
		}
		m.thinkDots = (m.thinkDots + 1) % 4
		m.thinkTick++
		if m.thinkTick%3 == 0 {
			m.phraseIdx = (m.phraseIdx + 1) % len(thinkingPhrases)
		}
		return m, tick()

	case tea.KeyMsg:
		// Request overlay captures input until answered (highest priority).
		if m.reqOpen {
			if m.reqKind == "input" {
				return m.handleInputRequest(msg)
			}
			// Option / diff approval — number keys + esc.
			switch msg.String() {
			case "ctrl+c":
				m.engine.Close()
				return m, tea.Quit
			case "esc":
				m.answer(firstOr(m.reqOpts, ""))
				return m, nil
			default:
				if n := digit(msg.String()); n >= 1 && n <= len(m.reqOpts) {
					m.answer(m.reqOpts[n-1])
				}
				return m, nil
			}
		}

		// Search mode (Ctrl+F) is modal: type to query, ↑/↓ + Enter navigate matches, Esc exits.
		if m.searchMode {
			matches := m.searchMatches()
			switch msg.String() {
			case "ctrl+c":
				m.engine.Close()
				return m, tea.Quit
			case "esc", "ctrl+f":
				m.searchMode = false
				m.input.SetValue(m.searchSaved)
				m.input.CursorEnd()
				m.status = "Ready"
				m.relayout()
				return m, nil
			case "enter", "down":
				if len(matches) > 0 {
					m.searchIdx = (m.searchIdx + 1) % len(matches)
				}
				m.relayout()
				return m, nil
			case "up":
				if len(matches) > 0 {
					m.searchIdx = (m.searchIdx - 1 + len(matches)) % len(matches)
				}
				m.relayout()
				return m, nil
			case "backspace", "ctrl+h":
				if r := []rune(m.searchQuery); len(r) > 0 {
					m.searchQuery = string(r[:len(r)-1])
				}
				m.searchIdx = 0
				m.relayout()
				return m, nil
			default:
				if len(msg.Runes) > 0 {
					m.searchQuery += string(msg.Runes)
					m.searchIdx = 0
				}
				m.relayout()
				return m, nil
			}
		}

		// Interactive menu (command palette / picker): fuzzy-filter as you type, navigate + select.
		if m.menuOpen {
			filtered := m.filteredMenu()
			switch msg.String() {
			case "ctrl+c":
				m.engine.Close()
				return m, tea.Quit
			case "esc":
				m.menuOpen = false
				m.menuFilter = ""
				m.relayout()
				return m, nil
			case "up", "ctrl+p":
				if len(filtered) > 0 {
					m.menuIdx = (m.menuIdx - 1 + len(filtered)) % len(filtered)
				}
				return m, nil
			case "down", "ctrl+n":
				if len(filtered) > 0 {
					m.menuIdx = (m.menuIdx + 1) % len(filtered)
				}
				return m, nil
			case "enter":
				if len(filtered) > 0 {
					val := filtered[m.menuIdx].Value
					id := m.menuID
					m.menuOpen = false
					m.menuFilter = ""
					m.relayout()
					// Run the option via the engine's onSelect (menuSelect), which applies values that
					// aren't slash-commands (e.g. a model id) instead of sending them as a chat turn.
					m.engine.Send(encodeMenuSelect(id, val))
				}
				return m, nil
			case "backspace", "ctrl+h":
				if r := []rune(m.menuFilter); len(r) > 0 {
					m.menuFilter = string(r[:len(r)-1])
				}
				m.menuIdx = 0
				m.relayout()
				return m, nil
			default:
				if len(msg.Runes) > 0 {
					m.menuFilter += string(msg.Runes)
					m.menuIdx = 0
				}
				m.relayout()
				return m, nil
			}
		}

		// Completion-dropdown navigation takes priority while it's open.
		if m.compOpen {
			switch msg.String() {
			case "esc":
				m.compOpen = false
				m.relayout()
				return m, nil
			case "up", "ctrl+p":
				m.compIdx = (m.compIdx - 1 + len(m.comps)) % len(m.comps)
				return m, nil
			case "down", "ctrl+n":
				m.compIdx = (m.compIdx + 1) % len(m.comps)
				return m, nil
			case "enter":
				if m.compIdx >= 0 && m.compIdx < len(m.comps) {
					item := m.comps[m.compIdx]
					if item.Kind == "command" {
						// Enter on a half-typed command runs the highlighted match (it used to submit the
						// partial text, which the engine rejected as an unknown command — "nothing happens").
						m.compOpen = false
						m.pushHistory(item.Value)
						m.input.SetValue("")
						m.input.SetHeight(1)
						m.clearPastes()
						m.relayout()
						m.engine.Send(encodeInput(item.Value))
						return m, nil
					}
					// @-mention path/symbol: accept it into the input and keep editing (don't submit).
					m.acceptCompletion()
					return m, nil
				}
			}
		}

		// Input history: up/down at the first/last line recalls past submissions. Mid-text they move
		// the cursor between lines (textarea), so only intercept at the boundaries.
		switch msg.String() {
		case "up":
			if m.input.Line() == 0 && len(m.history) > 0 {
				m.histPrev()
				m.syncInputHeight()
				m.relayout()
				return m, nil
			}
		case "down":
			if m.input.Line() == m.input.LineCount()-1 && m.histIdx < len(m.history) {
				m.histNext()
				m.syncInputHeight()
				m.relayout()
				return m, nil
			}
		}

		switch msg.String() {
		case "ctrl+c":
			// While a turn runs, Ctrl+C cancels it (cooperatively, engine-side) and keeps the
			// session alive. When idle, it quits. So mid-turn it takes two presses to exit:
			// first cancels, second (now idle) quits.
			if m.working() {
				m.engine.Send(encodeInterrupt())
				return m, nil
			}
			m.engine.Close()
			return m, tea.Quit
		// Scrolling is the TERMINAL's job in inline mode — PgUp/PgDn, wheel, trackpad all act on the
		// real native scrollback (opencode / Claude style). The app does not intercept them.
		case "ctrl+l":
			// Clear the physical terminal for a clean repaint (parity with the Ink UI). The transcript
			// itself is untouched — use /clear to reset the conversation.
			return m, tea.ClearScreen
		case "ctrl+f":
			// Enter transcript/log search; stash the in-progress input until we exit.
			m.searchMode = true
			m.searchSaved = m.input.Value()
			m.searchQuery = ""
			m.searchIdx = 0
			m.compOpen = false
			m.status = "Search transcript & logs — ↑/↓ navigate, Esc exit"
			m.relayout()
			return m, nil
		case "ctrl+o":
			// Toggle the structured log view in place of the transcript.
			m.showLogs = !m.showLogs
			m.relayout()
			return m, nil
		case "ctrl+b":
			// Toggle tool-call collapse: long runs of tool calls fold into category counts ("7 tools ·
			// 4 reads · 2 edits") or expand back to one line each. Affects the live/current run.
			m.collapseTools = !m.collapseTools
			if m.collapseTools {
				m.status = "Tool calls collapse when long (Ctrl+B to expand)"
			} else {
				m.status = "Tool calls expanded (Ctrl+B to collapse)"
			}
			m.relayout()
			return m, nil
		case "ctrl+t":
			// Cycle the routing through three states, keyed on the current PIN (not the last-routed
			// tier), so each press is predictable:
			//   auto (default; lite answers, auto-escalates to the coding model when a turn needs it)
			//   → pin lite  (always the lite model; never switches)
			//   → pin heavy (always the coding/minimax model; never switches)
			//   → auto …
			// Drives /tier (engine emits set_tier → model_tier, updating the footer state).
			next := "lite"
			switch m.fPinned {
			case "lite":
				next = "heavy"
			case "heavy":
				next = "auto"
			}
			m.engine.Send(encodeInput("/tier " + next))
			return m, nil
		case "esc":
			// While a turn is running (incl. the tool-call phase), esc cancels it.
			if m.working() {
				m.engine.Send(encodeInterrupt())
				m.status = "Interrupting…"
				return m, nil
			}
			// Idle: stash the current line (Ctrl+R resumes). No-op when empty.
			if strings.TrimSpace(m.input.Value()) != "" {
				m.stash = m.input.Value()
				m.input.SetValue("")
				m.input.SetHeight(1)
				m.status = "Prompt stashed — Ctrl+R to resume"
				m.relayout()
			}
			return m, nil
		case "ctrl+r":
			if m.stash != "" {
				m.input.SetValue(m.stash)
				m.input.CursorEnd()
				m.stash = ""
				m.status = "Stashed prompt resumed"
				m.syncInputHeight()
				m.relayout()
			}
			return m, nil
		case "ctrl+p":
			// Preview the full text behind the paste chips currently in the input.
			m.pastePreview()
			return m, nil
		case "ctrl+g":
			// Command palette: prefill "/" and surface the slash-command dropdown (type to filter).
			m.input.SetValue("/")
			m.input.CursorEnd()
			return m, m.requestCompletions()
		case "tab":
			if m.compOpen {
				m.acceptCompletion()
			}
			return m, m.requestCompletions() // open, or refine after accept (e.g. descend a dir)
		case "enter":
			raw := m.input.Value()
			text := strings.TrimSpace(m.expandPastes(raw))
			if text == "/shortcuts" {
				// Handled Go-side — the headless engine has no keybindings registry.
				m.append(renderShortcuts())
				m.pushHistory(text)
				m.input.SetValue("")
				m.input.SetHeight(1)
				m.clearPastes()
				m.compOpen = false
				m.relayout()
				return m, nil
			}
			if text == "/map" {
				// The map isn't pinned (a tall pinned panel duplicates under the inline renderer), so
				// /map commits it into the scrollback transcript on demand instead. Rendered Go-side from
				// the ui_snapshot graph state we already hold.
				if m.graph.NodeCount > 0 {
					m.append(m.mapPanelView())
				} else {
					m.append(dimStyle.Render("  no codebase map yet — run /index to build it"))
				}
				m.pushHistory(text)
				m.input.SetValue("")
				m.input.SetHeight(1)
				m.clearPastes()
				m.compOpen = false
				m.relayout()
				return m, nil
			}
			if text != "" {
				if m.working() {
					// A turn is in flight — queue this prompt and run it when the turn ends, instead of
					// the engine rejecting it as "busy". Drained in the spinner_state idle handler.
					m.queued = append(m.queued, text)
					m.status = fmt.Sprintf("Queued (%d) — runs after the current turn", len(m.queued))
				} else {
					m.engine.Send(encodeInput(text)) // engine echoes the user message back
				}
				m.pushHistory(strings.TrimSpace(raw))
				m.input.SetValue("")
				m.input.SetHeight(1)
				m.clearPastes()
			}
			m.compOpen = false
			m.relayout()
			return m, nil
		}

		// Bracketed multi-line paste: collapse to a "[Pasted text #N +L lines]" chip.
		if msg.Paste && strings.Contains(string(msg.Runes), "\n") {
			m.addPaste(string(msg.Runes))
			m.syncInputHeight()
			m.relayout()
			return m, nil
		}

		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		m.syncInputHeight() // grow/shrink the box as lines are added (Ctrl+J) or removed
		// If every paste chip was deleted from the line, drop the stored blobs.
		if len(m.pastes) > 0 && !m.inputHasChips() {
			m.clearPastes()
		}
		ccmd := m.requestCompletions() // refresh candidates (debounced) for the new input
		m.relayout()
		return m, tea.Batch(cmd, ccmd)

	case engineMsg:
		m.handleEngine(Outbound(msg))
		if m.quitting { // engine emitted `shutdown` — exit cleanly
			m.engine.Close()
			return m, tea.Quit
		}
		return m, waitForEngine(m.engine) // keep listening

	case engineBatch:
		// Apply a coalesced burst, then render once (see waitForEngine).
		for _, o := range msg {
			m.handleEngine(o)
			if m.quitting {
				m.engine.Close()
				return m, tea.Quit
			}
		}
		return m, waitForEngine(m.engine)

	case engineClosed:
		m.status = "engine exited"
		m.append(errStyle.Render("— engine process exited —"))
		return m, nil
	}

	return m, nil
}

func (m *model) handleEngine(o Outbound) {
	switch o.T {
	case "ready":
		m.ready = true
		m.status = "Ready"
		m.showWelcome()

	case "request":
		m.reqOpen = true
		m.reqID = o.ID
		m.reqQ = o.Question
		m.reqOpts = o.Options
		m.reqKind = o.Kind
		m.reqBody = o.Body
		// The headless input_prompt carries no isMasked flag, so infer a secret field from the
		// question text (API keys / tokens / passwords) and render the answer as bullets.
		m.reqMasked = o.Kind == "input" && secretRE.MatchString(o.Question)

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

// requestCompletions asks the engine for candidates for the current input. Empty input closes the
// dropdown without a round-trip. Each query carries a fresh id so stale results are dropped.
// completionDebounce is how long typing must settle before we ask the engine for completions.
// Each keystroke used to fire a query — and an @-mention query is a full graph-node scan engine-side
// — so on a large repo fast typing meant a scan per keystroke. We debounce instead.
const completionDebounce = 70 * time.Millisecond

// compTickMsg fires when a debounce window elapses; seq lets a later keystroke supersede it.
type compTickMsg struct {
	seq  int
	text string
}

// requestCompletions schedules a debounced completion query. Clearing the dropdown on empty input is
// immediate; the actual engine query waits out completionDebounce and only fires if no newer
// keystroke arrived. Returns the timer cmd for the caller to run.
func (m *model) requestCompletions() tea.Cmd {
	v := m.input.Value()
	m.compSeq++ // any pending debounce is now stale
	if v == "" {
		if m.compOpen {
			m.compOpen = false
			m.relayout()
		}
		return nil
	}
	seq := m.compSeq
	return tea.Tick(completionDebounce, func(time.Time) tea.Msg { return compTickMsg{seq: seq, text: v} })
}

var trailingAt = regexp.MustCompile(`@[A-Za-z0-9_./~-]*$`)

// secretRE marks an input prompt as masked when it asks for a credential (the headless input_prompt
// carries no isMasked flag, unlike Ink's InteractivePrompt).
var secretRE = regexp.MustCompile(`(?i)\b(api[ _-]?key|secret|password|passphrase|token)\b`)

// acceptCompletion inserts the highlighted candidate: a command replaces the whole line; an
// @symbol/@path replaces just the trailing @token.
func (m *model) acceptCompletion() {
	if !m.compOpen || len(m.comps) == 0 {
		return
	}
	item := m.comps[m.compIdx]
	if item.Kind == "command" {
		m.input.SetValue(item.Value + " ")
	} else {
		repl := item.Value
		if !strings.HasSuffix(repl, "/") { // a dir keeps the cursor on it to descend; else add a space
			repl += " "
		}
		m.input.SetValue(trailingAt.ReplaceAllString(m.input.Value(), repl))
	}
	m.input.CursorEnd()
	m.compOpen = false
	m.relayout()
}

const inputMaxRows = 6 // the multi-line input grows up to this many rows, then scrolls internally

// syncInputHeight grows or shrinks the input box to fit its content, capped at inputMaxRows.
func (m *model) syncInputHeight() {
	n := m.input.LineCount()
	if n < 1 {
		n = 1
	}
	if n > inputMaxRows {
		n = inputMaxRows
	}
	if n != m.input.Height() {
		m.input.SetHeight(n)
	}
}

const historyLimit = 100

// pushHistory records a submitted line for up/down recall (dropping any earlier duplicate so it
// moves to the front), caps the ring at historyLimit, persists it, and resets the browse cursor.
func (m *model) pushHistory(text string) {
	if text == "" {
		return
	}
	out := m.history[:0:0]
	for _, h := range m.history {
		if h != text {
			out = append(out, h)
		}
	}
	out = append(out, text)
	if len(out) > historyLimit {
		out = out[len(out)-historyLimit:]
	}
	m.history = out
	m.histIdx = len(m.history)
	m.histStash = ""
	saveHistory(m.history)
}

// historyPath is ~/.breakglass/history.json — shared with the Ink front-end so prompt history
// carries across both UIs (FullScreen.tsx HISTORY_PATH). BIMAX_HISTORY_PATH overrides it (tests).
func historyPath() string {
	if p := os.Getenv("BIMAX_HISTORY_PATH"); p != "" {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".breakglass", "history.json")
}

// loadHistory reads the persisted prompt history (best-effort; empty on any error).
func loadHistory() []string {
	p := historyPath()
	if p == "" {
		return nil
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var hist []string
	if json.Unmarshal(b, &hist) != nil {
		return nil
	}
	if len(hist) > historyLimit {
		hist = hist[len(hist)-historyLimit:]
	}
	return hist
}

// saveHistory writes the prompt history back to disk (best-effort).
func saveHistory(hist []string) {
	p := historyPath()
	if p == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if b, err := json.MarshalIndent(hist, "", "  "); err == nil {
		_ = os.WriteFile(p, b, 0o644)
	}
}

// histPrev recalls an older submission (up). The in-progress line is stashed on first step back.
func (m *model) histPrev() {
	if len(m.history) == 0 {
		return
	}
	if m.histIdx == len(m.history) {
		m.histStash = m.input.Value()
	}
	if m.histIdx > 0 {
		m.histIdx--
	}
	m.input.SetValue(m.history[m.histIdx])
	m.input.CursorEnd()
}

// histNext recalls a newer submission (down), restoring the stashed in-progress line at the end.
func (m *model) histNext() {
	if m.histIdx >= len(m.history) {
		return
	}
	m.histIdx++
	if m.histIdx == len(m.history) {
		m.input.SetValue(m.histStash)
	} else {
		m.input.SetValue(m.history[m.histIdx])
	}
	m.input.CursorEnd()
}

func (m *model) handleEvent(o Outbound) {
	switch o.Name {
	case "stream_token":
		// First answer token ends the reasoning phase — freeze the thought clock for the
		// "Thought for Ns" line the engine doesn't compute in headless mode.
		if m.turnThoughtMs == 0 && !m.turnThinkStart.IsZero() {
			m.turnThoughtMs = int(time.Since(m.turnThinkStart).Milliseconds())
		}
		m.stream += argString(o.Args, 0)
		m.refresh()

	case "message":
		var me MessageEntry
		if len(o.Args) > 0 {
			_ = json.Unmarshal(o.Args[0], &me)
		}
		m.renderMessage(me)

	case "status":
		m.status = argString(o.Args, 0)

	case "spinner_state":
		// args[0] is the state ("thinking"/"idle"), args[1] the label. Track busy so Ctrl+C knows
		// whether to cancel the turn or quit.
		wasBusy := m.busy
		m.busy = argString(o.Args, 0) != "idle"
		if m.busy && !wasBusy {
			m.busyStart = time.Now()
			m.elapsed = 0
		}
		if wasBusy && !m.busy {
			// Turn ended (or was interrupted): drop any live tool lines that never got a result,
			// so working() doesn't stay stuck true and the indicator clears cleanly.
			m.runningTools = map[string]string{}
			m.runningOrder = nil
			if m.bell {
				fmt.Print("\a") // notification bell when a turn completes
			}
			// Drain one queued prompt (FIFO). The next turn's idle dispatches the following one.
			if len(m.queued) > 0 {
				next := m.queued[0]
				m.queued = m.queued[1:]
				m.engine.Send(encodeInput(next))
				if len(m.queued) > 0 {
					m.status = fmt.Sprintf("Running queued prompt — %d still queued", len(m.queued))
				}
			}
		}
		if s := argString(o.Args, 1); s != "" {
			m.status = s
		}

	case "thinking":
		// Start the reasoning clock on the first thinking token; keep the tail snippet for the
		// ThinkingText line (single line, last ~72 chars).
		if m.turnThinkStart.IsZero() {
			m.turnThinkStart = time.Now()
		}
		if t := argString(o.Args, 0); t != "" {
			t = strings.TrimSpace(strings.Join(strings.Fields(t), " "))
			r := []rune(t)
			if len(r) > 72 {
				t = "…" + string(r[len(r)-72:])
			}
			m.thinkSnip = t
		}

	case "thinking_clear":
		m.thinkSnip = ""

	case "mode_change":
		m.fMode = argString(o.Args, 0)

	case "model_tier":
		var t struct {
			Tier   string `json:"tier"`
			Pinned string `json:"pinned"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &t) == nil {
			m.fTier, m.fPinned = t.Tier, t.Pinned
		}

	case "cost_update":
		var chars float64
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &chars) == nil {
			m.fTokens += int(chars / 4) // rough token estimate, same as Footer.tsx
		}

	case "ui_snapshot":
		var s UiSnapshot
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &s) == nil {
			m.fCoding, m.fLite, m.fGoals = s.Models.Coding, s.Models.Lite, s.GoalCount
			m.graph = s.Graph
			m.ctxWindow = s.ContextWindow
			m.ctxBaseline = s.TokensBaseline
		}

	case "tool_call", "tool_call_result":
		var tc ToolCall
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &tc) == nil && tc.ToolName != "" {
			line := renderToolCall(tc, m.width)
			running := tc.Status == "running" || tc.Status == ""
			if tc.ID != "" && running {
				// Show it live (in View) until the result arrives — can't update scrollback in place.
				if _, seen := m.runningTools[tc.ID]; !seen {
					m.runningOrder = append(m.runningOrder, tc.ID)
				}
				m.runningTools[tc.ID] = line
			} else {
				// Finished: drop the live copy and add it to the current consecutive tool RUN. The run
				// is rendered live (collapsed into category counts once it's long, expanded otherwise)
				// and flushed into the transcript as soon as any non-tool content commits (flushToolRun
				// runs from append) — so a burst of reads/greps collapses to one line instead of pages.
				if tc.ID != "" {
					delete(m.runningTools, tc.ID)
				}
				m.toolRun = append(m.toolRun, tc)
			}
		}

	case "log":
		var le LogEntry
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &le) == nil && le.Text != "" {
			// Cache structured entries for the Ctrl+O log view; also echo into the transcript dim.
			m.logs = append(m.logs, le)
			if len(m.logs) > 200 {
				m.logs = m.logs[len(m.logs)-200:]
			}
			m.append(dimStyle.Render("  " + le.Text))
		}

	case "todo_update":
		// Full task list (the compact "Tasks: x/y" summary already arrives as a `status` event).
		// Re-render the checklist into the transcript only when it actually changed.
		var todos []TodoItem
		if len(o.Args) > 0 {
			_ = json.Unmarshal(o.Args[0], &todos)
		}
		m.todos = todos
		// Pinned above the prompt by belowSections() while any task is unfinished, so it stays
		// visible instead of scrolling off into the transcript.

	case "clear":
		// /clear: wipe the transcript + per-turn state, then re-show the welcome banner so the screen
		// looks freshly launched (the engine has already reset the conversation history). Committed lines
		// live in the terminal's scrollback, so resetting m.lines isn't enough — pendingClear makes the
		// Update wrapper wipe screen + scrollback (ESC[3J) BEFORE the new banner flushes.
		m.lines = nil
		m.printQueue = nil // drop anything queued this cycle; it would land below the cleared screen
		m.started = false
		m.stream = ""
		m.runningTools = map[string]string{}
		m.runningOrder = nil
		m.toolRun = nil
		m.todos = nil
		m.lastTodoRender = ""
		m.histTokens = 0
		m.welcomed = false
		m.pendingClear = true
		m.showWelcome()

	case "cwd_changed":
		if p := argString(o.Args, 0); p != "" {
			m.cwd = p
			m.append(dimStyle.Render("  ⌁ cwd → " + p))
		}

	case "mcp_changed":
		m.append(dimStyle.Render("  ⌁ MCP servers changed"))

	case "graph_changed":
		m.append(dimStyle.Render("  ⌁ code graph updated"))

	case "loop_detected":
		var sig struct {
			Type     string `json:"type"`
			Tool     string `json:"tool"`
			Count    int    `json:"count"`
			Severity string `json:"severity"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &sig) == nil {
			detail := sig.Tool
			if detail == "" {
				detail = sig.Type
			}
			m.append(errStyle.Render(fmt.Sprintf("  ↻ loop detected: %s ×%d (%s)", detail, sig.Count, sig.Severity)))
		}

	case "rerun_onboarding":
		m.append(dimStyle.Render("  ⌁ onboarding is only available in the Ink UI; skipped"))

	case "shutdown":
		m.status = "shutting down…"
		m.quitting = true // engineMsg handler turns this into tea.Quit

	// config_changed / goals_changed / set_tier are footer-refresh signals. The footer is driven by
	// the ui_snapshot (config/goals) and model_tier (set_tier) events the engine emits alongside
	// them, so there's nothing to render here — handled explicitly so they're not silently dropped.
	case "config_changed", "goals_changed", "set_tier":
	}
}

// toolLabels maps tool class names to short action labels so lines read like actions, not classes
// (mirrors TOOL_LABELS in ToolCallLine.tsx).
var toolLabels = map[string]string{
	"BashTool": "Bash", "ReadFileTool": "Read", "WriteFileTool": "Write", "EditFileTool": "Edit",
	"MultiEditTool": "MultiEdit", "DeleteTool": "Delete", "CreateDirectoryTool": "mkdir",
	"ChangeDirectoryTool": "cd", "GrepTool": "Grep", "GlobTool": "Glob", "WebFetchTool": "Fetch",
	"TodoWriteTool": "Todo", "GraphQueryTool": "Graph", "MemoryQueryTool": "Memory",
	"SpawnSubagentTool": "Subagent", "RegisterAgentTool": "RegisterAgent", "AskUserTool": "Ask",
	"SkillTool": "Skill", "McpManageTool": "MCP",
}

func toolLabelFor(name string) string {
	if l, ok := toolLabels[name]; ok {
		return l
	}
	return strings.TrimSuffix(name, "Tool")
}

// summarizeToolInput pulls the most meaningful argument (command/path/pattern/…) for the header,
// truncated, mirroring summarizeInput() in ToolCallLine.tsx.
func summarizeToolInput(input string) string {
	var p map[string]any
	if json.Unmarshal([]byte(input), &p) == nil {
		for _, k := range []string{"command", "filePath", "path", "pattern", "glob", "url", "query", "question", "directory", "name", "action"} {
			if v, ok := p[k].(string); ok && v != "" {
				return clip(strings.ReplaceAll(v, "\n", " "), 70)
			}
		}
		return ""
	}
	return clip(strings.ReplaceAll(input, "\n", " "), 70)
}

// bashOutput unwraps BashTool's {stdout,stderr} JSON; other tools return their raw output.
func bashOutput(tc ToolCall) string {
	if tc.ToolName == "BashTool" {
		var o struct {
			Stdout string `json:"stdout"`
			Stderr string `json:"stderr"`
		}
		if json.Unmarshal([]byte(tc.Output), &o) == nil && (o.Stdout != "" || o.Stderr != "") {
			return strings.TrimSpace(strings.TrimSpace(o.Stdout) + "\n" + strings.TrimSpace(o.Stderr))
		}
	}
	return strings.TrimSpace(tc.Output)
}

// summarizeToolOutput renders the one-line "⎿" summary: first line + "(+N lines)", mirroring
// summarizeOutput() in ToolCallLine.tsx.
func summarizeToolOutput(tc ToolCall) string {
	out := bashOutput(tc)
	if out == "" {
		if tc.Status == "success" {
			return "Done"
		}
		return ""
	}
	lines := strings.Split(out, "\n")
	preview := clip(lines[0], 80)
	if len(lines) > 1 {
		return fmt.Sprintf("%s (+%d lines)", preview, len(lines)-1)
	}
	return preview
}

// toolDuration returns a "0.1s" timing badge from the ISO start/end timestamps, or "" if absent.
func toolDuration(tc ToolCall) string {
	if tc.StartTime == "" || tc.EndTime == "" {
		return ""
	}
	start, err1 := time.Parse(time.RFC3339, tc.StartTime)
	end, err2 := time.Parse(time.RFC3339, tc.EndTime)
	if err1 != nil || err2 != nil {
		return ""
	}
	d := end.Sub(start).Seconds()
	if d < 0 {
		return ""
	}
	return fmt.Sprintf("%.1fs", d)
}

// editStats reports "Added N lines, removed M lines" for write/edit tools, parsed from the diff-ish
// output or oldString/newString args, mirroring ToolCallLine.tsx's edit summary.
func editStats(tc ToolCall) string {
	switch tc.ToolName {
	case "EditFileTool", "MultiEditTool", "WriteFileTool":
	default:
		return ""
	}
	var p struct {
		OldString string `json:"oldString"`
		NewString string `json:"newString"`
		Content   string `json:"content"`
	}
	_ = json.Unmarshal([]byte(tc.Input), &p)
	added, removed := 0, 0
	if p.NewString != "" || p.OldString != "" {
		added = strings.Count(p.NewString, "\n") + 1
		removed = strings.Count(p.OldString, "\n") + 1
		if p.NewString == "" {
			added = 0
		}
		if p.OldString == "" {
			removed = 0
		}
	} else if p.Content != "" {
		added = strings.Count(p.Content, "\n") + 1
	}
	if added == 0 && removed == 0 {
		return ""
	}
	return fmt.Sprintf("Added %d lines, removed %d lines", added, removed)
}

// renderToolCall draws one tool entry the Ink way: a status dot, the bold label, dim (args), a
// timing badge, and an indented ⎿ summary line. Sub-agent calls get an [agentLabel] prefix and a
// 2-space indent. Running calls show no summary yet; errors show the summary in red.
func renderToolCall(tc ToolCall, termWidth int) string {
	dot := toolDot
	switch tc.Status {
	case "error":
		dot = toolDotE
	case "running", "":
		dot = toolDotW
	}
	indent := "  "
	if tc.AgentLabel != "" {
		indent = "    " // sub-agent work nests under its spawner
	}
	header := dot.Render("⏺ ")
	if tc.AgentLabel != "" {
		header += agentBadge.Render("[" + tc.AgentLabel + "] ")
	}
	header += toolLabel.Render(toolLabelFor(tc.ToolName))
	if in := summarizeToolInput(tc.Input); in != "" {
		header += toolArgs.Render("(" + in + ")")
	}
	if d := toolDuration(tc); d != "" && tc.Status != "running" && tc.Status != "" {
		header += toolGut.Render(" · " + d)
	}
	if tc.Status == "running" || tc.Status == "" {
		return indent + header
	}
	summary := summarizeToolOutput(tc)
	if stats := editStats(tc); stats != "" {
		if summary == "" || summary == "Done" {
			summary = stats
		} else {
			summary = stats + " · " + summary
		}
	}
	// For edit/write tools, show the actual colorized diff (green adds, red deletes) like Claude
	// Code — the engine returns a unified diff (@@ hunks) in the output. Shown below the summary.
	var diffBlock string
	if tc.Status != "error" {
		switch tc.ToolName {
		case "EditFileTool", "MultiEditTool", "WriteFileTool":
			if d := extractDiff(tc.Output); d != "" {
				// Background fills to the right edge: terminal width minus the gutter+indent the diff sits under.
				diffW := termWidth - len(indent) - 4 - 6
				diffBlock = "\n" + indentLines(renderDiff(d, 20, diffW, diffPath(tc.Input)), indent+"    ")
			}
		}
	}
	if summary == "" && diffBlock == "" {
		return indent + header
	}
	sumStyle := dimStyle
	if tc.Status == "error" {
		sumStyle = errStyle
	}
	out := indent + header
	if summary != "" {
		out += "\n" + indent + "  " + toolGut.Render("⎿ ") + sumStyle.Render(summary)
	}
	return out + diffBlock
}

// extractDiff returns the unified-diff portion of a tool's output (from the first @@ hunk), or "" if
// there is none — so non-edit output never gets diff-colorized.
func extractDiff(out string) string {
	if i := strings.Index(out, "@@"); i >= 0 {
		return out[i:]
	}
	return ""
}

// indentLines prefixes every line of s with the given gutter, so a rendered block (markdown,
// streamed tokens) lines up under the rest of the transcript instead of sitting flush at column 0.
func indentLines(s, gutter string) string {
	if s == "" {
		return ""
	}
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		lines[i] = gutter + ln
	}
	return strings.Join(lines, "\n")
}

// clip truncates s to n runes with an ellipsis.
func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// LOGO is the BiMax wordmark, mirroring Ink's WelcomeBanner.tsx.
var logoLines = []string{
	"▗▄▄▄▖ ▗▄▄▄▖ ▗▖  ▗▖  ▗▄▖  ▗▖  ▗▖",
	"▐▌  █   █   ▐▛▚▞▜▌ ▐▌ ▐▌  ▝▚▞▘ ",
	"▐▛▀▀▜   █   ▐▌  ▐▌ ▐▛▀▜▌   ▐▌  ",
	"▐▌▄▄▟ ▗▄█▄▖ ▐▌  ▐▌ ▐▌ ▐▌ ▗▞▘▝▚▖",
}

// shortPath collapses the home prefix to ~ (mirrors WelcomeBanner.tsx).
func shortPath(p string) string {
	if home, err := os.UserHomeDir(); err == nil && strings.HasPrefix(p, home) {
		return "~" + p[len(home):]
	}
	return p
}

// showWelcome injects the low-chrome welcome banner at the top of the transcript, once: the accent
// wordmark, a dim metadata block, and a couple of quiet tips — content-first, like WelcomeBanner.tsx.
func (m *model) showWelcome() {
	if m.welcomed {
		return
	}
	m.welcomed = true

	var b strings.Builder
	b.WriteByte('\n')
	for i, ln := range logoLines {
		st := logoStyle
		if i == 1 {
			st = logoMid
		}
		b.WriteString("  " + st.Render(ln) + "\n")
	}
	b.WriteString("\n  " + brandStyle.Render("BiMax ") + tipStyle.Render("v1.0.0 · autonomous agent for your terminal") + "\n\n")

	model := shortModel(m.fCoding)
	if model == "" {
		model = shortModel(m.fLite)
	}
	if model == "" {
		model = "default"
	}
	b.WriteString("  " + metaKey.Render("model  ") + metaVal.Render(model) + "\n")
	cwd := m.cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	b.WriteString("  " + metaKey.Render("cwd    ") + metaVal.Render(shortPath(cwd)) + "\n")
	if m.fMode == "bypass" {
		b.WriteString("  " + metaKey.Render("guard  ") + warnStyle.Render("bypassed (YOLO)") + "\n")
	}
	b.WriteString("\n  " + tipStyle.Render("Ask anything, or describe a task to run it with tools.") + "\n")
	b.WriteString("  " + tipStyle.Render("/help · Ctrl+G palette · Ctrl+F search · Ctrl+O logs · Esc stash · Ctrl+R restore"))

	m.append(b.String())
}

// activeTodoPanel returns the boxed task list while any task is still unfinished, else "" (a
// fully-done list disappears rather than lingering above the prompt).
func (m model) activeTodoPanel() string {
	for _, t := range m.todos {
		if t.Status != "completed" {
			// width-1, never full width: a box that fills the last column auto-wraps and the inline
			// renderer's row count desyncs → the panel ghosts/multiplies. (Same rule as the footer/map.)
			return renderTodos(m.todos, m.width-1)
		}
	}
	return ""
}

// renderTodos draws the task list as a bordered panel (Claude-Code TaskListV2 style): ✔/▪/□ icons,
// unfinished tasks first, and an "… +N more" summary when the list is long. Task text is clipped to
// the terminal width so a long task can't blow out the box border. Empty list → "".
func renderTodos(todos []TodoItem, width int) string {
	if len(todos) == 0 {
		return ""
	}
	// Border (2) + padding (2) + "icon " (2) = 6 cells of chrome around the text.
	textW := width - 6
	if textW < 10 {
		textW = 10
	}
	// Unfinished first so the cap never hides what's actually pending.
	ordered := make([]TodoItem, 0, len(todos))
	done := 0
	for _, t := range todos {
		if t.Status == "completed" {
			done++
		} else {
			ordered = append(ordered, t)
		}
	}
	for _, t := range todos {
		if t.Status == "completed" {
			ordered = append(ordered, t)
		}
	}

	const maxShow = 8
	var b strings.Builder
	for i, t := range ordered {
		if i >= maxShow {
			b.WriteString(dimStyle.Render(fmt.Sprintf("… +%d more", len(ordered)-maxShow)) + "\n")
			break
		}
		icon, st := "□", dimStyle
		switch t.Status {
		case "completed":
			icon, st = "✔", todoDone
		case "in_progress":
			icon, st = "▪", todoActive
		}
		b.WriteString(st.Render(icon+" "+clip(t.Content, textW)) + "\n")
	}
	title := todoTitle.Render(fmt.Sprintf("Tasks (%d/%d)", done, len(todos)))
	return todoPanel.Render(title + "\n" + strings.TrimRight(b.String(), "\n"))
}

func (m *model) renderMessage(me MessageEntry) {
	switch me.UIComponent {
	case "menu":
		var menu Menu
		if json.Unmarshal(me.Payload, &menu) == nil && len(menu.Options) > 0 {
			m.menuOpen = true
			m.menuID = menu.ID
			m.menuTitle = menu.Title
			m.menuOpts = menu.Options
			// Land the cursor on the currently-set option (toggle submenus send initialIndex);
			// clamp so a stale index can't point past the list.
			m.menuIdx = menu.InitialIndex
			if m.menuIdx < 0 || m.menuIdx >= len(menu.Options) {
				m.menuIdx = 0
			}
			m.menuFilter = ""
			m.relayout()
		}
		return
	case "HelpDashboard", "StatsDashboard", "DataTableDashboard":
		m.append(renderDashboard(me, m.vp.Width))
		return
	}
	switch me.Role {
	case "user":
		// A new turn begins — scope tool-call dedupe to this turn so a later turn's tool ids can't
		// collide with an earlier turn's line indices (and the map doesn't grow without bound).
		m.runningTools = map[string]string{}
		m.runningOrder = nil
		// Reset the per-turn reasoning clock so "Thought for Ns" measures THIS turn, and drop any
		// leftover streamed partial so a prior turn's text can't bleed into this one.
		m.turnThinkStart = time.Time{}
		m.turnThoughtMs = 0
		m.thinkSnip = ""
		m.stream = ""
		m.histTokens += len([]rune(me.Content)) / 4
		if m.started {
			m.append("") // a blank line between turns so the transcript reads as distinct exchanges
		}
		m.append(caretStyle.Render("❯ ") + userStyle.Render(me.Content))
	case "assistant":
		m.stream = "" // the final message supersedes the streamed partial
		m.histTokens += len([]rune(me.Content)) / 4
		// "✻ Thought for Ns" — prefer the engine's thoughtMs, else the Go-side clock. ≥500ms only.
		thought := me.ThoughtMs
		if thought == 0 {
			thought = m.turnThoughtMs
		}
		var b strings.Builder
		if thought >= 500 {
			b.WriteString(thoughtSty.Render(fmt.Sprintf("  ✻ Thought for %ds", thought/1000)) + "\n")
		}
		// Render at width-2 and indent by a 2-space gutter so the reply lines up under the rest of the
		// transcript (tool lines, todos, the welcome block all sit at +2) instead of starting flush at
		// column 0 with no structure. The first line gets an accent ⏺ marker, Claude-Code style, so a
		// turn's answer is visually anchored.
		md := indentLines(renderMarkdown(me.Content, m.vp.Width-2), "  ")
		if md != "" {
			md = toolDot.Render("⏺ ") + strings.TrimPrefix(md, "  ")
		}
		b.WriteString(md)
		m.append(b.String())
	default: // system
		st := dimStyle
		switch me.Level {
		case "error":
			st = errStyle
		case "success":
			st = okStyle // green confirmation, matching the Ink UI (was dim, indistinguishable from info)
		}
		m.append(st.Render(me.Content))
	}
}

func (m *model) answer(value string) {
	m.engine.Send(encodeReply(m.reqID, value))
	shown := value
	if m.reqKind == "input" && value != "" {
		shown = strings.Repeat("•", min(len(value), 8)) // masked-ish echo for free-form answers
	}
	if shown != "" {
		m.append(dimStyle.Render("  → " + shown))
	}
	m.reqOpen = false
	m.reqKind = ""
	m.reqBody = ""
	m.reqOpts = nil
	m.reqMasked = false
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

// toolCollapseThreshold is how many consecutive tool calls trigger collapse into category counts.
const toolCollapseThreshold = 5

// flushToolRun commits the pending consecutive tool run into the transcript: one category-count line
// when collapsed (and long enough), otherwise one rendered line per call. Cleared afterwards.
func (m *model) flushToolRun() {
	if len(m.toolRun) == 0 {
		return
	}
	run := m.toolRun
	m.toolRun = nil
	m.flushing = true
	if m.collapseTools && len(run) >= toolCollapseThreshold {
		m.append(toolRunSummary(run))
	} else {
		for _, tc := range run {
			m.append(renderToolCall(tc, m.width))
		}
	}
	m.flushing = false
}

// toolCategory buckets a tool name for the collapsed summary.
func toolCategory(name string) string {
	switch {
	case strings.Contains(name, "Read") || strings.Contains(name, "Cat"):
		return "reads"
	case strings.Contains(name, "Edit") || strings.Contains(name, "Write"):
		return "edits"
	case strings.Contains(name, "Bash") || strings.Contains(name, "Shell"):
		return "bash"
	case strings.Contains(name, "Grep") || strings.Contains(name, "Glob") || strings.Contains(name, "Search") || strings.Contains(name, "Find"):
		return "searches"
	default:
		return "other"
	}
}

// toolRunSummary renders a collapsed run as "⏺ N tool calls · 4 reads · 2 edits · 1 bash (ctrl+b to expand)".
func toolRunSummary(run []ToolCall) string {
	counts := map[string]int{}
	order := []string{"reads", "edits", "bash", "searches", "other"}
	for _, tc := range run {
		counts[toolCategory(tc.ToolName)]++
	}
	var parts []string
	for _, cat := range order {
		if counts[cat] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", counts[cat], cat))
		}
	}
	head := toolDot.Render("⏺ ") + toolLabel.Render(fmt.Sprintf("%d tool calls", len(run)))
	body := toolArgs.Render(" · " + strings.Join(parts, " · "))
	hint := subtleStyle.Render("  (ctrl+b to expand)")
	return head + body + hint
}

// toolRunLive renders the pending (un-flushed) tool run for the live region — collapsed or expanded,
// matching how it will commit — so a burst visibly accumulates while it runs.
func (m model) toolRunLive() string {
	if len(m.toolRun) == 0 {
		return ""
	}
	if m.collapseTools && len(m.toolRun) >= toolCollapseThreshold {
		return toolRunSummary(m.toolRun)
	}
	var b strings.Builder
	for i, tc := range m.toolRun {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(renderToolCall(tc, m.width))
	}
	return b.String()
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
	// Pending finished tool calls (collapsed or expanded) accumulate live before they flush to scrollback.
	if tr := m.toolRunLive(); tr != "" {
		c = append(c, strings.Split(tr, "\n")...)
	}
	for _, id := range m.runningOrder {
		if line, ok := m.runningTools[id]; ok {
			c = append(c, line)
		}
	}
	return append(c, m.belowSections()...)
}

// View renders ONLY the live region — the in-flight streamed answer plus the chrome. Everything
// committed is already in the terminal's native scrollback (printed via tea.Println), so the terminal
// owns the visible transcript, its NATIVE scrollbar, and scrolling. Redrawn in place each frame.
func (m model) View() string {
	var rows []string
	if m.stream != "" {
		// Indent the in-flight stream to the same +2 gutter the finalized reply uses, so the text
		// doesn't jump leftward the instant streaming ends and the committed message replaces it.
		rows = append(rows, indentLines(streamStyle.Render(m.stream), "  "))
	}
	rows = append(rows, m.chromeLines()...)
	out := strings.Join(rows, "\n")
	if m.width > 1 {
		// Wrap the live region to width-1 so no line reaches the last column. A full-width line trips
		// the terminal's auto-wrap at the last column (cursor slides to the next row), which desyncs
		// Bubble Tea's inline cursor-up clear → the footer/meter/input "multiply" or leave a mirror box
		// on resize/zoom. width-1 keeps logical rows == physical rows so the renderer clears exactly.
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
	// keep the total frame within the terminal height (a tall menu + panels would overflow and leave
	// ghost rows on small terminals).
	overlay := m.menuOpen || m.compOpen || m.searchMode || m.showLogs || m.reqOpen
	if !overlay {
		// Pin the task list above the prompt while any task is unfinished (Claude-Code-style live
		// panel) so it doesn't scroll off into the transcript.
		if td := m.activeTodoPanel(); td != "" {
			s = append(s, td)
		}
		// Pin a COMPACT, left-aligned codebase-map line above the prompt (P2). It is deliberately short
		// and NOT padded to full width — a full-width line is what multiplied on zoom. The token meter
		// is intentionally NOT pinned: it was a fragile right-aligned full-width line AND it duplicates
		// the model + token count the footer already shows. Use /map for the full panel.
		if cm := m.compactMapView(); cm != "" {
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
func (m model) working() bool { return m.busy || len(m.runningTools) > 0 }

// midView is the live region between the transcript and the prompt: an interactive menu, the
// completion dropdown, the input-request question, or the working/thinking indicator.
func (m model) midView() string {
	switch {
	case m.reqOpen && m.reqKind == "input":
		return footerTier.Render("? " + m.reqQ)
	case m.menuOpen:
		return m.menuView()
	case m.compOpen && len(m.comps) > 0:
		return m.completionView()
	case len(m.runningTools) > 0:
		return m.toolingView()
	case m.busy && strings.TrimSpace(m.stream) == "":
		return m.thinkingView()
	case m.busy:
		return m.workingView()
	}
	return " "
}

// promptView renders the bottom input region: an option/diff approval box, a masked prompt, or the
// rounded input box with its stash / paste / multi-line hints (SimpleInput.tsx layout).
func (m model) promptView() string {
	if m.reqOpen && m.reqKind != "input" {
		var b strings.Builder
		b.WriteString(errStyle.Render("⚠ "+m.reqQ) + "\n")
		if m.reqKind == "diff" && m.reqBody != "" {
			b.WriteString(renderDiff(m.reqBody, 16, m.width-8, "") + "\n")
		}
		for i, op := range m.reqOpts {
			b.WriteString(fmt.Sprintf("  %d) %s\n", i+1, op))
		}
		b.WriteString(dimStyle.Render("press 1–" + fmt.Sprint(len(m.reqOpts)) + " · esc to dismiss"))
		return requestBox.Width(m.width - 3).Render(b.String())
	}

	var b strings.Builder
	// Masked free-form prompt (API keys): render the typed value as bullets instead of the textarea,
	// so a secret never shows on screen even though it still flows through the input field.
	if m.reqOpen && m.reqKind == "input" && m.reqMasked {
		b.WriteString(caretStyle.Render("❯ ") + asstStyle.Render(strings.Repeat("•", len([]rune(m.input.Value())))))
		return promptBox.Width(m.width - 3).Render(b.String())
	}

	if m.stash != "" {
		b.WriteString(subtleStyle.Render("[Stashed] Press Ctrl+R to resume") + "\n")
	}
	if n := len(m.queued); n > 0 {
		next := clip(m.queued[0], 48)
		more := ""
		if n > 1 {
			more = fmt.Sprintf(" (+%d more)", n-1)
		}
		b.WriteString(subtleStyle.Render(fmt.Sprintf("⧖ %d queued · next: %s%s", n, next, more)) + "\n")
	}
	if n := len(m.pastes); n > 0 && !m.searchMode {
		plural := ""
		if n > 1 {
			plural = "s"
		}
		b.WriteString(subtleStyle.Render(fmt.Sprintf("⎘ %d pasted block%s · Ctrl+P to preview · expands on send", n, plural)) + "\n")
	}
	if m.searchMode {
		b.WriteString(caretStyle.Render("❯ ") + asstStyle.Render(m.searchQuery) + caretStyle.Render("▏"))
	} else {
		b.WriteString(m.input.View())
		if strings.Contains(m.input.Value(), "\n") {
			lines := strings.Count(m.input.Value(), "\n") + 1
			b.WriteString("\n" + subtleStyle.Render(fmt.Sprintf("  ↵ send · Ctrl+J newline · %d lines", lines)))
		}
	}
	return promptBox.Width(m.width - 3).Render(b.String())
}

const menuMaxVisible = 8

// menuView renders the interactive menu (Ink InteractiveMenu): a title + search box, fuzzy-filtered
// options windowed to menuMaxVisible rows with ↑/↓ "...more..." scroll indicators.
func (m model) menuView() string {
	opts := m.filteredMenu()
	idx := m.menuIdx
	if idx >= len(opts) {
		idx = 0
	}
	var b strings.Builder
	title := m.menuTitle
	if m.menuFilter != "" {
		title += fmt.Sprintf("  (%d/%d)", len(opts), len(m.menuOpts))
	}
	b.WriteString(dashTitle.Render(title) + subtleStyle.Render("  [↑/↓ navigate, Enter select, Esc cancel]") + "\n")
	b.WriteString(searchHdr.Render("🔍 "))
	if m.menuFilter == "" {
		b.WriteString(subtleStyle.Render("Type to search…") + "\n")
	} else {
		b.WriteString(searchCur.Render(m.menuFilter) + "\n")
	}

	if len(opts) == 0 {
		b.WriteString("  " + subtleStyle.Render("No matches found"))
		return strings.TrimRight(b.String(), "\n")
	}

	start := 0
	if len(opts) > menuMaxVisible {
		switch {
		case idx < menuMaxVisible/2:
			start = 0
		case idx >= len(opts)-menuMaxVisible/2:
			start = len(opts) - menuMaxVisible
		default:
			start = idx - menuMaxVisible/2
		}
	}
	end := start + menuMaxVisible
	if end > len(opts) {
		end = len(opts)
	}
	if start > 0 {
		b.WriteString("  " + subtleStyle.Render("↑ ...more options...") + "\n")
	}
	for i := start; i < end; i++ {
		op := opts[i]
		row := fmt.Sprintf("%-25s %s", op.Label, op.Desc)
		if i == idx {
			b.WriteString(compSel.Render("❯ "+row) + "\n")
		} else {
			b.WriteString("  " + dimStyle.Render(row) + "\n")
		}
	}
	if end < len(opts) {
		b.WriteString("  " + subtleStyle.Render("↓ ...more options...") + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// completionView renders the autocomplete dropdown, highlighting the selected row. The list is
// windowed to menuMaxVisible rows (with ↑/↓ "...more..." markers) so a long slash-command palette
// scrolls instead of being silently truncated to the first handful.
func (m model) completionView() string {
	idx := m.compIdx
	if idx < 0 || idx >= len(m.comps) {
		idx = 0
	}
	start := 0
	if len(m.comps) > menuMaxVisible {
		switch {
		case idx < menuMaxVisible/2:
			start = 0
		case idx >= len(m.comps)-menuMaxVisible/2:
			start = len(m.comps) - menuMaxVisible
		default:
			start = idx - menuMaxVisible/2
		}
	}
	end := start + menuMaxVisible
	if end > len(m.comps) {
		end = len(m.comps)
	}
	var b strings.Builder
	if start > 0 {
		b.WriteString("  " + subtleStyle.Render(fmt.Sprintf("↑ %d more", start)) + "\n")
	}
	for i := start; i < end; i++ {
		it := m.comps[i]
		row := fmt.Sprintf("%-18s %s", it.Label, it.Desc)
		if i == idx {
			b.WriteString(compSel.Render("▸ "+row) + "\n")
		} else {
			b.WriteString("  " + dimStyle.Render(row) + "\n")
		}
	}
	if end < len(m.comps) {
		b.WriteString("  " + subtleStyle.Render(fmt.Sprintf("↓ %d more", len(m.comps)-end)) + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// footerLine renders the status line + hints + model/tier bar, mirroring Ink's Footer.tsx: a left
// status glyph + text, then right-aligned goals · stream meta · hint chord · model/tier.
func (m model) footerLine() string {
	icon, txt := footerIdle.Render("✻ "), footerIdle.Render(m.status)
	if m.busy {
		icon, txt = footerIcon.Render("✶ "), dimStyle.Render(m.status)
	}
	left := icon + txt

	// Right-aligned cluster: goals · stream meta · [hints] · model/tier. The hint chord is dropped
	// first when the line won't fit, then the status is clipped — so the model name always survives
	// (and the bar never wraps onto a second row).
	var core []string
	if m.fGoals > 0 {
		unit := "goals"
		if m.fGoals == 1 {
			unit = "goal"
		}
		core = append(core, footerHint.Render(fmt.Sprintf("◉ %d %s", m.fGoals, unit)))
	}
	if m.busy {
		chars := len([]rune(m.stream))
		meta := fmt.Sprintf("%d chars", chars)
		if m.elapsed > 0 {
			meta += fmt.Sprintf(" · %d tok/s · %ds", chars/4/m.elapsed, m.elapsed)
		}
		core = append(core, footerHint.Render(meta))
	}

	// model / tier pointer (Ink: ⇧ heavy / ▸ lite). The Ctrl+T state is made explicit: "auto" when
	// routing is automatic (lite answers, escalates as needed), "📌" when a tier is pinned (no switch).
	modelID := m.fLite
	arrow := "▸ "
	if m.fTier == "heavy" {
		modelID, arrow = m.fCoding, "⇧ "
	}
	if modelID == "" {
		modelID = "default"
	}
	mstr := ""
	if m.fMode != "" {
		mstr = m.fMode + " · "
	}
	if m.fPinned != "" {
		mstr += "📌 " // pinned → this model handles every turn, no auto-switch
	} else {
		mstr += "auto " // automatic routing → lite answers, escalates to the coding model when needed
	}
	mstr += arrow + shortModel(modelID)
	mstr += fmt.Sprintf(" · %s tok", humanCount(m.fTokens))
	modelStyle := footerIdle
	if m.fTier == "heavy" {
		modelStyle = footerTier
	}
	modelRendered := modelStyle.Render(mstr)
	hints := footerHint.Render("Ctrl+G palette · Ctrl+F search · Ctrl+O logs · Esc stash")

	// Build to m.width-2, NOT the full width. A line that fills the last column trips the terminal's
	// auto-wrap, which slides the cursor to the next row and desyncs Bubble Tea's inline clear — the
	// whole live region then stacks/multiplies on every update (the doubled footer + repeated meters).
	// The -2 (vs -1) leaves a 1-cell margin so an ambiguous-width glyph (✻/⇧/📌) rendered wider than
	// measured still can't push the line into the last column.
	w := m.width - 2
	withHints := strings.Join(append(append([]string{}, core...), hints, modelRendered), footerSep)
	rightStr := withHints
	if lipgloss.Width(left)+lipgloss.Width(withHints)+1 > w {
		rightStr = strings.Join(append(append([]string{}, core...), modelRendered), footerSep)
	}

	leftW, rightW := lipgloss.Width(left), lipgloss.Width(rightStr)
	gap := w - leftW - rightW
	if gap < 1 {
		if avail := w - rightW - 1; avail >= 0 {
			left = lipgloss.NewStyle().MaxWidth(avail).Render(left)
		}
		gap = 1
	}
	return footerBar.Render(left + strings.Repeat(" ", gap) + rightStr)
}

// handleInputRequest routes keys while a free-form (input) request is open: a masked prompt feeds a
// dedicated bullet-rendered buffer; a normal prompt reuses the textarea as the answer field.
// handleInputRequest routes keys while a free-form (input) request is open — the textarea is the
// answer field for both plain and masked prompts; masking is purely a render concern (bullets in
// promptView) so the typed value still flows through the textarea (parity with the old behavior).
func (m *model) handleInputRequest(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		m.engine.Close()
		return *m, tea.Quit
	case "esc":
		m.input.SetValue("")
		m.answer("")
		return *m, nil
	case "enter":
		val := m.input.Value()
		m.input.SetValue("")
		m.answer(val)
		return *m, nil
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return *m, cmd
}

// filteredMenu applies the live fuzzy filter (case-insensitive substring over label/desc/value),
// mirroring Ink InteractiveMenu's enableSearch. Empty filter → the full list.
func (m model) filteredMenu() []menuOption {
	if m.menuFilter == "" {
		return m.menuOpts
	}
	q := strings.ToLower(m.menuFilter)
	out := make([]menuOption, 0, len(m.menuOpts))
	for _, o := range m.menuOpts {
		if strings.Contains(strings.ToLower(o.Label+" "+o.Desc+" "+o.Value), q) {
			out = append(out, o)
		}
	}
	return out
}

// --- paste chips (SimpleInput.tsx) ---------------------------------------------------------

// addPaste collapses a multi-line paste into a chip and inserts its placeholder into the input.
func (m *model) addPaste(text string) {
	m.pasteCounter++
	lines := strings.Count(text, "\n") + 1
	ph := fmt.Sprintf("[Pasted text #%d +%d lines]", m.pasteCounter, lines)
	m.pastes = append(m.pastes, pasteChip{ID: m.pasteCounter, Lines: lines, Text: text, Placeholder: ph})
	m.input.InsertString(ph)
}

// expandPastes replaces every chip placeholder with its real text (called on submit).
func (m model) expandPastes(s string) string {
	for _, c := range m.pastes {
		s = strings.ReplaceAll(s, c.Placeholder, c.Text)
	}
	return s
}

// clearPastes drops all stored chips and resets the counter.
func (m *model) clearPastes() {
	m.pastes = nil
	m.pasteCounter = 0
}

// inputHasChips reports whether the input still references at least one paste chip.
func (m model) inputHasChips() bool {
	v := m.input.Value()
	for _, c := range m.pastes {
		if strings.Contains(v, c.Placeholder) {
			return true
		}
	}
	return false
}

// pastePreview appends each chip's full text to the transcript (Ctrl+P).
func (m *model) pastePreview() {
	if len(m.pastes) == 0 {
		m.status = "No pasted text to preview"
		return
	}
	for _, c := range m.pastes {
		m.append(dimStyle.Render(c.Placeholder) + "\n" + asstStyle.Render(c.Text))
	}
}

// --- search (Ctrl+F) -----------------------------------------------------------------------

type searchMatch struct {
	source string // "you" | "assistant" | "system" | "log"
	text   string
}

var sgrRE = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func stripAnsi(s string) string { return sgrRE.ReplaceAllString(s, "") }

// searchMatches scans the committed transcript and the log cache for the current query.
func (m model) searchMatches() []searchMatch {
	q := strings.ToLower(strings.TrimSpace(m.searchQuery))
	if q == "" {
		return nil
	}
	var out []searchMatch
	for _, ln := range m.lines {
		for _, sub := range strings.Split(ln, "\n") {
			plain := strings.TrimSpace(stripAnsi(sub))
			if plain == "" || !strings.Contains(strings.ToLower(plain), q) {
				continue
			}
			src := "assistant"
			if strings.Contains(plain, "❯") {
				src = "you"
			} else if strings.HasPrefix(plain, "✖") || strings.HasPrefix(plain, "ℹ") || strings.HasPrefix(plain, "⚠") {
				src = "system"
			}
			out = append(out, searchMatch{src, plain})
		}
	}
	for _, lg := range m.logs {
		if strings.Contains(strings.ToLower(lg.Text), q) {
			out = append(out, searchMatch{"log", lg.Text})
		}
	}
	return out
}

var searchLabels = map[string]string{"you": "you", "assistant": "bimax", "system": "sys", "log": "log"}

// highlightQuery wraps each case-insensitive occurrence of the query in the given style.
func highlightQuery(text, query string, hl lipgloss.Style) string {
	if query == "" {
		return text
	}
	lower, q := strings.ToLower(text), strings.ToLower(query)
	var b strings.Builder
	for {
		i := strings.Index(lower, q)
		if i < 0 {
			b.WriteString(text)
			break
		}
		b.WriteString(text[:i])
		b.WriteString(hl.Render(text[i : i+len(query)]))
		text, lower = text[i+len(query):], lower[i+len(query):]
	}
	return b.String()
}

// searchView renders the SearchResults panel (Ink SearchResults.tsx): an "N of M" header and a
// windowed match list with source labels and the query highlighted.
func (m model) searchView() string {
	if strings.TrimSpace(m.searchQuery) == "" {
		return searchSrc.Render(" Search: type to find in transcript and logs…")
	}
	matches := m.searchMatches()
	if len(matches) == 0 {
		return searchWarn.Render(fmt.Sprintf(" No matches for “%s”", m.searchQuery))
	}
	cur := m.searchIdx % len(matches)
	const maxRows = 10
	start := cur - maxRows/2
	if start < 0 {
		start = 0
	}
	end := start + maxRows
	if end > len(matches) {
		end = len(matches)
		start = end - maxRows
		if start < 0 {
			start = 0
		}
	}
	var b strings.Builder
	plural := "es"
	if len(matches) == 1 {
		plural = ""
	}
	b.WriteString(searchHdr.Render(fmt.Sprintf(" 🔍 %d of %d match%s for “%s”", cur+1, len(matches), plural, m.searchQuery)) +
		searchSrc.Render("  (↑/↓ or Enter to navigate · Esc to exit)") + "\n")
	for i := start; i < end; i++ {
		mm := matches[i]
		label := searchLabels[mm.source]
		txt := mm.text
		if len([]rune(txt)) > 120 {
			txt = string([]rune(txt)[:117]) + "…"
		}
		if i == cur {
			b.WriteString(searchCur.Render("▸ "+fmt.Sprintf("%-5s", label)+" │ ") + highlightQuery(txt, m.searchQuery, searchHL) + "\n")
		} else {
			b.WriteString(searchSrc.Render("  "+fmt.Sprintf("%-5s", label)+" │ ") + dimStyle.Render(highlightQuery(txt, m.searchQuery, searchHLOther)) + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// --- structured log view (Ctrl+O) ----------------------------------------------------------

// logView renders the last 12 logs as a TIME | LEVEL | MESSAGE table (Ink LogView.tsx).
func (m model) logView() string {
	logs := m.logs
	if len(logs) > 12 {
		logs = logs[len(logs)-12:]
	}
	var b strings.Builder
	b.WriteString(logHdr.Render(fmt.Sprintf("%-10s %-7s %s", "TIME", "LEVEL", "MESSAGE")) + "\n")
	if len(logs) == 0 {
		b.WriteString(subtleStyle.Render("No logs available yet."))
		return logPanel.Width(m.width - 3).Render(b.String())
	}
	for _, lg := range logs {
		st := logInfo
		switch lg.Level {
		case "error":
			st = logErr
		case "warn":
			st = logWarn
		case "success":
			st = logOK
		case "debug":
			st = logDim
		}
		b.WriteString(logTime.Render(fmt.Sprintf("%-10s", logTimeStr(lg.Timestamp))) + " " +
			st.Render(fmt.Sprintf("%-7s", strings.ToUpper(lg.Level))) + " " +
			st.Render(clip(lg.Text, m.width-24)) + "\n")
	}
	return logPanel.Width(m.width - 3).Render(strings.TrimRight(b.String(), "\n"))
}

// logTimeStr formats an ISO timestamp to HH:MM:SS (best-effort).
func logTimeStr(iso string) string {
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.Format("15:04:05")
	}
	return ""
}

// --- codebase map panel --------------------------------------------------------------------

// mapPanelView renders the right-aligned CodebaseMapPanel (Ink CodebaseMapPanel.tsx).
func (m model) mapPanelView() string {
	// Fix the inner content width so the box stays one column SHORT of the terminal. Border (2) +
	// padding (2) = 4 cols of chrome, plus 1 spare column so the placed line is m.width-1 wide. A
	// full-width line auto-wraps the cursor, which desyncs the inline renderer's row count and makes
	// this box ghost/duplicate on resize (and overflow when zoomed narrow). Keeping it < m.width fixes
	// both.
	inner := m.width - 5
	if inner < 12 {
		return "" // too narrow for the panel — skip it rather than spill over the transcript
	}
	var b strings.Builder
	b.WriteString(mapHdr.Render("Codebase Map · ") + mapVal.Render(fmt.Sprintf("%d nodes · %d files", m.graph.NodeCount, m.graph.FileCount)) + "\n")
	if len(m.graph.Modules) > 0 {
		b.WriteString(mapHdr.Render("top modules (by criticality)") + "\n")
		for _, mod := range m.graph.Modules {
			dot := "○ "
			if mod.Criticality != "" {
				dot = "● "
			}
			// Clip the (plain) name before styling so each row stays one line within inner.
			budget := inner - 2 // the dot
			if mod.Criticality != "" {
				budget -= len(mod.Criticality) + 2
			}
			name := mod.Name
			if budget > 1 && len(name) > budget {
				name = clip(name, budget)
			}
			line := critStyle(mod.Criticality).Render(dot) + mapVal.Render(name)
			if mod.Criticality != "" {
				line += mapHdr.Render("  " + mod.Criticality)
			}
			b.WriteString(line + "\n")
		}
	}
	ai := mapVal.Render("✗ (run /index-ai)")
	if m.graph.AIGraphBuilt {
		ai = logOK.Render("✓")
	}
	b.WriteString(mapHdr.Render("AI graph: ") + ai)
	box := mapPanel.Width(inner).Render(b.String())
	// Place within m.width-1, never the full width — see the inner-width note above.
	return lipgloss.PlaceHorizontal(m.width-1, lipgloss.Right, box)
}

// compactMapView is the one-line pinned codebase-map summary (right-aligned above the prompt): node
// count + the top few modules by criticality, colour-dotted. Empty until the graph is indexed. The
// full multi-line panel is still available via /map.
func (m model) compactMapView() string {
	if m.graph.NodeCount == 0 {
		return ""
	}
	// LEFT-aligned, plain (no wide/ambiguous glyphs), and truncated to width-2 — NOT right-aligned and
	// padded to full width. A full-width line with a width-miscounted glyph (the old ⛁/● right-aligned
	// version) overflows the terminal, wraps, and desyncs Bubble Tea's inline cursor-up clear → the
	// whole live region multiplies on every tea.Println / zoom. A short left-aligned line can't wrap.
	var b strings.Builder
	b.WriteString(mapHdr.Render("Map ") + mapVal.Render(fmt.Sprintf("%d nodes · %d files", m.graph.NodeCount, m.graph.FileCount)))
	shown := 0
	for _, mod := range m.graph.Modules {
		if shown >= 3 {
			break
		}
		b.WriteString(mapHdr.Render(" · ") + mapVal.Render(clip(mod.Name, 18)))
		shown++
	}
	line := b.String()
	// width-2 (not width-1): a 1-cell safety margin in case any glyph is rendered wider than measured.
	if max := m.width - 2; max > 0 && lipgloss.Width(line) > max {
		line = ansi.Truncate(line, max, "…")
	}
	return line
}

// --- token meter ---------------------------------------------------------------------------

// filledCells is ProgressBar.tsx's geometry: how many of width cells are filled for a [0,1] fraction.
func filledCells(fraction float64, width int) int {
	if width <= 0 || math.IsNaN(fraction) {
		return 0
	}
	if fraction < 0 {
		fraction = 0
	}
	if fraction > 1 {
		fraction = 1
	}
	return int(math.Round(fraction * float64(width)))
}

// tokenMeterView renders the right-aligned model + context-usage bar + token estimate (Ink token
// meter line). Empty until the engine has reported a model via ui_snapshot.
func (m model) tokenMeterView() string {
	// Show the model that will actually handle the turn — lite by default, coding when the tier is
	// heavy — so the meter matches the footer pointer (it used to always show the coding model, which
	// made it look like minimax was answering even while step-fun was).
	model := m.fLite
	if m.fTier == "heavy" {
		model = m.fCoding
	}
	if model == "" {
		model = m.fCoding
	}
	if model == "" {
		model = m.fLite
	}
	if model == "" {
		return ""
	}
	// "Tokens that will be sent" = fixed baseline (system prompt + tool schemas) + the live
	// conversation, matching Ink's meter — not just the streamed reply (which read as ~0%). The
	// in-flight stream is added too so the meter visibly grows while a reply generates.
	tokens := m.ctxBaseline + m.histTokens + len([]rune(m.stream))/4
	var b strings.Builder
	if m.ctxWindow > 0 {
		const w = 12
		frac := float64(tokens) / float64(m.ctxWindow)
		filled := filledCells(frac, w)
		pct := int(math.Round(frac * 100))
		if pct > 100 {
			pct = 100
		}
		b.WriteString(meterFill.Render(strings.Repeat("█", filled)) + meterEmpty.Render(strings.Repeat("░", w-filled)) + meterText.Render(fmt.Sprintf(" %d%%  ", pct)))
	}
	b.WriteString(meterText.Render(fmt.Sprintf("%s · ~%s tok", shortModel(model), humanCount(tokens))))
	// m.width-1, not full width — a line that fills the terminal auto-wraps and ghosts on resize.
	return lipgloss.PlaceHorizontal(m.width-1, lipgloss.Right, b.String())
}

// --- working / thinking indicators ---------------------------------------------------------

// thinkingView is ThinkingText.tsx: a shimmer phrase + animated dots + the last reasoning snippet.
// fmtElapsed renders seconds as "12s" or "3m 24s" so long waits read clearly (900s → "15m 00s")
// instead of a giant raw second count.
func fmtElapsed(secs int) string {
	if secs < 60 {
		return fmt.Sprintf("%ds", secs)
	}
	return fmt.Sprintf("%dm %02ds", secs/60, secs%60)
}

func (m model) thinkingView() string {
	phrase := thinkingPhrases[m.phraseIdx%len(thinkingPhrases)]
	dots := strings.Repeat(".", m.thinkDots)
	// Bold, unmistakable: spinner + "✻ <phrase>… <elapsed>" so a long reasoning phase (minimax can
	// think for minutes before the first token) always reads as "still working, Ns elapsed", with a
	// visible cancel hint — never a hang.
	s := m.spin.View() + " " + workLabel.Render("✻ "+phrase+dots+" "+fmtElapsed(m.elapsed)) + statusStyle.Render(" · esc to stop")
	if m.thinkSnip != "" {
		s += thinkSnip.Render(" " + m.thinkSnip)
	}
	return s
}

// workingView: braille spinner + a bold "⏺ Generating… Ns" clock + cancel hint while the answer streams.
func (m model) workingView() string {
	return m.spin.View() + " " + workLabel.Render("⏺ Generating… "+fmtElapsed(m.elapsed)) + statusStyle.Render(" · esc to stop")
}

// toolingView: the same persistent indicator while the model is running tools, so "still working,
// Ns elapsed, esc to stop" stays visible through the tool-call phase (not just text generation).
func (m model) toolingView() string {
	n := len(m.runningTools)
	label := "⚙ Running tool… "
	if n > 1 {
		label = fmt.Sprintf("⚙ Running %d tools… ", n)
	}
	return m.spin.View() + " " + workLabel.Render(label+fmtElapsed(m.elapsed)) + statusStyle.Render(" · esc to stop")
}

// --- dashboards ----------------------------------------------------------------------------

// renderShortcuts returns the /shortcuts key table (handled Go-side; the headless engine has no
// keybindings registry).
func renderShortcuts() string {
	rows := [][2]string{
		{"Enter", "Submit input"},
		{"Ctrl+J", "Insert newline"},
		{"Ctrl+C", "Cancel turn / quit when idle"},
		{"Ctrl+G", "Command palette"},
		{"Ctrl+F", "Search transcript & logs"},
		{"Ctrl+O", "Toggle log view"},
		{"Ctrl+B", "Collapse/expand tool calls"},
		{"Ctrl+P", "Preview pasted blocks"},
		{"Esc", "Stash input / dismiss"},
		{"Ctrl+R", "Resume stashed input"},
		{"Tab", "Accept autocomplete"},
		{"↑/↓", "History / completion nav"},
		{"PgUp/PgDn", "Scroll transcript"},
	}
	var b strings.Builder
	b.WriteString(dashTitle.Render("Keyboard shortcuts") + "\n")
	for _, r := range rows {
		b.WriteString(dashKey.Render(fmt.Sprintf("  %-12s", r[0])) + dashVal.Render(r[1]) + "\n")
	}
	return dashPanel.Render(strings.TrimRight(b.String(), "\n"))
}

// renderDashboard renders a HelpDashboard / StatsDashboard / DataTableDashboard message into a
// bordered panel (Ink Dashboards.tsx + Transcript MessageRow).
func renderDashboard(me MessageEntry, width int) string {
	var b strings.Builder
	switch me.UIComponent {
	case "HelpDashboard":
		var p HelpPayload
		_ = json.Unmarshal(me.Payload, &p)
		b.WriteString(dashTitle.Render("Commands") + "\n")
		for _, sec := range p.Sections {
			b.WriteString(dashColor(sec.Color).Render(sec.Title) + "\n")
			for _, c := range sec.Commands {
				b.WriteString(dashKey.Render(fmt.Sprintf("  %-14s", c.Cmd)) + dashVal.Render(c.Desc) + "\n")
			}
		}
	case "StatsDashboard":
		var p StatsPayload
		_ = json.Unmarshal(me.Payload, &p)
		if p.Title != "" {
			b.WriteString(dashTitle.Render(p.Title) + "\n")
		}
		for _, it := range p.Items {
			b.WriteString(dashKey.Render(fmt.Sprintf("  %-20s", it.Label)) + dashVal.Render(it.Value) + "\n")
		}
	case "DataTableDashboard":
		var p DataTablePayload
		_ = json.Unmarshal(me.Payload, &p)
		if p.Title != "" {
			b.WriteString(dashTitle.Render(p.Title) + "\n")
		}
		if len(p.Headers) > 0 {
			b.WriteString(dashColor("cyan").Render(tableRow(p.Headers)) + "\n")
		}
		for _, row := range p.Rows {
			b.WriteString(dashVal.Render(tableRow(row)) + "\n")
		}
	}
	return dashPanel.Render(strings.TrimRight(b.String(), "\n"))
}

// tableRow lays out a data-table row: first column 15 wide, the rest 30 (Ink DataTableDashboard).
func tableRow(cells []string) string {
	var parts []string
	for i, c := range cells {
		w := 30
		if i == 0 {
			w = 15
		}
		parts = append(parts, fmt.Sprintf("%-*s", w, clip(c, w-1)))
	}
	return strings.Join(parts, " ")
}

var hunkRe = regexp.MustCompile(`@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@`)

// renderDiff renders a unified diff Claude-Code style: a dim line-number gutter, and the WHOLE
// changed line on a coloured background (dark green = added, dark red = removed) with bright text;
// context lines stay dim. `@@` hunk headers are consumed to drive line numbers, not shown. Capped to
// maxLines.
func renderDiff(diff string, maxLines int, fillWidth int, filename string) string {
	type row struct {
		num  int
		sign byte
		text string
	}
	var rows []row
	oldLn, newLn := 0, 0
	for _, ln := range strings.Split(strings.TrimRight(diff, "\n"), "\n") {
		if m := hunkRe.FindStringSubmatch(ln); m != nil {
			fmt.Sscanf(m[1], "%d", &oldLn)
			fmt.Sscanf(m[2], "%d", &newLn)
			continue
		}
		if ln == "" {
			rows = append(rows, row{newLn, ' ', ""})
			oldLn++
			newLn++
			continue
		}
		switch ln[0] {
		case '+':
			rows = append(rows, row{newLn, '+', ln[1:]})
			newLn++
		case '-':
			rows = append(rows, row{oldLn, '-', ln[1:]})
			oldLn++
		default:
			rows = append(rows, row{newLn, ' ', strings.TrimPrefix(ln, " ")})
			oldLn++
			newLn++
		}
	}
	if len(rows) == 0 {
		return ""
	}
	// Gutter width grows with the largest line number (was a fixed %4d that misaligned past 9999).
	digits := 3
	for _, r := range rows {
		if d := len(fmt.Sprint(r.num)); d > digits {
			digits = d
		}
	}
	gutterCols := digits + 1 // "%*d " — line number + one trailing space
	// Claude-Code-style diffs: changed lines get a full-width green/red BACKGROUND (added/removed),
	// context lines are syntax-highlighted on the default background. The background is the source of
	// the old "red/green bleeds to column 0" bug — a background-styled line that exceeds the terminal
	// auto-wraps and the colour continues at column 0 on the wrapped row. We defeat that two ways:
	//   1. pad each changed line to EXACTLY `fillWidth` so the bg fills the row and no further,
	//   2. hard-clamp every emitted line to `fillWidth` with an ANSI-aware truncate (closes the SGR),
	// so it is mathematically impossible for a diff line to be wider than its budget and wrap. codeW
	// excludes the gutter + the 2-char "+ "/"- " sign prefix.
	clampW := fillWidth
	if clampW <= 0 {
		clampW = 80
	}
	codeW := clampW - gutterCols - 2
	if codeW < 1 {
		codeW = 1
	}
	lexer := lexers.Match(filename) // resolved once for the whole diff

	var b strings.Builder
	shown := 0
	for _, r := range rows {
		if shown >= maxLines {
			b.WriteString(dimStyle.Render("  …(diff truncated)") + "\n")
			break
		}
		num := fmt.Sprintf("%*d ", digits, r.num)
		txt := r.text
		if rs := []rune(txt); len(rs) > codeW {
			txt = string(rs[:codeW-1]) + "…"
		}
		pad := codeW - len([]rune(txt))
		if pad < 0 {
			pad = 0
		}
		// Gutter line number: bright white + bold on every line type (prominent column, per request).
		// On changed lines it keeps the diff background; on context lines it has none.
		var line string
		switch r.sign {
		case '+':
			line = diffAddLine.Foreground(lipgloss.Color("#FFFFFF")).Bold(true).Render(num) + diffAddLine.Render("+ ") +
				chromaRender(diffAddLine, lexer, txt) + diffAddLine.Render(strings.Repeat(" ", pad))
		case '-':
			line = diffDelLine.Foreground(lipgloss.Color("#FFFFFF")).Bold(true).Render(num) + diffDelLine.Render("- ") +
				chromaRender(diffDelLine, lexer, txt) + diffDelLine.Render(strings.Repeat(" ", pad))
		default:
			// Context: white+bold line number (diffLineNum) + subtle syntax colours (dim fallback), no bg.
			line = diffLineNum.Render(num) + " " + chromaRender(dimStyle, lexer, txt)
		}
		// Belt-and-suspenders: never let a row exceed its width budget, whatever the content.
		b.WriteString(ansi.Truncate(line, clampW, "") + "\n")
		shown++
	}
	return strings.TrimRight(b.String(), "\n")
}

// Nord — a calm, muted, low-pink palette for subtle syntax highlighting (keywords steel-blue, not
// the neon pink of monokai/onedark). Used for diff code so it reads as "normal", not rainbow.
var syntaxTheme = styles.Get("nord")

type codeSeg struct {
	color string // "#rrggbb", or "" for the base/default foreground
	text  string
}

// chromaSegs tokenises one line of code into coloured runs. Nil lexer / error → one uncoloured run.
func chromaSegs(lexer chroma.Lexer, code string) []codeSeg {
	if lexer == nil {
		return []codeSeg{{"", code}}
	}
	it, err := lexer.Tokenise(nil, code)
	if err != nil {
		return []codeSeg{{"", code}}
	}
	var out []codeSeg
	for _, t := range it.Tokens() {
		hex := ""
		if c := syntaxTheme.Get(t.Type).Colour; c.IsSet() {
			hex = c.String()
		}
		out = append(out, codeSeg{hex, t.Value})
	}
	return out
}

// chromaRender colours each token with its nord syntax foreground over the given base style. The base
// carries the background (the diff add/remove fill) and the fallback foreground for uncoloured tokens,
// so a changed line keeps its green/red bg and a context line stays dim.
func chromaRender(base lipgloss.Style, lexer chroma.Lexer, code string) string {
	var b strings.Builder
	for _, seg := range chromaSegs(lexer, code) {
		st := base
		if seg.color != "" {
			st = base.Foreground(lipgloss.Color(seg.color))
		}
		b.WriteString(st.Render(seg.text))
	}
	return b.String()
}

// diffPath pulls the edited file path out of a tool-call input so the diff can be syntax-highlighted.
func diffPath(input string) string {
	var p map[string]any
	if json.Unmarshal([]byte(input), &p) == nil {
		for _, k := range []string{"filePath", "file_path", "path"} {
			if v, ok := p[k].(string); ok && v != "" {
				return v
			}
		}
	}
	return ""
}

// shortModel strips the provider prefix: "minimaxai/minimax-m3" → "minimax-m3".
func shortModel(id string) string {
	if i := strings.LastIndex(id, "/"); i >= 0 {
		return id[i+1:]
	}
	return id
}

// humanCount renders a token count compactly: 1234 → "1.2k".
func humanCount(n int) string {
	if n < 1000 {
		return fmt.Sprint(n)
	}
	return fmt.Sprintf("%.1fk", float64(n)/1000)
}

// --- small helpers -------------------------------------------------------------------------

func digit(s string) int {
	if len(s) == 1 && s[0] >= '1' && s[0] <= '9' {
		return int(s[0] - '0')
	}
	return -1
}

func firstOr(s []string, def string) string {
	if len(s) > 0 {
		return s[0]
	}
	return def
}
