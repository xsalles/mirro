# MIRRO

A local-first digital wardrobe and deterministic virtual try-on experiment — without generative AI.

## Current milestone

- 4-view body profile + measurements
- IndexedDB-only private local storage
- Garment catalog with front/back photos
- Classical flat-background removal in Canvas
- Deterministic 2D garment placement + manual calibration
- Responsive product shell

The current try-on is an **MVP 2D approximation**, not a 3D cloth simulator. See `ARCHITECTURE.md` for the path to multi-view reconstruction and physical cloth simulation.

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

Body and garment images are stored only in the browser's IndexedDB. No media upload API exists in this milestone.
