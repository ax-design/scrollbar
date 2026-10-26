// Scroll and track math for the scrollbars. Pure functions, no DOM: every number that a bar
// shows or a pointer moves is computed here, so it can be tested without a browser.
//
// All positions are logical (see types.ts): 0 is the start of the content along the axis. Only
// physical() turns them into a left or top edge.
import type { Placement } from './types.js';

export interface AxisMetrics {
    client: number; // visible length of the scroller along the axis
    size: number; // scroll length (scrollHeight / scrollWidth)
    position: number; // logical scroll position
    track: number; // length of the track area in px
    minThumb: number; // minimum thumb length in px (author CSS), may be 0
}

export interface AxisLayout {
    scrollable: boolean; // max > 0.5
    max: number; // max(0, size - client)
    position: number; // position clamped to [0, max]
    track: number;
    thumbLength: number;
    thumbOffset: number; // logical offset of the thumb start inside the track
    travel: number; // track - thumbLength
    ratio: number; // scroll px per px of thumb travel (0 when travel is 0)
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), high);
}

// Offset of the thumb for a position that is already within [0, max].
function offsetFor(position: number, max: number, travel: number): number {
    return max > 0 && travel > 0 ? (position / max) * travel : 0;
}

export function layoutAxis(m: AxisMetrics): AxisLayout {
    const max = Math.max(0, m.size - m.client);
    // A half pixel of slack: fractional sizes from layout must not show a bar that cannot scroll.
    const scrollable = max > 0.5;
    const position = clamp(m.position, 0, max);
    let thumbLength: number;
    if (m.track <= 0) {
        thumbLength = 0;
    } else if (!scrollable) {
        // Nothing to scroll: the thumb fills the track, as native bars do.
        thumbLength = m.track;
    } else {
        // The minimum wins over the proportional length, but never beyond the track itself.
        const proportional = (m.track * m.client) / Math.max(m.size, 1);
        thumbLength = clamp(proportional, Math.min(m.minThumb, m.track), m.track);
    }
    const travel = m.track - thumbLength;
    return {
        scrollable,
        max,
        position,
        track: m.track,
        thumbLength,
        thumbOffset: offsetFor(position, max, travel),
        travel,
        ratio: travel > 0 ? max / travel : 0,
    };
}

export function thumbOffsetAt(layout: AxisLayout, position: number): number {
    return offsetFor(clamp(position, 0, layout.max), layout.max, layout.travel);
}

// The layout with the scroll at `position`, for a glide that is still on its way there.
export function layoutAt(layout: AxisLayout, position: number): AxisLayout {
    const at = clamp(position, 0, layout.max);
    return { ...layout, position: at, thumbOffset: thumbOffsetAt(layout, at) };
}

// The scroll position that puts the centre of the thumb at `along` on the track.
export function jumpTo(layout: AxisLayout, along: number): number {
    return clamp((along - layout.thumbLength / 2) * layout.ratio, 0, layout.max);
}

// Pointer drag: the thumb follows the pointer, so one px of thumb is `ratio` px of content.
export function dragTo(layout: AxisLayout, startPosition: number, pointerDelta: number): number {
    return clamp(startPosition + pointerDelta * layout.ratio, 0, layout.max);
}

// A press on the track pages toward the pointer, unless it is on the thumb.
export function pageDirection(layout: AxisLayout, along: number): -1 | 0 | 1 {
    if (along < layout.thumbOffset) return -1;
    if (along >= layout.thumbOffset + layout.thumbLength) return 1;
    return 0;
}

// Windows keeps one line of the old view on screen when it pages.
export function pageStep(client: number, line: number): number {
    return Math.max(line, client - line);
}

// Scroll position that puts the marker at the alignment point of the viewport: 0 for the start
// edge, 0.5 for the centre.
export function markerAnchor(contentPosition: number, client: number, max: number, align: number): number {
    return clamp(contentPosition - client * align, 0, max);
}

// Where a marker sits on the track, so it meets the matching point of the thumb when its target
// is aligned.
export function markerOffset(layout: AxisLayout, anchor: number, align: number): number {
    return thumbOffsetAt(layout, anchor) + layout.thumbLength * align;
}

// Start edge in physical px. Right-to-left scrollers count their logical start from the right.
export function physical(logical: number, length: number, track: number, rtl: boolean): number {
    return rtl ? track - logical - length : logical;
}

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

// Position of a card next to a point on the bar. The card is pushed back inside the viewport
// when it would leave it; if it cannot fit at all, the start margin wins.
export function placeCard(
    point: { x: number; y: number },
    size: { width: number; height: number },
    placement: Placement,
    gap: number,
    viewport: { width: number; height: number },
    margin: number
): { left: number; top: number } {
    let left: number;
    let top: number;
    if (placement === 'left') {
        left = point.x - gap - size.width;
        top = point.y - size.height / 2;
    } else if (placement === 'right') {
        left = point.x + gap;
        top = point.y - size.height / 2;
    } else if (placement === 'above') {
        left = point.x - size.width / 2;
        top = point.y - gap - size.height;
    } else {
        left = point.x - size.width / 2;
        top = point.y + gap;
    }
    // Upper bound first, then the lower bound, so a card larger than the viewport sits at the start.
    left = Math.max(margin, Math.min(left, viewport.width - margin - size.width));
    top = Math.max(margin, Math.min(top, viewport.height - margin - size.height));
    return { left: Math.round(left), top: Math.round(top) };
}

// One CSS time, in ms. Anything that is not a number with s or ms counts as 0.
function parseTime(text: string): number {
    const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/i.exec(text.trim());
    if (!match) return 0;
    const value = parseFloat(match[1]);
    return match[2].toLowerCase() === 's' ? value * 1000 : value;
}

// A CSS time list ("0.2s, 150ms") in ms, one number per entry.
export function parseTimes(list: string): number[] {
    return list.split(',').map(parseTime);
}

// When the last transition or animation ends. CSS repeats a shorter delay list to match the
// durations, which is why the index wraps.
export function longestTiming(durations: string, delays: string): number {
    const duration = parseTimes(durations);
    const delay = parseTimes(delays);
    let longest = 0;
    for (let i = 0; i < duration.length; i++) {
        const end = duration[i] + (delay.length ? delay[i % delay.length] : 0);
        if (end > longest) longest = end;
    }
    return longest;
}

// A length on a device-pixel grid whose origin sits at `origin` px on screen, for themes drawn
// pixel by pixel (images on a fractional edge are blurred). `dpr` is the device pixel ratio.
export function snap(value: number, origin: number, dpr: number): number {
    return Math.round((origin + value) * dpr) / dpr - origin;
}

// The layout with both thumb edges on the device-pixel grid.
export function snapLayout(layout: AxisLayout, origin: number, dpr: number): AxisLayout {
    const start = snap(layout.thumbOffset, origin, dpr);
    const end = snap(layout.thumbOffset + layout.thumbLength, origin, dpr);
    return { ...layout, thumbOffset: start, thumbLength: end - start };
}
