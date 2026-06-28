import Reveal from './ui/Reveal';
import { STEPS } from '../lib/content';

export default function HowItWorks() {
  return (
    <section id="how" className="relative border-t border-white/5 bg-ink-950 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">// the loop</p>
          <h2 className="mt-4 max-w-2xl font-heading text-4xl italic leading-[1.05] tracking-[-0.02em] text-white sm:text-5xl">
            One loop for everything you build
          </h2>
          <p className="mt-4 max-w-xl text-white/55">
            Websites, agents, models — the same four moves. Discuss it, decide it, build it, prove it.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08}>
              <div className="group relative h-full bg-ink-950 p-7 transition-colors hover:bg-ink-900">
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl liquid-glass text-accent">
                    <s.icon className="h-5 w-5" strokeWidth={1.6} />
                  </span>
                  <span className="font-mono text-sm text-white/25">{s.n}</span>
                </div>
                <h3 className="mt-6 font-heading text-2xl italic text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{s.desc}</p>
                {i < STEPS.length - 1 && (
                  <span className="absolute right-0 top-1/2 hidden h-px w-6 -translate-y-1/2 translate-x-1/2 bg-gradient-to-r from-accent/60 to-transparent lg:block" />
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
