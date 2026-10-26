import { describe, expect, test } from 'bun:test';
import { gripPlace, isWholeRatio } from '../src/kits/luna/grip.js';
import { WHITE_GLYPH_BELOW, deriveTones, fromOklch, toOklch } from '../src/kits/luna/tones.js';

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lch = (hex: string): number[] => toOklch(rgb(hex));
const hueGap = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

// The tones the shipped schemes were designed with: body (`--luna-accent-light`), accent, deep, glyph.
const SHIPPED: { [name: string]: [string, string, string, string] } = {
    blue: ['#bdd3ff', '#85b0ff', '#0065fa', '#42577d'],
    purple: ['#dcc9f7', '#bf9df2', '#8e3ee5', '#5e4e77'],
    orange: ['#ffdcb8', '#ffb877', '#f07a1a', '#8a5228'],
    pink: ['#fcd3e8', '#f6a6cf', '#e3559e', '#7d4462'],
    silver: ['#ebedff', '#00096a', '#001a2a', '#171717'],
    gold: ['#ffe6b0', '#3a2600', '#2a1a00', '#2a1f0a'],
};

describe('OKLCH', () => {
    test('a colour goes through OKLCH and back', () => {
        for (const hex of ['#bdd3ff', '#0065fa', '#ffdcb8', '#3a2600', '#808080', '#ffffff', '#000000']) {
            const [l, c, h] = lch(hex);
            expect(fromOklch(l, c, h)).toBe(hex);
        }
    });

    test('a chroma outside sRGB is reduced to the largest inside it', () => {
        const hex = fromOklch(0.5, 0.5, 145);
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        const [l, c, h] = lch(hex);
        expect(Math.abs(l - 0.5)).toBeLessThan(0.01);
        expect(c).toBeLessThan(0.5);
        expect(hueGap(h, 145)).toBeLessThan(2);
    });
});

describe('derived tones', () => {
    test('the Luna style comes near the tones of Blue, Purple, Orange and Pink', () => {
        for (const name of ['blue', 'purple', 'orange', 'pink']) {
            const [body, accent, deep, glyph] = SHIPPED[name];
            const got = deriveTones(rgb(body), false);
            const have: [string, string][] = [[got.accent, accent], [got.deep, deep], [got.glyph, glyph]];
            for (const [derived, shipped] of have) {
                const a = lch(derived);
                const b = lch(shipped);
                expect(Math.abs(a[0] - b[0])).toBeLessThan(0.07);
                expect(Math.abs(a[1] - b[1])).toBeLessThan(0.04);
                expect(hueGap(a[2], b[2])).toBeLessThan(18);
            }
        }
    });

    test('the Metallic style comes near the lightness of the tones of Silver and Gold', () => {
        for (const name of ['silver', 'gold']) {
            const [body, accent, deep, glyph] = SHIPPED[name];
            const got = deriveTones(rgb(body), true);
            for (const [derived, shipped] of [[got.accent, accent], [got.deep, deep], [got.glyph, glyph]]) expect(Math.abs(lch(derived)[0] - lch(shipped)[0])).toBeLessThan(0.03);
        }
    });

    test('the tones keep the hue of the body', () => {
        for (const body of ['#cfe0ff', '#c9e8c0', '#f3c6e5', '#ffe6b0']) {
            const [, c, h] = lch(body);
            const got = deriveTones(rgb(body), false);
            for (const tone of [got.accent, got.deep, got.glyph]) if (tone !== '#ffffff') expect(hueGap(lch(tone)[2], h)).toBeLessThan(c > 0.02 ? 6 : 360);
        }
    });

    test('white arrows below the lightness of Olive Green and Blue, dark ones above', () => {
        // Olive Green's body (L 0.784) has white arrows, Blue's (0.865) dark ones.
        expect(lch('#aec193')[0]).toBeLessThan(WHITE_GLYPH_BELOW);
        expect(lch('#bdd3ff')[0]).toBeGreaterThan(WHITE_GLYPH_BELOW);
        expect(deriveTones(rgb('#aec193'), false).glyph).toBe('#ffffff');
        expect(deriveTones(rgb('#bdd3ff'), false).glyph).not.toBe('#ffffff');
        expect(deriveTones(rgb('#1f4d2a'), false).glyph).toBe('#ffffff');
        expect(deriveTones(rgb('#3a3a3a'), true).glyph).toBe('#ffffff');
        expect(deriveTones(rgb('#ffe6b0'), true).glyph).not.toBe('#ffffff');
    });

    test('the deep tone is darker than the accent, which is darker than the body, in the Luna style', () => {
        for (const body of ['#bdd3ff', '#ffdcb8', '#dcc9f7', '#9fc5a0']) {
            const l = lch(body)[0];
            const got = deriveTones(rgb(body), false);
            expect(lch(got.accent)[0]).toBeLessThan(l);
            expect(lch(got.deep)[0]).toBeLessThan(lch(got.accent)[0]);
        }
    });

    test('a grey body gives grey tones', () => {
        for (const metallic of [false, true]) {
            const got = deriveTones(rgb('#d0d0d0'), metallic);
            for (const tone of [got.accent, got.deep, got.glyph]) expect(lch(tone)[1]).toBeLessThan(0.005);
        }
    });
});

describe('grip place', () => {
    test('the theme\'s 1px lines are crisp at a whole ratio only', () => {
        for (const dpr of [1, 2, 3]) expect(isWholeRatio(dpr)).toBe(true);
        for (const dpr of [1.1, 1.25, 1.5, 1.75, 2.5]) expect(isWholeRatio(dpr)).toBe(false);
    });

    test('at 1x it is the theme: lines of 1px, the box centred rounded down, 5px from the edge', () => {
        for (const length of [8, 20, 41, 42, 63]) {
            const place = gripPlace(length, 1);
            expect(place.unit).toBe(1);
            expect(place.along).toBe(Math.max(0, Math.floor((length - 8) / 2)));
            expect(place.across).toBe(5);
        }
    });

    test('a line is a whole number of device pixels and so are the offsets, at every ratio', () => {
        for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
            for (const length of [30, 40, 43.2, 48.8, 56, 61.6, 90.4]) {
                const place = gripPlace(length, dpr);
                const device = (n: number): number => n * dpr;
                const whole = (n: number): boolean => Math.abs(device(n) - Math.round(device(n))) < 1e-9;
                expect(whole(place.unit)).toBe(true);
                expect(whole(place.along)).toBe(true);
                expect(whole(place.across)).toBe(true);
                expect(Math.round(device(place.unit))).toBe(Math.max(1, Math.round(dpr)));
            }
        }
    });

    test('the box is centred in the thumb as the theme centres it, in device pixels', () => {
        const place = gripPlace(40, 1.25);
        // 50 device px long, a box of 8: 21 from the start.
        expect(Math.round(place.along * 1.25)).toBe(21);
        expect(Math.round(place.unit * 1.25)).toBe(1);
        const double = gripPlace(40, 2);
        expect(Math.round(double.along * 2)).toBe(32);
    });

    test('a thumb shorter than the box starts it at its start', () => {
        expect(gripPlace(8, 1.5).along).toBe(0);
    });
});
