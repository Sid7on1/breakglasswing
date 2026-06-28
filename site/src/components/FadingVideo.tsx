import { useEffect, useRef } from 'react';

// Looping background video with a custom rAF-driven crossfade — NO CSS transitions. The opacity is
// animated by hand so a new fade resumes from wherever the last one left off, and the loop is done
// manually (the native `loop` is OFF) so we can fade out just before the clip ends and fade back in.
const FADE_MS = 500;
const FADE_OUT_LEAD = 0.55; // seconds before `ended` to start fading out

interface FadingVideoProps {
  src: string;
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function FadingVideo({ src, poster, className, style }: FadingVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const fadeTo = (target: number, duration: number) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const start = parseFloat(video.style.opacity || '0');
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        video.style.opacity = String(start + (target - start) * p);
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const onLoadedData = () => {
      video.style.opacity = '0';
      void video.play().catch(() => {});
      fadeTo(1, FADE_MS);
    };
    const onTimeUpdate = () => {
      const remaining = video.duration - video.currentTime;
      if (!fadingOutRef.current && remaining <= FADE_OUT_LEAD && remaining > 0) {
        fadingOutRef.current = true;
        fadeTo(0, FADE_MS);
      }
    };
    const onEnded = () => {
      video.style.opacity = '0';
      setTimeout(() => {
        video.currentTime = 0;
        void video.play().catch(() => {});
        fadingOutRef.current = false;
        fadeTo(1, FADE_MS);
      }, 100);
    };

    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      autoPlay
      muted
      playsInline
      preload="auto"
      className={className}
      style={{ opacity: 0, ...style }}
    />
  );
}
