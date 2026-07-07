# API Key Management

How Bimax discovers, rotates, and heals API keys. This documents what the code
actually does today (`src/credits/api.key.manager.ts`, `src/cli/provider.ts`,
`src/core/llm.adapter.ts`) — it is the reference for the questions "how many
keys can a user add", "how are keys rotated", and "what happens when a key hits
a rate limit".

## Where keys come from — users are NOT prompted

End users are never asked to paste keys into the app. Keys are read from
standard provider environment variables at startup (and re-read via `/keys`):

| Provider   | Env var              | Base URL                          |
|------------|----------------------|-----------------------------------|
| nvidia     | `NVIDIA_API_KEY`     | integrate.api.nvidia.com/v1       |
| openai     | `OPENAI_API_KEY`     | api.openai.com/v1                 |
| anthropic  | `ANTHROPIC_API_KEY`  | api.anthropic.com/v1              |
| openrouter | `OPENROUTER_API_KEY` | openrouter.ai/api/v1              |
| deepseek   | `DEEPSEEK_API_KEY`   | api.deepseek.com/v1               |
| google     | `GOOGLE_API_KEY`     | generativelanguage.googleapis.com |

If the user already has any of these exported (or in the global env file),
Bimax picks them up with zero setup. `BGW_PROVIDER` (or the `/provider`
command) selects the active provider.

## How many keys? Unlimited — comma-separated

One env var holds any number of keys:

```
NVIDIA_API_KEY=nvapi-aaa,nvapi-bbb,nvapi-ccc
```

There is no upper bound in code; the pool is `envVal.split(',')`, deduplicated
by key string. One key works fine (see "solo key" below). Per-key model
overrides are supported: `NVIDIA_API_KEY_MODEL_2=...` pins key #2 to a model,
`NVIDIA_API_KEY_MODEL=...` sets the default for all keys of that provider.

The pool is **single-provider by design**: pooling providers together caused
intermittent 400s because a model id chosen in one provider's namespace does
not exist in another's. If the active provider has no keys, the pool falls
back to the first provider that does — so a misconfigured `BGW_PROVIDER`
never leaves the pool empty.

## Rotation — round-robin + RPM pacing

Every request asks `ApiKeyManager.getNextKey()` (mutex-guarded, safe under
parallel tool calls):

1. **Pass 1 (multi-key pools only):** round-robin over keys that are off
   cooldown AND "cold" — not used within `MIN_REUSE_SECS` (default 1.1s,
   tunable via `BIMAX_KEY_MIN_INTERVAL_MS`). A burst of calls fans out across
   the whole pool instead of hammering one key into its per-key RPM limit.
2. **Pass 2:** any off-cooldown key, round-robin. Pass 1 only reorders
   preference — it never delays or blocks a call.
3. **Last resort:** if *every* key is on cooldown, return the key whose
   cooldown expires soonest plus its `waitTimeSecs`.

With a single key, pass 1 never applies — solo setups see zero added latency.

## Rate limits — the process does NOT stop

When a request fails, the adapter reports the HTTP status back per key:

- **429** → that key goes on exponential cooldown: `2s · 2^(n-1)` capped at
  **60s**, plus 0–1s jitter. If the provider sent `Retry-After`, that value is
  used instead. Only the offending key is sidelined — the next call rotates to
  a sibling and work continues uninterrupted.
- **401 / 403** → short cooldown (5s / 2s) so a revoked or unauthorized key
  stops being retried in a tight loop but is rechecked later.
- **408 / 5xx** → 2–3s cooldown (transient server issues).
- **Success** → all failure counters reset, cooldown cleared.

Worst case — *all* keys are cooling down simultaneously — the adapter sleeps
`waitTimeSecs` (time until the soonest cooldown expires, ≤ 60s) and then
proceeds. It is a pause, never a crash or an abort of the running task.

## Adding keys mid-session

`/keys` rebuilds the pool via `setKeys()` **without a restart**. Health state
is preserved for keys that survive the rebuild — a key on 429 cooldown does
not get a clean slate just because a sibling was added.

## Observability

`getStates()` (surfaced by `/keys`) shows per key: label, model, baseURL,
ok/fail counts, and whether it is currently on cooldown.
