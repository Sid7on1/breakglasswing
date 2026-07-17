#!/usr/bin/env python3
"""Bimax TUI regression suite — drives the REAL binary in a PTY against a deterministic
mock provider and asserts the properties users actually feel:

  1. startup       — no terminal OSC query, first frame under budget, /exit works
  2. streaming     — tokens render incrementally (many frames), no duplicated content in scrollback
  3. resize-widen  — widening never duplicates a screenful
  4. resize-narrow — narrowing repairs cleanly at the new width
  5. interrupt     — Esc shows "Stopping…" fast, turn ends, follow-up turn streams, Ctrl+C quits
  6. sigterm       — kill(1) exits promptly with the terminal restored
  7. keyless       — first run auto-opens the provider picker; a keyless turn fails loudly

Requires: built engine (dist/) + TUI (tui/bimax-tui), python3, pyte (pip install pyte).
Run:  python3 scripts/tui-regression.py            (or: npm run test:tui)
Exit: 0 all green, 1 otherwise. ~90s wall time.
"""
import base64
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HARNESS = os.path.join(ROOT, "scripts", "pty-harness.py")
TUI = os.path.join(ROOT, "tui", "bimax-tui")
MOCK_PORT = int(os.environ.get("BIMAX_TEST_MOCK_PORT", "8931"))
ESC, CTRLC = chr(27), chr(3)

failures = []


def check(name, cond, detail=""):
    tag = "PASS" if cond else "FAIL"
    print(f"  [{tag}] {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(f"{name}: {detail}")


def run_capture(actions, timeout, env=None, cols=100, rows=30):
    """Run the TUI under the PTY harness with the given actions; return (records, exit_rec)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as sf:
        for a in actions:
            sf.write(json.dumps(a) + "\n")
        script = sf.name
    out = tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False).name
    e = dict(os.environ)
    e.setdefault("BGW_BASE_URL", f"http://127.0.0.1:{MOCK_PORT}/v1")
    e.setdefault("BIMAX_ENGINE_CMD", "node dist/index.js")
    if env:
        e.update(env)
    subprocess.run(
        [sys.executable, HARNESS, "--out", out, "--script", script,
         "--timeout", str(timeout), "--cols", str(cols), "--rows", str(rows), "--", TUI],
        cwd=ROOT, env=e, capture_output=True, timeout=timeout + 30,
    )
    records, exit_rec = [], None
    with open(out) as f:
        for line in f:
            r = json.loads(line)
            if "exit" in r:
                exit_rec = r
            else:
                records.append((r["t"], base64.b64decode(r["d"])))
    os.unlink(script)
    os.unlink(out)
    return records, exit_rec


def visible(data):
    d = data.decode("utf-8", "replace")
    d = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", d)
    return re.sub(r"\s+", " ", d).strip()


def emulate(records, cols=100, rows=30):
    import pyte
    screen = pyte.HistoryScreen(cols, rows, history=10000, ratio=0.01)
    stream = pyte.ByteStream(screen)
    stream.feed(b"".join(d for _, d in records))
    hist = []
    for line in screen.history.top:
        hist.append("".join(ch.data for ch in line.values()).rstrip() if isinstance(line, dict)
                    else "".join(c.data for c in line).rstrip())
    vis = [screen.display[i].rstrip() for i in range(rows)]
    return hist, vis


def content_dups(lines):
    """Duplicated NON-CHROME lines (chrome = box borders / blank interiors / status)."""
    import collections
    counts = collections.Counter(l for l in lines if l.strip())
    return {l: c for l, c in counts.items()
            if c > 1 and len(l.strip()) > 8 and not re.match(r"^[│╭╰╮╯─\s]+$", l)
            and "uncommitted paths" not in l and "Map " not in l}


def mode_left_on(records, on, off):
    raw = b"".join(d for _, d in records).decode("utf-8", "replace")
    i_on, i_off = raw.rfind(on), raw.rfind(off)
    return i_on != -1 and i_off < i_on


def unique_reply(n=300):
    return " ".join(f"word{i:03d}" for i in range(n))


def scenario_startup():
    print("· startup")
    recs, ex = run_capture([{"at": 6.0, "send": "/exit\r"}], timeout=15)
    raw = b"".join(d for _, d in recs)
    check("no OSC-11 terminal query", b"\x1b]11;?" not in raw,
          "the vendored tea_init patch regressed (re-vendor without reapplying it?)")
    # First frame: search the CUMULATIVE stream with ANSI stripped (styling can split the marker).
    first_frame, acc = None, ""
    for t, d in recs:
        acc += visible(d) + " "
        if "Ask BiMax" in acc:
            first_frame = t
            break
    check("first frame < 3000ms", first_frame is not None and first_frame < 3000, f"first_frame={first_frame}")
    check("/exit exits 0", ex and ex.get("exit") == 0, str(ex))
    check("cursor restored", not mode_left_on(recs, "\x1b[?25l", "\x1b[?25h"))
    check("bracketed paste reset", not mode_left_on(recs, "\x1b[?2004h", "\x1b[?2004l"))


def scenario_streaming():
    print("· streaming")
    # Submit at 4.5s so the engine is reliably past `ready` (boot varies 1.5–3s in dev): the latency
    # gate below measures Bimax's input→token path, not engine boot overlap.
    recs, ex = run_capture(
        [{"at": 4.5, "send": "stream test\r"}, {"at": 14.0, "send": "/exit\r"}], timeout=22)
    prog = [t for t, d in recs if re.search(rb"word\d\d\d", d)]
    check("incremental frames (>=10 with new tokens)", len(prog) >= 10, f"frames={len(prog)}")
    if prog:
        # First turn after boot pays one-time costs (model heal, prompt build) on top of the steady
        # ~550ms full-lane submit→token (see e2e-turn.mjs). 2500ms still fails the old regressions
        # (burst-at-end read as 3.6s+ here; the OSC freeze as 7s+).
        first_tok = prog[0]
        check("first token frame < 2500ms after submit", first_tok - 4500 < 2500, f"delta={first_tok-4500}")
    hist, vis = emulate(recs)
    dups = content_dups(hist + vis)
    check("no duplicated content in scrollback", not dups, str(list(dups.items())[:3]))
    check("clean exit", ex and ex.get("exit") == 0, str(ex))


def scenario_resize_widen():
    print("· resize-widen")
    recs, ex = run_capture(
        [{"at": 2.5, "send": "stream test\r"},
         {"at": 4.5, "resize": [120, 40]}, {"at": 6.0, "resize": [140, 44]},
         {"at": 12.0, "send": "/exit\r"}], timeout=20)
    hist, vis = emulate(recs, cols=140, rows=44)
    dups = content_dups(hist + vis)
    check("widen adds no duplicate screenful", not dups, str(list(dups.items())[:3]))
    check("clean exit", ex and ex.get("exit") == 0, str(ex))


def scenario_resize_narrow():
    print("· resize-narrow")
    cols2 = 72
    recs, ex = run_capture(
        [{"at": 2.5, "send": "stream test\r"}, {"at": 5.0, "resize": [cols2, 24]},
         {"at": 12.0, "send": "/exit\r"}], timeout=20)
    hist, vis = emulate(recs, cols=cols2, rows=24)
    over = [l for l in vis if len(l) > cols2]
    check("final screen fits the new width", not over, f"overwide={over[:2]}")
    check("clean exit", ex and ex.get("exit") == 0, str(ex))


def scenario_interrupt():
    print("· interrupt")
    # The follow-up turn (120 tokens × 12ms ≈ 1.5s + boot-lane overhead) must be FINISHED before the
    # quit chord, or Ctrl+C correctly cancels instead of quitting. Two Ctrl+C presses at the end make
    # the quit robust either way: mid-turn the first cancels and the second (now idle) quits.
    recs, ex = run_capture(
        [{"at": 4.5, "send": "long answer\r"}, {"at": 6.0, "send": ESC},
         {"at": 8.0, "send": "again\r"}, {"at": 16.0, "send": CTRLC}, {"at": 17.0, "send": CTRLC}],
        timeout=24)
    stop = next((t for t, d in recs if "Stopping…".encode() in d), None)
    check("Stopping… within 300ms of Esc", stop is not None and stop - 6000 < 300, f"stop={stop}")
    intr = next((t for t, d in recs if "Turn interrupted".encode() in d), None)
    check("turn actually interrupted", intr is not None)
    follow = [t for t, d in recs if re.search(rb"word\d\d\d", d) and intr and t > intr]
    check("follow-up turn streams after interrupt", len(follow) >= 5, f"frames={len(follow)}")
    check("Ctrl+C quits (idle) or cancel+quit (busy) exits 0", ex and ex.get("exit") == 0, str(ex))


def scenario_sigterm():
    print("· sigterm")
    t0 = time.time()
    recs, ex = run_capture([{"at": 4.0, "close": True}], timeout=12)
    check("SIGTERM exits 0", ex and ex.get("exit") == 0, str(ex))
    check("exit within 1.5s of signal", ex and ex.get("t", 99999) < 5500, str(ex))
    check("cursor restored", not mode_left_on(recs, "\x1b[?25l", "\x1b[?25h"))


def scenario_keyless():
    print("· keyless first run")
    fresh = tempfile.mkdtemp(prefix="bimax-fresh-")
    try:
        recs, ex = run_capture(
            [{"at": 4.5, "send": ESC}, {"at": 6.0, "send": "hi\r"}, {"at": 10.0, "send": "/exit\r"}],
            timeout=20, env={"BIMAX_BREAKGLASS_DIR": fresh})
        raw = b"".join(d for _, d in recs).decode("utf-8", "replace")
        check("setup wizard auto-opens", "Choose your AI provider" in raw)
        check("keyless turn fails loudly with the fix", "No API key configured" in raw and "/keys" in raw)
        check("clean exit", ex and ex.get("exit") == 0, str(ex))
    finally:
        shutil.rmtree(fresh, ignore_errors=True)


def main():
    try:
        import pyte  # noqa: F401
    except ImportError:
        print("pyte missing: pip3 install pyte", file=sys.stderr)
        return 1
    if not os.path.exists(TUI):
        print(f"TUI binary missing: {TUI} (cd tui && go build -o bimax-tui .)", file=sys.stderr)
        return 1
    if not os.path.exists(os.path.join(ROOT, "dist", "index.js")):
        print("engine missing: npm run build", file=sys.stderr)
        return 1

    mock_env = dict(os.environ, MOCK_REPLY=unique_reply(120), MOCK_TOKEN_MS="12", MOCK_TTFT_MS="100")
    mock = subprocess.Popen(["node", os.path.join(ROOT, "scripts", "mock-provider.mjs"), str(MOCK_PORT)],
                            env=mock_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        for fn in (scenario_startup, scenario_streaming, scenario_resize_widen,
                   scenario_resize_narrow, scenario_interrupt, scenario_sigterm, scenario_keyless):
            fn()
    finally:
        mock.send_signal(signal.SIGTERM)
        mock.wait(timeout=5)

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print("  -", f)
        return 1
    print("all TUI regression scenarios green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
