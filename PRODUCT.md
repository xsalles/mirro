# MIRRO — Product context

MIRRO is a local-first digital wardrobe and virtual try-on product. A person captures four body views (front, right, back, left), basic measurements, and front/back photos of garments. The product helps them preview combinations without physically changing clothes.

## Product truth

- No generative AI in the try-on pipeline.
- Garment appearance and mesh shape must originate from the user's actual garment photos.
- Deterministic processing is preferred: same inputs should produce the same result.
- Body photos are sensitive personal media. The current product stores them only in the user's browser using IndexedDB; there is no server upload.
- Body calibration produces an anatomical BodyMesh. With the printable MIRRO A4 color target visible in all four views, calibration upgrades to metric BodyMesh v3 using per-view pixels/cm; without the target it keeps the v2 weak-perspective fallback.
- BodyMesh still accepts shoulder width, arm length, upper-arm circumference, thigh circumference and inseam. BodyCalibration v5 can additionally store a Brown–Conrady lens model, undistorted CameraRig, local texture color field and a denser asymmetric torso centerline derived from lateral contours.
- Garment calibration extracts alpha silhouettes from the processed front/back garment images.
- The physical try-on builds a semantic GarmentMesh: tops have torso + left/right sleeve panels; pants/shorts have waistband + left/right leg panels and crotch seams. XPBD resolves stretch, shear, bend, seams, anatomical body collision and garment self-collision in a Web Worker with a main-thread fallback.
- The 3D mode uses Three.js WebGPURenderer with WebGL2 fallback, perspective, depth testing, ACES tone mapping, studio lighting, shadows, roughness and sheen. In v5 raw body photos are resampled to the calibrated frame, lens-undistorted when justified, corrected with a bounded local 3×8 color field and feather-blended into one 360° body atlas. Garments can store measured density, thickness, warp/weft stretch, bend stiffness and friction; a reusable engineering fabric library can prefill these values.
- The original photo-based 2D compositor remains available as an honest fallback.

## MVP activation

1. Save four body views and measurements. For metric v3, print the MIRRO A4 target and keep it visible in every view; advanced limb measurements further refine the anatomy.
2. Add at least one garment with front/back images and physical properties; choose an engineering fabric preset or edit the physical values manually. MIRRO calibrates the garment silhouette locally.
3. Open Try-on and use **Físico 3D beta** with the default **PBR** view, switch to **Malha técnica** for diagnostics, or use **Foto 2D** as the legacy visual fallback.
