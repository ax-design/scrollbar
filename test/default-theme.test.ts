import { describe, expect, test } from 'bun:test';
import { BUTTON_CSS, CARD_CSS, THUMB_CSS } from '../src/parts/default-css.js';
import { SHADOW_STYLE } from '../src/style.js';
import { CSS_PROPERTIES, HOST_PROPERTIES, LOOK_PROPERTIES } from '../src/tokens.js';
import { DEFAULT_HIDE } from '../src/hide.js';

const initial = (name: string): string | undefined => [...HOST_PROPERTIES, ...LOOK_PROPERTIES, ...CSS_PROPERTIES].find((spec) => spec.name === `--ax-scrollbar-${name}`)?.initial;

// The default look is Windows 8: the numbers of the Windows 8.1 XAML templates are the initial values of the host tokens
// and the rules of the default parts.
describe('default look (Windows 8)', () => {
    test('the bar: 17px, no padding, 33px buttons, 48px thumbs, no hot zone', () => {
        expect(initial('thickness')).toBe('17px');
        expect(initial('padding')).toBe('0px');
        expect(initial('button-length')).toBe('33px');
        expect(initial('thumb-min-length')).toBe('48px');
        expect(initial('hotzone')).toBe('0px');
    });

    test('motion: states at once, no slide, linear fades of 250ms in and 167ms out, the card opens after 400ms', () => {
        expect(initial('state-smoothing')).toBe('0s');
        expect(initial('slide-distance')).toBe('0px');
        expect(initial('fade-in-duration')).toBe('250ms');
        expect(initial('fade-out-duration')).toBe('167ms');
        expect(initial('card-delay')).toBe('400ms');
        expect(initial('card-slide-duration')).toBe('367ms');
        expect(initial('card-slide-distance')).toBe('12px');
    });

    test('the touch indicator is a thumb alone', () => {
        expect(DEFAULT_HIDE).toBe('button:touch track:touch corner:touch');
        expect(THUMB_CSS).toContain(':host([touch]) { --ax-scrollbar-part-size: 4px;');
        expect(SHADOW_STYLE).toContain(':host([last-indicator="touch"]) { --ax-scrollbar-thumb-min-length: 17px; }');
    });

    test('the parts: square, a 1px border, the fill inside it, the glyph geometry of the XAML arrow', () => {
        expect(THUMB_CSS).toContain('--ax-scrollbar-part-fill-clip: padding-box');
        expect(BUTTON_CSS).toContain('--ax-scrollbar-glyph-width: 10.944px');
        expect(THUMB_CSS).toContain('--ax-scrollbar-part-color: #cdcdcd');
        expect(CARD_CSS).toContain('--ax-border-width: 2px');
        expect(CARD_CSS).toContain('--elevation-depth: 0');
    });
});
