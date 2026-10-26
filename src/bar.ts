import { physical } from './geometry.js';
import type { AxisLayout } from './geometry.js';
import { createPart } from './kits.js';
import type { PartClasses } from './kits.js';
import type { AxScrollbarTrackPiece, PartState } from './parts/part.js';
import { Piece, writeStyle } from './piece.js';
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

    constructor(axis: Axis, classes: PartClasses) {
        this.axis = axis;
        const suffix = '-' + axis;
        const div = () => document.createElement('div');
        this.root = new Piece(div(), ['scrollbar', 'scrollbar' + suffix], null, axis === 'vertical' ? 'bar v' : 'bar h', axis);
        this.buttonStart = new Piece(createPart(classes.button), ['button', 'button-start', 'button' + suffix], 'button', 'button start', axis);
        this.buttonEnd = new Piece(createPart(classes.button), ['button', 'button-end', 'button' + suffix], 'button', 'button end', axis);
        this.buttonStart.set({ direction: 'start' });
        this.buttonEnd.set({ direction: 'end' });
        this.track = new Piece(createPart(classes.track), ['track', 'track' + suffix], 'track', 'track', axis);
        this.pieceStart = new Piece(createPart(classes['track-piece']) as AxScrollbarTrackPiece, ['track-piece', 'track-piece-start', 'track-piece' + suffix], 'track-piece', 'piece start', axis);
        this.pieceEnd = new Piece(createPart(classes['track-piece']) as AxScrollbarTrackPiece, ['track-piece', 'track-piece-end', 'track-piece' + suffix], 'track-piece', 'piece end', axis);
        this.pieceStart.set({ direction: 'start' });
        this.pieceEnd.set({ direction: 'end' });
        this.thumb = new Piece(createPart(classes.thumb), ['thumb', 'thumb' + suffix], 'thumb', 'thumb', axis);
        this.area = div();
        this.area.className = 'area';
        this.clipStart = div();
        this.clipStart.className = 'clip start';
        this.clipStart.appendChild(this.pieceStart.el);
        this.clipEnd = div();
        this.clipEnd.className = 'clip end';
        this.clipEnd.appendChild(this.pieceEnd.el);
        this.markers = div();
        this.markers.className = 'markers';
        // Later children paint above earlier ones: markers sit over the thumb.
        for (const el of [this.track.el, this.clipStart, this.clipEnd, this.thumb.el]) this.area.appendChild(el);
        this.area.appendChild(this.markers);
        this.root.el.appendChild(this.buttonStart.el);
        this.root.el.appendChild(this.area);
        this.root.el.appendChild(this.buttonEnd.el);
    }

    setDisplayed(on: boolean): boolean {
        return writeStyle(this.root.el, 'display', on ? '' : 'none');
    }

    // Hidden parts are there but not displayed: they take no room and no input, and showing them
    // again is cheap. The track hides its pieces with it.
    // Returns whether anything changed.
    setHidden(hidden: BarHidden): boolean {
        let changed = false;
        const display = (piece: Piece | HTMLElement, off: boolean) => {
            if (writeStyle(piece instanceof Piece ? piece.el : piece, 'display', off ? 'none' : '')) changed = true;
        };
        display(this.buttonStart, hidden.buttons);
        display(this.buttonEnd, hidden.buttons);
        display(this.thumb, hidden.thumb);
        display(this.track, hidden.track);
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

    minThumb(): number {
        const style = getComputedStyle(this.thumb.el);
        return parseFloat(this.axis === 'vertical' ? style.minHeight : style.minWidth) || 0;
    }

    // `exact`: snapped values, written exactly. The thumb moves with a 2D translate: a 3D one gives it a
    // compositor layer of its own, and a page of scrollbars (every marker too) is then layerized again on
    // every scroll frame; a layer also rasters at its own fractional offset, which is what made a
    // thumb start a device pixel before the button beside it.
    render(layout: AxisLayout, rtl: boolean, exact = false): void {
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
        writeStyle(this.thumb.el, length, len(layout.thumbLength));
        writeStyle(this.thumb.el, 'transform', move(thumbStart));
        writeStyle(this.thumb.el, THUMB_NUDGE, exact ? `${nudge(thumbStart)}px` : '');

        // A piece is the whole track clipped to its side of the thumb (see AxScrollbarTrackPiece).
        // Across the axis nothing is clipped: the piece may slide out of the track (the default
        // look's appearance slide).
        const thumbEnd = layout.thumbOffset + layout.thumbLength;
        const clip = (el: HTMLElement, from: number, to: number): void => {
            const before = len(Math.max(0, from));
            const after = len(Math.max(0, track - to));
            const [top, right, bottom, left] = vertical ? [before, '-100%', after, '-100%'] : rtl ? ['-100%', before, '-100%', after] : ['-100%', after, '-100%', before];
            const value = `inset(${top} ${right} ${bottom} ${left})`;
            writeStyle(el, '-webkit-clip-path', value);
            writeStyle(el, 'clip-path', value);
        };
        clip(this.clipStart, 0, layout.thumbOffset);
        clip(this.clipEnd, thumbEnd, track);
        this.pieceStart.el.setSpan(0, layout.thumbOffset);
        this.pieceEnd.el.setSpan(thumbEnd, Math.max(0, track - thumbEnd));
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
