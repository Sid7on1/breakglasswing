import Marquee from './motion/Marquee';

const A = ['Claude', 'MCP', 'Playwright', 'Weights & Biases', 'HuggingFace', 'Astro'];
const B = ['Vite', 'nanotron', 'FSDP', 'Vercel', 'Tailwind', 'LoRA'];

function Row({ items }: { items: string[] }) {
  return (
    <>
      {items.map((t) => (
        <span key={t} className="flex items-center gap-12 font-heading text-2xl italic text-white/35">
          {t}
          <span className="text-accent/40">/</span>
        </span>
      ))}
    </>
  );
}

export default function TrustMarquee() {
  return (
    <section className="relative border-y border-white/5 bg-ink-950 py-10">
      <p className="mb-6 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-white/30">
        built on the tools you already trust
      </p>
      <div className="space-y-3">
        <Marquee speed={32}>
          <Row items={A} />
        </Marquee>
        <Marquee speed={38} reverse>
          <Row items={B} />
        </Marquee>
      </div>
    </section>
  );
}
