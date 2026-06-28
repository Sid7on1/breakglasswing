import { useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { PencilRuler, Layers, Boxes, ShieldCheck, type LucideIcon } from 'lucide-react';

// The narrative spine: a PINNED section. As you scroll its tall track, the active stage advances
// 1→4 (sketch → blueprint → build → verify); the left rail fills emerald and the right panel
// crossfades a coded scene per stage. Under reduced motion it still works (stages just snap).
interface Stage {
  icon: LucideIcon;
  title: string;
  desc: string;
}
const STAGES: Stage[] = [
  { icon: PencilRuler, title: 'Sketch', desc: 'Talk it through. Bimax interviews you, searches the live web, and shapes the idea — no blank page.' },
  { icon: Layers, title: 'Blueprint', desc: 'Every decision, level by level. Pick options, mix them, import from the web — saved as a Blueprint.' },
  { icon: Boxes, title: 'Build', desc: 'Compile the Blueprint into real artifacts — a site, a wired agent, or a training config + trainer.' },
  { icon: ShieldCheck, title: 'Verify', desc: 'Prove it works — a screenshot loop for sites, live metrics for models, a smoke run for agents.' },
];
const ease = [0.22, 1, 0.36, 1] as const;

function StageScene({ stage }: { stage: number }) {
  if (stage === 0)
    return (
      <svg viewBox="0 0 120 90" className="h-full w-full p-10">
        {['M10,70 C30,20 60,20 80,40', 'M10,78 L100,78', 'M20,55 L60,55', 'M20,62 L48,62'].map((d, i) => (
          <motion.path key={i} d={d} fill="none" stroke="#34d399" strokeWidth={1} strokeOpacity={0.7}
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: i * 0.2, duration: 0.8, ease }} />
        ))}
      </svg>
    );
  if (stage === 1) {
    const ns = [{ x: 20, y: 45 }, { x: 45, y: 25 }, { x: 45, y: 65 }, { x: 70, y: 35 }, { x: 70, y: 58 }, { x: 95, y: 45 }];
    const es = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5]];
    return (
      <svg viewBox="0 0 115 90" className="h-full w-full p-8">
        {es.map(([a, b], i) => (
          <motion.line key={i} x1={ns[a].x} y1={ns[a].y} x2={ns[b].x} y2={ns[b].y} stroke="#34d399" strokeWidth={0.6} strokeOpacity={0.6}
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: i * 0.1, duration: 0.5 }} />
        ))}
        {ns.map((n, i) => (
          <motion.circle key={i} cx={n.x} cy={n.y} r={3} fill="#0a1414" stroke="#34d399" strokeWidth={0.8}
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.08, type: 'spring', stiffness: 300 }}
            style={{ transformOrigin: `${n.x}px ${n.y}px` }} />
        ))}
      </svg>
    );
  }
  if (stage === 2)
    return (
      <div className="flex h-full items-center justify-center gap-3">
        {['train.py', 'config', 'README', 'reqs'].map((f, i) => (
          <motion.div key={f} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.12, ease }}
            className="liquid-glass flex h-24 w-16 items-end justify-center rounded-md p-2 font-mono text-[9px] text-white/60">{f}</motion.div>
        ))}
      </div>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <svg viewBox="0 0 100 50" className="h-20 w-48">
        <motion.polyline points="2,46 22,34 42,38 62,18 82,22 98,6" fill="none" stroke="#34d399" strokeWidth={2}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease }} />
      </svg>
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6, type: 'spring' }}
        className="font-mono text-sm text-accent">✓ verified</motion.span>
    </div>
  );
}

export default function Loop() {
  const track = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] });
  const [stage, setStage] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => setStage(Math.min(3, Math.floor(v * 4))));

  return (
    <section id="how" ref={track} className="relative border-t border-white/5 bg-ink-950" style={{ height: '320vh' }}>
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-5 lg:grid-cols-2 lg:px-8">
          {/* left: rail + copy */}
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">// the loop</p>
            <h2 className="mt-4 max-w-md font-heading text-4xl italic leading-[1.05] tracking-[-0.02em] text-white sm:text-5xl">
              One loop for everything you build
            </h2>
            <div className="mt-10 space-y-1">
              {STAGES.map((s, i) => {
                const active = i === stage;
                return (
                  <div key={s.title} className="flex gap-4">
                    {/* rail */}
                    <div className="flex flex-col items-center">
                      <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl transition-colors ${active ? 'bg-accent text-ink-950' : 'liquid-glass text-white/40'}`}>
                        <s.icon className="h-4 w-4" strokeWidth={2} />
                      </span>
                      {i < STAGES.length - 1 && (
                        <div className="my-1 h-10 w-px bg-white/10">
                          <motion.div className="w-px bg-accent" animate={{ height: i < stage ? '100%' : '0%' }} transition={{ duration: 0.4 }} />
                        </div>
                      )}
                    </div>
                    <motion.div animate={{ opacity: active ? 1 : 0.4 }} className="pb-2">
                      <h3 className="font-heading text-2xl italic text-white">{s.title}</h3>
                      <motion.p initial={false} animate={{ height: active ? 'auto' : 0, opacity: active ? 1 : 0 }} className="overflow-hidden text-sm leading-relaxed text-white/55">
                        {s.desc}
                      </motion.p>
                    </motion.div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* right: scene */}
          <div className="relative hidden h-[420px] lg:block">
            <div className="absolute -inset-8 rounded-3xl bg-accent/5 blur-3xl" />
            <div className="liquid-glass-strong relative flex h-full items-center justify-center overflow-hidden rounded-2xl bg-grid">
              <AnimatePresence mode="wait">
                <motion.div key={stage} initial={{ opacity: 0, scale: 0.96, filter: 'blur(8px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, scale: 0.96, filter: 'blur(8px)' }} transition={{ duration: 0.4 }} className="h-full w-full">
                  <StageScene stage={stage} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
