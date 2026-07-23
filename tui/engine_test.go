package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEmbeddedEngineFallsBackWhenUserCacheIsUnwritable(t *testing.T) {
	original := embeddedEngine
	embeddedEngine = []byte("test embedded engine")
	t.Cleanup(func() { embeddedEngine = original })

	root := t.TempDir()
	blocked := filepath.Join(root, "blocked")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	fallback := filepath.Join(root, "fallback")
	got, err := extractEmbeddedEngineFromRoots([]string{blocked, fallback}, "test")
	if err != nil {
		t.Fatalf("fallback extraction failed: %v", err)
	}
	if want := filepath.Join(fallback, "bimax", "bimax-engine-test"); got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	if data, err := os.ReadFile(got); err != nil || string(data) != "test embedded engine" {
		t.Fatalf("extracted engine = %q, err=%v", data, err)
	}
}

func TestEmbeddedComputerUseFallsBackWhenUserCacheIsUnwritable(t *testing.T) {
	original := embeddedComputerUse
	embeddedComputerUse = []byte("test embedded computer use")
	t.Cleanup(func() { embeddedComputerUse = original })

	root := t.TempDir()
	blocked := filepath.Join(root, "blocked")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	fallback := filepath.Join(root, "fallback")
	got, err := extractEmbeddedComputerUseFromRoots([]string{blocked, fallback}, "test")
	if err != nil {
		t.Fatalf("fallback extraction failed: %v", err)
	}
	if want := filepath.Join(fallback, "bimax", "bimax-computer-use-test"); got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	if data, err := os.ReadFile(got); err != nil || string(data) != "test embedded computer use" {
		t.Fatalf("extracted computer use = %q, err=%v", data, err)
	}
}

func TestEmbeddedLivePipFallsBackWhenUserCacheIsUnwritable(t *testing.T) {
	original := embeddedLivePip
	embeddedLivePip = []byte("test embedded live pip")
	t.Cleanup(func() { embeddedLivePip = original })

	root := t.TempDir()
	blocked := filepath.Join(root, "blocked")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	fallback := filepath.Join(root, "fallback")
	got, err := extractEmbeddedLivePipFromRoots([]string{blocked, fallback}, "test")
	if err != nil {
		t.Fatalf("fallback extraction failed: %v", err)
	}
	if want := filepath.Join(fallback, "bimax", "bimax-live-pip-test"); got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	if data, err := os.ReadFile(got); err != nil || string(data) != "test embedded live pip" {
		t.Fatalf("extracted live pip = %q, err=%v", data, err)
	}
	if info, err := os.Stat(got); err != nil || info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("extracted live pip is not executable: info=%v err=%v", info, err)
	}
}

func TestPackagedEngineDisablesBlockingCodeMemoryByDefault(t *testing.T) {
	base := []string{"PATH=/usr/bin"}
	got := appendEnvDefault(base, "BIMAX_DISABLE_CODEMEM", "1")
	if !containsEnv(got, "BIMAX_DISABLE_CODEMEM=1") {
		t.Fatalf("default environment = %v, want BIMAX_DISABLE_CODEMEM=1", got)
	}

	overridden := appendEnvDefault([]string{"BIMAX_DISABLE_CODEMEM=0"}, "BIMAX_DISABLE_CODEMEM", "1")
	if len(overridden) != 1 || overridden[0] != "BIMAX_DISABLE_CODEMEM=0" {
		t.Fatalf("explicit opt-in was overwritten: %v", overridden)
	}
}

func containsEnv(env []string, want string) bool {
	for _, entry := range env {
		if entry == want {
			return true
		}
	}
	return false
}

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
				if m.Protocol != supportedProtocol {
					t.Fatalf("unexpected protocol version: %d (want %d)", m.Protocol, supportedProtocol)
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

// Drives the engine's completion channel: ask for "/g" candidates and assert the engine returns
// matching slash commands. Proves the query/queryResult round-trip end-to-end.
func TestCompletionsRoundTrip(t *testing.T) {
	eng, err := StartEngine("..")
	if err != nil {
		t.Fatalf("StartEngine: %v", err)
	}
	defer eng.Close()

	timeout := time.After(90 * time.Second)
	for {
		select {
		case <-timeout:
			t.Fatal("timed out waiting for completions")
		case m, ok := <-eng.Msgs:
			if !ok {
				t.Fatal("engine channel closed early")
			}
			if m.T == "ready" {
				eng.Send(encodeQuery(1, "/g"))
			}
			if m.T == "queryResult" && m.ID == 1 {
				if len(m.Items) == 0 {
					t.Fatal("no completions for /g")
				}
				for _, it := range m.Items {
					if it.Kind != "command" || !strings.HasPrefix(it.Value, "/g") {
						t.Fatalf("unexpected completion: %+v", it)
					}
				}
				return // success
			}
		}
	}
}
