import { describe, expect, test } from 'bun:test';
import { LookAnimator, lookProperties, sameLook } from '../src/parts/animator.js';
import type { Look } from '../src/parts/animator.js';

const rest: Look = { color: [0, 0, 0, 0.4], size: 4, opacity: 0, slide: 3 };
const hover: Look = { color: [0, 0, 0, 0.6], size: 10, opacity: 1, slide: 0 };
const tau = { state: 100, fade: 75, slide: 160, fadeIn: 0, fadeOut: 0 };

describe('LookAnimator', () => {
    test('the first step lands on the target', () => {
        const a = new LookAnimator();
        expect(a.step(rest, 16.7, tau)).toBe(false);
        expect(sameLook(a.current!, rest)).toBe(true);
    });

    test('each channel approaches with its own time constant', () => {
        const a = new LookAnimator();
        a.step(rest, 16.7, tau);
        expect(a.step(hover, 100, tau)).toBe(true);
        const k = (t: number) => 1 - Math.exp(-100 / t);
        const c = a.current!;
        expect(c.size).toBeCloseTo(4 + 6 * k(100), 6);
        expect(c.color[3]).toBeCloseTo(0.4 + 0.2 * k(100), 6);
        expect(c.opacity).toBeCloseTo(k(75), 6);
        expect(c.slide).toBeCloseTo(3 - 3 * k(160), 6);
    });

    test('a time constant of 0 is immediate, and the motion ends', () => {
        const a = new LookAnimator();
        a.step(rest, 16.7, tau);
        expect(a.step(hover, 16.7, { state: 0, fade: 0, slide: 0, fadeIn: 0, fadeOut: 0 })).toBe(false);
        expect(sameLook(a.current!, hover)).toBe(true);
    });

    test('a fade duration fades linearly in that direction, and replaces the time constant', () => {
        const a = new LookAnimator();
        a.step(rest, 16.7, tau);
        const linear = { ...tau, fadeIn: 250, fadeOut: 167 };
        a.step(hover, 125, linear);
        expect(a.current!.opacity).toBeCloseTo(0.5, 6);
        a.step(hover, 125, linear);
        expect(a.current!.opacity).toBe(1);
        a.step(rest, 83.5, linear);
        expect(a.current!.opacity).toBeCloseTo(0.5, 6);
        // The other channels keep their time constants.
        expect(a.current!.size).not.toBe(4);
    });

    test('border and glyph colours approach like the fill; left out, they are transparent', () => {
        const a = new LookAnimator();
        a.step(rest, 16.7, tau);
        expect(a.current!.border).toEqual([0, 0, 0, 0]);
        a.step({ ...hover, border: [0, 0, 0, 1], glyph: [255, 255, 255, 1] }, 100, tau);
        const k = 1 - Math.exp(-1);
        expect(a.current!.border![3]).toBeCloseTo(k, 6);
        expect(a.current!.glyph![0]).toBeCloseTo(255 * k, 6);
    });

    test('it settles: no motion goes on forever', () => {
        const a = new LookAnimator();
        a.step(rest, 16.7, tau);
        let frames = 0;
        while (a.step(hover, 16.7, tau)) frames++;
        expect(frames).toBeLessThan(200);
        expect(sameLook(a.current!, hover)).toBe(true);
    });
});

describe('lookProperties', () => {
    test('the custom properties of a look', () => {
        expect(lookProperties({ color: [10, 20, 30, 0.123456], size: 4.56789, opacity: 0.5, slide: -1 })).toEqual([
            ['--ax-scrollbar-shown-color', 'rgba(10, 20, 30, 0.1235)'],
            ['--ax-scrollbar-shown-border-color', 'rgba(0, 0, 0, 0)'],
            ['--ax-scrollbar-shown-glyph-color', 'rgba(0, 0, 0, 0)'],
            ['--ax-scrollbar-shown-size', '4.568px'],
            ['--ax-scrollbar-shown-thickness', '4.568px'],
            ['--ax-scrollbar-shown-opacity', '0.5'],
            ['--ax-scrollbar-shown-alpha', '1'],
            ['--ax-scrollbar-shown-glyph-scale', '1'],
            ['--ax-scrollbar-shown-slide', '-1px'],
        ]);
    });

    test('the glyph scale follows the state smoothing', () => {
        const a = new LookAnimator();
        a.step({ ...rest, glyphScale: 1 }, 16.7, tau);
        a.step({ ...rest, glyphScale: 0.875 }, 100, tau);
        expect(a.current!.glyphScale).toBeCloseTo(1 - 0.125 * (1 - Math.exp(-1)), 6);
        expect(sameLook(a.current!, { ...rest, glyphScale: 0.875 })).toBe(false);
    });

    test('the alpha of a look follows the state smoothing, not the fade', () => {
        const a = new LookAnimator();
        a.step({ ...rest, opacity: 1, alpha: 1 }, 16.7, tau);
        a.step({ ...rest, opacity: 1, alpha: 0.2 }, 100, tau);
        expect(a.current!.alpha).toBeCloseTo(1 - 0.8 * (1 - Math.exp(-1)), 6);
        expect(a.current!.opacity).toBe(1);
        expect(lookProperties(a.current!).find(([name]) => name === '--ax-scrollbar-shown-alpha')![1]).toBe(String(Math.round(a.current!.alpha! * 1e4) / 1e4));
    });
});
