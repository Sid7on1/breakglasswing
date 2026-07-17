import { MotionConfig } from 'framer-motion';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Navbar from './components/Navbar';
import ProductWindow from './components/ProductWindow';
import Faq from './components/Faq';
import InstallCommand from './components/InstallCommand';
import WaitlistForm from './components/WaitlistForm';
import CinematicMedia from './components/CinematicMedia';
import Reveal from './components/ui/Reveal';
import SmoothScroll from './components/motion/SmoothScroll';
import LiquidGlassSystem from './components/LiquidGlassSystem';
import CustomCursor from './components/CustomCursor';
import {
  CONTROL,
  FEATURES,
  HARNESS_COMPARISON,
  HARNESS_METRICS,
  NAV,
  OUTCOMES,
  PROOF,
  TURN,
} from './lib/content';

gsap.registerPlugin(ScrollTrigger);

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

function Journey() {
  const journeyRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = journeyRef.current;
    const lightweightMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce), (pointer: coarse), (max-width: 767px)',
    ).matches;
    if (!root || lightweightMotion) return undefined;

    const context = gsap.context(() => {
      const panels = gsap.utils.toArray<HTMLElement>('.journey-panel');

      panels.forEach((panel) => {
        const copy = panel.querySelector<HTMLElement>('.journey-copy');
        if (!copy) return;

        gsap
          .timeline({
            scrollTrigger: {
              trigger: panel,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.35,
              invalidateOnRefresh: true,
            },
          })
          .fromTo(
            copy,
            { autoAlpha: 0, y: 42, scale: 0.985 },
            { autoAlpha: 1, y: 0, scale: 1, duration: 0.27, ease: 'none' },
          )
          .to(copy, { autoAlpha: 1, y: 0, scale: 1, duration: 0.46, ease: 'none' })
          .to(copy, { autoAlpha: 0, y: -34, scale: 0.992, duration: 0.27, ease: 'none' });
      });
    }, root);

    return () => context.revert();
  }, []);

  return (
    <section ref={journeyRef} id="top" className="journey-shell">
      <div className="journey-sticky" aria-hidden>
        <CinematicMedia
          className="journey-media"
          videoSrc="/media/living-ledger/hero-loop-desktop-1440p-v2.mp4"
          desktopPoster="/media/living-ledger/hero-desktop.webp"
          mobilePoster="/media/living-ledger/hero-mobile.webp"
          alt=""
          objectPosition="67% center"
          scrollScrub
          scrollRoot=".journey-shell"
          eager
        />
        <div className="journey-vignette" />
      </div>

      <div className="journey-track">
        <article className="journey-panel journey-hero">
          <div className="journey-copy hero-copy">
            <Eyebrow>Model-neutral coding harness · Free preview</Eyebrow>
            <h1 className="hero-title">
              Same model. <span>Different harness.</span>
            </h1>
            <p className="hero-lede">
              Bimax adds the system around a capable model: a map of your project, coordinated
              workers, saved progress, and proof that stays honest when the code changes.
            </p>
            <InstallCommand className="hero-install" />
            <div className="hero-links">
              <a href="#turn" className="hero-text-link">
                See it work <span aria-hidden>↓</span>
              </a>
              <a href="#compare" className="hero-text-link">Compare with Claude Code &amp; Codex</a>
            </div>
          </div>
          <div className="hero-wordmark" aria-hidden="true">Bimax</div>
        </article>

        <article className="journey-panel">
          <div className="journey-copy">
            <span className="journey-phase">Say it your way</span>
            <h2>Start with the result, not the code.</h2>
            <p>
              “Make this easier to book.” “Add a member area.” “Fix the checkout.” Bimax turns the
              outcome in your head into a concrete plan.
            </p>
          </div>
        </article>

        <article className="journey-panel journey-panel-right">
          <div className="journey-copy">
            <span className="journey-phase">Watch it build</span>
            <h2>Your whole project joins the conversation.</h2>
            <p>
              Bimax finds the connected pieces, makes the change, and tells you what is happening
              without making you decode a wall of technical language.
            </p>
          </div>
        </article>

        <article className="journey-panel">
          <div className="journey-copy">
            <span className="journey-phase is-verified">Keep what works</span>
            <h2>The result arrives with receipts.</h2>
            <p>
              See what changed, what Bimax checked, and anything that still needs your attention.
              Nothing gets waved through with a hopeful “done.”
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

function OrchestrationFilm() {
  return (
    <section className="orchestration-section" aria-labelledby="orchestration-title">
      <div className="orchestration-frame">
        <CinematicMedia
          className="orchestration-media"
          videoSrc="/media/living-ledger/orchestration.mp4"
          desktopPoster="/media/living-ledger/orchestration-poster.webp"
          alt="A central Bimax terminal coordinating three companion terminals beneath an ancient sunlit tree"
          objectPosition="center"
        />
        <div className="orchestration-shade" aria-hidden="true" />
        <Reveal className="orchestration-copy">
          <Eyebrow>Parallel work · One shared outcome</Eyebrow>
          <h2 id="orchestration-title">One request. Work moves together.</h2>
          <p>
            Bimax can coordinate up to four workers around one plan, keep their work connected,
            and bring every result back through the same verification path.
          </p>
          <div className="orchestration-metrics" aria-label="Bimax orchestration limits">
            <span><strong>4</strong> coordinated workers</span>
            <span><strong>3</strong> delegation levels</span>
            <span><strong>1</strong> shared ledger</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ProofRail() {
  return (
    <section aria-label="What to expect from Bimax" className="proof-rail">
      <div className="proof-rail-grid mx-auto grid max-w-wide md:grid-cols-3">
        {PROOF.map((item) => (
            <div key={item.value} className="fact-cell liquid-glass liquid-glass-proof">
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HarnessCompare() {
  return (
    <section id="compare" className="compare-section section-space scroll-mt-20">
      <div className="mx-auto max-w-content px-5 sm:px-8">
        <Reveal>
          <Eyebrow>Hold the model constant</Eyebrow>
          <h2 className="section-title mt-5 max-w-[13ch]">How close is Bimax to Claude Code and Codex?</h2>
          <p className="section-copy max-w-[68rem]">
            On the eight core jobs people expect from a modern coding harness, Bimax covers the same
            ground: understand, plan, use tools, delegate, isolate work, verify, remember, and extend.
            Its strongest difference is simple—proof is part of the job, not just the final message.
          </p>
        </Reveal>

        <div className="harness-metrics" aria-label="Bimax harness metrics">
          {HARNESS_METRICS.map((metric, index) => (
            <Reveal key={metric.label} delay={index * 0.035}>
              <article className="harness-metric liquid-glass liquid-glass-metric">
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
                <p>{metric.detail}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal className="harness-table-shell">
          <div className="harness-table-scroll" tabIndex={0} aria-label="Scrollable harness comparison">
            <table className="harness-table">
              <caption>
                Harness capabilities only. This does not compare model intelligence or generated-code quality.
              </caption>
              <thead>
                <tr>
                  <th scope="col">What you need</th>
                  <th scope="col" className="is-bimax">Bimax</th>
                  <th scope="col">Claude Code</th>
                  <th scope="col">Codex</th>
                </tr>
              </thead>
              <tbody>
                {HARNESS_COMPARISON.map((row) => (
                  <tr key={row.question}>
                    <th scope="row">{row.question}</th>
                    <td className="is-bimax">{row.bimax}</td>
                    <td>{row.claude}</td>
                    <td>{row.codex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <div className="runtime-proof liquid-glass liquid-glass-wide">
          <Reveal>
            <span className="utility-label">The limits behind “hours + resume”</span>
            <h3>Long-running does not mean an endless hidden loop.</h3>
            <p>
              Bimax has no fixed wall-clock session timer. An active execution is guarded at 130
              model-and-tool cycles, unfinished outcomes can wake the coordinator up to 24 times,
              and three no-progress wakes stop safely. Saved sessions remain available locally;
              eligible interrupted worker snapshots can recover automatically for seven days.
            </p>
          </Reveal>
          <Reveal delay={0.06} className="runtime-proof-side">
            <strong>Free preview</strong>
            <p>
              Bimax currently adds no software subscription. Bring a provider key and pay that
              provider directly for the model usage you choose.
            </p>
            <div className="comparison-sources">
              <span>Comparison checked July 15, 2026</span>
              <a href="https://code.claude.com/docs/en/sub-agents" target="_blank" rel="noreferrer">Claude Code docs</a>
              <a href="https://developers.openai.com/codex/multi-agent" target="_blank" rel="noreferrer">Codex docs</a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Turn() {
  return (
    <section id="turn" className="section-space scroll-mt-20">
      <div className="mx-auto max-w-content px-5 sm:px-8">
        <Reveal>
          <Eyebrow>A real Bimax workflow</Eyebrow>
          <h2 className="section-title mt-5 max-w-[12ch]">One sentence in. A working change comes out.</h2>
          <p className="section-copy">
            Follow the work as it happens, then review the result in the same calm workspace. You can
            stay high-level or open the detail whenever you are curious.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-[0.34fr_0.66fr] lg:items-start">
          <Reveal>
            <div className="request-panel liquid-glass liquid-glass-request lg:sticky lg:top-28">
              <span className="utility-label">Your request</span>
              <p>“{TURN.prompt}.”</p>
              <div className="request-path" aria-label="Bimax workflow">
                {TURN.steps.map((step) => (
                  <div key={step.label}>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <ProductWindow
            src="/media/ui-review.png"
            alt="Bimax showing a completed change beside a plain summary, verification results, and project history"
            label="Change ready · checks passed"
            priority
          />
        </div>
      </div>
    </section>
  );
}

function Outcomes() {
  return (
    <section id="make" className="section-space scroll-mt-20">
      <div className="mx-auto max-w-content px-5 sm:px-8">
        <Reveal>
          <Eyebrow>Made for momentum</Eyebrow>
          <h2 className="section-title mt-5 max-w-[11ch]">More making. Less “where do I even start?”</h2>
          <p className="section-copy">
            Bimax is for the moment after the idea—the part where a blank screen usually turns into
            tabs, tutorials, and second guessing.
          </p>
        </Reveal>
        <div className="outcome-grid mt-12">
          {OUTCOMES.map((outcome, index) => (
            <Reveal key={outcome.title} delay={index * 0.05} className={`outcome-item outcome-${index + 1}`}>
              <article className="liquid-glass liquid-glass-card">
                <div className="outcome-copy">
                  <span>{outcome.tag}</span>
                  <h3>{outcome.title}</h3>
                  <p>{outcome.body}</p>
                  <span className="outcome-proof">● Verified path</span>
                </div>
                <img
                  src={outcome.media}
                  alt={outcome.alt}
                  width="1800"
                  height="1075"
                  loading="lazy"
                  decoding="async"
                />
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="section-space feature-theater border-y border-line">
      <div className="mx-auto max-w-content px-5 sm:px-8">
        <Reveal>
          <Eyebrow>The unfair advantages</Eyebrow>
          <h2 className="section-title mt-5 max-w-[12ch]">Serious power, explained like a human.</h2>
          <p className="section-copy">
            The hard engineering stays under the hood. What you feel is continuity, clarity, and an
            agent that does not forget the rest of your app.
          </p>
        </Reveal>

        <div className="feature-layout mt-12">
          <ProductWindow
            src="/media/ui-gallery.png"
            alt="Bimax project gallery showing remembered work across several projects"
            label="Every project remembers"
          />
          <div className="feature-list">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={index * 0.04}>
                <article>
                  <span>{feature.signal}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Control() {
  return (
    <section id="control" className="section-space scroll-mt-20 bg-surface-raised">
      <div className="mx-auto grid max-w-wide gap-12 px-5 sm:px-8 lg:grid-cols-[0.62fr_0.38fr] lg:items-start">
        <div className="lg:sticky lg:top-28">
          <ProductWindow
            src="/media/ui-diff.png"
            alt="Bimax showing the exact before-and-after of a proposed change"
            label="Nothing hidden · exact change"
          />
        </div>
        <Reveal>
          <div>
            <Eyebrow>Your project. Your call.</Eyebrow>
            <h2 className="section-title mt-5 max-w-[10ch]">Bimax works out loud. You have the last word.</h2>
            <div className="control-list">
              {CONTROL.map((item) => (
                <div key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Preview() {
  return (
    <section id="install" className="section-space scroll-mt-20">
      <div className="mx-auto max-w-content px-5 sm:px-8">
        <Reveal>
          <Eyebrow>Command line available now · Desktop in early access</Eyebrow>
          <h2 className="section-title mt-5 max-w-[12ch]">Start building from your terminal today.</h2>
          <p className="section-copy">
            The Bimax CLI is live for macOS and Linux and free during preview. Install one
            self-contained binary, then choose the model provider you already trust. You pay that
            provider directly for usage; Bimax adds no preview subscription.
          </p>
        </Reveal>

        <div className="preview-layout mt-12">
          <Reveal className="preview-cli liquid-glass liquid-glass-preview">
            <span className="coming-badge is-live">Available now</span>
            <span className="utility-label">Command line</span>
            <h3>One command. Your provider. Your project.</h3>
            <p>
              Bimax asks you to choose NVIDIA, OpenAI, Anthropic, OpenRouter, DeepSeek, or Google on
              first launch, with a custom compatible endpoint available too. Keys are entered through
              a masked prompt and remain in your local settings.
            </p>
            <InstallCommand className="preview-install" />
            <img
              src="/media/ui-terminal.png"
              alt="Bimax command-line interface running inside a terminal"
              width="2880"
              height="1720"
              loading="lazy"
              decoding="async"
            />
          </Reveal>
          <Reveal delay={0.08} className="preview-desktop liquid-glass liquid-glass-preview">
            <div>
              <span className="coming-badge">Early access</span>
              <span className="utility-label">Desktop</span>
              <h3>Your idea, the work, and the proof in one place.</h3>
              <p>A native workspace for conversations, files, previews, approvals, and project memory.</p>
            </div>
            <img
              src="/media/ui-home.png"
              alt="Preview of the upcoming Bimax desktop workspace"
              width="1800"
              height="1075"
              loading="lazy"
              decoding="async"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section className="section-space border-t border-line bg-surface-raised">
      <div className="mx-auto grid max-w-content gap-10 px-5 sm:px-8 lg:grid-cols-[0.32fr_0.68fr]">
        <Reveal>
          <Eyebrow>Before you join</Eyebrow>
          <h2 className="section-title mt-5 max-w-[7ch]">Questions, answered plainly.</h2>
        </Reveal>
        <Reveal delay={0.05}>
          <Faq />
        </Reveal>
      </div>
    </section>
  );
}

function FinalWaitlist() {
  return (
    <section id="waitlist" className="waitlist-section scroll-mt-16">
      <div className="waitlist-art" aria-hidden>
        <CinematicMedia
          videoSrc="/media/living-ledger/verified.mp4"
          desktopPoster="/media/living-ledger/verified-poster.webp"
          alt=""
          objectPosition="center"
        />
      </div>
      <div className="waitlist-panel">
        <Reveal>
          <Eyebrow>Desktop early access</Eyebrow>
          <h2>Use the CLI now. Help shape what comes next.</h2>
          <p>
            The command line is available today. Join the list for the visual desktop workspace and
            help us shape it around real projects.
          </p>
          <WaitlistForm source="final" className="final-waitlist" />
          <span className="waitlist-platforms">CLI live on macOS + Linux · Desktop starts with Apple Silicon</span>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-void">
      <div className="mx-auto flex max-w-wide flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-end md:justify-between">
        <div>
          <a href="#top" className="font-heading text-3xl font-semibold tracking-[-0.05em] text-chalk">Bimax</a>
          <p className="mt-2 max-w-sm text-sm leading-6 text-mist">The system around the model—built to finish with proof.</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-mist">
          {NAV.map((item) => <a key={item.id} href={`#${item.id}`} className="hover:text-chalk">{item.label}</a>)}
          <span>© {new Date().getFullYear()} Bimax</span>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <>
      <SmoothScroll />
      <LiquidGlassSystem />
      <CustomCursor />
        <div className="min-h-[100dvh] bg-void text-chalk">
          <Navbar />
          <main>
            <Journey />
            <ProofRail />
            <Turn />
            <Outcomes />
            <Features />
            <OrchestrationFilm />
            <Control />
            <HarnessCompare />
            <Preview />
            <FaqSection />
            <FinalWaitlist />
          </main>
          <Footer />
        </div>
      </>
    </MotionConfig>
  );
}
