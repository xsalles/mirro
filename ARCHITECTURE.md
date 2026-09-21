# MIRRO architecture

## Current vertical slice

Next.js App Router + React client components for local-only workflows. IndexedDB stores sensitive media and metadata. No authentication, database, or object storage is connected yet because body-photo privacy/retention rules must be explicit before server persistence.

## Deterministic image pipeline

1. User photographs garment on a visually uniform background.
2. Canvas downsizes to a bounded working resolution.
3. Corner/background samples estimate the background RGB.
4. Euclidean color distance removes/feathers pixels near that color.
5. The PNG alpha image is stored locally.
6. A pure geometry function maps body measurements + garment category to an initial fit box.
7. User can correct scale/X/Y without changing source media.

This is deliberately an MVP approximation, not cloth simulation.

## Engine roadmap

- Body silhouette extraction using classical CV under controlled capture constraints.
- Camera calibration and multi-view visual hull.
- Body mesh generation from silhouettes + explicit measurements.
- Garment mesh calibration using known dimensions / category templates.
- XPBD cloth simulation with collision against the body mesh.
- WebGPU/Three.js rendering, with a WebGL fallback if required by supported devices.

## Cloud boundary (future)

Before cloud sync: define account auth, encryption/storage provider, deletion/retention, authorization, rate limits, upload validation, content-size limits, auditability, and explicit consent for body media. Body images should use private object storage with signed access; metadata should be tenant-scoped.
