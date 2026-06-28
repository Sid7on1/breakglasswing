import Reveal from './ui/Reveal';
import { STATS, PARTNERS } from '../lib/content';

export default function Proof() {
  return (
    <section id="proof" className="relative border-t border-white/5 bg-ink-950 py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.06}>
              <div className="h-full bg-ink-950 p-8 text-center">
                <div className="font-heading text-5xl italic tracking-tight text-white">{s.value}</div>
                <div className="mt-2 text-sm text-white/50">{s.label}</div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <p className="mt-16 text-center font-mono text-xs uppercase tracking-[0.25em] text-white/40">
            Built on the tools you already trust
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {PARTNERS.map((p) => (
              <span key={p} className="font-heading text-2xl italic text-white/45 transition-colors hover:text-white/80">
                {p}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
