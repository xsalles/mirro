# MIRRO architecture

## Current vertical slice

Next.js App Router + React client components for local-only workflows. IndexedDB stores sensitive media, derived silhouette metadata, BodyMesh data, and garment calibration metadata. No authentication, database, or object storage is connected because body-photo privacy/retention rules must be explicit before server persistence.

## Body calibration pipeline — anatomical v2 implemented

1. Each body photo is downscaled locally to a bounded processing resolution.
2. Border pixels estimate the background color distribution.
3. A connected flood fill removes background pixels reachable from the image edges.
4. The largest remaining connected component becomes the person's binary silhouette.
5. Each silhouette is normalized by detected body height into a 64-sample width profile.
6. Front + back are confidence-weighted into X width; left + right become Z depth.
7. Known physical height converts normalized profiles into centimeters.
8. Chest, waist and hips are detected inside constrained torso bands, then corrected to the user's measured circumferences.
9. BodyMesh v2 keeps the measured elliptical torso profile but generates separate head, left/right arms and left/right legs as indexed geometry.
10. Each anatomical region has its own collision primitive: elliptical torso hull, head ellipsoid and tapered limb capsules.
11. Shoulder and crotch landmarks are persisted for semantic garment construction.
12. Calibration quality still records per-view confidence and opposite-view disagreement.

BodyMesh v2 is deterministic and anatomical enough for separate sleeve/leg collision, while still remaining a parametric reconstruction rather than a full photogrammetric scan. Existing v1 profiles remain readable and are rebuilt as v2 in memory when try-on starts.

## Camera model

The current calibration uses weak-perspective normalization: each view is independently scaled by detected body height, which reduces moderate camera-distance differences. This is not a calibrated pinhole-camera reconstruction. A later capture protocol can add known camera intrinsics/extrinsics or fiducial markers without changing the BodyMesh contract.

## Garment image + calibration pipeline — implemented

1. User photographs garment front/back on a visually uniform background.
2. Canvas downsizes to a bounded working resolution.
3. Corner/background samples estimate the background RGB.
4. Euclidean color distance removes/feathers the background into PNG alpha.
5. Alpha silhouettes are sampled into 48 horizontal width + center profiles for front and back.
6. Each sampled row also stores up to two alpha intervals/runs. This preserves holes such as the gap between trouser legs instead of collapsing every row into one bounding width.
7. Front/back consistency produces a garment calibration score and warnings.
8. The processed PNGs and calibration metadata are stored locally.

Legacy garments without calibration are recalibrated on demand from their stored processed PNGs when physical try-on starts.

## GarmentMesh v2 — semantic topology implemented

GarmentMesh v2 is no longer one rectangular front panel plus one back panel.

### Tops / shirts / hoodies

- independent torso front/back grids
- independent left-sleeve front/back grids
- independent right-sleeve front/back grids
- lateral torso seams
- shoulder seams with a neck opening
- sleeve side seams
- sleeve-to-shoulder attachment constraints
- sleeve geometry initialized around the matching anatomical arm capsule
- per-region UVs preserve the real front/back garment photographs

### Pants / shorts

- waistband front/back regions around waist/hips
- independent left-leg front/back grids
- independent right-leg front/back grids
- leg side seams
- waistband-to-leg attachment
- explicit front/back crotch seams
- crotch split is inferred from persistent two-run alpha rows
- leg geometry initializes around the matching left/right anatomical leg capsule

Every particle carries a texture side and semantic region id, allowing rendering and later material tuning per garment region.

## XPBD cloth solver — implemented

The local solver uses Verlet-style integration plus XPBD distance constraints:

- structural stretch
- shear
- bend
- seam
- gravity
- damping
- collision thickness
- approximate friction
- BodyMesh collision every solver iteration
- garment self-collision using a 3D spatial hash

Garment metadata maps to material parameters:

- **stretch level** controls structural/shear compliance
- **fabric weight** controls bend compliance, damping and collision thickness

The try-on runs 144 simulation steps in a dedicated Web Worker. It sends bounded position snapshots back to the UI for determinate progress and preview refreshes. Browsers without Worker support fall back to small `requestAnimationFrame` batches.

## Collision model — anatomical + self-collision implemented

Body collision now evaluates the union of anatomical primitives:

- measured elliptical torso hull
- head ellipsoid
- tapered left/right arm capsules
- tapered left/right leg capsules

When primitives overlap at shoulders or hips, projection is repeated a small bounded number of times so a particle is not pushed out of one body region into another.

Garment self-collision uses a uniform 3D spatial hash whose cell size follows cloth collision thickness. Each particle checks only its 27 neighboring cells, and pairs already connected by structural, shear, bend or seam constraints are excluded. This avoids the O(n²) all-pairs path while preventing distant folds and opposite panels from occupying the same space.

## Rendering — PBR implemented

Physical mode now defaults to a Three.js r186 scene using `WebGPURenderer`.

- WebGPU is preferred automatically.
- Three.js falls back to its WebGL2 backend when WebGPU is unavailable.
- perspective camera replaces the technical orthographic-only presentation.
- real depth buffer occludes front/back/body surfaces correctly.
- ACES filmic tone mapping is enabled.
- real garment front/back photos are sampled through semantic UV regions.
- `MeshPhysicalMaterial` adds fabric roughness, sheen and low clearcoat.
- light / medium / heavy fabric presets affect the PBR appearance as well as physics.
- studio hemisphere, key, fill and rim lights provide shape readability.
- body and garment cast/receive shadows on a neutral studio floor.

The dependency-free Canvas renderer remains as **Malha técnica** for debugging topology and simulation.

The renderer materially improves realism, but exact visual fit still depends on capture calibration, anatomical approximation and fabric-parameter quality.

## Engine roadmap

- Add explicit camera calibration / capture fiducials for metric multi-view reconstruction.
- Improve limb/body proportions from additional user measurements instead of anthropometric defaults.
- Add multi-view body texture projection so the anatomical avatar can visually resemble the person, not only their dimensions.
- Add measured fabric presets (warp/weft stretch, bending, density) beyond light/medium/heavy.
- Add semantic garment subtypes (short sleeve, long sleeve, dress, skirt, jacket) rather than category heuristics.
- Move the Worker solver to WASM when mesh density or semantic topology increases substantially.
- Add optional environment-map based image-based lighting and higher-quality soft shadows.

## Cloud boundary (future)

Before cloud sync: define account auth, encryption/storage provider, deletion/retention, authorization, rate limits, upload validation, content-size limits, auditability, and explicit consent for body media. Body images should use private object storage with signed access; metadata should be tenant-scoped.
