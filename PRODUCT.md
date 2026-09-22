# MIRRO — Product context

MIRRO is a local-first digital wardrobe and virtual try-on product. A person captures four body views (front, right, back, left), basic measurements, and front/back photos of garments. The product helps them preview combinations without physically changing clothes.

## Product truth

- No generative AI in the try-on pipeline.
- Garment appearance and mesh shape must originate from the user's actual garment photos.
- Deterministic processing is preferred: same inputs should produce the same result.
- Body photos are sensitive personal media. The current product stores them only in the user's browser using IndexedDB; there is no server upload.
- Body calibration produces a centimeter-based anatomical BodyMesh v2 from four classically segmented silhouettes plus explicit measurements. Torso, head, arms and legs are separate geometry/collision regions.
- The current BodyMesh uses weak-perspective normalization, not solved camera intrinsics or a final anatomical reconstruction.
- Garment calibration extracts alpha silhouettes from the processed front/back garment images.
- The physical try-on builds a semantic GarmentMesh: tops have torso + left/right sleeve panels; pants/shorts have waistband + left/right leg panels and crotch seams. XPBD resolves stretch, shear, bend, seams, anatomical body collision and garment self-collision in a Web Worker with a main-thread fallback.
- The 3D mode now has a PBR renderer using Three.js WebGPURenderer with WebGL2 fallback, perspective, depth testing, ACES tone mapping, studio lighting, shadows, roughness and sheen. It remains a **physics beta**, because camera reconstruction is still weak-perspective and cloth properties come from presets rather than measured material data.
- The original photo-based 2D compositor remains available as an honest fallback.

## MVP activation

1. Save four body views and measurements and generate anatomical BodyMesh v2. Legacy v1 profiles are upgraded in memory for try-on.
2. Add at least one garment with front/back images and physical properties; MIRRO calibrates the garment silhouette locally.
3. Open Try-on and use **Físico 3D beta** with the default **PBR** view, switch to **Malha técnica** for diagnostics, or use **Foto 2D** as the legacy visual fallback.
