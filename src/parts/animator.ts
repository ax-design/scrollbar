// The animator of a part's look: each visual value approaches its target exponentially, as the
// reference scrollbar lerps them every frame, but by a time constant so the speed does not depend
// on the frame rate. Pure, no DOM: the part reads the targets and writes the values.
import type { Rgba } from '@ax-design/typed-om';
import { follow } from '../follow.js';

// What a part looks like in one state: its fill, border and glyph colours, its size across the
// axis and along it (px; a thickness left out is the size), its opacity, and how far it is slid
// toward the outer edge of the bar (px). A border or glyph left out is transparent.
export interface Look {
    color: Rgba;
    border?: Rgba;
    glyph?: Rgba;
    size: number;
    thickness?: number;
    opacity: number;
    // A second opacity that follows the state smoothing (a marker's own opacity input); 1 if left out.
    alpha?: number;
    // The scale of the glyph (a pressed button's arrow); 1 if left out.
    glyphScale?: number;
    slide: number;
}

// Time constants in ms of the three channels: colours and size, opacity, slide. 0 is immediate.
// fadeIn and fadeOut, when above 0, are the durations of a linear fade in ms, which then replaces
// the exponential one in that direction (the theme animations of Windows fade linearly).
export interface Smoothing {
    state: number;
    fade: number;
    slide: number;
    fadeIn: number;
    fadeOut: number;
}

const NONE: Rgba = [0, 0, 0, 0];

const alphaOf = (look: Look): number => (look.alpha === undefined ? 1 : look.alpha);

const scaleOf = (look: Look): number => (look.glyphScale === undefined ? 1 : look.glyphScale);

const thicknessOf = (look: Look): number => (look.thickness === undefined ? look.size : look.thickness);

// Linear when a duration is given for that direction, else exponential.
function fade(from: number, to: number, dt: number, tau: Smoothing): number {
    const duration = to > from ? tau.fadeIn : tau.fadeOut;
    if (!(duration > 0)) return follow(from, to, dt, tau.fade);
    const step = dt / duration;
    return to > from ? Math.min(to, from + step) : Math.max(to, from - step);
}

const chaseColor = (from: Rgba, to: Rgba, dt: number, tau: number): Rgba => from.map((c, i) => follow(c, to[i], dt, tau)) as Rgba;

export class LookAnimator {
    // The look drawn now, null before the first step.
    current: Look | null = null;

    // Moves the drawn look `dt` ms toward `target`. The first step lands at once: a part that has
    // just appeared starts in its state rather than animating into it. Returns whether a value
    // is still on its way.
    step(target: Look, dt: number, tau: Smoothing): boolean {
        const from = this.current;
        if (!from) {
            this.current = {
                color: target.color.slice() as Rgba,
                border: (target.border || NONE).slice() as Rgba,
                glyph: (target.glyph || NONE).slice() as Rgba,
                size: target.size,
                thickness: thicknessOf(target),
                opacity: target.opacity,
                alpha: alphaOf(target),
                glyphScale: scaleOf(target),
                slide: target.slide,
            };
            return false;
        }
        const next: Look = {
            color: chaseColor(from.color, target.color, dt, tau.state),
            border: chaseColor(from.border || NONE, target.border || NONE, dt, tau.state),
            glyph: chaseColor(from.glyph || NONE, target.glyph || NONE, dt, tau.state),
            size: follow(from.size, target.size, dt, tau.state),
            thickness: follow(thicknessOf(from), thicknessOf(target), dt, tau.state),
            opacity: fade(from.opacity, target.opacity, dt, tau),
            alpha: follow(alphaOf(from), alphaOf(target), dt, tau.state),
            glyphScale: follow(scaleOf(from), scaleOf(target), dt, tau.state),
            slide: follow(from.slide, target.slide, dt, tau.slide),
        };
        this.current = next;
        return !sameLook(next, target);
    }
}

const sameColor = (a: Rgba | undefined, b: Rgba | undefined): boolean => {
    const x = a || NONE;
    const y = b || NONE;
    return x.every((c, i) => c === y[i]);
};

export function sameLook(a: Look, b: Look): boolean {
    return a.size === b.size && thicknessOf(a) === thicknessOf(b) && a.opacity === b.opacity && alphaOf(a) === alphaOf(b) && scaleOf(a) === scaleOf(b) && a.slide === b.slide && sameColor(a.color, b.color) && sameColor(a.border, b.border) && sameColor(a.glyph, b.glyph);
}

// Rounded so that a value at rest writes the same string every time.
const r = (n: number, digits: number): number => {
    const k = Math.pow(10, digits);
    return Math.round(n * k) / k;
};

// The look as the private custom properties the shadow CSS of the default parts uses. They are
// the shown values: what the part's inputs (--ax-scrollbar-part-*) are being moved toward.
const rgba = (c: Rgba | undefined): string => {
    const [red, green, blue, alpha] = c || NONE;
    return `rgba(${r(red, 2)}, ${r(green, 2)}, ${r(blue, 2)}, ${r(alpha, 4)})`;
};

export function lookProperties(look: Look): [string, string][] {
    return [
        ['--ax-scrollbar-shown-color', rgba(look.color)],
        ['--ax-scrollbar-shown-border-color', rgba(look.border)],
        ['--ax-scrollbar-shown-glyph-color', rgba(look.glyph)],
        ['--ax-scrollbar-shown-size', `${r(look.size, 3)}px`],
        ['--ax-scrollbar-shown-thickness', `${r(thicknessOf(look), 3)}px`],
        ['--ax-scrollbar-shown-opacity', String(r(look.opacity, 4))],
        ['--ax-scrollbar-shown-alpha', String(r(alphaOf(look), 4))],
        ['--ax-scrollbar-shown-glyph-scale', String(r(scaleOf(look), 4))],
        ['--ax-scrollbar-shown-slide', `${r(look.slide, 3)}px`],
    ];
}
