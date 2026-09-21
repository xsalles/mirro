# MIRRO — Product context

MIRRO is a local-first digital wardrobe and virtual try-on product. A person captures four body views (front, right, back, left), basic measurements, and front/back photos of garments. The product helps them preview combinations without physically changing clothes.

## Product truth

- No generative AI in the try-on pipeline.
- Garment appearance must originate from the user's actual garment photos.
- Deterministic processing is preferred: same inputs should produce the same result.
- Body photos are sensitive personal media. The current product stores them only in the user's browser using IndexedDB; there is no server upload.
- Body calibration now produces a coarse centimeter-based 3D collision hull from four classically segmented silhouettes plus explicit measurements.
- The current BodyMesh uses weak-perspective normalization, not solved camera intrinsics or a final anatomical reconstruction.
- Garment try-on is still a 2D approximation. Cloth simulation remains a future engine milestone and must not be presented as complete.

## MVP activation

1. Save four body views and measurements and generate BodyMesh v1.
2. Add at least one garment with front/back images and physical properties.
3. Open Try-on, choose a garment, and adjust deterministic placement.
