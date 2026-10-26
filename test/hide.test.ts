import { describe, expect, test } from 'bun:test';
import { DEFAULT_HIDE, HideList } from '../src/hide.js';

describe('HideList', () => {
    test('a part name hides it, and names add up', () => {
        const list = new HideList('button  corner');
        expect(list.hidden('button')).toBe(true);
        expect(list.hidden('corner')).toBe(true);
        expect(list.hidden('thumb')).toBe(false);
    });

    test('unknown names and qualifiers are left out', () => {
        const list = new HideList('buttons thumb:touch marker:mouse input card');
        expect(list.hidden('button')).toBe(false);
        expect(list.hidden('thumb')).toBe(false);
        expect(list.hidden('marker')).toBe(false);
        expect(list.hidden('card')).toBe(true);
    });

    test('an empty list hides nothing, and it is the default', () => {
        expect(DEFAULT_HIDE).toBe('');
        const list = new HideList(DEFAULT_HIDE);
        expect(['thumb', 'button', 'track', 'track-piece', 'corner', 'marker', 'card'].some((p) => list.hidden(p as never))).toBe(false);
    });
});
