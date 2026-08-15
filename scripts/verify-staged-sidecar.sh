#!/usr/bin/env bash
# verify-staged-sidecar.sh — prove the staged compatibility driver actually answers.
#
# Why this exists: v1.1.0 shipped a macOS binary whose sidecar was a two-line shell script that did
# `exit 1`. Nothing caught it. 220 Jest suites, 60 native Swift tests, tsc, eslint, the protocol
# mirror and a 10-stage release gate all passed, because not one of them ran the STAGED ARTIFACT.
# The failure only appeared when a user asked the shipped binary to list windows.
#
# So: after staging, run the thing and require an answer. A stub cannot fake `--version`.
#
#   scripts/verify-staged-sidecar.sh <path-to-staged-sidecar> <target-os>
#
# Cross-compiled targets are checked for shape only — a darwin host cannot execute a linux binary,
# and pretending otherwise would be a worse lie than not checking.
set -euo pipefail

sidecar="${1:?usage: verify-staged-sidecar.sh <path> <target-os>}"
target_os="${2:?usage: verify-staged-sidecar.sh <path> <target-os>}"

fail() { echo "✗ staged sidecar: $1" >&2; exit 1; }

[ -f "$sidecar" ] || fail "missing at $sidecar"
[ -x "$sidecar" ] || fail "not executable at $sidecar"

# A deliberate omission is allowed, but it must be the explicit, asserted kind — never a stub that
# arrived by accident. This is the exact condition that shipped broken.
if [ "${BIMAX_OMIT_CUA_COMPAT:-0}" = "1" ]; then
  echo "      ⚠ sidecar verification skipped — CUA omission was explicitly requested"
  exit 0
fi

# A shell-script stub is the specific regression being guarded against. Catch it by shape first, so
# the error names the real problem instead of surfacing as a confusing exec failure.
if head -c 2 "$sidecar" | grep -q '#!' 2>/dev/null; then
  fail "is a script stub, not a driver binary — the CUA driver failed to stage.
       ComputerTool's apps/windows/observe verbs route through this and will all fail.
       Re-run the build, or set BIMAX_OMIT_CUA_COMPAT=1 if omission is genuinely intended."
fi

host_os=""
case "$(uname -s)" in Darwin) host_os=darwin ;; Linux) host_os=linux ;; *) host_os=windows ;; esac

if [ "$target_os" != "$host_os" ]; then
  size="$(wc -c < "$sidecar" | tr -d ' ')"
  # 1 MiB floor: the real driver is ~49 MB, any stub or truncated download is far below it.
  [ "$size" -gt 1048576 ] || fail "cross-compiled artifact is only ${size} bytes — looks truncated"
  echo "      ✓ sidecar staged (${size} bytes, cross-compiled — not executed on this host)"
  exit 0
fi

# Same host: actually run it. This is the check that would have caught v1.1.0.
if ! version="$("$sidecar" --version 2>&1)"; then
  fail "did not answer --version:
       $version"
fi
[ -n "$version" ] || fail "answered --version with empty output"

echo "      ✓ sidecar answers: ${version}"
