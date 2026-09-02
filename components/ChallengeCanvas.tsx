"use client";

import { ContactShadows, RoundedBox, Sparkles } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

export type ChallengeNumber = 1 | 2 | 3;
export type FeedbackKind = "fruit" | "metal" | "car";

type ChallengeCanvasProps = {
  challenge: ChallengeNumber;
  reducedMotion: boolean;
  onProgress: (progress: number, detail?: number) => void;
  onComplete: () => void;
  onFeedback: (kind: FeedbackKind, intensity: number) => void;
  onObjectTouch: () => void;
};

type Damage = {
  id: number;
  point: [number, number, number];
  normal: [number, number, number];
  radius: number;
  angle: number;
};

type Burst = {
  id: number;
  origin: [number, number, number];
  normal: [number, number, number];
  power: number;
};

const MAX_DAMAGE = 8;
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
  const width = 1024;
  const height = 512;
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
  for (let i = 0; i < 2400; i += 1) {
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
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  return { map, bumpMap };
}

function createFleshTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
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
  return texture;
}

function WatermelonShellMaterial({ damages }: { damages: Damage[] }) {
  const textures = useMemo(createWatermelonTextures, []);
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
    next.onBeforeCompile = (shader) => {
      shader.uniforms.damagePoints = {
        value: Array.from({ length: MAX_DAMAGE }, () => new THREE.Vector3(99, 99, 99)),
      };
      shader.uniforms.damageRadii = { value: Array.from({ length: MAX_DAMAGE }, () => 0) };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vLocalPosition;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocalPosition = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vLocalPosition;\nuniform vec3 damagePoints[8];\nuniform float damageRadii[8];",
        )
        .replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>
          for (int i = 0; i < 8; i++) {
            if (damageRadii[i] > 0.0 && distance(vLocalPosition, damagePoints[i]) < damageRadii[i]) discard;
          }`,
        );
      next.userData.shader = shader;
    };
    next.customProgramCacheKey = () => "watermelon-damage-v2";
    return next;
  }, [textures]);

  useLayoutEffect(() => {
    const shader = material.userData.shader;
    if (!shader) return;
    const points = shader.uniforms.damagePoints.value as THREE.Vector3[];
    const radii = shader.uniforms.damageRadii.value as number[];
    for (let i = 0; i < MAX_DAMAGE; i += 1) {
      const damage = damages[i];
      if (damage) {
        points[i].set(...damage.point);
        radii[i] = damage.radius;
      } else {
        points[i].set(99, 99, 99);
        radii[i] = 0;
      }
    }
  }, [damages, material]);

  useEffect(
    () => () => {
      material.dispose();
      textures.map.dispose();
      textures.bumpMap.dispose();
    },
    [material, textures],
  );

  return <primitive object={material} attach="material" />;
}

function DamageMark({ damage }: { damage: Damage }) {
  const normal = useMemo(() => new THREE.Vector3(...damage.normal).normalize(), [damage.normal]);
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(FORWARD, normal), [normal]);
  const crackCount = damage.radius > 0.13 ? 7 : 5;

  return (
    <group position={damage.point} quaternion={quaternion} rotation-z={damage.angle}>
      {Array.from({ length: crackCount }, (_, index) => {
        const angle = (index / crackCount) * Math.PI * 2 + damage.angle;
        const length = 0.11 + ((index * 37 + damage.id) % 5) * 0.022 + damage.radius * 0.35;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * (damage.radius * 0.62 + length * 0.22), Math.sin(angle) * (damage.radius * 0.62 + length * 0.22), 0.008]}
            rotation-z={angle}
            renderOrder={3}
          >
            <planeGeometry args={[length, 0.008 + (index % 2) * 0.005]} />
            <meshBasicMaterial color="#142319" transparent opacity={0.92} depthWrite={false} />
          </mesh>
        );
      })}
      {damage.radius > 0.025 && (
        <>
          <mesh position={[0, 0, 0.014]} renderOrder={4}>
            <torusGeometry args={[damage.radius * 0.93, 0.014, 10, 36]} />
            <meshStandardMaterial color="#b8d79a" roughness={0.72} />
          </mesh>
          <mesh position={[0, 0, 0.022]} renderOrder={5}>
            <torusGeometry args={[damage.radius * 0.7, 0.013, 8, 28]} />
            <meshStandardMaterial color="#681624" roughness={0.62} />
          </mesh>
        </>
      )}
    </group>
  );
}

function FruitBurst({ burst, reducedMotion }: { burst: Burst; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const startTime = useRef<number | null>(null);
  const visible = useRef(true);
  const pieces = useMemo(() => {
    const random = seededRandom(burst.id * 991 + 17);
    const normal = new THREE.Vector3(...burst.normal).normalize();
    const tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tangent)) > 0.8) tangent.set(0, 1, 0);
    tangent.cross(normal).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const count = reducedMotion ? 4 : 8;
    return Array.from({ length: count }, (_, index) => {
      const spreadA = (random() - 0.5) * 1.9;
      const spreadB = (random() - 0.5) * 1.9;
      const velocity = normal
        .clone()
        .multiplyScalar(0.7 + random() * 1.45)
        .addScaledVector(tangent, spreadA)
        .addScaledVector(bitangent, spreadB)
        .multiplyScalar(burst.power);
      const scale = 0.028 + random() * 0.055;
      return {
        velocity,
        angular: new THREE.Vector3(random() * 7, random() * 7, random() * 7),
        scale,
        color: index % 4 === 0 ? "#4d8b38" : index % 5 === 0 ? "#b5d693" : "#cb3044",
      };
    });
  }, [burst, reducedMotion]);

  useFrame((state) => {
    if (!visible.current) return;
    if (startTime.current === null) startTime.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - startTime.current;
    pieces.forEach((piece, index) => {
      const mesh = meshes.current[index];
      if (!mesh) return;
      mesh.position.copy(piece.velocity).multiplyScalar(age);
      mesh.position.y -= age * age * 1.65;
      mesh.rotation.x = piece.angular.x * age;
      mesh.rotation.y = piece.angular.y * age;
      mesh.rotation.z = piece.angular.z * age;
      const fade = clamp(1 - age / 1.25);
      mesh.scale.setScalar(piece.scale * Math.max(0.001, fade));
    });
    if (age > 1.35 && group.current) {
      visible.current = false;
      group.current.visible = false;
    }
  });

  return (
    <group ref={group} position={burst.origin}>
      {pieces.map((piece, index) => (
        <mesh
          key={index}
          ref={(node) => {
            meshes.current[index] = node;
          }}
          castShadow
        >
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={piece.color} roughness={0.62} />
        </mesh>
      ))}
    </group>
  );
}

function createCourtyardTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
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
  texture.anisotropy = 4;
  return texture;
}

function CourtyardSet() {
  const wallTexture = useMemo(createCourtyardTexture, []);
  useEffect(() => () => wallTexture.dispose(), [wallTexture]);

  return (
    <group>
      <mesh position={[0, 0.45, -1.68]} receiveShadow>
        <planeGeometry args={[7.2, 4.1]} />
        <meshStandardMaterial map={wallTexture} roughness={0.96} color="#d19a72" transparent opacity={0.86} />
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
      <mesh position={[0, -1.18, -0.12]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8.2, 7]} />
        <meshStandardMaterial color="#7b6b59" roughness={0.98} />
      </mesh>
      <mesh position={[0, -1.165, 0.18]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.25, 2.65]} />
        <meshStandardMaterial color="#7b2e2a" roughness={0.92} />
      </mesh>
      {[0.42, 0.72, 1.05].map((radius, index) => (
        <mesh key={radius} position={[0, -1.15 + index * 0.001, 0.18]} rotation={[-Math.PI / 2, 0, 0]}>
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
      <capsuleGeometry args={[radius, length, 10, 20]} />
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
}: {
  pressure: number;
  burst: boolean;
  reducedMotion: boolean;
  mode?: "crush" | "bend" | "lift";
  position?: [number, number, number];
  scale?: number;
  rotationY?: number;
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

  useFrame((state, delta) => {
    motion.current = THREE.MathUtils.damp(motion.current, pressure, 8.5, delta);
    const squeeze = smoothstep(0.02, 1, motion.current);
    if (burst && burstStarted.current === null) burstStarted.current = state.clock.elapsedTime;
    const burstAge = burstStarted.current === null ? 0 : state.clock.elapsedTime - burstStarted.current;
    const recoil = burst && !reducedMotion ? Math.sin(burstAge * 21) * Math.exp(-burstAge * 5.5) * 0.045 : 0;
    const breath = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 1.65) * 0.012;
    if (root.current) {
      root.current.position.y = breath * 0.35 + recoil;
      const lean = mode === "crush" ? -0.025 - squeeze * 0.11 : mode === "bend" ? -0.04 - squeeze * 0.16 : -0.08 - squeeze * 0.2;
      root.current.rotation.x = THREE.MathUtils.damp(root.current.rotation.x, lean, 6, delta);
    }
    if (torso.current) torso.current.scale.set(1 + squeeze * 0.025, 1 + breath, 1 + squeeze * 0.055);
    if (head.current) {
      head.current.rotation.x = THREE.MathUtils.damp(head.current.rotation.x, 0.02 + squeeze * 0.13, 7, delta);
      head.current.rotation.z = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.65) * 0.012;
    }
    if (leftUpper.current && rightUpper.current && leftFore.current && rightFore.current) {
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
  });

  const skin = "#b97857";
  const skinLight = "#c88965";

  return (
    <group position={position} scale={scale} rotation-y={rotationY}>
    <group ref={root}>
      <group ref={torso}>
        <RoundedBox args={[1.48, 1.28, 0.68]} radius={0.29} smoothness={5} position={[0, 0.37, 0]} castShadow>
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

function WatermelonSplit({ active, reducedMotion }: { active: boolean; reducedMotion: boolean }) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!active) return;
    const blend = reducedMotion ? 1 : 1 - Math.exp(-delta * 4.6);
    if (left.current) {
      left.current.position.lerp(new THREE.Vector3(-0.42, -0.04, 0.03), blend);
      left.current.rotation.z = THREE.MathUtils.damp(left.current.rotation.z, 0.12, 5, delta);
      left.current.rotation.y = THREE.MathUtils.damp(left.current.rotation.y, -0.16, 5, delta);
    }
    if (right.current) {
      right.current.position.lerp(new THREE.Vector3(0.42, -0.04, 0.03), blend);
      right.current.rotation.z = THREE.MathUtils.damp(right.current.rotation.z, -0.12, 5, delta);
      right.current.rotation.y = THREE.MathUtils.damp(right.current.rotation.y, 0.16, 5, delta);
    }
  });

  if (!active) return null;
  return (
    <group position={[0, -0.02, 0.34]}>
      {([-1, 1] as const).map((side) => (
        <group key={side} ref={side < 0 ? left : right}>
          <mesh scale={[0.5, 0.86, 0.7]} castShadow>
            <sphereGeometry args={[0.92, 42, 32]} />
            <meshPhysicalMaterial color="#28672f" roughness={0.44} clearcoat={0.18} />
          </mesh>
          <mesh position={[side * -0.035, 0, 0.045]} scale={[0.445, 0.79, 0.655]} castShadow>
            <sphereGeometry args={[0.92, 40, 30]} />
            <meshStandardMaterial color="#bfd89d" roughness={0.68} />
          </mesh>
          <mesh position={[side * -0.06, 0, 0.095]} scale={[0.39, 0.72, 0.61]} castShadow>
            <sphereGeometry args={[0.92, 40, 30]} />
            <meshPhysicalMaterial color="#db3d4e" roughness={0.58} clearcoat={0.08} />
          </mesh>
          {Array.from({ length: 9 }, (_, index) => {
            const column = index % 3;
            const row = Math.floor(index / 3);
            return (
              <mesh
                key={index}
                position={[side * (-0.405 + column * 0.018), -0.28 + row * 0.28, 0.66 - Math.abs(column - 1) * 0.05]}
                rotation={[0, side * 0.08, (index % 2 ? 1 : -1) * 0.3]}
                scale={[0.026, 0.062, 0.018]}
              >
                <sphereGeometry args={[1, 12, 8]} />
                <meshStandardMaterial color="#231013" roughness={0.72} />
              </mesh>
            );
          })}
        </group>
      ))}
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
  const pressureRef = useRef(0);
  const holding = useRef(false);
  const burstRef = useRef(false);
  const completionSent = useRef(false);
  const lastPublished = useRef(0);
  const lastDamageStage = useRef(0);
  const [hovered, setHovered] = useState(false);
  const [pressure, setPressure] = useState(0);
  const [burst, setBurst] = useState(false);
  const [damages, setDamages] = useState<Damage[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const fleshTexture = useMemo(createFleshTexture, []);

  useEffect(() => () => fleshTexture.dispose(), [fleshTexture]);
  useEffect(() => {
    document.body.style.cursor = hovered ? "crosshair" : "default";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [hovered]);

  const addPressure = useCallback((amount: number) => {
    if (burstRef.current) return;
    const previous = pressureRef.current;
    const next = clamp(previous + amount);
    pressureRef.current = next;
    const stage = Math.min(5, Math.ceil(next * 5));
    if (stage > lastDamageStage.current) {
      lastDamageStage.current = stage;
      const side = stage % 2 === 0 ? -1 : 1;
      const point = new THREE.Vector3(side * (0.88 - stage * 0.025), 0.15 - stage * 0.07, 0.44).normalize();
      const id = performance.now() + stage;
      setDamages((current) => [...current, {
        id,
        point: point.toArray() as [number, number, number],
        normal: point.toArray() as [number, number, number],
        radius: 0.035 + stage * 0.018,
        angle: side * (0.3 + stage * 0.24),
      }]);
      setBursts((current) => [...current.slice(-2), {
        id,
        origin: point.clone().multiplyScalar(1.02).toArray() as [number, number, number],
        normal: [0, 0.15, 1],
        power: 0.38 + stage * 0.055,
      }]);
      onFeedback("fruit", 0.34 + stage * 0.1);
    }
    if (next - lastPublished.current >= 0.018 || next === 1) {
      lastPublished.current = next;
      setPressure(next);
      onProgress(next, stage);
    }
    if (next >= 1 && !completionSent.current) {
      completionSent.current = true;
      burstRef.current = true;
      holding.current = false;
      setPressure(1);
      setBurst(true);
      onProgress(1, 5);
      onFeedback("fruit", 1);
      onComplete();
    }
  }, [onComplete, onFeedback, onProgress]);

  useFrame((state, delta) => {
    if (holding.current && !burstRef.current) addPressure(delta * 0.46);
    if (!fruitRig.current) return;
    const squeeze = smoothstep(0.02, 1, pressureRef.current);
    const pulse = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 11) * squeeze * 0.008;
    fruitRig.current.scale.x = 1.04 * (1 - squeeze * 0.29) + pulse;
    fruitRig.current.scale.y = 1.05 * (1 + squeeze * 0.11);
    fruitRig.current.scale.z = 0.99 * (1 + squeeze * 0.09);
    fruitRig.current.rotation.z = Math.sin(state.clock.elapsedTime * 9) * squeeze * (reducedMotion ? 0.002 : 0.014);
    fruitRig.current.position.y = -0.02 - squeeze * 0.055;
    fruitRig.current.visible = !burstRef.current;
    if (shell.current) shell.current.visible = !burstRef.current;
  });

  const onPointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    onObjectTouch();
    if (burstRef.current) {
      const id = performance.now();
      setBursts((current) => [...current.slice(-3), { id, origin: [0, -0.03, 0.82], normal: [0, 0.2, 1], power: 0.72 }]);
      onFeedback("fruit", 0.58);
      return;
    }
    holding.current = true;
    addPressure(0.19);
  }, [addPressure, onFeedback, onObjectTouch]);

  const onPointerUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    holding.current = false;
  }, []);

  return (
    <group>
      <CourtyardSet />
      <StrongmanCharacter pressure={pressure} burst={burst} reducedMotion={reducedMotion} />
      <WatermelonStand />
      <group ref={fruitRig} position={[0, -0.02, 0.34]}>
        <mesh scale={[0.86, 0.9, 0.83]}>
          <sphereGeometry args={[0.91, 72, 72]} />
          <meshPhysicalMaterial
            map={fleshTexture}
            color="#e04752"
            roughness={0.56}
            clearcoat={0.08}
            bumpMap={fleshTexture}
            bumpScale={0.008}
          />
        </mesh>
        <mesh
          ref={shell}
          scale={[0.86, 0.9, 0.83]}
          castShadow
          receiveShadow
        >
          <sphereGeometry args={[1, 80, 80]} />
          <WatermelonShellMaterial damages={damages} />
          {damages.map((damage) => (
            <DamageMark key={damage.id} damage={damage} />
          ))}
          {bursts.map((burst) => (
            <FruitBurst key={burst.id} burst={burst} reducedMotion={reducedMotion} />
          ))}
        </mesh>
        {!burst && <mesh position={[0, 0.93, 0]} rotation={[0.08, 0, -0.22]} castShadow>
          <cylinderGeometry args={[0.045, 0.075, 0.23, 12]} />
          <meshStandardMaterial color="#51472a" roughness={0.9} />
        </mesh>}
      </group>
      <WatermelonSplit active={burst} reducedMotion={reducedMotion} />
      <mesh
        position={[0, -0.02, 0.36]}
        scale={[1.06, 1.1, 1.02]}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
        onPointerOut={() => { if (!holding.current) setHovered(false); }}
      >
        <sphereGeometry args={[0.92, 28, 24]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>
    </group>
  );
}

type BarSegment = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
};

function makeBarSegments(bend: number, zOffset = 0) {
  const count = 38;
  const points = Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const arch = Math.sin(t * Math.PI);
    const elastic = arch * bend * 1.22;
    const plasticKink = Math.pow(arch, 7) * Math.max(0, bend - 0.52) * 1.2;
    const openBar = new THREE.Vector3(-2.28 + t * 4.56, elastic + plasticKink, zOffset + Math.sin(t * Math.PI * 2) * bend * 0.035);
    const wrap = smoothstep(0.48, 0.98, bend);
    const angle = -Math.PI / 2 + t * Math.PI * 2;
    const coil = new THREE.Vector3(
      -0.68 + Math.cos(angle) * (0.61 + Math.abs(zOffset) * 0.14),
      0.08 + Math.sin(angle) * (0.66 + Math.abs(zOffset) * 0.12),
      0.22 + zOffset + Math.sin(angle * 2) * 0.055,
    );
    return openBar.lerp(coil, wrap);
  });
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
  const [bend, setBend] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, bend: 0 });
  const permanent = useRef(0);
  const completionSent = useRef(false);
  const frontSegments = useMemo(() => makeBarSegments(bend, 0.17), [bend]);
  const backSegments = useMemo(() => makeBarSegments(bend, -0.17), [bend]);
  const handlePoint = frontSegments[Math.floor(frontSegments.length / 2)]?.position ?? new THREE.Vector3();

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const applySegments = (mesh: THREE.InstancedMesh | null, segments: BarSegment[]) => {
      if (!mesh) return;
      segments.forEach((segment, index) => {
        matrix.compose(segment.position, segment.quaternion, new THREE.Vector3(1, segment.length, 1));
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    applySegments(frontBar.current, frontSegments);
    applySegments(backBar.current, backSegments);
  }, [frontSegments, backSegments]);

  useEffect(() => {
    document.body.style.cursor = dragging ? "grabbing" : "default";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [dragging]);

  useFrame((state) => {
    if (!rig.current) return;
    rig.current.rotation.z = bend > 0.55 ? Math.sin(state.clock.elapsedTime * 46) * bend * 0.0018 : 0;
  });

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    onObjectTouch();
    dragStart.current = { y: event.nativeEvent.clientY, bend };
    setDragging(true);
    onFeedback("metal", 0.32);
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    event.stopPropagation();
    const travel = dragStart.current.y - event.nativeEvent.clientY;
    const resistance = travel <= 60 ? travel / 430 : 0.14 + (travel - 60) / 250;
    const next = clamp(Math.max(permanent.current, dragStart.current.bend + resistance));
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
    if (!dragging) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    setDragging(false);
    permanent.current = Math.max(permanent.current, bend > 0.62 ? bend : bend * 0.3);
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

      <instancedMesh ref={frontBar} args={[undefined, undefined, frontSegments.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.078, 0.078, 1, 14]} />
        <meshPhysicalMaterial color="#707575" metalness={0.9} roughness={0.34} clearcoat={0.2} />
      </instancedMesh>
      <instancedMesh ref={backBar} args={[undefined, undefined, backSegments.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.078, 0.078, 1, 14]} />
        <meshPhysicalMaterial color="#545a5a" metalness={0.88} roughness={0.38} clearcoat={0.18} />
      </instancedMesh>

      <group position={handlePoint}>
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
      </group>

      {bend > 0.72 && (
        <Sparkles
          count={Math.round(8 + bend * 9)}
          scale={[1.35, 0.85, 0.6]}
          position={handlePoint}
          size={2.4}
          speed={0.9}
          color="#f0ff79"
          opacity={0.68}
        />
      )}
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

function Wheel({ position, far = false }: { position: [number, number, number]; far?: boolean }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
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
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  dragging: boolean;
};

function CarModel({ lift, onPointerDown, onPointerMove, onPointerUp, dragging }: CarModelProps) {
  const shapes = useMemo(createCarShapes, []);
  const angle = 0.015 + smoothstep(0.08, 1, lift) * 0.31;
  const axleRise = Math.sin(angle) * 2.7;
  const groundCompensation = axleRise * (1 - smoothstep(0.34, 0.63, lift));
  const rearWheelY = -0.56 - groundCompensation;
  const paint = "#d8d7cf";

  return (
    <group position={[-1.35, -0.75, 0]} rotation-z={angle}>
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

        <Suspension x={-1.35} wheelY={-0.56} z={0.64} />
        <Suspension x={1.35} wheelY={rearWheelY} z={0.64} />
        <Wheel position={[-1.35, -0.56, 0.67]} />
        <Wheel position={[-1.35, -0.56, -0.08]} far />
        <Wheel position={[1.35, rearWheelY, 0.67]} />
        <Wheel position={[1.35, rearWheelY, -0.08]} far />

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
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, lift: 0 });
  const completionSent = useRef(false);

  useEffect(() => {
    document.body.style.cursor = dragging ? "grabbing" : "default";
    return () => {
      document.body.style.cursor = "default";
    };
  }, [dragging]);

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    onObjectTouch();
    dragStart.current = { y: event.nativeEvent.clientY, lift };
    setDragging(true);
    onFeedback("car", 0.28);
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    event.stopPropagation();
    const travel = dragStart.current.y - event.nativeEvent.clientY;
    const next = clamp(dragStart.current.lift + travel / 300);
    setLift(next);
    onProgress(next);
    if (Math.floor(next * 14) !== Math.floor(lift * 14)) onFeedback("car", next);
    if (next >= 0.9 && !completionSent.current) {
      completionSent.current = true;
      onComplete();
    }
  };

  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    setDragging(false);
    const settled = lift > 0.55 ? lift : lift * 0.38;
    setLift(settled);
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
        dragging={dragging}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      </group>
    </group>
  );
}

function CameraRig({ challenge, reducedMotion }: { challenge: ChallengeNumber; reducedMotion: boolean }) {
  const { camera } = useThree();
  const target = useMemo(() => {
    if (challenge === 1) return new THREE.Vector3(0, 0.32, 7.15);
    if (challenge === 2) return new THREE.Vector3(0, 0.25, 7.05);
    return new THREE.Vector3(0, 0.55, 7.6);
  }, [challenge]);

  useFrame((state, delta) => {
    camera.position.lerp(target, reducedMotion ? 1 : 1 - Math.exp(-delta * 3.6));
    camera.lookAt(0, challenge === 3 ? -0.08 : -0.12, 0);
    if (!reducedMotion) {
      const pointerAmount = challenge === 1 ? 0.11 : 0.07;
      camera.position.x += (state.pointer.x * pointerAmount - camera.position.x * 0.012) * delta;
      camera.position.y += state.pointer.y * pointerAmount * delta;
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
  const targetWidth = challenge === 3 ? 6.5 : challenge === 2 ? 6.25 : 5.25;
  const scale = Math.min(1, viewport.width / targetWidth);
  return <group scale={scale}>{children}</group>;
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
        position={[0, -1.18, 0]}
        opacity={0.33}
        scale={8.5}
        blur={2.6}
        far={4.3}
        resolution={reducedMotion ? 128 : 256}
        frames={reducedMotion ? 1 : undefined}
        color="#353830"
      />
    </>
  );
}

export default function ChallengeCanvas({
  challenge,
  reducedMotion,
  onProgress,
  onComplete,
  onFeedback,
  onObjectTouch,
}: ChallengeCanvasProps) {
  return (
    <Canvas
      className="challenge-canvas"
      dpr={[1, 1.7]}
      camera={{ fov: 35, near: 0.1, far: 60, position: [0, 0.3, 6.8] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      shadows
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
      }}
    >
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
      </ResponsiveStage>
    </Canvas>
  );
}
