# BiMax × Terminal-Bench

Everything needed to score BiMax on Terminal-Bench.

- **`bimax_harbor.py`** — the PRIMARY adapter: Harbor harness = Terminal-Bench **2.x**,
  the current leaderboard (https://www.tbench.ai/leaderboard/terminal-bench/2.0).
- **`bimax_agent.py`** — legacy adapter for the original `terminal-bench` (TB 1.x) harness.
- **`build-binary.sh`** — cross-compiles the standalone Linux BiMax binary (bun `--compile`)
  that gets uploaded into task containers. No Node/npm inside the container.
- **`run.sh`** — one-command wrapper: sources `~/.breakglass/.env` (BiMax's own key file),
  then drives `harbor run`.

## Quick start

```bash
# 0. prerequisites: Docker running, `uv tool install --python 3.12 harbor`
./benchmarks/terminal_bench_adapter/build-binary.sh      # linux binary for local Docker arch
./benchmarks/terminal_bench_adapter/run.sh smoke         # 2 tasks, end-to-end validation
./benchmarks/terminal_bench_adapter/run.sh full          # all TB-2 tasks (hours; -n 1 default)
./benchmarks/terminal_bench_adapter/run.sh task <name>   # one specific task
```

Model/provider: `TB_MODEL=nvidia/<nim-model-id> ./run.sh …` (provider prefix picks the key
env var: nvidia/openai/anthropic/openrouter/deepseek), or export `BGW_MODEL` yourself.
`BIMAX_FALLBACK_MODEL` is forwarded, so the in-loop model failover works during runs.

Results land in `runs/` (harbor's default): per-task verdicts, the agent transcript
(`/logs/agent/bimax.txt` per trial), and accuracy at the end. Iterate with `/harness`
(the self-tuner) between runs: it mines the failures from the ledger into steering patches.
