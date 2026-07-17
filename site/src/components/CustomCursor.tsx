import { useEffect, useRef } from 'react';

const INTERACTIVE = 'a, button, [role="button"], summary, label, input, textarea, select';
const NATIVE_CURSOR = 'input, textarea, select, [contenteditable="true"]';

export default function CustomCursor() {
  const lensRef = useRef<HTMLSpanElement>(null);
  const coreRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!finePointer || reducedMotion) return undefined;

    const root = document.documentElement;
    const lens = lensRef.current;
    const core = coreRef.current;
    if (!lens || !core) return undefined;

    root.classList.add('has-custom-cursor');

    let targetX = -40;
    let targetY = -40;
    let lensX = targetX;
    let lensY = targetY;
    let frame = 0;

    const renderLens = () => {
      lensX += (targetX - lensX) * 0.22;
      lensY += (targetY - lensY) * 0.22;
      lens.style.transform = `translate3d(${lensX}px, ${lensY}px, 0)`;

      if (Math.abs(targetX - lensX) > 0.08 || Math.abs(targetY - lensY) > 0.08) {
        frame = window.requestAnimationFrame(renderLens);
      } else {
        frame = 0;
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      core.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
      root.classList.add('custom-cursor-visible');

      const target = event.target instanceof Element ? event.target : null;
      root.classList.toggle('custom-cursor-interactive', Boolean(target?.closest(INTERACTIVE)));
      root.classList.toggle('custom-cursor-native', Boolean(target?.closest(NATIVE_CURSOR)));

      if (!frame) frame = window.requestAnimationFrame(renderLens);
    };

    const handlePointerDown = () => root.classList.add('custom-cursor-pressed');
    const handlePointerUp = () => root.classList.remove('custom-cursor-pressed');
    const handlePointerLeave = () => root.classList.remove('custom-cursor-visible');

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    document.documentElement.addEventListener('mouseleave', handlePointerLeave);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove(
        'has-custom-cursor',
        'custom-cursor-visible',
        'custom-cursor-interactive',
        'custom-cursor-native',
        'custom-cursor-pressed',
      );
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      document.documentElement.removeEventListener('mouseleave', handlePointerLeave);
    };
  }, []);

  return (
    <div className="custom-cursor" aria-hidden="true">
      <span ref={lensRef} className="custom-cursor-lens" />
      <span ref={coreRef} className="custom-cursor-core" />
    </div>
  );
}
