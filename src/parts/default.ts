// The default parts: the Windows 8 look, as classes that extend the contract class of each kind.
// Each brings what the contract leaves out: its layers (the fill and border on its shape, the arrow
// of a button, the shadow of a card), the look inputs and the animator that moves toward them, and
// its own shadow style (default-css.ts). A kit that wants the default look under a change of its
// own extends these instead of the contract classes.
import type { Values } from '@ax-design/surface';
import * as T from '../tokens.js';
import type { Look } from './animator.js';
import { AxScrollbarCard } from './card.js';
import { BUTTON_CSS, CARD_CSS, CORNER_CSS, LINE_STYLE, MARKER_CSS, PIECE_CSS, THUMB_CSS, TRACK_CSS } from './default-css.js';
import { AxScrollbarButton, AxScrollbarCorner, AxScrollbarMarker, AxScrollbarThumb, AxScrollbarTrack, AxScrollbarTrackPiece } from './part.js';
import type { AxScrollbarPart, PartState } from './part.js';
import type { ScrollMarker } from '../types.js';

// One schema key for the default parts: their schemas are the same (the look tokens).
const SCHEMA_KEY = 'ax-scrollbar-default-part';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, isFinite(n) ? n : 1));

// The look a default part moves toward: its inputs as computed on the part (--ax-scrollbar-part-*:
// its own style's, or the author's ::part() rules, whichever the cascade picks for the part in its
// current state). A part that is not shown by the indicator moves toward opacity 0 and slides out.
function defaultLook(state: Readonly<PartState>, values: Values): Look {
    const shown = state.indicator !== 'none';
    const size = Math.max(0, values.length(T.PART_SIZE));
    return {
        color: values.color(T.PART_COLOR),
        border: values.color(T.PART_BORDER_COLOR),
        glyph: values.color(T.PART_GLYPH_COLOR),
        size,
        thickness: values.unset(T.PART_THICKNESS) ? size : Math.max(0, values.length(T.PART_THICKNESS)),
        opacity: shown ? clamp01(values.number(T.PART_OPACITY)) : 0,
        glyphScale: values.number(T.PART_GLYPH_SCALE),
        slide: shown ? 0 : values.length(T.SLIDE_DISTANCE),
    };
}

// The touch indicator is the panning indicator, and it keeps its look while the bars fade out: the
// `touch` attribute follows the last indicator that showed (the host's `last-indicator`).
function followIndicator(part: AxScrollbarPart, next: Readonly<PartState>): void {
    if (next.indicator !== 'none') part.toggleAttribute('touch', next.indicator === 'touch');
}

export class AxScrollbarDefaultThumb extends AxScrollbarThumb {
    static hiddenAtRest = true;
    static schemaKey = SCHEMA_KEY;
    static extraSchema = T.LOOK_PROPERTIES;
    static styles = THUMB_CSS;

    protected defaultLayers_(): string[] {
        return ['scrollbar-fill'];
    }

    protected look(state: Readonly<PartState>, values: Values): Look | null {
        return defaultLook(state, values);
    }

    protected stateChanged(_prev: PartState, next: PartState): void {
        followIndicator(this, next);
    }
}

export class AxScrollbarDefaultButton extends AxScrollbarButton {
    static hiddenAtRest = true;
    static schemaKey = SCHEMA_KEY;
    static extraSchema = T.LOOK_PROPERTIES;
    static styles = BUTTON_CSS;

    protected defaultLayers_(): string[] {
        return ['scrollbar-fill', 'scrollbar-glyph'];
    }

    protected look(state: Readonly<PartState>, values: Values): Look | null {
        return defaultLook(state, values);
    }

    protected stateChanged(_prev: PartState, next: PartState): void {
        followIndicator(this, next);
    }
}

export class AxScrollbarDefaultTrack extends AxScrollbarTrack {
    static hiddenAtRest = true;
    static schemaKey = SCHEMA_KEY;
    static extraSchema = T.LOOK_PROPERTIES;
    static styles = TRACK_CSS;

    protected defaultLayers_(): string[] {
        return ['scrollbar-fill'];
    }

    protected look(state: Readonly<PartState>, values: Values): Look | null {
        return defaultLook(state, values);
    }

    protected stateChanged(_prev: PartState, next: PartState): void {
        followIndicator(this, next);
    }
}

export class AxScrollbarDefaultTrackPiece extends AxScrollbarTrackPiece {
    static hiddenAtRest = true;
    static schemaKey = SCHEMA_KEY;
    static extraSchema = T.LOOK_PROPERTIES;
    static styles = PIECE_CSS;

    protected defaultLayers_(): string[] {
        return ['scrollbar-fill'];
    }

    protected look(state: Readonly<PartState>, values: Values): Look | null {
        return defaultLook(state, values);
    }

    protected stateChanged(_prev: PartState, next: PartState): void {
        followIndicator(this, next);
    }
}

export class AxScrollbarDefaultCorner extends AxScrollbarCorner {
    static hiddenAtRest = true;
    static schemaKey = SCHEMA_KEY;
    static extraSchema = T.LOOK_PROPERTIES;
    static styles = CORNER_CSS;

    protected defaultLayers_(): string[] {
        return ['scrollbar-fill'];
    }

    protected look(state: Readonly<PartState>, values: Values): Look | null {
        return defaultLook(state, values);
    }

    protected stateChanged(_prev: PartState, next: PartState): void {
        followIndicator(this, next);
    }
}

export class AxScrollbarDefaultMarker extends AxScrollbarMarker {
    static hiddenAtRest = true;
    static schemaKey = SCHEMA_KEY;
    static extraSchema = T.LOOK_PROPERTIES;
    static styles = MARKER_CSS;

    protected defaultLayers_(): string[] {
        return ['scrollbar-fill'];
    }

    // The marker's own opacity is a second channel that follows the state smoothing and multiplies
    // the fade of the bar (a marker that hides while the bar is collapsed fades with the state, as
    // the indicator fades the bar with its own).
    protected look(state: Readonly<PartState>, values: Values): Look | null {
        return { ...defaultLook(state, values), opacity: state.indicator !== 'none' ? 1 : 0, alpha: clamp01(values.number(T.PART_OPACITY)) };
    }

    protected stateChanged(_prev: PartState, next: PartState): void {
        followIndicator(this, next);
    }
}

// The card animates with CSS transitions (its own style, on its state tokens), so it has no look to
// move toward. Its shadow is the elevation layer, its depth the card's `--elevation-depth`.
export class AxScrollbarDefaultCard extends AxScrollbarCard {
    static schemaKey = SCHEMA_KEY;
    static extraSchema = T.LOOK_PROPERTIES;
    static styles = CARD_CSS;

    protected defaultLayers_(): string[] {
        return ['scrollbar-fill', 'elevation'];
    }

    // Each label on a line of its own, balanced, clamped to --ax-scrollbar-part-lines lines with an
    // ellipsis; the card shrinks to the longest line (see cards.ts).
    protected render(markers: ScrollMarker[], content: HTMLElement): void {
        for (const marker of markers) {
            const line = document.createElement('div');
            line.className = 'line';
            line.style.cssText = LINE_STYLE;
            line.textContent = marker.label;
            content.appendChild(line);
        }
    }
}
