# MIRRO UX contract

## Canonical operations

- **Save body:** validate client-side, resolve all four local images, detect the MIRRO A4 target, extract silhouettes and texture exposure statistics, then attempt the shared pinhole CameraRig. Persist BodyCalibration v4 only when the camera solve succeeds; otherwise preserve the metric v3 / weak-perspective fallback. Keep the previous saved profile untouched on failure.
- **Replace body view:** allows replacing one or more views. Any changed photo or measurement makes the previous calibration stale until the user explicitly recalibrates.
- **Add garment:** validate name + two images + physical fabric profile, remove backgrounds locally, calibrate front/back alpha silhouettes, persist media/calibration/fabric metadata, then clear only the new-item form. Library presets only prefill the explicit solver values; any manual physics edit detaches the library id so the UI never implies an untouched preset.
- **Delete garment:** is irreversible within the current local dataset. The delete affordance is explicit, scoped to one garment, and requires an app-owned confirmation naming the consequence.
- **Physical try-on:** ensure an anatomical BodyMesh v2 (upgrade legacy v1 calibration in memory when needed), build a fresh semantic runtime GarmentMesh, simulate locally with anatomical body + garment self-collision, then render the saved front/back garment textures over solved UV regions. Never mutate source garment media.
- **Legacy garment:** if a previously saved garment has no calibration metadata, derive calibration on demand from its stored processed PNGs.
- **2D fallback:** remains available independently from the physical simulation and keeps its session-local position controls.

## State and storage

- IndexedDB is the canonical MVP owner for profile metadata and media blobs.
- Body calibration metadata, target calibration, advanced measurements and BodyMesh arrays are local IndexedDB state. New fully targeted calibrations persist BodyMesh v3; v2/v1 remain readable.
- Garment alpha calibration is local metadata; XPBD mesh positions are runtime-only and are regenerated when the user changes garment or requests re-simulation.
- No body or garment image, metric target result or fabric profile is sent over the network in the current milestone.
- Body calibration reports honest named stages.
- XPBD uses determinate progress because the current solver runs a known 144-step budget. The preferred execution owner is a Web Worker; if worker startup fails, the same simulation contract falls back locally without changing user inputs.
- Simulation errors keep the selected garment and expose an explicit retry.
- Loading should keep layout stable; empty states explain the next action.
- Product forms use `noValidate`; inline errors describe recovery and invalid fields expose `aria-invalid`.

## Responsive behavior

- Desktop: left navigation rail + document-scrolling content.
- Mobile: fixed bottom navigation with content padding that keeps actions reachable.
- BodyMesh diagnostics stack beneath the form on narrow viewports.
- Try-on stage and controls stack vertically on smaller screens.
- Physical and photo modes share the same garment selector. Physical mode defaults to PBR and exposes a technical mesh view without changing simulation state.

## Accessibility

Target WCAG 2.2 AA. Native buttons/links/inputs are preferred. All interactive elements need keyboard focus, pointer hover where relevant, and touch-sized targets. Simulation progress is announced through a polite live region, and motion must honor `prefers-reduced-motion`.
