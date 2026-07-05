package main

import "encoding/json"

// Go mirror of src/protocol/protocol.ts. The engine speaks NDJSON; we decode the outbound
// envelope generically and branch on `t` (and, for events, on `name`).

// supportedProtocol is the wire version this TUI speaks — must match PROTOCOL_VERSION in
// src/protocol/protocol.ts. The engine reports its version in the `ready` handshake; a mismatch
// is surfaced to the user instead of silently dropping/garbling messages.
const supportedProtocol = 1

// Outbound — engine → TUI. One struct covers all three message kinds (event/request/ready);
// only the relevant fields are populated per `t`.
type Outbound struct {
	T        string            `json:"t"`
	Name     string            `json:"name,omitempty"`     // event name
	Args     []json.RawMessage `json:"args,omitempty"`     // event payload (shape depends on Name)
	ID       int               `json:"id,omitempty"`       // request id
	Kind     string            `json:"kind,omitempty"`     // request kind ("prompt")
	Question string            `json:"question,omitempty"` // request prompt
	Options  []string          `json:"options,omitempty"`  // request choices
	IsAsk    bool              `json:"isAsk,omitempty"`
	IsMulti  bool              `json:"isMulti,omitempty"`
	Masked   bool              `json:"masked,omitempty"`   // kind:"input" — the answer is a secret; render as bullets
	Protocol int               `json:"protocol,omitempty"` // ready handshake
	Items    []CompletionItem  `json:"items,omitempty"`    // queryResult
	Body     string            `json:"body,omitempty"`     // request kind:"diff" — the diff text
}

// CompletionItem mirrors src/protocol/protocol.ts — one autocomplete candidate.
type CompletionItem struct {
	Value          string `json:"value"`
	Label          string `json:"label"`
	Desc           string `json:"desc"`
	Kind           string `json:"kind"`
	Disabled       bool   `json:"disabled,omitempty"`
	DisabledReason string `json:"disabledReason,omitempty"`
}

// MessageEntry — the payload of a `message` event (args[0]). Mirrors src/cli/events.ts.
// Content is decoded leniently: the engine's sanitizeArgs can replace a React-element content with
// a {"__ui":"Name"} marker, so UnmarshalJSON falls back to "" when content isn't a plain string.
type MessageEntry struct {
	ID          string          `json:"id,omitempty"`
	Role        string          `json:"role"`
	Content     string          `json:"-"`
	Level       string          `json:"level,omitempty"`
	UIComponent string          `json:"uiComponent,omitempty"`
	Payload     json.RawMessage `json:"payload,omitempty"`
	ThoughtMs   int             `json:"thoughtMs,omitempty"`
	Timestamp   string          `json:"timestamp,omitempty"`
}

// UnmarshalJSON tolerates a non-string `content` (the {"__ui":…} React-element marker) instead of
// failing the whole message decode — the field just lands empty, the rest of the entry survives.
func (m *MessageEntry) UnmarshalJSON(b []byte) error {
	type alias MessageEntry
	var raw struct {
		alias
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	*m = MessageEntry(raw.alias)
	var s string
	if json.Unmarshal(raw.Content, &s) == nil {
		m.Content = s
	}
	return nil
}

// ToolCall — the payload of tool_call / tool_call_result events. StartTime/EndTime arrive as ISO
// date strings; ParentID/AgentLabel are set for sub-agent (swarm/speculate) calls.
type ToolCall struct {
	ID         string `json:"id"`
	ToolName   string `json:"toolName"`
	Status     string `json:"status"`
	Input      string `json:"input"`
	Output     string `json:"output"`
	StartTime  string `json:"startTime,omitempty"`
	EndTime    string `json:"endTime,omitempty"`
	ParentID   string `json:"parentId,omitempty"`
	AgentLabel string `json:"agentLabel,omitempty"`
}

// LogEntry — the payload of a `log` event (args[0]). Mirrors src/cli/events.ts LogEntry.
type LogEntry struct {
	ID        int    `json:"id"`
	Level     string `json:"level"`
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"`
}

// UiSnapshot — the payload of a `ui_snapshot` event (args[0]). Footer + map-panel + token-meter
// state the engine can't be read from out-of-process; mirrors src/protocol/ui.snapshot.ts.
type UiSnapshot struct {
	Models struct {
		Coding string `json:"coding"`
		Lite   string `json:"lite"`
	} `json:"models"`
	GoalCount      int          `json:"goalCount"`
	Mind           MindStrip    `json:"mind"`
	Graph          GraphSummary `json:"graph"`
	ContextWindow  int          `json:"contextWindow"`
	TokensBaseline int          `json:"tokensBaseline"`
	// Cumulative tokens saved this session by Headroom-style backlog compression.
	CompressionSaved int `json:"compressionSaved"`
}

// MindStrip — the mind layer's footer counters: learned weak spots being routed around,
// drives deviating from setpoint, compiled habits. Mirrors UiSnapshotMind in ui.snapshot.ts.
// The detail slices feed the Ctrl+X mind HUD (v2 §3.11 "explainable chip"): evidence with
// posterior stats and sparklines, not an opaque counter.
type MindStrip struct {
	WeakSpots       int         `json:"weakSpots"`
	DriveDeviations int         `json:"driveDeviations"`
	Habits          int         `json:"habits"`
	Weak            []MindWeak  `json:"weak,omitempty"`
	Drives          []MindDrive `json:"drives,omitempty"`
	HabitNames      []string    `json:"habitNames,omitempty"`
	Ledger          *MindLedger `json:"ledger,omitempty"`
}

// MindLedger — the epistemic ledger's verification posture (the correctness half of the HUD's
// receipts). Mirrors UiSnapshotMindLedger.
type MindLedger struct {
	Resolved      int `json:"resolved"`
	Open          int `json:"open"`
	Expired       int `json:"expired"`
	CoveragePct   int `json:"coveragePct"`
	Overconfident int `json:"overconfident"`
}

// MindWeak — one learned weak spot: the tool×domain cell, its posterior failure stats, and the
// routing advice the self-model injects. Mirrors UiSnapshotMindWeak.
type MindWeak struct {
	Tool     string  `json:"tool"`
	Domain   string  `json:"domain"`
	FailRate float64 `json:"failRate"`
	PWeak    float64 `json:"pWeak"`
	N        int     `json:"n"`
	Advice   string  `json:"advice"`
}

// MindDrive — one measured drive: label, last human-readable value, whether it's at setpoint,
// and its recent ok/deviating history (oldest → newest) for the sparkline.
type MindDrive struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Ok    bool   `json:"ok"`
	Spark []int  `json:"spark"`
}

// GraphSummary — the codebase-map overview behind CodebaseMapPanel.
type GraphSummary struct {
	NodeCount    int           `json:"nodeCount"`
	FileCount    int           `json:"fileCount"`
	AIGraphBuilt bool          `json:"aiGraphBuilt"`
	Modules      []GraphModule `json:"modules"`
	// Engine backing the graph tools: "codebase-memory" (158-lang engine + local semantic search),
	// "native" (in-memory AST graph), or "none". Badged in the codebase-map panel.
	Engine string `json:"engine,omitempty"`
}

type GraphModule struct {
	Name        string `json:"name"`
	Criticality string `json:"criticality,omitempty"`
}

// --- Dashboard payloads (message.uiComponent = "HelpDashboard" | "StatsDashboard" | "DataTableDashboard") ---

type HelpPayload struct {
	Sections []HelpSection `json:"sections"`
}

type HelpSection struct {
	Title    string        `json:"title"`
	Color    string        `json:"color"`
	Commands []HelpCommand `json:"commands"`
}

type HelpCommand struct {
	Cmd  string `json:"cmd"`
	Desc string `json:"desc"`
}

type StatsPayload struct {
	Type  string      `json:"type"`
	Title string      `json:"title"`
	Items []StatsItem `json:"items"`
}

type StatsItem struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type DataTablePayload struct {
	Title   string     `json:"title"`
	Headers []string   `json:"headers"`
	Rows    [][]string `json:"rows"`
}

// TodoItem — one entry of a todo_update event's payload (args[0] is []TodoItem). Mirrors
// src/tools/implementations/todo.tool.ts.
type TodoItem struct {
	Content string `json:"content"`
	Status  string `json:"status"` // "pending" | "in_progress" | "completed"
}

// SubAgent mirrors the engine's SubAgentClaim (subagent.blackboard.ts) — one row per spawned
// sub-agent, forwarded live via the subagent_update event and drawn in the sub-agent panel.
type SubAgent struct {
	TaskID    string `json:"taskId"`
	AgentType string `json:"agentType"`
	Scope     string `json:"scope"`
	Prompt    string `json:"prompt"`
	Status    string `json:"status"` // "running" | "done" | "failed"
	ToolCalls int    `json:"toolCalls"`
	StartedAt int64  `json:"startedAt"`
	EndedAt   int64  `json:"endedAt"`
	Result    string `json:"result"`
	Error     string `json:"error"`
}

// Menu — a command result forwarded as a `message` with uiComponent="menu". InitialIndex is the
// option the cursor should land on when the menu opens (e.g. the currently-set value in a toggle
// submenu) so an ON/OFF picker highlights the live setting instead of always starting at the top.
type Menu struct {
	ID           string       `json:"id"`
	Title        string       `json:"title"`
	Options      []menuOption `json:"options"`
	InitialIndex int          `json:"initialIndex"`
}

type menuOption struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Desc  string `json:"desc"`
}

// --- Inbound encoders: TUI → engine --------------------------------------------------------

func encodeInput(text string) []byte {
	b, _ := json.Marshal(map[string]any{"t": "input", "text": text})
	return append(b, '\n')
}

func encodeReply(id int, value string) []byte {
	b, _ := json.Marshal(map[string]any{"t": "reply", "id": id, "value": value})
	return append(b, '\n')
}

func encodeInterrupt() []byte {
	b, _ := json.Marshal(map[string]any{"t": "interrupt"})
	return append(b, '\n')
}

func encodeQuery(id int, text string) []byte {
	b, _ := json.Marshal(map[string]any{"t": "query", "id": id, "text": text})
	return append(b, '\n')
}

// encodeMenuSelect tells the engine which menu option was chosen so it can run that menu's onSelect
// (e.g. apply a picked model id) — sending the bare value as input would dispatch it as a chat turn.
func encodeMenuSelect(id, value string) []byte {
	b, _ := json.Marshal(map[string]any{"t": "menuSelect", "id": id, "value": value})
	return append(b, '\n')
}

// encodePing is the TUI→engine liveness probe; the engine answers `{"t":"pong","id":n}` from its
// ingest path. No pong within the deadline means the engine's event loop is wedged (or the process
// is a zombie whose pipe hasn't closed) — the heartbeat in model.go surfaces that in the footer.
func encodePing(id int) []byte {
	b, _ := json.Marshal(map[string]any{"t": "ping", "id": id})
	return append(b, '\n')
}

// argString safely pulls a string from event args at index i ("" if absent / not a string).
func argString(args []json.RawMessage, i int) string {
	if i >= len(args) {
		return ""
	}
	var s string
	if json.Unmarshal(args[i], &s) == nil {
		return s
	}
	return ""
}
