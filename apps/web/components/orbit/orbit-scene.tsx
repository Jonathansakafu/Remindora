'use client';
import { Stars } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import { Vector3, type Group, type Mesh } from 'three';
import type { OrbitMetric } from './orbit-summary';

function DaySphere({ progress }: { progress: number }) {
  const shell = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (shell.current) shell.current.rotation.y += dt * 0.08;
    if (core.current) {
      const target = 0.35 + progress * 0.55;
      const s = core.current.scale.x + (target - core.current.scale.x) * Math.min(1, dt * 3);
      core.current.scale.setScalar(s);
    }
  });
  return (
    <group>
      <mesh ref={shell}>
        <sphereGeometry args={[1.25, 48, 48]} />
        <meshPhysicalMaterial color="#9DEFFF" transparent opacity={0.16} roughness={0.15} metalness={0.1} clearcoat={1} transmission={0.6} thickness={0.6} />
      </mesh>
      <mesh ref={core} scale={0.35}>
        <sphereGeometry args={[1.25, 32, 32]} />
        <meshStandardMaterial color="#60E9FF" emissive="#3fa9ff" emissiveIntensity={0.9} transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[Math.PI / 2.4, 0.3, 0]}>
        <torusGeometry args={[2.35, 0.012, 8, 160]} />
        <meshBasicMaterial color="#A58CFF" transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

const scratch = new Vector3();

/**
 * Orbiting node. Its label is a normal DOM button owned by the parent overlay;
 * each frame we project the node to screen space and move the label there
 * (no DOM is created inside the WebGL tree).
 */
function OrbitNode({ metric, index, total, label }: { metric: OrbitMetric; index: number; total: number; label: RefObject<HTMLElement | null> }) {
  const ref = useRef<Group>(null);
  const phase = (index / total) * Math.PI * 2;
  useFrame(({ clock, camera, size }) => {
    const t = clock.getElapsedTime() * 0.18 + phase;
    if (!ref.current) return;
    ref.current.position.set(Math.cos(t) * 2.35, Math.sin(t) * 0.55, Math.sin(t) * 1.2);
    const el = label.current;
    if (el) {
      scratch.copy(ref.current.position).project(camera);
      const x = (scratch.x * 0.5 + 0.5) * size.width;
      const y = (-scratch.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(-50%, calc(-100% - 14px)) translate(${x}px, ${y}px)`;
      el.style.opacity = scratch.z < 1 ? '1' : '0';
    }
  });
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[0.16 + metric.value * 0.12, 24, 24]} />
        <meshStandardMaterial color={metric.color} emissive={metric.color} emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

export default function OrbitScene({ metrics, progress, paused, labels }: { metrics: OrbitMetric[]; progress: number; paused: boolean; labels: Array<RefObject<HTMLElement | null>> }) {
  const dpr = useMemo<[number, number]>(() => [1, Math.min(1.75, typeof window !== 'undefined' ? window.devicePixelRatio : 1)], []);
  return (
    <Canvas dpr={dpr} frameloop={paused ? 'never' : 'always'} camera={{ position: [0, 0.5, 7.4], fov: 42 }} gl={{ antialias: true, powerPreference: 'low-power', alpha: true }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[4, 4, 4]} intensity={30} color="#9DEFFF" />
      <pointLight position={[-5, -2, -3]} intensity={18} color="#A58CFF" />
      <Stars radius={40} depth={20} count={700} factor={2} saturation={0} fade speed={0.4} />
      <DaySphere progress={progress} />
      {metrics.map((m, i) => (
        <OrbitNode key={m.label} metric={m} index={i} total={metrics.length} label={labels[i]!} />
      ))}
    </Canvas>
  );
}
