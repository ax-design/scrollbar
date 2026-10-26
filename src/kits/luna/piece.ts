// Plain CSS, as a string so that the published package needs no bundler plugin for it.
export default `/* Windows XP (Luna) kit, the track piece: nothing at rest (the track shows). Page repeat held toward
   a piece: that piece is pressed, drawn with the track's slots of the pressed paint. */

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
:host([pressed]) {
    --t-a: var(--luna-track-pressed-a); --t-a-k: var(--luna-track-pressed-a-k); --t-a-b: var(--luna-track-pressed-a-base);
    --t-b: var(--luna-track-pressed-b); --t-b-k: var(--luna-track-pressed-b-k); --t-b-b: var(--luna-track-pressed-b-base);
    --t-e: var(--luna-track-pressed-edge); --t-e-k: var(--luna-track-pressed-edge-k); --t-e-b: var(--luna-track-pressed-edge-base);
    background:
        linear-gradient(var(--t-dir), var(--t-a-k) 1px, var(--t-b-k) calc(100% - 4px)),
        linear-gradient(var(--t-dir), var(--t-a) 1px, var(--t-b) calc(100% - 4px)),
        linear-gradient(var(--t-dir), var(--t-a-b) 1px, var(--t-b-b) calc(100% - 4px));
    box-shadow:
        var(--t-edge-a) var(--t-e-k), var(--t-edge-a) var(--t-e), var(--t-edge-a) var(--t-e-b),
        var(--t-edge-b) var(--t-e-k), var(--t-edge-b) var(--t-e), var(--t-edge-b) var(--t-e-b);
}
`;
