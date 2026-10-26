import { describe, expect, test } from 'bun:test';
import { hostValue, partValue, problems, scrollbarNames, unknownNames } from './demo-css.js';

const css = await Bun.file(new URL('../demo/minimal.css', import.meta.url)).text();

// Minimal is the default parts styled with ::part(): an outer rule replaces the default part's value of what it sets
// in every state, so the look says everything its parts take.
describe('demo/minimal.css', () => {
    test('styles the default parts with ::part(): every rule names real parts, sets what its selector can, and writes the states in order', () => {
        expect(problems(css)).toEqual([]);
        expect(css.includes('::part(')).toBe(true);
    });

    test('draws nothing: no url()', () => {
        expect(css.replace(/\/\*[\s\S]*?\*\//g, '').includes('url(')).toBe(false);
    });

    test('every scrollbar token it sets exists', () => {
        expect(scrollbarNames(css).size).toBeGreaterThan(10);
        expect(unknownNames(css)).toEqual([]);
    });

    test('is a thin bar: 14px, a 4px thumb that widens to 10px, 4px dots', () => {
        expect(hostValue(css, '--ax-scrollbar-thickness')).toBe('14px');
        expect(partValue(css, 'thumb', '--ax-scrollbar-part-size')).toBe('4px');
        expect(partValue(css, 'thumb-engaged', '--ax-scrollbar-part-size')).toBe('10px');
        expect(partValue(css, 'marker', '--ax-scrollbar-part-size')).toBe('4px');
        expect(partValue(css, 'marker', '--ax-scrollbar-part-thickness')).toBe('auto');
    });
});
