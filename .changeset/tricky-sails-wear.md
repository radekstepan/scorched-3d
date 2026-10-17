---
"@scorched-3d/web": minor
---

Replace the floating terrain-demo HUD with a full RTS command shell inspired by the actual `redesign-stumpy-tank-model` viewer: charcoal/olive surfaces, lime instrument accents, Barlow Condensed headings, fine panel dividers, a brand/navigation header and a compact command/status strip. The displayed release comes from APP_VERSION. Battlefield navigation deliberately leaves room for the next unit-folio task without introducing an inactive or misleading folio control.

Reserve independent grid tracks for the world/radar rail, battlefield and inspector so controls cannot overlap the canvas or header on desktop. Keep all world regeneration, view options, live unit counts, probe, minimap position/territory overlays and team selection icons. Move noisy terrain diagnostics into a native expandable inspector section. Keep selection cards inside the battlefield and horizontally scroll long selections. The canvas already uses ResizeObserver, so its rendering and picking adapt to the smaller central viewport without new renderer machinery.

At widths up to 1000px replace the permanent rails with mutually exclusive Worlds / radar and Inspector drawers. Keep the battlefield full width, expose drawer expanded state and world/toggle pressed state to assistive technology, and add visible focus outlines. Each rail scrolls within the space between header and footer; prevent radar cards from flex-shrinking. Clear grid-area placement on mobile drawers so their absolute offsets resolve against the whole shell instead of their former desktop grid tracks.

Update the README with the shell and mobile behavior. Replace obsolete floating-header clearance assertions with grid, scroll, drawer, selection-tray and accessibility regression contracts using the existing source-level App testing convention. Tighten the minimap image test to match only its own img element, since selection thumbnails now precede it. Validation: 85 focused App/minimap/selection tests passed, web typecheck and production build passed; native browser screenshots inspected at desktop and 390×780, including switching between drawers. No Playwright was run.
