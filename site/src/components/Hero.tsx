import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Play, Copy, Check } from 'lucide-react';
import HeroOrb from './HeroOrb';
import Terminal from './ui/Terminal';
import { INSTALL_CMD } from '../lib/content';

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 18, filter: 'blur(8px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const, delay },
});

const HERO_LINES = [
  { text: 'bimax sketch "a model that writes my docs"', prompt: true },
  { text: 'Where does it run, and what should it sound like?', dim: true },
  { text: '› fine-tune 7B · my style · ship to HF', prompt: false },
  { text: 'Blueprint saved → tokenizer · GQA · LoRA · bf16', dim: true },
  { text: 'bimax build && verify', prompt: true },
  { text: '✓ train.py + config  ·  loss 2.9 ↓  ·  healthy', dim: true },
];

export default function Hero() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(INSTALL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <section id="top" className="relative overflow-hidden bg-ink-950">
      {/* ambient layers */}
      <div className="absolute inset-0 bg-grid [mask-image:radial-gradient(70%_60%_at_50%_0%,#000,transparent)]" />
      <div className="absolute inset-0 bg-radial-accent" />
      <HeroOrb className="pointer-events-none absolute -right-24 top-10 h-[680px] w-[680px] opacity-70 md:opacity-100" />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-5 pb-24 pt-36 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pt-44">
        {/* left: copy */}
        <div>
          <motion.a
            {...fade(0.05)}
            href="#how"
            className="liquid-glass inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3.5"
          >
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-ink-950">New</span>
            <span className="text-sm text-white/80">Sketch Mode — design any system, level by level</span>
          </motion.a>

          <motion.h1
            {...fade(0.15)}
            className="mt-6 font-heading text-5xl italic leading-[0.92] tracking-[-0.02em] text-gradient sm:text-6xl lg:text-7xl"
          >
            From a sketch
            <br />
            to a shipped system
          </motion.h1>

          <motion.p {...fade(0.28)} className="mt-5 max-w-xl text-base leading-relaxed text-white/60">
            Bimax is a terminal agent that doesn&apos;t just execute — it designs with you. Sketch an idea,
            decide it level by level, and watch it compile into real websites, agents, and trained models.
            Verified, end to end.
          </motion.p>

          {/* install command */}
          <motion.div {...fade(0.4)} className="mt-8 flex flex-wrap items-center gap-3">
            <div className="liquid-glass flex items-center gap-3 rounded-lg px-4 py-2.5 font-mono text-sm">
              <span className="text-accent">$</span>
              <span className="text-white/90">{INSTALL_CMD}</span>
              <button onClick={copy} className="ml-1 text-white/40 transition-colors hover:text-white" aria-label="Copy install command">
                {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <a
              href="#how"
              className="inline-flex items-center gap-2 text-sm font-medium text-white/80 transition-colors hover:text-white"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full liquid-glass">
                <Play className="h-3.5 w-3.5 text-accent" fill="currentColor" strokeWidth={0} />
              </span>
              See how it works
            </a>
          </motion.div>

          <motion.div {...fade(0.5)} className="mt-10 flex items-center gap-6 text-sm text-white/40">
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> 604 tests green</span>
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> open source</span>
            <span className="hidden items-center gap-2 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> 3 build domains</span>
          </motion.div>
        </div>

        {/* right: terminal */}
        <motion.div
          initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.35 }}
          className="relative"
        >
          <div className="absolute -inset-6 rounded-3xl bg-accent/10 blur-3xl" />
          <Terminal title="bimax — sketch" lines={HERO_LINES} className="relative shadow-glow" />
        </motion.div>
      </div>

      {/* fade into next section */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink-950" />
    </section>
  );
}
