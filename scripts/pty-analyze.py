#!/usr/bin/env python3
"""Analyze a pty-harness capture: replay it through a real terminal emulator (pyte)
and report what a user would actually see.

  python3 scripts/pty-analyze.py /tmp/run.jsonl [--cols 100] [--rows 30] [--dump]

Reports:
  - final visible screen (with --dump)
  - scrollback history: total lines, and DUPLICATED runs (the "old frames remain
    visible" bug: the same committed content appearing more than once)
  - terminal-lifecycle hygiene at exit: cursor restored, no alt-screen leftover,
    bracketed paste / mouse modes reset
  - first-output latency and output cadence
"""
import argparse
import base64
import collections
import json
import re
import sys

import pyte


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--cols", type=int, default=100)
    ap.add_argument("--rows", type=int, default=30)
    ap.add_argument("--dump", action="store_true")
    ap.add_argument("--history", type=int, default=10000)
    args = ap.parse_args()

    records = []
    exit_rec = None
    with open(args.capture) as f:
        for line in f:
            r = json.loads(line)
            if "exit" in r:
                exit_rec = r
            else:
                records.append((r["t"], base64.b64decode(r["d"])))

    raw = b"".join(d for _, d in records)
    text = raw.decode("utf-8", "replace")

    screen = pyte.HistoryScreen(args.cols, args.rows, history=args.history, ratio=0.01)
    stream = pyte.ByteStream(screen)
    stream.feed(raw)

    # --- history / duplication ---
    hist_lines = []
    for line in screen.history.top:
        s = "".join(ch.data for ch in line.values()).rstrip() if isinstance(line, dict) else "".join(c.data for c in line).rstrip()
        hist_lines.append(s)
    visible = [screen.display[i].rstrip() for i in range(args.rows)]
    all_lines = hist_lines + visible

    nonempty = [l for l in all_lines if l.strip()]
    counts = collections.Counter(nonempty)
    # A duplicated FRAME shows as multi-line runs repeating. Look for identical
    # non-trivial lines appearing 2+ times that aren't obviously legit repeats.
    dups = {l: c for l, c in counts.items() if c > 1 and len(l.strip()) > 8}

    # --- lifecycle hygiene: inspect the raw tail for mode resets ---
    tail = text[-4000:]
    def last_state(seq_on, seq_off):
        on = text.rfind(seq_on)
        off = text.rfind(seq_off)
        if on == -1:
            return "never-used"
        return "reset" if off > on else "LEFT ON"

    hygiene = {
        "cursor (DECTCEM ?25)": last_state("\x1b[?25l", "\x1b[?25h"),
        "alt screen (?1049)": last_state("\x1b[?1049h", "\x1b[?1049l"),
        "bracketed paste (?2004)": last_state("\x1b[?2004h", "\x1b[?2004l"),
        "mouse any-event (?1003)": last_state("\x1b[?1003h", "\x1b[?1003l"),
        "mouse sgr (?1006)": last_state("\x1b[?1006h", "\x1b[?1006l"),
    }

    # --- latency ---
    first_out = records[0][0] if records else -1
    total_bytes = len(raw)

    print(f"capture: {args.capture}")
    print(f"  records: {len(records)}, bytes: {total_bytes}, first output at {first_out}ms, exit: {exit_rec}")
    print(f"  history lines: {len(hist_lines)}, visible non-empty: {sum(1 for l in visible if l.strip())}")
    print("\nterminal lifecycle at exit:")
    for k, v in hygiene.items():
        flag = "  ⚠️" if v == "LEFT ON" else "   "
        print(f"{flag} {k}: {v}")
    print(f"\nduplicated non-trivial lines in scrollback+screen: {len(dups)}")
    for l, c in sorted(dups.items(), key=lambda kv: -kv[1])[:15]:
        print(f"   ×{c}  {l[:90]!r}")
    if args.dump:
        print("\n--- final screen ---")
        for i, l in enumerate(visible):
            print(f"{i:2d}|{l}")
        print("--- last 40 history lines ---")
        for l in hist_lines[-40:]:
            print(f"  |{l}")


if __name__ == "__main__":
    main()
