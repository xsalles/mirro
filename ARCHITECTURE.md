# MIRRO architecture

## Current vertical slice

Next.js App Router + React client components for local-only workflows. IndexedDB stores sensitive media, derived silhouette metadata, and the generated BodyMesh. No authentication, database, or object storage is connected because body-photo privacy/retention rules must be explicit before server persistence.

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

The resulting mesh is a **coarse collision hull v1**. It is useful as a deterministic 3D body envelope and future cloth-collision input, but it does not model separate arms/legs or solve full camera intrinsics.

## Camera model

The current calibration uses weak-perspective normalization: each view is independently scaled by detected body height, which reduces moderate camera-distance differences. This is not a calibrated pinhole-camera reconstruction. A later capture protocol can add known camera intrinsics/extrinsics or fiducial markers without changing the BodyMesh contract.

## Garment image pipeline

1. User photographs garment on a visually uniform background.
2. Canvas downsizes to a bounded working resolution.
3. Corner/background samples estimate the background RGB.
4. Euclidean color distance removes/feathers pixels near that color.
5. The PNG alpha image is stored locally.
6. A pure geometry function maps body measurements + garment category to an initial 2D fit box.
7. User can correct scale/X/Y without changing source media.

The garment preview remains an MVP 2D approximation.

## Engine roadmap

- Improve body topology from one-ring-per-height hull to separate torso, arms and legs.
- Add explicit camera calibration / capture fiducials for metric multi-view reconstruction.
- Generate garment meshes from known dimensions and category templates.
- XPBD cloth simulation with collision against the BodyMesh.
- Three.js/WebGPU rendering, with a WebGL fallback if required by supported devices.

## Cloud boundary (future)

Before cloud sync: define account auth, encryption/storage provider, deletion/retention, authorization, rate limits, upload validation, content-size limits, auditability, and explicit consent for body media. Body images should use private object storage with signed access; metadata should be tenant-scoped.
