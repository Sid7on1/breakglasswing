import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView } from 'framer-motion';
import Reveal from './ui/Reveal';

// The centerpiece — a coded, looping "watch it build" sequence (no video needed). Five phases cycle:
// sketch → blueprint → build → run → verified, each a small composed motion scene inside a glass
// browser frame, with a synced caption + progress rail. Plays only while in view.
const PHASES = ['Sketching the idea…', 'Assembling the Blueprint…', 'Building the files…', 'Running it…', 'Verified ✓'];
const ease = [0.22, 1, 0.36, 1] as const;

function Scene({ phase }: { phase: number }) {
  if (phase === 0)
    return (
      <div className="flex h-full flex-col justify-center gap-2 px-8 font-mono text-sm">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <span className="text-accent">›</span> <span className="text-white/85">bimax sketch </span>
          <span className="text-white/85">&quot;a launch page for my app&quot;</span>
          <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="text-accent">
            ▍
          </motion.span>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="text-white/40">
          What&apos;s the one action a visitor should take?
        </motion.div>
      </div>
    );

  if (phase === 1) {
    const nodes = [
      { x: 18, y: 50 }, { x: 40, y: 28 }, { x: 40, y: 72 }, { x: 62, y: 38 }, { x: 62, y: 64 }, { x: 84, y: 50 },
    ];
    const edges = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5]];
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        {edges.map(([a, b], i) => (
          <motion.line
            key={i}
            x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
            stroke="#34d399" strokeWidth={0.4} strokeOpacity={0.6}
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.2 + i * 0.12, duration: 0.5 }}
          />
        ))}
        {nodes.map((n, i) => (
          <motion.circle
            key={i} cx={n.x} cy={n.y} r={2.4} fill="#0a1414" stroke="#34d399" strokeWidth={0.6}
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.1, type: 'spring', stiffness: 300 }}
            style={{ transformOrigin: `${n.x}px ${n.y}px` }}
          />
        ))}
      </svg>
    );
  }

  if (phase === 2)
    return (
      <div className="flex h-full items-center justify-center gap-3 px-8">
        {['index.tsx', 'theme.css', 'config', 'page.tsx', 'deploy'].map((f, i) => (
          <motion.div
            key={f}
            initial={{ opacity: 0, y: 40, rotateX: -40 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ delay: i * 0.14, duration: 0.5, ease }}
            className="liquid-glass flex h-24 w-16 flex-col items-center justify-center gap-2 rounded-md font-mono text-[9px] text-white/60"
          >
            <span className="h-6 w-6 rounded bg-accent/20 ring-1 ring-accent/40" />
            {f}
          </motion.div>
        ))}
      </div>
    );

  if (phase === 3)
    return (
      <div className="flex h-full items-center justify-center gap-6 px-8">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="liquid-glass h-28 w-40 overflow-hidden rounded-md">
          <div className="h-5 bg-white/5" />
          <div className="space-y-2 p-3">
            <div className="h-2 w-3/4 rounded bg-white/15" />
            <div className="h-2 w-1/2 rounded bg-white/10" />
            <div className="h-6 w-16 rounded bg-accent/60" />
          </div>
        </motion.div>
        <svg viewBox="0 0 100 60" className="h-24 w-40">
          <motion.polyline
            points="2,55 20,40 38,44 56,24 74,28 98,6"
            fill="none" stroke="#34d399" strokeWidth={2}
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease }}
          />
        </svg>
      </div>
    );

  return (
    <div className="flex h-full items-center justify-center">
      <motion.div
        initial={{ scale: 0, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/15 ring-2 ring-accent"
      >
        <svg viewBox="0 0 24 24" className="h-10 w-10 text-accent" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M4 12l5 5L20 6" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.5 }} />
        </svg>
      </motion.div>
    </div>
  );
}

export default function SeeItBuild() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 2600);
    return () => clearInterval(id);
  }, [inView]);

  return (
    <section id="watch" className="relative overflow-hidden border-t border-white/5 bg-ink-950 py-24 lg:py-32">
      <div className="mx-auto max-w-5xl px-5 lg:px-8">
        <Reveal>
          <p className="text-center font-mono text-xs uppercase tracking-[0.25em] text-accent">// watch</p>
          <h2 className="mx-auto mt-4 max-w-2xl text-center font-heading text-4xl italic leading-[1.05] tracking-[-0.02em] text-white sm:text-5xl">
            One line in. A system out.
          </h2>
        </Reveal>

        <Reveal delay={0.1}>
          <div ref={ref} className="relative mt-14">
            <div className="absolute -inset-10 rounded-[2rem] bg-accent/10 blur-[100px]" />
            <div className="liquid-glass-strong relative overflow-hidden rounded-2xl shadow-glow">
              {/* chrome */}
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-3 font-mono text-xs text-white/40">bimax — build</span>
                <div className="ml-auto flex gap-1.5">
                  {PHASES.map((_, i) => (
                    <span key={i} className={`h-1 w-6 rounded-full transition-colors ${i <= phase ? 'bg-accent' : 'bg-white/10'}`} />
                  ))}
                </div>
              </div>
              {/* stage */}
              <div className="relative h-[320px] bg-grid">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={phase}
                    initial={{ opacity: 0, filter: 'blur(8px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(8px)' }}
                    transition={{ duration: 0.4 }}
                    className="absolute inset-0"
                  >
                    <Scene phase={phase} />
                  </motion.div>
                </AnimatePresence>
              </div>
              {/* caption */}
              <div className="border-t border-white/5 px-5 py-3 text-center font-mono text-sm text-white/60">
                <AnimatePresence mode="wait">
                  <motion.span key={phase} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}>
                    {PHASES[phase]}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
