# MIRRO UX contract

## Canonical operations

- **Save body:** validate client-side, keep previous saved profile until the new save succeeds, then show an inline live status. The body flow allows replacing individual views.
- **Add garment:** validate name + two images, process locally, persist media + metadata, then clear only the new-item form.
- **Delete garment:** is irreversible within the current local dataset. The delete affordance is explicit, scoped to one garment, and requires an app-owned confirmation naming the consequence.
- **Try-on:** never modifies saved body or garment media. Calibration controls are session-local.

## State and storage

- IndexedDB is the canonical MVP owner for profile metadata and media blobs.
- No body or garment image is sent over the network in the bootstrap milestone.
- Loading should keep layout stable; empty states explain the next action.
- Product forms use `noValidate`; inline errors describe recovery and invalid fields expose `aria-invalid`.

## Responsive behavior

- Desktop: left navigation rail + document-scrolling content.
- Mobile: fixed bottom navigation with content padding that keeps actions reachable.
- The try-on preview keeps a 3:4 stage and controls move below it on smaller screens.

## Accessibility

Target WCAG 2.2 AA. Native buttons/links/inputs are preferred. All interactive elements need keyboard focus, pointer hover where relevant, and touch-sized targets. Motion must honor `prefers-reduced-motion`.
