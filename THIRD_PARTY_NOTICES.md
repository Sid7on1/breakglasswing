# Third-party notices

## Circuit breaker (ported from Grok Build)

`src/core/circuit-breaker.ts` is a TypeScript transcription of the `xai-circuit-breaker` crate from
xAI's **Grok Build** (<https://github.com/xai-org/grok-build>), licensed under the Apache License,
Version 2.0. The sliding-window trip algorithm, three-state machine, half-open probe lease-reclaim,
config presets, and RetryPolicy status classification are preserved; the Rust atomics/mutex/CAS
concurrency machinery was omitted as unnecessary in single-threaded Node. This constitutes a
modified port under Apache-2.0 §4(b).

    Copyright 2023-2026 SpaceXAI
    Licensed under the Apache License, Version 2.0.
    https://www.apache.org/licenses/LICENSE-2.0

## Bimax Computer Use native sidecar

Bimax Computer Use embeds an integrated binary distribution of `trycua/cua`'s Rust
`cua-driver`, version 0.12.3, source commit `407119202655433dbd4968574cb08ae7d1a01456`.
The Bimax release build pins the exact upstream archives and verifies their published SHA-256
digests before embedding them. Upstream product telemetry is disabled by Bimax at both the host and
child-process boundaries. Bimax exposes its own tool contract, executable name, session identity,
diagnostics, and safety governor; the upstream binary is not installed as a separate user command.
The same license text is compiled into every release executable and is available with
`bimax --third-party-notices`.

Source: <https://github.com/trycua/cua>

MIT License

Copyright (c) 2025 Cua AI, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
