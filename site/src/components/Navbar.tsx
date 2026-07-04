import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { NAV } from '../lib/content';

// Sticky top nav: solidifies on scroll, highlights the section in view, smooth-scrolls to anchors,
// and collapses to a glass sheet menu on mobile.
export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string>('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.5, 1] },
    );
    NAV.forEach((n) => {
      const el = document.getElementById(n.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const go = (id: string) => {
    setOpen(false);
    // CSS `scroll-behavior` (smooth, or auto under prefers-reduced-motion) governs the animation.
    document.getElementById(id)?.scrollIntoView();
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? 'border-b border-white/5 bg-ink-950/70 backdrop-blur-xl' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        {/* logo */}
        <a href="#top" className="flex items-center gap-2.5" aria-label="Bimax home">
          <span className="liquid-glass flex h-9 w-9 items-center justify-center rounded-lg">
            <span className="font-heading text-xl italic leading-none text-white">b</span>
          </span>
          <span className="font-heading text-lg italic text-white">bimax</span>
        </a>

        {/* center nav */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active === n.id ? 'text-white' : 'text-white/55 hover:text-white/90'
              }`}
            >
              {n.label}
              {active === n.id && <span className="mx-auto mt-0.5 block h-px w-4 bg-accent" />}
            </button>
          ))}
        </nav>

        {/* right */}
        <div className="flex items-center gap-2">
          <a
            href="https://github.com"
            className="hidden rounded-full px-3.5 py-1.5 text-sm font-medium text-white/70 transition-colors hover:text-white sm:block"
          >
            GitHub
          </a>
          <a
            href="#launch"
            onClick={(e) => {
              e.preventDefault();
              go('launch');
            }}
            className="flex items-center gap-1 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
          >
            Get started
            <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
          </a>
          <button onClick={() => setOpen((o) => !o)} className="ml-1 text-white md:hidden" aria-label="Menu">
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* mobile sheet */}
      {open && (
        <div className="border-t border-white/5 bg-ink-950/95 px-5 py-4 backdrop-blur-xl md:hidden">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className="block w-full py-2.5 text-left text-base font-medium text-white/80"
            >
              {n.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
