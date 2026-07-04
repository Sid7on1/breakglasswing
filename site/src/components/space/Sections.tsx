import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Copy, Check, ChevronDown } from 'lucide-react';
import Reveal from '../ui/Reveal';
import Terminal from '../ui/Terminal';
import Magnetic from '../motion/Magnetic';
import WordReveal from '../motion/WordReveal';
import { INSTALL_CMD, HERO_LINES, ATLAS_STATS, CREW, PRECISION, LAUNCH_STATS, NAV } from '../../lib/content';

// The DOM half of the observatory: four full-height sections that scroll OVER the fixed 3D
// world (SpaceJourney). Each section is one camera station; copy sits on the side of the
// viewport the camera leaves clear for that scene.

function InstallCommand({ strong = false }: { strong?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(INSTALL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className={`${strong ? 'liquid-glass-strong' : 'liquid-glass'} flex items-center gap-3 rounded-lg px-4 py-2.5 font-mono text-sm`}>
      <span className="text-accent-bright">$</span>
      <span className="text-white/90">{INSTALL_CMD}</span>
      <button onClick={copy} className="ml-1 text-white/40 transition-colors hover:text-white" aria-label="Copy install command">
        {copied ? <Check className="h-4 w-4 text-accent-bright" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 16, filter: 'blur(8px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const, delay },
});

/** Station 1 — mission. Planet sits right of center; copy takes the left. */
export function MissionSection() {
  return (
    <section id="top" className="relative flex min-h-screen items-center">
      <div className="mx-auto w-full max-w-7xl px-5 pt-24 lg:px-8">
        <div className="max-w-2xl">
          <motion.p {...fade(0.05)} className="font-mono text-xs uppercase tracking-[0.25em] text-accent-bright">
            the coding-agent observatory
          </motion.p>
          <h1 className="mt-5 font-heading text-5xl leading-[0.95] tracking-[-0.02em] text-white sm:text-6xl lg:text-[5.2rem]">
            <WordReveal
              delay={0.15}
              words={[
                { text: 'From' },
                { text: 'idea,', italic: true, br: true },
                { text: 'to' },
                { text: 'orbit.', italic: true },
              ]}
            />
          </h1>
          <motion.p {...fade(0.6)} className="mt-6 max-w-xl text-base leading-relaxed text-white/60">
            Bimax is a terminal agent that designs <em className="font-heading not-italic text-white/85">with</em> you —
            sketch a system, watch it compile into real websites, agents, and trained models, then watch it verify itself.
            Surgical edits, self-healing tools, a code graph for a memory.
          </motion.p>
          <motion.div {...fade(0.75)} className="mt-8 flex flex-wrap items-center gap-3">
            <InstallCommand />
            <Magnetic>
              <a href="#launch" className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-shadow hover:shadow-glow">
                Begin the descent <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
              </a>
            </Magnetic>
          </motion.div>
          <motion.div {...fade(0.9)} className="mt-10">
            <Terminal title="bimax — sketch" lines={HERO_LINES} className="max-w-xl shadow-glow" />
          </motion.div>
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1], y: [0, 6, 0] }}
        transition={{ delay: 1.6, duration: 1.8, repeat: Infinity, repeatDelay: 0.4 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/30"
      >
        <ChevronDown className="h-5 w-5" />
      </motion.div>
    </section>
  );
}

/** Station 2 — atlas. The constellation drifts center-left; copy takes the right. */
export function AtlasSection() {
  return (
    <section id="atlas" className="relative flex min-h-screen items-center">
      <div className="mx-auto flex w-full max-w-7xl justify-end px-5 lg:px-8">
        <div className="max-w-xl">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-bright">graph memory</p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-4 font-heading text-4xl leading-[1.02] tracking-[-0.02em] text-white sm:text-5xl lg:text-6xl">
              Every symbol, <em className="text-accent-bright">mapped like a sky</em>.
            </h2>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-5 text-base leading-relaxed text-white/60">
              Bimax charts your repo into a living atlas — files, symbols, calls, criticality — and every
              sub-agent navigates by it. The constellation beside you is the shape of that memory on a real codebase.
            </p>
          </Reveal>
          <Reveal delay={0.24} className="mt-9">
            <div className="flex flex-wrap gap-8">
              {ATLAS_STATS.map((s) => (
                <div key={s.label}>
                  <div className="font-heading text-3xl text-white">{s.value}</div>
                  <div className="mt-1 font-mono text-xs text-white/40">{s.label}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** Station 3 — crew. The station spins center-right; copy takes the left. */
export function CrewSection() {
  return (
    <section id="crew" className="relative flex min-h-screen items-center">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-8">
        <div className="max-w-xl">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-bright">beast pipeline</p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-4 font-heading text-4xl leading-[1.02] tracking-[-0.02em] text-white sm:text-5xl lg:text-6xl">
              A crew that <em className="text-accent-bright">never sleeps</em>.
            </h2>
          </Reveal>
          <div className="mt-8 space-y-4">
            {CREW.map((c, i) => (
              <Reveal key={c.title} delay={0.14 + i * 0.07}>
                <div className="liquid-glass rounded-xl px-5 py-4">
                  <div className="font-mono text-sm font-semibold text-accent-bright">{c.title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-white/60">{c.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.5} className="mt-8">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {PRECISION.map((p) => (
                <div key={p.title} className="max-w-[13rem]">
                  <div className="font-mono text-xs font-semibold uppercase tracking-wider text-glowblue">{p.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">{p.desc}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** Station 4 — launch. Camera ends inside the nebula; the install card floats center. */
export function LaunchSection() {
  return (
    <section id="launch" className="relative flex min-h-screen flex-col justify-center">
      <div className="mx-auto w-full max-w-3xl px-5 text-center">
        <Reveal>
          <h2 className="font-heading text-5xl italic leading-[1] tracking-[-0.02em] text-gradient sm:text-7xl">
            Launch.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mx-auto mt-5 max-w-xl text-white/55">
            Install Bimax and turn your next idea into a real, verified system — without leaving the terminal.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <InstallCommand strong />
            <Magnetic>
              <a
                href="https://github.com"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white transition-shadow hover:shadow-glow"
              >
                Star on GitHub <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
              </a>
            </Magnetic>
          </div>
        </Reveal>
        <Reveal delay={0.3}>
          <div className="mt-14 flex flex-wrap items-start justify-center gap-10">
            {LAUNCH_STATS.map((s) => (
              <div key={s.label}>
                <div className="font-heading text-3xl text-white">{s.value}</div>
                <div className="mt-1 font-mono text-xs text-white/40">{s.label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      <footer className="absolute inset-x-0 bottom-0 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-5 lg:flex-row lg:px-8">
          <div className="flex items-center gap-2.5">
            <span className="liquid-glass flex h-8 w-8 items-center justify-center rounded-lg">
              <span className="font-heading text-base italic text-white">b</span>
            </span>
            <span className="font-heading text-base italic text-white">bimax</span>
            <span className="ml-2 text-sm text-white/35">© {new Date().getFullYear()}</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-sm text-white/50">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} className="transition-colors hover:text-white">{n.label}</a>
            ))}
            <a href="https://github.com" className="transition-colors hover:text-white">GitHub</a>
          </nav>
        </div>
      </footer>
    </section>
  );
}
