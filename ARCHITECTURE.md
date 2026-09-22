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

## GarmentMesh v2/v3 — semantic topology implemented

GarmentMesh is no longer one rectangular front panel plus one back panel. V3 activates for explicit sleeve-length/new subtype topology while legacy v2 meshes remain readable.

### Tops / shirts / hoodies / jackets

- independent torso front/back grids
- independent left-sleeve front/back grids
- independent right-sleeve front/back grids
- lateral torso seams
- shoulder seams with a neck opening
- sleeve side seams
- sleeve-to-shoulder attachment constraints
- sleeve geometry initialized around the matching anatomical arm capsule
- sleeve length can be sleeveless, short, three-quarter or long
- jackets use a larger ease/length envelope instead of silently reusing the T-shirt dimensions
- per-region UVs preserve the real front/back garment photographs

### Dresses / skirts

- skirts use independent front/back panels anchored at the measured waist/hip envelope
- dresses compose the torso/sleeve topology with dedicated lower front/back skirt panels
- dress torso and skirt are joined by explicit waist seam constraints
- UV ranges keep upper/lower source-image regions attached to the corresponding semantic mesh panels
- skirt flare remains bounded and deterministic rather than inferred generatively

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

Structural constraints are tagged as warp or weft; XPBD selects separate compliance for each axis. Density scales particle inverse mass, while thickness feeds collision distance. Legacy/simple weight + stretch inputs still generate deterministic physical presets. Preset/library values are explicitly provenance-tagged as `engineering-preset`. A garment can instead persist `lab-sheet` provenance with a user-supplied reference and optional test date; MIRRO does not promote manually entered or library values to "measured" without that evidence.

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

## Robust MVS compute v9

V9 keeps the v8 conservative geometry contract but changes how depth is selected and where it runs:

1. each candidate patch is scored by a weighted combination of positive ZNCC, Census bit agreement and gradient-magnitude similarity;
2. Census Hamming distance uses a tiny WebAssembly `i32.popcnt` microkernel when WebAssembly is present, with a bit-twiddling JavaScript fallback;
3. depth first searches five bounded coarse hypotheses inside the visual hull, then evaluates only the two local neighbors around the winner;
4. a concave three-sample parabola refines the best depth continuously below the discrete search interval; stored depth remains quantized to 0.05 cm;
5. the eight perspective camera estimates are regularized together: camera distance and vertical optical offset use robust medians, while one least-squares X/Z turntable-axis center explains the per-view horizontal offsets;
6. the complete MVS → cross-view consistency → TSDF → surface extraction stage runs in a dedicated Web Worker when supported. Result depth/TSDF typed-array buffers are transferred back to the main thread;
7. browsers without Worker or WebAssembly retain deterministic local fallbacks.

The WASM claim is intentionally narrow: only the Census popcount hot path is currently native WebAssembly. ZNCC, gradient matching, depth regularization, cross-view filtering and TSDF remain TypeScript executed inside the Worker. A future full WASM/SIMD port should be benchmark-driven rather than implied today.

## Turntable bundle + pyramid + SIMD v10

V10 extends the v9 solver without changing the conservative collision contract.

### Turntable bundle

The reusable optical profile still provides shared pinhole intrinsics. V10 then estimates a turntable model from the eight body silhouettes instead of assuming every pose landed exactly on its nominal 45° stop:

1. the v9 shared-center solution provides the initialization;
2. seven centerline samples per view are converted from image coordinates into metric camera observations;
3. a bounded robust bundle adjusts X/Z axis origin, X/Z axis tilt, shared optical offsets and seven per-frame angular residuals while keeping the front frame anchored;
4. Huber loss limits the influence of outlier rows, and angle/tilt regularization prevents noisy silhouettes from being explained by implausible pose changes;
5. the resulting Rodrigues axis/angle transform is used by SDF ray intersection, patch reprojection, cross-view consistency and TSDF projection—not merely persisted as metadata.

This remains a turntable-specific bundle, not a generic structure-from-motion solve. It estimates the motion model supported by the capture protocol and deliberately bounds degrees of freedom that the eight silhouettes cannot stably identify.

### Multi-resolution depth

Each decoded scan view builds a three-level luminance/gradient pyramid when resolution allows: 1×, ½ and ¼. Coarse hypotheses are compared at the ¼ level, the local winner is refined at ½, and the final center/parabolic subpixel samples use full resolution. Geometry is always projected in the original camera model; only photometric sampling moves between pyramid levels.

The dedicated Worker requests a 42-column working depth map while the synchronous fallback keeps 30 columns. This makes the high-density path available without making a Worker failure freeze the UI for the same workload.

### WebAssembly SIMD

The build now compiles `assembly/mvs-simd.ts` with AssemblyScript and `--enable simd` into `public/mvs-simd.wasm` before development, tests and production builds. The Worker validates/instantiates this module once and uses its `v128` exports for:

- four-lane dot products and squared sums used by ZNCC moments;
- four-lane weighted sums used by TSDF depth fusion.

Census Hamming still uses the separate tiny `i32.popcnt` WASM kernel. If SIMD or WebAssembly is unavailable, the exact same reductions fall back to scalar JavaScript.

The SIMD claim is intentionally scoped: camera projection, patch traversal, Census construction, cross-view logic, voxel traversal and marching tetrahedra are still TypeScript running inside the Worker. V10 moves verified numeric hot reductions to SIMD; it does not pretend the whole solver is native WASM.

## Feature bundle + dense depth + benchmarked SIMD v11

V11 extends v10 while preserving the same conservative v7 SDF collision boundary.

### Feature-assisted turntable bundle

The seven silhouette centerline observations per view remain the stable geometric baseline, but v11 also samples the image gradient field inside each body row. The strongest supported left/right interior edges form a paired feature-axis anchor. Their midpoint becomes an additional horizontal residual with bounded confidence rather than replacing silhouette geometry.

The bundle uses Huber loss, bounded per-frame angle corrections and tilt regularization. After a first solve, per-view RMS residuals are compared with a median/MAD gate. One or more outlier frames can be excluded only when at least six usable views remain; otherwise all views stay active so rejection cannot silently collapse the solve. A second solve runs on accepted views. Vertical-axis validation uses a centered weighted regression of vertical residual against body height, avoiding false tilt caused by a constant optical Y offset. If this validation fails, MIRRO refuses the v11 pose model and returns to the previous shared-axis rig.

Rejected frames are excluded from reference/neighbor MVS matching and therefore cannot contribute depth/TSDF observations.

### Edge-aware depth propagation

Cross-view consistency still runs on the original sparse working depth maps. Only a v11 calibrated-perspective scan with a validated feature bundle proceeds to densification. Each accepted depth map is expanded by a bounded factor (capped at 72 columns) using a 3×3 source neighborhood weighted by:

- spatial distance;
- luminance similarity;
- gradient-magnitude similarity;
- source confidence.

Propagation is rejected when support is weak or local depth spread exceeds the conservative threshold. Interpolated-only samples receive lower confidence. Orthographic fallback scans intentionally keep the original sparse grid.

### Benchmark-gated WebAssembly SIMD

The AssemblyScript module now exports fixed hot-path kernels for nine-sample patch ZNCC/texture energy and up-to-eight-view weighted TSDF contribution fusion. At runtime, the Worker/browser warms both JavaScript and WASM paths and microbenchmarks the actual device. The v11 SIMD backend activates only when the WASM patch kernel is no more than 15% slower than the scalar JS reference; otherwise the deterministic JS implementation remains active.

This is deliberately not described as a full native MVS port. Camera/world projection, mask checks, bilinear sampling, outer patch traversal, the X/Y/Z voxel-grid traversal, cross-view logic and marching-tetrahedra extraction remain TypeScript in the Worker. V11 moves bounded numeric hot loops into verified SIMD and refuses a performance regression on devices where JS is faster.

### Semantic anatomy

The body form additionally accepts forearm circumference, calf circumference, neck circumference and shoulder slope. Forearm/calf values alter tapered limb end radii, shoulder slope changes the shoulder joint Y position, and neck circumference is stored as semantic anatomy and influences the head/neck envelope. These measurements remain optional and use bounded deterministic fallbacks when absent.

## Engine roadmap

- Quantify v11 dense-surface error against larger synthetic fixtures and real calibrated scans before raising the depth-grid cap beyond 72 columns.
- Evaluate a memory-resident WASM implementation of projection/sampling/outer voxel traversal only if device benchmarks beat the current Worker TypeScript architecture; v11 intentionally does not claim this yet.
- Add guided measurement UX and consistency checks for forearm, calf, neck and shoulder slope.
- Add import/parsing for verified manufacturer/lab material sheets instead of requiring manual transcription of referenced measurements.
- Expand semantic garment construction to jacket opening/collar/lapels, skirt/dress hem shapes and more category-specific pattern landmarks.
- Move the Worker solver to WASM when mesh density or semantic topology increases substantially.
- Add optional environment-map based image-based lighting and higher-quality soft shadows.

## Cloud boundary (future)

Before cloud sync: define account auth, encryption/storage provider, deletion/retention, authorization, rate limits, upload validation, content-size limits, auditability, and explicit consent for body media. Body images should use private object storage with signed access; metadata should be tenant-scoped.
