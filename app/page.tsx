"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChallengeNumber, FeedbackKind } from "../components/ChallengeCanvas";

const ChallengeCanvas = dynamic(() => import("../components/ChallengeCanvas"), {
  ssr: false,
  loading: () => <div className="canvas-loading" aria-hidden="true" />,
});

type BrowserAudioContext = typeof AudioContext;
type AudioWindow = Window & { webkitAudioContext?: BrowserAudioContext };

let sharedAudioContext: AudioContext | null = null;
let sharedNoise: AudioBuffer | null = null;

function audioContext() {
  if (typeof window === "undefined") return null;
  const Context = window.AudioContext || (window as AudioWindow).webkitAudioContext;
  if (!Context) return null;
  if (!sharedAudioContext) sharedAudioContext = new Context();
  if (sharedAudioContext.state === "suspended") void sharedAudioContext.resume();
  return sharedAudioContext;
}

function noiseBuffer(context: AudioContext) {
  if (sharedNoise && sharedNoise.sampleRate === context.sampleRate) return sharedNoise;
  const length = Math.round(context.sampleRate * 0.55);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    channel[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 1.4);
  }
  sharedNoise = buffer;
  return buffer;
}

function envelope(gain: GainNode, now: number, peak: number, attack: number, duration: number) {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
}

function synthFeedback(kind: FeedbackKind | "complete" | "transition", intensity = 0.5) {
  const context = audioContext();
  if (!context) return;
  const now = context.currentTime;

  if (kind === "fruit") {
    const impact = context.createOscillator();
    const impactGain = context.createGain();
    impact.type = "sine";
    impact.frequency.setValueAtTime(118 - intensity * 26, now);
    impact.frequency.exponentialRampToValueAtTime(48, now + 0.13);
    impact.connect(impactGain).connect(context.destination);
    envelope(impactGain, now, 0.22 + intensity * 0.08, 0.004, 0.17);
    impact.start(now);
    impact.stop(now + 0.19);

    const wet = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const wetGain = context.createGain();
    wet.buffer = noiseBuffer(context);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(560 + intensity * 520, now);
    filter.Q.value = 0.7;
    wet.connect(filter).connect(wetGain).connect(context.destination);
    envelope(wetGain, now + 0.008, 0.09 + intensity * 0.08, 0.003, 0.15);
    wet.start(now + 0.008);
    wet.stop(now + 0.2);
  }

  if (kind === "metal") {
    const metal = context.createOscillator();
    const overtone = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    metal.type = "sawtooth";
    overtone.type = "triangle";
    metal.frequency.setValueAtTime(92 + intensity * 70, now);
    metal.frequency.exponentialRampToValueAtTime(54, now + 0.26);
    overtone.frequency.setValueAtTime(410 + intensity * 680, now);
    overtone.frequency.exponentialRampToValueAtTime(170, now + 0.24);
    filter.type = "lowpass";
    filter.frequency.value = 1300;
    filter.Q.value = 8;
    metal.connect(filter);
    overtone.connect(filter);
    filter.connect(gain).connect(context.destination);
    envelope(gain, now, 0.055 + intensity * 0.04, 0.01, 0.29);
    metal.start(now);
    overtone.start(now);
    metal.stop(now + 0.31);
    overtone.stop(now + 0.31);
  }

  if (kind === "car") {
    const low = context.createOscillator();
    const spring = context.createOscillator();
    const gain = context.createGain();
    const springGain = context.createGain();
    low.type = "sine";
    low.frequency.setValueAtTime(64, now);
    low.frequency.exponentialRampToValueAtTime(38, now + 0.22);
    spring.type = "triangle";
    spring.frequency.setValueAtTime(220 + intensity * 85, now + 0.02);
    spring.frequency.exponentialRampToValueAtTime(96, now + 0.25);
    low.connect(gain).connect(context.destination);
    spring.connect(springGain).connect(context.destination);
    envelope(gain, now, 0.13, 0.006, 0.24);
    envelope(springGain, now + 0.02, 0.035 + intensity * 0.025, 0.01, 0.28);
    low.start(now);
    spring.start(now + 0.02);
    low.stop(now + 0.27);
    spring.stop(now + 0.31);
  }

  if (kind === "complete") {
    [0, 0.08, 0.19].forEach((offset, index) => {
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.type = index === 2 ? "sine" : "triangle";
      tone.frequency.value = [392, 523.25, 783.99][index];
      tone.connect(gain).connect(context.destination);
      envelope(gain, now + offset, 0.075, 0.012, 0.32 + index * 0.07);
      tone.start(now + offset);
      tone.stop(now + offset + 0.45);
    });
  }

  if (kind === "transition") {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer(context);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(260, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.38);
    filter.Q.value = 0.5;
    source.connect(filter).connect(gain).connect(context.destination);
    envelope(gain, now, 0.08, 0.06, 0.43);
    source.start(now);
    source.stop(now + 0.46);
  }
}

const challengeContent = {
  1: {
    index: "01",
    category: "GRIP / PRESSURE",
    lead: "CRUSH",
    tail: "IT.",
    instruction: "HOLD OR TAP THE WATERMELON",
  },
  2: {
    index: "02",
    category: "STEEL / RESISTANCE",
    lead: "BEND",
    tail: "IT.",
    instruction: "GRAB THE LIME JOINT · PULL UP",
  },
  3: {
    index: "03",
    category: "MASS / SUSPENSION",
    lead: "LIFT",
    tail: "IT.",
    instruction: "GRAB THE REAR · PULL UP",
  },
} as const;

function watermelonState(progress: number) {
  if (progress === 0) return "GRIP READY";
  if (progress < 0.25) return "HANDS LOCKED";
  if (progress < 0.52) return "RIND COMPRESSING";
  if (progress < 0.78) return "PRESSURE CRITICAL";
  if (progress < 1) return "STRUCTURAL FAILURE";
  return "WATERMELON OBLITERATED";
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export default function Home() {
  const [challenge, setChallenge] = useState<ChallengeNumber>(1);
  const [progress, setProgress] = useState(0);
  const [hits, setHits] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const completionRef = useRef(false);
  const transitionTimers = useRef<number[]>([]);
  const reducedMotion = useReducedMotion();
  const content = challengeContent[challenge];

  useEffect(
    () => () => {
      transitionTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const feedback = useCallback(
    (kind: FeedbackKind, intensity: number) => {
      if (soundEnabled) synthFeedback(kind, intensity);
      if (typeof navigator !== "undefined" && "vibrate" in navigator && intensity > 0.58) {
        navigator.vibrate(kind === "fruit" ? 12 : 8);
      }
    },
    [soundEnabled],
  );

  const handleProgress = useCallback((value: number, detail?: number) => {
    setProgress(value);
    if (typeof detail === "number") setHits(detail);
  }, []);

  const handleComplete = useCallback(() => {
    if (completionRef.current) return;
    completionRef.current = true;
    setCompleted(true);
    if (soundEnabled) synthFeedback("complete", 1);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([24, 35, 42]);
  }, [soundEnabled]);

  const advance = () => {
    if (transitioning) return;
    setTransitioning(true);
    if (soundEnabled) synthFeedback("transition", 0.8);
    const switchDelay = reducedMotion ? 60 : 280;
    const finishDelay = reducedMotion ? 180 : 760;
    transitionTimers.current.push(
      window.setTimeout(() => {
        setChallenge((current) => (current === 3 ? 1 : ((current + 1) as ChallengeNumber)));
        setProgress(0);
        setHits(0);
        setCompleted(false);
        completionRef.current = false;
      }, switchDelay),
      window.setTimeout(() => setTransitioning(false), finishDelay),
    );
  };

  const status = useMemo(() => {
    if (challenge === 1) return watermelonState(progress);
    if (challenge === 2) return progress > 0.87 ? "PERMANENT DEFORMATION" : `LOAD ${(progress * 100).toFixed(0)}%`;
    if (progress < 0.26) return "SUSPENSION LOADED";
    if (progress < 0.62) return "REAR AXLE UNWEIGHTED";
    return progress > 0.88 ? "REAR WHEELS CLEAR" : "CHASSIS ROTATING";
  }, [challenge, progress]);

  const progressValue = progress;

  return (
    <main className={`experience challenge-${challenge} ${transitioning ? "is-transitioning" : ""}`}>
      <div className="ambient-orb ambient-orb-a" />
      <div className="ambient-orb ambient-orb-b" />
      <div className="grain" />

      <header className="topbar">
        <a className="brand" href="#experience" aria-label="Impossible challenge lab home">
          <span className="brand-mark">I</span>
          <span>IMPOSSIBLE</span>
        </a>
        <div className="topbar-meta" aria-hidden="true">
          PHYSICAL CHALLENGE LAB <span>—</span> 2026
        </div>
        <button
          type="button"
          className="sound-toggle"
          aria-pressed={soundEnabled}
          onClick={() => setSoundEnabled((current) => !current)}
        >
          <span className={`sound-bars ${soundEnabled ? "is-active" : ""}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          SOUND {soundEnabled ? "ON" : "OFF"}
        </button>
      </header>

      <nav className="challenge-rail" aria-label="Challenge progress">
        {[1, 2, 3].map((step) => (
          <div key={step} className={`rail-step ${step === challenge ? "is-current" : ""} ${step < challenge ? "is-past" : ""}`}>
            <span>0{step}</span>
            <i />
          </div>
        ))}
      </nav>

      <section id="experience" className="scene" aria-labelledby="challenge-title">
        <div className="scene-number" aria-hidden="true">
          {content.index}
        </div>

        <div className="scene-copy" key={`copy-${challenge}`}>
          <p className="eyebrow">TEST {content.index} · {content.category}</p>
          <h1 id="challenge-title">
            <span>{content.lead}</span> {content.tail}
          </h1>
        </div>

        <div className="canvas-shell">
          <ChallengeCanvas
            challenge={challenge}
            reducedMotion={reducedMotion}
            onProgress={handleProgress}
            onComplete={handleComplete}
            onFeedback={feedback}
          />
        </div>

        <div className="interaction-cursor" aria-hidden="true">
          <span />
        </div>
      </section>

      <footer className="bottom-ui">
        <div className="instruction-block">
          <span className="instruction-icon" aria-hidden="true">
            {challenge === 1 ? "＋" : "↟"}
          </span>
          <div>
            <p>{content.instruction}</p>
            <span>{challenge === 1 ? "BUILD PRESSURE · MAKE HIM CRUSH IT" : "FORCE IS PERMANENT AFTER YIELD"}</span>
          </div>
        </div>

        <div className="readout" role="status" aria-live="polite">
          <div className="readout-head">
            <span>{status}</span>
            <b>{challenge === 1 ? `${Math.round(progress * 100)}% GRIP` : `${Math.round(progress * 100)}%`}</b>
          </div>
          <div className="progress-track">
            <i style={{ transform: `scaleX(${progressValue})` }} />
          </div>
        </div>

        <div className="next-slot">
          {completed ? (
            <button type="button" className="next-button" onClick={advance}>
              <span>{challenge === 3 ? "RUN IT AGAIN" : "NEXT CHALLENGE"}</span>
              <i aria-hidden="true">↗</i>
            </button>
          ) : (
            <span className="completion-target">TARGET · {challenge === 1 ? "100% CRUSH" : challenge === 2 ? "88% BEND" : "90% LIFT"}</span>
          )}
        </div>
      </footer>

      <div className="transition-wipe" aria-hidden="true" />
    </main>
  );
}
