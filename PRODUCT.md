# MIRRO — Product context

MIRRO is a local-first digital wardrobe and virtual try-on product. A person captures four body views (front, right, back, left), basic measurements, and front/back photos of garments. The product helps them preview combinations without physically changing clothes.

## Product truth

- No generative AI in the try-on pipeline.
- Garment appearance must originate from the user's actual garment photos.
- Deterministic processing is preferred: same inputs should produce the same result.
- Body photos are sensitive personal media. The bootstrap MVP stores them only in the user's browser using IndexedDB; there is no server upload yet.
- Current milestone is a 2D calibration engine. 3D body reconstruction and cloth simulation are future engine milestones, not claims of the current UI.

## MVP activation

1. Save four body views and measurements.
2. Add at least one garment with front/back images and physical properties.
3. Open Try-on, choose a garment, and adjust deterministic placement.
