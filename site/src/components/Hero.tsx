import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Play, Copy, Check, ChevronDown } from 'lucide-react';
import HeroOrb from './HeroOrb';
import Terminal from './ui/Terminal';
import Backdrop from './motion/Backdrop';
import WordReveal from './motion/WordReveal';
import Magnetic from './motion/Magnetic';
import { INSTALL_CMD } from '../lib/content';

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 16, filter: 'blur(8px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const, delay },
});

const HERO_LINES = [
  { text: 'bimax sketch "a model that writes my docs"', prompt: true },
  { text: 'Where does it run, and what should it sound like?', dim: true },
  { text: 'fine-tune 7B · my style · ship to HF', prompt: true },
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
    <section id="top" className="relative min-h-screen overflow-hidden bg-ink-950">
      <Backdrop />
      {/* video drop-in slot: place /media/hero-ambient.mp4 here later (layers over Backdrop) */}
      <HeroOrb className="pointer-events-none absolute -right-32 top-0 h-[760px] w-[760px] opacity-80 md:opacity-100" />

      <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 items-center gap-12 px-5 pb-28 pt-36 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pt-40">
        {/* left: copy */}
        <div>
          <motion.a {...fade(0.05)} href="#how" className="liquid-glass inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3.5">
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-ink-950">New</span>
            <span className="text-sm text-white/80">Sketch Mode — design any system, level by level</span>
          </motion.a>

          <h1 className="mt-6 font-heading text-5xl leading-[0.95] tracking-[-0.02em] text-white sm:text-6xl lg:text-[5rem]">
            <WordReveal
              delay={0.15}
              words={[
                { text: 'From' },
                { text: 'a' },
                { text: 'sketch', italic: true, br: true },
                { text: 'to' },
                { text: 'a' },
                { text: 'shipped', italic: true },
                { text: 'system.' },
              ]}
            />
          </h1>

          <motion.p {...fade(0.7)} className="mt-6 max-w-xl text-base leading-relaxed text-white/60">
            Bimax is a terminal agent that doesn&apos;t just execute — it designs <em className="font-heading not-italic text-white/80">with</em> you.
            Sketch an idea, decide it level by level, and watch it compile into real websites, agents, and trained models. Verified, end to end.
          </motion.p>

          <motion.div {...fade(0.82)} className="mt-8 flex flex-wrap items-center gap-3">
            <div className="liquid-glass flex items-center gap-3 rounded-lg px-4 py-2.5 font-mono text-sm">
              <span className="text-accent">$</span>
              <span className="text-white/90">{INSTALL_CMD}</span>
              <button onClick={copy} className="ml-1 text-white/40 transition-colors hover:text-white" aria-label="Copy install command">
                {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <Magnetic>
              <a href="#how" className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-ink-950 transition-shadow hover:shadow-glow">
                Start building <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
              </a>
            </Magnetic>
            <a href="#watch" className="inline-flex items-center gap-2 text-sm font-medium text-white/80 transition-colors hover:text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-full liquid-glass">
                <Play className="h-3.5 w-3.5 text-accent" fill="currentColor" strokeWidth={0} />
              </span>
              Watch it build
            </a>
          </motion.div>

          <motion.div {...fade(0.95)} className="mt-10 flex items-center gap-6 font-mono text-xs text-white/40">
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> 604 tests green</span>
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> open source</span>
            <span className="hidden items-center gap-2 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> 3 build domains</span>
          </motion.div>
        </div>

        {/* right: terminal */}
        <motion.div
          initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.4 }}
          className="relative"
        >
          <div className="absolute -inset-6 rounded-3xl bg-accent/10 blur-3xl" />
          <Terminal title="bimax — sketch" lines={HERO_LINES} className="relative shadow-glow" />
        </motion.div>
      </div>

      {/* scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1], y: [0, 6, 0] }}
        transition={{ delay: 1.4, duration: 1.8, repeat: Infinity, repeatDelay: 0.4 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/30"
      >
        <ChevronDown className="h-5 w-5" />
      </motion.div>
    </section>
  );
}
