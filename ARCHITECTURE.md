# MIRRO architecture

## Current vertical slice

Next.js App Router + React client components for local-only workflows. IndexedDB stores sensitive media, derived silhouette metadata, BodyMesh data, and garment calibration metadata. No authentication, database, or object storage is connected because body-photo privacy/retention rules must be explicit before server persistence.

## Body calibration pipeline — implemented

1. Each body photo is downscaled locally to a bounded processing resolution.
2. Border pixels estimate the background color distribution.
3. A connected flood fill removes background pixels reachable from the image edges.
4. The largest remaining connected component becomes the person's binary silhouette.
5. Each silhouette is normalized by its detected body height into a 64-sample horizontal width profile.
6. Front + back are confidence-weighted into the X width profile; left + right become the Z depth profile.
7. Known physical height converts normalized profiles into centimeters.
8. Tórax, cintura e quadril are detected as extrema inside constrained torso bands, then corrected to the user's measured circumferences.
9. 64 elliptical rings × 32 segments produce an indexed, watertight coarse mesh with vertex normals and centimeter coordinates.
10. Calibration quality records per-view confidence and opposite-view disagreement.

The resulting mesh is a **coarse collision hull v1**. It is useful as a deterministic 3D body envelope and cloth-collision input, but it does not model separate arms/legs or solve full camera intrinsics.

## Camera model

The current calibration uses weak-perspective normalization: each view is independently scaled by detected body height, which reduces moderate camera-distance differences. This is not a calibrated pinhole-camera reconstruction. A later capture protocol can add known camera intrinsics/extrinsics or fiducial markers without changing the BodyMesh contract.

## Garment image + calibration pipeline — implemented

1. User photographs garment front/back on a visually uniform background.
2. Canvas downsizes to a bounded working resolution.
3. Corner/background samples estimate the background RGB.
4. Euclidean color distance removes/feathers the background into PNG alpha.
5. Alpha silhouettes are sampled into 48 horizontal width + center profiles for front and back.
6. Front/back consistency produces a garment calibration score and warnings.
7. The processed PNGs and calibration metadata are stored locally.

Legacy garments without calibration are recalibrated on demand from their stored processed PNGs when physical try-on starts.

## GarmentMesh v1 — implemented

- Two independent panels are generated from the **actual calibrated front/back silhouettes**, not from a fixed rectangular garment.
- Category-aware scaling anchors tops around the chest/shoulder band and pants/shorts around waist/hips.
- Image aspect ratio influences physical garment length while body size bounds the scale.
- The initial surface is placed just outside the elliptical BodyMesh, using local section depth at each row.
- Each panel contains structural, shear and bend constraints.
- Left/right edges receive seam constraints.
- Tops, shirts and hoodies also receive shoulder seams with an unsewn center neck opening.
- UV coordinates are generated for every particle and mapped back to the calibrated source-image bounds.

Current pants/shorts remain a **single envelope** around both legs because BodyMesh v1 does not yet separate left/right leg topology.

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

## Collision model — implemented

At each cloth particle Y coordinate, MIRRO interpolates an elliptical BodyMesh cross-section. Particles that enter the expanded ellipse are projected back to its boundary, with garment thickness included in the collision radius.

Garment self-collision uses a uniform 3D spatial hash whose cell size follows cloth collision thickness. Each particle checks only its 27 neighboring cells, and pairs already connected by structural, shear, bend or seam constraints are excluded. This avoids the O(n²) all-pairs path while preventing distant folds and opposite panels from occupying the same space.

Both collision paths are deterministic, but body collision inherits the BodyMesh v1 limitation: merged arm/leg volume instead of anatomical limb topology.

## Rendering

The physical preview currently uses a dependency-free Canvas 2D orthographic renderer:

- BodyMesh wireframe
- depth-sorted GarmentMesh triangles
- interactive yaw rotation
- simulation diagnostics
- affine per-triangle projection of the processed **real front/back garment textures** after the solver stabilizes

This preview intentionally does **not** claim photorealism. It deforms the real garment photos, but it does not yet provide PBR lighting, perspective-camera calibration, fabric shading or self-shadowing.

The original photo-based 2D compositor remains as a fallback mode.

## Engine roadmap

- Separate BodyMesh torso, arms and left/right legs.
- Add explicit camera calibration / capture fiducials for metric multi-view reconstruction.
- Split garment topology by semantic regions (sleeves, torso, crotch, legs, waistband).
- Add collision against separate anatomical body limbs once BodyMesh topology is split.
- Move the Worker solver to WASM when mesh density or semantic garment topology increases substantially.
- Add Three.js/WebGPU rendering with WebGL fallback where needed.

## Cloud boundary (future)

Before cloud sync: define account auth, encryption/storage provider, deletion/retention, authorization, rate limits, upload validation, content-size limits, auditability, and explicit consent for body media. Body images should use private object storage with signed access; metadata should be tenant-scoped.
