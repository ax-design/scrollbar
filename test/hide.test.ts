import { describe, expect, test } from 'bun:test';
import { HideList } from '../src/hide.js';

describe('HideList', () => {
    test('a part name hides it with every indicator', () => {
        const list = new HideList('button corner');
        expect(list.hidden('button', 'mouse')).toBe(true);
        expect(list.hidden('button', 'touch')).toBe(true);
        expect(list.hidden('corner', 'touch')).toBe(true);
        expect(list.hidden('thumb', 'mouse')).toBe(false);
    });

    test('part:indicator hides it with that indicator only, and tokens add up', () => {
        const list = new HideList('button:touch  track:touch track:mouse thumb:touch');
        expect(list.hidden('button', 'touch')).toBe(true);
        expect(list.hidden('button', 'mouse')).toBe(false);
        expect(list.hidden('track', 'mouse')).toBe(true);
        expect(list.hidden('thumb', 'mouse')).toBe(false);
        expect(list.hidden('thumb', 'touch')).toBe(true);
    });

    test('unknown parts and qualifiers are left out', () => {
        const list = new HideList('buttons thumb:none marker:touch:mouse card:mouse input:touch');
        expect(list.hidden('button', 'mouse')).toBe(false);
        expect(list.hidden('thumb', 'mouse')).toBe(false);
        expect(list.hidden('marker', 'touch')).toBe(false);
        expect(list.hidden('card', 'mouse')).toBe(true);
    });

    test('an empty list hides nothing', () => {
        const list = new HideList('');
        expect(['thumb', 'button', 'track', 'track-piece', 'corner', 'marker', 'card'].some((p) => list.hidden(p as never, 'mouse'))).toBe(false);
    });
});
