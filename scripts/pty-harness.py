#!/usr/bin/env python3
"""PTY harness for the Bimax TUI: drives the real binary in a pseudo-terminal,
executes a timed action script, and records every output byte with a timestamp.

Usage:
  python3 scripts/pty-harness.py --out /tmp/run.jsonl -- ./tui/bimax-tui

Actions come on stdin as JSON lines, or via --script:
  {"at": 1.0, "send": "hi\r"}          # send keys at t=1.0s
  {"at": 8.0, "resize": [100, 30]}      # resize the PTY
  {"at": 9.0, "send": ""}         # escape
  {"at": 10.0, "signal": "SIGINT"}
  {"at": 12.0, "close": true}           # close stdin / stop

Output: JSONL with {"t": ms, "d": "<base64 bytes>"} records plus a final
{"exit": code, "t": ms} record. Analyze with pty-analyze.py.
"""
import argparse
import base64
import fcntl
import json
import os
import pty
import signal
import struct
import sys
import termios
import time


def set_winsize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--script", help="JSON file with the action list")
    ap.add_argument("--cols", type=int, default=100)
    ap.add_argument("--rows", type=int, default=30)
    ap.add_argument("--timeout", type=float, default=90.0)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    args = ap.parse_args()

    cmd = [c for c in args.cmd if c != "--"]
    actions = []
    if args.script:
        with open(args.script) as f:
            actions = [json.loads(l) for l in f if l.strip()]
    actions.sort(key=lambda a: a["at"])

    pid, fd = pty.fork()
    if pid == 0:  # child
        os.environ["TERM"] = "xterm-256color"
        os.execvp(cmd[0], cmd)

    set_winsize(fd, args.cols, args.rows)
    out = open(args.out, "w")
    t0 = time.monotonic()
    now_ms = lambda: round((time.monotonic() - t0) * 1000)

    import select
    ai = 0
    exit_code = None
    while True:
        t = time.monotonic() - t0
        if t > args.timeout:
            os.kill(pid, signal.SIGKILL)
            break
        # fire due actions
        while ai < len(actions) and actions[ai]["at"] <= t:
            a = actions[ai]
            ai += 1
            if "send" in a:
                os.write(fd, a["send"].encode())
            elif "resize" in a:
                set_winsize(fd, a["resize"][0], a["resize"][1])
                os.kill(pid, signal.SIGWINCH)
            elif "signal" in a:
                os.kill(pid, getattr(signal, a["signal"]))
            elif a.get("close"):
                os.kill(pid, signal.SIGTERM)
        # next action deadline caps the select wait
        wait = 0.05
        if ai < len(actions):
            wait = max(0.0, min(wait, actions[ai]["at"] - t))
        r, _, _ = select.select([fd], [], [], wait)
        if fd in r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if not data:
                break
            out.write(json.dumps({"t": now_ms(), "d": base64.b64encode(data).decode()}) + "\n")
        # reap if exited
        done, status = os.waitpid(pid, os.WNOHANG)
        if done == pid:
            exit_code = os.waitstatus_to_exitcode(status)
            # drain remaining output
            while True:
                r, _, _ = select.select([fd], [], [], 0.2)
                if fd not in r:
                    break
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                out.write(json.dumps({"t": now_ms(), "d": base64.b64encode(data).decode()}) + "\n")
            break

    if exit_code is None:
        try:
            _, status = os.waitpid(pid, 0)
            exit_code = os.waitstatus_to_exitcode(status)
        except ChildProcessError:
            exit_code = -1
    out.write(json.dumps({"exit": exit_code, "t": now_ms()}) + "\n")
    out.close()
    print(f"captured -> {args.out} (exit {exit_code})", file=sys.stderr)


if __name__ == "__main__":
    main()
