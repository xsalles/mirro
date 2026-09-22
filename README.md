# MIRRO

A local-first digital wardrobe and deterministic virtual try-on experiment — without generative AI.

## Current milestone

- Fixed-camera 4-view body turntable capture + real measurements
- Classical connected-background body silhouette extraction
- Confidence-weighted multi-view body calibration
- Reusable 6–12 frame optical calibration with shared intrinsics + Brown–Conrady k1/k2/k3/p1/p2
- BodyCalibration v6 with lens-corrected silhouettes, full-mask voxel carving, marching-tetrahedra visual hull and compressed occupancy
- Garment front/back alpha calibration from the user's real photos
- Semantic GarmentMesh: torso + sleeves for tops; waistband + split legs/crotch for bottoms
- XPBD structural / shear / bend / seam constraints
- Web Worker simulation with main-thread fallback
- Anisotropic fabric physics: g/m², thickness, warp/weft stretch, bend stiffness and friction
- Dense visual-hull body collision when available, anatomical fallback collision, spatial-hash garment self-collision, damping, friction approximation and reusable engineering fabric-library presets
- Interactive physical 3D beta preview with simulation progress
- Real front/back garment textures warped over semantic solved UV regions
- Three.js PBR preview with WebGPU-first rendering, WebGL2 fallback and a lens-corrected 360° atlas using bounded local 3×8 color transfer + three-band multiband blending
- Photo-based 2D fallback
- IndexedDB-only private local storage
- Responsive product shell

The current **Físico 3D beta** now has reusable multi-frame optical calibration, fixed-camera person-turntable capture, a dense four-silhouette visual hull, voxel-backed cloth collision, multiband 360° body texturing and the existing semantic XPBD garment pipeline. It still should not be sold as exact photoreal fit: a four-view visual hull cannot recover concavities or hidden surface detail, and fabric-library values remain engineering presets unless the user supplies measurements. See `ARCHITECTURE.md`.

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
