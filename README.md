# MIRRO

A local-first digital wardrobe and deterministic virtual try-on experiment — without generative AI.

## Current milestone

- 4-view body capture + real measurements
- Classical connected-background body silhouette extraction
- Confidence-weighted multi-view body calibration
- Centimeter-based BodyMesh v1 (64 rings × 32 segments)
- Garment front/back alpha calibration from the user's real photos
- Two-panel GarmentMesh generated from the real garment silhouette
- XPBD structural / shear / bend / seam constraints
- BodyMesh collision, spatial-hash garment self-collision, damping, friction approximation and fabric presets
- Interactive physical 3D beta preview with simulation progress
- Real front/back garment textures warped over the solved UV mesh
- Photo-based 2D fallback
- IndexedDB-only private local storage
- Responsive product shell

The current **Físico 3D beta** is a genuine local cloth simulation, but it is not yet a photoreal final try-on. BodyMesh v1 merges limb topology, pants use a single two-panel envelope, and the Canvas renderer is not yet a PBR/photoreal renderer. See `ARCHITECTURE.md`.

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

Body photos, silhouettes, BodyMesh, garment photos, garment calibration and simulation inputs remain local to the browser. No media upload API exists in this milestone.
