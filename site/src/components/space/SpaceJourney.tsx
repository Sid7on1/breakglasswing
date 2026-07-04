import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Stars, Sparkles, Torus, Icosahedron, Octahedron } from '@react-three/drei';
import * as THREE from 'three';
import WebGLCanvas from '../three/WebGLCanvas';

// The whole site is ONE 3D world. A fixed canvas renders four scenes strung along -Z
// (planet → constellation → orbital station → launch nebula); page scroll flies the camera
// between them. Fog hides the next scene until the camera approaches — each section is a reveal.
// Everything is procedural: no fetched models, no HDRIs, instant load, works offline.

const VIOLET = '#8b5cf6';
const CYAN = '#67e8f9';
const INDIGO = '#6366f1';

// One camera station per DOM section, in section order. `look` is what the camera faces.
const STATIONS: { pos: [number, number, number]; look: [number, number, number] }[] = [
  { pos: [2.6, 0.7, 6.5], look: [0, 0, 0] },        // mission — the home planet
  { pos: [1.6, 1.0, -21], look: [0, 0.6, -30] },     // atlas — the constellation graph
  { pos: [-2.2, 0.6, -51], look: [0, 0, -60] },      // crew — the orbital station
  // Launch: look at empty space at the same depth as the nebula (which sits at x≈2.6, y≈-1.1) —
  // lookAt CENTERS its target, so aiming at the void places the planet at the right edge.
  { pos: [-0.6, 1.0, -79], look: [-0.6, 0.3, -92] },
];

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Flies the camera along the stations from normalized scroll progress (0..1), with damping. */
function CameraRig({ progress }: { progress: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  const targetPos = useMemo(() => new THREE.Vector3(), []);
  const targetLook = useMemo(() => new THREE.Vector3(), []);
  const currentLook = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const p = THREE.MathUtils.clamp(progress.current, 0, 1) * (STATIONS.length - 1);
    const i = Math.min(Math.floor(p), STATIONS.length - 2);
    const t = smooth(p - i);

    targetPos.lerpVectors(a.set(...STATIONS[i].pos), b.set(...STATIONS[i + 1].pos), t);
    targetLook.lerpVectors(a.set(...STATIONS[i].look), b.set(...STATIONS[i + 1].look), t);
    // Subtle pointer parallax on top of the path so the world feels held, not on rails.
    targetPos.x += state.pointer.x * 0.35;
    targetPos.y += state.pointer.y * 0.2;

    camera.position.lerp(targetPos, 0.06);
    currentLook.lerp(targetLook, 0.06);
    camera.lookAt(currentLook);
  });
  return null;
}

/** Scene 1 (z=0): the ringed home planet. */
function HomePlanet() {
  const planet = useRef<THREE.Mesh>(null);
  const rings = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (planet.current) planet.current.rotation.y += delta * 0.06;
    if (rings.current) rings.current.rotation.z += delta * 0.02;
  });
  return (
    <group>
      <mesh ref={planet}>
        <sphereGeometry args={[1.9, 64, 64]} />
        <meshStandardMaterial color="#0b0b2e" emissive="#3b1a8f" emissiveIntensity={0.5} roughness={0.35} metalness={0.4} />
      </mesh>
      {/* atmosphere shell */}
      <mesh>
        <sphereGeometry args={[2.02, 32, 32]} />
        <meshBasicMaterial color={VIOLET} transparent opacity={0.1} side={THREE.BackSide} />
      </mesh>
      {/* ring plane */}
      <mesh ref={rings} rotation={[1.35, 0, 0.35]}>
        <ringGeometry args={[2.6, 3.9, 96]} />
        <meshBasicMaterial color={VIOLET} transparent opacity={0.28} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[1.35, 0, 0.35]}>
        <ringGeometry args={[4.05, 4.18, 96]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.18} side={THREE.DoubleSide} />
      </mesh>
      <Sparkles count={60} scale={9} size={2} speed={0.2} opacity={0.5} color={CYAN} />
      <pointLight position={[6, 3, 4]} intensity={70} color="#cfe0ff" />
      <pointLight position={[-5, -2, 2]} intensity={26} color={VIOLET} />
    </group>
  );
}

// Tiny seeded PRNG so the constellation is identical every load.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scene 2 (z=-30): the code atlas — clustered constellation of symbol-stars. */
function Constellation() {
  const group = useRef<THREE.Group>(null);
  const { positions, colors, edges } = useMemo(() => {
    const rand = rng(2026);
    const palette = [new THREE.Color('#ffffff'), new THREE.Color(CYAN), new THREE.Color(VIOLET), new THREE.Color('#c4b5fd')];
    const centers = Array.from({ length: 6 }, (_, c) => {
      const ang = (c / 6) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(ang) * 2.8, (rand() - 0.5) * 2, Math.sin(ang) * 2.8);
    });
    const nodes: THREE.Vector3[] = [];
    const pos: number[] = [], col: number[] = [], edg: number[] = [];
    centers.forEach((center) => {
      for (let i = 0; i < 20; i++) {
        const p = center.clone().add(new THREE.Vector3((rand() - 0.5) * 1.9, (rand() - 0.5) * 1.9, (rand() - 0.5) * 1.9));
        nodes.push(p);
        pos.push(p.x, p.y, p.z);
        const c = palette[Math.floor(rand() * palette.length)];
        col.push(c.r, c.g, c.b);
      }
    });
    for (let c = 0; c < 6; c++) {
      const base = c * 20;
      for (let i = 0; i < 20; i++) {
        const j = base + Math.floor(rand() * 20);
        if (j !== base + i) edg.push(nodes[base + i].x, nodes[base + i].y, nodes[base + i].z, nodes[j].x, nodes[j].y, nodes[j].z);
      }
      const next = ((c + 1) % 6) * 20 + Math.floor(rand() * 20);
      const from = base + Math.floor(rand() * 20);
      edg.push(nodes[from].x, nodes[from].y, nodes[from].z, nodes[next].x, nodes[next].y, nodes[next].z);
    }
    return { positions: new Float32Array(pos), colors: new Float32Array(col), edges: new Float32Array(edg) };
  }, []);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.05;
  });

  return (
    <group ref={group} position={[0, 0.6, -30]}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial vertexColors size={0.1} sizeAttenuation transparent opacity={0.95} depthWrite={false} />
      </points>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[edges, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={VIOLET} transparent opacity={0.16} depthWrite={false} />
      </lineSegments>
      <pointLight position={[0, 2, 3]} intensity={20} color={CYAN} />
    </group>
  );
}

/** Scene 3 (z=-60): the orbital station — gyroscope rings, glowing core, worker satellites. */
function OrbitalStation() {
  const group = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const sats = useRef<Array<THREE.Mesh | null>>([]);

  useFrame((state, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.06;
    if (ringA.current) { ringA.current.rotation.x += delta * 0.3; ringA.current.rotation.y += delta * 0.12; }
    if (ringB.current) { ringB.current.rotation.y -= delta * 0.24; ringB.current.rotation.z += delta * 0.1; }
    const t = state.clock.elapsedTime;
    for (let i = 0; i < 6; i++) {
      const m = sats.current[i];
      if (!m) continue;
      const ang = (i * Math.PI * 2) / 6 + t * (0.3 + (i % 3) * 0.07);
      const r = 2.6 + (i % 2) * 0.4;
      const tilt = (i * Math.PI) / 5;
      m.position.set(Math.cos(ang) * r, Math.sin(ang) * r * Math.sin(tilt) * 0.6, Math.sin(ang) * r * Math.cos(tilt) * 0.6);
      m.rotation.x = t + i;
    }
  });

  return (
    <group ref={group} position={[0, 0, -60]}>
      <Icosahedron args={[1.0, 4]}>
        <meshStandardMaterial color="#0b0b2e" emissive={INDIGO} emissiveIntensity={0.45} roughness={0.2} metalness={0.6} />
      </Icosahedron>
      {/* faceted wireframe shell so the core reads as a machine, not a flat ball */}
      <Icosahedron args={[1.12, 2]}>
        <meshBasicMaterial color={CYAN} wireframe transparent opacity={0.16} />
      </Icosahedron>
      <Torus ref={ringA} args={[1.9, 0.016, 12, 120]} rotation={[Math.PI / 2.4, 0, 0]}>
        <meshStandardMaterial color={VIOLET} emissive={VIOLET} emissiveIntensity={1.6} transparent opacity={0.85} />
      </Torus>
      <Torus ref={ringB} args={[2.25, 0.011, 12, 120]} rotation={[0, Math.PI / 2.8, Math.PI / 5]}>
        <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={1.1} transparent opacity={0.5} />
      </Torus>
      {Array.from({ length: 6 }, (_, i) => (
        <Octahedron key={i} ref={(el) => { sats.current[i] = el; }} args={[0.07, 0]}>
          <meshStandardMaterial color={i % 2 ? CYAN : VIOLET} emissive={i % 2 ? CYAN : VIOLET} emissiveIntensity={1.5} />
        </Octahedron>
      ))}
      <Sparkles count={50} scale={7} size={1.8} speed={0.25} opacity={0.45} color={VIOLET} />
      <pointLight position={[4, 3, 3]} intensity={40} color="#cfe0ff" />
    </group>
  );
}

/** Scene 4 (z=-92): the launch nebula — a glowing gate the journey ends inside. */
function LaunchNebula() {
  const core = useRef<THREE.Mesh>(null);
  useFrame((state, delta) => {
    if (!core.current) return;
    core.current.rotation.y += delta * 0.05;
    const s = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.03;
    core.current.scale.setScalar(s);
  });
  return (
    // Off-center and below the eyeline: the CTA copy sits center-screen, so the nebula planet
    // peeks from behind-right instead of glowing straight through the text.
    <group position={[2.6, -1.1, -92]}>
      <mesh ref={core}>
        <sphereGeometry args={[1.6, 48, 48]} />
        <meshStandardMaterial color="#12082e" emissive={VIOLET} emissiveIntensity={0.45} roughness={0.35} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.78, 32, 32]} />
        <meshBasicMaterial color={VIOLET} transparent opacity={0.12} side={THREE.BackSide} />
      </mesh>
      <mesh rotation={[1.2, 0.2, 0]}>
        <ringGeometry args={[2.3, 2.42, 96]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <Sparkles count={140} scale={12} size={2.4} speed={0.35} opacity={0.55} color={VIOLET} />
      <Sparkles count={60} scale={14} size={1.6} speed={0.2} opacity={0.35} color={CYAN} />
      <pointLight position={[0, 0, 4]} intensity={60} color={VIOLET} />
      <pointLight position={[3, 2, -2]} intensity={30} color={CYAN} />
    </group>
  );
}

function World() {
  const progress = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.current = max > 0 ? window.scrollY / max : 0;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  return (
    <>
      {/* Fog reveals each scene only as the camera nears it — the journey's curtain. */}
      <fog attach="fog" args={['#040412', 8, 44]} />
      <ambientLight intensity={0.35} />
      <Stars radius={130} depth={90} count={6500} factor={3.2} saturation={0.4} fade speed={0.5} />
      <CameraRig progress={progress} />
      <HomePlanet />
      <Constellation />
      <OrbitalStation />
      <LaunchNebula />
    </>
  );
}

export default function SpaceJourney() {
  return (
    <WebGLCanvas className="fixed inset-0 h-full w-full" camera={{ position: [2.6, 0.7, 6.5], fov: 50 }}>
      <World />
    </WebGLCanvas>
  );
}
