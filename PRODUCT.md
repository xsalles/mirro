# MIRRO — Product context

MIRRO is a local-first digital wardrobe and virtual try-on product. A person captures four body views (front, right, back, left), basic measurements, and front/back photos of garments. The product helps them preview combinations without physically changing clothes.

## Product truth

- No generative AI in the try-on pipeline.
- Garment appearance and mesh shape must originate from the user's actual garment photos.
- Deterministic processing is preferred: same inputs should produce the same result.
- Body photos are sensitive personal media. The current product stores them only in the user's browser using IndexedDB; there is no server upload.
- Body calibration produces a coarse centimeter-based 3D collision hull from four classically segmented silhouettes plus explicit measurements.
- The current BodyMesh uses weak-perspective normalization, not solved camera intrinsics or a final anatomical reconstruction.
- Garment calibration extracts alpha silhouettes from the processed front/back garment images.
- The physical try-on now builds a two-panel GarmentMesh and runs an XPBD cloth solver with structural, shear, bend and seam constraints plus BodyMesh collision.
- The 3D mode is a **physics beta**, not a photoreal final renderer. The processed front/back garment photos are texture-mapped onto solved UV triangles, and a spatial-hash self-collision pass prevents non-neighbor cloth particles from intersecting. PBR lighting and separate leg/arm topology are still pending.
- The original photo-based 2D compositor remains available as an honest fallback.

## MVP activation

1. Save four body views and measurements and generate BodyMesh v1.
2. Add at least one garment with front/back images and physical properties; MIRRO calibrates the garment silhouette locally.
3. Open Try-on and use **Físico 3D beta** to generate GarmentMesh + XPBD simulation, or switch to **Foto 2D** fallback.
