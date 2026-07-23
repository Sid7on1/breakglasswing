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
  8. approval-enter — a ComputerTool approval renders, Enter picks the default Yes, the engine
                      resolves it, and the suspended tool call resumes exactly once
  9. approval-deny  — ↓ + Enter picks No; the governor vetoes and the tool never runs
 10. approval-grant — "allow app for this session" is honored: the second identical action is
                      auto-approved with NO second prompt
 11. approval-esc   — Esc during an approval resolves it safely (No) instead of freezing the TUI

The approval scenarios drive the REAL engine + governor + protocol + TUI keyboard path; the only
mocked piece is the model (MOCK_TOOL_CALLS scripts the tool call). The target app is nonexistent,
so the desktop is never actually touched.

Requires: built engine (dist/) + TUI (tui/bimax-tui), python3, pyte (pip install pyte).
Run:  python3 scripts/tui-regression.py            (or: npm run test:tui)
Exit: 0 all green, 1 otherwise. ~2.5min wall time.
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
    # In-session only: the deliberate post-exit transcript print would double-count.
    hist, vis = emulate([(t, d) for t, d in recs if t < 14000])
    dups = content_dups(hist + vis)
    check("no duplicated content in scrollback", not dups, str(list(dups.items())[:3]))
    check("clean exit", ex and ex.get("exit") == 0, str(ex))


def scenario_resize_widen():
    print("· resize-widen")
    recs, ex = run_capture(
        [{"at": 2.5, "send": "stream test\r"},
         {"at": 4.5, "resize": [120, 40]}, {"at": 6.0, "resize": [140, 44]},
         {"at": 12.0, "send": "/exit\r"}], timeout=20)
    # In-session frames only (the post-exit transcript print is a separate, deliberate feature),
    # emulated at the LARGEST size used — pyte cannot replay pty resizes, and a fixed screen
    # smaller than a painted frame manufactures scroll-out duplicates that no real terminal shows.
    hist, vis = emulate([(t, d) for t, d in recs if t < 12000], cols=140, rows=44)
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


def scenario_resize_storm():
    """The stabilization contract: resize never clears or reprints committed output. Drive a
    narrow/wide storm during and after streaming, then assert (a) zero clear-screen escapes after
    startup (3J never, 2J only from the one-time alternate-screen entry), and (b) each committed
    reply line renders exactly once — no duplication, no loss — at the final size."""
    print("· resize-storm")
    recs, ex = run_capture(
        [{"at": 2.5, "send": "stream test\r"},
         {"at": 4.0, "resize": [70, 24]}, {"at": 4.6, "resize": [130, 40]},
         {"at": 5.2, "resize": [56, 20]}, {"at": 5.8, "resize": [110, 34]},
         {"at": 6.4, "resize": [64, 22]}, {"at": 7.0, "resize": [100, 30]},
         {"at": 13.0, "send": "/exit\r"}], timeout=20)
    first_resize_ms = 4000
    late_clears = [t for t, d in recs if t >= first_resize_ms and (b"\x1b[2J" in d or b"\x1b[3J" in d)]
    check("zero clear/reprint recovery across the storm (no 2J/3J after startup)",
          not late_clears, f"clear escapes at t={late_clears[:4]}")
    check("scrollback is never wiped (3J never emitted)", all(b"\x1b[3J" not in d for _, d in recs))
    # In-session frames only (the post-exit transcript print is a separate, deliberate feature),
    # at the storm's largest dimensions (see resize-widen note on pyte and pty resizes).
    hist, vis = emulate([(t, d) for t, d in recs if t < 13000], cols=130, rows=40)
    dups = content_dups(hist + vis)
    check("zero duplicate committed lines across the storm", not dups, str(list(dups.items())[:3]))
    check("committed reply content survives the storm", any(re.search(r"word0\d\d", l) for l in hist + vis))
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


APPROVAL_PORT = MOCK_PORT + 1
DOWN = "\x1b[B"
# A gated ComputerTool action against an app that cannot exist: the FULL approval pipeline runs
# (governor -> protocol request -> TUI overlay -> keyboard -> reply -> resolver -> tool resumes),
# then the runtime fails fast on the missing app — the desktop is never actually touched.
OPEN_CALL = {"name": "ComputerTool", "arguments": {"action": "open", "app": "BimaxRegressionApp"}}
RECORD_CALL = {"name": "ComputerTool", "arguments": {"action": "record_start"}}


def approval_capture(tool_calls, actions, timeout):
    """Run the TUI against a dedicated mock provider that scripts `tool_calls`, then replies."""
    env = dict(os.environ, MOCK_REPLY=unique_reply(30), MOCK_TOKEN_MS="8", MOCK_TTFT_MS="80",
               MOCK_TOOL_CALLS=json.dumps(tool_calls))
    mock = subprocess.Popen(["node", os.path.join(ROOT, "scripts", "mock-provider.mjs"), str(APPROVAL_PORT)],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        # Pin per-action approvals: the shipped default is 'high-impact-only', which auto-approves
        # a routine open with no prompt — these scenarios exist to drive the approval KEYBOARD path,
        # so they must run in 'always' mode regardless of the user's config.
        return run_capture(actions, timeout=timeout,
                           env={"BGW_BASE_URL": f"http://127.0.0.1:{APPROVAL_PORT}/v1",
                                "BIMAX_COMPUTER_APPROVALS": "always"})
    finally:
        mock.send_signal(signal.SIGTERM)
        try:
            mock.wait(timeout=5)
        except Exception:
            mock.kill()


def scenario_approval_default_mode():
    """Exercise the REAL production default ('high-impact-only', NO env override) so the pinned
    'always' scenarios above cannot conceal broken approval initialization or keyboard handling:
    the same engine+governor+TUI path must (a) auto-approve a routine open with NO prompt, and
    (b) still render a real, keyboard-driven prompt for a high-impact action (record_start)."""
    print("· approval-default (production high-impact-only)")
    env = dict(os.environ, MOCK_REPLY=unique_reply(30), MOCK_TOKEN_MS="8", MOCK_TTFT_MS="80",
               MOCK_TOOL_CALLS=json.dumps([OPEN_CALL, RECORD_CALL]))
    mock = subprocess.Popen(["node", os.path.join(ROOT, "scripts", "mock-provider.mjs"), str(APPROVAL_PORT)],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        recs, ex = run_capture(
            [{"at": 4.5, "send": "open the test app then start recording\r"},
             {"at": 12.0, "send": DOWN}, {"at": 12.4, "send": "\r"},   # ↓ to "No" on the record prompt, Enter
             {"at": 18.0, "send": chr(15)},                             # Ctrl+O: open the log panel
             {"at": 20.0, "send": "/exit\r"}], timeout=28,
            env={"BGW_BASE_URL": f"http://127.0.0.1:{APPROVAL_PORT}/v1",
                 # Empty string = unset for the config loader: the SHIPPED default applies.
                 "BIMAX_COMPUTER_APPROVALS": ""})
    finally:
        mock.send_signal(signal.SIGTERM)
        try:
            mock.wait(timeout=5)
        except Exception:
            mock.kill()
    raw = b"".join(d for _, d in recs).decode("utf-8", "replace")
    hist, vis = emulate(recs)
    everything = "".join(hist + vis)
    check("routine open auto-approves under the default (no prompt)",
          "Allow? open in ComputerTool" not in everything)
    check("auto-approval is announced in the log panel, not silent",
          "Auto-approved (high-impact-only): open" in raw)
    check("high-impact record_start still renders a real prompt under the default",
          "record_start in ComputerTool" in raw and "HIGH-IMPACT" in raw)
    check("denial resolved via keyboard under the default", "→ No" in raw)
    check("turn continued after the veto", re.search(r"word0\d\d", raw) is not None)
    check("clean exit", ex and ex.get("exit") == 0, str(ex))


def scenario_approval_enter():
    print("· approval-enter")
    recs, ex = approval_capture(
        [OPEN_CALL],
        [{"at": 4.5, "send": "open the test app\r"},
         {"at": 10.0, "send": "\r"},                       # Enter on the highlighted default (Yes)
         {"at": 18.0, "send": "/exit\r"}], timeout=26)
    raw = b"".join(d for _, d in recs).decode("utf-8", "replace")
    clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", raw)
    check("approval overlay rendered with the intended app",
          "Allow? open in ComputerTool @ BimaxRegressionApp" in raw)
    check("Enter resolved the default choice", "→ Yes" in raw)
    # Status text can be replaced by the immediately-resuming tool lifecycle before the next paint.
    # The durable proof is behavioral: the selected Yes reached the resolver AND the suspended
    # ComputerTool invocation resumed.
    check("engine resolver received the approval", "→ Yes" in raw and "Computer(open" in clean)
    # The label and its (args) are two separately-styled runs — ANSI codes sit between them in the
    # raw stream, so the lifecycle line is only contiguous after stripping styling.
    check("suspended tool call resumed (tool lifecycle in transcript)", "Computer(open" in clean)
    # The turn CONTINUED after the tool: the follow-up mock reply streamed. This is the "resumed
    # exactly once" signal — a double-resume would emit a second tool call/approval, a zero-resume
    # would never reach the reply.
    check("turn continued to the follow-up reply", re.search(r"word0\d\d", raw) is not None)
    hist, vis = emulate(recs)
    check("permission UI cleared after Enter", not any("1) Yes" in l for l in vis))
    check("only one approval was asked", "".join(hist + vis).count("Allow? open in ComputerTool") <= 1)
    check("clean exit", ex and ex.get("exit") == 0, str(ex))


def scenario_approval_deny():
    print("· approval-deny")
    recs, ex = approval_capture(
        [OPEN_CALL],
        [{"at": 4.5, "send": "open the test app\r"},
         {"at": 10.0, "send": DOWN}, {"at": 10.4, "send": "\r"},   # ↓ to "No", Enter
         {"at": 18.0, "send": "/exit\r"}], timeout=26)
    raw = b"".join(d for _, d in recs).decode("utf-8", "replace")
    check("denial resolved via keyboard", "→ No" in raw)
    check("governor vetoed", "denied" in raw)
    check("no approval was granted", "Approved: COMPUTER_CONTROL" not in raw)
    check("turn survived the veto (follow-up reply streamed)", re.search(r"word0\d\d", raw) is not None)
    check("clean exit", ex and ex.get("exit") == 0, str(ex))


def scenario_approval_grant():
    print("· approval-grant")
    recs, ex = approval_capture(
        [OPEN_CALL, OPEN_CALL],
        [{"at": 4.5, "send": "open the test app twice\r"},
         {"at": 10.0, "send": DOWN}, {"at": 10.3, "send": DOWN}, {"at": 10.6, "send": "\r"},  # grant option
         {"at": 22.0, "send": "/exit\r"}], timeout=30)
    raw = b"".join(d for _, d in recs).decode("utf-8", "replace")
    clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", raw)
    hist, vis = emulate(recs)
    prompt_count = "".join(hist + vis).count("Allow? open in ComputerTool")
    check("session grant option selected", "for this session" in raw and "→ Allow app" in raw)
    # The transient "Approved (session grant …)" status may be overwritten before a paint. Two
    # completed tool lifecycle entries with only one prompt prove the second action used the grant.
    check("second identical action auto-approved by the grant",
          clean.count("Computer(open") >= 2 and prompt_count <= 1)
    check("no second approval prompt", prompt_count <= 1)
    check("clean exit", ex and ex.get("exit") == 0, str(ex))


def scenario_approval_esc():
    print("· approval-esc")
    recs, ex = approval_capture(
        [OPEN_CALL],
        [{"at": 4.5, "send": "open the test app\r"},
         {"at": 10.0, "send": ESC},                        # cancel the pending approval
         {"at": 18.0, "send": "/exit\r"}], timeout=26)
    raw = b"".join(d for _, d in recs).decode("utf-8", "replace")
    check("Esc resolved the approval safely (No)", "→ No" in raw)
    check("resolver cleared — turn continued instead of freezing",
          re.search(r"word0\d\d", raw) is not None)
    hist, vis = emulate(recs)
    check("permission UI cleared after Esc", not any("1) Yes" in l for l in vis))
    check("clean exit (TUI not frozen)", ex and ex.get("exit") == 0, str(ex))


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
                   scenario_resize_narrow, scenario_resize_storm, scenario_interrupt,
                   scenario_sigterm, scenario_keyless,
                   scenario_approval_default_mode,
                   scenario_approval_enter, scenario_approval_deny, scenario_approval_grant,
                   scenario_approval_esc):
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
