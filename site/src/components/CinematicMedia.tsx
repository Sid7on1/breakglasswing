import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type CinematicMediaProps = {
  videoSrc: string;
  desktopPoster: string;
  mobilePoster?: string;
  alt: string;
  className?: string;
  eager?: boolean;
  objectPosition?: string;
  scrollScrub?: boolean;
  scrollRoot?: string;
};

export default function CinematicMedia({
  videoSrc,
  desktopPoster,
  mobilePoster,
  alt,
  className = '',
  eager = false,
  objectPosition = 'center',
  scrollScrub = false,
  scrollRoot,
}: CinematicMediaProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [hasEntered, setHasEntered] = useState(eager);
  const [isVisible, setIsVisible] = useState(eager);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    const wide = window.matchMedia('(min-width: 768px)');
    // Phones get the poster only: no ambient-video download on small screens or metered connections.
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const update = () => setMotionAllowed(motion.matches && wide.matches && !saveData);

    update();
    motion.addEventListener('change', update);
    wide.addEventListener('change', update);
    return () => {
      motion.removeEventListener('change', update);
      wide.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
        if (entry.isIntersecting) setHasEntered(true);
      },
      { rootMargin: '2200px 0px', threshold: 0.01 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const shouldLoadVideo = motionAllowed && (eager || hasEntered);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!shouldLoadVideo) {
      video.pause();
      setIsReady(false);
      return;
    }

    video.load();
  }, [shouldLoadVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shouldLoadVideo) return;

    if (isVisible) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [isVisible, shouldLoadVideo]);

  useEffect(() => {
    const video = videoRef.current;
    const root = rootRef.current;
    if (!video || !root || !shouldLoadVideo || !scrollScrub) return undefined;
    if (!window.matchMedia('(min-width: 768px) and (pointer: fine)').matches) return undefined;

    const trigger = scrollRoot ? root.closest(scrollRoot) : root;
    if (!trigger) return undefined;
    const spatialRoot = trigger instanceof HTMLElement ? trigger : null;

    const update = (nextProgress: number) => {
      const progress = nextProgress;
      if (spatialRoot) {
        spatialRoot.style.setProperty('--journey-progress', progress.toFixed(4));
        spatialRoot.style.setProperty('--journey-scale', (1.045 + progress * 0.055).toFixed(4));
        spatialRoot.style.setProperty('--journey-shift-x', `${(-0.65 * progress).toFixed(3)}%`);
        spatialRoot.style.setProperty('--journey-shift-y', `${(-0.35 * progress).toFixed(3)}%`);
      }
    };

    const scrub = ScrollTrigger.create({
      trigger,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => update(self.progress),
      onRefresh: (self) => update(self.progress),
    });

    return () => {
      scrub.kill();
      if (spatialRoot) {
        spatialRoot.style.removeProperty('--journey-progress');
        spatialRoot.style.removeProperty('--journey-scale');
        spatialRoot.style.removeProperty('--journey-shift-x');
        spatialRoot.style.removeProperty('--journey-shift-y');
      }
    };
  }, [scrollRoot, scrollScrub, shouldLoadVideo]);

  const handleCanPlay = () => {
    const video = videoRef.current;
    setIsReady(true);

    if (!video) return;
    if (scrollScrub && window.matchMedia('(min-width: 768px) and (pointer: fine)').matches) {
      ScrollTrigger.refresh();
    }
    if (isVisible) {
      void video.play().catch(() => undefined);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`cinematic-media ${isReady ? 'is-ready' : ''} ${className}`.trim()}
      style={{ '--cinematic-position': objectPosition } as CSSProperties}
    >
      <picture className="cinematic-poster">
        {mobilePoster ? <source media="(max-width: 767px)" srcSet={mobilePoster} /> : null}
        <img
          src={desktopPoster}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      </picture>
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload={eager ? 'auto' : 'metadata'}
        poster={shouldLoadVideo ? desktopPoster : undefined}
        disablePictureInPicture
        disableRemotePlayback
        tabIndex={-1}
        aria-hidden="true"
        onCanPlay={handleCanPlay}
        onLoadedData={handleCanPlay}
        onPlaying={() => setIsReady(true)}
      >
        {shouldLoadVideo ? <source src={videoSrc} type="video/mp4" /> : null}
      </video>
    </div>
  );
}
