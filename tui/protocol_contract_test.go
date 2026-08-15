package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Go half of the protocol contract (v2 §3.11): strict-decode the committed fixtures the
// TS side generated from its type-checked protocol types. A field the engine sends that
// this TUI's structs don't know about fails DisallowUnknownFields here — drift between
// src/protocol/protocol.ts and tui/protocol.go becomes a red test, not a garbled UI.

type fixtureFile struct {
	ProtocolVersion int               `json:"protocolVersion"`
	Outbound        []json.RawMessage `json:"outbound"`
	Inbound         []json.RawMessage `json:"inbound"`
	// The ui_snapshot payload fixture (rides event args, so it escapes the Outbound decode).
	UiSnapshot json.RawMessage `json:"uiSnapshot"`
}

func loadFixtures(t *testing.T) fixtureFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "src", "protocol", "schema", "fixtures.json"))
	if err != nil {
		t.Fatalf("fixtures.json missing — run `npm run gen:protocol` in the repo root: %v", err)
	}
	var f fixtureFile
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("fixtures.json unparseable: %v", err)
	}
	if len(f.Outbound) == 0 || len(f.Inbound) == 0 {
		t.Fatal("fixtures.json has empty message sets")
	}
	return f
}

func TestProtocolVersionMatchesFixtures(t *testing.T) {
	f := loadFixtures(t)
	if f.ProtocolVersion != supportedProtocol {
		t.Fatalf("engine protocol %d ≠ TUI supportedProtocol %d — bump in lockstep", f.ProtocolVersion, supportedProtocol)
	}
}

func TestOutboundFixturesStrictDecode(t *testing.T) {
	f := loadFixtures(t)
	seen := map[string]bool{}
	for i, raw := range f.Outbound {
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		var o Outbound
		if err := dec.Decode(&o); err != nil {
			t.Errorf("outbound fixture %d: engine sends a field this TUI doesn't model: %v\n%s", i, err, raw)
			continue
		}
		if o.T == "" {
			t.Errorf("outbound fixture %d decoded without a discriminator: %s", i, raw)
		}
		seen[o.T] = true
	}
	for _, kind := range []string{"event", "request", "ready", "hello", "queryResult", "pong"} {
		if !seen[kind] {
			t.Errorf("no fixture for outbound %q — the contract under-covers the wire", kind)
		}
	}
}

// Semantic parity for the Terminal ui_snapshot payload: strict-decode every reviewed field so any
// wire drift fails loudly.
func TestUiSnapshotFixtureStrictDecode(t *testing.T) {
	f := loadFixtures(t)
	if len(f.UiSnapshot) == 0 {
		t.Fatal("fixtures.json has no uiSnapshot payload — run `npm run gen:protocol` in the repo root")
	}
	dec := json.NewDecoder(bytes.NewReader(f.UiSnapshot))
	dec.DisallowUnknownFields()
	var snap UiSnapshot
	if err := dec.Decode(&snap); err != nil {
		t.Fatalf("engine produces an unreviewed Terminal ui_snapshot field: %v", err)
	}
	if snap.ContextWindow == 0 || snap.Models.Coding == "" {
		t.Fatalf("ui_snapshot fixture decoded but core fields are empty: %+v", snap)
	}
}

// The TUI's inbound ENCODERS must produce exactly the messages the TS types describe:
// rebuild each fixture through the real encoder and compare structurally.
func TestInboundEncodersMatchFixtures(t *testing.T) {
	f := loadFixtures(t)
	for i, raw := range f.Inbound {
		var fx map[string]any
		if err := json.Unmarshal(raw, &fx); err != nil {
			t.Fatalf("inbound fixture %d unparseable: %v", i, err)
		}
		var encoded []byte
		switch fx["t"] {
		case "reply":
			encoded = encodeReply(int(fx["id"].(float64)), fx["value"].(string))
		case "input":
			encoded = encodeInput(fx["text"].(string))
		case "interrupt":
			encoded = encodeInterrupt()
		case "query":
			encoded = encodeQuery(int(fx["id"].(float64)), fx["text"].(string))
		case "menuSelect":
			encoded = encodeMenuSelect(fx["id"].(string), fx["value"].(string))
		case "ping":
			encoded = encodePing(int(fx["id"].(float64)))
		case "configGet":
			encoded = encodeConfigGet(int(fx["id"].(float64)))
		case "configSet":
			encoded = encodeConfigSet(int(fx["id"].(float64)), fx["patch"].(map[string]any))
		case "resume":
			encoded = encodeResume(fx["id"].(string))
		case "controls":
			encoded = encodeControls(fx["mode"].(string), fx["tier"].(string), fx["autonomy"].(string))
		default:
			t.Errorf("inbound fixture %d: no TUI encoder for t=%v — the engine expects a message this TUI cannot send", i, fx["t"])
			continue
		}
		if !bytes.HasSuffix(encoded, []byte("\n")) {
			t.Errorf("inbound %v: encoder violates NDJSON framing (no trailing newline)", fx["t"])
		}
		var got map[string]any
		if err := json.Unmarshal(bytes.TrimSpace(encoded), &got); err != nil {
			t.Fatalf("inbound %v: encoder emitted invalid JSON: %v", fx["t"], err)
		}
		if !reflect.DeepEqual(got, fx) {
			t.Errorf("inbound %v drifted:\n  TUI sends: %v\n  contract:  %v", fx["t"], got, fx)
		}
	}
}
