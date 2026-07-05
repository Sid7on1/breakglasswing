"""
Harbor (Terminal-Bench 2.x) adapter for BiMax.

Harbor is the harness behind the Terminal-Bench 2.0 leaderboard. This agent uploads the
bun-compiled standalone Linux binary into the task environment (no Node/npm needed),
symlinks it onto PATH, and runs each task as one headless invocation:

    bimax -p '<instruction>' --print-with-tools --dangerously-skip-permissions

Usage (from the repo root, after ./benchmarks/terminal_bench_adapter/build-binary.sh):

    ./benchmarks/terminal_bench_adapter/run.sh smoke     # 2 tasks end-to-end
    ./benchmarks/terminal_bench_adapter/run.sh full      # the whole TB-2 dataset

or directly:

    harbor run -d terminal-bench/terminal-bench-2 \
      --agent-import-path benchmarks.terminal_bench_adapter.bimax_harbor:BiMax \
      -m nvidia/<model-id> -n 1
"""

import os
import platform
import shlex
from pathlib import Path
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

# BiMax provider name → the API-key env var it reads (src/cli/provider.ts).
_PROVIDER_KEYS = {
    "nvidia": "NVIDIA_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


class BiMax(BaseInstalledAgent):
    @staticmethod
    @override
    def name() -> str:
        return "bimax"

    # ---- model / provider plumbing ---------------------------------------------------

    def _provider(self) -> str:
        if self.model_name and "/" in self.model_name:
            prefix = self.model_name.split("/", 1)[0].lower()
            if prefix in _PROVIDER_KEYS:
                return prefix
        return os.environ.get("BIMAX_TB_PROVIDER", "nvidia")

    def _bare_model(self) -> str | None:
        """nvidia/org/model → org/model (NIM ids contain '/'); bare names pass through."""
        if not self.model_name:
            return self._get_env("BGW_MODEL")
        prefix = self.model_name.split("/", 1)[0].lower()
        if prefix in _PROVIDER_KEYS:
            return self.model_name.split("/", 1)[1]
        return self.model_name

    def _agent_env(self) -> dict[str, str]:
        provider = self._provider()
        key_var = _PROVIDER_KEYS[provider]
        key = self._get_env(key_var)
        if not key:
            raise RuntimeError(
                f"{key_var} is not set — export it (or source ~/.breakglass/.env) before harbor run."
            )
        env = {
            key_var: key,
            "BGW_PROVIDER": provider,
            # Container hygiene: no Headroom sidecar provisioning, no MCP watchdog —
            # reproducible cold starts, nothing phoning home mid-task.
            "BIMAX_DISABLE_COMPRESSION": "1",
            "BIMAX_MCP_WATCHDOG": "0",
        }
        model = self._bare_model()
        if model:
            env["BGW_MODEL"] = model
        lite = self._get_env("BGW_LITE_MODEL")
        if lite:
            env["BGW_LITE_MODEL"] = lite
        fallback = self._get_env("BIMAX_FALLBACK_MODEL")
        if fallback:
            env["BIMAX_FALLBACK_MODEL"] = fallback
        return env

    # ---- install ----------------------------------------------------------------------

    @property
    def _binary_path(self) -> Path:
        arch = os.environ.get("BIMAX_TB_ARCH")
        if not arch:
            arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
        p = Path(__file__).parent / "bin" / f"bimax-linux-{arch}"
        if not p.exists():
            raise FileNotFoundError(
                f"{p} not found — build it: ./benchmarks/terminal_bench_adapter/build-binary.sh {arch}"
            )
        return p

    @override
    def get_version_command(self) -> str | None:
        return "bimax --version"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await environment.upload_file(self._binary_path, "/installed-agent/bimax")
        await self.exec_as_root(
            environment,
            command=(
                "chmod +x /installed-agent/bimax && "
                "ln -sf /installed-agent/bimax /usr/local/bin/bimax && "
                "bimax --version"
            ),
        )

    # ---- run --------------------------------------------------------------------------

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        escaped = shlex.quote(instruction)
        await self.exec_as_agent(
            environment,
            command=(
                f"bimax -p {escaped} --print-with-tools --dangerously-skip-permissions "
                f"2>&1 </dev/null | tee /logs/agent/bimax.txt"
            ),
            env=self._agent_env(),
        )
