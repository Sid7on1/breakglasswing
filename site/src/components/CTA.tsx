import { useState } from 'react';
import { ArrowUpRight, Copy, Check } from 'lucide-react';
import Reveal from './ui/Reveal';
import Backdrop from './motion/Backdrop';
import Magnetic from './motion/Magnetic';
import { INSTALL_CMD, NAV } from '../lib/content';

export default function CTA() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(INSTALL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <>
      <section id="install" className="relative overflow-hidden border-t border-white/5 bg-ink-950 py-32">
        <Backdrop grid={false} />
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[120px]" />
        <Reveal className="relative mx-auto max-w-3xl px-5 text-center">
          <h2 className="font-heading text-5xl italic leading-[1] tracking-[-0.02em] text-gradient sm:text-6xl">
            Sketch it. Ship it.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-white/55">
            Install Bimax and turn your next idea into a real, verified system — without leaving the terminal.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <div className="liquid-glass-strong flex items-center gap-3 rounded-lg px-5 py-3 font-mono text-sm">
              <span className="text-accent">$</span>
              <span className="text-white/90">{INSTALL_CMD}</span>
              <button onClick={copy} className="ml-1 text-white/40 transition-colors hover:text-white" aria-label="Copy">
                {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <Magnetic>
              <a
                href="https://github.com"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-ink-950 transition-shadow hover:shadow-glow"
              >
                Star on GitHub
                <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
              </a>
            </Magnetic>
          </div>
        </Reveal>
      </section>

      {/* footer */}
      <footer className="border-t border-white/5 bg-ink-950 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-5 lg:flex-row lg:px-8">
          <div className="flex items-center gap-2.5">
            <span className="liquid-glass flex h-8 w-8 items-center justify-center rounded-lg">
              <span className="font-heading text-base italic text-white">b</span>
            </span>
            <span className="font-heading text-base italic text-white">bimax</span>
            <span className="ml-2 text-sm text-white/35">© {new Date().getFullYear()}</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-sm text-white/50">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} className="transition-colors hover:text-white">
                {n.label}
              </a>
            ))}
            <a href="https://github.com" className="transition-colors hover:text-white">
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}
