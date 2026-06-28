import Reveal from './ui/Reveal';
import { CAPABILITIES } from '../lib/content';

export default function Capabilities() {
  return (
    <section id="capabilities" className="relative border-t border-white/5 bg-ink-950 py-24 lg:py-32">
      <div className="absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(60%_50%_at_50%_40%,#000,transparent)]" />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">// capabilities</p>
          <h2 className="mt-4 max-w-2xl font-heading text-4xl italic leading-[1.05] tracking-[-0.02em] text-white sm:text-5xl">
            Not a chatbot. A build system.
          </h2>
        </Reveal>

        <div className="mt-14 grid auto-rows-[minmax(180px,auto)] grid-cols-1 gap-4 md:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.title} delay={(i % 3) * 0.08} className={c.span}>
              <div
                className={`group relative flex h-full flex-col overflow-hidden rounded-2xl p-7 transition-all duration-300 ${
                  c.accent
                    ? 'liquid-glass-strong'
                    : 'liquid-glass hover:-translate-y-0.5'
                }`}
              >
                {c.accent && <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />}
                <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-accent ring-1 ring-white/10">
                  <c.icon className="h-5 w-5" strokeWidth={1.6} />
                </span>
                <div className="relative mt-auto pt-8">
                  <h3 className="font-heading text-2xl italic text-white">{c.title}</h3>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">{c.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
