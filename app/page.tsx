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

let carStrain: {
  osc: OscillatorNode;
  growl: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
} | null = null;

function setCarStrain(intensity: number) {
  const context = audioContext();
  if (!context) return;
  const now = context.currentTime;
  if (intensity <= 0.02) {
    if (!carStrain) return;
    const nodes = carStrain;
    carStrain = null;
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    window.setTimeout(() => {
      try {
        nodes.osc.stop();
        nodes.growl.stop();
        nodes.osc.disconnect();
        nodes.growl.disconnect();
        nodes.filter.disconnect();
        nodes.gain.disconnect();
      } catch {
        /* already stopped */
      }
    }, 220);
    return;
  }
  if (!carStrain) {
    const osc = context.createOscillator();
    const growl = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    osc.type = "sawtooth";
    growl.type = "triangle";
    filter.type = "lowpass";
    filter.Q.value = 6;
    osc.connect(filter);
    growl.connect(filter);
    filter.connect(gain).connect(context.destination);
    gain.gain.setValueAtTime(0.0001, now);
    osc.start(now);
    growl.start(now);
    carStrain = { osc, growl, gain, filter };
  }
  carStrain.osc.frequency.setTargetAtTime(38 + intensity * 26, now, 0.08);
  carStrain.growl.frequency.setTargetAtTime(72 + intensity * 48, now, 0.08);
  carStrain.filter.frequency.setTargetAtTime(280 + intensity * 420, now, 0.1);
  carStrain.gain.gain.setTargetAtTime(0.03 + intensity * 0.055, now, 0.08);
}

function synthFeedback(kind: FeedbackKind | "complete" | "transition", intensity = 0.5) {
  if (kind === "car-strain") {
    setCarStrain(intensity);
    return;
  }
  const context = audioContext();
  if (!context) return;
  const now = context.currentTime;

  if (kind === "fruit") {
    const impact = context.createOscillator();
    const impactGain = context.createGain();
    impact.type = "sine";
    impact.frequency.setValueAtTime(132 - intensity * 48, now);
    impact.frequency.exponentialRampToValueAtTime(36, now + 0.18);
    impact.connect(impactGain).connect(context.destination);
    envelope(impactGain, now, 0.24 + intensity * 0.1, 0.003, 0.22);
    impact.start(now);
    impact.stop(now + 0.24);

    const wet = context.createBufferSource();
    const wetFilter = context.createBiquadFilter();
    const wetGain = context.createGain();
    wet.buffer = noiseBuffer(context);
    wetFilter.type = "bandpass";
    wetFilter.frequency.setValueAtTime(480 + intensity * 640, now);
    wetFilter.Q.value = 0.55;
    wet.connect(wetFilter).connect(wetGain).connect(context.destination);
    envelope(wetGain, now + 0.004, 0.14 + intensity * 0.12, 0.002, 0.22);
    wet.start(now);
    wet.stop(now + 0.26);

    const crunch = context.createBufferSource();
    const crunchFilter = context.createBiquadFilter();
    const crunchGain = context.createGain();
    crunch.buffer = noiseBuffer(context);
    crunchFilter.type = "highpass";
    crunchFilter.frequency.value = 1400;
    crunch.connect(crunchFilter).connect(crunchGain).connect(context.destination);
    envelope(crunchGain, now + 0.01, 0.07 + intensity * 0.06, 0.001, 0.09);
    crunch.start(now + 0.01);
    crunch.stop(now + 0.12);
  }

  if (kind === "metal") {
    const metal = context.createOscillator();
    const overtone = context.createOscillator();
    const ring = context.createOscillator();
    const filter = context.createBiquadFilter();
    const delay = context.createDelay();
    const feedback = context.createGain();
    const gain = context.createGain();
    metal.type = "sawtooth";
    overtone.type = "triangle";
    ring.type = "sine";
    metal.frequency.setValueAtTime(88 + intensity * 90, now);
    metal.frequency.exponentialRampToValueAtTime(48, now + 0.42);
    overtone.frequency.setValueAtTime(390 + intensity * 820, now);
    overtone.frequency.exponentialRampToValueAtTime(150, now + 0.38);
    ring.frequency.setValueAtTime(980 + intensity * 420, now);
    ring.frequency.exponentialRampToValueAtTime(220, now + 0.5);
    filter.type = "lowpass";
    filter.frequency.value = 1600 + intensity * 800;
    filter.Q.value = 7;
    delay.delayTime.value = 0.048;
    feedback.gain.value = 0.32;
    metal.connect(filter);
    overtone.connect(filter);
    ring.connect(gain);
    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    filter.connect(gain);
    delay.connect(gain);
    gain.connect(context.destination);
    envelope(gain, now, 0.07 + intensity * 0.05, 0.008, 0.52);
    metal.start(now);
    overtone.start(now);
    ring.start(now);
    metal.stop(now + 0.54);
    overtone.stop(now + 0.54);
    ring.stop(now + 0.54);
  }

  if (kind === "car") {
    const low = context.createOscillator();
    const spring = context.createOscillator();
    const thump = context.createBufferSource();
    const gain = context.createGain();
    const springGain = context.createGain();
    const thumpGain = context.createGain();
    const thumpFilter = context.createBiquadFilter();
    low.type = "sine";
    low.frequency.setValueAtTime(58, now);
    low.frequency.exponentialRampToValueAtTime(32, now + 0.28);
    spring.type = "triangle";
    spring.frequency.setValueAtTime(210 + intensity * 90, now + 0.02);
    spring.frequency.exponentialRampToValueAtTime(88, now + 0.32);
    thump.buffer = noiseBuffer(context);
    thumpFilter.type = "lowpass";
    thumpFilter.frequency.value = 180;
    low.connect(gain).connect(context.destination);
    spring.connect(springGain).connect(context.destination);
    thump.connect(thumpFilter).connect(thumpGain).connect(context.destination);
    envelope(gain, now, 0.15, 0.006, 0.3);
    envelope(springGain, now + 0.02, 0.04 + intensity * 0.03, 0.01, 0.34);
    envelope(thumpGain, now, 0.08 + intensity * 0.05, 0.004, 0.18);
    low.start(now);
    spring.start(now + 0.02);
    thump.start(now);
    low.stop(now + 0.32);
    spring.stop(now + 0.36);
    thump.stop(now + 0.22);
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
    category: "FINGER / IMPACT",
    lead: "OPEN",
    tail: "IT.",
    instruction: "CLICK THE RIND TO PUNCH A HOLE",
  },
  2: {
    index: "02",
    category: "REBAR / RAW FORCE",
    lead: "BEND",
    tail: "IT.",
    instruction: "GRAB THE REBAR · PULL IT UP",
  },
  3: {
    index: "03",
    category: "MASS / SUSPENSION",
    lead: "LIFT",
    tail: "IT.",
    instruction: "GRAB THE REAR · PULL UP",
  },
  4: {
    index: "04",
    category: "SPIKE / PUNCH",
    lead: "DRIVE",
    tail: "IT.",
    instruction: "PUNCH THE PLATE TO DRIVE THE ROD",
  },
} as const;

function watermelonState(_progress: number, hits: number) {
  if (hits === 0) return "AIM AND PUNCH";
  if (hits < 3) return "RIND SPLITTING";
  if (hits < 5) return "JUICE BREAKING THROUGH";
  return "UNLOCKED · KEEP CARVING";
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
  const [sceneReady, setSceneReady] = useState(false);
  const completionRef = useRef(false);
  const transitionTimers = useRef<number[]>([]);
  const realVoiceRef = useRef<HTMLAudioElement | null>(null);
  const spikeClipRef = useRef<HTMLAudioElement | null>(null);
  const spikeCompleteRef = useRef<HTMLAudioElement | null>(null);
  const bendStartRef = useRef<HTMLAudioElement | null>(null);
  const spikeClipPlayed = useRef(false);
  const bendClipPlayed = useRef(false);
  const reducedMotion = useReducedMotion();
  const content = challengeContent[challenge];

  useEffect(
    () => () => {
      transitionTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    const voice = new Audio("/audio/elmin-abi-bax-abi.m4a");
    voice.loop = false;
    voice.preload = "auto";
    voice.volume = 0.92;
    realVoiceRef.current = voice;
    const spike = new Audio("/audio/spike-first-hit.m4a");
    spike.loop = false;
    spike.preload = "auto";
    spike.volume = 1;
    spikeClipRef.current = spike;
    const spikeComplete = new Audio("/audio/spike-complete.m4a");
    spikeComplete.loop = false;
    spikeComplete.preload = "auto";
    spikeComplete.volume = 1;
    spikeCompleteRef.current = spikeComplete;
    const bendStart = new Audio("/audio/bend-start.m4a");
    bendStart.loop = false;
    bendStart.preload = "auto";
    bendStart.volume = 1;
    bendStartRef.current = bendStart;
    return () => {
      voice.pause();
      voice.removeAttribute("src");
      realVoiceRef.current = null;
      spike.pause();
      spike.removeAttribute("src");
      spikeClipRef.current = null;
      spikeComplete.pause();
      spikeComplete.removeAttribute("src");
      spikeCompleteRef.current = null;
      bendStart.pause();
      bendStart.removeAttribute("src");
      bendStartRef.current = null;
    };
  }, []);

  useEffect(() => {
    spikeClipPlayed.current = false;
    bendClipPlayed.current = false;
    setSceneReady(false);
    const fallback = window.setTimeout(() => setSceneReady(true), 2800);
    return () => window.clearTimeout(fallback);
  }, [challenge]);

  const playRealVoiceOnce = useCallback(() => {
    if (!soundEnabled || !realVoiceRef.current) return;
    realVoiceRef.current.currentTime = 0;
    void realVoiceRef.current.play().catch(() => undefined);
  }, [soundEnabled]);

  const handleObjectTouch = useCallback(() => {
    if (!soundEnabled) return;
    if (challenge === 2) {
      if (bendClipPlayed.current || !bendStartRef.current) return;
      bendClipPlayed.current = true;
      const clip = bendStartRef.current;
      let plays = 0;
      const playNext = () => {
        plays += 1;
        if (plays > 2) {
          clip.removeEventListener("ended", playNext);
          return;
        }
        clip.currentTime = 0;
        void clip.play().catch(() => undefined);
      };
      clip.addEventListener("ended", playNext);
      playNext();
      return;
    }
    if (challenge === 4) {
      if (!spikeClipPlayed.current && spikeClipRef.current) {
        spikeClipPlayed.current = true;
        spikeClipRef.current.currentTime = 0;
        void spikeClipRef.current.play().catch(() => undefined);
        return;
      }
    }
    playRealVoiceOnce();
  }, [challenge, playRealVoiceOnce, soundEnabled]);

  const feedback = useCallback(
    (kind: FeedbackKind, intensity: number) => {
      if (soundEnabled) {
        synthFeedback(kind, intensity);
      }
      if (kind === "car-strain") return;
      if (typeof navigator !== "undefined" && "vibrate" in navigator && intensity > 0.58) {
        navigator.vibrate(kind === "fruit" ? 18 : 8);
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
    if (soundEnabled) {
      synthFeedback("complete", 1);
      if (challenge === 4 && spikeCompleteRef.current) {
        spikeCompleteRef.current.currentTime = 0;
        void spikeCompleteRef.current.play().catch(() => undefined);
      }
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([24, 35, 42]);
  }, [challenge, soundEnabled]);

  const advance = () => {
    if (transitioning) return;
    setTransitioning(true);
    synthFeedback("car-strain", 0);
    if (soundEnabled) synthFeedback("transition", 0.8);
    const switchDelay = reducedMotion ? 60 : 280;
    const finishDelay = reducedMotion ? 180 : 760;
    transitionTimers.current.push(
      window.setTimeout(() => {
        setChallenge((current) => (current === 4 ? 1 : ((current + 1) as ChallengeNumber)));
        setProgress(0);
        setHits(0);
        setCompleted(false);
        completionRef.current = false;
      }, switchDelay),
      window.setTimeout(() => setTransitioning(false), finishDelay),
    );
  };

  const status = useMemo(() => {
    if (challenge === 1) return watermelonState(progress, hits);
    if (challenge === 2) return progress > 0.87 ? "PERMANENT DEFORMATION" : `LOAD ${(progress * 100).toFixed(0)}%`;
    if (challenge === 4) {
      if (progress < 0.18) return "AIM THE SPIKE";
      if (progress < 0.38) return "PIERCING BOX 01";
      if (progress < 0.68) return "PIERCING BOX 02";
      if (progress < 0.9) return "THROUGH THE STACK";
      return "ROD CLEARED THE BOTTOM";
    }
    if (progress < 0.26) return "SUSPENSION LOADED";
    if (progress < 0.62) return "REAR AXLE UNWEIGHTED";
    return progress > 0.88 ? "REAR WHEELS CLEAR" : "CHASSIS ROTATING";
  }, [challenge, progress, hits]);

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
          onClick={() => setSoundEnabled((current) => {
            if (current && realVoiceRef.current) {
              realVoiceRef.current.pause();
              realVoiceRef.current.currentTime = 0;
            }
            if (current && spikeClipRef.current) {
              spikeClipRef.current.pause();
              spikeClipRef.current.currentTime = 0;
            }
            if (current && spikeCompleteRef.current) {
              spikeCompleteRef.current.pause();
              spikeCompleteRef.current.currentTime = 0;
            }
            if (current && bendStartRef.current) {
              bendStartRef.current.pause();
              bendStartRef.current.currentTime = 0;
            }
            if (current) synthFeedback("car-strain", 0);
            return !current;
          })}
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
        {[1, 2, 3, 4].map((step) => (
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
            onObjectTouch={handleObjectTouch}
            onReady={() => setSceneReady(true)}
          />
          {!sceneReady && <div className="canvas-loading" aria-hidden="true" />}
        </div>

        <div className="interaction-cursor" aria-hidden="true">
          <span />
        </div>
      </section>

      <footer className="bottom-ui">
        <div className="instruction-block">
          <span className="instruction-icon" aria-hidden="true">
            {challenge === 1 ? "＋" : challenge === 4 ? "↓" : "↟"}
          </span>
          <div>
            <p>{content.instruction}</p>
            <span>{challenge === 1 ? "CLICK TO PIERCE · DEEP HOLES, NOT A WIDE BLAST" : challenge === 2 ? "BEND · WRAP THE REBAR AROUND HIS ARM" : challenge === 4 ? "HAMMER THE ROD · PUNCH THROUGH THREE BOXES" : "ELMIN LIFTS · SUSPENSION FOLLOWS"}</span>
          </div>
        </div>

        <div className="readout" role="status" aria-live="polite">
          <div className="readout-head">
            <span>{status}</span>
            <b>{challenge === 1 || challenge === 4 ? `${hits} HIT${hits === 1 ? "" : "S"}` : `${Math.round(progress * 100)}%`}</b>
          </div>
          <div className="progress-track">
            <i style={{ transform: `scaleX(${progressValue})` }} />
          </div>
        </div>

        <div className="next-slot">
          {completed ? (
            <button type="button" className="next-button" onClick={advance}>
              <span>{challenge === 4 ? "RUN IT AGAIN" : "NEXT CHALLENGE"}</span>
              <i aria-hidden="true">↗</i>
            </button>
          ) : (
            <span className="completion-target">TARGET · {challenge === 1 ? "5 HITS TO UNLOCK" : challenge === 2 ? "88% WRAP" : challenge === 4 ? "ROD THROUGH 3 BOXES" : "90% LIFT"}</span>
          )}
        </div>
      </footer>

      <div className="transition-wipe" aria-hidden="true" />
    </main>
  );
}
