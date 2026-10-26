import { describe, expect, test } from 'bun:test';
import { hostValue, partValue, problems, scrollbarNames, unknownNames } from './demo-css.js';

const css = await Bun.file(new URL('../demo/cyberpunk.css', import.meta.url)).text();

// Cyber Punk is the default parts styled on the parts with ::part(), and no drawing of its own.
describe('demo/cyberpunk.css', () => {
    test('styles the default parts with ::part(): every rule names real parts, sets what its selector can, and writes the states in order', () => {
        expect(problems(css)).toEqual([]);
        expect(css.includes('::part(')).toBe(true);
    });

    test('draws nothing: no url() and no drawing property', () => {
        expect(css.replace(/\/\*[\s\S]*?\*\//g, '').includes('url(')).toBe(false);
    });

    test('every scrollbar token it sets exists', () => {
        expect(scrollbarNames(css).size).toBeGreaterThan(10);
        expect(unknownNames(css)).toEqual([]);
    });

    test('bevels the thumb, buttons, track, corner, markers and card, and the marker radius is half its side', () => {
        for (const part of ['thumb', 'button', 'track', 'corner', 'marker', 'card']) {
            expect(partValue(css, part, '--ax-corner-shape')).toBe('bevel');
        }
        expect(partValue(css, 'marker', '--ax-radius')).toBe('50%');
        // Two opposite corners are cut: the other two are square on every part but the diamond marker.
        for (const part of ['thumb', 'button', 'track', 'corner', 'card']) {
            expect(partValue(css, part, '--ax-top-right-radius')).toBe('0px');
            expect(partValue(css, part, '--ax-bottom-left-radius')).toBe('0px');
        }
        expect(partValue(css, 'marker', '--ax-scrollbar-part-thickness')).toBe('auto');
    });

    test('the card glows through the elevation colour, and its thickness is the host token', () => {
        expect(partValue(css, 'card', '--elevation-color')).toBe('rgba(255, 43, 214, 0.35)');
        expect(hostValue(css, '--ax-scrollbar-thickness')).toBe('16px');
    });
});
