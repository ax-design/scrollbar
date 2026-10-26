# Changelog

All notable changes to this package are documented in this file.

## 0.1.0

First release: web components that replace the scrollbars of a container or of the page with ones you style with CSS.

- `<ax-scroll-view>`, a scroll container with scrollbars on both axes, and `<ax-scrollbar>`, the scrollbars of the page. Scrolling stays native; the bars are an overlay.
- The default look is Windows 8 (Modern UI). Every part (thumb, buttons, track, track pieces, corner, markers, hover card) is styled with `::part()` through typed look inputs (`--ax-scrollbar-part-*`) and host tokens (`--ax-scrollbar-*`).
- Markers from `marker-selector` or the `markers` property, with `markerenter`, `markerleave` and `markeractivate` events and a hover card.
- `hide` leaves parts out, per indicator if wanted; `touch-input` gives the bars touch input.
- Layers by configuration with the `{part}-layers` attributes.
- Kits by dependency injection: `defineScrollbarKit()` and `hasScrollbarKit()` with contract classes and default classes for each part.
- Accessibility: native scrolling and focus, forced colours and print give back the native scrollbars, reduced motion removes glides and fades.
