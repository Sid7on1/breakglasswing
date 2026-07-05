#!/usr/bin/env bash
# Run Terminal-Bench with BiMax as the agent.
#   ./run.sh smoke                 # 2 tasks, quick end-to-end validation
#   ./run.sh full                  # the whole dataset (hours)
#   ./run.sh task <task-id> [...]  # specific task(s)
# Env: NVIDIA_API_KEY (or provider key + BIMAX_TB_PROVIDER), optional BGW_MODEL,
#      TB_DATASET (default terminal-bench-core), TB_CONCURRENCY (default 1 — laptop-safe).
set -euo pipefail
cd "$(dirname "$0")/../.."

# Load the same key file the bimax engine itself uses (~/.breakglass/.env, dotenv format),
# so `tb run` sees NVIDIA_API_KEY & co. without the user re-exporting them per shell.
if [ -f "$HOME/.breakglass/.env" ]; then
  set -a; . "$HOME/.breakglass/.env"; set +a
fi

# Harbor runs from its own uv venv — put the repo root on PYTHONPATH so it can import
# benchmarks.terminal_bench_adapter.*.
export PYTHONPATH="${PYTHONPATH:+$PYTHONPATH:}$PWD"

# Harbor = the Terminal-Bench 2.x harness (the current leaderboard).
DATASET="${TB_DATASET:-terminal-bench/terminal-bench-2}"
CONCURRENCY="${TB_CONCURRENCY:-1}"
AGENT_PATH="benchmarks.terminal_bench_adapter.bimax_harbor:BiMax"
COMMON=(--agent-import-path "$AGENT_PATH" -d "$DATASET" -n "$CONCURRENCY")
[ -n "${TB_MODEL:-}" ] && COMMON+=(-m "$TB_MODEL")

MODE="${1:-smoke}"
case "$MODE" in
  smoke)
    # Two tasks — proves upload + install + headless run + grading end-to-end.
    exec harbor run "${COMMON[@]}" --n-tasks 2 ;;
  full)
    exec harbor run "${COMMON[@]}" ;;
  task)
    shift
    ARGS=(); for t in "$@"; do ARGS+=(--include-task-name "$t"); done
    exec harbor run "${COMMON[@]}" "${ARGS[@]}" ;;
  *)
    echo "usage: $0 smoke|full|task <name>..." >&2; exit 2 ;;
esac
