import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Icosahedron, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';

// The 3D centerpiece: a slowly auto-rotating, gently distorting glass orb behind the headline.
// A faint wireframe shell wraps a dark transmissive core; the whole group eases toward the pointer
// for parallax. Pointer-events are off so it never steals clicks from the hero copy.
function Orb() {
  const group = useRef<THREE.Group>(null);
  const target = useRef({ x: 0, y: 0 });

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    // pointer parallax (state.pointer is -1..1)
    target.current.x = state.pointer.y * 0.25;
    target.current.y = state.pointer.x * 0.4;
    g.rotation.x += (target.current.x - g.rotation.x) * 0.04;
    g.rotation.y += (target.current.y - g.rotation.y) * 0.04 + delta * 0.08;
  });

  return (
    <group ref={group}>
      {/* dark, softly distorting glass core with an emerald cast */}
      <Icosahedron args={[1.55, 14]}>
        <MeshDistortMaterial
          color="#0a1414"
          emissive="#0e3a2a"
          emissiveIntensity={0.4}
          roughness={0.12}
          metalness={0.7}
          distort={0.3}
          speed={1.3}
        />
      </Icosahedron>
      {/* faint faceted wireframe shell */}
      <Icosahedron args={[1.72, 2]}>
        <meshBasicMaterial color="#34d399" wireframe transparent opacity={0.14} />
      </Icosahedron>
    </group>
  );
}

// Cheap one-time WebGL probe — if the context can't be created (locked-down browser, no GPU, some
// headless setups) we skip the Canvas entirely so the hero copy never gets blanked by a thrown
// renderer. Real browsers with WebGL get the full orb.
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

export default function HeroOrb({ className }: { className?: string }) {
  if (typeof window !== 'undefined' && !hasWebGL()) return null;
  return (
    <div className={className} aria-hidden style={{ pointerEvents: 'none' }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={60} color="#cfe0ff" />
        <pointLight position={[-6, -3, -2]} intensity={30} color="#5b7cff" />
        <Suspense fallback={null}>
          <Orb />
        </Suspense>
      </Canvas>
    </div>
  );
}
