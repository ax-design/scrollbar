// MarkerSet: the marker elements of one bar. Each marker sits in a zero-size slot that is moved
// along the track; the marker itself is a part element, styled by its state tokens.
import type { BarState } from './bar.js';
import { follow } from './follow.js';
import { markerAnchor, markerOffset, physical, snap } from './geometry.js';
import type { AxisLayout } from './geometry.js';
import { createPart } from './kits.js';
import type { PartClass } from './parts/part.js';
import { Piece } from './piece.js';
import type { ScrollTarget } from './target.js';
import type { Axis, ScrollMarker } from './types.js';

export interface PlacedMarker {
    marker: ScrollMarker;
    contentPosition: number; // logical px in scroll coordinates
    anchor: number;          // scroll position that aligns it (geometry.markerAnchor)
    offset: number;          // logical centre on the track (geometry.markerOffset), for hit tests
    shown: number | null;    // the centre drawn, on its way to `offset`; null before the first draw
    part: Piece;             // the .marker element
    slot: HTMLElement;       // the .slot element
    // Markers closer than the spacing share one mark: the first of them leads and carries all of
    // them (itself first); the others are not drawn and not hit. For a marker alone: [itself].
    members: PlacedMarker[];
    leader: boolean;
}

// Moves a state from one marker to another (or to none).
function moveState(from: PlacedMarker | null, to: PlacedMarker | null, key: 'hover' | 'pressed'): void {
    if (from === to) return;
    if (from) from.part.set({ [key]: false });
    if (to) to.part.set({ [key]: true });
}

export class MarkerSet {
    readonly list: PlacedMarker[] = [];
    private readonly axis: Axis;
    private readonly container: HTMLElement;
    private readonly byId = new Map<string, PlacedMarker>();
    // The slot transform last written, compared as a string: the browser normalises the style value,
    // so reading it back would not match.
    private readonly transforms = new Map<PlacedMarker, string>();
    private hovered: PlacedMarker | null = null;
    private pressed: PlacedMarker | null = null;

    private readonly cls: PartClass;

    constructor(axis: Axis, container: HTMLElement, cls: PartClass) {
        this.axis = axis;
        this.container = container;
        this.cls = cls;
    }

    set(markers: ScrollMarker[]): void {
        const next: PlacedMarker[] = [];
        const seen = new Set<string>();
        for (const marker of markers) {
            if ((marker.axis ?? 'vertical') !== this.axis || seen.has(marker.id)) continue;
            seen.add(marker.id);
            let placed = this.byId.get(marker.id);
            if (!placed) placed = this.create(marker);
            placed.marker = marker;
            next.push(placed);
        }
        for (const placed of this.byId.values()) {
            if (!seen.has(placed.marker.id)) this.remove(placed);
        }
        this.list.splice(0, this.list.length, ...next);
    }

    // Reads each marker's position in the content. Sorts the list, so the order is the content order.
    measure(target: ScrollTarget): void {
        for (const placed of this.list) {
            const { element, position } = placed.marker;
            placed.contentPosition = element ? target.contentOffset(element, this.axis) : (position ?? 0);
        }
        this.list.sort((a, b) => a.contentPosition - b.contentPosition);
    }

    // The marks: one per group of markers (see PlacedMarker.members), in track order.
    get marks(): PlacedMarker[] {
        return this.list.filter((placed) => placed.leader);
    }

    // Where each marker belongs on the track, and which ones share a mark: markers closer than
    // `spacing` px on the track merge, so that two marks never overlap (a hovered one would show
    // above or below the other). The drawn place follows it (see draw). The list is in content
    // order, so the offsets only grow.
    place(layout: AxisLayout, client: number, align: number, spacing: number): void {
        let group: PlacedMarker[] = [];
        const close = () => {
            if (!group.length) return;
            const leader = group[0];
            // A merged mark sits in the middle of its markers; it scrolls to the first one.
            leader.offset = group.reduce((sum, m) => sum + m.offset, 0) / group.length;
            leader.members = group;
            group.forEach((m, i) => {
                m.leader = i === 0;
                if (i) m.members = [m];
                const display = i ? 'none' : '';
                if (m.slot.style.display !== display) m.slot.style.display = display;
            });
            group = [];
        };
        for (const placed of this.list) {
            placed.anchor = markerAnchor(placed.contentPosition, client, layout.max, align);
            placed.offset = markerOffset(layout, placed.anchor, align);
            const last = group[group.length - 1];
            if (last && placed.offset - last.offset >= spacing) close();
            group.push(placed);
        }
        close();
    }

    // Moves the drawn markers `dt` ms closer to their places (tau 0: there at once). `origin` is
    // the screen position of the track start when markers snap to device pixels. Returns whether
    // a marker is still on its way.
    draw(dt: number, tau: number, track: number, rtl: boolean, origin: number | null = null): boolean {
        const dpr = window.devicePixelRatio || 1;
        let moving = false;
        for (const placed of this.marks) {
            const shown = placed.shown === null ? placed.offset : follow(placed.shown, placed.offset, dt, tau);
            placed.shown = shown;
            if (shown !== placed.offset) moving = true;
            const at = origin === null ? shown : snap(shown, origin, dpr);
            // Snapped markers use 2D translates, like the thumb (see Bar.render).
            const along = this.axis === 'vertical' ? at : physical(at, 0, track, rtl);
            const transform =
                origin !== null
                    ? this.axis === 'vertical' ? `translate(0, ${along}px)` : `translate(${along}px, 0)`
                    : this.axis === 'vertical' ? `translate3d(0, ${along}px, 0)` : `translate3d(${along}px, 0, 0)`;
            // Writes only on change: a slot that does not move costs no style recalculation.
            if (this.transforms.get(placed) === transform) continue;
            this.transforms.set(placed, transform);
            placed.slot.style.transform = transform;
        }
        return moving;
    }

    // `layout` is the drawn one: a marker is on the thumb where both are drawn.
    updateTokens(layout: AxisLayout): void {
        // The last mark the scroll has reached (one pixel of slack for rounding) is the current one;
        // a merged mark has been reached when any of its markers has.
        let current: PlacedMarker | null = null;
        for (const placed of this.marks) {
            if (placed.anchor <= layout.position + 1) current = placed;
        }
        const thumbEnd = layout.thumbOffset + layout.thumbLength;
        for (const placed of this.marks) {
            const at = placed.shown === null ? placed.offset : placed.shown;
            placed.part.set({ onThumb: at >= layout.thumbOffset && at <= thumbEnd, current: placed === current });
        }
    }

    // The nearest marker centre within reach wins, so overlapping markers resolve to the closest.
    hit(along: number, reach: number): PlacedMarker | null {
        let best: PlacedMarker | null = null;
        let bestDistance = Infinity;
        for (const placed of this.marks) {
            const distance = Math.abs(along - placed.offset);
            if (distance <= reach && distance < bestDistance) {
                best = placed;
                bestDistance = distance;
            }
        }
        return best;
    }

    setHover(m: PlacedMarker | null): void {
        moveState(this.hovered, m, 'hover');
        this.hovered = m;
    }

    setPressed(m: PlacedMarker | null): void {
        moveState(this.pressed, m, 'pressed');
        this.pressed = m;
    }

    flush(shared: BarState): void {
        for (const placed of this.list) {
            placed.part.set(shared);
            placed.part.flush();
        }
    }

    private create(marker: ScrollMarker): PlacedMarker {
        const part = new Piece(createPart(this.cls), ['marker', 'marker-' + this.axis], 'marker', 'marker', this.axis);
        part.el.setAttribute('data-id', marker.id);
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.appendChild(part.el);
        this.container.appendChild(slot);
        const placed: PlacedMarker = { marker, contentPosition: 0, anchor: 0, offset: 0, shown: null, part, slot, members: [], leader: true };
        placed.members = [placed];
        this.byId.set(marker.id, placed);
        return placed;
    }

    private remove(placed: PlacedMarker): void {
        placed.slot.remove();
        this.byId.delete(placed.marker.id);
        this.transforms.delete(placed);
        if (this.hovered === placed) this.hovered = null;
        if (this.pressed === placed) this.pressed = null;
    }
}
