# FloFi logo symbol canvas cursor

Derived directly from the existing approved FloFi logo symbol SVGs:

- Light: `flofi-symbol-light.svg` → `flofi-mascot-cursor.png` (official blue symbol).
- Dark: `flofi-symbol-dark.svg` → `flofi-mascot-cursor-dark.png` (official white symbol).

Each transparent RGBA PNG is 32 × 32 pixels, with approximately 28 × 28 pixels of visible artwork. Rasterize the unchanged SVG with Sharp at 288 dpi, then resize to 32 × 32 using `fit: 'contain'` and a transparent background. Preserve the source viewBox, proportions, paths and colors; PNG encoding is lossless. Existing cursor filenames are retained to preserve all references.

Native CSS cursor hotspot: **29, 3**, at the symbol's upper-right leading edge, on an opaque pixel in both theme assets. Normal fallback: `default`.

Only the neutral workflow canvas surface and idle pane use this cursor. Buttons, inputs, draggable nodes, active pane dragging, selection and connector handles retain their interaction cursors. No JavaScript cursor element or tracking code is used.

The separate waving empty-state artwork (`flofi-droplet-wave.svg` and `flofi-droplet-wave-dark.svg`) remains unchanged.
