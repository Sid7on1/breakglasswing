import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';
import Reveal from './ui/Reveal';
import Terminal from './ui/Terminal';
import { DOMAINS } from '../lib/content';

export default function Domains() {
  const [active, setActive] = useState(DOMAINS[0].id);
  const domain = DOMAINS.find((d) => d.id === active)!;

  return (
    <section id="domains" className="relative border-t border-white/5 bg-ink-950 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">// three domains</p>
          <h2 className="mt-4 max-w-2xl font-heading text-4xl italic leading-[1.05] tracking-[-0.02em] text-white sm:text-5xl">
            One engine. Whatever you&apos;re building.
          </h2>
        </Reveal>

        {/* tabs */}
        <Reveal delay={0.1}>
          <div className="mt-12 inline-flex rounded-full liquid-glass p-1.5">
            {DOMAINS.map((d) => (
              <button
                key={d.id}
                onClick={() => setActive(d.id)}
                className={`relative flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                  active === d.id ? 'text-ink-950' : 'text-white/60 hover:text-white'
                }`}
              >
                {active === d.id && (
                  <motion.span
                    layoutId="domain-pill"
                    className="absolute inset-0 rounded-full bg-accent"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <d.icon className="relative h-4 w-4" strokeWidth={2} />
                <span className="relative">{d.label}</span>
              </button>
            ))}
          </div>
        </Reveal>

        {/* panel */}
        <div className="mt-10 grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={domain.id}
              initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="font-heading text-3xl italic text-white">{domain.tagline}</h3>
              <ul className="mt-6 space-y-3">
                {domain.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-white/70">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-accent/15 text-accent">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span className="text-sm leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.div
              key={domain.id + '-term'}
              initial={{ opacity: 0, scale: 0.98, filter: 'blur(6px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.98, filter: 'blur(6px)' }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <Terminal title={`bimax — ${domain.label.toLowerCase()}`} lines={domain.code} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
