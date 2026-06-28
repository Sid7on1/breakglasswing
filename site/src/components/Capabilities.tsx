import { motion } from 'framer-motion';
import { PencilRuler, Layers, GitBranch, Cpu, Activity, Sparkles, type LucideIcon } from 'lucide-react';
import Reveal from './ui/Reveal';

type Fx = 'lines' | 'swarm' | 'nodes' | 'chart' | 'grid';

interface Tile {
  icon: LucideIcon;
  title: string;
  desc: string;
  span: string;
  fx: Fx;
  accent?: boolean;
}
const TILES: Tile[] = [
  { icon: PencilRuler, title: 'Sketch Mode', desc: 'A conversational architect. Asks first, web-aware, decides level by level, and saves the whole thread as a buildable Blueprint.', span: 'md:col-span-2', fx: 'lines', accent: true },
  { icon: GitBranch, title: 'Beast Pipeline', desc: 'Swarm → self-heal → self-critic → checkpoint. Hand off the build and walk away.', span: 'md:col-span-1', fx: 'swarm' },
  { icon: Layers, title: 'Blueprint Builders', desc: 'One engine, three domains — compiled to real files, not vague plans.', span: 'md:col-span-1', fx: 'grid' },
  { icon: Cpu, title: 'MCP Self-Service', desc: 'Discovers, adds, and wires MCP servers by intent. Authors its own skills. Switches its own model.', span: 'md:col-span-2', fx: 'nodes' },
  { icon: Activity, title: 'Live Monitoring', desc: 'Tails training metrics (loss / grad / throughput) with anomaly alerts, or polls W&B.', span: 'md:col-span-1', fx: 'chart' },
  { icon: Sparkles, title: 'Graph Memory', desc: 'A code/entity graph keeps sub-agents goal- and context-aware across the whole run.', span: 'md:col-span-2', fx: 'nodes' },
];

function TileFx({ fx }: { fx: Fx }) {
  const stroke = '#34d399';
  if (fx === 'chart')
    return (
      <svg viewBox="0 0 200 80" className="absolute inset-0 h-full w-full opacity-40" preserveAspectRatio="none">
        <motion.polyline points="0,60 30,48 60,52 90,30 120,38 150,18 200,26" fill="none" stroke={stroke} strokeWidth={1.5}
          animate={{ pathLength: [0, 1] }} transition={{ duration: 3, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }} />
      </svg>
    );
  if (fx === 'swarm')
    return (
      <div className="absolute inset-0 opacity-50">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.span key={i} className="absolute h-1 w-1 rounded-full bg-accent"
            style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%` }}
            animate={{ x: [0, 14, -8, 0], y: [0, -10, 8, 0], opacity: [0.2, 0.8, 0.2] }}
            transition={{ duration: 4 + (i % 4), repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }} />
        ))}
      </div>
    );
  if (fx === 'grid')
    return <div className="absolute inset-0 bg-grid opacity-50 [background-size:24px_24px]" />;
  if (fx === 'nodes') {
    const ns = [[20, 30], [50, 20], [80, 40], [40, 60], [70, 70], [25, 75]];
    return (
      <svg viewBox="0 0 100 90" className="absolute inset-0 h-full w-full opacity-40">
        {ns.map(([x, y], i) => (
          <motion.circle key={i} cx={x} cy={y} r={1.6} fill={stroke}
            animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.3 }} />
        ))}
        {[[0, 1], [1, 2], [0, 3], [3, 4], [2, 4], [3, 5]].map(([a, b], i) => (
          <line key={i} x1={ns[a][0]} y1={ns[a][1]} x2={ns[b][0]} y2={ns[b][1]} stroke={stroke} strokeWidth={0.4} strokeOpacity={0.3} />
        ))}
      </svg>
    );
  }
  // lines
  return (
    <svg viewBox="0 0 200 100" className="absolute inset-0 h-full w-full opacity-30">
      {[20, 45, 70].map((y, i) => (
        <motion.line key={i} x1={10} y1={y} x2={190} y2={y} stroke={stroke} strokeWidth={1}
          animate={{ pathLength: [0, 1, 0] }} transition={{ duration: 4, repeat: Infinity, delay: i * 0.6, ease: 'easeInOut' }} />
      ))}
    </svg>
  );
}

export default function Capabilities() {
  return (
    <section id="capabilities" className="relative border-t border-white/5 bg-ink-950 py-24 lg:py-32">
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">// capabilities</p>
          <h2 className="mt-4 max-w-2xl font-heading text-4xl italic leading-[1.05] tracking-[-0.02em] text-white sm:text-5xl">
            Not a chatbot. A build system.
          </h2>
        </Reveal>

        <div className="mt-14 grid auto-rows-[200px] grid-cols-1 gap-4 md:grid-cols-3">
          {TILES.map((t, i) => (
            <Reveal key={t.title} delay={(i % 3) * 0.08} className={t.span}>
              <div className={`group relative flex h-full flex-col overflow-hidden rounded-2xl p-7 transition-all duration-300 hover:-translate-y-1 ${t.accent ? 'liquid-glass-strong' : 'liquid-glass'}`}>
                <TileFx fx={t.fx} />
                {t.accent && <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />}
                <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-accent ring-1 ring-white/10">
                  <t.icon className="h-5 w-5" strokeWidth={1.6} />
                </span>
                <div className="relative mt-auto pt-8">
                  <h3 className="font-heading text-2xl italic text-white">{t.title}</h3>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">{t.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
