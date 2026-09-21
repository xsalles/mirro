# MIRRO UX contract

## Canonical operations

- **Save body:** validate client-side, resolve all four local images, extract four silhouettes, generate BodyMesh, then persist media + profile only after calibration succeeds. Keep the previous saved profile untouched on calibration failure.
- **Replace body view:** allows replacing one or more views. Any changed photo or measurement makes the previous calibration stale until the user explicitly recalibrates.
- **Add garment:** validate name + two images, remove their backgrounds locally, calibrate front/back alpha silhouettes, persist media + calibration metadata, then clear only the new-item form.
- **Delete garment:** is irreversible within the current local dataset. The delete affordance is explicit, scoped to one garment, and requires an app-owned confirmation naming the consequence.
- **Physical try-on:** build a fresh runtime GarmentMesh from saved immutable garment calibration, simulate locally with body + garment self-collision, then project the saved front/back garment textures onto the solved UV triangles. Never mutate source garment media or BodyMesh.
- **Legacy garment:** if a previously saved garment has no calibration metadata, derive calibration on demand from its stored processed PNGs.
- **2D fallback:** remains available independently from the physical simulation and keeps its session-local position controls.

## State and storage

- IndexedDB is the canonical MVP owner for profile metadata and media blobs.
- Body calibration metadata and BodyMesh arrays are local IndexedDB state.
- Garment alpha calibration is local metadata; XPBD mesh positions are runtime-only and are regenerated when the user changes garment or requests re-simulation.
- No body or garment image is sent over the network in the current milestone.
- Body calibration reports honest named stages.
- XPBD uses determinate progress because the current solver runs a known 144-step budget.
- Simulation errors keep the selected garment and expose an explicit retry.
- Loading should keep layout stable; empty states explain the next action.
- Product forms use `noValidate`; inline errors describe recovery and invalid fields expose `aria-invalid`.

## Responsive behavior

- Desktop: left navigation rail + document-scrolling content.
- Mobile: fixed bottom navigation with content padding that keeps actions reachable.
- BodyMesh diagnostics stack beneath the form on narrow viewports.
- Try-on stage and controls stack vertically on smaller screens.
- Physical and photo modes share the same garment selector.

## Accessibility

Target WCAG 2.2 AA. Native buttons/links/inputs are preferred. All interactive elements need keyboard focus, pointer hover where relevant, and touch-sized targets. Simulation progress is announced through a polite live region, and motion must honor `prefers-reduced-motion`.
