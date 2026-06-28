import Reveal from './ui/Reveal';
import Counter from './motion/Counter';

const STATS: { value: number; suffix?: string; label: string }[] = [
  { value: 604, label: 'tests green, every build' },
  { value: 3, label: 'domains — sites · agents · LLMs' },
  { value: 14, label: 'decision levels for an LLM' },
  { value: 100, suffix: '%', label: 'open, hackable, yours' },
];

export default function Proof() {
  return (
    <section id="proof" className="relative border-t border-white/5 bg-ink-950 py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.06}>
              <div className="h-full bg-ink-950 p-8 text-center">
                <div className="font-heading text-5xl italic tracking-tight text-white">
                  <Counter value={s.value} suffix={s.suffix} />
                </div>
                <div className="mt-2 text-sm text-white/50">{s.label}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
