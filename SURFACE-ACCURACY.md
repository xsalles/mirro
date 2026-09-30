# MIRRO surface-accuracy protocol

This document defines the evidence required before MIRRO increases the v11 edge-aware depth-grid cap beyond 72 columns.

## What is measured

The validation layer consumes signed reconstruction errors in centimeters and reports:

- mean absolute error (MAE)
- root mean square error (RMSE)
- median absolute error (p50)
- p95 absolute error
- maximum absolute error
- signed bias
- sample count and coverage

The current default guardrails are engineering release gates, not claims of medical or metrology-grade accuracy:

- RMSE <= 3.0 cm
- p95 absolute error <= 5.0 cm
- absolute signed bias <= 2.0 cm
- at least 24 valid samples per dataset
- at least 95% coverage of the samples declared by that dataset

A dataset can use stricter thresholds, but raising the runtime depth density must not weaken these defaults merely to make a release pass.

## Evidence gate

The default evidence policy requires all of the following:

1. at least 6 passing synthetic datasets
2. at least 3 passing real calibrated datasets
3. zero failing datasets in the evidence set used for the decision

Until all three conditions are true, `canRaiseDepthGridCap` remains false and the production cap stays at 72 columns.

The policy is deliberately separate from the MVS implementation. It prevents a performance or visual-quality change from silently redefining what counts as acceptable accuracy.

## Synthetic evidence

Synthetic datasets should exercise the complete deterministic MVS path whenever possible, not only the statistics helper.

The first v12 fixture uses the existing calibrated eight-view perspective cylinder and evaluates the dense v11 depth maps independently for every turntable view. Each accepted depth sample is compared with the analytic perspective ground truth for the same pixel ray.

Future synthetic fixtures should vary:

- body radius/profile and asymmetry
- camera distance and focal length
- texture frequency and contrast
- controlled exposure differences
- small pose/turntable angle perturbations
- isolated bad frames
- low-texture regions and partial occlusion

Synthetic evidence is useful for regressions and known ground truth, but it does not replace real capture evidence.

## Real calibrated evidence

A real dataset must have an independent geometric reference. Examples include a calibrated structured-light scan, a validated photogrammetry reference, or another traceable 3D measurement pipeline with known units.

For each real dataset, retain only the minimum evidence necessary for reproducibility:

- anonymous dataset id
- reference method and device
- reference calibration/version
- MIRRO optical profile/version
- alignment method
- signed error samples or a derived error report
- sample/coverage counts
- date and software commit

Do not commit raw body photographs or identifiable scan media to the repository. Derived numeric data should be anonymized and reviewed before inclusion.

## Alignment rule

The MIRRO surface and independent reference must be aligned in the same centimeter coordinate system before error sampling. Alignment must not non-rigidly deform either surface to make the result look better.

Rigid translation/rotation is acceptable when the two systems use different origins. Uniform scale correction is acceptable only when a documented calibration-unit mismatch is being corrected; it must be recorded in the dataset metadata.

## Release decision

The evidence summary is a gate for raising density, not an automatic instruction to raise it. Passing accuracy evidence still requires device performance and memory benchmarks before changing the runtime cap.

If the evidence gate fails, MIRRO keeps the current cap and the conservative v7 SDF collision envelope unchanged.
