package main

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

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
	if custom := os.Getenv("BIMAX_ENGINE_CMD"); custom != "" {
		parts := strings.Fields(custom)
		c = exec.Command(parts[0], parts[1:]...)
	} else {
		c = exec.Command("npx", "tsx", "src/index.ts")
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
	if logf, ferr := os.Create(filepath.Join(repoRoot, "tui", "engine.log")); ferr == nil {
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
