import { describe, expect, test } from 'bun:test';
import { hostValue, partValue, problems, scrollbarNames, unknownNames } from './demo-css.js';

const css = await Bun.file(new URL('../demo/win11.css', import.meta.url)).text();

// The Windows 11 look is the default parts styled on the parts with ::part(), with the acrylic layer on the track.
describe('demo/win11.css', () => {
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

    test('cites the WinUI resource of its numbers', () => {
        for (const key of ['ScrollBarSize', 'ScrollBarExpandBeginTime', 'ScrollBarContractBeginTime', 'ScrollBarOpacityChangeDuration', 'ControlStrongFillColorDefault', 'TextFillColorSecondary', 'ScrollBarButtonArrowScalePressed', 'AcrylicInAppFillColorDefault', 'ToolTipBorderPadding', 'ControlCornerRadius']) {
            expect(css.includes(key)).toBe(true);
        }
        expect(hostValue(css, '--ax-scrollbar-thickness')).toBe('12px');
        expect(hostValue(css, '--ax-scrollbar-expand-delay')).toBe('400ms');
        expect(hostValue(css, '--ax-scrollbar-contract-delay')).toBe('500ms');
        expect(hostValue(css, '--ax-scrollbar-fade-in-duration')).toBe('83ms');
        expect(partValue(css, 'button-pressed', '--ax-scrollbar-part-glyph-scale')).toBe('0.875');
        expect(partValue(css, 'button', '--ax-scrollbar-glyph-width')).toBe('7px');
        expect(partValue(css, 'button', '--ax-scrollbar-glyph-height')).toBe('4px');
        expect(partValue(css, 'button', '--ax-scrollbar-glyph-corner-radius')).toBe('1px');
        expect(partValue(css, 'card', 'max-width')).toBe('360px');
    });

    test('the hovered and pressed thumb are as wide as the expanded one (no keyword: a part size is a length)', () => {
        expect(partValue(css, 'thumb-hover', '--ax-scrollbar-part-size')).toBe('6px');
        expect(partValue(css, 'thumb-pressed', '--ax-scrollbar-part-size')).toBe('6px');
        expect(partValue(css, 'thumb-engaged', '--ax-scrollbar-part-size')).toBe('6px');
    });

    test('the track reaches under the buttons with its own geometry, and the minimal thumb sits at the outer edge by its part input', () => {
        expect(partValue(css, 'track-vertical', 'top')).toBe('-15px');
        expect(partValue(css, 'track-horizontal', 'right')).toBe('-15px');
        expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).toContain('--ax-scrollbar-part-align: 1');
    });
});
