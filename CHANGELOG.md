# Changelog

All notable changes to this package are documented in this file.

## 0.4.3

- Parts are made on demand. A part is made the first time the layout needs it and kept after that: a bar that never shows (its axis never scrolls), a kind in `hide`, markers that are hidden, a corner without the other bar and a card that never opens make no element at all, where all of them were made for every scroll view when it connected. The docs page of the scrollbar, with fifty scroll views, went from 903 shadow roots to 372, and a scroll view that scrolls one way makes a third fewer parts. A kit's classes are used the same way. A bar that shows for the first time makes its parts in the frame that finds it and draws them in the next (it is not seen before: its track has no room for the buttons until they are made, and a thumb drawn there would slide to its place).
- Mounting twenty scroll views scripts less than half as long (the package's own scripting, median of five runs in `bench/run.ts`, went from 71 and 83 ms to 30 and 27 ms on a loaded machine, and from 49 to 23 ms on a quiet one; the scripting of the whole page from 162 and 188 ms to 81 and 71 ms; the renderer's CPU time of the mount fell by a quarter; the frame time of a wheel scroll is the same). Besides the parts that are no longer made: the first frame of a scrollbar waits for the notice of its resize observer, which comes after the browser has laid the page out, so it reads a layout that is there and does not force the browser to lay out the whole page from inside the frame (a browser check traces the mount and finds no style or layout forced by a read of the scrollbar); the structure style of the shadow roots is one adopted sheet and their markup is cloned from a template; the markers of a bar are inserted together; the viewport is read once for all the markers it measures; attributes of a part are written when they change, not all of them each time.
- `register()` registers every custom property of the package (host tokens, look inputs, those the CSS uses) and, with the layers of Surface 0.4.4, those of the layers; `defineLunaKit()` registers the Luna tokens. A registration invalidates the style of the whole page, and with the parts made on demand it would have come when the first card opened, or when the first Luna part was made, after the page had grown. A browser check reads them as registered before any part is made.
- Depends on `@ax-design/surface` 0.4.4 and `@ax-design/typed-om` 0.3.1.
- Browser checks assert that parts are made when needed and not before, for a kit as well (with the layers of the attribute set before they existed); the checks that read parts of a bar that does not show read the new truth.

## 0.4.2

- Luna kit: one colour recolours a scheme. `--luna-accent`, `--luna-accent-deep` and `--luna-glyph` accept `auto`, which is what they are in a scheme that does not set them, and the parts derive them from `--luna-accent-light` in OKLCH whenever the scheme's values change. The hue of the colour is kept; the accent and the deep tone are darker and more chromatic; the arrows and the grip lines are a dark tone of the hue on a light colour and white on a dark one (below a lightness of 0.8245, between Olive Green's body and Blue's). The relations are fitted to Blue, Purple, Orange and Pink for the Luna style and to Silver and Gold for the metallic one, and are written down in `src/kits/luna/tones.ts`. The seven shipped schemes set their tones and render as before.
- Luna kit: a metallic custom scheme is documented. It sets `--luna-light: top` and takes the numbers of Silver, and its colour is `--luna-accent-light`; the README has an example.
- Luna kit: the thumb's four grip lines stay four crisp lines at a zoom of 110%, 125% and 150%, where a CSS px is not a whole number of device pixels and the lines ran together. There the grip is drawn in device pixels, a line being `round(dpr)` of them, centred as the theme centres it and placed on whole pixels. At 100% and 200% it is drawn as before.
- While `snap` is set the thumb carries `--ax-scrollbar-thumb-nudge`, the distance in CSS px that something drawn inside the thumb adds to its place along the bar to land on whole device pixels.
- Browser checks for the derived tones (the arrows, the rings and the grip lines at pale blue, dark green, mid purple, pale gold and dark grey) and for the grip lines at 100%, 110%, 125%, 150% and 200% on real device pixel ratios, vertical and horizontal.

## 0.4.1

- A bar that is not shown costs nothing. The default parts are paused (`@ax-design/surface` 0.4.3) while the indicator is away: a scroll view that nobody has touched runs no frame, reads no style and draws no layer, and its parts wake with the first scroll or pointer, fading in as before. A page of twenty scroll views scripts less than half as long when it mounts.
- Benchmark and release checks: idle without a frame callback or a timer, parts paused at rest, and the thumb painted on the columns of the buttons at a fractional device pixel ratio.

## 0.4.0

- One frame scheduler. The scrollbars no longer run a frame loop of their own: each is a client of the scheduler of `@ax-design/surface` (0.4.2), with its priority (a press on a bar, a pointer at one, a scroll the user watches, the rest), and the animation of a part's look steps in the part's own surface frame. Nothing in the package asks for an animation frame by itself. Every client of a frame reads before any of them writes, so twenty scroll views mounting or scrolling together lay out once, not once each.
- Changes are coalesced. An attribute, a token, a mutation or a resize only marks what is dirty; the styles and the layout are read once per frame, and the writes come after the reads. A host token is read once per change, not once per use.
- Idle is free. With nothing moving there is no frame callback, no timer and no style read, also on the page: the scroll size of the document is observed (the resize observer on the root, the body and the children of the body, the mutation observer, loads and fonts) and no longer compared on a timer. A rule that changes the scroll size where nothing is observed is seen in the first frame that runs afterwards (a scroll, a pointer at the bar), or with `refresh()`.
- The indicator's idle delay is a deadline checked by one timer, not a timer set again by every scroll.
- Faster scrolling on a page of many scroll views: the thumb and the markers move with 2D transforms instead of 3D ones (which gave each its own compositor layer and layerized the page on every scroll frame), and the parts share one visibility watch on their element.
- Fix: at a fractional device pixel ratio (1.25, 1.5) the thumb of the page scrollbar started one device pixel before the button next to it unless `snap` was set. The thumb is no longer a compositor layer of its own, so it is painted on the same columns as the buttons with and without `snap`.
- `bench/` holds a benchmark page of 20 scroll views and a CDP driver (`bun run bench`): frame callbacks and timers at idle, scripting while the views mount, and main-thread time per frame while one scrolls.

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
