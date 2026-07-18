package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// hasEmbeddedEngine reports whether a real compiled engine was baked in (release build). The dev
// build leaves embeddedEngine nil; we also guard against a stray tiny placeholder.
func hasEmbeddedEngine() bool      { return len(embeddedEngine) > 1<<20 }
func hasEmbeddedComputerUse() bool { return len(embeddedComputerUse) > 1<<20 }

func engineCacheRoots() []string {
	roots := make([]string, 0, 3)
	if override := os.Getenv("BIMAX_CACHE_DIR"); override != "" {
		roots = append(roots, override)
	}
	if dir, err := os.UserCacheDir(); err == nil && dir != "" {
		roots = append(roots, dir)
	}
	roots = append(roots, os.TempDir())
	return roots
}

func extractEmbeddedEngineFromRoots(roots []string, suffix string) (string, error) {
	var lastErr error
	seen := make(map[string]bool)
	for _, root := range roots {
		dir := filepath.Join(root, "bimax")
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if err := os.MkdirAll(dir, 0o755); err != nil {
			lastErr = err
			continue
		}
		path := filepath.Join(dir, "bimax-engine-"+suffix)
		if fi, err := os.Stat(path); err == nil && fi.Size() == int64(len(embeddedEngine)) {
			return path, nil
		}
		if err := os.WriteFile(path, embeddedEngine, 0o755); err != nil {
			lastErr = err
			continue
		}
		return path, nil
	}
	return "", fmt.Errorf("no writable engine cache directory: %w", lastErr)
}

// extractEmbeddedEngine writes the baked-in engine to the user cache dir (once, content-addressed)
// and returns its path. This is what makes the shipped binary self-contained — no Node on the host.
func extractEmbeddedEngine() (string, error) {
	sum := sha256.Sum256(embeddedEngine)
	return extractEmbeddedEngineFromRoots(engineCacheRoots(), hex.EncodeToString(sum[:6]))
}

func extractEmbeddedComputerUseFromRoots(roots []string, suffix string) (string, error) {
	var lastErr error
	seen := make(map[string]bool)
	for _, root := range roots {
		dir := filepath.Join(root, "bimax")
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if err := os.MkdirAll(dir, 0o755); err != nil {
			lastErr = err
			continue
		}
		path := filepath.Join(dir, "bimax-computer-use-"+suffix)
		if fi, err := os.Stat(path); err == nil && fi.Size() == int64(len(embeddedComputerUse)) {
			return path, nil
		}
		if err := os.WriteFile(path, embeddedComputerUse, 0o755); err != nil {
			lastErr = err
			continue
		}
		return path, nil
	}
	return "", fmt.Errorf("no writable computer-use cache directory: %w", lastErr)
}

func extractEmbeddedComputerUse() (string, error) {
	sum := sha256.Sum256(embeddedComputerUse)
	return extractEmbeddedComputerUseFromRoots(engineCacheRoots(), hex.EncodeToString(sum[:6]))
}

// ResolveRoot picks the directory the engine subprocess STARTS in. For the shipped binary that's the
// user's cwd (self-contained, no source needed). For the dev runner (npx tsx src/index.ts) it must
// be the BiMax source repo — found, in order: $BIMAX_REPO_ROOT, the repo next to the binary itself
// (so the dev build runs from any directory), then the cwd / its parent as a last resort. The user's
// actual project dir is passed separately as BIMAX_CWD, so the engine works on the launch dir
// regardless of where its source lives.
func ResolveRoot() string {
	if r := os.Getenv("BIMAX_REPO_ROOT"); r != "" {
		return r
	}
	wd, _ := os.Getwd()
	if hasEmbeddedEngine() {
		return wd // self-contained binary → run in whatever project the user launched it from
	}
	// Dev build: locate src/index.ts relative to the binary (it lives at <repo>/tui/bimax-tui), so
	// `bimax-tui` works when launched from anywhere — not just from the repo or tui/.
	if exe, err := os.Executable(); err == nil {
		for _, cand := range []string{filepath.Dir(exe), filepath.Dir(filepath.Dir(exe))} {
			if _, err := os.Stat(filepath.Join(cand, "src", "index.ts")); err == nil {
				return cand
			}
		}
	}
	if _, err := os.Stat(filepath.Join(wd, "src", "index.ts")); err == nil {
		return wd
	}
	if filepath.Base(wd) == "tui" {
		return filepath.Dir(wd)
	}
	return wd
}

// distFresh reports whether dist/index.js exists and is at least as new as every .ts under src/ —
// i.e. the compiled engine can be trusted over the transpile-on-boot dev runner. A stale dist must
// NEVER win silently ("I edited the source but nothing changed" is worse than a slow boot), so any
// newer source file, or any walk error, falls back to tsx.
func distFresh(repoRoot string) bool {
	di, err := os.Stat(filepath.Join(repoRoot, "dist", "index.js"))
	if err != nil {
		return false
	}
	distAt := di.ModTime()
	fresh := true
	err = filepath.WalkDir(filepath.Join(repoRoot, "src"), func(p string, d os.DirEntry, err error) error {
		if err != nil || !fresh {
			return filepath.SkipAll
		}
		if d.IsDir() {
			if name := d.Name(); name == "__tests__" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".ts") {
			return nil
		}
		if fi, e := d.Info(); e == nil && fi.ModTime().After(distAt) {
			fresh = false
			return filepath.SkipAll
		}
		return nil
	})
	return err == nil && fresh
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
	case distFresh(repoRoot):
		// Dev with an up-to-date build: run the compiled engine directly — ~3× faster to `ready`
		// than the tsx transpile-on-boot path (measured 0.8s vs 2.3s).
		c = exec.Command("node", "dist/index.js")
	default:
		c = exec.Command("npx", "tsx", "src/index.ts") // dev: run engine from source
	}
	c.Dir = repoRoot
	c.Env = append(os.Environ(), "BIMAX_HEADLESS=1")
	// The native sidecar is an implementation detail: the engine only sees the Bimax-owned path and
	// contract. Telemetry is disabled at the process boundary before the sidecar can ever start.
	if override := os.Getenv("BIMAX_COMPUTER_USE_DRIVER"); override != "" {
		c.Env = append(c.Env, "BIMAX_COMPUTER_USE_DRIVER="+override)
	} else if hasEmbeddedComputerUse() {
		driverPath, extractErr := extractEmbeddedComputerUse()
		if extractErr != nil {
			return nil, extractErr
		}
		c.Env = append(c.Env, "BIMAX_COMPUTER_USE_DRIVER="+driverPath)
	}
	c.Env = append(c.Env, "CUA_DRIVER_RS_TELEMETRY_ENABLED=0", "CUA_TELEMETRY_ENABLED=0")
	// The engine must START in repoRoot so the dev runner (`tsx src/index.ts`) resolves, but the
	// user's actual project is wherever they launched the TUI. Pass that through so the engine can
	// chdir into it — otherwise the dev build always treats the repo as the project (e.g. the codebase
	// map shows the repo's graph even when launched from ~/Desktop). For the shipped binary repoRoot
	// already equals the launch dir, so this is a harmless no-op.
	if wd, err := os.Getwd(); err == nil && wd != "" {
		c.Env = append(c.Env, "BIMAX_CWD="+wd)
	}

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
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			// Don't silently drop a malformed line — a desync is invisible otherwise. stderr only,
			// so it never corrupts the transcript (stdout is the protocol pipe, not this).
			os.Stderr.WriteString("[engine] dropped malformed line: " + err.Error() + "\n")
			continue
		}
		e.Msgs <- m
	}
	if err := sc.Err(); err != nil {
		os.Stderr.WriteString("[engine] scanner error: " + err.Error() + "\n")
	}
	close(e.Msgs)
}

func (e *Engine) Send(b []byte) {
	_, _ = e.stdin.Write(b)
}

func (e *Engine) Close() {
	_ = e.stdin.Close()
	if e.cmd != nil && e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
	}
}

// engineLogPath returns where StartEngine sends the engine's stderr (boot logs) — the same cache-dir
// location used above. Kept in one place so the crash-diagnostics reader and the writer never drift.
func engineLogPath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "bimax", "engine.log")
}

// engineLogTail returns the last maxLines of the engine log — the actual reason a boot failed. Shown
// when the engine dies before it ever reports `ready`, so the user sees the real error (a broken
// node_modules, a missing module, a stack trace) instead of just "engine process exited".
func engineLogTail(maxLines int) string {
	b, err := os.ReadFile(engineLogPath())
	if err != nil || len(b) == 0 {
		return ""
	}
	lines := strings.Split(strings.TrimRight(string(b), "\n"), "\n")
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return strings.Join(lines, "\n")
}
