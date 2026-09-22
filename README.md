# MIRRO

A local-first digital wardrobe and deterministic virtual try-on experiment — without generative AI.

## Current milestone

- Fixed-camera 8-view body turntable capture at 45° intervals + real measurements
- Classical connected-background body silhouette extraction
- Confidence-weighted multi-view body calibration
- Reusable 6–12 frame optical calibration with shared intrinsics + Brown–Conrady k1/k2/k3/p1/p2
- BodyCalibration v7 with 8-view voxel carving, marching-tetrahedra visual hull, exact 3D signed-distance field, compressed occupancy and conservative turntable photometric surface refinement
- BodyCalibration v8 with per-view ZNCC depth maps, cross-view consistency, confidence filtering and conservative TSDF fusion
- BodyCalibration v9 with ZNCC + Census + gradient robust matching, coarse-to-fine/subpixel depth and a jointly regularized turntable center
- MVS uses calibrated turntable perspective from the saved optical profile when compatible, with metric-orthographic fallback
- MVS/TSDF runs in a dedicated Web Worker when available; Census Hamming uses a real WASM i32.popcnt microkernel with deterministic JS fallback
- Garment front/back alpha calibration from the user's real photos
- Semantic GarmentMesh: torso + sleeves for tops; waistband + split legs/crotch for bottoms
- XPBD structural / shear / bend / seam constraints
- Web Worker simulation with main-thread fallback
- Anisotropic fabric physics: g/m², thickness, warp/weft stretch, bend stiffness and friction
- SDF-gradient body collision when v7 is available, dense voxel/anatomical fallbacks, spatial-hash garment self-collision, damping, friction approximation and reusable engineering fabric-library presets
- Interactive physical 3D beta preview with simulation progress
- Real front/back garment textures warped over semantic solved UV regions
- Three.js PBR preview with WebGPU-first rendering, WebGL2 fallback and a lens-corrected 360° atlas using bounded local 3×8 color transfer + three-band multiband blending + screened-Poisson seam optimization
- Photo-based 2D fallback
- IndexedDB-only private local storage
- Responsive product shell

The current **Físico 3D beta** now adds robust classical multi-view stereo on top of the eight-view scan: ZNCC + Census + gradient matching, bounded coarse-to-fine plane sweep, parabolic subpixel refinement, shared turntable-axis regularization, confidence/ambiguity rejection, cross-view depth consistency and conservative TSDF fusion. When the saved optical profile matches the scan, MVS uses calibrated turntable perspective; otherwise it falls back to metric orthographic projection. The v7 SDF remains the physical cloth-collision envelope. It still should not be sold as exact photoreal fit: eight-view MVS can recover only texture-supported geometry inside the conservative silhouette envelope; textureless, specular, self-occluded or moving regions still fall back to the visual hull, and fabric-library values remain engineering presets unless the user supplies measurements. See `ARCHITECTURE.md`.

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
