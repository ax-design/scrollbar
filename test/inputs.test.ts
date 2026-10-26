import { describe, expect, test } from 'bun:test';
import { CSS_PROPERTIES, HOST_PROPERTIES, INPUT_PROPERTIES, LOOK_PROPERTIES } from '../src/tokens.js';
import { BUTTON_CSS, CARD_CSS, CORNER_CSS, MARKER_CSS, PIECE_CSS, THUMB_CSS, TRACK_CSS } from '../src/parts/default-css.js';
import { SHADOW_STYLE } from '../src/style.js';

const DEFAULT_CSS = [THUMB_CSS, BUTTON_CSS, TRACK_CSS, PIECE_CSS, CORNER_CSS, MARKER_CSS, CARD_CSS].join('\n');

const names = (list: { name: string }[]): string[] => list.map((spec) => spec.name);

// B11: a part is styled on the part. The look inputs are the part's own; what stays on the host
// is the behaviour of the whole bar.
describe('look inputs (B11)', () => {
    test('are the seven animated inputs and the card lines, registered and not inherited', () => {
        expect(names(INPUT_PROPERTIES).sort()).toEqual(
            ['color', 'border-color', 'glyph-color', 'size', 'thickness', 'opacity', 'glyph-scale', 'lines'].map((n) => `--ax-scrollbar-part-${n}`).sort(),
        );
        for (const spec of INPUT_PROPERTIES) {
            expect(spec.inherits).toBe(false);
            expect(spec.register).toBe(true);
        }
        for (const spec of INPUT_PROPERTIES) expect(names(LOOK_PROPERTIES)).toContain(spec.name);
    });

    test('no per-part, per-state host token is left', () => {
        const old = /^--ax-scrollbar-(thumb|button|track-piece|track|corner|marker|card)-(?!min-length$|length$|smoothing$|delay$|spacing$|reach$|gap$|slide-(duration|distance)$)/;
        const all = names([...HOST_PROPERTIES, ...LOOK_PROPERTIES, ...CSS_PROPERTIES]);
        expect(all.filter((name) => old.test(name))).toEqual([]);
        expect(all.filter((name) => /card-(color|padding|lines|shadow-color|text-color|font-size|max-width)$/.test(name))).toEqual([]);
    });

    test('the host keeps the tokens of the whole bar, card-gap and marker-reach among them as lengths', () => {
        const host = Object.fromEntries(HOST_PROPERTIES.map((spec) => [spec.name, spec]));
        for (const name of ['card-gap', 'marker-reach']) expect((host[`--ax-scrollbar-${name}`].syntax as { type: string }).type).toBe('length');
        for (const name of ['thickness', 'padding', 'thumb-min-length', 'button-length']) {
            expect(names([...HOST_PROPERTIES, ...CSS_PROPERTIES])).toContain(`--ax-scrollbar-${name}`);
        }
    });
});

describe('default parts (B11, B13)', () => {
    test('set the inputs on themselves and their states, and move the shown values to private names', () => {
        expect(THUMB_CSS).toContain(':host([hover]) { --ax-scrollbar-part-color:');
        expect(MARKER_CSS).toContain(':host([on-thumb]) { --ax-scrollbar-part-color:');
        expect(BUTTON_CSS).toContain(':host([pressed]) { --ax-scrollbar-part-color: rgba(0, 0, 0, 0.6); --ax-scrollbar-part-glyph-color:');
        expect(DEFAULT_CSS).toContain('var(--ax-scrollbar-shown-color');
        expect(DEFAULT_CSS).not.toMatch(/var\(--ax-scrollbar-part-(opacity|slide|alpha)/);
    });

    test('read no per-part host token and draw no card shadow of their own', () => {
        expect(DEFAULT_CSS).not.toMatch(/--ax-scrollbar-(thumb|button|track|corner|marker|card)-(color|radius|border|size|shadow|text|lines|font)/);
        expect(DEFAULT_CSS).not.toContain('drop-shadow');
        expect(DEFAULT_CSS).not.toContain('box-shadow');
        expect(CARD_CSS).toContain('--elevation-depth');
    });

    test('the scrollbar shadow root is structure and placement: no look input and no colour', () => {
        expect(SHADOW_STYLE).not.toMatch(/--ax-scrollbar-(part|shown)-/);
        expect(SHADOW_STYLE).not.toMatch(/--ax-(fill|border)-color|--elevation|opacity|background/);
    });
});
