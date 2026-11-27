"use client";

import * as React from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Conviction, Direction } from "@/lib/borel/types";
import { useSceneActivity } from "./useSceneActivity";
import { cn } from "@/lib/utils";

export interface MatrixLeg {
  readonly direction: Direction;
  readonly conviction: Conviction;
  /** Live P&L sign of the leg: true = up, false = down, null = flat. */
  readonly winning: boolean | null;
}

export interface MatrixSeat {
  readonly id: string;
  readonly label: string;
  readonly sublabel: string;
  readonly isYou: boolean;
  /** Revealed seats show their hand; sealed seats render cipher noise keyed by `seed`. */
  readonly revealed: boolean;
  readonly seed: string;
  readonly legs?: readonly MatrixLeg[];
}

const LEGS = 3;
/** Each sealed cell is a 4×4×4 voxel lattice. */
const LATTICE = 4;
const VOXELS_PER_CELL = LATTICE * LATTICE * LATTICE;
/** Revealed bars stack a 2×2 footprint: 16 layers = a 3x conviction card. */
const BAR_LAYERS = VOXELS_PER_CELL / 4;
const VOXEL = 0.056;
const LATTICE_PITCH = 0.076;
const LAYER_PITCH = 0.05;
const COL_PITCH = 0.36;
const SEAT_PITCH = 1.5;
const ROW_GAP = 2.05;
const SEALED_CENTER_Y = 0.16;
const MAX_BAR = BAR_LAYERS * LAYER_PITCH;
const CRYSTALLIZE_SECS = 1.1;

type Rgb = readonly [number, number, number];
const SEALED_DIM: Rgb = [0.11, 0.125, 0.16];
const SEALED_LIT: Rgb = [0.96, 0.62, 0.04];
const UP_RGB: Rgb = [0.063, 0.725, 0.506];
const DOWN_RGB: Rgb = [0.937, 0.267, 0.267];
const FLAT_RGB: Rgb = [0.42, 0.447, 0.502];

interface CellTarget {
  readonly signedLayers: number;
  readonly rgb: Rgb;
  readonly revealed: boolean;
  readonly seed: number;
}

interface SeatSlot {
  readonly x: number;
  readonly y: number;
}

function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) ^ Math.imul(c + 1, 0x297a2d39);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function easeOutCubic(t: number): number {
  const c = 1 - t;
  return 1 - c * c * c;
}

function buildTargets(seats: readonly MatrixSeat[]): CellTarget[] {
  const targets: CellTarget[] = [];
  for (const seat of seats) {
    for (let leg = 0; leg < LEGS; leg += 1) {
      const info = seat.legs?.[leg];
      const seed = hashString(`${seat.seed}:${leg}`);
      if (!info) {
        targets.push({ signedLayers: 0, rgb: FLAT_RGB, revealed: false, seed });
        continue;
      }
      const layers = Math.round((info.conviction / 3) * BAR_LAYERS);
      const rgb = info.winning === null ? FLAT_RGB : info.winning ? UP_RGB : DOWN_RGB;
      targets.push({
        signedLayers: info.direction === "LONG" ? layers : -layers,
        rgb,
        revealed: seat.revealed,
        seed,
      });
    }
  }
  return targets;
}

/** One row on wide hosts; two rows on narrow ones so seats stay legible. */
function layoutSeats(
  count: number,
  aspect: number,
): { slots: SeatSlot[]; halfW: number; halfH: number } {
  const cols = aspect >= 1.9 || count <= 3 ? count : Math.ceil(count / 2);
  const rows = Math.ceil(count / Math.max(1, cols));
  const slots: SeatSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? count - r * cols : cols;
    const c = i - r * cols;
    slots.push({ x: (c - (inRow - 1) / 2) * SEAT_PITCH, y: -(r - (rows - 1) / 2) * ROW_GAP });
  }
  return {
    slots,
    halfW: (cols * SEAT_PITCH) / 2,
    halfH: ((rows - 1) * ROW_GAP) / 2 + MAX_BAR + 0.45,
  };
}

function VoxelField({
  slots,
  targets,
  reducedMotion,
}: {
  slots: readonly SeatSlot[];
  targets: readonly CellTarget[];
  reducedMotion: boolean;
}): React.JSX.Element | null {
  const capacity = targets.length * VOXELS_PER_CELL;
  const meshRef = React.useRef<THREE.InstancedMesh | null>(null);
  const [geometry] = React.useState(() => new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL));
  const [material] = React.useState(
    () => new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 }),
  );
  React.useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const sim = React.useMemo(
    () => ({
      progress: new Float32Array(targets.length),
      dummy: new THREE.Object3D(),
      color: new THREE.Color(),
      sealedPos: new THREE.Vector3(),
      barPos: new THREE.Vector3(),
    }),
    [targets.length],
  );

  const attach = React.useCallback(
    (mesh: THREE.InstancedMesh | null) => {
      meshRef.current = mesh;
      if (!mesh) return;
      const c = new THREE.Color().setRGB(...SEALED_DIM, THREE.SRGBColorSpace);
      for (let i = 0; i < capacity; i += 1) mesh.setColorAt(i, c);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    [capacity],
  );

  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const time = clock.elapsedTime;
    // Cipher noise re-keys at ~8 Hz: lit voxels are a hash of (seat seed, voxel, epoch).
    const epoch = reducedMotion ? 0 : Math.floor(time * 8);

    for (let cell = 0; cell < targets.length; cell += 1) {
      const target = targets[cell]!;
      const seat = Math.floor(cell / LEGS);
      const leg = cell % LEGS;
      const slot = slots[seat];
      if (!slot) continue;
      const goal = target.revealed ? 1 : 0;
      const current = sim.progress[cell] ?? 0;
      let next = goal;
      if (!reducedMotion && current !== goal) {
        const step = delta / CRYSTALLIZE_SECS;
        next =
          goal > current ? Math.min(goal, current + step) : Math.max(goal, current - step * 1.6);
      }
      sim.progress[cell] = next;

      const ox = slot.x + (leg - (LEGS - 1) / 2) * COL_PITCH;
      const oy = slot.y;
      const layers = Math.abs(target.signedLayers);
      const dir = target.signedLayers >= 0 ? 1 : -1;
      const breathe = reducedMotion ? 0 : Math.sin(time * 1.6 + seat * 0.9 + leg * 0.5) * 0.01;

      for (let v = 0; v < VOXELS_PER_CELL; v += 1) {
        const index = cell * VOXELS_PER_CELL + v;
        const lx = v % LATTICE;
        const ly = Math.floor(v / LATTICE) % LATTICE;
        const lz = Math.floor(v / (LATTICE * LATTICE));
        const h = hash3(target.seed, v, epoch);
        const lit = h > 0.76;

        sim.sealedPos.set(
          ox + (lx - 1.5) * LATTICE_PITCH,
          oy + SEALED_CENTER_Y + (ly - 1.5) * LATTICE_PITCH + breathe,
          (lz - 1.5) * LATTICE_PITCH,
        );
        const layer = Math.floor(v / 4);
        const quad = v % 4;
        const inBar = layer < layers;
        sim.barPos.set(
          ox + ((quad % 2) - 0.5) * LATTICE_PITCH,
          oy + dir * (layer * LAYER_PITCH + LAYER_PITCH * 0.5),
          (Math.floor(quad / 2) - 0.5) * LATTICE_PITCH,
        );

        // Lower layers settle first so each bar grows out of its baseline.
        const local = Math.max(0, Math.min(1, next * 1.7 - (layer / BAR_LAYERS) * 0.7));
        const t = easeOutCubic(local);
        sim.dummy.position.lerpVectors(sim.sealedPos, sim.barPos, t);
        if (!inBar) sim.dummy.position.y = THREE.MathUtils.lerp(sim.dummy.position.y, oy, t);

        // Revealed voxels fuse into solid bars with hairline layer seams.
        const sealedScale = lit ? 1 : 0.62;
        const spread = THREE.MathUtils.lerp(sealedScale, inBar ? 1.34 : 0, t);
        const rise = THREE.MathUtils.lerp(sealedScale, inBar ? 0.84 : 0, t);
        sim.dummy.scale.set(spread, rise, spread);
        sim.dummy.updateMatrix();
        mesh.setMatrixAt(index, sim.dummy.matrix);

        const sealedRgb = lit ? SEALED_LIT : SEALED_DIM;
        const gain = lit ? 0.42 + h * 0.3 : 1;
        mesh.setColorAt(
          index,
          sim.color.setRGB(
            THREE.MathUtils.lerp(sealedRgb[0] * gain, target.rgb[0], t),
            THREE.MathUtils.lerp(sealedRgb[1] * gain, target.rgb[1], t),
            THREE.MathUtils.lerp(sealedRgb[2] * gain, target.rgb[2], t),
            THREE.SRGBColorSpace,
          ),
        );
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (capacity === 0) return null;
  return (
    <instancedMesh
      key={capacity}
      ref={attach}
      args={[geometry, material, capacity]}
      frustumCulled={false}
    />
  );
}

function Baselines({ slots }: { slots: readonly SeatSlot[] }): React.JSX.Element {
  const lines = React.useMemo(() => {
    const points: THREE.Vector3[] = [];
    const half = (LEGS / 2) * COL_PITCH;
    for (const slot of slots) {
      points.push(
        new THREE.Vector3(slot.x - half, slot.y, 0),
        new THREE.Vector3(slot.x + half, slot.y, 0),
      );
    }
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: "#303642" }),
    );
  }, [slots]);
  React.useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
    [lines],
  );
  return <primitive object={lines} />;
}

function MatrixScene({
  seats,
  reducedMotion,
  labelRefs,
}: {
  seats: readonly MatrixSeat[];
  reducedMotion: boolean;
  labelRefs: React.RefObject<(HTMLSpanElement | null)[]>;
}): React.JSX.Element {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const layout = React.useMemo(() => layoutSeats(seats.length, aspect), [seats.length, aspect]);
  const targets = React.useMemo(() => buildTargets(seats), [seats]);
  const groupRef = React.useRef<THREE.Group | null>(null);
  const scratch = React.useMemo(() => new THREE.Vector3(), []);

  React.useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(
      (layout.halfW + 0.3) / (tanV * aspect),
      (layout.halfH + 0.2) / tanV,
    );
    camera.position.set(0, distance * 0.2, distance);
    camera.lookAt(0, -0.1, 0);
    camera.updateProjectionMatrix();
  }, [camera, layout, aspect]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    group.rotation.y = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.16) * 0.05;
    group.updateMatrixWorld();
    layout.slots.forEach((slot, i) => {
      const el = labelRefs.current[i];
      if (!el) return;
      scratch
        .set(slot.x, slot.y - MAX_BAR - 0.12, 0)
        .applyMatrix4(group.matrixWorld)
        .project(camera);
      const x = (scratch.x * 0.5 + 0.5) * size.width;
      const y = (-scratch.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, 0)`;
      el.style.opacity = "1";
    });
  });

  return (
    <group ref={groupRef}>
      <Baselines slots={layout.slots} />
      <VoxelField slots={layout.slots} targets={targets} reducedMotion={reducedMotion} />
    </group>
  );
}

const LABEL_CLASS =
  "pointer-events-none absolute left-0 top-0 flex select-none flex-col items-center whitespace-nowrap font-mono text-[10px] leading-tight tabular-nums opacity-0 [font-variant-numeric:tabular-nums_slashed-zero]";

/** Instanced voxel table: sealed seats render cipher lattices that crystallise into conviction bars on reveal. */
export default function EnclaveStateMatrix({
  seats,
}: {
  seats: readonly MatrixSeat[];
}): React.JSX.Element {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const labelRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const { active, reducedMotion } = useSceneActivity(hostRef);

  return (
    <div ref={hostRef} className="absolute inset-0" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        frameloop={active ? "always" : "never"}
        camera={{ position: [0, 2, 9], fov: 30, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={["#0a0d14"]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 6, 4]} intensity={1.6} />
        <directionalLight position={[-4, 2, -3]} intensity={0.35} />
        <MatrixScene seats={seats} reducedMotion={reducedMotion} labelRefs={labelRefs} />
      </Canvas>
      {seats.map((seat, i) => (
        <span
          key={seat.id}
          ref={(el) => {
            labelRefs.current[i] = el;
          }}
          className={LABEL_CLASS}
        >
          <span className={seat.isYou ? "text-[#f3f4f6]" : "text-[#9ca3af]"}>{seat.label}</span>
          <span className={cn(seat.revealed ? "text-[#6b7280]" : "text-[#fbbf24]/80")}>
            {seat.sublabel}
          </span>
        </span>
      ))}
    </div>
  );
}
