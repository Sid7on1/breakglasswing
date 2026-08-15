# Bimax competitive operating pack

Status: product research and build requirements, 2026-08-08.

This folder turns competitor study into work Bimax can build and prove. It is not a marketing
comparison and it does not claim Bimax currently beats any named product. A capability is marked
current only when local code or a current first-party source supports it; a win exists only after a
like-for-like evaluation artifact passes the rules in `06_HEAD_TO_HEAD_EVALS.md`.

## The simple conclusion

Hermes is the breadth competitor. It offers many tools, channels, profiles, providers, memory
systems, automation surfaces, and frontends. OpenAI's current ChatGPT desktop app is the integrated
experience competitor: ChatGPT Work and Codex share projects, long-running goals, plugins, files,
review, worktrees, browser work, and app-only Computer Use. Claude Code and Cursor set the coding
workflow bar. OpenCode sets the open, provider-neutral harness bar. Zed shows how one visual host can
run many external agents without swallowing their runtimes.

Bimax should not copy all of that surface area. Its intended wedge is:

> **The trustworthy local Mac builder: describe an outcome, let Bimax change the code, run it, use
> the real app, and show fresh proof that the result works.**

That promise is independent of owning the strongest model. Bimax must earn it through a stable
tool protocol, model capability tests, deterministic controllers for bounded work, fresh
postcondition checks, crash recovery, and evidence users can inspect.

## Folder map

- `01_METHOD_AND_SCOPE.md` — competitors, evidence rules, and rejected strategies.
- `02_RIVAL_STUDIES.md` — what each rival does well, where Bimax should respond, and what not to
  chase.
- `03_CAPABILITY_MATRIX.md` — current market baseline and Bimax target posture.
- `04_MODEL_INDEPENDENT_STRATEGY.md` — the harness and infrastructure required to reduce dependence
  on one model.
- `05_GAP_REGISTER.md` — implemented, measured, partial, and missing Bimax capabilities.
- `06_HEAD_TO_HEAD_EVALS.md` — repeatable journeys, run schema, grading, and win rules.
- `07_BUILD_SEQUENCE.md` — the ordered product/infra/frontend program.
- `08_SOURCE_LEDGER.md` — first-party sources and local checkouts used for the study.
- `examples/` — concrete user journeys and the visible evidence each must produce.

## Binding language

- **Implemented** means code exists. It may still be unmeasured or unusable in the product.
- **Measured** means a non-vacuous end-state grader passed against preserved raw runs.
- **Product-ready** means the relevant install, recovery, security, and UX gates also pass.
- **Target** means planned behavior, not a current capability.
- **Win** means the rules in `06_HEAD_TO_HEAD_EVALS.md` passed. It never means a screenshot looked
  promising or one provider happened to be healthy.

The older `docs/FEATURES.md` is useful as an implementation inventory, but its headline claims are
not accepted as competitive evidence without revalidation in this pack.
