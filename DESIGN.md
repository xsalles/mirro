---
version: alpha
colors:
  canvas: "#f7f8fa"
  surface: "#ffffff"
  surfaceMuted: "#eef0f5"
  ink: "#111318"
  muted: "#626875"
  line: "#dfe2e8"
  thread: "#5266ff"
  threadSoft: "#dfe3ff"
  mint: "#b9f1d2"
  danger: "#d9473f"
typography:
  display:
    fontFamily: "Syne, sans-serif"
  sans:
    fontFamily: "Manrope, sans-serif"
rounded:
  card: "16px"
  control: "12px"
spacing:
  unit: "4px"
components:
  button:
    radius: "12px"
  card:
    radius: "16px"
---

# MIRRO design system

## Overview
MIRRO should feel like a digital fitting studio: precise, quiet, tactile, and fashion-aware without becoming editorial decoration. The memorable signature is the **thread blue** used as a calibration/seam accent against neutral studio surfaces. Product screens prioritize operation and trust; the public page can be more expressive.

Anti-references: generic AI dashboards, neon cyberpunk, beige luxury templates, glass cards, and fashion-magazine layouts that hide controls.

## Colors
Neutral studio surfaces keep body and garment imagery visually dominant. `thread` is the only expressive accent and is also the keyboard-focus color. `mint` marks completed setup. Danger is reserved for destructive or invalid states.

## Typography
Syne is reserved for the brand and major headings. Manrope handles controls, body copy, measurements, and dense product UI. Measurements use tabular numerals where values change.

## Layout
Mobile-first product layout. Under 1024px, navigation is a bottom bar with large touch targets. At desktop widths, navigation moves to a quiet left rail. Forms use natural document scrolling; no app-wide fixed-height content shell.

## Elevation & Depth
Most product surfaces are flat with a border. Strong shadow is reserved for the virtual mirror stage or mobile floating navigation where depth communicates layering.

## Shapes
Cards use 16px radii; controls use 12px. Pills are reserved for compact status labels. Body/garment imagery can use larger 24–28px clipping when it represents the mirror stage.

## Components
Buttons use semantic emphasis rather than gradients. Upload areas always retain a native file input path. Inputs expose visible focus and inline errors. The try-on stage is the only visually dominant object in the product.

## Do's and Don'ts
Do make calibration state explicit, keep privacy copy concrete, preserve usable narrow layouts, and respect reduced motion. Do not imply 3D or physical accuracy before the engine provides it, hide file limits, use generic skeleton-heavy dashboards, or upload body photos without an explicit storage/privacy decision.
