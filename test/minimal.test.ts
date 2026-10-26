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

    test('is a thin bar: 14px, a thumb of 4 units that widens to 10, dots of 4, a unit being a fourteenth of the thickness', () => {
        expect(hostValue(css, '--ax-scrollbar-thickness')).toBe('14px');
        expect(hostValue(css, '--minimal-unit')).toBe('calc(var(--ax-scrollbar-thickness) / 14)');
        expect(partValue(css, 'thumb', '--ax-scrollbar-part-size')).toBe('calc(var(--minimal-unit) * 4)');
        expect(partValue(css, 'thumb-engaged', '--ax-scrollbar-part-size')).toBe('calc(var(--minimal-unit) * 10)');
        expect(partValue(css, 'marker', '--ax-scrollbar-part-size')).toBe('calc(var(--minimal-unit) * 4)');
        expect(partValue(css, 'marker', '--ax-scrollbar-part-thickness')).toBe('auto');
    });

    test('no size of the bar is a fixed length: the parts and the host tokens scale with the thickness', () => {
        const bar = css
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .filter((line) => /--ax-scrollbar-(part-size|part-thickness|padding|thumb-min-length|slide-distance)\s*:/.test(line));
        expect(bar.length).toBeGreaterThan(8);
        expect(bar.filter((line) => /\d+px/.test(line) && !line.includes('--minimal-unit'))).toEqual([]);
    });
});
