"use client";

import { ContactShadows, Preload, RoundedBox, Sparkles } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { punchCamera, cameraKick } from "./fx/cameraKick";
import { ImpactBurst, type ImpactBurstSpec } from "./fx/ImpactBurst";

export type ChallengeNumber = 1 | 2 | 3 | 4;
export type FeedbackKind = "fruit" | "metal" | "car" | "car-strain";

type ChallengeCanvasProps = {
  challenge: ChallengeNumber;
  reducedMotion: boolean;
  onProgress: (progress: number, detail?: number) => void;
  onComplete: () => void;
  onFeedback: (kind: FeedbackKind, intensity: number) => void;
  onObjectTouch: () => void;
  onReady?: () => void;
};

type Damage = {
  id: number;
  point: [number, number, number];
  normal: [number, number, number];
  radius: number;
  hits: number;
  pierced: boolean;
  broken: boolean;
};

const MAX_DAMAGE = 16;
const UNLOCK_HITS = 5;
const PIERCE_HITS = 3;
const SPLIT_MIN_HOLES = 6;
const SPLIT_BAND = 0.3;
const SPLIT_SPAN = 1;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createWatermelonTextures() {
  const width = 512;
  const height = 256;
  const colorCanvas = document.createElement("canvas");
  const bumpCanvas = document.createElement("canvas");
  colorCanvas.width = bumpCanvas.width = width;
  colorCanvas.height = bumpCanvas.height = height;

  const color = colorCanvas.getContext("2d")!;
  const bump = bumpCanvas.getContext("2d")!;
  const base = color.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#4f9c38");
  base.addColorStop(0.5, "#276f2d");
  base.addColorStop(1, "#123f21");
  color.fillStyle = base;
  color.fillRect(0, 0, width, height);
  bump.fillStyle = "#848484";
  bump.fillRect(0, 0, width, height);

  const stripeColors = ["#122f1d", "#173922", "#0c2818"];
  for (let stripe = -2; stripe < 17; stripe += 1) {
    const x = stripe * 72;
    const widthVariation = 25 + (stripe % 3) * 6;
    color.beginPath();
    bump.beginPath();
    for (let y = -30; y <= height + 30; y += 24) {
      const wave = Math.sin(y * 0.027 + stripe * 1.7) * 18 + Math.sin(y * 0.061) * 7;
      const px = x + wave;
      if (y === -30) {
        color.moveTo(px, y);
        bump.moveTo(px, y);
      } else {
        color.lineTo(px, y);
        bump.lineTo(px, y);
      }
    }
    color.strokeStyle = stripeColors[(stripe + 20) % stripeColors.length];
    color.lineWidth = widthVariation;
    color.globalAlpha = 0.72;
    color.stroke();
    bump.strokeStyle = "#5f5f5f";
    bump.lineWidth = widthVariation * 0.68;
    bump.globalAlpha = 0.68;
    bump.stroke();

    color.strokeStyle = "#86b84f";
    color.lineWidth = 3;
    color.globalAlpha = 0.28;
    color.stroke();
  }

  const random = seededRandom(731);
  color.globalAlpha = 1;
  bump.globalAlpha = 1;
  for (let i = 0; i < 720; i += 1) {
    const x = random() * width;
    const y = random() * height;
    const radius = random() * 1.3 + 0.15;
    color.fillStyle = random() > 0.5 ? "rgba(188,214,108,.18)" : "rgba(0,28,12,.2)";
    color.beginPath();
    color.arc(x, y, radius, 0, Math.PI * 2);
    color.fill();
    bump.fillStyle = random() > 0.5 ? "#a2a2a2" : "#707070";
    bump.fillRect(x, y, radius, radius);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.generateMipmaps = false;
  map.minFilter = THREE.LinearFilter;
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.generateMipmaps = false;
  bumpMap.minFilter = THREE.LinearFilter;
  return { map, bumpMap };
}

function createFleshTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(250, 90, 10, 360, 180, 470);
  gradient.addColorStop(0, "#ff756f");
  gradient.addColorStop(0.45, "#d83f49");
  gradient.addColorStop(1, "#8d1429");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const random = seededRandom(1912);
  for (let i = 0; i < 120; i += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    context.save();
    context.translate(x, y);
    context.rotate(random() * Math.PI);
    context.fillStyle = random() > 0.28 ? "#17070a" : "#6f1222";
    context.beginPath();
    context.ellipse(0, 0, 2.4 + random() * 2.4, 7 + random() * 5, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function applyDamageDiscard(material: THREE.MeshPhysicalMaterial, key: string) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.damagePoints = {
      value: Array.from({ length: MAX_DAMAGE }, () => new THREE.Vector3(99, 99, 99)),
    };
    shader.uniforms.damageNormals = {
      value: Array.from({ length: MAX_DAMAGE }, () => new THREE.Vector3(0, 1, 0)),
    };
    shader.uniforms.damageRadii = { value: Array.from({ length: MAX_DAMAGE }, () => 0) };
    shader.uniforms.damageFlags = { value: Array.from({ length: MAX_DAMAGE }, () => 0) };
    shader.uniforms.clipNormal = { value: new THREE.Vector3(0, 1, 0) };
    shader.uniforms.clipEnabled = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocalPosition;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocalPosition = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vLocalPosition;
        uniform vec3 damagePoints[16];
        uniform vec3 damageNormals[16];
        uniform float damageRadii[16];
        uniform float damageFlags[16];
        uniform vec3 clipNormal;
        uniform float clipEnabled;`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (clipEnabled > 0.5 && dot(vLocalPosition, clipNormal) > 0.02) discard;
        for (int i = 0; i < 16; i++) {
          if (damageRadii[i] <= 0.0) continue;
          if (distance(vLocalPosition, damagePoints[i]) < damageRadii[i]) discard;
          if (damageFlags[i] > 0.5) {
            float radial = length(cross(vLocalPosition, damageNormals[i]));
            if (radial < damageRadii[i] * 0.92) discard;
          }
        }`,
      );
    material.userData.shader = shader;
    const pending = material.userData.pendingDamages as Damage[] | undefined;
    if (pending) {
      writeDamageUniforms(
        shader,
        pending,
        material.userData.radiusScale ?? 1,
        material.userData.pointScale ?? 1,
        material.userData.clipNormal ?? null,
      );
    }
  };
  material.customProgramCacheKey = () => `${key}-clip`;
}

function writeDamageUniforms(
  shader: { uniforms: Record<string, { value: unknown }> },
  damages: Damage[],
  radiusScale: number,
  pointScale: number,
  clipNormal: [number, number, number] | null,
) {
  const points = shader.uniforms.damagePoints.value as THREE.Vector3[];
  const normals = shader.uniforms.damageNormals.value as THREE.Vector3[];
  const radii = shader.uniforms.damageRadii.value as number[];
  const flags = shader.uniforms.damageFlags.value as number[];
  for (let i = 0; i < MAX_DAMAGE; i += 1) {
    const damage = damages[i];
    if (damage) {
      points[i].set(damage.point[0] * pointScale, damage.point[1] * pointScale, damage.point[2] * pointScale);
      normals[i].set(damage.normal[0], damage.normal[1], damage.normal[2]).normalize();
      radii[i] = damage.radius * radiusScale;
      flags[i] = damage.pierced ? 1 : 0;
    } else {
      points[i].set(99, 99, 99);
      normals[i].set(0, 1, 0);
      radii[i] = 0;
      flags[i] = 0;
    }
  }
  if (shader.uniforms.clipEnabled) {
    shader.uniforms.clipEnabled.value = clipNormal ? 1 : 0;
    if (clipNormal) {
      (shader.uniforms.clipNormal.value as THREE.Vector3).set(clipNormal[0], clipNormal[1], clipNormal[2]).normalize();
    }
  }
}

function syncDamageUniforms(
  material: THREE.MeshPhysicalMaterial,
  damages: Damage[],
  radiusScale: number,
  pointScale = 1,
  clipNormal: [number, number, number] | null = null,
) {
  material.userData.pendingDamages = damages;
  material.userData.radiusScale = radiusScale;
  material.userData.pointScale = pointScale;
  material.userData.clipNormal = clipNormal;
  const shader = material.userData.shader as { uniforms: Record<string, { value: unknown }> } | undefined;
  if (!shader) return;
  writeDamageUniforms(shader, damages, radiusScale, pointScale, clipNormal);
}

function WatermelonShellMaterial({
  damages,
  clipNormal,
}: {
  damages: Damage[];
  clipNormal: [number, number, number] | null;
}) {
  const textures = useMemo(getWatermelonTextures, []);
  const material = useMemo(() => {
    const next = new THREE.MeshPhysicalMaterial({
      map: textures.map,
      bumpMap: textures.bumpMap,
      bumpScale: 0.035,
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.34,
      clearcoatRoughness: 0.28,
      sheen: 0.2,
      sheenColor: new THREE.Color("#89ba62"),
    });
    applyDamageDiscard(next, "watermelon-damage-v7-shell");
    return next;
  }, [textures]);

  useLayoutEffect(() => {
    syncDamageUniforms(material, damages, 1, 1, clipNormal);
  }, [clipNormal, damages, material]);

  useFrame(() => {
    syncDamageUniforms(material, damages, 1, 1, clipNormal);
  });

  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={material} attach="material" />;
}

function DamageMark({ damage }: { damage: Damage }) {
  const normal = useMemo(() => new THREE.Vector3(...damage.normal).normalize(), [damage.normal]);
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(FORWARD, normal), [normal]);
  const radius = damage.radius;
  const depth = damage.pierced ? 1.35 : 0.16 + damage.hits * 0.1;

  return (
    <group position={damage.point} quaternion={quaternion} raycast={() => null}>
      <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.98, 28]} />
        <meshStandardMaterial
          color="#d4454f"
          roughness={0.58}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
      </mesh>
      <mesh position={[0, 0, damage.pierced ? -0.55 : -depth * 0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry
          args={[
            radius * (damage.pierced ? 0.82 : 0.88),
            radius * (damage.pierced ? 0.82 : 0.5),
            depth,
            24,
            1,
            true,
          ]}
        />
        <meshPhysicalMaterial color="#d4454f" roughness={0.58} side={THREE.DoubleSide} />
      </mesh>
      {!damage.pierced && (
        <mesh position={[0, 0, -depth]}>
          <sphereGeometry args={[radius * 0.52, 16, 12]} />
          <meshStandardMaterial color="#9a2430" roughness={0.72} />
        </mesh>
      )}
    </group>
  );
}

function detectCutNormal(damages: Damage[]): THREE.Vector3 | null {
  if (damages.length < SPLIT_MIN_HOLES) return null;
  const points = damages.map((damage) => new THREE.Vector3(...damage.point).normalize());
  const mean = points.reduce((acc, point) => acc.add(point), new THREE.Vector3());
  if (mean.lengthSq() > 0.0001) mean.normalize();
  const candidates = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
  if (mean.lengthSq() > 0.2) {
    const across = new THREE.Vector3().crossVectors(mean, UP);
    if (across.lengthSq() > 0.05) {
      across.normalize();
      candidates.push(across, new THREE.Vector3().crossVectors(across, mean).normalize());
    }
  }

  let best: THREE.Vector3 | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (candidate.lengthSq() < 0.4) continue;
    const normal = candidate.normalize();
    const band = points.filter((point) => Math.abs(point.dot(normal)) < SPLIT_BAND);
    if (band.length < SPLIT_MIN_HOLES) continue;
    const tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tangent)) > 0.86) tangent.set(0, 0, 1);
    tangent.cross(normal).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    let minT = Infinity;
    let maxT = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const point of band) {
      const t = point.dot(tangent);
      const b = point.dot(bitangent);
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
      minB = Math.min(minB, b);
      maxB = Math.max(maxB, b);
    }
    const span = Math.max(maxT - minT, maxB - minB);
    if (span < SPLIT_SPAN) continue;
    const score = band.length * span;
    if (score > bestScore) {
      bestScore = score;
      best = normal.clone();
    }
  }
  return best;
}

function orientFallNormal(cut: THREE.Vector3) {
  const normal = cut.clone().normalize();
  if (normal.y < 0) normal.negate();
  if (Math.abs(normal.y) < 0.22 && normal.z < 0) normal.negate();
  return normal;
}

function isOnStaySide(point: [number, number, number], fallNormal: [number, number, number], pad = 0.08) {
  return point[0] * fallNormal[0] + point[1] * fallNormal[1] + point[2] * fallNormal[2] <= pad;
}

function FallingWatermelonHalf({
  cutNormal,
  fleshTexture,
  reducedMotion,
}: {
  cutNormal: [number, number, number];
  fleshTexture: THREE.CanvasTexture;
  reducedMotion: boolean;
}) {
  const textures = useMemo(getWatermelonTextures, []);
  const group = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  const [gone, setGone] = useState(false);
  const normal = useMemo(() => new THREE.Vector3(...cutNormal).normalize(), [cutNormal]);
  const align = useMemo(() => new THREE.Quaternion().setFromUnitVectors(UP, normal), [normal]);
  const velocity = useRef(
    new THREE.Vector3()
      .copy(normal)
      .multiplyScalar(1.15)
      .add(new THREE.Vector3(0.18, reducedMotion ? 0.12 : 1.85, 0.55)),
  );
  const spin = useRef(new THREE.Vector3(1.55, 0.35, -1.05));

  useEffect(() => {
    const timeout = window.setTimeout(() => setGone(true), 5000);
    return () => window.clearTimeout(timeout);
  }, []);

  useFrame((state, delta) => {
    if (!group.current) return;
    if (born.current === null) born.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - born.current;
    const fade = age > 4.4 ? Math.max(0, 1 - (age - 4.4) / 0.6) : 1;
    group.current.scale.setScalar(Math.max(0.001, fade));
    if (reducedMotion) {
      group.current.position.addScaledVector(normal, delta * 0.45);
      group.current.position.y = Math.max(-0.72, group.current.position.y - delta * 0.85);
      return;
    }
    velocity.current.y -= 11.8 * delta;
    group.current.position.addScaledVector(velocity.current, delta);
    group.current.rotation.x += spin.current.x * delta;
    group.current.rotation.y += spin.current.y * delta;
    group.current.rotation.z += spin.current.z * delta;
    if (group.current.position.y < -0.72) {
      group.current.position.y = -0.72;
      velocity.current.x *= 0.52;
      velocity.current.z *= 0.52;
      velocity.current.y = Math.abs(velocity.current.y) < 0.45 ? 0 : velocity.current.y * -0.16;
      spin.current.multiplyScalar(0.62);
    }
  });

  if (gone) return null;

  return (
    <group ref={group} position={[normal.x * 0.04, 0.16, 0.34 + normal.z * 0.08]} raycast={() => null}>
      <group quaternion={align}>
        <group>
          <mesh scale={[0.86, 0.9, 0.83]} castShadow>
            <sphereGeometry args={[1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial
              map={textures.map}
              bumpMap={textures.bumpMap}
              bumpScale={0.035}
              roughness={0.38}
              clearcoat={0.34}
              sheen={0.2}
              sheenColor="#89ba62"
            />
          </mesh>
          <mesh scale={[0.78, 0.82, 0.75]} castShadow>
            <sphereGeometry args={[1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial map={fleshTexture} color="#e04752" roughness={0.56} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.86, 0.83, 1]}>
            <circleGeometry args={[0.91, 48]} />
            <meshPhysicalMaterial map={fleshTexture} color="#d4454f" roughness={0.5} side={THREE.DoubleSide} />
          </mesh>
          {normal.y > 0.4 && (
            <mesh position={[0, 0.93, 0]} rotation={[0.08, 0, -0.22]} castShadow>
              <cylinderGeometry args={[0.045, 0.075, 0.23, 12]} />
              <meshStandardMaterial color="#51472a" roughness={0.9} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}

function WatermelonFleshMaterial({
  damages,
  map,
  clipNormal,
}: {
  damages: Damage[];
  map: THREE.CanvasTexture;
  clipNormal: [number, number, number] | null;
}) {
  const material = useMemo(() => {
    const next = new THREE.MeshPhysicalMaterial({
      map,
      color: "#e04752",
      roughness: 0.56,
      clearcoat: 0.08,
      bumpMap: map,
      bumpScale: 0.008,
    });
    applyDamageDiscard(next, "watermelon-damage-v7-flesh");
    return next;
  }, [map]);

  useLayoutEffect(() => {
    const pierced = damages.map((damage) =>
      damage.pierced ? damage : { ...damage, radius: 0 },
    );
    syncDamageUniforms(material, pierced, 0.9, 0.91, clipNormal);
  }, [clipNormal, damages, material]);

  useFrame(() => {
    const pierced = damages.map((damage) =>
      damage.pierced ? damage : { ...damage, radius: 0 },
    );
    syncDamageUniforms(material, pierced, 0.9, 0.91, clipNormal);
  });

  useEffect(() => () => material.dispose(), [material]);
  return <primitive object={material} attach="material" />;
}

function createCourtyardTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#b9774f");
  gradient.addColorStop(0.58, "#9d5d3f");
  gradient.addColorStop(1, "#78442f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const random = seededRandom(8106);
  const brickHeight = 58;
  const brickWidth = 132;
  for (let row = 0; row < 10; row += 1) {
    const offset = row % 2 === 0 ? -brickWidth / 2 : 0;
    for (let column = -1; column < 10; column += 1) {
      const x = column * brickWidth + offset;
      const y = row * brickHeight;
      const lightness = Math.round(random() * 22 - 11);
      context.fillStyle = `rgb(${151 + lightness}, ${82 + lightness}, ${57 + lightness})`;
      context.fillRect(x + 4, y + 4, brickWidth - 8, brickHeight - 8);
      context.strokeStyle = "rgba(66,35,26,.28)";
      context.lineWidth = 2;
      context.strokeRect(x + 5, y + 5, brickWidth - 10, brickHeight - 10);
      for (let fleck = 0; fleck < 8; fleck += 1) {
        context.fillStyle = random() > 0.48 ? "rgba(255,214,165,.08)" : "rgba(55,24,18,.1)";
        context.fillRect(x + 10 + random() * (brickWidth - 24), y + 9 + random() * (brickHeight - 20), 2, 2);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = 2;
  return texture;
}

let watermelonTextureCache: ReturnType<typeof createWatermelonTextures> | null = null;
let fleshTextureCache: THREE.CanvasTexture | null = null;
let courtyardTextureCache: THREE.CanvasTexture | null = null;

function getWatermelonTextures() {
  watermelonTextureCache ??= createWatermelonTextures();
  return watermelonTextureCache;
}

function getFleshTexture() {
  fleshTextureCache ??= createFleshTexture();
  return fleshTextureCache;
}

function getCourtyardTexture() {
  courtyardTextureCache ??= createCourtyardTexture();
  return courtyardTextureCache;
}

function CourtyardSet() {
  const wallTexture = useMemo(getCourtyardTexture, []);

  return (
    <group>
      <mesh position={[0, 0.45, -1.68]} receiveShadow>
        <planeGeometry args={[7.2, 4.1]} />
        <meshStandardMaterial map={wallTexture} roughness={0.96} color="#d19a72" />
      </mesh>
      <mesh position={[-2.15, 0.73, -1.645]}>
        <planeGeometry args={[1.22, 1.3]} />
        <meshStandardMaterial color="#211f1b" roughness={0.92} />
      </mesh>
      {[-2.53, -2.34, -2.15, -1.96, -1.77].map((x) => (
        <mesh key={x} position={[x, 0.73, -1.59]} castShadow>
          <cylinderGeometry args={[0.026, 0.026, 1.36, 8]} />
          <meshStandardMaterial color="#36342e" metalness={0.62} roughness={0.55} />
        </mesh>
      ))}
      {[-1.54, -1.1, -0.66, -0.22].map((y) => (
        <mesh key={y} position={[-2.15, y + 1.6, -1.585]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.024, 0.024, 1.27, 8]} />
          <meshStandardMaterial color="#36342e" metalness={0.62} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[0, -1.195, -0.12]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8.2, 7]} />
        <meshStandardMaterial color="#6f6254" roughness={1} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      <mesh position={[0, -1.186, 0.18]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.25, 2.65]} />
        <meshStandardMaterial color="#7b2e2a" roughness={0.96} />
      </mesh>
      {[0.42, 0.72, 1.05].map((radius, index) => (
        <mesh key={radius} position={[0, -1.178, 0.18]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius, 0.025, 8, 52]} />
          <meshStandardMaterial color={index % 2 ? "#d5b179" : "#392824"} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Muscle({ length, radius, color = "#b97857" }: { length: number; radius: number; color?: string }) {
  return (
    <mesh castShadow>
      <capsuleGeometry args={[radius, length, 6, 12]} />
      <meshStandardMaterial color={color} roughness={0.55} />
    </mesh>
  );
}

function StrongmanCharacter({
  pressure,
  burst,
  reducedMotion,
  mode = "crush",
  position = [0, -0.02, -0.58],
  scale = 1,
  rotationY = 0,
  strike = 0,
}: {
  pressure: number;
  burst: boolean;
  reducedMotion: boolean;
  mode?: "crush" | "bend" | "lift" | "hammer";
  position?: [number, number, number];
  scale?: number;
  rotationY?: number;
  strike?: number;
}) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftUpper = useRef<THREE.Group>(null);
  const rightUpper = useRef<THREE.Group>(null);
  const leftFore = useRef<THREE.Group>(null);
  const rightFore = useRef<THREE.Group>(null);
  const motion = useRef(0);
  const burstStarted = useRef<number | null>(null);
  const slam = useRef(0);
  const lastStrike = useRef(0);

  useFrame((state, delta) => {
    motion.current = THREE.MathUtils.damp(motion.current, pressure, 8.5, delta);
    const squeeze = smoothstep(0.02, 1, motion.current);
    if (burst && burstStarted.current === null) burstStarted.current = state.clock.elapsedTime;
    const burstAge = burstStarted.current === null ? 0 : state.clock.elapsedTime - burstStarted.current;
    const recoil = burst && !reducedMotion ? Math.sin(burstAge * 21) * Math.exp(-burstAge * 5.5) * 0.045 : 0;
    if (strike > lastStrike.current) {
      lastStrike.current = strike;
      slam.current = 1;
    }
    slam.current = THREE.MathUtils.damp(slam.current, 0, 9, delta);
    const breath = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 1.65) * 0.012;
    if (root.current) {
      root.current.position.y = breath * 0.35 + recoil - slam.current * 0.04;
      const lean = mode === "crush"
        ? -0.025 - squeeze * 0.11
        : mode === "bend"
          ? -0.04 - squeeze * 0.16
          : mode === "hammer"
            ? -0.12 - squeeze * 0.14 - slam.current * 0.18
            : -0.08 - squeeze * 0.2;
      root.current.rotation.x = THREE.MathUtils.damp(root.current.rotation.x, lean, 6, delta);
    }
    if (torso.current) torso.current.scale.set(1 + squeeze * 0.025, 1 + breath, 1 + squeeze * 0.055);
    if (head.current) {
      head.current.rotation.x = THREE.MathUtils.damp(head.current.rotation.x, 0.02 + squeeze * 0.13 + slam.current * 0.12, 7, delta);
      head.current.rotation.z = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.65) * 0.012;
    }
    if (leftUpper.current && rightUpper.current && leftFore.current && rightFore.current) {
      if (mode === "hammer") {
        leftUpper.current.rotation.z = THREE.MathUtils.damp(leftUpper.current.rotation.z, -0.12 + squeeze * 0.08, 8, delta);
        rightUpper.current.rotation.z = THREE.MathUtils.damp(rightUpper.current.rotation.z, 0.78 - slam.current * 0.92, 14, delta);
        leftFore.current.rotation.z = THREE.MathUtils.damp(leftFore.current.rotation.z, 0.98, 8, delta);
        rightFore.current.rotation.z = THREE.MathUtils.damp(rightFore.current.rotation.z, -0.22 - slam.current * 0.55, 14, delta);
        leftUpper.current.rotation.x = THREE.MathUtils.damp(leftUpper.current.rotation.x, -0.88, 8, delta);
        rightUpper.current.rotation.x = THREE.MathUtils.damp(rightUpper.current.rotation.x, -1.12 + slam.current * 0.42, 14, delta);
      } else {
        const upperZ = mode === "crush" ? -0.28 + squeeze * 0.16 : mode === "bend" ? -0.38 + squeeze * 0.26 : -0.52 + squeeze * 0.2;
        const foreZ = mode === "crush" ? 0.74 + squeeze * 0.3 : mode === "bend" ? 0.54 + squeeze * 0.56 : 0.28 + squeeze * 0.25;
        const armX = mode === "crush" ? -0.72 : mode === "bend" ? -0.58 - squeeze * 0.12 : -0.34 - squeeze * 0.22;
        leftUpper.current.rotation.z = THREE.MathUtils.damp(leftUpper.current.rotation.z, upperZ, 8, delta);
        rightUpper.current.rotation.z = THREE.MathUtils.damp(rightUpper.current.rotation.z, -upperZ, 8, delta);
        leftFore.current.rotation.z = THREE.MathUtils.damp(leftFore.current.rotation.z, foreZ, 9, delta);
        rightFore.current.rotation.z = THREE.MathUtils.damp(rightFore.current.rotation.z, -foreZ, 9, delta);
        leftUpper.current.rotation.x = THREE.MathUtils.damp(leftUpper.current.rotation.x, armX, 8, delta);
        rightUpper.current.rotation.x = THREE.MathUtils.damp(rightUpper.current.rotation.x, armX, 8, delta);
      }
    }
  });

  const skin = "#b97857";
  const skinLight = "#c88965";

  return (
    <group position={position} scale={scale} rotation-y={rotationY}>
    <group ref={root}>
      <group ref={torso}>
        <RoundedBox args={[1.48, 1.28, 0.68]} radius={0.29} smoothness={3} position={[0, 0.37, 0]} castShadow>
          <meshStandardMaterial color="#111312" roughness={0.66} />
        </RoundedBox>
        <mesh position={[0, 0.72, 0.24]} scale={[0.72, 0.42, 0.3]} castShadow>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial color="#171918" roughness={0.62} />
        </mesh>
        <mesh position={[0, -0.1, 0.24]} scale={[0.63, 0.5, 0.3]} castShadow>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial color="#0d0f0e" roughness={0.72} />
        </mesh>
        {[-0.1, 0, 0.1].map((x, index) => (
          <mesh key={x} position={[x, 0.62 - index * 0.012, 0.548]} rotation={[0, 0, -0.18]}>
            <boxGeometry args={[0.055, 0.22, 0.018]} />
            <meshStandardMaterial color="#e7e7df" roughness={0.68} />
          </mesh>
        ))}
        <mesh position={[0, 0.99, 0.22]} rotation={[Math.PI / 2, 0, 0]} scale={[1.2, 1, 0.42]}>
          <torusGeometry args={[0.24, 0.035, 10, 32]} />
          <meshStandardMaterial color="#262927" roughness={0.74} />
        </mesh>
      </group>

      <mesh position={[0, -0.34, 0]} scale={[0.67, 0.28, 0.38]} castShadow>
        <sphereGeometry args={[1, 30, 20]} />
        <meshStandardMaterial color="#111312" roughness={0.74} />
      </mesh>
      {[-0.34, 0.34].map((x) => (
        <group key={x} position={[x, -0.91, 0]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.23, 0.74, 8, 16]} />
            <meshStandardMaterial color="#171918" roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.52, 0.09]} scale={[0.29, 0.15, 0.46]} castShadow>
            <sphereGeometry args={[1, 22, 14]} />
            <meshStandardMaterial color="#171918" roughness={0.8} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 1.1, -0.01]} scale={[0.25, 0.25, 0.22]} castShadow>
        <cylinderGeometry args={[1, 1.08, 1, 24]} />
        <meshStandardMaterial color={skin} roughness={0.58} />
      </mesh>
      <group ref={head} position={[0, 1.49, 0.02]}>
        <mesh scale={[0.39, 0.45, 0.36]} castShadow>
          <sphereGeometry args={[1, 40, 32]} />
          <meshStandardMaterial color={skinLight} roughness={0.52} />
        </mesh>
        <mesh position={[0, -0.14, 0.12]} scale={[0.34, 0.27, 0.29]} castShadow>
          <sphereGeometry args={[1, 30, 22]} />
          <meshStandardMaterial color={skin} roughness={0.58} />
        </mesh>
        <mesh position={[0, -0.18, 0.145]} scale={[0.335, 0.235, 0.292]}>
          <sphereGeometry args={[1, 30, 22]} />
          <meshStandardMaterial color="#704337" roughness={0.92} transparent opacity={0.22} depthWrite={false} />
        </mesh>
        {[-0.39, 0.39].map((x) => (
          <mesh key={x} position={[x, -0.02, 0]} scale={[0.07, 0.13, 0.07]} castShadow>
            <sphereGeometry args={[1, 18, 12]} />
            <meshStandardMaterial color={skin} roughness={0.62} />
          </mesh>
        ))}
        {[-0.13, 0.13].map((x) => (
          <group key={x}>
            <mesh position={[x, 0.045, 0.34]} scale={[0.068, 0.041, 0.023]}>
              <sphereGeometry args={[1, 18, 12]} />
              <meshStandardMaterial color="#eee5d8" roughness={0.48} />
            </mesh>
            <mesh position={[x, 0.045, 0.365]} scale={[0.026, 0.027, 0.014]}>
              <sphereGeometry args={[1, 16, 10]} />
              <meshStandardMaterial color="#261b18" roughness={0.48} />
            </mesh>
            <mesh position={[x, 0.115, 0.34]} rotation={[0, 0, x < 0 ? -0.13 : 0.13]}>
              <boxGeometry args={[0.18, 0.035, 0.035]} />
              <meshStandardMaterial color="#332019" roughness={0.72} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, -0.03, 0.385]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <capsuleGeometry args={[0.055, 0.12, 6, 12]} />
          <meshStandardMaterial color="#a9694f" roughness={0.62} />
        </mesh>
        <mesh position={[0, -0.22, 0.363]}>
          <boxGeometry args={[0.19, 0.027, 0.025]} />
          <meshStandardMaterial color="#5d3028" roughness={0.8} />
        </mesh>
      </group>

      <group ref={leftUpper} position={[-0.78, 0.79, 0.03]} rotation={[-0.72, 0, -0.28]}>
        <mesh position={[0, -0.03, 0]} scale={[0.33, 0.31, 0.31]} castShadow>
          <sphereGeometry args={[1, 28, 20]} />
          <meshStandardMaterial color="#101211" roughness={0.65} />
        </mesh>
        <group position={[0, -0.37, 0]}><Muscle length={0.45} radius={0.2} color={skin} /></group>
        <group ref={leftFore} position={[0, -0.71, 0]} rotation={[0.1, 0, 0.74]}>
          <group position={[0, -0.34, 0]}><Muscle length={0.48} radius={0.185} color={skinLight} /></group>
          <mesh position={[0, -0.69, 0.02]} scale={[0.2, 0.25, 0.15]} castShadow>
            <sphereGeometry args={[1, 22, 16]} />
            <meshStandardMaterial color={skinLight} roughness={0.6} />
          </mesh>
          {[-0.095, -0.032, 0.032, 0.095].map((x, index) => (
            <mesh key={x} position={[x, -0.82 + Math.abs(index - 1.5) * 0.012, 0.065]} rotation={[0.06, 0, -0.04]} castShadow>
              <capsuleGeometry args={[0.027, 0.12 - Math.abs(index - 1.5) * 0.012, 5, 9]} />
              <meshStandardMaterial color={skinLight} roughness={0.62} />
            </mesh>
          ))}
        </group>
      </group>
      <group ref={rightUpper} position={[0.78, 0.79, 0.03]} rotation={[-0.72, 0, 0.28]}>
        <mesh position={[0, -0.03, 0]} scale={[0.33, 0.31, 0.31]} castShadow>
          <sphereGeometry args={[1, 28, 20]} />
          <meshStandardMaterial color="#101211" roughness={0.65} />
        </mesh>
        <group position={[0, -0.37, 0]}><Muscle length={0.45} radius={0.2} color={skin} /></group>
        <group ref={rightFore} position={[0, -0.71, 0]} rotation={[0.1, 0, -0.74]}>
          <group position={[0, -0.34, 0]}><Muscle length={0.48} radius={0.185} color={skinLight} /></group>
          <mesh position={[0, -0.69, 0.02]} scale={[0.2, 0.25, 0.15]} castShadow>
            <sphereGeometry args={[1, 22, 16]} />
            <meshStandardMaterial color={skinLight} roughness={0.6} />
          </mesh>
          {[-0.095, -0.032, 0.032, 0.095].map((x, index) => (
            <mesh key={x} position={[x, -0.82 + Math.abs(index - 1.5) * 0.012, 0.065]} rotation={[0.06, 0, 0.04]} castShadow>
              <capsuleGeometry args={[0.027, 0.12 - Math.abs(index - 1.5) * 0.012, 5, 9]} />
              <meshStandardMaterial color={skinLight} roughness={0.62} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
    </group>
  );
}

function WatermelonStand() {
  return (
    <group position={[0, 0, -0.02]}>
      <mesh position={[0, -0.78, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.68, 0.045, 12, 64]} />
        <meshStandardMaterial color="#171817" metalness={0.72} roughness={0.42} />
      </mesh>
      <mesh position={[0, -1.02, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.11, 0.5, 16]} />
        <meshStandardMaterial color="#171817" metalness={0.72} roughness={0.42} />
      </mesh>
      {[0, Math.PI / 2].map((rotation) => (
        <group key={rotation} rotation={[0, rotation, 0]}>
          <mesh position={[-0.3, -0.96, 0]} rotation={[0, 0, -0.52]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.65, 10]} />
            <meshStandardMaterial color="#20211f" metalness={0.7} roughness={0.46} />
          </mesh>
          <mesh position={[0.3, -0.96, 0]} rotation={[0, 0, 0.52]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.65, 10]} />
            <meshStandardMaterial color="#20211f" metalness={0.7} roughness={0.46} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -1.16, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.46, 0.04, 10, 48]} />
        <meshStandardMaterial color="#171817" metalness={0.72} roughness={0.42} />
      </mesh>
    </group>
  );
}

function WatermelonChallenge({
  reducedMotion,
  onProgress,
  onComplete,
  onFeedback,
  onObjectTouch,
}: Omit<ChallengeCanvasProps, "challenge">) {
  const shell = useRef<THREE.Mesh>(null);
  const fruitRig = useRef<THREE.Group>(null);
  const stage = useRef<THREE.Group>(null);
  const squash = useRef(0);
  const hitsRef = useRef(0);
  const damagesRef = useRef<Damage[]>([]);
  const splitRef = useRef(false);
  const completionSent = useRef(false);
  const lastHitAt = useRef(0);
  const [hovered, setHovered] = useState(false);
  const [hits, setHits] = useState(0);
  const [damages, setDamages] = useState<Damage[]>([]);
  const [splitNormal, setSplitNormal] = useState<[number, number, number] | null>(null);
  const [bursts, setBursts] = useState<ImpactBurstSpec[]>([]);
  const fleshTexture = useMemo(getFleshTexture, []);
  const cutFacing = useMemo(
    () => (splitNormal ? new THREE.Quaternion().setFromUnitVectors(FORWARD, new THREE.Vector3(...splitNormal)) : null),
    [splitNormal],
  );

  useEffect(() => {
    document.body.style.cursor = hovered ? "crosshair" : "default";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [hovered]);

  const punchAt = useCallback((event: ThreeEvent<PointerEvent>) => {
    const worldPoint = event.point.clone();
    const shellMesh = shell.current;
    const localPoint = shellMesh
      ? shellMesh.worldToLocal(worldPoint.clone())
      : event.object.worldToLocal(worldPoint.clone());
    if (localPoint.lengthSq() < 0.0001) localPoint.set(0, 0, 1);
    if (splitRef.current && splitNormal) {
      const fall = new THREE.Vector3(...splitNormal);
      if (localPoint.dot(fall) > 0.12) return;
      if (localPoint.dot(fall) > -0.04) {
        localPoint.addScaledVector(fall, -0.12 - localPoint.dot(fall));
      }
      if (localPoint.lengthSq() < 0.0001) localPoint.copy(fall).multiplyScalar(-1);
    }

    const now = performance.now();
    if (now - lastHitAt.current < 55) return;
    lastHitAt.current = now;
    onObjectTouch();
    const localNormal = localPoint.clone().normalize();
    const worldNormal = event.face
      ? event.face.normal.clone().transformDirection(event.object.matrixWorld).normalize()
      : localNormal.clone().transformDirection((shellMesh ?? event.object).matrixWorld).normalize();
    const originInStage = stage.current
      ? stage.current.worldToLocal(worldPoint.clone())
      : worldPoint.clone();
    const stageInverse = stage.current ? new THREE.Matrix4().copy(stage.current.matrixWorld).invert() : new THREE.Matrix4();
    const normalInStage = worldNormal.clone().transformDirection(stageInverse).normalize();

    const nextHits = hitsRef.current + 1;
    hitsRef.current = nextHits;
    setHits(nextHits);
    squash.current = 1;
    punchCamera(0.045 + Math.min(nextHits, 12) * 0.006);

    const id = now + nextHits;
    const holeRadius = 0.09;
    const current = damagesRef.current;
    let nearestIndex = -1;
    let nearestDist = Infinity;
    for (let index = 0; index < current.length; index += 1) {
      const dx = current[index].point[0] - localNormal.x;
      const dy = current[index].point[1] - localNormal.y;
      const dz = current[index].point[2] - localNormal.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = index;
      }
    }

    const mergeSameSpot = nearestIndex >= 0 && nearestDist < 0.1;
    const growOldestInstead = !mergeSameSpot && current.length >= MAX_DAMAGE;
    const targetIndex = mergeSameSpot || growOldestInstead ? nearestIndex : -1;
    let nextDamages: Damage[];

    const deepen = (damage: Damage): Damage => {
      const holeHits = damage.hits + 1;
      const pierced = holeHits >= PIERCE_HITS;
      return {
        ...damage,
        radius: Math.min(0.16, damage.radius + (pierced ? 0.01 : 0.02)),
        hits: holeHits,
        pierced,
        broken: damage.broken,
      };
    };

    if (targetIndex >= 0) {
      nextDamages = current.map((damage, index) => (index === targetIndex ? deepen(damage) : damage));
    } else {
      nextDamages = [
        ...current,
        {
          id,
          point: localNormal.toArray() as [number, number, number],
          normal: localNormal.toArray() as [number, number, number],
          radius: holeRadius,
          hits: 1,
          pierced: false,
          broken: false,
        },
      ];
    }

    const cut = !splitRef.current ? detectCutNormal(nextDamages) : null;
    if (cut) {
      const fall = orientFallNormal(cut);
      splitRef.current = true;
      setSplitNormal(fall.toArray() as [number, number, number]);
      damagesRef.current = [];
      setDamages([]);
    } else {
      damagesRef.current = nextDamages;
      setDamages(nextDamages);
    }

    setBursts((currentBursts) => [
      ...currentBursts.slice(-3),
      {
        id,
        origin: originInStage.toArray() as [number, number, number],
        normal: normalInStage.toArray() as [number, number, number],
        power: cut ? 0.9 : 0.46 + Math.min(nextHits, 10) * 0.02,
        kind: "fruit",
      },
    ]);

    onProgress(clamp(nextHits / UNLOCK_HITS), nextHits);
    onFeedback("fruit", cut ? 0.9 : 0.42 + Math.min(nextHits, 10) * 0.055);

    if (nextHits >= UNLOCK_HITS && !completionSent.current) {
      completionSent.current = true;
      onComplete();
    }
  }, [onComplete, onFeedback, onObjectTouch, onProgress, splitNormal]);

  useFrame((_, delta) => {
    if (!fruitRig.current) return;
    squash.current = THREE.MathUtils.damp(squash.current, 0, 11, delta);
    const punch = squash.current;
    fruitRig.current.scale.x = 1.04 * (1 - punch * 0.08);
    fruitRig.current.scale.y = 1.05 * (1 + punch * 0.055);
    fruitRig.current.scale.z = 0.99 * (1 - punch * 0.045);
    fruitRig.current.rotation.z = reducedMotion ? 0 : Math.sin(punch * Math.PI) * 0.04;
    fruitRig.current.position.y = -0.02 - punch * 0.045;
  });

  const onPointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    punchAt(event);
  }, [punchAt]);

  return (
    <group ref={stage}>
      <CourtyardSet />
      <StrongmanCharacter pressure={clamp(hits / UNLOCK_HITS)} burst={Boolean(splitNormal)} reducedMotion={reducedMotion} />
      <WatermelonStand />
      <group ref={fruitRig} position={[0, -0.02, 0.34]}>
        <mesh
          scale={[0.86, 0.9, 0.83]}
          onPointerDown={onPointerDown}
          onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
          onPointerOut={() => setHovered(false)}
        >
          <sphereGeometry
            args={
              splitNormal
                ? [0.91, 40, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]
                : [0.91, 40, 40]
            }
          />
          <WatermelonFleshMaterial damages={damages} map={fleshTexture} clipNormal={splitNormal} />
        </mesh>
        <mesh
          ref={shell}
          scale={[0.86, 0.9, 0.83]}
          castShadow
          receiveShadow
          onPointerDown={onPointerDown}
          onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
          onPointerOut={() => setHovered(false)}
        >
          <sphereGeometry
            args={
              splitNormal
                ? [1, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]
                : [1, 48, 48]
            }
          />
          <WatermelonShellMaterial damages={damages} clipNormal={splitNormal} />
          {damages
            .filter((damage) => !splitNormal || isOnStaySide(damage.point, splitNormal))
            .map((damage) => (
              <DamageMark key={damage.id} damage={damage} />
            ))}
          {splitNormal && cutFacing && (
            <mesh
              quaternion={cutFacing}
              position={[-splitNormal[0] * 0.012, -splitNormal[1] * 0.012, -splitNormal[2] * 0.012]}
              onPointerDown={onPointerDown}
              onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
              onPointerOut={() => setHovered(false)}
            >
              <circleGeometry args={[0.98, 48]} />
              <meshPhysicalMaterial map={fleshTexture} color="#d4454f" roughness={0.5} side={THREE.DoubleSide} />
            </mesh>
          )}
        </mesh>
        {(!splitNormal || splitNormal[1] < 0.45) && (
          <mesh position={[0, 0.93, 0]} rotation={[0.08, 0, -0.22]} castShadow>
            <cylinderGeometry args={[0.045, 0.075, 0.23, 12]} />
            <meshStandardMaterial color="#51472a" roughness={0.9} />
          </mesh>
        )}
      </group>
      {splitNormal && (
        <FallingWatermelonHalf cutNormal={splitNormal} fleshTexture={fleshTexture} reducedMotion={reducedMotion} />
      )}
      {bursts.map((item) => (
        <ImpactBurst key={item.id} burst={item} reducedMotion={reducedMotion} />
      ))}
    </group>
  );
}

type BarSegment = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
};

function makeBarSegments(bend: number, zOffset = 0) {
  const count = 48;
  const raw = Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const arch = Math.sin(t * Math.PI);
    const elastic = arch * bend * 1.18;
    const plasticKink = Math.pow(arch, 6) * Math.max(0, bend - 0.48) * 1.05;
    const openBar = new THREE.Vector3(-2.28 + t * 4.56, elastic + plasticKink, zOffset + Math.sin(t * Math.PI * 2) * bend * 0.04);
    const wrap = smoothstep(0.58, 1, bend);
    const angle = -Math.PI / 2 + t * Math.PI * 2;
    const coil = new THREE.Vector3(
      -0.68 + Math.cos(angle) * (0.61 + Math.abs(zOffset) * 0.14),
      0.08 + Math.sin(angle) * (0.66 + Math.abs(zOffset) * 0.12),
      0.22 + zOffset + Math.sin(angle * 2) * 0.055,
    );
    return openBar.lerp(coil, wrap);
  });
  const curve = new THREE.CatmullRomCurve3(raw, false, "catmullrom", 0.35);
  const points = curve.getSpacedPoints(count);
  return points.slice(0, -1).map((point, index): BarSegment => {
    const next = points[index + 1];
    const direction = next.clone().sub(point);
    return {
      position: point.clone().add(next).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize()),
      length: direction.length() * 1.08,
    };
  });
}

function MetalChallenge({ reducedMotion, onProgress, onComplete, onFeedback, onObjectTouch }: Omit<ChallengeCanvasProps, "challenge">) {
  const frontBar = useRef<THREE.InstancedMesh>(null);
  const backBar = useRef<THREE.InstancedMesh>(null);
  const rig = useRef<THREE.Group>(null);
  const handle = useRef<THREE.Group>(null);
  const [bend, setBend] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [sparks, setSparks] = useState<ImpactBurstSpec[]>([]);
  const dragStart = useRef({ y: 0, bend: 0 });
  const permanent = useRef(0);
  const targetBend = useRef(0);
  const visualBend = useRef(0);
  const draggingRef = useRef(false);
  const completionSent = useRef(false);
  const lastSpark = useRef(0);
  const barCount = 48;
  const heat = smoothstep(0.28, 1, bend);
  const metalColor = useMemo(() => new THREE.Color("#707575").lerp(new THREE.Color("#ffb056"), heat), [heat]);
  const backColor = useMemo(() => new THREE.Color("#545a5a").lerp(new THREE.Color("#e08a3c"), heat), [heat]);

  useEffect(() => {
    document.body.style.cursor = dragging ? "grabbing" : "default";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [dragging]);

  useFrame((state, delta) => {
    visualBend.current = THREE.MathUtils.damp(
      visualBend.current,
      targetBend.current,
      draggingRef.current ? 16 : 4.2,
      delta,
    );
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const apply = (mesh: THREE.InstancedMesh | null, zOffset: number) => {
      if (!mesh) return;
      const segments = makeBarSegments(visualBend.current, zOffset);
      segments.forEach((segment, index) => {
        scale.set(1, segment.length, 1);
        matrix.compose(segment.position, segment.quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      return segments;
    };
    const front = apply(frontBar.current, 0.17);
    apply(backBar.current, -0.17);
    const mid = front?.[Math.floor(front.length / 2)];
    if (handle.current && mid) handle.current.position.copy(mid.position);

    if (!rig.current) return;
    const shake = reducedMotion ? 0 : (draggingRef.current && visualBend.current > 0.4
      ? Math.sin(state.clock.elapsedTime * 52) * visualBend.current * 0.004
      : visualBend.current > 0.55
        ? Math.sin(state.clock.elapsedTime * 46) * visualBend.current * 0.0018
        : 0);
    rig.current.rotation.z = shake;

    if (draggingRef.current && visualBend.current > 0.36) {
      const bucket = Math.floor(visualBend.current * 14);
      if (bucket > lastSpark.current) {
        lastSpark.current = bucket;
        const origin = (mid?.position.clone() ?? new THREE.Vector3()).toArray() as [number, number, number];
        setSparks((current) => [
          ...current.slice(-3),
          { id: performance.now(), origin, normal: [0, 1, 0.15], power: 0.45 + visualBend.current * 0.5, kind: "spark" },
        ]);
        punchCamera(0.035 + visualBend.current * 0.04);
      }
    }
  });

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    onObjectTouch();
    dragStart.current = { y: event.nativeEvent.clientY, bend: targetBend.current };
    draggingRef.current = true;
    setDragging(true);
    onFeedback("metal", 0.32);
    punchCamera(0.05);
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    const travel = dragStart.current.y - event.nativeEvent.clientY;
    const resistance = travel <= 60 ? travel / 430 : 0.14 + (travel - 60) / 250;
    const next = clamp(Math.max(permanent.current, dragStart.current.bend + resistance));
    targetBend.current = next;
    setBend(next);
    onProgress(next);
    if (next > 0.28 && Math.floor(next * 20) !== Math.floor(bend * 20)) onFeedback("metal", next);
    if (next >= 0.88 && !completionSent.current) {
      completionSent.current = true;
      permanent.current = next;
      onComplete();
    }
  };

  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (!draggingRef.current) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    draggingRef.current = false;
    setDragging(false);
    permanent.current = Math.max(permanent.current, targetBend.current > 0.62 ? targetBend.current : targetBend.current * 0.3);
    targetBend.current = permanent.current;
    setBend(permanent.current);
    onProgress(permanent.current);
  };

  return (
    <group>
      <CourtyardSet />
      <StrongmanCharacter
        pressure={bend}
        burst={bend >= 0.88}
        reducedMotion={reducedMotion}
        mode="bend"
        position={[0, 0.06, -0.86]}
        scale={0.88}
      />
      <group ref={rig} position={[0, -0.28, 0.24]} rotation={[0.015, -0.04, 0]}>
      {[-2.28, 2.28].map((x) => (
        <group key={x} position={[x, -0.17, 0]}>
          <RoundedBox args={[0.62, 0.5, 0.9]} radius={0.07} smoothness={3} castShadow receiveShadow>
            <meshStandardMaterial color="#77746a" roughness={0.94} />
          </RoundedBox>
          {[-0.17, 0.17].map((holeX) => (
            <mesh key={holeX} position={[holeX, 0.08, 0.46]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.09, 0.09, 0.035, 18]} />
              <meshStandardMaterial color="#34332f" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}

      <instancedMesh ref={frontBar} args={[undefined, undefined, barCount]} castShadow receiveShadow>
        <cylinderGeometry args={[0.078, 0.078, 1, 14]} />
        <meshPhysicalMaterial
          color={metalColor}
          emissive={metalColor}
          emissiveIntensity={heat * 0.42}
          metalness={0.92}
          roughness={0.34 - heat * 0.12}
          clearcoat={0.28}
        />
      </instancedMesh>
      <instancedMesh ref={backBar} args={[undefined, undefined, barCount]} castShadow receiveShadow>
        <cylinderGeometry args={[0.078, 0.078, 1, 14]} />
        <meshPhysicalMaterial
          color={backColor}
          emissive={backColor}
          emissiveIntensity={heat * 0.28}
          metalness={0.9}
          roughness={0.38 - heat * 0.1}
          clearcoat={0.22}
        />
      </instancedMesh>

      <group ref={handle} position={[0, 0, 0.17]}>
        <mesh
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          castShadow
        >
          <sphereGeometry args={[0.32, 30, 30]} />
          <meshPhysicalMaterial
            color={dragging ? "#dfff37" : "#151817"}
            metalness={0.35}
            roughness={0.48}
            transparent
            opacity={0.001}
            depthWrite={false}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.31, 0.018, 12, 48]} />
          <meshBasicMaterial color="#dfff37" transparent opacity={dragging ? 0.95 : 0.5} />
        </mesh>
        {bend > 0.62 && (
          <Sparkles
            count={Math.round(10 + bend * 12)}
            scale={[1.35, 0.85, 0.6]}
            size={2.8}
            speed={1.15}
            color="#f0ff79"
            opacity={0.78}
          />
        )}
      </group>
      {sparks.map((item) => (
        <ImpactBurst key={item.id} burst={item} reducedMotion={reducedMotion} floorY={-0.9} />
      ))}
      </group>
    </group>
  );
}

function createCarShapes() {
  const lower = new THREE.Shape();
  lower.moveTo(-1.9, -0.3);
  lower.lineTo(-1.84, 0.16);
  lower.quadraticCurveTo(-1.76, 0.38, -1.42, 0.42);
  lower.lineTo(1.46, 0.38);
  lower.quadraticCurveTo(1.78, 0.33, 1.86, 0.08);
  lower.lineTo(1.9, -0.28);
  lower.closePath();

  const cabin = new THREE.Shape();
  cabin.moveTo(-0.96, 0.2);
  cabin.lineTo(-0.64, 0.78);
  cabin.quadraticCurveTo(-0.52, 0.91, -0.3, 0.92);
  cabin.lineTo(0.58, 0.92);
  cabin.quadraticCurveTo(0.75, 0.88, 0.86, 0.71);
  cabin.lineTo(1.06, 0.2);
  cabin.closePath();

  const frontWindow = new THREE.Shape();
  frontWindow.moveTo(-0.82, 0.25);
  frontWindow.lineTo(-0.57, 0.7);
  frontWindow.lineTo(-0.12, 0.71);
  frontWindow.lineTo(-0.12, 0.25);
  frontWindow.closePath();

  const rearWindow = new THREE.Shape();
  rearWindow.moveTo(-0.04, 0.25);
  rearWindow.lineTo(-0.04, 0.71);
  rearWindow.lineTo(0.54, 0.71);
  rearWindow.lineTo(0.84, 0.25);
  rearWindow.closePath();
  return { lower, cabin, frontWindow, rearWindow };
}

function Wheel({ position, far = false, spin = 0 }: { position: [number, number, number]; far?: boolean; spin?: number }) {
  return (
    <group position={position} rotation={[Math.PI / 2, spin, 0]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.43, 0.43, 0.24, 32]} />
        <meshStandardMaterial color="#111313" roughness={0.9} />
      </mesh>
      <mesh position={[0, far ? -0.132 : 0.132, 0]}>
        <cylinderGeometry args={[0.285, 0.285, 0.035, 24]} />
        <meshPhysicalMaterial color="#aeb1ae" roughness={0.27} metalness={0.94} />
      </mesh>
      <mesh position={[0, far ? -0.154 : 0.154, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.045, 20]} />
        <meshStandardMaterial color="#202323" metalness={0.92} roughness={0.32} />
      </mesh>
    </group>
  );
}

function Suspension({ x, wheelY, z }: { x: number; wheelY: number; z: number }) {
  const top = -0.05;
  const bottom = wheelY + 0.08;
  const length = Math.max(0.2, top - bottom);
  return (
    <group position={[x, bottom + length / 2, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.035, 0.035, length, 12]} />
        <meshStandardMaterial color="#303334" metalness={0.88} roughness={0.38} />
      </mesh>
      <mesh>
        <torusGeometry args={[0.075, 0.012, 8, 24]} />
        <meshStandardMaterial color="#cf4438" metalness={0.54} roughness={0.42} />
      </mesh>
    </group>
  );
}

type CarModelProps = {
  lift: number;
  spin: number;
  bounce: number;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  dragging: boolean;
};

function CarModel({ lift, spin, bounce, onPointerDown, onPointerMove, onPointerUp, dragging }: CarModelProps) {
  const shapes = useMemo(createCarShapes, []);
  const angle = 0.015 + smoothstep(0.08, 1, lift) * 0.31;
  const axleRise = Math.sin(angle) * 2.7;
  const groundCompensation = axleRise * (1 - smoothstep(0.34, 0.63, lift));
  const rearWheelY = -0.56 - groundCompensation + bounce * 0.04;
  const paint = "#d8d7cf";
  const shake = dragging ? bounce * 0.01 : 0;

  return (
    <group position={[-1.35, -0.75, 0]} rotation-z={angle + shake}>
      <group position={[1.35, 0.75, 0]}>
        <mesh castShadow receiveShadow>
          <extrudeGeometry args={[shapes.lower, { depth: 1.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3 }]} />
          <meshPhysicalMaterial color={paint} metalness={0.58} roughness={0.22} clearcoat={0.76} clearcoatRoughness={0.18} />
        </mesh>
        <mesh castShadow position={[0, 0.13, 0.06]}>
          <extrudeGeometry args={[shapes.cabin, { depth: 1.06, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 3 }]} />
          <meshPhysicalMaterial color={paint} metalness={0.55} roughness={0.2} clearcoat={0.75} />
        </mesh>

        <group position={[0, 0.13, 1.132]}>
          <mesh>
            <shapeGeometry args={[shapes.frontWindow]} />
            <meshPhysicalMaterial color="#203039" metalness={0.12} roughness={0.18} transmission={0.16} transparent opacity={0.92} />
          </mesh>
          <mesh>
            <shapeGeometry args={[shapes.rearWindow]} />
            <meshPhysicalMaterial color="#263942" metalness={0.12} roughness={0.18} transmission={0.14} transparent opacity={0.92} />
          </mesh>
          <mesh position={[-0.075, 0.48, 0.008]}>
            <boxGeometry args={[0.045, 0.51, 0.025]} />
            <meshStandardMaterial color="#202222" metalness={0.72} roughness={0.35} />
          </mesh>
          <mesh position={[0.85, -0.08, 0.006]}>
            <boxGeometry args={[0.018, 0.52, 0.026]} />
            <meshStandardMaterial color="#656660" metalness={0.55} roughness={0.4} />
          </mesh>
          <mesh position={[0.43, -0.06, 0.006]}>
            <boxGeometry args={[0.018, 0.54, 0.026]} />
            <meshStandardMaterial color="#656660" metalness={0.55} roughness={0.4} />
          </mesh>
          <mesh position={[-0.53, 0.41, 0.04]}>
            <boxGeometry args={[0.12, 0.035, 0.035]} />
            <meshStandardMaterial color="#1f2222" metalness={0.82} roughness={0.34} />
          </mesh>
          <mesh position={[0.38, 0.41, 0.04]}>
            <boxGeometry args={[0.12, 0.035, 0.035]} />
            <meshStandardMaterial color="#1f2222" metalness={0.82} roughness={0.34} />
          </mesh>
        </group>

        <group position={[-1.89, -0.03, 0.6]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <boxGeometry args={[0.48, 0.17, 0.025]} />
            <meshStandardMaterial color="#222827" metalness={0.75} roughness={0.42} />
          </mesh>
          <mesh position={[-0.34, 0.11, -0.02]}>
            <boxGeometry args={[0.16, 0.24, 0.035]} />
            <meshPhysicalMaterial color="#e7e2b8" emissive="#716b3d" emissiveIntensity={0.22} roughness={0.28} />
          </mesh>
          <mesh position={[0.34, 0.11, -0.02]}>
            <boxGeometry args={[0.16, 0.24, 0.035]} />
            <meshPhysicalMaterial color="#e7e2b8" emissive="#716b3d" emissiveIntensity={0.22} roughness={0.28} />
          </mesh>
        </group>

        <mesh position={[-1.95, -0.27, 0.59]}>
          <boxGeometry args={[0.12, 0.11, 1.32]} />
          <meshPhysicalMaterial color="#8a8e8c" metalness={0.98} roughness={0.2} />
        </mesh>
        <mesh position={[1.95, -0.27, 0.59]}>
          <boxGeometry args={[0.12, 0.11, 1.32]} />
          <meshPhysicalMaterial color="#8a8e8c" metalness={0.98} roughness={0.2} />
        </mesh>
        <mesh position={[1.87, 0.08, 1.13]}>
          <boxGeometry args={[0.07, 0.24, 0.22]} />
          <meshPhysicalMaterial color="#a91e2d" emissive="#5c0712" emissiveIntensity={0.28} roughness={0.25} />
        </mesh>
        <mesh position={[1.936, -0.08, 0.58]} castShadow>
          <boxGeometry args={[0.034, 0.18, 0.52]} />
          <meshPhysicalMaterial color="#e9e6dc" metalness={0.12} roughness={0.36} clearcoat={0.34} />
        </mesh>
        <mesh position={[1.958, -0.08, 0.58]}>
          <boxGeometry args={[0.02, 0.095, 0.4]} />
          <meshStandardMaterial color="#222a2d" roughness={0.5} />
        </mesh>
        {[-0.1, 0, 0.1].map((z, index) => (
          <mesh key={z} position={[1.975, 0.22 - index * 0.018, 0.58 + z]} rotation={[0, 0, -0.22]}>
            <boxGeometry args={[0.018, 0.11, 0.025]} />
            <meshPhysicalMaterial color="#b9bdbb" metalness={0.92} roughness={0.2} />
          </mesh>
        ))}
        <mesh position={[1.93, -0.42, 0.12]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.055, 0.065, 0.34, 16]} />
          <meshStandardMaterial color="#353a3a" metalness={0.88} roughness={0.46} />
        </mesh>

        <Suspension x={-1.35} wheelY={-0.56 + bounce * 0.02} z={0.64} />
        <Suspension x={1.35} wheelY={rearWheelY} z={0.64} />
        <Wheel position={[-1.35, -0.56, 0.67]} spin={spin * 0.15} />
        <Wheel position={[-1.35, -0.56, -0.08]} far spin={spin * 0.15} />
        <Wheel position={[1.35, rearWheelY, 0.67]} spin={spin} />
        <Wheel position={[1.35, rearWheelY, -0.08]} far spin={spin} />

        <group position={[1.92, 0.08, 1.06]}>
          <mesh
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <sphereGeometry args={[0.34, 24, 24]} />
            <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.28, 0.018, 12, 44]} />
            <meshBasicMaterial color="#dfff37" transparent opacity={dragging ? 1 : 0.64} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} scale={dragging ? 1.32 : 1}>
            <torusGeometry args={[0.38, 0.009, 10, 44]} />
            <meshBasicMaterial color="#dfff37" transparent opacity={dragging ? 0.76 : 0.22} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function CarChallenge({ reducedMotion, onProgress, onComplete, onFeedback, onObjectTouch }: Omit<ChallengeCanvasProps, "challenge">) {
  const [lift, setLift] = useState(0);
  const [spin, setSpin] = useState(0);
  const [bounce, setBounce] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dust, setDust] = useState<ImpactBurstSpec[]>([]);
  const dragStart = useRef({ y: 0, lift: 0 });
  const completionSent = useRef(false);
  const targetLift = useRef(0);
  const visualLift = useRef(0);
  const draggingRef = useRef(false);
  const dustSent = useRef(false);
  const spinRef = useRef(0);
  const bounceRef = useRef(0);

  useEffect(() => {
    document.body.style.cursor = dragging ? "grabbing" : "default";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [dragging]);

  useFrame((state, delta) => {
    visualLift.current = THREE.MathUtils.damp(
      visualLift.current,
      targetLift.current,
      draggingRef.current ? 8.5 : 4.6,
      delta,
    );
    bounceRef.current = THREE.MathUtils.damp(
      bounceRef.current,
      draggingRef.current ? Math.sin(state.clock.elapsedTime * 28) * visualLift.current : 0,
      10,
      delta,
    );
    spinRef.current += delta * (0.4 + visualLift.current * 3.4) * (draggingRef.current ? 1 : 0.15);
    if (Math.abs(visualLift.current - lift) > 0.012) setLift(visualLift.current);
    if (Math.abs(spinRef.current - spin) > 0.04) setSpin(spinRef.current);
    if (Math.abs(bounceRef.current - bounce) > 0.02) setBounce(bounceRef.current);

    if (visualLift.current > 0.63 && !dustSent.current) {
      dustSent.current = true;
      setDust((current) => [
        ...current.slice(-2),
        { id: performance.now(), origin: [1.55, -1.05, 0.35], normal: [0.15, 0.85, 0.2], power: 0.7, kind: "dust" },
        { id: performance.now() + 1, origin: [1.55, -1.05, -0.25], normal: [-0.1, 0.9, -0.15], power: 0.62, kind: "dust" },
      ]);
      onFeedback("car", 0.92);
      punchCamera(0.12);
    }
    if (visualLift.current < 0.48) dustSent.current = false;
  });

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    onObjectTouch();
    dragStart.current = { y: event.nativeEvent.clientY, lift: targetLift.current };
    draggingRef.current = true;
    setDragging(true);
    onFeedback("car", 0.28);
    onFeedback("car-strain", Math.max(0.25, targetLift.current));
    punchCamera(0.04);
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    const travel = dragStart.current.y - event.nativeEvent.clientY;
    const next = clamp(dragStart.current.lift + travel / 300);
    targetLift.current = next;
    onProgress(next);
    onFeedback("car-strain", 0.2 + next * 0.7);
    if (Math.floor(next * 14) !== Math.floor(lift * 14)) onFeedback("car", next);
    if (next >= 0.9 && !completionSent.current) {
      completionSent.current = true;
      onComplete();
      punchCamera(0.16);
    }
  };

  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (!draggingRef.current) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    draggingRef.current = false;
    setDragging(false);
    onFeedback("car-strain", 0);
    const settled = targetLift.current > 0.55 ? targetLift.current : targetLift.current * 0.38;
    targetLift.current = settled;
    onProgress(settled);
  };

  return (
    <group>
      <CourtyardSet />
      <StrongmanCharacter
        pressure={lift}
        burst={lift >= 0.9}
        reducedMotion={reducedMotion}
        mode="lift"
        position={[2.08, -0.02, -0.72]}
        scale={0.78}
        rotationY={-0.28}
      />
      <group position={[0, -0.1, 0]} rotation={[0.04, -0.18, 0]}>
      <CarModel
        lift={lift}
        spin={spin}
        bounce={bounce}
        dragging={dragging}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {dust.map((item) => (
        <ImpactBurst key={item.id} burst={item} reducedMotion={reducedMotion} floorY={-1.08} />
      ))}
      </group>
    </group>
  );
}

const SPIKE_BOXES = [
  { y: 0.2, w: 2.08, h: 0.34, d: 0.6 },
  { y: -0.16, w: 2.16, h: 0.34, d: 0.64 },
  { y: -0.52, w: 2.1, h: 0.34, d: 0.58 },
] as const;
const SPIKE_HITS = 14;
const SPIKE_SHAFT = 1.12;
const SPIKE_TIP_START = SPIKE_BOXES[0].y + SPIKE_BOXES[0].h / 2 + 0.09;
const SPIKE_TIP_END = SPIKE_BOXES[2].y - SPIKE_BOXES[2].h / 2 - 0.32;
const SPIKE_TRAVEL = SPIKE_TIP_START - SPIKE_TIP_END;

function HolePlateMaterial({ hole, color }: { hole: number; color: string }) {
  const material = useMemo(() => {
    const next = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.58,
      roughness: 0.44,
      side: THREE.DoubleSide,
    });
    next.onBeforeCompile = (shader) => {
      shader.uniforms.holeRadius = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nuniform float holeRadius;")
        .replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>
          if (holeRadius > 0.002 && length(vObjPos.xz) < holeRadius) discard;`,
        );
      next.userData.shader = shader;
    };
    next.customProgramCacheKey = () => "steel-hole-plate-v1";
    return next;
  }, [color]);

  useFrame(() => {
    const shader = material.userData.shader as { uniforms: { holeRadius: { value: number } } } | undefined;
    if (shader) shader.uniforms.holeRadius.value = hole;
  });

  useEffect(() => () => material.dispose(), [material]);
  return <primitive object={material} attach="material" />;
}

function SteelCrate({
  width,
  height,
  depth,
  holeTop,
  holeBottom,
}: {
  width: number;
  height: number;
  depth: number;
  holeTop: number;
  holeBottom: number;
}) {
  const wall = 0.052;
  const steel = "#4c5150";
  const rust = "#6a4634";
  return (
    <group>
      <mesh position={[0, 0, depth / 2 - wall / 2]} castShadow>
        <boxGeometry args={[width, height, wall]} />
        <meshStandardMaterial color={steel} metalness={0.64} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0, -depth / 2 + wall / 2]} castShadow>
        <boxGeometry args={[width, height, wall]} />
        <meshStandardMaterial color="#3f4443" metalness={0.62} roughness={0.5} />
      </mesh>
      <mesh position={[-width / 2 + wall / 2, 0, 0]} castShadow>
        <boxGeometry args={[wall, height, depth - wall * 2]} />
        <meshStandardMaterial color="#555c5a" metalness={0.6} roughness={0.48} />
      </mesh>
      <mesh position={[width / 2 - wall / 2, 0, 0]} castShadow>
        <boxGeometry args={[wall, height, depth - wall * 2]} />
        <meshStandardMaterial color="#555c5a" metalness={0.6} roughness={0.48} />
      </mesh>
      <mesh position={[0, height / 2 - 0.018, 0]} castShadow>
        <boxGeometry args={[width - wall, 0.038, depth - wall]} />
        <HolePlateMaterial hole={holeTop} color={rust} />
      </mesh>
      <mesh position={[0, -height / 2 + 0.018, 0]} castShadow>
        <boxGeometry args={[width - wall, 0.038, depth - wall]} />
        <HolePlateMaterial hole={holeBottom} color="#5a3a2c" />
      </mesh>
      {holeTop > 0.02 && (
        <mesh position={[0, height / 2 - 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[holeTop * 1.05, 0.012, 8, 24]} />
          <meshStandardMaterial color="#2b2e2d" metalness={0.7} roughness={0.35} />
        </mesh>
      )}
      {holeBottom > 0.02 && (
        <mesh position={[0, -height / 2 + 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[holeBottom * 1.05, 0.012, 8, 24]} />
          <meshStandardMaterial color="#2b2e2d" metalness={0.7} roughness={0.35} />
        </mesh>
      )}
    </group>
  );
}

function SpikeChallenge({
  reducedMotion,
  onProgress,
  onComplete,
  onFeedback,
  onObjectTouch,
}: Omit<ChallengeCanvasProps, "challenge">) {
  const rod = useRef<THREE.Group>(null);
  const visualDrive = useRef(0);
  const targetDrive = useRef(0);
  const lastHitAt = useRef(0);
  const lastFaces = useRef(0);
  const hitsRef = useRef(0);
  const completionSent = useRef(false);
  const [hits, setHits] = useState(0);
  const [drive, setDrive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [sparks, setSparks] = useState<ImpactBurstSpec[]>([]);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "default";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [hovered]);

  const punchRod = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const now = performance.now();
    if (now - lastHitAt.current < 90) return;
    lastHitAt.current = now;
    onObjectTouch();

    const nextHits = hitsRef.current + 1;
    hitsRef.current = nextHits;
    const nextDrive = Math.min(1, targetDrive.current + 1 / SPIKE_HITS);
    targetDrive.current = nextDrive;
    setHits(nextHits);
    punchCamera(0.05 + nextDrive * 0.04);

    const plateY = SPIKE_TIP_START + 0.04 - visualDrive.current * SPIKE_TRAVEL + SPIKE_SHAFT;
    setSparks((current) => [
      ...current.slice(-4),
      {
        id: now,
        origin: [0, plateY, 0.22],
        normal: [0, 1, 0.2],
        power: 0.5 + nextDrive * 0.4,
        kind: "spark",
      },
    ]);

    onProgress(nextDrive, nextHits);
    onFeedback("metal", 0.48 + nextDrive * 0.4);
    if (nextDrive >= 0.9 && !completionSent.current) {
      completionSent.current = true;
      onComplete();
    }
  }, [onComplete, onFeedback, onObjectTouch, onProgress]);

  useFrame((_, delta) => {
    visualDrive.current = THREE.MathUtils.damp(visualDrive.current, targetDrive.current, 8.5, delta);
    if (Math.abs(visualDrive.current - drive) > 0.01) setDrive(visualDrive.current);
    const tipY = SPIKE_TIP_START - visualDrive.current * SPIKE_TRAVEL;
    if (rod.current) {
      rod.current.position.y = tipY + SPIKE_SHAFT;
      const punch = 1 - Math.min(1, (performance.now() - lastHitAt.current) / 140);
      rod.current.rotation.z = reducedMotion ? 0 : Math.sin(punch * Math.PI) * 0.012;
    }

    let faces = 0;
    SPIKE_BOXES.forEach((box) => {
      if (tipY < box.y + box.h / 2 - 0.01) faces += 1;
      if (tipY < box.y - box.h / 2 - 0.01) faces += 1;
    });
    if (faces > lastFaces.current) {
      lastFaces.current = faces;
      const pierceY = tipY;
      setSparks((current) => [
        ...current.slice(-4),
        {
          id: performance.now() + faces,
          origin: [0, pierceY, 0.22],
          normal: [0, -1, 0.4],
          power: 0.72,
          kind: "spark",
        },
      ]);
      onFeedback("metal", 0.82);
      punchCamera(0.07);
    }
  });

  return (
    <group>
      <CourtyardSet />
      <StrongmanCharacter
        pressure={clamp(drive)}
        burst={drive >= 0.9}
        reducedMotion={reducedMotion}
        mode="hammer"
        strike={hits}
        position={[-0.08, -0.02, -0.7]}
        scale={0.94}
      />
      <mesh position={[0, -1.12, 0.2]} receiveShadow>
        <boxGeometry args={[2.6, 0.08, 0.95]} />
        <meshStandardMaterial color="#3a332c" roughness={0.9} />
      </mesh>
      {[-0.82, 0.82].map((x) => (
        <mesh key={x} position={[x, -0.92, 0.2]} castShadow>
          <boxGeometry args={[0.16, 0.38, 0.7]} />
          <meshStandardMaterial color="#2c3030" metalness={0.45} roughness={0.62} />
        </mesh>
      ))}
      {SPIKE_BOXES.map((box, index) => {
        const tipY = SPIKE_TIP_START - drive * SPIKE_TRAVEL;
        const holeTop = tipY < box.y + box.h / 2 - 0.02 ? 0.078 : 0;
        const holeBottom = tipY < box.y - box.h / 2 - 0.02 ? 0.078 : 0;
        return (
          <group key={index} position={[0, box.y, 0.22]}>
            <SteelCrate width={box.w} height={box.h} depth={box.d} holeTop={holeTop} holeBottom={holeBottom} />
          </group>
        );
      })}
      <group ref={rod} position={[0, SPIKE_TIP_START + SPIKE_SHAFT, 0.22]}>
        <mesh
          position={[0, 0.02, 0]}
          castShadow
          onPointerDown={punchRod}
          onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
          onPointerOut={() => setHovered(false)}
        >
          <cylinderGeometry args={[0.155, 0.175, 0.07, 8]} />
          <meshStandardMaterial color="#6a7170" metalness={0.78} roughness={0.32} />
        </mesh>
        {[0, 1, 2, 3, 4].map((index) => (
          <mesh key={index} position={[Math.cos(index * 1.15) * 0.04, 0.055, Math.sin(index * 1.15) * 0.03]} rotation={[0.1, index, 0.2]} castShadow>
            <boxGeometry args={[0.08, 0.028, 0.035]} />
            <meshStandardMaterial color="#8a918f" metalness={0.7} roughness={0.38} />
          </mesh>
        ))}
        <mesh
          position={[0, -SPIKE_SHAFT / 2, 0]}
          castShadow
          onPointerDown={punchRod}
          onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
          onPointerOut={() => setHovered(false)}
        >
          <cylinderGeometry args={[0.042, 0.048, SPIKE_SHAFT, 12]} />
          <meshStandardMaterial color="#3e4444" metalness={0.72} roughness={0.36} />
        </mesh>
        <mesh position={[0, -SPIKE_SHAFT - 0.06, 0]} castShadow>
          <coneGeometry args={[0.046, 0.12, 10]} />
          <meshStandardMaterial color="#2d3232" metalness={0.74} roughness={0.3} />
        </mesh>
      </group>
      {sparks.map((item) => (
        <ImpactBurst key={item.id} burst={item} reducedMotion={reducedMotion} floorY={-1.08} />
      ))}
    </group>
  );
}

function CameraRig({ challenge, reducedMotion }: { challenge: ChallengeNumber; reducedMotion: boolean }) {
  const { camera } = useThree();
  const target = useMemo(() => {
    if (challenge === 1) return new THREE.Vector3(0, 0.32, 7.15);
    if (challenge === 2) return new THREE.Vector3(0, 0.25, 7.05);
    if (challenge === 4) return new THREE.Vector3(0.15, 0.48, 7.45);
    return new THREE.Vector3(0, 0.55, 7.6);
  }, [challenge]);

  useFrame((state, delta) => {
    cameraKick.current = THREE.MathUtils.damp(cameraKick.current, 0, 9, delta);
    camera.position.lerp(target, reducedMotion ? 1 : 1 - Math.exp(-delta * 3.6));
    camera.lookAt(0, challenge === 3 ? -0.08 : challenge === 4 ? 0.08 : -0.12, 0);
    if (!reducedMotion) {
      const pointerAmount = challenge === 1 ? 0.035 : 0.07;
      const kick = cameraKick.current;
      camera.position.x += state.pointer.x * pointerAmount * delta;
      camera.position.y += state.pointer.y * pointerAmount * 0.45 * delta;
      camera.position.x += Math.sin(state.clock.elapsedTime * 54) * kick * 0.08;
      camera.position.y += Math.cos(state.clock.elapsedTime * 47) * kick * 0.05;
    }
  });
  return null;
}

function ResponsiveStage({
  challenge,
  children,
}: {
  challenge: ChallengeNumber;
  children: React.ReactNode;
}) {
  const { viewport } = useThree();
  const portrait = viewport.aspect < 0.82;
  const targetWidth = challenge === 3 ? 6.5 : challenge === 4 ? 6.1 : challenge === 2 ? 6.25 : 5.25;
  const targetHeight = challenge === 4 ? 3.7 : challenge === 3 ? 3.45 : 3.25;
  const scale = portrait
    ? viewport.height / targetHeight
    : Math.min(1, viewport.width / targetWidth);
  return <group scale={scale} position={[0, portrait ? -0.18 : 0, 0]}>{children}</group>;
}

function Studio({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <>
      <ambientLight intensity={1.1} />
      <hemisphereLight args={["#ffffff", "#b7b5a8", 1.8]} />
      <directionalLight
        castShadow
        position={[-3.8, 5.5, 4.5]}
        intensity={3.1}
        color="#fffdf4"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
      />
      <pointLight position={[4, 1.5, 3.5]} intensity={12} distance={9} color="#dfff8a" />
      <pointLight position={[-4, -1.8, 2]} intensity={7} distance={8} color="#d5d9ff" />
      <ContactShadows
        position={[0, -1.17, 0]}
        opacity={0.22}
        scale={8.5}
        blur={3.4}
        far={4.3}
        resolution={reducedMotion ? 128 : 256}
        frames={1}
        color="#2c2824"
      />
    </>
  );
}

function SceneWarmup({
  challenge,
  onSceneWarm,
  onReady,
}: {
  challenge: ChallengeNumber;
  onSceneWarm: () => void;
  onReady?: () => void;
}) {
  const { gl, scene, camera } = useThree();
  const frames = useRef(0);

  useLayoutEffect(() => {
    frames.current = 0;
  }, [challenge]);

  useFrame(() => {
    if (frames.current >= 8) return;
    frames.current += 1;
    if (frames.current === 1) {
      try {
        gl.compile(scene, camera);
      } catch {
        /* custom onBeforeCompile shaders finish on first draw */
      }
    }
    if (frames.current === 3) onSceneWarm();
    if (frames.current === 8) onReady?.();
  });

  return null;
}

export default function ChallengeCanvas({
  challenge,
  reducedMotion,
  onProgress,
  onComplete,
  onFeedback,
  onObjectTouch,
  onReady,
}: ChallengeCanvasProps) {
  const [postReady, setPostReady] = useState(false);
  const background = challenge === 1 || challenge === 4 ? "#e7ded2" : "#ecece5";

  return (
    <Canvas
      className="challenge-canvas"
      dpr={[1, 1.35]}
      camera={{ fov: 35, near: 0.1, far: 60, position: [0, 0.3, 6.8] }}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false }}
      shadows
      performance={{ min: 0.6, debounce: 200 }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
        gl.localClippingEnabled = true;
      }}
    >
      <color attach="background" args={[background]} />
      <CameraRig challenge={challenge} reducedMotion={reducedMotion} />
      <Studio reducedMotion={reducedMotion} />
      <ResponsiveStage challenge={challenge}>
        {challenge === 1 && (
          <WatermelonChallenge
            reducedMotion={reducedMotion}
            onProgress={onProgress}
            onComplete={onComplete}
            onFeedback={onFeedback}
            onObjectTouch={onObjectTouch}
          />
        )}
        {challenge === 2 && (
          <MetalChallenge reducedMotion={reducedMotion} onProgress={onProgress} onComplete={onComplete} onFeedback={onFeedback} onObjectTouch={onObjectTouch} />
        )}
        {challenge === 3 && (
          <CarChallenge reducedMotion={reducedMotion} onProgress={onProgress} onComplete={onComplete} onFeedback={onFeedback} onObjectTouch={onObjectTouch} />
        )}
        {challenge === 4 && (
          <SpikeChallenge reducedMotion={reducedMotion} onProgress={onProgress} onComplete={onComplete} onFeedback={onFeedback} onObjectTouch={onObjectTouch} />
        )}
      </ResponsiveStage>
      <SceneWarmup challenge={challenge} onSceneWarm={() => setPostReady(true)} onReady={onReady} />
      <Preload all />
      {postReady && (
        <EffectComposer multisampling={0}>
          <SMAA />
          <Bloom
            luminanceThreshold={0.92}
            intensity={reducedMotion ? 0.08 : 0.16}
            mipmapBlur
            luminanceSmoothing={0.35}
          />
          <Vignette offset={0.32} darkness={0.22} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
