package main

import (
	"encoding/json"
	"testing"
	"time"
)

// Integration test: spawn the real headless engine, drive it the way the Bubble Tea model does,
// and assert the Go side decodes the handshake and a structured command result. Proves the
// Go↔Node protocol boundary end-to-end (no TTY needed).
func TestEngineRoundTrip(t *testing.T) {
	eng, err := StartEngine("..")
	if err != nil {
		t.Fatalf("StartEngine: %v", err)
	}
	defer eng.Close()

	var gotReady, gotMenu bool
	timeout := time.After(90 * time.Second)

	for {
		select {
		case <-timeout:
			t.Fatalf("timed out (ready=%v menu=%v)", gotReady, gotMenu)
		case m, ok := <-eng.Msgs:
			if !ok {
				t.Fatalf("engine channel closed early (ready=%v menu=%v)", gotReady, gotMenu)
			}
			switch {
			case m.T == "ready":
				gotReady = true
				if m.Protocol != 1 {
					t.Fatalf("unexpected protocol version: %d", m.Protocol)
				}
				eng.Send(encodeInput("/help")) // ask for the command palette
			case m.T == "event" && m.Name == "message" && len(m.Args) > 0:
				var me MessageEntry
				if json.Unmarshal(m.Args[0], &me) == nil && me.UIComponent == "menu" {
					var menu Menu
					if json.Unmarshal(me.Payload, &menu) == nil && len(menu.Options) > 0 {
						gotMenu = true
					}
				}
			}
			if gotReady && gotMenu {
				return // success
			}
		}
	}
}
