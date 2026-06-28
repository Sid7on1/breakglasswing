import { motion } from 'framer-motion';
import { ArrowUpRight, Play, Clock, Globe } from 'lucide-react';
import FadingVideo from './FadingVideo';
import BlurText from './BlurText';
import HeroOrb from './HeroOrb';
import Navbar from './Navbar';

const enter = {
  initial: { filter: 'blur(10px)', opacity: 0, y: 20 },
  animate: { filter: 'blur(0px)', opacity: 1, y: 0 },
};

const PARTNERS = ['Claude', 'MCP', 'Playwright', 'W&B', 'HuggingFace'];

export default function Hero() {
  return (
    <section className="relative h-screen w-full overflow-hidden bg-black">
      {/* background video — focal point is the top of frame */}
      <FadingVideo
        src="/videos/hero.mp4"
        poster="/videos/hero_poster.jpg"
        className="absolute left-1/2 top-0 z-0 -translate-x-1/2 object-cover object-top"
        style={{ width: '120%', height: '120%' }}
      />

      {/* 3D glass orb, between video and content */}
      <HeroOrb className="absolute inset-0 z-[5]" />

      {/* foreground */}
      <div className="relative z-10 flex h-full flex-col">
        <Navbar />

        <div className="flex flex-1 flex-col items-center justify-center px-4 pt-24 text-center">
          {/* badge */}
          <motion.div
            {...enter}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.4 }}
            className="liquid-glass flex items-center gap-2 rounded-full py-1 pl-1 pr-3"
          >
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">New</span>
            <span className="font-body text-sm text-white/90">
              Sketch Mode — design any system, level by level
            </span>
          </motion.div>

          {/* headline */}
          <BlurText
            text="From a Sketch to a Shipped System"
            className="mt-6 max-w-2xl font-heading text-6xl italic leading-[0.8] tracking-[-4px] text-white md:text-7xl lg:text-[5.5rem]"
          />

          {/* subheading */}
          <motion.p
            {...enter}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.8 }}
            className="mt-4 max-w-2xl font-body text-sm font-light leading-tight text-white md:text-base"
          >
            Bimax is a terminal agent that doesn't just execute — it designs with you. Sketch an idea,
            decide it level by level, and watch it compile into real websites, agents, and trained
            models. Verified, end to end.
          </motion.p>

          {/* CTAs */}
          <motion.div
            {...enter}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 1.1 }}
            className="mt-6 flex items-center gap-6"
          >
            <a
              href="#"
              className="liquid-glass-strong flex items-center gap-2 rounded-full px-5 py-2.5 font-body text-sm font-medium text-white"
            >
              Start Building
              <ArrowUpRight className="h-5 w-5" strokeWidth={2} />
            </a>
            <a href="#" className="flex items-center gap-2 font-body text-sm text-white">
              Watch the Demo
              <Play className="h-4 w-4" fill="currentColor" strokeWidth={0} />
            </a>
          </motion.div>

          {/* stats */}
          <motion.div
            {...enter}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 1.3 }}
            className="mt-8 flex items-stretch gap-4"
          >
            <Stat icon={<Clock className="h-7 w-7" strokeWidth={1.5} />} value="604" label="Tests green, every build" />
            <Stat icon={<Globe className="h-7 w-7" strokeWidth={1.5} />} value="3 Domains" label="Websites · Agents · LLMs" />
          </motion.div>

          {/* partners */}
          <motion.div
            {...enter}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 1.4 }}
            className="mt-auto flex flex-col items-center gap-4 pb-8"
          >
            <span className="liquid-glass rounded-full px-3.5 py-1 font-body text-xs font-medium text-white">
              Built on the tools you already trust
            </span>
            <div className="flex items-center gap-12 md:gap-16">
              {PARTNERS.map((p) => (
                <span key={p} className="font-heading text-2xl italic tracking-tight text-white md:text-3xl">
                  {p}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="liquid-glass flex w-[220px] flex-col rounded-xl p-5">
      <div className="text-white">{icon}</div>
      <div className="mt-auto">
        <div className="font-heading text-4xl italic leading-none tracking-[-1px] text-white">{value}</div>
        <div className="mt-2 font-body text-xs font-light text-white">{label}</div>
      </div>
    </div>
  );
}
