# MIRRO architecture

## Current vertical slice

Next.js App Router + React client components for local-only workflows. IndexedDB stores sensitive media, derived silhouette metadata, BodyMesh data, and garment calibration metadata. No authentication, database, or object storage is connected because body-photo privacy/retention rules must be explicit before server persistence.

## Body calibration pipeline — anatomical v2 implemented

1. Each body photo is downscaled locally to a bounded processing resolution.
2. Border pixels estimate the background color distribution.
3. A connected flood fill removes background pixels reachable from the image edges.
4. The largest remaining connected component becomes the person's binary silhouette.
5. Each silhouette is normalized by detected body height into a 96-sample width profile plus a per-height contour-center profile.
6. Front + back are confidence-weighted into X width; left + right become Z depth.
7. Known physical height converts normalized profiles into centimeters.
8. Chest, waist and hips are detected inside constrained torso bands, then corrected to the user's measured circumferences.
9. BodyMesh v2 keeps the measured elliptical torso profile but generates separate head, left/right arms and left/right legs as indexed geometry.
10. Each anatomical region has its own collision primitive: elliptical torso hull, head ellipsoid and tapered limb capsules.
11. Shoulder and crotch landmarks are persisted for semantic garment construction.
12. Calibration quality still records per-view confidence and opposite-view disagreement.

BodyMesh v2 is deterministic and anatomical enough for separate sleeve/leg collision, while still remaining a parametric reconstruction rather than a full photogrammetric scan. Existing v1 profiles remain readable and are rebuilt as v2 in memory when try-on starts.

## Camera model — reusable optics v6 implemented

The printable A4 target still supplies a metric plane and four deterministic correspondences per body view. MIRRO now additionally solves a shared pinhole camera rig when all four target detections are valid:

1. solve one planar homography per view
2. refine shared intrinsics `fx`, `fy`, `cx`, `cy` with zero skew
3. decompose each homography into an orthonormal rotation + translation
4. jointly score the views using target reprojection and rotation constraints
5. persist RMS reprojection error, conditioning score and per-view extrinsics

A poorly conditioned capture (for example targets that are all nearly fronto-parallel) is explicitly warned about. If the pinhole solve is degenerate, MIRRO keeps the metric v3 result rather than inventing camera parameters.

After the v4 shared-pinhole solve, MIRRO now estimates Brown–Conrady radial/tangential coefficients (`k1`, `k2`, `k3`, `p1`, `p2`) from all four target views using regularized least squares. Distortion is activated only when it measurably reduces reprojection RMS. When activated, all four calibration frames are inverse-remapped with bilinear sampling, silhouettes/markers are extracted again, and the CameraRig is solved again in undistorted coordinates. Raw stored photos are likewise remapped at calibrated resolution before body-texture projection.

MIRRO now also has a dedicated optical workflow. Six to twelve target photos at varied tilts/positions solve shared intrinsics and Brown–Conrady distortion independently from the body session. Only the derived optical profile is persisted; calibration photos are not stored. Body capture can reuse this lens profile and therefore does not require the target to be present in all four body photos.

Dense reconstruction uses a different capture contract: the phone remains fixed while the person turns in place through eight 45° stops from 0° through 315°. Moving the target between body views does not create a shared world frame and must not be treated as multi-view camera registration.

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

Garment metadata maps to material parameters. New garments store an explicit physical profile:

- density in g/m²
- thickness in mm
- warp stretch %
- weft stretch %
- bend stiffness (0–100)
- friction

Structural constraints are tagged as warp or weft; XPBD selects separate compliance for each axis. Density scales particle inverse mass, while thickness feeds collision distance. Legacy/simple weight + stretch inputs still generate deterministic physical presets.

The try-on runs 144 simulation steps in a dedicated Web Worker. It sends bounded position snapshots back to the UI for determinate progress and preview refreshes. Browsers without Worker support fall back to small `requestAnimationFrame` batches.

## Collision model — SDF gradient + dense/anatomical fallback implemented

When BodyCalibration v7 contains an SDF, cloth collision samples the signed distance trilinearly and follows its normalized spatial gradient until the particle reaches the requested cloth thickness. If the gradient degenerates numerically, MIRRO falls back to the v6 voxel ejection path; older profiles still use anatomical primitives. Otherwise body collision evaluates the union of anatomical primitives:

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
- the four saved body views are exposure/white-balance calibrated from segmented body pixels.
- v5 adds a bounded 3×8 local RGB/exposure field per view; local gains stay close to the global correction to avoid aggressive recoloring.
- v6 builds a three-band Laplacian-style body atlas: low-frequency color uses a wide overlap, medium-frequency structure a narrower overlap, and fine detail the narrowest dominant-view seam.
- v7 detects overlap competition zones and runs a screened-Poisson relaxation in gradient space. The dominant source supplies detail gradients while the multiband result anchors absolute color; horizontal neighbors wrap across U=0/1 so the 360° seam is optimized too.
- BodyMesh vertices use continuous cylindrical UVs, eliminating the previous hard material boundary between front/right/back/left.
- `MeshPhysicalMaterial` adds fabric roughness, sheen and low clearcoat; measured density/stiffness influence the material appearance when available.
- light / medium / heavy fabric presets affect the PBR appearance as well as physics.
- studio hemisphere, key, fill and rim lights provide shape readability.
- body and garment cast/receive shadows on a neutral studio floor.

The dependency-free Canvas renderer remains as **Malha técnica** for debugging topology and simulation.

The renderer materially improves realism, but exact visual fit still depends on capture calibration, anatomical approximation and fabric-parameter quality.

## Surface reconstruction v7 → v8

The v5 asymmetric parametric body remains as a robust base and garment-construction reference. V6 introduced four-mask carving. V7 expands capture to eight views at 45° intervals; each diagonal silhouette adds another projection half-space and cuts away the oversized diagonal corners left by four orthogonal views. A voxel survives only when its projection is inside every available body mask used by the eight-view carving stage. The boundary is extracted with marching tetrahedra, deduplicated along voxel edges, smoothed with bounded Taubin passes and given recomputed normals.

The visual hull is used by the PBR body renderer and persisted together with RLE-compressed voxel occupancy. V7 also computes an exact separable 3D Euclidean distance transform for both inside and outside voxels, quantizes the signed field at 0.05 cm, and persists it for smooth cloth collision. The anatomical BodyMesh remains available for semantic landmarks, garment initialization and fallback.

The collision hull remains classical shape-from-silhouette. V7 adds a conservative first photometric refinement layer for rendering: torso vertices are plane-swept only inward along their radial ray, projected into the eight known turntable angles, and accepted only when at least three visible views reduce exposure-normalized color variance by a minimum threshold. The refined render surface is stored separately from the collision hull/SDF, so uncertain photoconsistency can never make cloth penetrate the conservative physical envelope.

This is not yet a general dense-stereo reconstruction: the current sweep is radial, torso-scoped and uses the known fixed-camera turntable geometry. Concavities or hidden detail without stable multi-view texture remain unrecoverable.

## Classical multi-view stereo v8

V8 adds a real dense correspondence stage above the conservative v7 visual hull.

1. Each of the eight 45° views builds a bounded working depth map rather than searching every source-image pixel.
2. Every foreground sample starts at the front intersection of the v7 SDF and tests only inward depth hypotheses. This prevents MVS from inventing geometry outside the silhouette envelope.
3. A sparse 3×3 patch is reprojected first into the ±45° neighboring views. MIRRO uses zero-mean normalized cross correlation (ZNCC), which is less sensitive to exposure offsets than raw RGB error. ±90° neighbors are evaluated only when the nearest pair does not provide enough valid correlation.
4. Best-vs-second-best correlation margin produces an ambiguity score. Low-texture, ambiguous and weak-correlation samples are discarded instead of filled heuristically.
5. A local depth median/support pass suppresses isolated speckles while retaining confidence.
6. Surviving depth samples are reprojected into neighboring depth maps. Samples that disagree geometrically lose confidence or are rejected.
7. Depth maps are quantized to 0.05 cm and confidence to 8-bit values for bounded IndexedDB storage.
8. Fusion builds a truncated signed-distance field only near the v7 surface band. Deep interior is skipped because it cannot change the zero level-set.
9. The fused TSDF is clamped against the v7 SDF with a conservative max operation, so MVS can carve inward but cannot expand the body beyond the silhouette-derived physical envelope.
10. The TSDF zero crossing is extracted with interpolated marching tetrahedra and recomputed normals. PBR prefers this MVS surface, while XPBD continues to collide against the conservative v7 SDF.

### Projection model

When a compatible reusable optical profile exists, V8 scales its pinhole intrinsics to each scan image and estimates the fixed-camera turntable distance from focal length, observed body height and visual-hull front depth. Every MVS ray/reprojection then uses the same perspective camera model for plane sweep, cross-view consistency and TSDF fusion.

If optics are unavailable or image aspect ratio does not match, the solver deliberately falls back to the metric-orthographic turntable model instead of mixing projection models across views.

This is classical MVS, not generative reconstruction. It is still more constrained than general PatchMatch MVS: the camera is fixed, the person rotates in known 45° steps, depth hypotheses are bounded by the visual hull, and motion/specular/textureless regions may fall back to v7.

## Engine roadmap

- Refine the turntable camera center/extrinsics jointly across all eight views instead of estimating distance independently from body height.
- Add coarse-to-fine/subpixel depth hypotheses and stronger robust patch costs (Census/gradient terms) for weak texture.
- Move MVS/TSDF generation into a Worker/WASM path when mobile scan latency justifies the transfer cost.
- Add more semantic body measurements (forearm, calf, neck, shoulder slope) and guided measurement UX.
- Replace engineering fabric presets with optional lab-backed material sheets when verified data is available.
- Add semantic garment subtypes (short sleeve, long sleeve, dress, skirt, jacket) rather than category heuristics.
- Move the Worker solver to WASM when mesh density or semantic topology increases substantially.
- Add optional environment-map based image-based lighting and higher-quality soft shadows.

## Cloud boundary (future)

Before cloud sync: define account auth, encryption/storage provider, deletion/retention, authorization, rate limits, upload validation, content-size limits, auditability, and explicit consent for body media. Body images should use private object storage with signed access; metadata should be tenant-scoped.
