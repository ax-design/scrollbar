import { physical } from './geometry.js';
import type { AxisLayout } from './geometry.js';
import { createPart } from './kits.js';
import type { PartClasses } from './kits.js';
import type { AxScrollbarTrackPiece, PartKind, PartState } from './parts/part.js';
import { Piece, writeStyle } from './piece.js';
import { THUMB_MIN_LENGTH } from './tokens.js';
import type { Axis } from './types.js';

// Rounded to 1/100 px: whole pixels would make a thumb jitter while it moves.
const round = (n: number): number => Math.round(n * 100) / 100;
const px = (n: number): string => `${round(n)}px`;

// Set on the thumb while the bar snaps (see `snap`): the distance in CSS px that something drawn inside
// the thumb adds to its place along the bar to be painted on whole device pixels. When the track starts
// at a fraction of a device pixel, a snapped thumb is moved by a translate of a fraction of one, so that
// its edges are on the grid of the screen; the browser then paints a gradient inside it at that
// fraction, and a line one device pixel thick covers two rows. The box of the thumb is drawn from the
// track's place rounded to a whole pixel, and the nudge is the difference between the two places.
export const THUMB_NUDGE = '--ax-scrollbar-thumb-nudge';

// The nudge of a thumb moved by `translate` CSS px. The thumb's edge is on a whole device pixel of the
// screen, so the track's place is a whole number of device pixels less the translate, and its rounding
// error is the nudge.
function nudge(translate: number): number {
    const ratio = window.devicePixelRatio || 1;
    // To a millionth of a pixel: a tie (the track at half a device pixel) must stay one, as it is for the browser.
    const track = Math.round(-translate * ratio * 1e6) / 1e6;
    return Math.round((track - Math.round(track)) * 1e4) / 1e4 / ratio;
}

// The state every part of a bar shares: the bar's, not the part's own.
export type BarState = Pick<PartState, 'indicator' | 'disabled' | 'engaged' | 'rtl'>;

// What a bar leaves out (see hide.ts): parts that are not displayed and take no input.
export interface BarHidden {
    thumb: boolean;
    buttons: boolean;
    track: boolean;
    pieces: boolean;
    markers: boolean;
}

// One scrollbar: its parts, and the track area that markers and the thumb are placed in. Every
// part is a surface; the bar itself and the area are plain elements that hold them.
export class Bar {
    readonly axis: Axis;
    readonly root: Piece;
    readonly buttonStart: Piece;
    readonly buttonEnd: Piece;
    readonly track: Piece;
    readonly pieceStart: Piece<AxScrollbarTrackPiece>;
    readonly pieceEnd: Piece<AxScrollbarTrackPiece>;
    readonly thumb: Piece;
    readonly area: HTMLElement;
    // The wrappers that clip the track pieces to their side of the thumb.
    readonly clipStart: HTMLElement;
    readonly clipEnd: HTMLElement;
    readonly markers: HTMLElement;

    // `made` is told of each part element as it is made (the host forwards the layers to it).
    constructor(axis: Axis, classes: PartClasses, made: (kind: PartKind, el: HTMLElement) => void = () => {}) {
        this.axis = axis;
        const suffix = '-' + axis;
        const div = (className: string): HTMLElement => {
            const el = document.createElement('div');
            el.className = className;
            return el;
        };
        this.root = new Piece(() => document.createElement('div'), ['scrollbar', 'scrollbar' + suffix], null, axis === 'vertical' ? 'bar v' : 'bar h', axis);
        this.area = div('area');
        this.clipStart = div('clip start');
        this.clipEnd = div('clip end');
        this.markers = div('markers');
        // A part is made the first time the bar shows it (see setParts), and put in its place then.
        // Later children paint above earlier ones: markers sit over the thumb.
        const part = <E extends HTMLElement = HTMLElement>(kind: PartKind, tokens: string[], className: string, put: (el: E) => void): Piece<E> =>
            new Piece<E>(() => createPart(classes[kind]) as E, tokens, kind, className, axis, (el) => {
                // The layers first: a part that is in the page already would build them twice.
                made(kind, el);
                put(el);
            });
        const root = this.root.el;
        this.buttonStart = part('button', ['button', 'button-start', 'button' + suffix], 'button start', (el) => root.insertBefore(el, this.area));
        this.buttonEnd = part('button', ['button', 'button-end', 'button' + suffix], 'button end', (el) => root.appendChild(el));
        this.track = part('track', ['track', 'track' + suffix], 'track', (el) => this.area.insertBefore(el, this.clipStart));
        this.pieceStart = part<AxScrollbarTrackPiece>('track-piece', ['track-piece', 'track-piece-start', 'track-piece' + suffix], 'piece start', (el) => this.clipStart.appendChild(el));
        this.pieceEnd = part<AxScrollbarTrackPiece>('track-piece', ['track-piece', 'track-piece-end', 'track-piece' + suffix], 'piece end', (el) => this.clipEnd.appendChild(el));
        this.thumb = part('thumb', ['thumb', 'thumb' + suffix], 'thumb', (el) => this.area.insertBefore(el, this.markers));
        this.buttonStart.set({ direction: 'start' });
        this.buttonEnd.set({ direction: 'end' });
        this.pieceStart.set({ direction: 'start' });
        this.pieceEnd.set({ direction: 'end' });
        for (const el of [this.clipStart, this.clipEnd, this.markers]) this.area.appendChild(el);
        root.appendChild(this.area);
        // Not seen until the first draw: until then the parts have no place along the track.
        writeStyle(root, 'visibility', 'hidden');
    }

    setDisplayed(on: boolean): boolean {
        return writeStyle(this.root.el, 'display', on ? '' : 'none');
    }

    // Whether a part that the look shows is not made yet (setParts would make it): what was read of a
    // bar before that has no room for the buttons, so it is read again after.
    missing(hidden: BarHidden): boolean {
        if (!hidden.buttons && (!this.buttonStart.created || !this.buttonEnd.created)) return true;
        if (!hidden.thumb && !this.thumb.created) return true;
        if (!hidden.track && !this.track.created) return true;
        return !hidden.track && !hidden.pieces && (!this.pieceStart.created || !this.pieceEnd.created);
    }

    // The parts the bar shows now: each is made the first time it is wanted and kept after, and one
    // the look leaves out is not displayed (and not made if it never was): it takes no room and no
    // input. A bar that is not displayed makes nothing. The track hides its pieces with it.
    // Returns whether anything changed: a part made or shown or hidden changes the room of the track.
    setParts(displayed: boolean, hidden: BarHidden): boolean {
        if (!displayed) return false;
        let changed = false;
        const display = (el: HTMLElement, off: boolean) => {
            if (writeStyle(el, 'display', off ? 'none' : '')) changed = true;
        };
        const part = (piece: Piece, off: boolean) => {
            if (off) {
                const el = piece.element;
                if (el) display(el, true);
                return;
            }
            const was = piece.created;
            display(piece.ensure(), false);
            if (!was) changed = true;
        };
        part(this.buttonStart, hidden.buttons);
        part(this.buttonEnd, hidden.buttons);
        part(this.thumb, hidden.thumb);
        part(this.track, hidden.track);
        part(this.pieceStart, hidden.track || hidden.pieces);
        part(this.pieceEnd, hidden.track || hidden.pieces);
        display(this.clipStart, hidden.track || hidden.pieces);
        display(this.clipEnd, hidden.track || hidden.pieces);
        display(this.markers, hidden.markers);
        return changed;
    }

    // Thickness across the axis: the width of a vertical bar, the height of a horizontal one.
    thickness(): number {
        return this.axis === 'vertical' ? this.root.el.offsetWidth : this.root.el.offsetHeight;
    }

    trackLength(): number {
        return this.axis === 'vertical' ? this.area.clientHeight : this.area.clientWidth;
    }

    // The thumb's minimum length: from the thumb, which the author may size with a rule of its own, or, while
    // the thumb is not made (the look hides it, or the bar is just being shown), from the token it is sized by.
    minThumb(): number {
        const thumb = this.thumb.element;
        if (!thumb) return parseFloat(getComputedStyle(this.area).getPropertyValue(THUMB_MIN_LENGTH)) || 0;
        const style = getComputedStyle(thumb);
        return parseFloat(this.axis === 'vertical' ? style.minHeight : style.minWidth) || 0;
    }

    // `exact`: snapped values, written exactly. The thumb moves with a 2D translate: a 3D one gives it a
    // compositor layer of its own, and a page of scrollbars (every marker too) is then layerized again on
    // every scroll frame; a layer also rasters at its own fractional offset, which is what made a
    // thumb start a device pixel before the button beside it.
    render(layout: AxisLayout, rtl: boolean, exact = false): void {
        writeStyle(this.root.el, 'visibility', '');
        const vertical = this.axis === 'vertical';
        const track = layout.track;
        const length = vertical ? 'height' : 'width';
        // Start edge of a box at logical `at`: physical only for a horizontal bar in right-to-left.
        const start = (at: number, size: number): number => (vertical ? at : physical(at, size, track, rtl));
        // Snapped values must be written exactly: rounding them to 1/100 px moves them off the grid
        // again when the track starts on a fractional position.
        const len = (n: number): string => (exact ? `${n}px` : px(n));
        const move = (edge: number): string => {
            const at = exact ? `${edge}px` : px(edge);
            return vertical ? `translate(0, ${at})` : `translate(${at}, 0)`;
        };

        const thumbStart = start(layout.thumbOffset, layout.thumbLength);
        // A part the look never shows is not made, and has nothing to move.
        const thumb = this.thumb.element;
        if (thumb) {
            writeStyle(thumb, length, len(layout.thumbLength));
            writeStyle(thumb, 'transform', move(thumbStart));
            writeStyle(thumb, THUMB_NUDGE, exact ? `${nudge(thumbStart)}px` : '');
        }

        // A piece is the whole track clipped to its side of the thumb (see AxScrollbarTrackPiece).
        // Across the axis nothing is clipped: the piece may slide out of the track (the default
        // look's appearance slide).
        const thumbEnd = layout.thumbOffset + layout.thumbLength;
        const clip = (el: HTMLElement, from: number, to: number): void => {
            const before = len(Math.max(0, from));
            const after = len(Math.max(0, track - to));
            const [top, right, bottom, left] = vertical ? [before, '-100%', after, '-100%'] : rtl ? ['-100%', before, '-100%', after] : ['-100%', after, '-100%', before];
            const value = `inset(${top} ${right} ${bottom} ${left})`;
            writeStyle(el, 'clip-path', value);
        };
        clip(this.clipStart, 0, layout.thumbOffset);
        clip(this.clipEnd, thumbEnd, track);
        const start0 = this.pieceStart.element;
        const end0 = this.pieceEnd.element;
        if (start0) start0.setSpan(0, layout.thumbOffset);
        if (end0) end0.setSpan(thumbEnd, Math.max(0, track - thumbEnd));
    }

    flush(shared: BarState): void {
        // The bar is engaged (see Controller.engaged): for the shadow style sheet and ::part().
        this.root.el.toggleAttribute('engaged', shared.engaged);
        this.root.toggle('scrollbar-engaged', shared.engaged);
        for (const piece of [this.root, this.buttonStart, this.buttonEnd, this.track, this.pieceStart, this.pieceEnd, this.thumb]) {
            piece.set(shared);
            piece.flush();
        }
    }
}
