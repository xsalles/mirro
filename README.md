# MIRRO

A local-first digital wardrobe and deterministic virtual try-on experiment — without generative AI.

## Current milestone

- 4-view body capture + real measurements
- Classical connected-background body silhouette extraction
- Confidence-weighted multi-view body calibration
- Anatomical BodyMesh v3 with optional A4 metric target, separate torso/head/arms/legs and advanced limb measurements
- Garment front/back alpha calibration from the user's real photos
- Semantic GarmentMesh: torso + sleeves for tops; waistband + split legs/crotch for bottoms
- XPBD structural / shear / bend / seam constraints
- Web Worker simulation with main-thread fallback
- Anisotropic fabric physics: g/m², thickness, warp/weft stretch, bend stiffness and friction
- BodyMesh collision, spatial-hash garment self-collision, damping, friction approximation and fabric presets
- Interactive physical 3D beta preview with simulation progress
- Real front/back garment textures warped over semantic solved UV regions
- Three.js PBR preview with WebGPU-first rendering, WebGL2 fallback and four-view body texture projection
- Photo-based 2D fallback
- IndexedDB-only private local storage
- Responsive product shell

The current **Físico 3D beta** now has anatomical collision, semantic garment topology and a PBR renderer. It still should not be sold as exact photoreal fit: camera geometry is weak-perspective, anatomical proportions outside the measured torso remain parametric, and fabric behavior comes from presets. See `ARCHITECTURE.md`.

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
