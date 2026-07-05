"""
Terminal-Bench adapter for BiMax.

Implements terminal-bench's AbstractInstalledAgent contract: the bun-compiled standalone
Linux binary (no Node/npm needed inside the task container) is copied into the container,
a 3-line setup script arms it, and each task runs as one headless invocation:

    bimax -p '<instruction>' --dangerously-skip-permissions

Run from the repo root (after ./benchmarks/terminal_bench_adapter/build-binary.sh):

    export NVIDIA_API_KEY=...           # or OPENAI_API_KEY etc. + BIMAX_TB_PROVIDER
    tb run \
      --agent-import-path benchmarks.terminal_bench_adapter.bimax_agent:BiMaxAgent \
      --dataset-name terminal-bench-core \
      --n-concurrent 1

Model selection: --model nvidia/<id> (the provider prefix is stripped for BGW_MODEL and
kept for provider routing), or export BGW_MODEL/BIMAX_TB_PROVIDER yourself.
"""

import os
import platform
import shlex
from pathlib import Path

from terminal_bench.agents.installed_agents.abstract_installed_agent import (
    AbstractInstalledAgent,
)
from terminal_bench.terminal.models import TerminalCommand

# Which BiMax provider key to forward into the container, keyed by BGW_PROVIDER name.
_PROVIDER_KEYS = {
    "nvidia": "NVIDIA_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


class BiMaxAgent(AbstractInstalledAgent):
    @staticmethod
    def name() -> str:
        return "bimax"

    def __init__(self, model_name: str | None = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._model_name = model_name

    # ---- model / provider plumbing ---------------------------------------------------

    def _provider(self) -> str:
        if self._model_name and "/" in self._model_name:
            prefix = self._model_name.split("/", 1)[0].lower()
            if prefix in _PROVIDER_KEYS:
                return prefix
        return os.environ.get("BIMAX_TB_PROVIDER", "nvidia")

    def _bare_model(self) -> str | None:
        """anthropic/claude-x → claude-x; nvidia/org/model → org/model (NIM ids contain '/')."""
        if not self._model_name:
            return os.environ.get("BGW_MODEL")
        prefix = self._model_name.split("/", 1)[0].lower()
        if prefix in _PROVIDER_KEYS:
            return self._model_name.split("/", 1)[1]
        return self._model_name

    @property
    def _env(self) -> dict[str, str]:
        provider = self._provider()
        key_var = _PROVIDER_KEYS[provider]
        env = {
            key_var: os.environ[key_var],  # fail fast on the host if the key is missing
            "BGW_PROVIDER": provider,
            # Container hygiene: no Headroom sidecar provisioning, no update checks; keep
            # the run reproducible and the cold start fast.
            "BIMAX_DISABLE_COMPRESSION": "1",
            "BIMAX_MCP_WATCHDOG": "0",
            # Traces land in the task cwd's .bimax/traces — harmless and useful post-mortem.
        }
        model = self._bare_model()
        if model:
            env["BGW_MODEL"] = model
        if os.environ.get("BGW_LITE_MODEL"):
            env["BGW_LITE_MODEL"] = os.environ["BGW_LITE_MODEL"]
        return env

    # ---- install ----------------------------------------------------------------------

    @property
    def _binary_path(self) -> Path:
        """The bun-compiled Linux binary for the container's architecture."""
        arch = os.environ.get("BIMAX_TB_ARCH")
        if not arch:
            arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
        p = Path(__file__).parent / "bin" / f"bimax-linux-{arch}"
        if not p.exists():
            raise FileNotFoundError(
                f"{p} not found — build it first: ./benchmarks/terminal_bench_adapter/build-binary.sh {arch}"
            )
        return p

    @property
    def _install_agent_script_path(self) -> Path:
        return self._get_templated_script_path("bimax-setup.sh.j2")

    def perform_task(self, instruction, session, logging_dir=None):
        # The base class only uploads the install script; the standalone binary must be in
        # the container before that script arms it.
        session.copy_to_container(
            self._binary_path,
            container_dir="/installed-agent",
            container_filename="bimax",
        )
        return super().perform_task(instruction, session, logging_dir)

    # ---- run --------------------------------------------------------------------------

    def _run_agent_commands(self, instruction: str) -> list[TerminalCommand]:
        escaped = shlex.quote(instruction)
        return [
            TerminalCommand(
                command=f"bimax -p {escaped} --print-with-tools --dangerously-skip-permissions",
                min_timeout_sec=0.0,
                max_timeout_sec=float("inf"),
                block=True,
                append_enter=True,
            ),
        ]
