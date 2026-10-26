import { test, expect } from 'bun:test';
import {
    layoutAxis,
    thumbOffsetAt,
    dragTo,
    jumpTo,
    layoutAt,
    pageDirection,
    pageStep,
    markerAnchor,
    markerOffset,
    physical,
    placeCard,
    parseTimes,
    longestTiming,
    snap,
    snapLayout,
} from '../src/geometry.js';

// Content 1000 px, viewport 200 px, track 200 px: max 800, proportional thumb 40 px.
const base = { client: 200, size: 1000, position: 0, track: 200, minThumb: 0 };

test('a non-scrollable axis fills the track and has no travel', () => {
    const l = layoutAxis({ client: 300, size: 300, position: 0, track: 200, minThumb: 20 });
    expect(l.scrollable).toBe(false);
    expect(l.max).toBe(0);
    expect(l.thumbLength).toBe(200);
    expect(l.thumbOffset).toBe(0);
    expect(l.travel).toBe(0);
    expect(l.ratio).toBe(0);
});

test('a sub-pixel overflow does not count as scrollable', () => {
    const l = layoutAxis({ client: 300, size: 300.3, position: 0, track: 200, minThumb: 0 });
    expect(l.scrollable).toBe(false);
});

test('the thumb is proportional to the visible part', () => {
    const l = layoutAxis(base);
    expect(l.scrollable).toBe(true);
    expect(l.max).toBe(800);
    expect(l.thumbLength).toBe(40);
    expect(l.travel).toBe(160);
    expect(l.ratio).toBe(5);
});

test('the minimum thumb wins over the proportional length', () => {
    const l = layoutAxis({ ...base, minThumb: 60 });
    expect(l.thumbLength).toBe(60);
    expect(l.travel).toBe(140);
});

test('the minimum thumb never exceeds the track', () => {
    const l = layoutAxis({ ...base, minThumb: 500 });
    expect(l.thumbLength).toBe(200);
    expect(l.travel).toBe(0);
    expect(l.thumbOffset).toBe(0);
    expect(l.ratio).toBe(0);
});

test('a track of zero or less gives a zero thumb', () => {
    expect(layoutAxis({ ...base, track: 0 }).thumbLength).toBe(0);
    expect(layoutAxis({ ...base, track: -5, minThumb: 10 }).thumbLength).toBe(0);
});

test('thumb offset at the start, the middle and the end', () => {
    expect(layoutAxis({ ...base, position: 0 }).thumbOffset).toBe(0);
    expect(layoutAxis({ ...base, position: 400 }).thumbOffset).toBe(80);
    expect(layoutAxis({ ...base, position: 800 }).thumbOffset).toBe(160);
});

test('overscroll is clamped to [0, max]', () => {
    const under = layoutAxis({ ...base, position: -50 });
    expect(under.position).toBe(0);
    expect(under.thumbOffset).toBe(0);
    const over = layoutAxis({ ...base, position: 900 });
    expect(over.position).toBe(800);
    expect(over.thumbOffset).toBe(160);
});

test('thumbOffsetAt clamps and matches the layout offset', () => {
    const l = layoutAxis(base);
    expect(thumbOffsetAt(l, 400)).toBe(80);
    expect(thumbOffsetAt(l, -10)).toBe(0);
    expect(thumbOffsetAt(l, 10000)).toBe(160);
});

test('dragTo follows the pointer and clamps', () => {
    const l = layoutAxis(base);
    // 8 px of thumb is 40 px of content.
    expect(dragTo(l, 0, 8)).toBe(40);
    expect(dragTo(l, 0, -8)).toBe(0);
    expect(dragTo(l, 790, 100)).toBe(800);
});

test('dragTo round trip: the thumb ends where the pointer moved it', () => {
    const l = layoutAxis(base);
    const position = dragTo(l, 200, 30);
    expect(position).toBe(350);
    expect(thumbOffsetAt(l, position)).toBe(70);
    // Dragging the same distance back returns to the start position.
    expect(dragTo(l, position, -30)).toBe(200);
});

test('pageDirection before, on and after the thumb', () => {
    const l = layoutAxis({ ...base, position: 400 }); // thumb at 80 .. 120
    expect(pageDirection(l, 79)).toBe(-1);
    expect(pageDirection(l, 0)).toBe(-1);
    expect(pageDirection(l, 80)).toBe(0);
    expect(pageDirection(l, 100)).toBe(0);
    expect(pageDirection(l, 119.9)).toBe(0);
    expect(pageDirection(l, 120)).toBe(1);
    expect(pageDirection(l, 200)).toBe(1);
});

test('pageStep keeps a line of the old view', () => {
    expect(pageStep(200, 20)).toBe(180);
    expect(pageStep(30, 20)).toBe(20);
});

test('markerAnchor clamps to the scroll range', () => {
    expect(markerAnchor(100, 200, 800, 0)).toBe(100);
    expect(markerAnchor(100, 200, 800, 0.5)).toBe(0);
    expect(markerAnchor(50, 200, 800, 0.5)).toBe(0);
    expect(markerAnchor(990, 200, 800, 0)).toBe(800);
    expect(markerAnchor(990, 200, 800, 0.5)).toBe(800);
    expect(markerAnchor(500, 200, 800, 0.5)).toBe(400);
});

test('markerOffset meets the thumb start when aligned to the start', () => {
    const l = layoutAxis({ ...base, position: 300 });
    const anchor = markerAnchor(600, 200, l.max, 0);
    expect(anchor).toBe(600);
    expect(markerOffset(l, anchor, 0)).toBe(thumbOffsetAt(l, anchor));
    expect(markerOffset(l, anchor, 0)).toBe(120);
});

test('markerOffset meets the thumb centre when aligned to the centre', () => {
    const l = layoutAxis({ ...base, position: 300 });
    const anchor = markerAnchor(600, 200, l.max, 0.5);
    expect(anchor).toBe(500);
    // The thumb centre is 20 px into the thumb: 100 + 20.
    expect(thumbOffsetAt(l, anchor)).toBe(100);
    expect(markerOffset(l, anchor, 0.5)).toBe(120);
});

test('physical is the start edge in LTR and mirrored in RTL', () => {
    expect(physical(30, 10, 200, false)).toBe(30);
    expect(physical(30, 10, 200, true)).toBe(160);
    expect(physical(0, 200, 200, true)).toBe(0);
    expect(physical(0, 200, 200, false)).toBe(0);
});

const card = { width: 100, height: 50 };
const view = { width: 1000, height: 800 };

test('placeCard: left of the point', () => {
    expect(placeCard({ x: 500, y: 400 }, card, 'left', 10, view, 8)).toEqual({ left: 390, top: 375 });
});

test('placeCard: right of the point', () => {
    expect(placeCard({ x: 500, y: 400 }, card, 'right', 10, view, 8)).toEqual({ left: 510, top: 375 });
});

test('placeCard: above the point', () => {
    expect(placeCard({ x: 500, y: 400 }, card, 'above', 10, view, 8)).toEqual({ left: 450, top: 340 });
});

test('placeCard: below the point', () => {
    expect(placeCard({ x: 500, y: 400 }, card, 'below', 10, view, 8)).toEqual({ left: 450, top: 410 });
});

test('placeCard: clamps on the left, right, top and bottom edges', () => {
    // Left of a point at the left edge would go off screen.
    expect(placeCard({ x: 5, y: 400 }, card, 'left', 10, view, 8)).toEqual({ left: 8, top: 375 });
    // Right of a point at the right edge.
    expect(placeCard({ x: 995, y: 400 }, card, 'right', 10, view, 8)).toEqual({ left: 892, top: 375 });
    // Above a point at the top edge.
    expect(placeCard({ x: 500, y: 5 }, card, 'above', 10, view, 8)).toEqual({ left: 450, top: 8 });
    // Below a point at the bottom edge.
    expect(placeCard({ x: 500, y: 795 }, card, 'below', 10, view, 8)).toEqual({ left: 450, top: 742 });
});

test('placeCard: a card larger than the viewport sits at the start margin', () => {
    const big = { width: 1200, height: 900 };
    expect(placeCard({ x: 500, y: 400 }, big, 'below', 10, view, 8)).toEqual({ left: 8, top: 8 });
});

test('placeCard rounds to whole px', () => {
    const out = placeCard({ x: 500.4, y: 400.2 }, { width: 101, height: 51 }, 'right', 10.3, view, 8);
    expect(Number.isInteger(out.left)).toBe(true);
    expect(Number.isInteger(out.top)).toBe(true);
    expect(out).toEqual({ left: 511, top: 375 });
});

test('parseTimes reads s and ms', () => {
    expect(parseTimes('0.2s')).toEqual([200]);
    expect(parseTimes('150ms, 1s')).toEqual([150, 1000]);
    expect(parseTimes('.5S')).toEqual([500]);
});

test('parseTimes counts junk and empty entries as 0', () => {
    expect(parseTimes('abc, 10, 0.1x, 2s')).toEqual([0, 0, 0, 2000]);
    expect(parseTimes('')).toEqual([0]);
});

test('longestTiming with equal lists', () => {
    expect(longestTiming('0.2s, 0.5s', '0s, 100ms')).toBe(600);
});

test('longestTiming repeats a shorter delay list', () => {
    // 0.2s + 100ms, 0.5s + 0ms (the list wraps), 1s + 100ms.
    expect(longestTiming('0.2s, 0.5s, 1s', '100ms')).toBe(1100);
    // 0.2s + 300ms, 0.5s + 100ms.
    expect(longestTiming('0.2s, 0.5s', '300ms, 100ms')).toBe(600);
});

test('longestTiming with a longer delay list ignores the extra delays', () => {
    expect(longestTiming('0.2s', '1s, 5s')).toBe(1200);
});

test('longestTiming of no transition is 0', () => {
    expect(longestTiming('0s', '0s')).toBe(0);
});

test('snap puts edges on the device-pixel grid of a fractional origin', () => {
    // 10.3 from an origin at 0.5 is 10.8 on screen: the nearest pixel edge is 11, so 10.5.
    expect(snap(10.3, 0.5, 1)).toBe(10.5);
    expect(snap(10.3, 0, 2)).toBe(10.5);
    const layout = layoutAxis({ client: 100, size: 1000, position: 333, track: 97, minThumb: 0 });
    const snapped = snapLayout(layout, 0.25, 1);
    expect((snapped.thumbOffset + 0.25) % 1).toBe(0);
    expect((snapped.thumbOffset + snapped.thumbLength + 0.25) % 1).toBe(0);
});

test('layoutAt moves the thumb to a position and clamps it', () => {
    const l = layoutAxis(base);
    const at = layoutAt(l, 400);
    expect(at.position).toBe(400);
    expect(at.thumbOffset).toBe(80);
    expect(at.thumbLength).toBe(l.thumbLength);
    expect(layoutAt(l, 5000).thumbOffset).toBe(160);
    expect(layoutAt(l, -10).thumbOffset).toBe(0);
});

test('a page repeat decides by where the glide is heading', () => {
    const l = layoutAxis(base);
    // Pointer at 100 on the track: from the start the thumb (0..40) is before it; at a goal of
    // 400 (thumb 80..120) it covers it, so the repeat stops before the scroll gets there.
    expect(pageDirection(l, 100)).toBe(1);
    expect(pageDirection(layoutAt(l, 400), 100)).toBe(0);
});

test('jumpTo centres the thumb on the pointer and clamps', () => {
    const l = layoutAxis(base);
    // Thumb 40 px, ratio 800 / 160 = 5: centre at 100 means the thumb starts at 80.
    expect(jumpTo(l, 100)).toBe(400);
    expect(layoutAt(l, jumpTo(l, 100)).thumbOffset + l.thumbLength / 2).toBe(100);
    expect(jumpTo(l, 5)).toBe(0);
    expect(jumpTo(l, 199)).toBe(800);
    expect(jumpTo(layoutAxis({ client: 300, size: 300, position: 0, track: 200, minThumb: 0 }), 150)).toBe(0);
});
