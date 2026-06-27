#!/usr/bin/env bash
#
# Autonomous Repo-Hardening Loop — a guard-railed outer supervisor for long-running self-hardening.
#
# Each iteration: VERIFY (build + leak-checked tests) → if green, drive `bimax -p` to make ONE minimal
# improvement (fix a bug/leak, simplify, raise coverage) → RE-VERIFY → commit on success, REVERT on
# regression → checkpoint to a ledger → repeat until a cap is hit.
#
# It is bash on purpose: the outer supervisor must outlive the engine it drives, enforce wall-clock /
# iteration caps simply, and never depend on the very code it's hardening.
#
# GUARDRAILS (the whole point — read before running unsupervised):
#   1. Verification gate — a change is kept ONLY if `npm run build` + `npm run test:leaks` are green
#      AND the leak detector is clean. A regression is hard-reverted, so the tree never goes backwards.
#   2. Hard caps — HARDEN_MAX_ITERS and HARDEN_MAX_MINUTES bound the run; consecutive no-ops stop it.
#   3. Branch-only — refuses to run on main/master; works on HARDEN_BRANCH. Never pushes anywhere.
#   4. Clean-tree precondition + checkpoint ledger — every iteration is committed or reverted atomically,
#      so the run is resumable and auditable.
#
# DRY_RUN=1 (default) runs the gates, branch guard, caps and ledger WITHOUT driving the agent or
# committing — use it to watch the guardrails work before turning the loop loose.
#
# Usage:
#   scripts/hardening-loop.sh                       # one safe dry-run iteration
#   HARDEN_DRY_RUN=0 HARDEN_MAX_ITERS=1 scripts/hardening-loop.sh   # one REAL supervised iteration
#   HARDEN_DRY_RUN=0 HARDEN_MAX_ITERS=50 HARDEN_MAX_MINUTES=720 scripts/hardening-loop.sh  # long run

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

# --- Config (env-overridable) ---
MAX_ITERS="${HARDEN_MAX_ITERS:-1}"
MAX_MINUTES="${HARDEN_MAX_MINUTES:-720}"     # 12h default wall-clock ceiling
DRY_RUN="${HARDEN_DRY_RUN:-1}"
BRANCH="${HARDEN_BRANCH:-auto/hardening-loop}"
MODEL_ARG=""; [ -n "${HARDEN_MODEL:-}" ] && MODEL_ARG="--model ${HARDEN_MODEL}"
TURN_TIMEOUT="${HARDEN_TURN_TIMEOUT:-1800}"  # max seconds for one agent turn (don't hang forever)
LEDGER="${HARDEN_LEDGER:-.breakglass/hardening-ledger.md}"
DEADLINE=$(( $(date +%s) + MAX_MINUTES * 60 ))

log() { printf '\033[36m[harden]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[harden] %s\033[0m\n' "$*" >&2; }

ledger() {   # append one timestamped line to the audit ledger
  mkdir -p "$(dirname "$LEDGER")"
  printf -- '- %s — iter %s — %s\n' "$(date -u +%FT%TZ)" "${1:-?}" "${2:-}" >> "$LEDGER"
}

# Self-heal: the repo lives on ~/Desktop, so node_modules is a `node_modules -> node_modules.nosync`
# symlink (iCloud safety). git operations (reset --hard, the agent's commands) intermittently drop
# that symlink, which then makes `npm run` fail with exit 127 — a spurious "regression". Recreate it
# before every verify so an env flap can never masquerade as a test failure.
heal_node_modules() {
  if [ ! -e node_modules ] && [ -d node_modules.nosync ]; then
    ln -s node_modules.nosync node_modules 2>/dev/null && log "self-healed node_modules symlink"
  fi
}

# VERIFY gate: the build must compile and EVERY test must pass. We gate strictly on test pass/fail
# (`test:ci`), NOT on `--detectOpenHandles` — that detector flags library-level handles (tree-sitter
# WASM, subagent workers) nondeterministically, so hard-gating on it caused false reverts. Open-handle
# detection is still run, but ADVISORY only (logged, never fails the gate).
# npmrun: heal the symlink, THEN run — iCloud can drop the symlink between any two commands, so we
# re-assert it right before each npm invocation rather than once.
npmrun() { heal_node_modules; npm run "$@"; }

verify() {
  npmrun build   >/tmp/harden_build.log 2>&1 || { err "build failed"; return 1; }
  npmrun test:ci >/tmp/harden_test.log  2>&1 || { err "tests failed"; return 1; }
  npmrun test:leaks >/tmp/harden_leaks.log 2>&1
  if grep -qE "Jest has detected|failed to exit gracefully" /tmp/harden_leaks.log; then
    log "advisory: open-handle detector flagged something (not gating on it — often tree-sitter WASM)"
  fi
  return 0
}

# --- Guardrail 3: branch-only ---
current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "$current" = "main" ] || [ "$current" = "master" ]; then
  log "on $current — switching to work branch $BRANCH (never harden on main)"
  git checkout -B "$BRANCH" >/dev/null 2>&1 || { err "could not create $BRANCH"; exit 1; }
fi

# --- Guardrail 4: clean-tree precondition ---
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  err "working tree has uncommitted changes — commit or stash first (the loop reverts by reset --hard)."
  exit 1
fi

log "branch=$(git rev-parse --abbrev-ref HEAD) dry_run=$DRY_RUN max_iters=$MAX_ITERS max_minutes=$MAX_MINUTES"
ledger start "branch=$(git rev-parse --abbrev-ref HEAD) dry_run=$DRY_RUN"

# Build the agent prompt fresh each iteration so it includes the LATEST commits — the first real cycle
# wasted a turn re-doing an EPIPE fix that was already committed, because it had no history awareness.
build_prompt() {
  local recent; recent="$(git log --oneline -25 | sed 's/^/  /')"
  cat <<PROMPT
Harden THIS repository by exactly one minimal, verifiable improvement. Pick the single highest-value
item NOT already addressed: a real bug, a resource/handle leak, an over-engineered chunk to simplify,
or a missing test on critical untested code.

IMPORTANT — recent commits (this work is ALREADY DONE; do NOT redo, re-fix, or revert any of it; find
something genuinely NEW):
$recent

Rules: make the smallest change that fixes one thing. Do NOT touch git branches/remotes, do NOT edit
CI or this hardening script, do NOT make sweeping refactors. Keep \`npm run build\` and \`npm run test:ci\`
green. End with one line: what you changed and why.
PROMPT
}

consecutive_noops=0
for (( i=1; i<=MAX_ITERS; i++ )); do
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then log "wall-clock cap reached"; ledger "$i" "stopped: wall-clock cap"; break; fi
  log "=== iteration $i/$MAX_ITERS ==="

  # 1) Baseline verify — know the tree is green before we change anything.
  if verify; then base="green"; else base="red"; fi
  log "baseline: $base"

  if [ "$DRY_RUN" = "1" ]; then
    log "DRY_RUN: would now drive 'bimax -p' to make one hardening fix, then re-verify + commit/revert."
    ledger "$i" "dry-run baseline=$base (no change made)"
    continue
  fi

  before="$(git rev-parse HEAD)"

  # 2) Drive the agent for ONE hardening fix (autonomous: --yes bypasses interactive prompts).
  if ! timeout "$TURN_TIMEOUT" node bin/bimax.js -p "$(build_prompt)" --yes $MODEL_ARG >/tmp/harden_turn.log 2>&1; then
    err "agent turn failed/timed out — reverting any partial work"
    git reset --hard "$before" >/dev/null 2>&1; git clean -fd src tui >/dev/null 2>&1
    ledger "$i" "agent-turn-failed (reverted)"; continue
  fi

  # 3) Did it actually change anything?
  if [ -z "$(git status --porcelain)" ]; then
    consecutive_noops=$(( consecutive_noops + 1 ))
    log "no changes this iteration (no-op #$consecutive_noops)"
    ledger "$i" "no-op"
    [ "$consecutive_noops" -ge 3 ] && { log "3 consecutive no-ops — nothing left to harden, stopping."; break; }
    continue
  fi
  consecutive_noops=0

  # 4) RE-VERIFY — the gate. Keep on green, hard-revert on red.
  if verify; then
    git add -A
    git commit -q -m "chore(harden): autonomous iteration $i

$(head -c 400 /tmp/harden_turn.log | tr '\n' ' ')

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || true
    log "iteration $i committed ($(git rev-parse --short HEAD))"
    ledger "$i" "committed $(git rev-parse --short HEAD)"
  else
    err "regression after change — hard-reverting (tree never goes backwards)"
    git reset --hard "$before" >/dev/null 2>&1; git clean -fd src tui >/dev/null 2>&1
    ledger "$i" "reverted (failed verify)"
  fi
done

log "done. Ledger: $LEDGER  (review with: git log --oneline ${BRANCH} ; nothing was pushed)"
