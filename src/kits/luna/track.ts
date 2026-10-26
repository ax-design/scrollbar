// Plain CSS, as a string so that the published package needs no bundler plugin for it.
export default `/* Windows XP (Luna) kit, the track: a 1px edge line on both long sides, and a shading that grows
   lighter toward the far side. A paint is three layers: black over white over its base (see
   luna-shades.css): the slots --t-*, --t-*-k and --t-*-b are the white, the black and the base.
   The track piece (luna-piece.css) shares the slots. */

:host([axis="vertical"]) {
    --t-dir: to right;
    --t-edge-a: inset 1px 0;
    --t-edge-b: inset -1px 0;
}
:host([axis="horizontal"]) {
    --t-dir: to bottom;
    --t-edge-a: inset 0 1px;
    --t-edge-b: inset 0 -1px;
}
:host {
    --t-a: var(--luna-track-a); --t-a-k: var(--luna-track-a-k); --t-a-b: var(--luna-track-a-base);
    --t-b: var(--luna-track-b); --t-b-k: var(--luna-track-b-k); --t-b-b: var(--luna-track-b-base);
    --t-e: var(--luna-track-edge); --t-e-k: var(--luna-track-edge-k); --t-e-b: var(--luna-track-edge-base);
    background:
        linear-gradient(var(--t-dir), var(--t-a-k) 1px, var(--t-b-k) calc(100% - 4px)),
        linear-gradient(var(--t-dir), var(--t-a) 1px, var(--t-b) calc(100% - 4px)),
        linear-gradient(var(--t-dir), var(--t-a-b) 1px, var(--t-b-b) calc(100% - 4px));
    box-shadow:
        var(--t-edge-a) var(--t-e-k), var(--t-edge-a) var(--t-e), var(--t-edge-a) var(--t-e-b),
        var(--t-edge-b) var(--t-e-k), var(--t-edge-b) var(--t-e), var(--t-edge-b) var(--t-e-b);
}
/* Nothing to scroll: flat. Only the vertical bar: the theme's disabled horizontal track is the
   normal one. */
:host([axis="vertical"][disabled]) {
    background:
        linear-gradient(var(--luna-track-disabled-k), var(--luna-track-disabled-k)),
        linear-gradient(var(--luna-track-disabled), var(--luna-track-disabled)),
        linear-gradient(var(--luna-track-disabled-base), var(--luna-track-disabled-base));
    box-shadow:
        var(--t-edge-a) var(--luna-track-disabled-edge-k), var(--t-edge-a) var(--luna-track-disabled-edge), var(--t-edge-a) var(--luna-track-disabled-edge-base),
        var(--t-edge-b) var(--luna-track-disabled-edge-k), var(--t-edge-b) var(--luna-track-disabled-edge), var(--t-edge-b) var(--luna-track-disabled-edge-base);
}
`;
