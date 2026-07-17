import { useEffect, useRef, useState } from 'react';
import { NAV } from '../lib/content';

function Mark() {
  return (
    <a href="#top" className="wordmark text-chalk" aria-label="Bimax home">
      <span>Bimax</span>
      <small>CLI live</small>
    </a>
  );
}

export default function Navbar() {
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const clearHideTimer = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const hideSoon = (delay = 520) => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => setVisible(false), delay);
  };

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches;

    hideSoon(5000);

    const handlePointerMove = (event: PointerEvent) => {
      if (!finePointer) return;
      if (event.clientY <= 104) {
        clearHideTimer();
        setVisible(true);
      } else if (!document.querySelector('.site-nav:hover, .site-nav:focus-within')) {
        hideSoon();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if ((event.touches[0]?.clientY ?? 999) <= 72) {
        setVisible(true);
        hideSoon(3000);
      }
    };

    // Scrolling up brings the island back on every input type; scrolling down tucks it away.
    let lastY = window.scrollY;
    const handleScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      if (delta < -6 || y <= 8) {
        clearHideTimer();
        setVisible(true);
        hideSoon(2800);
      } else if (delta > 6 && y > 160 && !document.querySelector('.site-nav:hover, .site-nav:focus-within')) {
        clearHideTimer();
        setVisible(false);
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      clearHideTimer();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <header className={`site-header ${visible ? 'is-island-visible' : 'is-island-hidden'}`}>
      <div className="island-sensor" aria-hidden="true" />
      <nav
        className="site-nav liquid-glass liquid-glass-nav"
        aria-label="Primary navigation"
        onPointerEnter={() => {
          clearHideTimer();
          setVisible(true);
        }}
        onPointerLeave={() => hideSoon()}
        onFocus={() => {
          clearHideTimer();
          setVisible(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            hideSoon();
          }
        }}
      >
        <Mark />
        <div className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="text-sm text-mist transition-colors hover:text-chalk">
              {item.label}
            </a>
          ))}
        </div>
        <a href="#install" className="nav-action">
          Install CLI
        </a>
      </nav>
    </header>
  );
}
