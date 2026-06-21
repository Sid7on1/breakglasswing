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
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Bubble Tea messages wrapping engine events so they flow through Update like any other tea.Msg.
type engineMsg Outbound
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
		m, ok := <-e.Msgs
		if !ok {
			return engineClosed{}
		}
		return engineMsg(m)
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
	printQueue []string // lines to flush into the terminal scrollback (tea.Println) this Update cycle
	started  bool     // true once any transcript line has been emitted (for inter-turn spacing)
	// In-flight tool calls shown in the live region until their result arrives, then committed to
	// scrollback as one finished entry. Order keeps the render stable (map iteration would flicker).
	runningTools map[string]string
	runningOrder []string
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

	bell    bool // emit a terminal bell when a turn completes
	clipped int  // transcript lines scrolled off the top of the viewport (0 = all visible)

	welcomed bool // the low-chrome welcome banner has been shown once at the top of the transcript

	// tool-call lines, indexed by call id so a tool_call_result updates its line in place (Ink
	// re-rendered the same component) instead of printing a second row.
	toolLine map[string]int

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
	return model{
		engine:   e,
		input:    ta,
		spin:     sp,
		history:  hist,
		histIdx:  len(hist),
		vp:           viewport.New(80, 20),
		status:       "starting engine…",
		toolLine:     map[string]int{},
		runningTools: map[string]string{},
		bell:         os.Getenv("BGW_ENABLE_NOTIFICATIONS") != "0",
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(waitForEngine(m.engine), textarea.Blink, m.spin.Tick, tick())
}

// Update wraps the real handler (update) and flushes any transcript lines it queued into the
// terminal's native scrollback via tea.Println — so committed output scrolls/copies natively while
// the redrawn View stays just the live region.
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	res, cmd := m.update(msg)
	nm, ok := res.(model)
	if !ok || len(nm.printQueue) == 0 {
		return res, cmd
	}
	joined := strings.Join(nm.printQueue, "\n")
	nm.printQueue = nil
	printCmd := tea.Println(joined)
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
		// The input sits inside promptBox (rounded border + 1-col padding each side) whose total
		// width is m.width-2, so its content area — and thus the input — is m.width-6. Matching this
		// exactly stops the textarea from overrunning the right border into a stray box.
		m.input.SetWidth(msg.Width - 6)
		m.relayout()
		// Inline mode: no alt-screen to wipe — the terminal reflows naturally on resize.
		return m, nil

	case spinner.TickMsg:
		// Keep the frame animating; it's only painted while busy (see View).
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd

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
			if m.busy {
				m.engine.Send(encodeInterrupt())
				return m, nil
			}
			m.engine.Close()
			return m, tea.Quit
		// Scrolling is the TERMINAL's job now (inline mode) — PgUp/PgDn, wheel, trackpad all work
		// natively against real scrollback. The app no longer intercepts them.
		case "ctrl+l":
			// Clear the physical terminal and force a clean repaint (parity with the Ink UI). The
			// transcript itself is untouched — use /clear to reset the conversation.
			m.refresh()
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
			// While a turn is running, esc cancels it (matches the "esc to stop" hint, same as Ctrl+C).
			if m.busy {
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
			m.requestCompletions()
			return m, nil
		case "tab":
			if m.compOpen {
				m.acceptCompletion()
			}
			m.requestCompletions() // open, or refine after accept (e.g. descend a dir)
			return m, nil
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
			if text != "" {
				m.engine.Send(encodeInput(text)) // engine echoes the user message back
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
		m.requestCompletions() // refresh candidates for the new input
		m.relayout()
		return m, cmd

	case engineMsg:
		m.handleEngine(Outbound(msg))
		if m.quitting { // engine emitted `shutdown` — exit cleanly
			m.engine.Close()
			return m, tea.Quit
		}
		return m, waitForEngine(m.engine) // keep listening

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
func (m *model) requestCompletions() {
	v := m.input.Value()
	if v == "" {
		if m.compOpen {
			m.compOpen = false
			m.relayout()
		}
		return
	}
	m.queryID++
	m.engine.Send(encodeQuery(m.queryID, v))
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

// relayout re-sizes + re-renders the viewport. Kept as a named entry point for the many call sites
// that change chrome (open/close a dropdown or menu, grow the input); it just delegates to refresh,
// which now owns the height calculation so it stays correct as engine events stream content in too.
func (m *model) relayout() { m.refresh() }

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
		if wasBusy && !m.busy && m.bell {
			fmt.Print("\a") // notification bell when a turn completes
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
			line := renderToolCall(tc)
			running := tc.Status == "running" || tc.Status == ""
			if tc.ID != "" && running {
				// Show it live (in View) until the result arrives — can't update scrollback in place.
				if _, seen := m.runningTools[tc.ID]; !seen {
					m.runningOrder = append(m.runningOrder, tc.ID)
				}
				m.runningTools[tc.ID] = line
			} else {
				// Finished: drop the live copy and commit the finished entry to scrollback.
				if tc.ID != "" {
					delete(m.runningTools, tc.ID)
				}
				m.append(line)
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
		if r := renderTodos(todos); r != "" && r != m.lastTodoRender {
			m.lastTodoRender = r
			m.append(r)
		}

	case "clear":
		// /clear: wipe the transcript and per-turn state, then re-show the welcome banner so the
		// screen looks freshly launched (the engine has already reset the conversation history).
		m.lines = nil
		m.started = false
		m.stream = ""
		m.toolLine = map[string]int{}
		m.runningTools = map[string]string{}
		m.runningOrder = nil
		m.todos = nil
		m.lastTodoRender = ""
		m.histTokens = 0
		m.clipped = 0
		m.welcomed = false
		m.showWelcome()
		m.refresh()

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
func renderToolCall(tc ToolCall) string {
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
	if summary == "" {
		return indent + header
	}
	sumStyle := dimStyle
	if tc.Status == "error" {
		sumStyle = errStyle
	}
	return indent + header + "\n" + indent + "  " + toolGut.Render("⎿ ") + sumStyle.Render(summary)
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

// renderTodos draws the task list as a checklist. Empty list → empty string (nothing to show).
func renderTodos(todos []TodoItem) string {
	if len(todos) == 0 {
		return ""
	}
	var b strings.Builder
	done := 0
	for _, t := range todos {
		icon := "☐"
		st := dimStyle
		switch t.Status {
		case "completed":
			icon, st, done = "☑", toolStyle, done+1
		case "in_progress":
			icon, st = "◐", asstStyle
		}
		b.WriteString(st.Render(fmt.Sprintf("  %s %s", icon, t.Content)) + "\n")
	}
	header := asstStyle.Render(fmt.Sprintf("  Tasks (%d/%d)", done, len(todos)))
	return header + "\n" + strings.TrimRight(b.String(), "\n")
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
		m.toolLine = map[string]int{}
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

// append commits a transcript line: it is QUEUED for the terminal scrollback (flushed via tea.Println
// by the Update wrapper) and also kept in a bounded in-memory slice purely so Ctrl+F search still has
// something to grep. We never render m.lines — the terminal owns the visible transcript now.
const (
	transcriptCap  = 2000
	transcriptKeep = 1500
)

func (m *model) append(line string) {
	m.printQueue = append(m.printQueue, line)
	m.started = true
	m.lines = append(m.lines, line)
	if len(m.lines) > transcriptCap {
		drop := len(m.lines) - transcriptKeep
		m.lines = append(m.lines[:0:0], m.lines[drop:]...) // keep the tail in a fresh backing array
	}
}

// transcriptBody joins the committed transcript with any in-flight streamed tokens.
func (m *model) transcriptBody() string {
	body := strings.Join(m.lines, "\n")
	if m.stream != "" {
		if body != "" {
			body += "\n"
		}
		// Indent the in-flight stream to the same +2 gutter the finalized assistant reply uses, so the
		// answer doesn't jump leftward the instant streaming ends and the rendered message replaces it.
		body += indentLines(streamStyle.Render(m.stream), "  ")
	}
	return body
}

// refresh is a no-op in inline mode — the committed transcript lives in the terminal's own
// scrollback (printed via tea.Println), so there is no viewport buffer to rebuild. Kept as a method
// so the handful of existing m.refresh() call sites don't need touching.
func (m *model) refresh() {}

// View renders ONLY the live region — the in-flight streamed answer plus the chrome (menus,
// completion dropdown, thinking indicator, map/token panels, prompt box, footer). Everything that
// has been committed is already in the terminal's scrollback. Redrawn in place each frame.
func (m model) View() string {
	var rows []string
	if m.stream != "" {
		// Indent the in-flight stream to the same +2 gutter the finalized reply uses, so the text
		// doesn't jump leftward the instant streaming ends and the committed message replaces it.
		rows = append(rows, indentLines(streamStyle.Render(m.stream), "  "))
	}
	// Tool calls still running show live; each commits to scrollback when its result lands.
	for _, id := range m.runningOrder {
		if line, ok := m.runningTools[id]; ok {
			rows = append(rows, line)
		}
	}
	rows = append(rows, m.belowSections()...)
	out := strings.Join(rows, "\n")
	// Safety: never emit more rows than the terminal has, or the inline renderer would push the top
	// of the live region into scrollback. Clip from the TOP so the prompt + footer stay visible.
	if m.height > 0 {
		lines := strings.Split(out, "\n")
		if len(lines) > m.height {
			out = strings.Join(lines[len(lines)-m.height:], "\n")
		}
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
	s = append(s, m.midView())
	// The map panel + token meter are ambient chrome — hide them while an overlay (menu, completion
	// dropdown, search, log view, or a request) is up, both to keep the focus on the overlay and to
	// keep the total frame within the terminal height (a tall menu + panels would overflow and leave
	// ghost rows on small terminals).
	overlay := m.menuOpen || m.compOpen || m.searchMode || m.showLogs || m.reqOpen
	if !overlay {
		if m.graph.NodeCount > 0 {
			s = append(s, m.mapPanelView())
		}
		if tm := m.tokenMeterView(); tm != "" {
			s = append(s, tm)
		}
	}
	// A blank spacer above the prompt box (Ink's marginTop on the input container) so the answer and
	// the input never butt up against each other.
	s = append(s, "", m.promptView(), m.footerLine())
	return s
}

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
			b.WriteString(renderDiff(m.reqBody, 16) + "\n")
		}
		for i, op := range m.reqOpts {
			b.WriteString(fmt.Sprintf("  %d) %s\n", i+1, op))
		}
		b.WriteString(dimStyle.Render("press 1–" + fmt.Sprint(len(m.reqOpts)) + " · esc to dismiss"))
		return requestBox.Width(m.width - 2).Render(b.String())
	}

	var b strings.Builder
	// Masked free-form prompt (API keys): render the typed value as bullets instead of the textarea,
	// so a secret never shows on screen even though it still flows through the input field.
	if m.reqOpen && m.reqKind == "input" && m.reqMasked {
		b.WriteString(caretStyle.Render("❯ ") + asstStyle.Render(strings.Repeat("•", len([]rune(m.input.Value())))))
		return promptBox.Width(m.width - 2).Render(b.String())
	}

	if m.stash != "" {
		b.WriteString(subtleStyle.Render("[Stashed] Press Ctrl+R to resume") + "\n")
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
	return promptBox.Width(m.width - 2).Render(b.String())
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

	withHints := strings.Join(append(append([]string{}, core...), hints, modelRendered), footerSep)
	rightStr := withHints
	if lipgloss.Width(left)+lipgloss.Width(withHints)+1 > m.width {
		rightStr = strings.Join(append(append([]string{}, core...), modelRendered), footerSep)
	}

	leftW, rightW := lipgloss.Width(left), lipgloss.Width(rightStr)
	gap := m.width - leftW - rightW
	if gap < 1 {
		if avail := m.width - rightW - 1; avail >= 0 {
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
		return logPanel.Width(m.width - 2).Render(b.String())
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
	return logPanel.Width(m.width - 2).Render(strings.TrimRight(b.String(), "\n"))
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
	var b strings.Builder
	b.WriteString(mapHdr.Render("Codebase Map · ") + mapVal.Render(fmt.Sprintf("%d nodes · %d files", m.graph.NodeCount, m.graph.FileCount)) + "\n")
	if len(m.graph.Modules) > 0 {
		b.WriteString(mapHdr.Render("top modules (by criticality)") + "\n")
		for _, mod := range m.graph.Modules {
			dot := "○ "
			if mod.Criticality != "" {
				dot = "● "
			}
			line := critStyle(mod.Criticality).Render(dot) + mapVal.Render(mod.Name)
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
	box := mapPanel.Render(b.String())
	return lipgloss.PlaceHorizontal(m.width, lipgloss.Right, box)
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
	return lipgloss.PlaceHorizontal(m.width, lipgloss.Right, b.String())
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

// renderDiff colorizes a unified diff (green adds, red deletes, cyan hunks), capped to maxLines.
func renderDiff(diff string, maxLines int) string {
	lines := strings.Split(strings.TrimRight(diff, "\n"), "\n")
	truncated := false
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		truncated = true
	}
	var b strings.Builder
	for _, ln := range lines {
		switch {
		case strings.HasPrefix(ln, "+"):
			b.WriteString(diffAdd.Render(ln))
		case strings.HasPrefix(ln, "-"):
			b.WriteString(diffDel.Render(ln))
		case strings.HasPrefix(ln, "@@"):
			b.WriteString(diffHunk.Render(ln))
		default:
			b.WriteString(dimStyle.Render(ln))
		}
		b.WriteString("\n")
	}
	if truncated {
		b.WriteString(dimStyle.Render("  …(diff truncated)"))
	}
	return strings.TrimRight(b.String(), "\n")
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
