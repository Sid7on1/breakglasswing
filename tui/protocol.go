package main

import "encoding/json"

// Go mirror of src/protocol/protocol.ts. The engine speaks NDJSON; we decode the outbound
// envelope generically and branch on `t` (and, for events, on `name`).

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
	Protocol int               `json:"protocol,omitempty"` // ready handshake
	Items    []CompletionItem  `json:"items,omitempty"`    // queryResult
	Body     string            `json:"body,omitempty"`     // request kind:"diff" — the diff text
}

// CompletionItem mirrors src/protocol/protocol.ts — one autocomplete candidate.
type CompletionItem struct {
	Value string `json:"value"`
	Label string `json:"label"`
	Desc  string `json:"desc"`
	Kind  string `json:"kind"` // "command" | "symbol" | "path"
}

// MessageEntry — the payload of a `message` event (args[0]). Mirrors src/cli/events.ts.
type MessageEntry struct {
	Role        string          `json:"role"`
	Content     string          `json:"content"`
	Level       string          `json:"level,omitempty"`
	UIComponent string          `json:"uiComponent,omitempty"`
	Payload     json.RawMessage `json:"payload,omitempty"`
}

// ToolCall — the payload of tool_call / tool_call_result events.
type ToolCall struct {
	ID       string `json:"id"`
	ToolName string `json:"toolName"`
	Status   string `json:"status"`
	Input    string `json:"input"`
	Output   string `json:"output"`
}

// Menu — a command result forwarded as a `message` with uiComponent="menu".
type Menu struct {
	Title   string       `json:"title"`
	Options []menuOption `json:"options"`
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
