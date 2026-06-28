import { motion } from 'framer-motion';
import FadingVideo from './FadingVideo';

interface Card {
  iconPath: string;
  title: string;
  tags: string[];
  body: string;
}

const CARDS: Card[] = [
  {
    // edit / draw
    iconPath:
      'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    title: 'Sketch Mode',
    tags: ['Asks First', 'Web-Aware', 'Level-by-Level', 'Saved Blueprint'],
    body: 'Bimax interviews you, searches the live web, and shapes the idea decision by decision — then saves the whole conversation as a buildable Blueprint.',
  },
  {
    // layers
    iconPath:
      'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
    title: 'Blueprint Builders',
    tags: ['Websites', 'Agents', 'LLM Training', 'Real Artifacts'],
    body: 'One engine, three domains. Compile a Blueprint into real files — a Vite site, a wired agent, or an HF training config plus a runnable trainer — never a vague plan.',
  },
  {
    // bolt
    iconPath: 'M7 2v11h3v9l7-12h-4l4-8z',
    title: 'Beast Pipeline',
    tags: ['Swarm', 'Self-Heal', 'Self-Critic', 'Checkpoint'],
    body: 'Hand off the build and walk away. Parallel sub-agents in worktrees, automatic healing, a self-critic pass, and checkpoints — autonomous, end to end.',
  },
];

export default function Capabilities() {
  return (
    <section id="capabilities" className="relative min-h-screen w-full overflow-hidden bg-black">
      <FadingVideo
        src="/videos/capabilities.mp4"
        poster="/videos/capabilities_poster.jpg"
        className="absolute inset-0 z-0 h-full w-full object-cover"
      />

      <div className="relative z-10 flex min-h-screen flex-col px-8 pb-10 pt-24 md:px-16 lg:px-20">
        {/* header */}
        <div className="mb-auto">
          <p className="mb-6 font-body text-sm text-white/80">// Capabilities</p>
          <h2 className="font-heading text-6xl italic leading-[0.9] tracking-[-3px] text-white md:text-7xl lg:text-[6rem]">
            Building,
            <br />
            evolved
          </h2>
        </div>

        {/* cards */}
        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ filter: 'blur(10px)', opacity: 0, y: 30 }}
              whileInView={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, ease: 'easeOut', delay: i * 0.12 }}
              className="liquid-glass flex min-h-[360px] flex-col rounded-xl p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="liquid-glass flex h-11 w-11 items-center justify-center rounded-md">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="currentColor">
                    <path d={card.iconPath} />
                  </svg>
                </div>
                <div className="flex max-w-[70%] flex-wrap justify-end gap-1.5">
                  {card.tags.map((tag) => (
                    <span
                      key={tag}
                      className="liquid-glass whitespace-nowrap rounded-full px-3 py-1 font-body text-[11px] text-white/90"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex-1" />

              <div className="mt-6">
                <h3 className="font-heading text-3xl italic leading-none tracking-[-1px] text-white md:text-4xl">
                  {card.title}
                </h3>
                <p className="mt-3 max-w-[32ch] font-body text-sm font-light leading-snug text-white/90">
                  {card.body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
