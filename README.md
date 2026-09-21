# MIRRO

A local-first digital wardrobe and deterministic virtual try-on experiment — without generative AI.

## Current milestone

- 4-view body capture + real measurements
- Classical connected-background silhouette extraction
- Confidence-weighted multi-view calibration
- Centimeter-based BodyMesh v1 (64 rings × 32 segments)
- IndexedDB-only private local storage
- Garment catalog with front/back photos
- Classical flat-background removal in Canvas
- Deterministic 2D garment placement + manual calibration
- Responsive product shell

The body pipeline now generates a **coarse 3D collision hull** locally. The garment try-on is still an **MVP 2D approximation**, not a cloth simulator. See `ARCHITECTURE.md` for the current camera model and the path to anatomical topology + physical cloth simulation.

## Development

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run design:lint
```

## Privacy bootstrap

Body photos, silhouettes, BodyMesh and garment images are stored only in the browser's IndexedDB. No media upload API exists in this milestone.
