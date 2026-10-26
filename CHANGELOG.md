# Changelog

All notable changes to this package are documented in this file.

## 0.3.1

- Fix: the bars of `<ax-scrollbar>` follow the size of the document and the places of the markers when the content changes without a scroll or a resize of the window (a client-side navigation, a style sheet, a node added). A node added or removed lays the bars out on the next frame, and the document's scroll size is compared every 100ms.

## 0.3.0

- `touch="indicator|bar"` is the one setting for touch. `indicator` (the default) shows the thumb alone as a panning indicator that takes no input; `bar` makes the bars look and work on touch as they do with a mouse. It replaces `touch-input`.
- `hide` is a plain space-separated list of the parts a look never shows. The `:touch` and `:mouse` qualifiers are gone, and the default list is empty: the touch indicator leaves the buttons, the track and the corner out by itself.
- `demo/minimal.css` sizes every part from the thickness (one unit is a fourteenth of it), so `--ax-scrollbar-thickness` scales the whole Minimal look, as it does the default look.

## 0.2.0

- The default look follows `--ax-scrollbar-thickness`. The thumb and the hovered marker fill the bar, and the buttons (33/17 of the thickness long), the arrows and the markers are the Windows 8 numbers scaled by `thickness / 17px`, so a bar of any thickness is the same drawing and a bar of 17px is unchanged. `--ax-scrollbar-button-length` is the proportion when unset.
- A change of a host token (`--ax-scrollbar-thickness`, `-padding`, `-thumb-min-length` and the others) applies on the next frame, from a style attribute, a rule or an animation, without calling `refresh()`.
- The Windows XP (Luna) kit is a package export: `@ax-design/scrollbar/kits/luna` with `defineLunaKit()`, the colour schemes `lunaSchemes` and `adoptLunaSchemes()`.
- The viewport of `<ax-scroll-view>` takes focus (`tabindex="0"`) only while nothing inside it can, as native scrollers and Windows do. A region with links or buttons is no longer a Tab stop of its own, a text-only region stays keyboard-scrollable, and the choice follows changes of the content.
- Fix: marker objects without an `id` (`{ element, axis }`) all became one tick, as a list keeps one marker per id. Their id and label now come from the element.

## 0.1.0

First release: web components that replace the scrollbars of a container or of the page with ones you style with CSS.

- `<ax-scroll-view>`, a scroll container with scrollbars on both axes, and `<ax-scrollbar>`, the scrollbars of the page. Scrolling stays native; the bars are an overlay.
- The default look is Windows 8 (Modern UI). Every part (thumb, buttons, track, track pieces, corner, markers, hover card) is styled with `::part()` through typed look inputs (`--ax-scrollbar-part-*`) and host tokens (`--ax-scrollbar-*`).
- Markers from `marker-selector` or the `markers` property, with `markerenter`, `markerleave` and `markeractivate` events and a hover card.
- `hide` leaves parts out, per indicator if wanted; `touch-input` gives the bars touch input.
- Layers by configuration with the `{part}-layers` attributes.
- Kits by dependency injection: `defineScrollbarKit()` and `hasScrollbarKit()` with contract classes and default classes for each part.
- Accessibility: native scrolling and focus, forced colours and print give back the native scrollbars, reduced motion removes glides and fades.
