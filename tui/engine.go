package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// hasEmbeddedEngine reports whether a real compiled engine was baked in (release build). The dev
// build leaves embeddedEngine nil; we also guard against a stray tiny placeholder.
func hasEmbeddedEngine() bool { return len(embeddedEngine) > 1<<20 }

// extractEmbeddedEngine writes the baked-in engine to the user cache dir (once, content-addressed)
// and returns its path. This is what makes the shipped binary self-contained — no Node on the host.
func extractEmbeddedEngine() (string, error) {
	sum := sha256.Sum256(embeddedEngine)
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	dir = filepath.Join(dir, "bimax")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "bimax-engine-"+hex.EncodeToString(sum[:6]))
	// Reuse an already-extracted copy of the same content.
	if fi, err := os.Stat(path); err == nil && fi.Size() == int64(len(embeddedEngine)) {
		return path, nil
	}
	if err := os.WriteFile(path, embeddedEngine, 0o755); err != nil {
		return "", err
	}
	return path, nil
}

// ResolveRoot picks the working directory the engine runs in: the shipped binary runs in the
// user's project (cwd); the dev runner (npx tsx) needs the BiMax source repo, so from tui/ we
// step up to the parent. $BIMAX_REPO_ROOT overrides both.
func ResolveRoot() string {
	if r := os.Getenv("BIMAX_REPO_ROOT"); r != "" {
		return r
	}
	wd, _ := os.Getwd()
	if hasEmbeddedEngine() {
		return wd // self-contained binary → run in whatever project the user launched it from
	}
	if filepath.Base(wd) == "tui" {
		return filepath.Dir(wd)
	}
	return wd
}

// Engine spawns and talks to the headless Node engine (BIMAX_HEADLESS=1). It owns the subprocess,
// streams decoded outbound messages on Msgs, and forwards inbound NDJSON on stdin. This is the one
// place that will later flip from "spawn npx tsx" to "exec the embedded, bun-compiled binary".
type Engine struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
	Msgs  chan Outbound
}

// StartEngine launches the engine rooted at repoRoot. Override the command via $BIMAX_ENGINE_CMD
// (e.g. the compiled binary); defaults to the dev runner. Engine stderr (boot logs) is sent to
// tui/engine.log so it never corrupts the alt-screen UI or the NDJSON stdout stream.
func StartEngine(repoRoot string) (*Engine, error) {
	var c *exec.Cmd
	switch {
	case os.Getenv("BIMAX_ENGINE_CMD") != "":
		parts := strings.Fields(os.Getenv("BIMAX_ENGINE_CMD"))
		c = exec.Command(parts[0], parts[1:]...)
	case hasEmbeddedEngine():
		path, err := extractEmbeddedEngine()
		if err != nil {
			return nil, err
		}
		c = exec.Command(path)
	default:
		c = exec.Command("npx", "tsx", "src/index.ts") // dev: run engine from source
	}
	c.Dir = repoRoot
	c.Env = append(os.Environ(), "BIMAX_HEADLESS=1")

	stdin, err := c.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := c.StdoutPipe()
	if err != nil {
		return nil, err
	}
	// Engine stderr (boot logs) → a log file so it never corrupts the alt-screen UI or the NDJSON
	// stream. Prefer the user cache dir (works for a shipped binary); fall back to the temp dir.
	logDir, err := os.UserCacheDir()
	if err != nil {
		logDir = os.TempDir()
	}
	logDir = filepath.Join(logDir, "bimax")
	_ = os.MkdirAll(logDir, 0o755)
	if logf, ferr := os.Create(filepath.Join(logDir, "engine.log")); ferr == nil {
		c.Stderr = logf
	}

	if err := c.Start(); err != nil {
		return nil, err
	}

	e := &Engine{cmd: c, stdin: stdin, Msgs: make(chan Outbound, 256)}
	go e.readLoop(stdout)
	return e, nil
}

func (e *Engine) readLoop(stdout io.Reader) {
	sc := bufio.NewScanner(stdout)
	// Command menus serialize to a single very long line — give the scanner room (16 MB).
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var m Outbound
		if json.Unmarshal([]byte(line), &m) == nil {
			e.Msgs <- m
		}
	}
	close(e.Msgs)
}

func (e *Engine) Send(b []byte) {
	_, _ = e.stdin.Write(b)
}

func (e *Engine) Close() {
	_ = e.stdin.Close()
	if e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
	}
}
