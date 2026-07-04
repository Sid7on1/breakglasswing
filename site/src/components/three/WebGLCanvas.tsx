import { Suspense, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';

// Cheap one-time WebGL probe — if the context can't be created (locked-down browser, no GPU, some
// headless setups) we skip the Canvas entirely so the copy never gets blanked by a thrown renderer.
let cachedSupport: boolean | null = null;
function hasWebGL(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  try {
    const c = document.createElement('canvas');
    cachedSupport = !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

/**
 * Shared guarded R3F canvas: transparent, capped DPR, pointer-events off (scenes are scenery — they
 * must never steal clicks or scroll). All 3D on the site mounts through this one wrapper.
 */
export default function WebGLCanvas({
  children,
  className,
  camera = { position: [0, 0, 6] as [number, number, number], fov: 45 },
}: {
  children: ReactNode;
  className?: string;
  camera?: { position: [number, number, number]; fov: number };
}) {
  if (typeof window !== 'undefined' && !hasWebGL()) return null;
  return (
    <div className={className} aria-hidden style={{ pointerEvents: 'none' }}>
      <Canvas camera={camera} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>{children}</Suspense>
      </Canvas>
    </div>
  );
}
