<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ax-design/scrollbar/master/docs/logo-r.png">
    <img src="https://raw.githubusercontent.com/ax-design/scrollbar/master/docs/logo.png" alt="Ax Scrollbar">
  </picture>
</h1>

<p align="center">
  Web components that replace the scrollbars of a container or of the page, for Axiom Design System.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ax-design/scrollbar"><img src="https://img.shields.io/npm/v/@ax-design/scrollbar.svg" alt="npm version"></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT Licence" />
</p>

`<ax-scroll-view>` is a scroll container and `<ax-scrollbar>` draws the scrollbars of the page. Scrolling stays native (wheel, touch, keys, find in page, `scrollIntoView`); the bars are an overlay that shows the position and drives the viewport. The default look is the Windows 8 (Modern UI) scrollbar, and every part of it (thumb, buttons, track, markers, hover card) is styled with `::part()` or replaced by a kit.

## Installation

```bash
# with npm
npm install @ax-design/scrollbar

# with bun
bun add @ax-design/scrollbar
```

and import it:

```javascript
// CommonJS
require('@ax-design/scrollbar').register();

// ES modules
import { register } from '@ax-design/scrollbar';
register();
```

`register()` defines `<ax-scroll-view>`, `<ax-scrollbar>`, the part elements (`<ax-scrollbar-thumb>` and the others), the `scrollbar-fill` and `scrollbar-glyph` layers, the `elevation` layer and, through `@ax-design/surface`, `<ax-surface>`. It is safe to call more than once.

If you don't use a bundler, load `build/main.js` (it exposes `AxScrollbar`) or import `build/index.mjs`.

## Usage

### Scroll view

Wrap the content in `<ax-scroll-view>` and give it a height:

```html
<ax-scroll-view style="height: 420px">
  <article>
    <h2>Introduction</h2>
    <p>...</p>
  </article>
</ax-scroll-view>
```

* The element needs a height: its viewport is absolutely positioned, so it does not size itself from its content.
* Put padding on the content, not on the element: the viewport covers the element's padding box.
* The element has the scroll API of an element (`scrollTop`, `scrollLeft`, `scrollHeight`, `scrollWidth`, `scrollTo()`, `scrollBy()`, `scroll()`), acting on the viewport. `scroll` and `scrollend` are dispatched on the element too, without bubbling. `viewport` is the element that really scrolls.
* The bars are drawn over the content and never shrink the scroller. The component writes the thickness of the shown bars on the host as `--ax-scrollbar-vertical-size` and `--ax-scrollbar-horizontal-size` (`0px` for a bar that is not shown), so the content can keep clear of them:

```css
ax-scroll-view > .body {
  padding-right: var(--ax-scrollbar-vertical-size);
}
```

### Page scrollbars

Place one `<ax-scrollbar>` anywhere in the page:

```html
<body>
  <ax-scrollbar></ax-scrollbar>
  ...
</body>
```

* A page has one. A second `<ax-scrollbar>` logs a warning and stays inert.
* It hides the native scrollbar of the page and draws its own over it. The page still scrolls natively.
* It is a fixed overlay over the window that takes no pointer events. Its `z-index` is `--ax-scrollbar-z-index` (default `2147483000`), so a page with modals can put it under them.
* `suspended` fades the bars out and makes them ignore input, for a lightbox over the page. Remove it and they show again.

## Concepts

### The default look

Without a kit the parts draw Windows 8 (Modern UI), with the numbers of the Windows 8.1 XAML ScrollBar, ScrollViewer and ToolTip templates: a 17px bar that fades in over 250ms and out over 167ms, a square thumb, 33px buttons with a chevron, a pale track, flat ticks for markers, a square card without a shadow, and a thumb-only panning indicator for touch. These numbers are the initial values of the host tokens and the rules of the default theme. They are the numbers of a 17px bar: the thumb and the hovered marker fill the bar, and the buttons, the arrows and the markers are those numbers scaled by `--ax-scrollbar-thickness` / 17px, so a thicker or thinner bar is the same drawing, larger or smaller.

### Styling is per part

Every piece of the bars is a shadow part, styled with `::part()`. The names follow the WebKit scrollbar pseudo-elements.

```css
ax-scroll-view::part(scrollbar-vertical) {
  background: #f0f0f0;
}

ax-scroll-view::part(thumb) {
  --ax-radius: 2px;
  --ax-corner-shape: bevel;
  --ax-scrollbar-part-color: rgba(0, 0, 0, 0.35);
}
ax-scroll-view::part(thumb-hover) {
  --ax-scrollbar-part-color: rgba(0, 0, 0, 0.6);
}
ax-scroll-view::part(thumb-pressed) {
  --ax-scrollbar-part-color: rgba(0, 0, 0, 0.75);
}
```

**The cascade rule.** A rule of the page on `::part(x)` wins over the part's own shadow CSS whatever its specificity, and it replaces the default part's value of every property it sets, in every state of `x`: the default theme's state rules for that property stop applying. Restate the states that should differ, after the rule, in the order rest, current, on thumb, hover, pressed. What a rule does not set stays the default's. Among `::part()` rules the later one wins.

What a rule sets are the look inputs (below), the shape properties of Surface (`--ax-radius`, `--ax-corner-shape`, `--ax-border-width` and the others), `--elevation-depth` and `--elevation-color`, and for a card real CSS (`color`, `font`, `padding`, `max-width`). The component resets the shape properties on every part, so a rule on the bar does not leak into them; set them on the part.

The component writes inline styles for geometry (length and position of the thumb, the clip of the track pieces, marker positions, `display` of hidden parts, the corner size, the position of a card) and private `--ax-scrollbar-shown-*` properties for the values a part is drawn with. Do not set those. Parts, bars and cards have `pointer-events: none` with `!important`.

### Input by geometry

The bars take no pointer events. The component watches the pointer over the scroller and finds the bar, its parts and its hot zone (`--ax-scrollbar-hotzone`) by geometry, so content under a hidden bar keeps its hover and clicks.

* Drag the thumb. Press the track to page toward the pointer (repeating while held), or with `track-click="jump"` scroll to the pointer. Buttons step by `--ax-scrollbar-line` and repeat while held.
* Scrolls the bars start (buttons, track, markers) glide and quick steps add up; a wheel, touch, key or script scroll stops the glide. Dragging is never smoothed.
* The drawn thumb, track pieces and markers follow the scroll position with a short lag (`--ax-scrollbar-thumb-smoothing`).
* The bars appear on pointer movement or scroll and fade out after `--ax-scrollbar-idle-delay`.

### Markers

A marker is a tick on the track for a place in the content, such as a heading or a search hit. Make them with `marker-selector`:

```html
<ax-scroll-view marker-selector="h2" style="height: 420px">...</ax-scroll-view>
```

Each match becomes a marker: its id is the element's `id` (or `ax-marker-N`), its label its text. Matches are read again when the content adds or removes nodes; after another kind of change call `refreshMarkers()`. `marker-axis="horizontal"` puts them on the horizontal bar.

Or set the `markers` property, which wins over the selector while it holds a list (even an empty one); `null` gives control back to the selector. It takes elements, a `NodeList`, marker objects, or a mix. A marker object with an `element` needs no `id` or `label`: they come from the element, as for a bare element.

```javascript
view.markers = [
  { id: 'intro', label: 'Introduction', position: 0 },
  { id: 'setup', label: 'Setup', element: document.getElementById('setup') },
  { id: 'row-3', label: 'Result 3', axis: 'horizontal', position: 1200, data: { hits: 4 } },
  document.getElementById('summary'),
];
```

Markers closer than `--ax-scrollbar-marker-spacing` share one mark, whose card lists them all. Pressing a marker scrolls it to the middle of the view (`marker-align="start"`: its start edge to the start of the view). Call `preventDefault()` on `markeractivate` to do the jump yourself.

### The card

A card opens on a mark and shows the labels of its markers, one per line, shrunk to the longest one (`--ax-scrollbar-fit-width` on `part="card-content"`, overridable with `::part(card-content)`). It is a surface drawn with the `scrollbar-fill` and `elevation` layers, placed in the top layer where the Popover API exists, else `position: fixed`. Style it on `::part(card)`:

```css
ax-scroll-view::part(card) {
  --ax-scrollbar-part-color: #fff;
  --ax-scrollbar-part-border-color: #ccc;
  --ax-border-width: 1px;
  --elevation-depth: 8;
  color: #222;
  font: 12px/1.4 system-ui;
  padding: 6px 10px;
}
```

For other content, extend `AxScrollbarCard` in a kit and override `render(markers, content)`.

### Hiding parts

`hide` is a plain space-separated list of the parts a look never shows: `thumb`, `button`, `track` (with its pieces), `track-piece`, `corner`, `marker`, `card`. A hidden part takes no room and no input: hidden markers are not measured and hidden cards do not open. Unknown names are ignored.

A part is made the first time the layout needs it, and kept after that. A part that is never shown is never made: an axis that never scrolls makes none of its bar's parts (nor, without the other axis, the corner), a kind in `hide` makes none, a scroll view without markers makes no marker and one whose markers are never hovered makes no card. A bar that shows for the first time (the content grew, `hide` changed) makes its parts in that frame and draws them in the next, and a part that goes away stays (not displayed). A kit's classes are used the same way: `createElement` runs for the class when the part is first needed, so a kit's part exists only while a bar shows it.

```html
<ax-scroll-view hide="button">...</ax-scroll-view>
<ax-scroll-view hide="button track corner">...</ax-scroll-view>
```

The default is an empty list, so the default look shows its buttons and track with a mouse; a kit gives its own default (`hide` of the kit). The attribute, even empty, overrides it. What touch hides is not a matter of `hide`, see [Touch](#touch).

### Layers by configuration

The parts are surfaces, and `{part}-layers` names the layers each kind draws with, in paint order (as the `layers` attribute of Surface). A kind without the attribute keeps its default: `scrollbar-fill` for every part, `scrollbar-fill scrollbar-glyph` for a button, `scrollbar-fill elevation` for a card. Naming layers replaces the list, so name `scrollbar-fill` to keep the fill. A name that is not registered is ignored until it is.

```html
<ax-scroll-view track-layers="scrollbar-fill acrylic" thumb-layers="scrollbar-fill reveal">...</ax-scroll-view>
```

### Kits

A kit replaces parts with classes of your own, by dependency injection. Each kind has a **contract class** that draws nothing (`AxScrollbarThumb` and so on) and a **default class** that extends it with the Windows 8 look (`AxScrollbarDefaultThumb` and so on). A kit class extends either, and carries its look in its own shadow root (`static styles`), so nothing of the default look has to be switched off. The bars keep what they decide: where a part sits along the bar and how long it is.

```javascript
import { AxScrollbarThumb, defineScrollbarKit } from '@ax-design/scrollbar';

class SlabThumb extends AxScrollbarThumb {
  static styles = `
    :host { background: #888; margin: 0 3px; }
    :host([pressed]) { background: rgb(0, 120, 215); }
  `;
}

defineScrollbarKit('slab', { thumb: SlabThumb, hide: '' });
```

```html
<ax-scroll-view kit="slab" style="height: 420px">...</ax-scroll-view>
```

`defineScrollbarKit(name, kit)` takes a class for any of `thumb`, `button`, `track`, `trackPiece`, `corner`, `marker`, `card`, and `hide`. A class that does not extend the contract class of its kind throws a `TypeError`; defining a name twice throws. Kinds a kit leaves out are the default classes. Each class is defined as `<ax-scrollbar-NAME-KIND>` unless it is a custom element already. A kit may be defined after the element, which rebuilds when it is; changing `kit` rebuilds the bars. An author's `::part()` rules still win over a kit's own CSS.

What a part class can use:

* `static styles`: CSS in the part's shadow root, reading state as `:host([hover])`, `:host([pressed])`, `:host([axis="vertical"])`, `:host([direction="start"])`, `:host([disabled])`, `:host([rtl])`.
* `partState`: read-only `axis`, `direction`, `hover`, `pressed`, `disabled`, `indicator`, `engaged`, `rtl`, and on markers `onThumb` and `current`. `stateChanged(prev, next)` runs after each change.
* `defaultLayers_()` and `layerNames_()` for layers.
* `look(state, values)` and `static extraSchema` for a look that animates toward the inputs of its state.
* `render(markers, content)` on the card.

### Windows XP kit

`@ax-design/scrollbar/kits/luna` is the Windows XP (Luna) scrollbar as a kit: raised thumb and arrow buttons with the grip lines, an etched track, XP info tips, no fades. It needs the elements registered, the kit defined and a colour scheme.

```ts
import { register } from '@ax-design/scrollbar';
import { adoptLunaSchemes, defineLunaKit } from '@ax-design/scrollbar/kits/luna';

register();
defineLunaKit(); // defines the kit "luna"
adoptLunaSchemes(); // adds the scheme classes to the document
```

```html
<div class="luna-blue">
  <ax-scroll-view kit="luna" snap style="height: 420px">...</ax-scroll-view>
</div>
```

Use `snap` with the kit: it puts the thumb's edges on whole device pixels, and the kit then draws the four grip lines of the thumb as whole device pixels too, so that they stay four distinct lines at any zoom and any display scale (at 110%, 125% and 150% included).

The schemes are the classes `luna-blue`, `luna-olive`, `luna-silver`, `luna-purple`, `luna-orange`, `luna-pink` and `luna-gold`, set on the scroll view or any ancestor (custom properties inherit into the parts). They are the string `lunaSchemes`, which `adoptLunaSchemes(root = document)` adopts once into a document or a shadow root; to link a file instead, write the string out and link it. Blue, Olive Green and Silver are the schemes of Windows XP.

A scheme is a class of custom properties, so a custom scheme is a class that sets them, nothing else. The tones are colours: `--luna-accent`, `-accent-light`, `-accent-deep` (thumb, buttons), `--luna-glyph` (arrows, grip), `--luna-face` (track, corner) and `--luna-disabled`. The numbers are contrast, 0 to 1: `--luna-highlight`, `--luna-shade`, `--luna-gloss`, `--luna-depth`, `--luna-hot`, `--luna-press`, `--luna-etch` (and `--luna-relief`, which only the XP window of the demo reads). `--luna-light` (`top-left` or `top`) says where the light comes from, and `--luna-diagonal` and `--luna-glint` (0 or 1) switch two details of the arrow buttons. Every colour of the parts is a tone with white and black laid over it by those numbers, so a new scheme needs its tones and the numbers of the scheme it resembles; copy a class of `lunaSchemes` and change them. The sheet's header lists every property and the roles it reaches.

One colour recolours a scheme. `--luna-accent-light` is the colour of the thumb and the buttons at rest, and `--luna-accent`, `--luna-accent-deep` and `--luna-glyph` may be `auto`, which is what they are when a scheme does not set them. The parts then derive them from `--luna-accent-light` in OKLCH, when the values of the scheme change: the hue of the colour is kept, the accent (rings, hot faces) and the deep tone (rings and edges when hot, the dark grip lines, shadows) are darker and more chromatic, and the arrows and the grip are a dark tone of the colour's hue on a light colour and white on a dark one. The relations are fitted to the shipped schemes (Blue, Purple, Orange and Pink for the Luna style, Silver and Gold for the metallic one) and are written down in `src/kits/luna/tones.ts`. A scheme that sets a tone keeps its own value.

```css
.luna-moss {
  --luna-light: top-left; --luna-diagonal: 1; --luna-glint: 0;
  --luna-face: #e4e6d4; --luna-disabled: #f0f0e6;
  --luna-highlight: 1; --luna-shade: 0.72; --luna-gloss: 0.182; --luna-depth: 0.196; --luna-hot: 0.624; --luna-press: 0.675; --luna-etch: 0; --luna-relief: 1;
  --luna-accent-light: #d3e6bf; /* the rest follows from this one */
}
```

A scheme is metallic when it sets `--luna-light: top` and takes the numbers of Silver: a dark etched ring, a strong gloss and depth, and the light from straight above. The numbers that matter most are `--luna-gloss` and `--luna-depth` (the sheen of the faces) and `--luna-etch` (the ring). Its colour is again `--luna-accent-light`.

```css
.luna-steel {
  --luna-light: top; --luna-diagonal: 0; --luna-glint: 0;
  --luna-face: #e0dfe3; --luna-text: #0e1010; --luna-disabled: #f0f0e6;
  --luna-highlight: 0.731; --luna-shade: 0.913; --luna-gloss: 1; --luna-depth: 1; --luna-hot: 1; --luna-press: 0; --luna-etch: 1; --luna-relief: 0.686;
  --luna-accent-light: #d5dde8;
}
```

The kit is also the worked example of writing a kit. Each of its parts extends the contract class of its kind (`AxScrollbarThumb`, `AxScrollbarButton`, ...) and brings the rules of its kind as its own shadow CSS (`static styles`, written on `:host` and its `::before` and `::after`); nothing is drawn from outside and none of the default look has to be switched off. Behaviour is the only code: the raised parts reflect `--luna-light` as the attribute `light`, because a selector can switch geometry on an attribute and not on the value of a property, and derive the tones left `auto`; the thumb also lays its grip out in device pixels. The XP window around the scroll view in the demo is page CSS and not part of the kit.

### Touch

`touch` picks what the bars are on touch:

* `indicator` (the default, the Windows 8 behaviour): the bars show only the thumb, as a panning indicator that takes no input. The buttons, the track and the corner are left out while it shows and while it fades out, the mouse brings them back, and the page scrolls under a finger as usual.
* `bar`: on touch the bars look and work as with a mouse. A finger that comes down on a bar or in its hot zone belongs to the bar and decides after 5px: steeply along the bar it drags (relative to where it is), across it nothing more happens. A quick tap glides to the tapped place or activates the marker under it.

In both modes the hovered marker and its card stay for `--ax-scrollbar-touch-idle-delay` after the finger lifts.

### Accessibility

* Native scrolling and focus stay. The viewport is a real scroll container. It takes focus (`tabindex="0"`) only while nothing inside it can, so a text-only region stays scrollable by keys, and a region with links, buttons or fields adds no Tab stop of its own: focus goes into the content and the arrow and page keys scroll from there. It is checked again when the content or the attributes that decide focus change. Focusing the element focuses the viewport while it takes focus (`delegatesFocus`). The element has no role or label of its own; add them as for any element: `<ax-scroll-view role="region" aria-label="...">`.
* The bars and cards are `aria-hidden="true"`, with no role and not in the tab order. Markers are for the pointer: give links or buttons for the same destinations. The accessibility tree shows only the content.
* Forced colours (`forced-colors: active`): the overlay is hidden and the native scrollbars come back. Printing does the same.
* Reduced motion (`prefers-reduced-motion: reduce`): no glide, no thumb lag, and parts change look at once. The default card drops its movement and closes by itself after `--ax-scrollbar-touch-idle-delay`.

### Browser support

Browsers with `::part()`: Chrome 73+, Firefox 72+, Safari 13.1+, and `ResizeObserver`, `MutationObserver` and Pointer Events. The Popover API, `delegatesFocus` and `@property` are enhancements: without the first the cards are fixed elements; without `delegatesFocus` Tab still reaches the viewport but a click on the element does not focus it.

## Reference

### Host attributes

On `<ax-scroll-view>` and `<ax-scrollbar>`. A change is picked up at once; a change to `kit` rebuilds the bars.

| Attribute | Values / default | Meaning |
|-----------|------------------|---------|
| `vertical`, `horizontal` | `auto` (default), `always`, `hidden` | `auto`: shown while there is something to scroll. `always`: always shown, `disabled` when nothing scrolls. `hidden`: never shown. |
| `hide` | list of parts | The parts never shown. See [Hiding parts](#hiding-parts). |
| `touch` | `indicator` (default), `bar` | What the bars are on touch. See [Touch](#touch). |
| `track-click` | `page` (default), `jump` | A press on the track pages, or scrolls to the pointer. |
| `snap` | boolean | Thumb edges and markers on whole device pixels, for themes that reproduce a desktop control. While it is set the thumb carries `--ax-scrollbar-thumb-nudge`, the distance in CSS px that something drawn inside the thumb adds to its place along the bar to land on whole device pixels, as the grip lines of the Luna kit do. |
| `kit` | kit name | Build the parts with that kit. |
| `marker-selector` | CSS selector | Makes markers of the matching elements. |
| `marker-axis` | `vertical` (default), `horizontal` | Axis of the markers made of elements. |
| `marker-align` | `center` (default), `start` | Where a marker scrolls to and sits on the track. |
| `suspended` | boolean | Fade the bars out and ignore input. |
| `indicator` | `auto` (default), `near`, `pinned` | `auto`: the bars show for every move over the scroller. `near`: only for a pointer at a bar or a scroll (always so on `<ax-scrollbar>`). `pinned`: the bars always show. |
| `thumb-layers`, `button-layers`, `track-layers`, `track-piece-layers`, `corner-layers`, `marker-layers`, `card-layers` | layer names | See [Layers by configuration](#layers-by-configuration). |

Written by the component, for you to select on (`ax-scroll-view[indicator-state="touch"]::part(thumb)`, with `~=` for lists):

| Attribute | Values |
|-----------|--------|
| `indicator-state` | `none`, `mouse`, `touch` |
| `last-indicator` | `mouse`, `touch`: the indicator shown, or shown last while the bars fade out. Style per indicator with this rather than `indicator-state`, so the look stays during the fade. |
| `vertical-state`, `horizontal-state` | a list of `visible`, `disabled`, `hover`, `near`, `engaged`, `pressed` |

### Host tokens

Custom properties set on the element or any ancestor (they inherit). The tokens are read on each layout pass and on `refresh()`; a change of one, from a style attribute, a rule or an animation, applies on the next frame without a call. Times are time constants unless noted: after one the motion has covered about 63% of the distance; `0s` is immediate.

| Token | Default | Meaning |
|-------|---------|---------|
| `--ax-scrollbar-thickness` | `17px` | Thickness of a bar. The default look is sized from it: thumb and hovered marker fill the bar, the rest scales with `thickness / 17px`. |
| `--ax-scrollbar-padding` | `0px` | Space between the bar's edges and its buttons and track. |
| `--ax-scrollbar-thumb-min-length` | `48px` | Shortest thumb (`17px` while the touch indicator shows). |
| `--ax-scrollbar-button-length` | `33/17` of the thickness (`33px`) | Button length along the axis; `auto` is a square. Not registered: unset, it is the proportion. |
| `--ax-scrollbar-hotzone` | `0px` | Depth of the hot zone from the bar's outer edge inward; percentages are of the thickness. Gives the bar the `near` state. |
| `--ax-scrollbar-line` | `40px` | Scroll of a button press. A track page is the view minus one line. |
| `--ax-scrollbar-idle-delay` | `3s` | How long the mouse indicator lingers. |
| `--ax-scrollbar-touch-idle-delay` | `500ms` | How long the touch indicator, its hovered marker and card linger. |
| `--ax-scrollbar-z-index` | `2147483000` | Stacking of `<ax-scrollbar>` (not registered, read with `var()`). |

Rarely changed:

| Token | Default | Meaning |
|-------|---------|---------|
| `--ax-scrollbar-scroll-smoothing` | `50ms` | Glide of the scrolls the bars start. |
| `--ax-scrollbar-thumb-smoothing` | `100ms` | Lag of the drawn thumb, track pieces and markers behind the scroll. |
| `--ax-scrollbar-repeat-delay`, `--ax-scrollbar-repeat-interval` | `250ms`, `50ms` | Wait before, and time between, the repeats of a held press. |
| `--ax-scrollbar-expand-delay`, `--ax-scrollbar-contract-delay` | `0s`, `0s` | How long the bar must be engaged before parts take `engaged`, and idle before they leave it. |
| `--ax-scrollbar-state-smoothing` | `0s` | Colour and size change on hover, press and engaged. |
| `--ax-scrollbar-fade-smoothing` | `75ms` | Fade of the parts when the bars show or hide. |
| `--ax-scrollbar-fade-in-duration`, `--ax-scrollbar-fade-out-duration` | `250ms`, `167ms` | Linear fade (a card fades with it). `0s` leaves it to the fade smoothing. |
| `--ax-scrollbar-slide-smoothing` | `160ms` | Slide of parts in from the outer edge. |
| `--ax-scrollbar-slide-distance` | `0px` | How far a hidden part sits toward the outer edge; negative slides from the content side. |
| `--ax-scrollbar-marker-spacing` | `6px` | Markers closer than this share one mark. |
| `--ax-scrollbar-marker-reach` | `12px` | How far from a marker's centre the pointer still hits it. |
| `--ax-scrollbar-card-gap` | `12px` | Distance between a card and the bar. |
| `--ax-scrollbar-card-delay` | `400ms` | Wait on a marker before the first card opens. |
| `--ax-scrollbar-card-slide-duration` | `367ms` | Slide of an opening card. |
| `--ax-scrollbar-card-slide-distance` | `12px` | How far a card slides in; `0px` for none. |

Written by the component on the host, read-only: `--ax-scrollbar-vertical-size` and `--ax-scrollbar-horizontal-size`.

### Parts

| Part | Element | Notes |
|------|---------|-------|
| `scrollbar`, `scrollbar-vertical`, `scrollbar-horizontal` | `div` | One bar; its thickness is its width or height. |
| `button`, `button-start`, `button-end` | `<ax-scrollbar-button>` | A step button with a chevron. |
| `track` | `<ax-scrollbar-track>` | The whole track. |
| `track-piece`, `track-piece-start`, `track-piece-end` | `<ax-scrollbar-track-piece>` | The track either side of the thumb. |
| `thumb` | `<ax-scrollbar-thumb>` | The part you drag. |
| `corner` | `<ax-scrollbar-corner>` | Where the two bars meet. |
| `marker` | `<ax-scrollbar-marker>` | A marker on the track. |
| `card`, `card-content` | `<ax-scrollbar-card>`, `div` | The hover card of a marker. |
| `viewport`, `content` | `div` | `<ax-scroll-view>` only. |

A part element carries `part="<kind> <kind>-<axis> <kind>-<state>..."` (the corner has no axis). `::part(thumb)` matches both axes; `::part(thumb-vertical)` one; a list matches a part with all the names: `::part(marker-on-thumb marker-hover)`.

State tokens, the same for every kind, also set as attributes on the part element (`hover`, `pressed`, `engaged`, `disabled`, `rtl`, `on-thumb`, `current`, plus `axis` and `direction`):

| Token | On when |
|-------|---------|
| `<kind>-hover` | The pointer is over the part (a pressed marker counts). |
| `<kind>-pressed` | The thumb is dragged, a button or page repeat held, a marker pressed. |
| `<kind>-engaged` | The thumb or a marker is hovered, the thumb is dragged, or the pointer is in the hot zone, after the expand delay. |
| `<kind>-disabled` | The axis has nothing to scroll. |
| `marker-current` | The last marker the scroll has reached. |
| `marker-on-thumb` | The marker is under the thumb. |
| `card-enter`, `card-open`, `card-exit` | Card lifecycle: starting, shown, closing (kept until its exit transition ends). |
| `card-forward`, `card-backward` | The card moves toward the end or the start of the scroll. |
| `card-first`, `card-swap` | The card opens with none open, or replaces the open one. |

### Part inputs

Set on the part (`::part()`), registered and typed, not inherited. The part's animator moves the drawn values toward the inputs of its current state.

| Property | Type | Default | Meaning |
|----------|------|---------|---------|
| `--ax-scrollbar-part-color` | `<color>` | transparent | Fill colour. |
| `--ax-scrollbar-part-border-color` | `<color>` | transparent | Border colour. |
| `--ax-scrollbar-part-glyph-color` | `<color>` | transparent | Colour of a button's arrow. |
| `--ax-scrollbar-part-size` | `<length>` | `0px` | Size across the bar: the thumb's thickness, a marker's width. |
| `--ax-scrollbar-part-thickness` | `<length>` or `auto` | `auto` | A marker's size along the bar; `auto` is a dot. |
| `--ax-scrollbar-part-opacity` | `<number>` | `1` | Opacity while the bars are shown. |
| `--ax-scrollbar-part-glyph-scale` | `<number>` | `1` | Scale of a button's arrow. |
| `--ax-scrollbar-part-lines` | `<number>` | `2` | Lines a card label may take. |
| `--ax-scrollbar-part-align` | `<number>` | `0.5` | Where the thumb sits across the bar: `0` inner edge, `1` outer edge. Not animated. |
| `--ax-scrollbar-part-fill-clip` | `border-box` or `padding-box` | `border-box` | Whether the fill stops at the inner edge of the border. |

A button's arrow is set on `::part(button)` with `--ax-scrollbar-glyph-width`, `-height`, `-thickness`, `-offset`, `-shape` (`chevron` or `triangle`) and `-corner-radius`.

### Events

On the element; they bubble and cross shadow boundaries. `detail` is `{ marker, markers }`: the marker of the mark and all markers sharing it. `scroll` and `scrollend` are re-dispatched on `<ax-scroll-view>`.

| Event | When |
|-------|------|
| `markerenter` | The pointer moves onto a marker. |
| `markerleave` | The pointer leaves the last marker it was on (moving straight to another fires `markerenter` only). |
| `markeractivate` | A press on a marker is released with under 4px of movement. Cancelable. |

### JS API

| Member | On | Meaning |
|--------|----|---------|
| `markers` | both | The list set, as markers, or `null` while the selector is in charge. Set an iterable of markers and elements, or `null`. |
| `refresh()` | both | Layout pass on the next frame; call it after changing tokens from script. |
| `refreshMarkers()` | both | Collect and measure the markers again on the next frame. |
| `viewport`, `scrollTop`, `scrollLeft`, `scrollHeight`, `scrollWidth`, `scrollTo()`, `scrollBy()`, `scroll()` | `<ax-scroll-view>` | The scroll API of the viewport. |

A marker object has `id`, `label`, `axis` (`vertical` by default), `position` (px in scroll coordinates, ignored with `element`), `element` (its start edge is the position, measured on every layout) and `data` (for a kit's card).

### Kits and exports

| Export | Meaning |
|--------|---------|
| `register()` | Define the elements, layers and default parts. |
| `AxScrollView`, `AxScrollbar` | The two elements. |
| `defineScrollbarKit(name, kit)`, `hasScrollbarKit(name)`, type `ScrollbarKit` | Define and look up kits. |
| `AxScrollbarPart` | Base of all parts; extends `AxSurface`. |
| `AxScrollbarThumb`, `AxScrollbarButton`, `AxScrollbarTrack`, `AxScrollbarTrackPiece`, `AxScrollbarCorner`, `AxScrollbarMarker`, `AxScrollbarCard` | Contract classes: draw nothing. |
| `AxScrollbarDefaultThumb`, `AxScrollbarDefaultButton`, `AxScrollbarDefaultTrack`, `AxScrollbarDefaultTrackPiece`, `AxScrollbarDefaultCorner`, `AxScrollbarDefaultMarker`, `AxScrollbarDefaultCard` | Default classes: the Windows 8 look. |
| `isPartClass(cls, kind)` | Whether a class is a part class of that kind. |
| `@ax-design/scrollbar/kits/luna`: `defineLunaKit()`, `lunaSchemes`, `adoptLunaSchemes(root?)` | The Windows XP kit and its colour schemes. See [Windows XP kit](#windows-xp-kit). |
| types `PartClass`, `PartKind`, `PartState`, `Look`, `ScrollMarker`, `Axis`, `Placement` | `PartKind` is `'thumb' \| 'button' \| 'track' \| 'track-piece' \| 'corner' \| 'marker' \| 'card'`. |

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
bun install
bun run build         # es/, build/index.mjs, build/main.js
bun run check         # type check
bun test              # unit tests
bun run test:browser  # browser tests
bun run demo          # demo page: Windows 8, Minimal, Windows 11, Windows XP kit, Cyber Punk
```
