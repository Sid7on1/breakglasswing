# Bimax website — autonomous overnight build brief

You are the lead brand designer, product storyteller, 3D web director, senior frontend engineer, and QA owner for Bimax. Work autonomously in `/Users/vishsiddharth/Desktop/Bimax` until the website is polished, verified, and ready for the user to press Deploy on Vercel in the morning.

## The human's request

> First write down everything end users should see. Navigate to and study https://bymonolog.com — this site should inspire the design language and level of craft. Study the Hermes Agent repository and its website too, then compare the best current vibe-coding competitors. Make the Bimax site beautiful, user-friendly, cinematic, and on par with the competition. Create 3D visuals and product video/media using the real Bimax desktop app and the app screenshots/assets already in this repository. Bimax is for vibe coders: do not bury people in engine, supervisor, protocol, MCP, architecture, or other internal technical language. Show what a person can make and how Bimax feels. Finish with a zero-known-bug, Vercel-ready site. Do not deploy; leave the final deploy action to the human.

## Non-negotiable guardrails

- Work only on the website and its directly related docs/assets: `site/**`, plus `docs/SITE_*.md` if useful.
- The repository is already dirty. Preserve and build on existing website changes. Never reset, revert, stash, clean, or overwrite unrelated user work.
- Do not edit the desktop app, CLI, engine, tests outside `site`, git branches/remotes, CI, secrets, or deployment state.
- Do not run `vercel deploy`, push, publish, send messages, or create a PR.
- No fake testimonials, fake customer counts, fake benchmarks, fake integrations, or invented claims. When a fact cannot be verified locally or from an authoritative source, omit it or phrase it honestly.
- Never expose internal implementation language to end users: no engine/supervisor/protocol/runtime/MCP/process-startup copy.
- Do not copy Monolog or Hermes pixel-for-pixel. Extract principles, then create a distinct Bimax identity.
- Avoid a generic AI landing page: no random glowing orb, gratuitous neon-on-black, generic bento grid, or endless gradient cards as the whole identity.
- Use real Bimax UI/screenshots/content from the repo wherever possible. Existing desktop visual assets are under `app/release/ui-*.png`.
- Keep the initial page useful without WebGL. Respect `prefers-reduced-motion`, pause offscreen animation/video, provide poster/fallback media, and keep mobile usable.

## Phase 1 — research and end-user content plan

Before changing UI code:

1. Inspect the current `site/`, its content model, current assets, and the real Bimax capabilities described in `README.md`, `docs/FEATURES.md`, `docs/ROADMAP.md`, and relevant desktop screenshots. Do not surface every capability; identify the few that matter to vibe coders.
2. Browse and study `https://bymonolog.com`. Record the reusable design principles: pacing, typography, transitions, 3D/media treatment, section rhythm, navigation, hierarchy, and CTA strategy.
3. Find and study the authoritative Hermes Agent repository and official website. Note positioning, proof, product demo style, and what it explains well or poorly.
4. Briefly study current official product pages for relevant competitors such as Claude Code/Claude desktop, OpenAI Codex, Cursor, Zed, and Lovable/Bolt/Replit where useful. Use primary sources.
5. Write `docs/SITE_END_USER_PLAN.md` containing:
   - precise audience and their top jobs-to-be-done;
   - the one-sentence Bimax positioning;
   - full information architecture in page order;
   - what end users see in every section;
   - final section headlines, body copy, CTA labels, proof points, and media intent;
   - what technical details are deliberately hidden;
   - source links and an inspiration-vs-originality note;
   - mobile narrative and accessibility requirements.

The homepage should feel like a guided product story, not documentation. Prioritize outcomes such as describing an idea, watching Bimax understand the project, reviewing visible work, continuing a task, and shipping with confidence.

## Phase 2 — creative direction

Create a compact design direction before coding:

- Define a distinctive Bimax palette, typography roles, spacing/radius system, and interaction/motion rules.
- The existing dark graphite/coral desktop theme is not a constraint; the human explicitly dislikes it.
- Take one memorable aesthetic risk appropriate to “two minds building together.” Do not use a generic decorative orb.
- Use the duality idea structurally: human intent and Bimax execution, prompt and result, plan and build, conversation and artifact.
- Use 3D/media to demonstrate the product, not as empty decoration.
- Maintain excellent text contrast and obvious interaction states.

## Phase 3 — real 3D and product media

Use the existing Three.js / React Three Fiber stack already in `site/package.json` when it materially helps.

Required media outcomes:

1. A hero or signature 3D product moment that is clearly tied to Bimax and responds smoothly to scroll/pointer without hijacking navigation.
2. A real product showcase using current Bimax desktop screenshots as textures inside a tasteful 3D device/window composition.
3. A product demo media section. If the environment can reliably record the real app or a deterministic site demo, create an optimized WebM/MP4 plus poster under `site/public/media/`. If recording is blocked, do not fake it: build a high-quality deterministic live demo sequence using real screenshots, and document the exact recording command/workflow in `docs/SITE_MEDIA_RUNBOOK.md`.
4. Responsive static fallbacks for mobile, reduced-motion, WebGL failure, and slow connections.

Optimize assets: sensible dimensions, modern formats, lazy loading, posters, no enormous autoplay download, muted video only, no audio surprises.

## Phase 4 — implementation

Implement the finished experience in `site/` using the existing React/Vite stack.

Expected homepage flow unless research supports something better:

- minimal navigation with one primary CTA;
- an immediately understandable hero for vibe coders;
- the signature 3D/product moment;
- a short “idea → working change” story;
- real app/demo showcase;
- three or four outcome-led capabilities, not a technical feature dump;
- trust/safety/review explained in plain human language;
- download/platform CTA using actual available targets;
- honest FAQ and final CTA;
- tasteful footer.

Write specific, conversational copy. “Tell Bimax what you want; review what changed” is better than architecture jargon. Make the founder/human + Bimax collaboration feel personal without becoming self-indulgent.

Use semantic HTML, keyboard navigation, visible focus, proper labels, correct heading order, and responsive behavior from 360px mobile through large desktop. Avoid horizontal overflow and scroll-jank.

## Phase 5 — autonomous verification loop

Repeat this loop until it is green or you have a concrete external blocker:

1. Run `npm run build` in `site/`.
2. Start the built site locally and inspect it in a real browser at desktop (1440×900), tablet, and mobile (390×844).
3. Capture screenshots of the full page and critical responsive states.
4. Check browser console errors, failed requests, broken links/buttons, missing assets, layout overflow, blank WebGL states, autoplay failures, and reduced-motion behavior.
5. Check keyboard navigation and obvious text contrast issues.
6. Check performance basics: no unbounded render loop, event/listener leaks, massive eager assets, layout shift, or long blocking startup.
7. Fix every issue found, then rebuild and re-check.

Do not claim “zero bugs” abstractly. Report the exact gates run and any remaining risks.

## Completion contract

Stop only when all in-scope work is complete and write `docs/SITE_BUILD_REPORT.md` with:

- concise summary of the final experience;
- files/assets created or changed;
- research sources used;
- exact verification commands and results;
- screenshots/visual QA paths;
- any honest remaining limitations;
- exact Vercel-ready steps for the human, with deployment left unexecuted.

Your final response should lead with the outcome, state that deployment was not performed, and give the shortest path to preview and deploy.
