import { useEffect } from 'react';

const LIQUID_SELECTOR = '.liquid-glass';

export default function LiquidGlassSystem() {
  useEffect(() => {
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>(LIQUID_SELECTOR));
    const caustics = new Map<HTMLElement, HTMLSpanElement>();
    const rims = new Map<HTMLElement, HTMLSpanElement>();

    surfaces.forEach((surface) => {
      const rim = document.createElement('span');
      rim.className = 'liquid-rim';
      rim.setAttribute('aria-hidden', 'true');
      const caustic = document.createElement('span');
      caustic.className = 'liquid-caustic';
      caustic.setAttribute('aria-hidden', 'true');
      surface.prepend(rim);
      surface.prepend(caustic);
      rims.set(surface, rim);
      caustics.set(surface, caustic);
    });

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-liquid-visible', entry.isIntersecting);
        });
      },
      { rootMargin: '140px 0px', threshold: 0.01 },
    );
    surfaces.forEach((surface) => visibilityObserver.observe(surface));

    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!finePointer || reducedMotion) {
      return () => {
        visibilityObserver.disconnect();
        rims.forEach((rim) => rim.remove());
        caustics.forEach((caustic) => caustic.remove());
      };
    }

    let frame = 0;
    let activeSurface: HTMLElement | null = null;
    let pointerX = 0;
    let pointerY = 0;

    const render = () => {
      frame = 0;
      if (!activeSurface) return;

      const rect = activeSurface.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (pointerX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (pointerY - rect.top) / rect.height));
      activeSurface.style.setProperty('--liquid-shift-x', `${((x - 0.5) * 9).toFixed(2)}px`);
      activeSurface.style.setProperty('--liquid-shift-y', `${((y - 0.5) * 6).toFixed(2)}px`);
      activeSurface.style.setProperty('--liquid-light-x', `${(x * 100).toFixed(1)}%`);
      activeSurface.style.setProperty('--liquid-light-y', `${(y * 100).toFixed(1)}%`);
    };

    const onPointerMove = (event: PointerEvent) => {
      const nextSurface = (event.target as Element | null)?.closest<HTMLElement>(LIQUID_SELECTOR) ?? null;

      if (activeSurface !== nextSurface) {
        activeSurface?.classList.remove('is-liquid-active');
        activeSurface = nextSurface;
        activeSurface?.classList.add('is-liquid-active');
      }

      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(render);
    };

    const onPointerLeave = () => {
      activeSurface?.classList.remove('is-liquid-active');
      activeSurface = null;
    };

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      visibilityObserver.disconnect();
      rims.forEach((rim) => rim.remove());
      caustics.forEach((caustic) => caustic.remove());
    };
  }, []);

  return null;
}
