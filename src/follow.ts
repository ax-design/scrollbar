// The displayed thumb and markers chase the real layout, as the reference scrollbar lerps them.
// Pure functions, no DOM.
import { chase } from '@ax-design/scroll';

// Time in ms in which about 63% of what is left is closed. The reference closes 15% per 60 Hz
// frame: -16.7 / ln(0.85) is about 100.
export const FOLLOW_TAU = 100;
// Within this distance in px a displayed value lands on its target and stops moving.
export const SETTLE = 0.01;

// The displayed value `dt` ms after `from`, on its way to `to`. A tau of 0 or less is immediate.
export function follow(from: number, to: number, dt: number, tau: number): number {
    if (tau <= 0) return to;
    const next = chase(from, to, dt, tau);
    return Math.abs(to - next) <= SETTLE ? to : next;
}

// A displayed thumb: its offset and length along the track.
export interface Shown {
    offset: number;
    length: number;
}

// The next displayed thumb toward `offset` and `length`; null `from` (nothing shown yet) lands.
export function followThumb(from: Shown | null, offset: number, length: number, dt: number, tau: number): Shown {
    if (!from) return { offset, length };
    return { offset: follow(from.offset, offset, dt, tau), length: follow(from.length, length, dt, tau) };
}
