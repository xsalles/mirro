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
- BodyCalibration v10 with per-frame turntable angle correction, tilted-axis bundle optimization, a true 3-level image pyramid and WebAssembly SIMD numeric reductions
- BodyCalibration v11 with image-edge feature residuals, MAD-based frame rejection, centered vertical-axis validation and edge-aware depth densification after sparse cross-view validation
- MVS uses calibrated turntable perspective from the saved optical profile when compatible, with metric-orthographic fallback
- MVS/TSDF runs in a dedicated Web Worker when available; Census Hamming uses a WASM i32.popcnt microkernel and v11 adds benchmark-gated AssemblyScript SIMD kernels for fixed 3×3 patch statistics and up-to-eight-view TSDF fusion reductions, with deterministic JS fallbacks
- Garment front/back alpha calibration from the user's real photos
- Semantic GarmentMesh: torso + explicit sleeve lengths for tops/jackets, joined torso+skirt panels for dresses, dedicated skirt panels, and waistband + split legs/crotch for bottoms
- XPBD structural / shear / bend / seam constraints
- Web Worker simulation with main-thread fallback
- Anisotropic fabric physics: g/m², thickness, warp/weft stretch, bend stiffness and friction, with provenance that distinguishes engineering estimates from user-supplied lab/datasheet values
- SDF-gradient body collision when v7 is available, dense voxel/anatomical fallbacks, spatial-hash garment self-collision, damping, friction approximation and reusable engineering fabric-library presets
- Interactive physical 3D beta preview with simulation progress
- Real front/back garment textures warped over semantic solved UV regions
- Three.js PBR preview with WebGPU-first rendering, WebGL2 fallback and a lens-corrected 360° atlas using bounded local 3×8 color transfer + three-band multiband blending + screened-Poisson seam optimization
- Photo-based 2D fallback
- IndexedDB-only private local storage
- Responsive product shell

The current **Físico 3D beta** adds a v11 conservative refinement layer on top of the eight-view scan. The turntable bundle combines silhouette centerlines with paired image-edge anchors, rejects isolated bad frames with a median/MAD residual gate, validates vertical-axis residual slope, and refuses the v11 pose model if that validation fails. Depth still starts with ZNCC + Census + gradient matching on the 1×/½/¼ pyramid, bounded coarse-to-fine search and parabolic subpixel refinement; only after sparse cross-view consistency does v11 propagate depth onto a denser edge-aware grid for TSDF fusion. The Worker can use benchmark-gated WASM SIMD for fixed patch statistics and TSDF contribution reductions, but camera projection, image sampling, the outer voxel/grid traversal and surface extraction remain deterministic TypeScript. The v7 SDF remains the physical cloth-collision envelope. It still should not be sold as exact photoreal fit: eight-view MVS can recover only texture-supported geometry inside the conservative silhouette envelope; textureless, specular, self-occluded or moving regions still fall back to the visual hull. Fabric values are labeled as estimates unless backed by a user-supplied lab sheet/datasheet reference. See `ARCHITECTURE.md`.

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
