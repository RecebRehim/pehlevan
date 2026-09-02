"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type BurstKind = "fruit" | "spark" | "dust";

export type ImpactBurstSpec = {
  id: number;
  origin: [number, number, number];
  normal: [number, number, number];
  power: number;
  kind?: BurstKind;
};

type Particle = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angular: THREE.Vector3;
  scale: number;
  color: THREE.Color;
  life: number;
  maxLife: number;
  splat: boolean;
  stretch: number;
};

const dummy = new THREE.Object3D();
const colorScratch = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeBasis(normal: THREE.Vector3) {
  const tangent = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(tangent)) > 0.8) tangent.set(0, 1, 0);
  tangent.cross(normal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return { tangent, bitangent };
}

function spawnCone(
  random: () => number,
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
  power: number,
  speedMin: number,
  speedMax: number,
  spread: number,
) {
  return normal
    .clone()
    .multiplyScalar(speedMin + random() * (speedMax - speedMin))
    .addScaledVector(tangent, (random() - 0.5) * spread)
    .addScaledVector(bitangent, (random() - 0.5) * spread)
    .multiplyScalar(power);
}

function juiceColor(random: () => number) {
  if (random() > 0.55) return new THREE.Color("#ff756f");
  if (random() > 0.4) return new THREE.Color("#e24b55");
  return new THREE.Color("#c93440");
}

function ImpactFlash({ origin, color, strength }: { origin: [number, number, number]; color: string; strength: number }) {
  const light = useRef<THREE.PointLight>(null);
  const born = useRef<number | null>(null);

  useFrame((state) => {
    if (born.current === null) born.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - born.current;
    if (light.current) {
      light.current.intensity = Math.max(0, (1 - age / 0.16) * 3.2 * strength);
    }
  });

  return <pointLight ref={light} position={origin} color={color} distance={1.15} decay={2} intensity={0} />;
}

function InstancedSpray({
  particles,
  geometry,
  material,
  gravity,
  floorY,
  bounce,
  additiveStretch,
}: {
  particles: Particle[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  gravity: number;
  floorY: number;
  bounce: number;
  additiveStretch: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const local = useRef(particles.map((particle) => ({
    position: particle.position.clone(),
    velocity: particle.velocity.clone(),
    angular: particle.angular.clone(),
    scale: particle.scale,
    color: particle.color.clone(),
    life: 0,
    maxLife: particle.maxLife,
    splat: false,
    rotation: new THREE.Euler(0, 0, 0),
  })));
  const alive = useRef(true);

  useFrame((_, delta) => {
    if (!alive.current || !mesh.current) return;
    let any = false;
    local.current.forEach((particle, index) => {
      particle.life += delta;
      const fade = clamp(1 - particle.life / particle.maxLife);
      if (fade <= 0.001) {
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.current!.setMatrixAt(index, dummy.matrix);
        return;
      }
      any = true;
      particle.velocity.y -= gravity * delta;
      particle.position.addScaledVector(particle.velocity, delta);
      if (particle.position.y < floorY) {
        particle.position.y = floorY;
        particle.velocity.y *= -bounce;
        particle.velocity.x *= 0.55;
        particle.velocity.z *= 0.55;
        particle.splat = true;
      }
      particle.rotation.x += particle.angular.x * delta;
      particle.rotation.y += particle.angular.y * delta;
      particle.rotation.z += particle.angular.z * delta;
      dummy.position.copy(particle.position);
      dummy.rotation.copy(particle.rotation);
      if (particle.splat) {
        dummy.scale.set(particle.scale * 2.4 * fade, particle.scale * 0.12 * fade, particle.scale * 2.4 * fade);
      } else if (additiveStretch) {
        const speed = particle.velocity.length();
        dummy.scale.set(particle.scale * fade, particle.scale * (1 + speed * 0.12) * fade, particle.scale * fade);
        if (particle.velocity.lengthSq() > 0.0001) {
          const dir = particle.velocity.clone().normalize().lerp(UP, 0.35).normalize();
          dummy.quaternion.setFromUnitVectors(UP, dir);
        }
      } else {
        dummy.scale.setScalar(particle.scale * fade);
      }
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(index, dummy.matrix);
      colorScratch.copy(particle.color);
      mesh.current!.setColorAt(index, colorScratch);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    if (!any) {
      alive.current = false;
      mesh.current.visible = false;
    }
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, particles.length]}
      frustumCulled={false}
      raycast={() => null}
      castShadow
    />
  );
}

function MistCloud({
  origin,
  normal,
  power,
  count,
  seed,
  color,
}: {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  power: number;
  count: number;
  seed: number;
  color: string;
}) {
  const points = useRef<THREE.Points>(null);
  const born = useRef<number | null>(null);
  const { positions, velocities, sizes } = useMemo(() => {
    const random = seededRandom(seed);
    const { tangent, bitangent } = makeBasis(normal);
    const positions = new Float32Array(count * 3);
    const velocities = Array.from({ length: count }, (_, index) => {
      const velocity = spawnCone(random, normal, tangent, bitangent, power, 0.55, 1.8, 1.35);
      positions[index * 3] = origin.x + (random() - 0.5) * 0.04;
      positions[index * 3 + 1] = origin.y + (random() - 0.5) * 0.04;
      positions[index * 3 + 2] = origin.z + (random() - 0.5) * 0.04;
      return velocity;
    });
    const sizes = Float32Array.from({ length: count }, () => 0.035 + random() * 0.08);
    return { positions, velocities, sizes };
  }, [count, normal, origin, power, seed]);

  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    next.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    return next;
  }, [positions, sizes]);

  useFrame((state, delta) => {
    if (!points.current) return;
    if (born.current === null) born.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - born.current;
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < count; i += 1) {
      const velocity = velocities[i];
      attr.array[i * 3] += velocity.x * delta;
      attr.array[i * 3 + 1] += velocity.y * delta - delta * 0.55;
      attr.array[i * 3 + 2] += velocity.z * delta;
      velocity.multiplyScalar(0.985);
    }
    attr.needsUpdate = true;
    const material = points.current.material as THREE.PointsMaterial;
    material.opacity = clamp(1 - age / 0.55) * 0.72;
    material.size = 0.09 + (1 - clamp(age / 0.55)) * 0.08;
    if (age > 0.58) points.current.visible = false;
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false} raycast={() => null}>
      <pointsMaterial
        color={color}
        size={0.12}
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

function buildFruitParticles(spec: ImpactBurstSpec, reducedMotion: boolean) {
  const random = seededRandom(spec.id * 991 + 17);
  const normal = new THREE.Vector3(...spec.normal).normalize();
  const { tangent, bitangent } = makeBasis(normal);
  const juiceCount = reducedMotion ? 12 : 36;
  const juice = Array.from({ length: juiceCount }, (): Particle => ({
    position: new THREE.Vector3((random() - 0.5) * 0.04, (random() - 0.5) * 0.04, (random() - 0.5) * 0.04),
    velocity: spawnCone(random, normal, tangent, bitangent, spec.power, 0.9, 2.4, 1.4),
    angular: new THREE.Vector3((random() - 0.5) * 14, (random() - 0.5) * 14, (random() - 0.5) * 14),
    scale: 0.01 + random() * 0.018,
    color: juiceColor(random),
    life: 0,
    maxLife: 0.55 + random() * 0.28,
    splat: false,
    stretch: 1,
  }));
  return { juice, rind: [] as Particle[], normal };
}

function buildSparkParticles(spec: ImpactBurstSpec, reducedMotion: boolean) {
  const random = seededRandom(spec.id * 733 + 9);
  const normal = new THREE.Vector3(...spec.normal).normalize();
  const { tangent, bitangent } = makeBasis(normal);
  const count = reducedMotion ? 10 : 28;
  return Array.from({ length: count }, (): Particle => ({
    position: new THREE.Vector3((random() - 0.5) * 0.04, (random() - 0.5) * 0.04, (random() - 0.5) * 0.04),
    velocity: spawnCone(random, normal, tangent, bitangent, spec.power, 1.6, 4.8, 2.6),
    angular: new THREE.Vector3(random() * 18, random() * 18, random() * 18),
    scale: 0.008 + random() * 0.016,
    color: new THREE.Color(random() > 0.4 ? "#fff4a8" : "#ffb347"),
    life: 0,
    maxLife: 0.28 + random() * 0.22,
    splat: false,
    stretch: 1,
  }));
}

function buildDustParticles(spec: ImpactBurstSpec, reducedMotion: boolean) {
  const random = seededRandom(spec.id * 419 + 3);
  const normal = new THREE.Vector3(...spec.normal).normalize();
  const { tangent, bitangent } = makeBasis(normal);
  const count = reducedMotion ? 12 : 36;
  return Array.from({ length: count }, (): Particle => ({
    position: new THREE.Vector3((random() - 0.5) * 0.18, random() * 0.04, (random() - 0.5) * 0.18),
    velocity: spawnCone(random, normal, tangent, bitangent, spec.power, 0.4, 1.6, 1.8),
    angular: new THREE.Vector3(random() * 6, random() * 6, random() * 6),
    scale: 0.018 + random() * 0.04,
    color: new THREE.Color(random() > 0.5 ? "#8a6a4a" : "#c4a078"),
    life: 0,
    maxLife: 0.85 + random() * 0.5,
    splat: false,
    stretch: 1,
  }));
}

const juiceGeometry = new THREE.SphereGeometry(1, 8, 8);
const rindGeometry = new THREE.DodecahedronGeometry(1, 0);
const sparkGeometry = new THREE.OctahedronGeometry(1, 0);
const dustGeometry = new THREE.BoxGeometry(1, 1, 1);

const juiceMaterial = new THREE.MeshPhysicalMaterial({
  roughness: 0.28,
  metalness: 0,
  clearcoat: 0.45,
  vertexColors: true,
});
const rindMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.62,
  vertexColors: true,
});
const sparkMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const dustMaterial = new THREE.MeshStandardMaterial({
  roughness: 1,
  vertexColors: true,
});

export function ImpactBurst({
  burst,
  reducedMotion,
  floorY = -1.12,
}: {
  burst: ImpactBurstSpec;
  reducedMotion: boolean;
  floorY?: number;
}) {
  const kind = burst.kind ?? "fruit";
  const origin = useMemo(() => new THREE.Vector3(...burst.origin), [burst.origin]);
  const normal = useMemo(() => new THREE.Vector3(...burst.normal).normalize(), [burst.normal]);
  const fruit = useMemo(
    () => (kind === "fruit" ? buildFruitParticles(burst, reducedMotion) : null),
    [burst, kind, reducedMotion],
  );
  const sparks = useMemo(
    () => (kind === "spark" ? buildSparkParticles(burst, reducedMotion) : null),
    [burst, kind, reducedMotion],
  );
  const dust = useMemo(
    () => (kind === "dust" ? buildDustParticles(burst, reducedMotion) : null),
    [burst, kind, reducedMotion],
  );
  const localFloor = floorY - origin.y;

  return (
    <group position={burst.origin} raycast={() => null}>
      {kind === "spark" && sparks && (
        <>
          <ImpactFlash origin={[0, 0, 0]} color="#ffe566" strength={burst.power} />
          <InstancedSpray
            particles={sparks}
            geometry={sparkGeometry}
            material={sparkMaterial}
            gravity={reducedMotion ? 2.4 : 6.5}
            floorY={localFloor}
            bounce={0.05}
            additiveStretch
          />
          {!reducedMotion && (
            <MistCloud origin={new THREE.Vector3()} normal={normal} power={burst.power * 1.2} count={18} seed={burst.id} color="#fff1a8" />
          )}
        </>
      )}
      {kind === "dust" && dust && (
        <>
          <InstancedSpray
            particles={dust}
            geometry={dustGeometry}
            material={dustMaterial}
            gravity={reducedMotion ? 1.8 : 4.2}
            floorY={0.02}
            bounce={0.12}
            additiveStretch={false}
          />
          {!reducedMotion && (
            <MistCloud origin={new THREE.Vector3()} normal={normal} power={burst.power * 0.7} count={22} seed={burst.id} color="#d2b48c" />
          )}
        </>
      )}
      {kind === "fruit" && fruit && (
        <>
          <ImpactFlash origin={[0, 0, 0]} color="#ff6a5a" strength={burst.power} />
          <InstancedSpray
            particles={fruit.juice}
            geometry={juiceGeometry}
            material={juiceMaterial}
            gravity={reducedMotion ? 4.2 : 9.4}
            floorY={localFloor}
            bounce={0.16}
            additiveStretch
          />
          {fruit.rind.length > 0 && (
            <InstancedSpray
              particles={fruit.rind}
              geometry={rindGeometry}
              material={rindMaterial}
              gravity={reducedMotion ? 3.4 : 7.8}
              floorY={localFloor}
              bounce={0.28}
              additiveStretch={false}
            />
          )}
          {!reducedMotion && (
            <MistCloud origin={new THREE.Vector3()} normal={fruit.normal} power={burst.power} count={36} seed={burst.id + 4} color="#ff8a8a" />
          )}
        </>
      )}
    </group>
  );
}
