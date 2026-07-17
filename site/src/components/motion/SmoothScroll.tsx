import { useEffect } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Inertial smooth scrolling — the single biggest "premium feel" lever. Disabled under
// prefers-reduced-motion so we never fight the user's accessibility setting.
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Native scrolling is substantially smoother on touch devices and narrow screens.
    if (window.matchMedia('(pointer: coarse), (max-width: 767px)').matches) return;
    // QA/debug escape hatch: ?static disables Lenis so native scroll works for screenshots.
    if (new URLSearchParams(window.location.search).has('static')) return;
    const lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 3) });
    lenis.on('scroll', ScrollTrigger.update);
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    ScrollTrigger.refresh();
    // route anchor clicks through Lenis for smooth in-page jumps
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const id = a.getAttribute('href')!.slice(1);
      const el = id ? document.getElementById(id) : document.body;
      if (el) {
        e.preventDefault();
        history.pushState(null, '', id ? `#${id}` : window.location.pathname);
        lenis.scrollTo(el, { offset: -64 });
      }
    };
    document.addEventListener('click', onClick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('click', onClick);
      lenis.off('scroll', ScrollTrigger.update);
      lenis.destroy();
    };
  }, []);
  return null;
}
