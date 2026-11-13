import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import type { Card, GameState, Personality, Seat } from '@poker/domain';
import { makeCardTexture } from './cardTexture';
import {
  makeChipTexture,
  makeFeltTexture,
  makeLabelTexture,
  makeWoodTexture,
} from './textures';

type Vec3 = [number, number, number];

interface PokerTableProps {
  state: GameState | null;
  personality: Personality;
  thinking: boolean;
  replayMode: boolean;
}

// 程序化贴图只生成一次。
const resourceCache = new Map<string, THREE.CanvasTexture>();
function resource(key: string, create: () => THREE.CanvasTexture): THREE.CanvasTexture {
  const cached = resourceCache.get(key);
  if (cached !== undefined) return cached;
  const texture = create();
  resourceCache.set(key, texture);
  return texture;
}

function CameraRig(): null {
  const { camera, pointer } = useThree();
  useFrame(() => {
    camera.position.x += (pointer.x * 1.15 - camera.position.x) * 0.035;
    camera.position.y += (8.6 + pointer.y * 0.4 - camera.position.y) * 0.035;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** 发牌动画：从发牌点飞到目标位，带抛物线与落牌旋转。 */
function AnimatedCard({
  card,
  faceDown,
  position,
  spawn,
  glow,
}: {
  card: Card | null;
  faceDown: boolean;
  position: Vec3;
  spawn: Vec3;
  glow: boolean;
}): React.JSX.Element {
  const group = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const texture = makeCardTexture(card, faceDown, glow);

  useEffect(() => {
    progress.current = 0;
  }, [card, faceDown, glow, position[0], position[2]]);

  useFrame((_, delta) => {
    const node = group.current;
    if (node === null) return;
    progress.current = Math.min(1, progress.current + delta * 2.3);
    const t = 1 - Math.pow(1 - progress.current, 3);
    node.position.set(
      spawn[0] + (position[0] - spawn[0]) * t,
      position[1] + Math.sin(t * Math.PI) * 0.55,
      spawn[2] + (position[2] - spawn[2]) * t,
    );
    node.rotation.set((1 - t) * 0.5, (1 - t) * 0.9, (1 - t) * 0.3);
  });

  return (
    <group ref={group} position={position}>
      {glow && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.014, 0]}>
          <planeGeometry args={[1.04, 1.38]} />
          <meshBasicMaterial color="#ffd970" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.86, 1.2]} />
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent />
      </mesh>
    </group>
  );
}

function Chip({
  color,
  y,
  texture,
}: {
  color: string;
  y: number;
  texture: THREE.CanvasTexture;
}): React.JSX.Element {
  return (
    <group position={[0, y, 0]}>
      <mesh>
        <cylinderGeometry args={[0.27, 0.27, 0.06, 32]} />
        <meshStandardMaterial color={color} roughness={0.42} metalness={0.18} />
      </mesh>
      <mesh position={[0, 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.255, 32]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </group>
  );
}

function ChipStack({
  position,
  amount,
  color,
  target,
}: {
  position: Vec3;
  amount: number;
  color: string;
  target: Vec3 | null;
}): React.JSX.Element {
  const inner = useRef<THREE.Group>(null);
  const texture = resource(`chip-${color}`, () => makeChipTexture(color));
  const count = Math.min(12, Math.max(1, Math.round(amount / 25)));
  const offset: Vec3 = target === null
    ? [0, 0, 0]
    : [target[0] - position[0], 0, target[2] - position[2]];

  useFrame((_, delta) => {
    const node = inner.current;
    if (node === null) return;
    const speed = Math.min(1, delta * 2.4);
    node.position.x += (offset[0] - node.position.x) * speed;
    node.position.z += (offset[2] - node.position.z) * speed;
  });

  return (
    <group position={position}>
      <group ref={inner}>
        {Array.from({ length: count }, (_, index) => (
          <Chip key={index} color={color} y={0.05 + index * 0.058} texture={texture} />
        ))}
      </group>
    </group>
  );
}

function TurnBeacon({
  position,
  active,
}: {
  position: Vec3;
  active: boolean;
}): React.JSX.Element {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const node = material.current;
    if (node === null) return;
    const target = active ? 0.5 + Math.sin(clock.elapsedTime * 3.2) * 0.28 : 0.07;
    node.opacity += (target - node.opacity) * 0.12;
  });
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.5, 0.62, 48]} />
      <meshBasicMaterial
        ref={material}
        color="#ffd970"
        transparent
        opacity={0.07}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function TableSurface({ heroActive, villainActive }: { heroActive: boolean; villainActive: boolean }): React.JSX.Element {
  const felt = resource('felt', makeFeltTexture);
  const wood = resource('wood', makeWoodTexture);
  return (
    <group>
      <mesh position={[0, -0.26, 0]} scale={[1.45, 1, 1]}>
        <cylinderGeometry args={[4.35, 4.28, 0.42, 72]} />
        <meshStandardMaterial map={wood} roughness={0.68} metalness={0.06} />
      </mesh>
      <mesh position={[0, -0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.45, 1, 1]}>
        <circleGeometry args={[4.12, 72]} />
        <meshStandardMaterial map={felt} roughness={1} />
      </mesh>
      <mesh position={[0, -0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.45, 1, 1]}>
        <ringGeometry args={[3.78, 3.88, 72]} />
        <meshBasicMaterial color="#c9a227" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.024, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.45, 1, 1]}>
        <ringGeometry args={[2.55, 2.58, 72]} />
        <meshBasicMaterial color="#c9a227" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <TurnBeacon position={[0, 0.002, 3.42]} active={heroActive} />
      <TurnBeacon position={[0, 0.002, -3.42]} active={villainActive} />
    </group>
  );
}

type Mood = 'idle' | 'thinking' | 'win' | 'lose';

function Opponent({
  color,
  name,
  title,
  mood,
}: {
  color: string;
  name: string;
  title: string;
  mood: Mood;
}): React.JSX.Element {
  const group = useRef<THREE.Group>(null);
  const label = resource(`label-${name}-${color}`, () => makeLabelTexture(name, title, color));
  useFrame(({ clock }) => {
    const node = group.current;
    if (node === null) return;
    const time = clock.getElapsedTime();
    const speed = mood === 'thinking' ? 3.8 : mood === 'win' ? 2.4 : 1.1;
    node.position.y = 0.72 + Math.sin(time * speed) * (mood === 'win' ? 0.075 : 0.032);
    node.rotation.z = Math.sin(time * 0.7) * 0.022;
  });
  return (
    <group>
      <group ref={group} position={[0, 0.72, -4.02]}>
        <mesh position={[0, -0.72, 0]}>
          <cylinderGeometry args={[0.56, 0.9, 0.92, 32]} />
          <meshStandardMaterial color="#1b1f28" roughness={0.9} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.42, 32, 32]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.18, -0.035]} scale={[1.06, 0.6, 1.06]}>
          <sphereGeometry args={[0.42, 24, 24]} />
          <meshStandardMaterial color="#1f242d" roughness={0.85} />
        </mesh>
        {[-0.16, 0.16].map((x) => (
          <group key={x} position={[x, 0.055, 0.36]}>
            <mesh>
              <sphereGeometry args={[0.075, 16, 16]} />
              <meshBasicMaterial color="#f4f1e8" />
            </mesh>
            <mesh position={[0, 0, 0.055]}>
              <sphereGeometry args={[0.038, 12, 12]} />
              <meshBasicMaterial color="#171a1f" />
            </mesh>
            <mesh position={[-0.018, 0.022, 0.086]}>
              <sphereGeometry args={[0.014, 8, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}
        <mesh position={[0, -0.17, 0.4]} scale={[mood === 'win' ? 1.5 : 1, mood === 'lose' ? 0.5 : 1, 1]}>
          <boxGeometry args={[0.18, 0.035, 0.02]} />
          <meshBasicMaterial color="#4a2626" />
        </mesh>
      </group>
      <mesh position={[0, 1.74, -4.28]}>
        <planeGeometry args={[2.35, 0.74]} />
        <meshBasicMaterial map={label} transparent side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function PokerTable({
  state,
  personality,
  thinking,
  replayMode,
}: PokerTableProps): React.JSX.Element {
  const board = state?.board ?? [];
  const heroCards = state?.players.hero.holeCards ?? [];
  const villainCards = state?.players.villain.holeCards ?? [];
  const result = state?.result ?? null;
  const showdown = result?.showdown === true;
  const winner: Seat | null =
    result?.winner === 'hero' || result?.winner === 'villain' ? result.winner : null;
  const pot = state?.pot ?? 0;
  const heroStack = state?.players.hero.stack ?? 0;
  const villainStack = state?.players.villain.stack ?? 0;
  const toAct = state?.toAct ?? null;

  const mood: Mood = thinking
    ? 'thinking'
    : winner === 'villain'
      ? 'win'
      : winner === 'hero'
        ? 'lose'
        : 'idle';

  const potTarget: Vec3 | null =
    winner === 'hero' ? [-2.75, 0.06, 2.2] : winner === 'villain' ? [2.75, 0.06, -2.2] : null;

  const boardSpawn: Vec3 = [0, 0.45, -1.35];
  const heroSpawn: Vec3 = [0, 0.45, 3.4];
  const villainSpawn: Vec3 = [0, 0.45, -3.4];

  return (
    <Canvas
      camera={{ position: [0, 8.6, 9.2], fov: 40 }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      dpr={[1, 1.6]}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#07100e']} />
      <ambientLight intensity={0.62} />
      <directionalLight position={[3, 9, 5]} intensity={2.2} color="#fff2d8" />
      <spotLight position={[-5, 7, 2]} intensity={26} color="#ffd9a0" angle={0.65} penumbra={0.85} distance={22} />
      <spotLight position={[5, 7, -3]} intensity={20} color="#9fd8ff" angle={0.7} penumbra={0.9} distance={22} />
      <CameraRig />

      <TableSurface heroActive={toAct === 'hero'} villainActive={toAct === 'villain'} />
      <Opponent
        color={personality.avatarColor}
        name={personality.name}
        title={personality.title}
        mood={mood}
      />

      {board.map((card, index) => (
        <AnimatedCard
          key={`board-${index}-${replayMode}`}
          card={card}
          faceDown={false}
          position={[(index - 2) * 0.94, 0.055, 0.05]}
          spawn={boardSpawn}
          glow={winner !== null && showdown && board.length === 5}
        />
      ))}

      {heroCards.map((card, index) => (
        <AnimatedCard
          key={`hero-${index}-${replayMode}`}
          card={card}
          faceDown={false}
          position={[index === 0 ? -0.48 : 0.48, 0.065, 2.66]}
          spawn={heroSpawn}
          glow={winner === 'hero' && showdown}
        />
      ))}

      {villainCards.map((card, index) => (
        <AnimatedCard
          key={`villain-${index}-${replayMode}`}
          card={card}
          faceDown={!showdown}
          position={[index === 0 ? -0.48 : 0.48, 0.065, -2.66]}
          spawn={villainSpawn}
          glow={winner === 'villain' && showdown}
        />
      ))}

      <ChipStack position={[0, 0.06, 1.3]} amount={pot} color="#d8b44a" target={potTarget} />
      <ChipStack position={[-2.75, 0.06, 2.2]} amount={heroStack} color="#4f9d78" target={null} />
      <ChipStack position={[2.75, 0.06, -2.2]} amount={villainStack} color="#b9625b" target={null} />

      <group position={[1.62, 0.06, 1.55]}>
        <mesh>
          <cylinderGeometry args={[0.19, 0.19, 0.07, 28]} />
          <meshStandardMaterial color="#f0ead8" roughness={0.35} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.037, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.1, 0.15, 28]} />
          <meshBasicMaterial color="#c9a227" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </Canvas>
  );
}
