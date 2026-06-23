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
)

// Bubble Tea messages wrapping engine events so they flow through Update like any other tea.Msg.
type engineMsg Outbound
type engineBatch []Outbound
type engineClosed struct{}

// tickMsg drives the once-a-second chrome animation: the working-indicator elapsed clock and the
// thinking-phrase / dot rotation. Separate from the braille spinner.Tick (sub-second frames).
type tickMsg time.Time

func tick() tea.Cmd {
	return tea.Tick(time.Millisecond*50, func(t time.Time) tea.Msg { return tickMsg(t) })
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

// spinnerVerbs mirrors Claude Code's 188-verb list for quirky loading states.
var spinnerVerbs = []string{
	"Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking",
	"Beaming", "Beboppin'", "Befuddling", "Billowing", "Blanching",
	"Bloviating", "Boogieing", "Boondoggling", "Booping", "Bootstrapping",
	"Brewing", "Bunning", "Burrowing", "Calculating", "Canoodling",
	"Caramelizing", "Cascading", "Catapulting", "Cerebrating", "Channeling",
	"Channelling", "Choreographing", "Churning", "Clauding", "Coalescing",
	"Cogitating", "Combobulating", "Composing", "Computing", "Concocting",
	"Considering", "Contemplating", "Cooking", "Crafting", "Creating",
	"Crunching", "Crystallizing", "Cultivating", "Deciphering", "Deliberating",
	"Determining", "Dilly-dallying", "Discombobulating", "Doing", "Doodling",
	"Drizzling", "Ebbing", "Effecting", "Elucidating", "Embellishing",
	"Enchanting", "Envisioning", "Evaporating", "Fermenting", "Fiddle-faddling",
	"Finagling", "Flambéing", "Flibbertigibbeting", "Flowing", "Flummoxing",
	"Fluttering", "Forging", "Forming", "Frolicking", "Frosting",
	"Gallivanting", "Galloping", "Garnishing", "Generating", "Gesticulating",
	"Germinating", "Gitifying", "Grooving", "Gusting", "Harmonizing",
	"Hashing", "Hatching", "Herding", "Honking", "Hullaballooing",
	"Hyperspacing", "Ideating", "Imagining", "Improvising", "Incubating",
	"Inferring", "Infusing", "Ionizing", "Jitterbugging", "Julienning",
	"Kneading", "Leavening", "Levitating", "Lollygagging", "Manifesting",
	"Marinating", "Meandering", "Metamorphosing", "Misting", "Moonwalking",
	"Moseying", "Mulling", "Mustering", "Musing", "Nebulizing",
	"Nesting", "Newspapering", "Noodling", "Nucleating", "Orbiting",
	"Orchestrating", "Osmosing", "Perambulating", "Percolating", "Perusing",
	"Philosophising", "Photosynthesizing", "Pollinating", "Pondering", "Pontificating",
	"Pouncing", "Precipitating", "Prestidigitating", "Processing", "Proofing",
	"Propagating", "Puttering", "Puzzling", "Quantumizing", "Razzle-dazzling",
	"Razzmatazzing", "Recombobulating", "Reticulating", "Roosting", "Ruminating",
	"Sautéing", "Scampering", "Schlepping", "Scurrying", "Seasoning",
	"Shenaniganing", "Shimmying", "Simmering", "Skedaddling", "Sketching",
	"Slithering", "Smooshing", "Sock-hopping", "Spelunking", "Spinning",
	"Sprouting", "Stewing", "Sublimating", "Swirling", "Swooping",
	"Symbioting", "Synthesizing", "Tempering", "Thinking", "Thundering",
	"Tinkering", "Tomfoolering", "Topsy-turvying", "Transfiguring", "Transmuting",
	"Twisting", "Undulating", "Unfurling", "Unravelling", "Vibing",
	"Waddling", "Wandering", "Warping", "Whatchamacalliting", "Whirlpooling",
	"Whirring", "Whisking", "Wibbling", "Working", "Wrangling",
	"Zesting", "Zigzagging",
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
	showFullMap bool
	logs     []LogEntry

	// masked free-form prompt (API keys): render the typed value as bullets in promptView.
	reqMasked bool

	// codebase-map panel + token meter, fed by ui_snapshot.
	graph       GraphSummary
	ctxWindow   int
	ctxBaseline int // system prompt + tool schemas (fixed per-request cost), from ui_snapshot
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
		sessionVerb:  spinnerVerbs[time.Now().UnixNano()%int64(len(spinnerVerbs))],
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
		
		// In inline mode, resizing the terminal narrower causes previously printed lines to wrap, creating
		// physical rows that Bubble Tea doesn't know about. This breaks the inline `CursorUp` clear, leaving
		// severe "ghost" artifacts of the old frame permanently on the screen.
		// To fix this, we MUST clear the physical screen on resize. To prevent the user from losing their
		// context, we immediately reprint the visible portion of the transcript so it seamlessly fills the
		// screen again (even though this adds duplicates to the native scrollback buffer above).
		m.pendingClear = true
		if len(m.lines) > 0 {
			start := len(m.lines) - m.height + 15 // buffer for the live UI height
			if start < 0 {
				start = 0
			}
			m.printQueue = append(m.printQueue, m.lines[start:]...)
		}
		return m, tea.ClearScreen

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
		// 50ms animation chrome: elapsed clock + smooth shimmer/pulse animation.
		if m.busy && !m.busyStart.IsZero() {
			m.elapsed = int(time.Since(m.busyStart).Seconds())
		}
		m.thinkDots = (m.thinkDots + 1) % 4
		m.thinkTick++
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
				m.menuOpen = false
				m.menuFilter = ""
				m.relayout()
				if len(filtered) > 0 {
					if m.menuID != "" {
						m.engine.Send(encodeMenuSelect(m.menuID, filtered[m.menuIdx].Value))
					} else {
						val := filtered[m.menuIdx].Value
						switch val {
						case "/map":
							m.showFullMap = !m.showFullMap
						case "/shortcuts":
							m.append(renderShortcuts())
						default:
							m.engine.Send(encodeInput(val))
						}
					}
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
			if m.showFullMap {
				m.showFullMap = false
				m.relayout()
				return m, nil
			}
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
			if m.compOpen {
				isCmd := m.acceptCompletion()
				if !isCmd {
					return m, nil
				}
			}
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
				m.showFullMap = !m.showFullMap
				m.input.SetValue("")
				m.input.SetHeight(1)
				m.relayout()
				return m, nil
			}
			if text != "" {
				if m.working() {
					m.queued = append(m.queued, text)
					m.status = fmt.Sprintf("Queued (%d) — runs after the current turn", len(m.queued))
				} else {
					m.engine.Send(encodeInput(text)) // engine echoes the user message back
				}
				m.pushHistory(strings.TrimSpace(raw))
				m.input.SetValue("")
				m.input.SetHeight(1)
				m.clearPastes()
				m.status = "DEBUG: text=" + text
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
	if m.showFullMap {
		if mp := m.mapPanelView(); mp != "" {
			s = append(s, mp)
		} else {
			s = append(s, dimStyle.Render("  no codebase map yet — run /index-ai to build it"))
		}
	}
	
	overlay := m.menuOpen || m.compOpen || m.searchMode || m.showLogs || m.reqOpen || m.showFullMap
	if !overlay {
		td := m.activeTodoPanel()
		cm := m.compactMapView()
		
		// Add a blank spacer above the pinned panels so they don't stick directly to the transcript
		// or working indicators.
		if td != "" || cm != "" {
			s = append(s, "")
		}
		
		// Pin the task list above the prompt while any task is unfinished (Claude-Code-style live
		// panel) so it doesn't scroll off into the transcript.
		if td != "" {
			s = append(s, td)
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
func (m model) working() bool { return m.busy || len(m.runningTools) > 0 }
