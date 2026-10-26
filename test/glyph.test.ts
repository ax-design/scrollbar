import { describe, expect, test } from 'bun:test';
import { chevron, roundedPath } from '../src/parts/glyph.js';

const box = (points: { x: number; y: number }[]) => ({
    left: Math.min(...points.map((p) => p.x)),
    right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
});

describe('chevron', () => {
    test('six points in a box of the width and height, centred when there is no offset', () => {
        const points = chevron(10, 20, { width: 8, height: 4, thickness: 2, offset: null }, 'up');
        expect(points.length).toBe(6);
        expect(box(points)).toEqual({ left: 1, right: 9, top: 8, bottom: 12 });
        // The inner tip is the thickness below the tip.
        expect(points[3].y - points[0].y).toBe(2);
    });

    test('the tip points the way of the direction', () => {
        const tip = (d: 'up' | 'down' | 'left' | 'right') => chevron(10, 10, { width: 8, height: 4, thickness: 2, offset: null }, d)[0];
        expect(tip('up')).toEqual({ x: 5, y: 3 });
        expect(tip('down')).toEqual({ x: 5, y: 7 });
        expect(tip('left')).toEqual({ x: 3, y: 5 });
        expect(tip('right')).toEqual({ x: 7, y: 5 });
    });

    test('the offset is from the edge next to the track: the Windows 8 arrows', () => {
        const win8 = { width: 10.944, height: 9.673, thickness: 4.118, offset: 7 };
        const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
        const up = box(chevron(17, 33, win8, 'up'));
        near(up.left, (17 - 10.944) / 2);
        near(up.top, 33 - 7 - 9.673);
        const down = box(chevron(17, 33, win8, 'down'));
        near(down.top, 7);
        const left = box(chevron(33, 17, win8, 'left'));
        near(left.left, 33 - 7 - 9.673);
        near(left.top, (17 - 10.944) / 2);
        const right = box(chevron(33, 17, win8, 'right'));
        near(right.left, 7);
    });

    test('the arms are no thicker than the chevron is deep', () => {
        const points = chevron(10, 10, { width: 8, height: 2, thickness: 5, offset: null }, 'up');
        expect(points[3].y).toBe(points[2].y);
    });
});

describe('triangle glyph and scale', () => {
    const caret = { width: 8, height: 4, thickness: 2, offset: null, shape: 'triangle' as const };

    test('a triangle has three points: the tip, and a base of the width', () => {
        const points = chevron(10, 20, caret, 'up');
        expect(points).toEqual([
            { x: 5, y: 8 },
            { x: 9, y: 12 },
            { x: 1, y: 12 },
        ]);
    });

    test('a triangle points the way of the direction, like the chevron', () => {
        const tip = (d: 'up' | 'down' | 'left' | 'right') => chevron(10, 10, caret, d)[0];
        expect(tip('up')).toEqual({ x: 5, y: 3 });
        expect(tip('down')).toEqual({ x: 5, y: 7 });
        expect(tip('left')).toEqual({ x: 3, y: 5 });
        expect(tip('right')).toEqual({ x: 7, y: 5 });
    });

    test('the offset of a triangle is from the edge next to the track (its base)', () => {
        const points = chevron(12, 15, { ...caret, offset: 5.5 }, 'up');
        expect(box(points).bottom).toBeCloseTo(15 - 5.5, 9);
        const down = chevron(12, 15, { ...caret, offset: 5.5 }, 'down');
        expect(box(down).top).toBeCloseTo(5.5, 9);
    });

    test('the scale shrinks the glyph about the centre of its box', () => {
        const full = box(chevron(10, 20, caret, 'up'));
        const small = box(chevron(10, 20, { ...caret, scale: 0.875 }, 'up'));
        expect((small.left + small.right) / 2).toBeCloseTo((full.left + full.right) / 2, 9);
        expect((small.top + small.bottom) / 2).toBeCloseTo((full.top + full.bottom) / 2, 9);
        expect(small.right - small.left).toBeCloseTo(8 * 0.875, 9);
        expect(small.bottom - small.top).toBeCloseTo(4 * 0.875, 9);
        // 1 and no scale are the same.
        expect(chevron(10, 20, { ...caret, scale: 1 }, 'up')).toEqual(chevron(10, 20, caret, 'up'));
    });

    test('a chevron scales too', () => {
        const chev = { width: 8, height: 4, thickness: 2, offset: null };
        const small = box(chevron(10, 20, { ...chev, scale: 0.5 }, 'up'));
        expect(small.right - small.left).toBeCloseTo(4, 9);
    });
});

describe('roundedPath', () => {
    const triangle = chevron(20, 20, { width: 7, height: 4, thickness: 0, offset: null, shape: 'triangle' }, 'up');
    const arcs = (d: string) => [...d.matchAll(/A([\d.]+) ([\d.]+) 0 0 ([01]) ([\d.-]+) ([\d.-]+)/g)];

    test('a radius of 0 is the plain polygon', () => {
        expect(roundedPath(triangle, 0)).toBe('M10 8L13.5 12L6.5 12Z');
    });

    test('a 7 x 4 triangle with 1px corners: one arc per vertex, closed, filled outline', () => {
        const d = roundedPath(triangle, 1);
        const found = arcs(d);
        expect(found.length).toBe(3);
        expect(d.endsWith('Z')).toBe(true);
        // Tangent arcs: the radius is as asked wherever the edges are long enough.
        for (const a of found) expect(Number(a[1])).toBeCloseTo(1, 3);
        // Every arc turns the same way (a convex outline).
        expect(new Set(found.map((a) => a[3])).size).toBe(1);
        // The apex is cut: the path no longer reaches the tip (10, 8) but stays inside the triangle's box.
        const xs = [...d.matchAll(/[MLA][^MLAZ]*?(-?[\d.]+) (-?[\d.]+)(?=[MLAZ])/g)].map((m) => [Number(m[1]), Number(m[2])]);
        expect(Math.min(...xs.map((p) => p[1]))).toBeGreaterThan(8);
        expect(Math.min(...xs.map((p) => p[0]))).toBeGreaterThanOrEqual(6.5);
        expect(Math.max(...xs.map((p) => p[0]))).toBeLessThanOrEqual(13.5);
    });

    test('the arc of a corner starts and ends on its edges, at the tangent distance', () => {
        const d = roundedPath(triangle, 1);
        // Apex (10, 8): half angle atan(3.5 / 4), tangent distance r / tan(half angle) = 4 / 3.5 along each edge.
        const reach = 4 / 3.5;
        const edge = Math.hypot(3.5, 4);
        const start = { x: 10 - (3.5 / edge) * reach, y: 8 + (4 / edge) * reach };
        expect(d.startsWith(`M${Math.round(start.x * 1000) / 1000} ${Math.round(start.y * 1000) / 1000}`)).toBe(true);
    });

    test('a radius too large for the edges is reduced, never overlapping', () => {
        const d = roundedPath(triangle, 50);
        for (const a of arcs(d)) expect(Number(a[1])).toBeLessThan(5);
    });

    test('the rounded glyph is mirrored by direction with the right sweep', () => {
        const left = chevron(20, 20, { width: 7, height: 4, thickness: 0, offset: null, shape: 'triangle' }, 'left');
        const sweeps = (d: string) => new Set(arcs(d).map((a) => a[3]));
        expect(sweeps(roundedPath(left, 1)).size).toBe(1);
        // A reflection flips the orientation of the outline, and with it the sweep.
        expect(sweeps(roundedPath(left, 1))).not.toEqual(sweeps(roundedPath(triangle, 1)));
    });
});
