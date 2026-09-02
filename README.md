# Impossible — Physical Challenge Lab

A cinematic browser-based physical challenge experience built with Next.js, React Three Fiber, and Three.js.

## Challenges

1. **Break it** — a custom procedural 3D watermelon with point-accurate impacts, progressive shell holes, exposed flesh, cracks, flying chunks, impact motion, sound, and haptics. The next challenge unlocks at five hits, but destruction continues to twelve hits and beyond.
2. **Bend it** — a segmented chrome bar that deforms along a resistance curve, yields permanently, vibrates under stress, and emits metallic audio feedback.
3. **Lift it** — a modeled boxy sedan with independent wheel and suspension logic. The body rotates around the front axle while the rear suspension unloads before the rear wheels leave the ground.

## Local development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Production

```bash
pnpm build
pnpm start
```

The experience is responsive, touch-enabled, capped to a performance-conscious device pixel ratio, and respects `prefers-reduced-motion`.
