# MIRRO — Product context

MIRRO is a local-first digital wardrobe and virtual try-on product. A person can first calibrate the phone lens with 6–12 target photos, then captures eight fixed-camera body views at 45° intervals, basic measurements, and front/back photos of garments. The product helps them preview combinations without physically changing clothes.

## Product truth

- No generative AI in the try-on pipeline.
- Garment appearance and mesh shape must originate from the user's actual garment photos.
- Deterministic processing is preferred: same inputs should produce the same result.
- Body photos are sensitive personal media. The current product stores them only in the user's browser using IndexedDB; there is no server upload.
- Body calibration produces an anatomical BodyMesh. With the printable MIRRO A4 color target visible in all four views, calibration upgrades to metric BodyMesh v3 using per-view pixels/cm; without the target it keeps the v2 weak-perspective fallback.
- BodyMesh still accepts shoulder width, arm length, upper-arm circumference, thigh circumference and inseam. BodyCalibration v7 can add an eight-view visual hull plus a persisted signed-distance field while retaining the anatomical mesh as a semantic/fallback model. A conservative eight-view photometric plane sweep may refine the torso render surface inward, but the SDF collision envelope remains unchanged.
- Optical calibration is independent from body capture: 6–12 target photos solve a reusable local-only camera profile; raw optical photos are not persisted.
- Garment calibration extracts alpha silhouettes from the processed front/back garment images.
- The physical try-on builds a semantic GarmentMesh: tops have torso + left/right sleeve panels; pants/shorts have waistband + left/right leg panels and crotch seams. XPBD resolves stretch, shear, bend, seams, anatomical body collision and garment self-collision in a Web Worker with a main-thread fallback.
- The 3D mode uses Three.js WebGPURenderer with WebGL2 fallback, perspective, depth testing, ACES tone mapping, studio lighting, shadows, roughness and sheen. In v6 raw body photos are resampled to the calibrated frame, lens-undistorted, corrected with a bounded local 3×8 color field and combined through a three-band multiband 360° atlas followed by screened-Poisson gradient-domain seam optimization. Garments can store measured density, thickness, warp/weft stretch, bend stiffness and friction; a reusable engineering fabric library can prefill these values.
- The original photo-based 2D compositor remains available as an honest fallback.

## MVP activation

1. Preferably calibrate the phone once in **Óptica** using 6–12 target photos. Then fix the phone in place and rotate the person through eight 45° stops without changing camera position; advanced limb measurements further refine semantic anatomy.
2. Add at least one garment with front/back images and physical properties; choose an engineering fabric preset or edit the physical values manually. MIRRO calibrates the garment silhouette locally.
3. Open Try-on and use **Físico 3D beta** with the default **PBR** view, switch to **Malha técnica** for diagnostics, or use **Foto 2D** as the legacy visual fallback.
