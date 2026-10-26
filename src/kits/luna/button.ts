// Plain CSS, as a string so that the published package needs no bundler plugin for it.
export default `/* Windows XP (Luna) kit, the arrow buttons: geometry, the colours of their states and the arrow glyphs,
   on top of the raised box (luna-raised.css) and the shades (luna-shades.css). */

/* Around its ring a button shows the track's edge colour in every state, also on a disabled bar. */
:host {
    position: relative;
    background:
        linear-gradient(var(--luna-track-edge-k), var(--luna-track-edge-k)),
        linear-gradient(var(--luna-track-edge), var(--luna-track-edge)),
        linear-gradient(var(--luna-track-edge-base), var(--luna-track-edge-base));
}
/* Buttons are not turned: lit from the top in both bars (along --k-shading), no highlight band.
   The top and left strips run along the diagonal (a half of the gradient each, which is why the
   gradient is twice as long as the strip). Their shadows are a pixel shorter than the ring at each
   end, the side one soft at the top. A vertical button keeps the track's edge line on its left, a
   horizontal one on top (its ring is a pixel wider than tall). */
:host {
    --k-ring-inset: 0 var(--k-out) var(--k-out) 1px;
    --k-ring-radius: var(--k-radius);
    --k-face-inset: 1px calc(1px + var(--k-out)) calc(1px + var(--k-out)) 2px;
    --k-face-radius: 2px;
    --k-glyph-at: 3px 4px;
    --k-cut-at: 2px 3px;
    --k-fill-dir: var(--k-shading);
    --k-end-at: 0 2px 1px -1px;
    --k-side-at: 2px 2px 3px -1px;
    --k-top-1: var(--k-edge-a); --k-top-1-k: var(--k-edge-a-k); --k-top-1-b: var(--k-edge-a-b);
    --k-top-2: var(--k-edge-b); --k-top-2-k: var(--k-edge-b-k); --k-top-2-b: var(--k-edge-b-b);
    --k-top-size: 200% 1px;
    --k-left-1: var(--k-edge-a); --k-left-1-k: var(--k-edge-a-k); --k-left-1-b: var(--k-edge-a-b);
    --k-left-2: var(--k-edge-b); --k-left-2-k: var(--k-edge-b-k); --k-left-2-b: var(--k-edge-b-b);
    --k-left-size: 200%;
}
:host([axis="horizontal"]) {
    --k-ring-inset: 1px var(--k-out) var(--k-out) 0;
    --k-face-inset: 2px calc(1px + var(--k-out)) calc(1px + var(--k-out)) 1px;
    --k-glyph-at: 4px 3px;
    --k-cut-at: 3px 2px;
}

/* Colour roles of a state: the ring (over its base), the ring's fill seen at the face's corners, the face's
   edges, fill and (thumb) highlight, the shadows, the grip or the glyph. --k-<role> is the white over
   the base, --k-<role>-k the black over it, --k-<role>-b the base. */
:host {
    --k-ring: var(--luna-button-ring);
    --k-ring-k: var(--luna-button-ring-k);
    --k-ring-b: var(--luna-button-ring-base);
    --k-ring-top: var(--luna-button-ring-top);
    --k-ring-top-k: var(--luna-button-ring-top-k);
    --k-ring-bottom: var(--luna-button-ring-bottom);
    --k-ring-bottom-k: var(--luna-button-ring-bottom-k);
    --k-ringfill: var(--luna-button-ring-fill);
    --k-ringfill-k: var(--luna-button-ring-fill-k);
    --k-ringfill-b: var(--luna-button-ring-fill-base);
    --k-edge-a: var(--luna-button-edge-a);
    --k-edge-a-k: var(--luna-button-edge-a-k);
    --k-edge-a-b: var(--luna-button-edge-a-base);
    --k-edge-b: var(--luna-button-edge-b);
    --k-edge-b-k: var(--luna-button-edge-b-k);
    --k-edge-b-b: var(--luna-button-edge-b-base);
    --k-edge-right: var(--luna-button-edge-right);
    --k-edge-right-k: var(--luna-button-edge-right-k);
    --k-edge-right-b: var(--luna-button-edge-right-base);
    --k-edge-bottom: var(--luna-button-edge-bottom);
    --k-edge-bottom-k: var(--luna-button-edge-bottom-k);
    --k-edge-bottom-b: var(--luna-button-edge-bottom-base);
    --k-fill-a: var(--luna-button-fill-a);
    --k-fill-a-k: var(--luna-button-fill-a-k);
    --k-fill-a-b: var(--luna-button-fill-a-base);
    --k-fill-b: var(--luna-button-fill-b);
    --k-fill-b-k: var(--luna-button-fill-b-k);
    --k-fill-b-b: var(--luna-button-fill-b-base);
    --k-fill-c: var(--luna-button-fill-c);
    --k-fill-c-k: var(--luna-button-fill-c-k);
    --k-fill-c-b: var(--luna-button-fill-c-base);
    --k-side: var(--luna-button-side);
    --k-side-k: var(--luna-button-side-k);
    --k-side-b: var(--luna-button-side-base);
    --k-end: var(--luna-button-end);
    --k-end-k: var(--luna-button-end-k);
    --k-end-b: var(--luna-button-end-base);
    --k-mark: var(--luna-glyph-normal);
    --k-mark-k: var(--luna-glyph-normal-k);
    --k-mark-b: var(--luna-glyph-normal-base);
    --k-glint: var(--luna-button-glint);
    --k-glint-k: var(--luna-button-glint-k);
    --k-glint-b: var(--luna-button-glint-base);
}
:host([hover]) {
    --k-ring: var(--luna-button-hot-ring);
    --k-ring-k: var(--luna-button-hot-ring-k);
    --k-ring-b: var(--luna-button-hot-ring-base);
    --k-ring-top: var(--luna-button-hot-ring-top);
    --k-ring-top-k: var(--luna-button-hot-ring-top-k);
    --k-ring-bottom: var(--luna-button-hot-ring-bottom);
    --k-ring-bottom-k: var(--luna-button-hot-ring-bottom-k);
    --k-ringfill: var(--luna-button-hot-ring-fill);
    --k-ringfill-k: var(--luna-button-hot-ring-fill-k);
    --k-ringfill-b: var(--luna-button-hot-ring-fill-base);
    --k-edge-a: var(--luna-button-hot-edge-a);
    --k-edge-a-k: var(--luna-button-hot-edge-a-k);
    --k-edge-a-b: var(--luna-button-hot-edge-a-base);
    --k-edge-b: var(--luna-button-hot-edge-b);
    --k-edge-b-k: var(--luna-button-hot-edge-b-k);
    --k-edge-b-b: var(--luna-button-hot-edge-b-base);
    --k-edge-right: var(--luna-button-hot-edge-right);
    --k-edge-right-k: var(--luna-button-hot-edge-right-k);
    --k-edge-right-b: var(--luna-button-hot-edge-right-base);
    --k-edge-bottom: var(--luna-button-hot-edge-bottom);
    --k-edge-bottom-k: var(--luna-button-hot-edge-bottom-k);
    --k-edge-bottom-b: var(--luna-button-hot-edge-bottom-base);
    --k-fill-a: var(--luna-button-hot-fill-a);
    --k-fill-a-k: var(--luna-button-hot-fill-a-k);
    --k-fill-a-b: var(--luna-button-hot-fill-a-base);
    --k-fill-b: var(--luna-button-hot-fill-b);
    --k-fill-b-k: var(--luna-button-hot-fill-b-k);
    --k-fill-b-b: var(--luna-button-hot-fill-b-base);
    --k-fill-c: var(--luna-button-hot-fill-c);
    --k-fill-c-k: var(--luna-button-hot-fill-c-k);
    --k-fill-c-b: var(--luna-button-hot-fill-c-base);
    --k-side: var(--luna-button-hot-side);
    --k-side-k: var(--luna-button-hot-side-k);
    --k-side-b: var(--luna-button-hot-side-base);
    --k-end: var(--luna-button-hot-end);
    --k-end-k: var(--luna-button-hot-end-k);
    --k-end-b: var(--luna-button-hot-end-base);
    --k-mark: var(--luna-glyph-hot);
    --k-mark-k: var(--luna-glyph-hot-k);
    --k-mark-b: var(--luna-glyph-hot-base);
    --k-glint: var(--luna-button-hot-glint);
    --k-glint-k: var(--luna-button-hot-glint-k);
    --k-glint-b: var(--luna-button-hot-glint-base);
}
:host([pressed]) {
    --k-ring: var(--luna-button-pressed-ring);
    --k-ring-k: var(--luna-button-pressed-ring-k);
    --k-ring-b: var(--luna-button-pressed-ring-base);
    --k-ring-top: var(--luna-button-pressed-ring-top);
    --k-ring-top-k: var(--luna-button-pressed-ring-top-k);
    --k-ring-bottom: var(--luna-button-pressed-ring-bottom);
    --k-ring-bottom-k: var(--luna-button-pressed-ring-bottom-k);
    --k-ringfill: var(--luna-button-pressed-ring-fill);
    --k-ringfill-k: var(--luna-button-pressed-ring-fill-k);
    --k-ringfill-b: var(--luna-button-pressed-ring-fill-base);
    --k-edge-a: var(--luna-button-pressed-edge-a);
    --k-edge-a-k: var(--luna-button-pressed-edge-a-k);
    --k-edge-a-b: var(--luna-button-pressed-edge-a-base);
    --k-edge-b: var(--luna-button-pressed-edge-b);
    --k-edge-b-k: var(--luna-button-pressed-edge-b-k);
    --k-edge-b-b: var(--luna-button-pressed-edge-b-base);
    --k-edge-right: var(--luna-button-pressed-edge-right);
    --k-edge-right-k: var(--luna-button-pressed-edge-right-k);
    --k-edge-right-b: var(--luna-button-pressed-edge-right-base);
    --k-edge-bottom: var(--luna-button-pressed-edge-bottom);
    --k-edge-bottom-k: var(--luna-button-pressed-edge-bottom-k);
    --k-edge-bottom-b: var(--luna-button-pressed-edge-bottom-base);
    --k-fill-a: var(--luna-button-pressed-fill-a);
    --k-fill-a-k: var(--luna-button-pressed-fill-a-k);
    --k-fill-a-b: var(--luna-button-pressed-fill-a-base);
    --k-fill-b: var(--luna-button-pressed-fill-b);
    --k-fill-b-k: var(--luna-button-pressed-fill-b-k);
    --k-fill-b-b: var(--luna-button-pressed-fill-b-base);
    --k-fill-c: var(--luna-button-pressed-fill-c);
    --k-fill-c-k: var(--luna-button-pressed-fill-c-k);
    --k-fill-c-b: var(--luna-button-pressed-fill-c-base);
    --k-side: var(--luna-button-pressed-side);
    --k-side-k: var(--luna-button-pressed-side-k);
    --k-side-b: var(--luna-button-pressed-side-base);
    --k-end: var(--luna-button-pressed-end);
    --k-end-k: var(--luna-button-pressed-end-k);
    --k-end-b: var(--luna-button-pressed-end-base);
    --k-mark: var(--luna-glyph-pressed);
    --k-mark-k: var(--luna-glyph-pressed-k);
    --k-mark-b: var(--luna-glyph-pressed-base);
    --k-glint: var(--luna-button-pressed-glint);
    --k-glint-k: var(--luna-button-pressed-glint-k);
    --k-glint-b: var(--luna-button-pressed-glint-base);
}
:host([disabled]) {
    --k-ring: var(--luna-button-disabled-ring);
    --k-ring-k: var(--luna-button-disabled-ring-k);
    --k-ring-b: var(--luna-button-disabled-ring-base);
    --k-ring-top: var(--luna-button-disabled-ring-top);
    --k-ring-top-k: var(--luna-button-disabled-ring-top-k);
    --k-ring-bottom: var(--luna-button-disabled-ring-bottom);
    --k-ring-bottom-k: var(--luna-button-disabled-ring-bottom-k);
    --k-ringfill: var(--luna-button-disabled-ring-fill);
    --k-ringfill-k: var(--luna-button-disabled-ring-fill-k);
    --k-ringfill-b: var(--luna-button-disabled-ring-fill-base);
    --k-edge-a: var(--luna-button-disabled-edge-a);
    --k-edge-a-k: var(--luna-button-disabled-edge-a-k);
    --k-edge-a-b: var(--luna-button-disabled-edge-a-base);
    --k-edge-b: var(--luna-button-disabled-edge-b);
    --k-edge-b-k: var(--luna-button-disabled-edge-b-k);
    --k-edge-b-b: var(--luna-button-disabled-edge-b-base);
    --k-edge-right: var(--luna-button-disabled-edge-right);
    --k-edge-right-k: var(--luna-button-disabled-edge-right-k);
    --k-edge-right-b: var(--luna-button-disabled-edge-right-base);
    --k-edge-bottom: var(--luna-button-disabled-edge-bottom);
    --k-edge-bottom-k: var(--luna-button-disabled-edge-bottom-k);
    --k-edge-bottom-b: var(--luna-button-disabled-edge-bottom-base);
    --k-fill-a: var(--luna-button-disabled-fill-a);
    --k-fill-a-k: var(--luna-button-disabled-fill-a-k);
    --k-fill-a-b: var(--luna-button-disabled-fill-a-base);
    --k-fill-b: var(--luna-button-disabled-fill-b);
    --k-fill-b-k: var(--luna-button-disabled-fill-b-k);
    --k-fill-b-b: var(--luna-button-disabled-fill-b-base);
    --k-fill-c: var(--luna-button-disabled-fill-c);
    --k-fill-c-k: var(--luna-button-disabled-fill-c-k);
    --k-fill-c-b: var(--luna-button-disabled-fill-c-base);
    --k-side: var(--luna-button-disabled-side);
    --k-side-k: var(--luna-button-disabled-side-k);
    --k-side-b: var(--luna-button-disabled-side-base);
    --k-end: var(--luna-button-disabled-end);
    --k-end-k: var(--luna-button-disabled-end-k);
    --k-end-b: var(--luna-button-disabled-end-base);
    --k-mark: var(--luna-glyph-disabled);
    --k-mark-k: var(--luna-glyph-disabled-k);
    --k-mark-b: var(--luna-glyph-disabled-base);
    --k-glint: transparent;
    --k-glint-k: transparent;
    --k-glint-b: transparent;
}

/* Disabled buttons have the same shape in every scheme and light: a white ring with a drop shadow. */
:host([disabled]) {
    --k-out: 1px;
    --k-radius: 1px 0 2px 2px;
}

/* ---- Arrow glyphs: a chevron per direction, cut out of the face -------------------------------- */

/* Up and down are 9 wide and 6 tall with 45 degree arms; left and right are the same chevron
   standing up, 6 wide. The edges lie half way between pixel centres, so at 1x the antialiasing
   only touches an eighth of the pixels along the staircase. The glyph's colour is a block in the
   ring's fill, uncovered by the cut-out in the face. */
:host::before {
    background:
        linear-gradient(var(--k-mark-k), var(--k-mark-k)) var(--k-glyph-at) / 9px 9px no-repeat border-box,
        linear-gradient(var(--k-mark), var(--k-mark)) var(--k-glyph-at) / 9px 9px no-repeat border-box,
        linear-gradient(var(--k-mark-b), var(--k-mark-b)) var(--k-glyph-at) / 9px 9px no-repeat border-box,
        linear-gradient(var(--k-ringfill-k), var(--k-ringfill-k)) padding-box,
        linear-gradient(var(--k-ringfill), var(--k-ringfill)) padding-box,
        linear-gradient(var(--k-ringfill-b), var(--k-ringfill-b)) padding-box,
        linear-gradient(to bottom, var(--k-ring-top) 1px, var(--k-ring) 1px calc(100% - 1px), var(--k-ring-bottom) calc(100% - 1px)) border-box,
        linear-gradient(var(--k-ring-b), var(--k-ring-b)) border-box;
}
:host::after {
    /* Olive Green has a light line inside the face's border, along the top and both sides: the
       scheme's --luna-glint is its width (0: none). */
    box-shadow:
        inset calc(var(--luna-glint, 0) * 1px) calc(var(--luna-glint, 0) * 1px) 0 0 var(--k-glint-k),
        inset calc(var(--luna-glint, 0) * 1px) calc(var(--luna-glint, 0) * 1px) 0 0 var(--k-glint),
        inset calc(var(--luna-glint, 0) * 1px) calc(var(--luna-glint, 0) * 1px) 0 0 var(--k-glint-b),
        inset calc(var(--luna-glint, 0) * -1px) 0 0 0 var(--k-glint-k),
        inset calc(var(--luna-glint, 0) * -1px) 0 0 0 var(--k-glint),
        inset calc(var(--luna-glint, 0) * -1px) 0 0 0 var(--k-glint-b);
    -webkit-mask: var(--k-glyph) var(--k-cut-at) / 9px 9px no-repeat, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: var(--k-glyph) var(--k-cut-at) / 9px 9px no-repeat, linear-gradient(#000 0 0);
    mask-composite: exclude;
}
:host([axis="vertical"][direction="start"]) {
    --k-glyph: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 9'><path d='M4.5 1 9 5.5 7.5 7 4.5 4 1.5 7 0 5.5z'/></svg>");
}
:host([axis="vertical"][direction="end"]) {
    --k-glyph: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 9'><path d='M4.5 8 9 3.5 7.5 2 4.5 5 1.5 2 0 3.5z'/></svg>");
}
:host([axis="horizontal"][direction="start"]) {
    --k-glyph: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 9'><path d='M4.5 0 6 1.5 3 4.5 6 7.5 4.5 9 0 4.5z'/></svg>");
}
:host([axis="horizontal"][direction="end"]) {
    --k-glyph: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 9'><path d='M3.5 0 2 1.5 5 4.5 2 7.5 3.5 9 8 4.5z'/></svg>");
}
/* Buttons: 17 x 17, the bar's button length, set on the button. */
:host { --ax-scrollbar-button-length: 17px; }
`;
