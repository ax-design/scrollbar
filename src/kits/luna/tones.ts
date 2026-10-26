// The tones of a scheme that follow its colour. A custom scheme sets `--luna-accent-light`, the colour
// the thumb and the buttons show at rest; `--luna-accent` (rings, hot faces), `--luna-accent-deep`
// (rings and edges when hot, the dark grip lines, shadows) and `--luna-glyph` (arrows, grip) may be
// `auto`, and the part then derives them here from it, in OKLCH, when the scheme's values change.
//
// The relations are fitted to the tones the shipped schemes were designed with. In OKLCH, with
// (L, C, h) the lightness, chroma and hue of `--luna-accent-light`, every derived tone keeps the hue
// and takes
//
//     L' = kL * L        C' = kC * C
//
// (a proportional model: black stays black and a grey body stays grey, where an offset would not).
// A chroma that does not fit sRGB at that lightness and hue is reduced until it does.
//
// Luna style (`--luna-light: top-left`), fitted to Blue, Purple, Orange and Pink:
//
//     tone     kL      kC     largest error of the four schemes
//     accent   0.891   1.908  dL 0.020, dC 0.006
//     deep     0.698   3.397  dL 0.064 (Orange), dC 0.035
//     glyph    0.527   1.267  dL 0.013, dC 0.020  (the dark arrow)
//
// Metallic style (`--luna-light: top`), fitted to Silver and Gold (two schemes, so the fit is a
// compromise: Silver's navy `accent` is chromatic where its body is nearly grey, which no relation
// of the body can say, and a derived tone of Silver's body is a grey-blue):
//
//     tone     kL      kC     error
//     accent   0.283   1.346  dL 0.022, dC 0.125 (Silver) and 0.041 (Gold)
//     deep     0.233   0.773  dL 0.015, dC 0.027
//     glyph    0.240   0.458  dL 0.024, dC 0.011
//
// The arrow and the grip are white where the body is dark. Olive Green's body (L 0.784) has white
// arrows, Blue's (0.865, the darkest of the light bodies) has dark ones, so the threshold is the
// middle of the two, 0.8245; it is the same in both styles (the lightest body that wants white
// arrows is Olive Green's, and Silver and Gold are far above it).

// Red, green and blue in 0..255 (an alpha channel after them is ignored).
export type Rgb = readonly number[];

export interface Tones {
    accent: string;
    deep: string;
    glyph: string;
}

interface Relation {
    kL: number;
    kC: number;
}

const LUNA: { [tone in keyof Tones]: Relation } = {
    accent: { kL: 0.891, kC: 1.908 },
    deep: { kL: 0.698, kC: 3.397 },
    glyph: { kL: 0.527, kC: 1.267 },
};

const METALLIC: { [tone in keyof Tones]: Relation } = {
    accent: { kL: 0.283, kC: 1.346 },
    deep: { kL: 0.233, kC: 0.773 },
    glyph: { kL: 0.24, kC: 0.458 },
};

// Below this lightness of `--luna-accent-light` the arrow and the grip are white.
export const WHITE_GLYPH_BELOW = 0.8245;

const toLinear = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const fromLinear = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

// sRGB (0..255) to OKLCH, [L, C, h in degrees].
export function toOklch(rgb: Rgb): [number, number, number] {
    const r = toLinear(rgb[0]);
    const g = toLinear(rgb[1]);
    const b = toLinear(rgb[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const h = (Math.atan2(bb, a) * 180) / Math.PI;
    return [L, Math.hypot(a, bb), h < 0 ? h + 360 : h];
}

// Linear sRGB of an OKLCH colour, unclamped.
function linearOf(L: number, C: number, h: number): [number, number, number] {
    const a = C * Math.cos((h * Math.PI) / 180);
    const b = C * Math.sin((h * Math.PI) / 180);
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const EPS = 1e-6;
const inGamut = (c: number[]): boolean => c.every((v) => v >= -EPS && v <= 1 + EPS);

const byte = (v: number): string => {
    const n = Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255);
    return (n < 16 ? '0' : '') + n.toString(16);
};

// OKLCH to a hex colour, with the chroma reduced to the largest that fits sRGB.
export function fromOklch(L: number, C: number, h: number): string {
    const lightness = Math.min(1, Math.max(0, L));
    let chroma = Math.max(0, C);
    if (!inGamut(linearOf(lightness, chroma, h))) {
        let low = 0;
        let high = chroma;
        for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2;
            if (inGamut(linearOf(lightness, mid, h))) low = mid;
            else high = mid;
        }
        chroma = low;
    }
    const c = linearOf(lightness, chroma, h);
    return `#${byte(c[0])}${byte(c[1])}${byte(c[2])}`;
}

// The derived tones of a scheme whose body (`--luna-accent-light`) is `light`; `metallic` is the style
// of the scheme (`--luna-light: top`).
export function deriveTones(light: Rgb, metallic: boolean): Tones {
    const [L, C, h] = toOklch(light);
    const set = metallic ? METALLIC : LUNA;
    const tone = (r: Relation): string => fromOklch(r.kL * L, r.kC * C, h);
    return {
        accent: tone(set.accent),
        deep: tone(set.deep),
        glyph: L < WHITE_GLYPH_BELOW ? '#ffffff' : tone(set.glyph),
    };
}
