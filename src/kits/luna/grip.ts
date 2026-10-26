// Where the thumb's grip lines are drawn so that every line covers whole device pixels.
//
// The theme draws the grip as four pairs of 1px lines, a light one over a dark one a pixel down and
// right, in a box of 6 x 8 px that it centres in the thumb with whole pixels, rounded down. In CSS px
// that is crisp only where a CSS px is a whole number of device pixels (at 100% and 200%) and the thumb
// is painted on whole pixels. On a screen of 1.1, 1.25 or 1.5 device pixels per CSS px a 1px line covers
// a fraction of a pixel at each of its edges, and the four lines run together into one smudge; so it
// does where a snapped thumb is moved by a fraction of a pixel, at any ratio. There the grip is laid out
// in device pixels: a line is
// n = round(dpr) device pixels (1 at 1.1x and 1.25x, 2 at 1.5x), the box is 6n x 8n device pixels, and
// its offsets are whole device pixels from the thumb's edges. The thumb writes the values below as
// the custom properties `--k-grip-unit` (one line), `--k-grip-along` and `--k-grip-across` (the light
// box's offset from the thumb's start along the bar and from its edge across it), which the grip's two
// boxes use (thumb.ts), and sets its attribute `grip` to `device` to show them.
//
// The thumb starts on a whole device pixel along the bar (the `snap` attribute, which the thumbs of
// this kit are used with, puts its edges there), so a whole offset from it is a whole device pixel on
// the screen. Across the bar the thumb can start at a fraction of a device pixel, but the boxes are
// whole device pixels wide and the browser snaps a box as a whole, so a line is as wide at either end.

// Lines in the box, the box's offset across the bar from the thumb's edge (CSS px at 1x).
const LINES = 8;
const ACROSS = 5;

// Whether a CSS px is a whole number of device pixels, so that the theme's 1px lines are crisp as they are.
export function isWholeRatio(dpr: number): boolean {
    return Math.abs(dpr - Math.round(dpr)) < 1e-3;
}

export interface GripPlace {
    // One grip line, in CSS px.
    unit: number;
    // The light box's offset from the thumb's start along the bar and from its edge across the bar, in CSS px.
    along: number;
    across: number;
}

// `length` is the thumb's length along the bar in CSS px. `cross` is where the thumb starts across the
// bar, in device pixels (its left edge in a vertical bar, its top edge in a horizontal one): a bar can lie
// at a fraction of a device pixel across, and the browser then snaps what is drawn in it by rounding that
// fraction, which is not the same as rounding the offset of what is drawn, so that the offset across is
// chosen to land the box on a whole pixel from where the thumb really starts.
export function gripPlace(length: number, dpr: number, cross = 0): GripPlace {
    const ratio = dpr > 0 ? dpr : 1;
    const n = Math.max(1, Math.round(ratio));
    const total = Math.round(length * ratio);
    // The theme centres the box rounded down; a thumb shorter than the box starts it at the thumb's start.
    const start = Math.max(0, Math.floor((total - LINES * n) / 2));
    return {
        unit: n / ratio,
        along: start / ratio,
        across: (Math.round(cross) + Math.round(ACROSS * ratio) - cross) / ratio,
    };
}
