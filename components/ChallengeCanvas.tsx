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
    const count = reducedMotion ? 8 : 15;
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

function WatermelonChallenge({
  reducedMotion,
  onProgress,
  onComplete,
  onFeedback,
}: Omit<ChallengeCanvasProps, "challenge">) {
  const shell = useRef<THREE.Mesh>(null);
  const rig = useRef<THREE.Group>(null);
  const velocity = useRef(new THREE.Vector3());
  const angularVelocity = useRef(new THREE.Vector3());
  const [hovered, setHovered] = useState(false);
  const [hits, setHits] = useState(0);
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

  useFrame((state, delta) => {
    const group = rig.current;
    if (!group) return;
    const damp = Math.exp(-delta * 8.2);
    velocity.current.multiplyScalar(damp);
    angularVelocity.current.multiplyScalar(Math.exp(-delta * 7.2));
    group.position.addScaledVector(velocity.current, delta);
    group.rotation.x += angularVelocity.current.x * delta;
    group.rotation.y += angularVelocity.current.y * delta;
    group.rotation.z += angularVelocity.current.z * delta;
    group.position.lerp(new THREE.Vector3(0, -0.08 + Math.sin(state.clock.elapsedTime * 1.2) * (reducedMotion ? 0 : 0.025), 0), 1 - Math.exp(-delta * 5));
    group.rotation.x = THREE.MathUtils.damp(group.rotation.x, -0.05, 4, delta);
    group.rotation.y = THREE.MathUtils.damp(group.rotation.y, state.clock.elapsedTime * 0.08, 3, delta);
    group.rotation.z = THREE.MathUtils.damp(group.rotation.z, 0.035, 4, delta);
    const targetScale = hovered ? 1.035 : 1;
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, targetScale, 8, delta));
  });

  const handleImpact = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      if (!shell.current) return;
      const point = shell.current.worldToLocal(event.point.clone());
      const normal = point.clone().normalize();
      const nextHit = hits + 1;
      const damageRadius = nextHit === 1 ? 0 : Math.min(0.225, 0.045 + nextHit * 0.014);
      const id = performance.now() + nextHit;

      setDamages((current) => {
        if (current.length < MAX_DAMAGE) {
          return [
            ...current,
            {
              id,
              point: point.toArray() as [number, number, number],
              normal: normal.toArray() as [number, number, number],
              radius: damageRadius,
              angle: ((nextHit * 2.17) % Math.PI) - Math.PI / 2,
            },
          ];
        }
        let nearestIndex = 0;
        let nearestDistance = Infinity;
        current.forEach((damage, index) => {
          const distance = new THREE.Vector3(...damage.point).distanceTo(point);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
          }
        });
        return current.map((damage, index) =>
          index === nearestIndex ? { ...damage, radius: Math.min(0.285, damage.radius + 0.035) } : damage,
        );
      });
      setBursts((current) => [
        ...current.slice(-3),
        {
          id,
          origin: point.clone().multiplyScalar(1.03).toArray() as [number, number, number],
          normal: normal.toArray() as [number, number, number],
          power: 0.75 + Math.min(nextHit, 9) * 0.045,
        },
      ]);
      setHits(nextHit);
      onProgress(Math.min(nextHit / 12, 1), nextHit);
      onFeedback("fruit", Math.min(1, 0.35 + nextHit * 0.07));
      velocity.current.addScaledVector(normal, -0.32 - nextHit * 0.014);
      angularVelocity.current.set((normal.y + 0.15) * 1.2, -normal.x * 1.35, normal.x * 1.55);
      if (nextHit === 5) onComplete();
    },
    [hits, onComplete, onFeedback, onProgress],
  );

  return (
    <group position={[0, 0.02, 0]}>
      <group ref={rig}>
        <mesh scale={[1.09, 1.18, 1.03]}>
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
          scale={[1.1, 1.2, 1.04]}
          castShadow
          receiveShadow
          onClick={handleImpact}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        >
          <sphereGeometry args={[1, 96, 96]} />
          <WatermelonShellMaterial damages={damages} />
          {damages.map((damage) => (
            <DamageMark key={damage.id} damage={damage} />
          ))}
          {bursts.map((burst) => (
            <FruitBurst key={burst.id} burst={burst} reducedMotion={reducedMotion} />
          ))}
        </mesh>
        <mesh position={[0, 1.18, 0]} rotation={[0.08, 0, -0.22]} castShadow>
          <cylinderGeometry args={[0.045, 0.075, 0.23, 12]} />
          <meshStandardMaterial color="#51472a" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

type BarSegment = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
};

function makeBarSegments(bend: number) {
  const count = 34;
  const points = Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const elastic = Math.pow(t, 2.15) * bend * 1.65;
    const kink = Math.max(0, t - 0.58) * Math.max(0, bend - 0.56) * 1.6;
    return new THREE.Vector3(-2.45 + t * 4.9, elastic + kink, Math.sin(t * Math.PI) * bend * 0.09);
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

function MetalChallenge({ onProgress, onComplete, onFeedback }: Omit<ChallengeCanvasProps, "challenge" | "reducedMotion">) {
  const bar = useRef<THREE.InstancedMesh>(null);
  const rig = useRef<THREE.Group>(null);
  const [bend, setBend] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, bend: 0 });
  const permanent = useRef(0);
  const completionSent = useRef(false);
  const segments = useMemo(() => makeBarSegments(bend), [bend]);
  const endPoint = useMemo(() => {
    const end = makeBarSegments(bend).at(-1)!;
    const tip = new THREE.Vector3(0, end.length * 0.5, 0).applyQuaternion(end.quaternion).add(end.position);
    return tip;
  }, [bend]);

  useLayoutEffect(() => {
    if (!bar.current) return;
    const matrix = new THREE.Matrix4();
    segments.forEach((segment, index) => {
      matrix.compose(segment.position, segment.quaternion, new THREE.Vector3(1, segment.length, 1));
      bar.current!.setMatrixAt(index, matrix);
    });
    bar.current.instanceMatrix.needsUpdate = true;
  }, [segments]);

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
    <group ref={rig} position={[0, -0.3, 0]} rotation={[0.02, -0.14, -0.05]}>
      <group position={[-2.58, -0.02, 0]}>
        <RoundedBox args={[0.42, 0.9, 0.78]} radius={0.08} smoothness={4} castShadow receiveShadow>
          <meshStandardMaterial color="#242728" roughness={0.46} metalness={0.78} />
        </RoundedBox>
        <mesh position={[0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.23, 0.23, 0.35, 24]} />
          <meshPhysicalMaterial color="#777d7e" metalness={0.96} roughness={0.24} />
        </mesh>
        <mesh position={[-0.28, -0.68, 0]} castShadow>
          <boxGeometry args={[0.75, 0.42, 1.05]} />
          <meshStandardMaterial color="#1a1d1e" roughness={0.58} metalness={0.62} />
        </mesh>
      </group>

      <instancedMesh ref={bar} args={[undefined, undefined, segments.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.105, 0.105, 1, 20]} />
        <meshPhysicalMaterial color="#aeb4b4" metalness={0.98} roughness={0.2} clearcoat={0.38} />
      </instancedMesh>

      <group position={endPoint}>
        <mesh
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          castShadow
        >
          <sphereGeometry args={[0.235, 30, 30]} />
          <meshPhysicalMaterial
            color={dragging ? "#dfff37" : "#202526"}
            metalness={0.84}
            roughness={0.25}
            clearcoat={0.5}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.34, 0.018, 12, 48]} />
          <meshBasicMaterial color="#dfff37" transparent opacity={dragging ? 0.95 : 0.5} />
        </mesh>
      </group>

      {bend > 0.72 && (
        <Sparkles
          count={Math.round(8 + bend * 9)}
          scale={[1.35, 0.85, 0.6]}
          position={[0.75, 0.5 + bend * 0.4, 0]}
          size={2.4}
          speed={0.9}
          color="#f0ff79"
          opacity={0.68}
        />
      )}
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

function CarChallenge({ onProgress, onComplete, onFeedback }: Omit<ChallengeCanvasProps, "challenge" | "reducedMotion">) {
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
    <group position={[0, -0.1, 0]} rotation={[0.04, -0.18, 0]}>
      <CarModel
        lift={lift}
        dragging={dragging}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </group>
  );
}

function CameraRig({ challenge, reducedMotion }: { challenge: ChallengeNumber; reducedMotion: boolean }) {
  const { camera } = useThree();
  const target = useMemo(() => {
    if (challenge === 1) return new THREE.Vector3(0, 0.25, 5.5);
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
  const targetWidth = challenge === 3 ? 6.5 : challenge === 2 ? 6.25 : 4.7;
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
          />
        )}
        {challenge === 2 && (
          <MetalChallenge onProgress={onProgress} onComplete={onComplete} onFeedback={onFeedback} />
        )}
        {challenge === 3 && (
          <CarChallenge onProgress={onProgress} onComplete={onComplete} onFeedback={onFeedback} />
        )}
      </ResponsiveStage>
    </Canvas>
  );
}
