// Plain CSS, as a string so that the published package needs no bundler plugin for it.
export default `/* Windows XP (Luna) kit, the thumb: its geometry per axis, the colours of its states and the highlight
   and grip, on top of the raised box (luna-raised.css) and the shades (luna-shades.css). */

/* Vertical thumb: the ring leaves the track's edge line free on the left; the side shadow is on
   the right (shorter than the ring and soft at its ends), the end shadow below. The shading runs
   across the bar, the highlight along the top. */
:host([axis="vertical"]) {
    --k-ring-inset: 0 var(--k-out) var(--k-out) 1px;
    --k-ring-radius: var(--k-radius);
    --k-face-inset: 1px calc(1px + var(--k-out)) calc(1px + var(--k-out)) 2px;
    --k-fill-dir: to right;
    --k-light-dir: to right;
    --k-light-box: 0 0 / 100% 2px;
    --k-face-radius: 1.5px;
    --k-end-at: 0 1px 0 0;
    --k-side-at: 3px 1px 1px -2px;
    --k-top-1: var(--k-edge-a); --k-top-1-k: var(--k-edge-a-k); --k-top-1-b: var(--k-edge-a-b);
    --k-top-2: var(--k-edge-b); --k-top-2-k: var(--k-edge-b-k); --k-top-2-b: var(--k-edge-b-b);
    --k-top-size: 100% 1px;
    --k-left-1: var(--k-edge-a); --k-left-1-k: var(--k-edge-a-k); --k-left-1-b: var(--k-edge-a-b);
    --k-left-2: var(--k-edge-a); --k-left-2-k: var(--k-edge-a-k); --k-left-2-b: var(--k-edge-a-b);
    --k-left-size: calc(100% - 2px);
}
/* Horizontal thumb: the same box turned a quarter. */
:host([axis="horizontal"]) {
    --k-ring-inset: 1px var(--k-out) var(--k-out) 0;
    --k-ring-radius: var(--k-radius-turned);
    --k-face-inset: 2px calc(1px + var(--k-out)) calc(1px + var(--k-out)) 1px;
    --k-fill-dir: to bottom;
    --k-light-dir: to bottom;
    --k-light-box: 0 0 / 2px 100%;
    --k-face-radius: 1.5px;
    --k-end-at: 1px 0 0 0;
    --k-side-at: 1px 3px 1px -2px;
    --k-top-1: var(--k-edge-a); --k-top-1-k: var(--k-edge-a-k); --k-top-1-b: var(--k-edge-a-b);
    --k-top-2: var(--k-edge-a); --k-top-2-k: var(--k-edge-a-k); --k-top-2-b: var(--k-edge-a-b);
    --k-top-size: 100% 1px;
    --k-left-1: var(--k-edge-a); --k-left-1-k: var(--k-edge-a-k); --k-left-1-b: var(--k-edge-a-b);
    --k-left-2: var(--k-edge-b); --k-left-2-k: var(--k-edge-b-k); --k-left-2-b: var(--k-edge-b-b);
    --k-left-size: calc(100% - 2px);
}
/* Colour roles of a state: the ring (over its base), the ring's fill seen at the face's corners, the face's
   edges, fill and (thumb) highlight, the shadows, the grip or the glyph. --k-<role> is the white over
   the base, --k-<role>-k the black over it, --k-<role>-b the base. */
:host {
    --k-ring: var(--luna-thumb-ring);
    --k-ring-k: var(--luna-thumb-ring-k);
    --k-ring-b: var(--luna-thumb-ring-base);
    --k-ring-top: var(--luna-thumb-ring-top);
    --k-ring-top-k: var(--luna-thumb-ring-top-k);
    --k-ring-bottom: var(--luna-thumb-ring-bottom);
    --k-ring-bottom-k: var(--luna-thumb-ring-bottom-k);
    --k-ringfill: var(--luna-thumb-ring-fill);
    --k-ringfill-k: var(--luna-thumb-ring-fill-k);
    --k-ringfill-b: var(--luna-thumb-ring-fill-base);
    --k-edge-a: var(--luna-thumb-edge-a);
    --k-edge-a-k: var(--luna-thumb-edge-a-k);
    --k-edge-a-b: var(--luna-thumb-edge-a-base);
    --k-edge-b: var(--luna-thumb-edge-b);
    --k-edge-b-k: var(--luna-thumb-edge-b-k);
    --k-edge-b-b: var(--luna-thumb-edge-b-base);
    --k-edge-right: var(--luna-thumb-edge-right);
    --k-edge-right-k: var(--luna-thumb-edge-right-k);
    --k-edge-right-b: var(--luna-thumb-edge-right-base);
    --k-edge-bottom: var(--luna-thumb-edge-bottom);
    --k-edge-bottom-k: var(--luna-thumb-edge-bottom-k);
    --k-edge-bottom-b: var(--luna-thumb-edge-bottom-base);
    --k-fill-a: var(--luna-thumb-fill-a);
    --k-fill-a-k: var(--luna-thumb-fill-a-k);
    --k-fill-a-b: var(--luna-thumb-fill-a-base);
    --k-fill-b: var(--luna-thumb-fill-b);
    --k-fill-b-k: var(--luna-thumb-fill-b-k);
    --k-fill-b-b: var(--luna-thumb-fill-b-base);
    --k-fill-c: var(--luna-thumb-fill-c);
    --k-fill-c-k: var(--luna-thumb-fill-c-k);
    --k-fill-c-b: var(--luna-thumb-fill-c-base);
    --k-light: var(--luna-thumb-light);
    --k-light-k: var(--luna-thumb-light-k);
    --k-light-b: var(--luna-thumb-light-base);
    --k-side: var(--luna-thumb-side);
    --k-side-k: var(--luna-thumb-side-k);
    --k-side-b: var(--luna-thumb-side-base);
    --k-end: var(--luna-thumb-end);
    --k-end-k: var(--luna-thumb-end-k);
    --k-end-b: var(--luna-thumb-end-base);
    --k-mark-a: var(--luna-grip-a);
    --k-mark-a-k: var(--luna-grip-a-k);
    --k-mark-a-b: var(--luna-grip-a-base);
    --k-mark-b: var(--luna-grip-b);
    --k-mark-b-k: var(--luna-grip-b-k);
    --k-mark-b-b: var(--luna-grip-b-base);
}
:host([hover]) {
    --k-ring: var(--luna-thumb-hot-ring);
    --k-ring-k: var(--luna-thumb-hot-ring-k);
    --k-ring-b: var(--luna-thumb-hot-ring-base);
    --k-ring-top: var(--luna-thumb-hot-ring-top);
    --k-ring-top-k: var(--luna-thumb-hot-ring-top-k);
    --k-ring-bottom: var(--luna-thumb-hot-ring-bottom);
    --k-ring-bottom-k: var(--luna-thumb-hot-ring-bottom-k);
    --k-ringfill: var(--luna-thumb-hot-ring-fill);
    --k-ringfill-k: var(--luna-thumb-hot-ring-fill-k);
    --k-ringfill-b: var(--luna-thumb-hot-ring-fill-base);
    --k-edge-a: var(--luna-thumb-hot-edge-a);
    --k-edge-a-k: var(--luna-thumb-hot-edge-a-k);
    --k-edge-a-b: var(--luna-thumb-hot-edge-a-base);
    --k-edge-b: var(--luna-thumb-hot-edge-b);
    --k-edge-b-k: var(--luna-thumb-hot-edge-b-k);
    --k-edge-b-b: var(--luna-thumb-hot-edge-b-base);
    --k-edge-right: var(--luna-thumb-hot-edge-right);
    --k-edge-right-k: var(--luna-thumb-hot-edge-right-k);
    --k-edge-right-b: var(--luna-thumb-hot-edge-right-base);
    --k-edge-bottom: var(--luna-thumb-hot-edge-bottom);
    --k-edge-bottom-k: var(--luna-thumb-hot-edge-bottom-k);
    --k-edge-bottom-b: var(--luna-thumb-hot-edge-bottom-base);
    --k-fill-a: var(--luna-thumb-hot-fill-a);
    --k-fill-a-k: var(--luna-thumb-hot-fill-a-k);
    --k-fill-a-b: var(--luna-thumb-hot-fill-a-base);
    --k-fill-b: var(--luna-thumb-hot-fill-b);
    --k-fill-b-k: var(--luna-thumb-hot-fill-b-k);
    --k-fill-b-b: var(--luna-thumb-hot-fill-b-base);
    --k-fill-c: var(--luna-thumb-hot-fill-c);
    --k-fill-c-k: var(--luna-thumb-hot-fill-c-k);
    --k-fill-c-b: var(--luna-thumb-hot-fill-c-base);
    --k-light: var(--luna-thumb-hot-light);
    --k-light-k: var(--luna-thumb-hot-light-k);
    --k-light-b: var(--luna-thumb-hot-light-base);
    --k-side: var(--luna-thumb-hot-side);
    --k-side-k: var(--luna-thumb-hot-side-k);
    --k-side-b: var(--luna-thumb-hot-side-base);
    --k-end: var(--luna-thumb-hot-end);
    --k-end-k: var(--luna-thumb-hot-end-k);
    --k-end-b: var(--luna-thumb-hot-end-base);
    --k-mark-a: var(--luna-grip-hot-a);
    --k-mark-a-k: var(--luna-grip-hot-a-k);
    --k-mark-a-b: var(--luna-grip-hot-a-base);
    --k-mark-b: var(--luna-grip-hot-b);
    --k-mark-b-k: var(--luna-grip-hot-b-k);
    --k-mark-b-b: var(--luna-grip-hot-b-base);
}
:host([pressed]) {
    --k-ring: var(--luna-thumb-pressed-ring);
    --k-ring-k: var(--luna-thumb-pressed-ring-k);
    --k-ring-b: var(--luna-thumb-pressed-ring-base);
    --k-ring-top: var(--luna-thumb-pressed-ring-top);
    --k-ring-top-k: var(--luna-thumb-pressed-ring-top-k);
    --k-ring-bottom: var(--luna-thumb-pressed-ring-bottom);
    --k-ring-bottom-k: var(--luna-thumb-pressed-ring-bottom-k);
    --k-ringfill: var(--luna-thumb-pressed-ring-fill);
    --k-ringfill-k: var(--luna-thumb-pressed-ring-fill-k);
    --k-ringfill-b: var(--luna-thumb-pressed-ring-fill-base);
    --k-edge-a: var(--luna-thumb-pressed-edge-a);
    --k-edge-a-k: var(--luna-thumb-pressed-edge-a-k);
    --k-edge-a-b: var(--luna-thumb-pressed-edge-a-base);
    --k-edge-b: var(--luna-thumb-pressed-edge-b);
    --k-edge-b-k: var(--luna-thumb-pressed-edge-b-k);
    --k-edge-b-b: var(--luna-thumb-pressed-edge-b-base);
    --k-edge-right: var(--luna-thumb-pressed-edge-right);
    --k-edge-right-k: var(--luna-thumb-pressed-edge-right-k);
    --k-edge-right-b: var(--luna-thumb-pressed-edge-right-base);
    --k-edge-bottom: var(--luna-thumb-pressed-edge-bottom);
    --k-edge-bottom-k: var(--luna-thumb-pressed-edge-bottom-k);
    --k-edge-bottom-b: var(--luna-thumb-pressed-edge-bottom-base);
    --k-fill-a: var(--luna-thumb-pressed-fill-a);
    --k-fill-a-k: var(--luna-thumb-pressed-fill-a-k);
    --k-fill-a-b: var(--luna-thumb-pressed-fill-a-base);
    --k-fill-b: var(--luna-thumb-pressed-fill-b);
    --k-fill-b-k: var(--luna-thumb-pressed-fill-b-k);
    --k-fill-b-b: var(--luna-thumb-pressed-fill-b-base);
    --k-fill-c: var(--luna-thumb-pressed-fill-c);
    --k-fill-c-k: var(--luna-thumb-pressed-fill-c-k);
    --k-fill-c-b: var(--luna-thumb-pressed-fill-c-base);
    --k-light: var(--luna-thumb-pressed-light);
    --k-light-k: var(--luna-thumb-pressed-light-k);
    --k-light-b: var(--luna-thumb-pressed-light-base);
    --k-side: var(--luna-thumb-pressed-side);
    --k-side-k: var(--luna-thumb-pressed-side-k);
    --k-side-b: var(--luna-thumb-pressed-side-base);
    --k-end: var(--luna-thumb-pressed-end);
    --k-end-k: var(--luna-thumb-pressed-end-k);
    --k-end-b: var(--luna-thumb-pressed-end-base);
    --k-mark-a: var(--luna-grip-pressed-a);
    --k-mark-a-k: var(--luna-grip-pressed-a-k);
    --k-mark-a-b: var(--luna-grip-pressed-a-base);
    --k-mark-b: var(--luna-grip-pressed-b);
    --k-mark-b-k: var(--luna-grip-pressed-b-k);
    --k-mark-b-b: var(--luna-grip-pressed-b-base);
}

/* ---- Thumb: highlight and grip ------------------------------------------------------------------ */

/* The highlight is a 2px band along the top (left) of the face, fading out along it. The grip is
   four etched lines, each light one over a dark one a pixel down and right: the theme draws it at
   its own size (8px), centred in the thumb with whole pixels, rounded down; across the bar it
   starts 4px in. Positions are in the face's border box (origin border-box), which starts 2px in
   across the bar and 1px in along it, and ends 1px + --k-out short of the thumb's end: hence the
   --k-out / 2 in the centring. The quarter pixel makes a half round down (the browser snaps a
   layer's position to the device pixel, which rounds it). Each of these is three layers. */
:host {
    --k-light-layers:
        linear-gradient(var(--k-light-dir), var(--k-light-k), transparent) var(--k-light-box) no-repeat border-box,
        linear-gradient(var(--k-light-dir), var(--k-light), transparent) var(--k-light-box) no-repeat border-box,
        linear-gradient(var(--k-light-dir), var(--k-light-b), transparent) var(--k-light-box) no-repeat border-box;
}
:host([axis="vertical"]) {
    --k-grips:
        repeating-linear-gradient(to bottom, var(--k-mark-a-k) 0 1px, transparent 1px 2px) 3px calc(50% + var(--k-out) / 2 - 0.25px) / 6px 8px no-repeat border-box,
        repeating-linear-gradient(to bottom, var(--k-mark-a) 0 1px, transparent 1px 2px) 3px calc(50% + var(--k-out) / 2 - 0.25px) / 6px 8px no-repeat border-box,
        repeating-linear-gradient(to bottom, var(--k-mark-a-b) 0 1px, transparent 1px 2px) 3px calc(50% + var(--k-out) / 2 - 0.25px) / 6px 8px no-repeat border-box,
        repeating-linear-gradient(to bottom, transparent 0 1px, var(--k-mark-b-k) 1px 2px) 4px calc(50% + var(--k-out) / 2 - 0.25px) / 6px 8px no-repeat border-box,
        repeating-linear-gradient(to bottom, transparent 0 1px, var(--k-mark-b) 1px 2px) 4px calc(50% + var(--k-out) / 2 - 0.25px) / 6px 8px no-repeat border-box,
        repeating-linear-gradient(to bottom, transparent 0 1px, var(--k-mark-b-b) 1px 2px) 4px calc(50% + var(--k-out) / 2 - 0.25px) / 6px 8px no-repeat border-box;
}
:host([axis="horizontal"]) {
    --k-grips:
        repeating-linear-gradient(to right, var(--k-mark-a-k) 0 1px, transparent 1px 2px) calc(50% + var(--k-out) / 2 - 0.25px) 3px / 8px 6px no-repeat border-box,
        repeating-linear-gradient(to right, var(--k-mark-a) 0 1px, transparent 1px 2px) calc(50% + var(--k-out) / 2 - 0.25px) 3px / 8px 6px no-repeat border-box,
        repeating-linear-gradient(to right, var(--k-mark-a-b) 0 1px, transparent 1px 2px) calc(50% + var(--k-out) / 2 - 0.25px) 3px / 8px 6px no-repeat border-box,
        repeating-linear-gradient(to right, transparent 0 1px, var(--k-mark-b-k) 1px 2px) calc(50% + var(--k-out) / 2 - 0.25px) 4px / 8px 6px no-repeat border-box,
        repeating-linear-gradient(to right, transparent 0 1px, var(--k-mark-b) 1px 2px) calc(50% + var(--k-out) / 2 - 0.25px) 4px / 8px 6px no-repeat border-box,
        repeating-linear-gradient(to right, transparent 0 1px, var(--k-mark-b-b) 1px 2px) calc(50% + var(--k-out) / 2 - 0.25px) 4px / 8px 6px no-repeat border-box;
}
/* Where a CSS px is not a whole number of device pixels (a zoom of 110% or 125%, a display scaled to 150%),
   or where the thumb is moved by a fraction of one, a line of 1px covers a fraction of a device pixel at each
   edge and the four lines run together. The thumb (index.ts) then sets its attribute \`grip\` and the grip is
   drawn by two boxes of its own instead of the face's layers. The light box has the lines on the even units
   and the dark box on the odd ones, a unit across from the light one, each 6 x 8 units, a unit being a
   whole number of device pixels (--k-grip-unit; grip.ts). They are elements so that each is painted into
   a rectangle the browser snaps as a whole, and they have the colours of the layers (three each: black
   over white over the base). The thumb sets the other two tokens, the light box's offset from the thumb's
   start along the bar and from its edge across it, in device pixels converted to CSS px. A snapped thumb
   is moved by a fraction of a device pixel and the browser paints a gradient inside it at that fraction:
   --ax-scrollbar-thumb-nudge (bar.ts) carries the boxes back onto whole pixels. */
.grip {
    display: none;
    position: absolute;
    z-index: 1;
    pointer-events: none;
}
:host([grip="device"]) {
    --k-grips: linear-gradient(transparent, transparent);
    --k-grip-dir: to bottom;
}
:host([grip="device"][axis="horizontal"]) { --k-grip-dir: to right; }
:host([grip="device"]) .grip { display: block; }
:host([grip="device"][axis="vertical"]) .grip {
    left: var(--k-grip-across);
    top: var(--k-grip-along);
    width: calc(var(--k-grip-unit) * 6);
    height: calc(var(--k-grip-unit) * 8);
    transform: translate(0, var(--ax-scrollbar-thumb-nudge, 0px));
}
:host([grip="device"][axis="horizontal"]) .grip {
    left: var(--k-grip-along);
    top: var(--k-grip-across);
    width: calc(var(--k-grip-unit) * 8);
    height: calc(var(--k-grip-unit) * 6);
    transform: translate(var(--ax-scrollbar-thumb-nudge, 0px), 0);
}
:host([grip="device"][axis="vertical"]) .grip-b { left: calc(var(--k-grip-across) + var(--k-grip-unit)); }
:host([grip="device"][axis="horizontal"]) .grip-b { top: calc(var(--k-grip-across) + var(--k-grip-unit)); }
.grip-a {
    background-image:
        repeating-linear-gradient(var(--k-grip-dir), var(--k-mark-a-k) 0 var(--k-grip-unit), transparent var(--k-grip-unit) calc(var(--k-grip-unit) * 2)),
        repeating-linear-gradient(var(--k-grip-dir), var(--k-mark-a) 0 var(--k-grip-unit), transparent var(--k-grip-unit) calc(var(--k-grip-unit) * 2)),
        repeating-linear-gradient(var(--k-grip-dir), var(--k-mark-a-b) 0 var(--k-grip-unit), transparent var(--k-grip-unit) calc(var(--k-grip-unit) * 2));
}
.grip-b {
    background-image:
        repeating-linear-gradient(var(--k-grip-dir), transparent 0 var(--k-grip-unit), var(--k-mark-b-k) var(--k-grip-unit) calc(var(--k-grip-unit) * 2)),
        repeating-linear-gradient(var(--k-grip-dir), transparent 0 var(--k-grip-unit), var(--k-mark-b) var(--k-grip-unit) calc(var(--k-grip-unit) * 2)),
        repeating-linear-gradient(var(--k-grip-dir), transparent 0 var(--k-grip-unit), var(--k-mark-b-b) var(--k-grip-unit) calc(var(--k-grip-unit) * 2));
}
/* Thumb: as wide as the bar, like the buttons (the theme stretches the thumb image to fill it; the
   contract thumb does that). The theme allows a thumb down to 8px: the bar's token, set on the thumb. */
:host { --ax-scrollbar-thumb-min-length: 8px; }
/* Disabled: nothing to scroll, so no thumb. */
:host([disabled]) { display: none; }
`;
