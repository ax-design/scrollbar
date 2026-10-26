// The custom properties of the scrollbar. Timing, smoothing and lengths of the behaviour are read
// by the controller through one typed-om binding on the host, and inherit, so they can be set on
// the element or on any ancestor. The look of a part is set on the part (see INPUT_PROPERTIES) and
// read by the part through its surface schema (see parts/part.ts).
import { SMOOTH_TAU } from '@ax-design/scroll';
import { StyleBinding, StyleSchema, registerProperties } from '@ax-design/typed-om';
import type { LengthPercentage, PropertySpec } from '@ax-design/typed-om';
import { FOLLOW_TAU } from './follow.js';

const time = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'time' }, initial, inherits: true, register: true });
const length = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'length' }, initial, inherits: true, register: true });
const color = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'color' }, initial, inherits: true, register: true });
const number = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'number' }, initial, inherits: true, register: true });

export const SCROLL_SMOOTHING = '--ax-scrollbar-scroll-smoothing';
export const THUMB_SMOOTHING = '--ax-scrollbar-thumb-smoothing';
export const IDLE_DELAY = '--ax-scrollbar-idle-delay';
export const TOUCH_IDLE_DELAY = '--ax-scrollbar-touch-idle-delay';
export const CARD_DELAY = '--ax-scrollbar-card-delay';
export const REPEAT_DELAY = '--ax-scrollbar-repeat-delay';
export const REPEAT_INTERVAL = '--ax-scrollbar-repeat-interval';
export const LINE = '--ax-scrollbar-line';
export const HOTZONE = '--ax-scrollbar-hotzone';
export const MARKER_SPACING = '--ax-scrollbar-marker-spacing';
export const EXPAND_DELAY = '--ax-scrollbar-expand-delay';
export const CONTRACT_DELAY = '--ax-scrollbar-contract-delay';
// How far from a marker's centre the pointer still reaches it, and the gap between a marker and its card.
export const MARKER_REACH = '--ax-scrollbar-marker-reach';
export const CARD_GAP = '--ax-scrollbar-card-gap';
export const THICKNESS = '--ax-scrollbar-thickness';
export const PADDING = '--ax-scrollbar-padding';
export const THUMB_MIN_LENGTH = '--ax-scrollbar-thumb-min-length';

// Read by the controller on every layout pass and on refresh(), and watched: a change of any of
// them, from a style attribute, a rule or an animation, is applied on the next frame. The default
// parts size themselves from the thickness and the padding (see parts/default-css.ts).
export const HOST_PROPERTIES: PropertySpec[] = [
    length(THICKNESS, '17px'),
    length(PADDING, '0px'),
    length(THUMB_MIN_LENGTH, '48px'),
    time(SCROLL_SMOOTHING, `${SMOOTH_TAU}ms`),
    time(THUMB_SMOOTHING, `${FOLLOW_TAU}ms`),
    time(IDLE_DELAY, '3s'),
    time(TOUCH_IDLE_DELAY, '500ms'),
    time(CARD_DELAY, '400ms'),
    time(REPEAT_DELAY, '250ms'),
    time(REPEAT_INTERVAL, '50ms'),
    length(LINE, '40px'),
    // Percentages are of the bar's thickness.
    { name: HOTZONE, syntax: { type: 'length-percentage' }, initial: '0px', inherits: true, register: true },
    length(MARKER_SPACING, '6px'),
    time(EXPAND_DELAY, '0s'),
    time(CONTRACT_DELAY, '0s'),
    length(MARKER_REACH, '12px'),
    length(CARD_GAP, '12px'),
];

// The time constants of the parts' animators, and the slide of a hidden part. Host tokens: read by
// each part through its surface schema, and inherited like the others.
export const FADE_SMOOTHING = '--ax-scrollbar-fade-smoothing';
export const FADE_IN_DURATION = '--ax-scrollbar-fade-in-duration';
export const FADE_OUT_DURATION = '--ax-scrollbar-fade-out-duration';
export const SLIDE_SMOOTHING = '--ax-scrollbar-slide-smoothing';
export const SLIDE_DISTANCE = '--ax-scrollbar-slide-distance';
export const STATE_SMOOTHING = '--ax-scrollbar-state-smoothing';

// The look inputs of a part (B11), set on the part itself: by the shadow CSS of the default parts, and
// from outside with ::part(). The part's animator reads the computed values as the target of its
// motion and writes the shown ones to the private --ax-scrollbar-shown-* (see parts/animator.ts).
// Registered and typed, and not inherited: a part reads only what is set on it.
export const PART_COLOR = '--ax-scrollbar-part-color';
export const PART_BORDER_COLOR = '--ax-scrollbar-part-border-color';
export const PART_GLYPH_COLOR = '--ax-scrollbar-part-glyph-color';
export const PART_SIZE = '--ax-scrollbar-part-size';
export const PART_THICKNESS = '--ax-scrollbar-part-thickness';
export const PART_OPACITY = '--ax-scrollbar-part-opacity';
export const PART_GLYPH_SCALE = '--ax-scrollbar-part-glyph-scale';
// Content of the card: how many lines each label may take.
export const PART_LINES = '--ax-scrollbar-part-lines';
export const PART_ALIGN = '--ax-scrollbar-part-align';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const own = (spec: PropertySpec): PropertySpec => ({ ...spec, inherits: false });

export const INPUT_PROPERTIES: PropertySpec[] = [
    own(color(PART_COLOR, TRANSPARENT)),
    own(color(PART_BORDER_COLOR, TRANSPARENT)),
    own(color(PART_GLYPH_COLOR, TRANSPARENT)),
    own(length(PART_SIZE, '0px')),
    // auto: as long as the part is wide (a dot).
    own({ name: PART_THICKNESS, syntax: { type: 'length', keywords: ['auto'] }, initial: 'auto', inherits: false, register: true }),
    own(number(PART_OPACITY, '1')),
    own(number(PART_GLYPH_SCALE, '1')),
    own(number(PART_LINES, '2')),
];

// The part's extraSchema: read by the surface of each part, times included (Surface reads
// <time> as ms since typed-om 0.3).
export const LOOK_PROPERTIES: PropertySpec[] = [
    time(FADE_SMOOTHING, '75ms'),
    // 0s: no linear fade, the fade smoothing applies.
    time(FADE_IN_DURATION, '250ms'),
    time(FADE_OUT_DURATION, '167ms'),
    time(SLIDE_SMOOTHING, '160ms'),
    time(STATE_SMOOTHING, '0s'),
    length(SLIDE_DISTANCE, '0px'),
    ...INPUT_PROPERTIES,
];

// The button length: not registered, so that unset it is 33/17 of the thickness (see style.ts); auto is a square.
export const BUTTON_LENGTH = '--ax-scrollbar-button-length';

// Used by the CSS of the scrollbar and of the default parts only (var()); registered so they are typed and inherit the same
// way as the others.
export const CSS_PROPERTIES: PropertySpec[] = [
    time('--ax-scrollbar-card-slide-duration', '367ms'),
    length('--ax-scrollbar-card-slide-distance', '12px'),
    // Where the thumb sits across the bar, set on ::part(thumb): 0 at the inner edge of the bar's padding, 1 at the outer edge.
    own(number(PART_ALIGN, '0.5')),
];

// Built on first use, not on import: building a schema registers its properties.
let hostSchema: StyleSchema | null = null;

function registerLook(): void {
    // With the host schema: the var() of that CSS reads them before the first part has built
    // its surface schema, and they must be typed and inherit by then.
    registerProperties(LOOK_PROPERTIES.concat(CSS_PROPERTIES));
}

// Registers every property of the package with the browser: the host tokens, the look inputs of the parts
// and the ones only the CSS uses. register() does it, so that none is registered later, when a kind of part is
// first made: registering a property invalidates the style of the whole page, and a page that has grown by
// then pays for it in full.
export function registerAllProperties(): void {
    schema();
}

function schema(): StyleSchema {
    if (!hostSchema) {
        hostSchema = new StyleSchema(HOST_PROPERTIES);
        registerLook();
    }
    return hostSchema;
}

// A time or length read from the binding; anything but a number keeps the default, a negative one is 0.
function positive(value: unknown, fallback: number): number {
    return typeof value === 'number' && isFinite(value) ? Math.max(0, value) : fallback;
}

// The host's behaviour tokens as plain numbers (ms and px). They are read from the style when they are
// needed after a change (invalidate()), at most once per change: a change only marks them stale.
export class HostTokens {
    private current = {
        scrollSmoothing: SMOOTH_TAU,
        thumbSmoothing: FOLLOW_TAU,
        idleDelay: 3000,
        touchIdleDelay: 500,
        cardDelay: 400,
        repeatDelay: 250,
        repeatInterval: 50,
        line: 40,
        hotzone: { px: 0, percent: 0 } as LengthPercentage,
        markerSpacing: 6,
        expandDelay: 0,
        contractDelay: 0,
        markerReach: 12,
        cardGap: 12,
    };
    private stale = true;
    private readonly binding: StyleBinding;

    constructor(host: HTMLElement, root: ShadowRoot) {
        this.binding = new StyleBinding(schema(), host, root);
    }

    // `onChange` runs after a change of any host token (and once after the first observation).
    observe(onChange: () => void): void {
        this.binding.observe(onChange);
    }

    unobserve(): void {
        this.binding.unobserve();
    }

    // The values are read again the next time one is needed.
    invalidate(): void {
        this.stale = true;
    }

    get isStale(): boolean {
        return this.stale;
    }

    get scrollSmoothing(): number { return this.fresh().scrollSmoothing; }
    get thumbSmoothing(): number { return this.fresh().thumbSmoothing; }
    get idleDelay(): number { return this.fresh().idleDelay; }
    get touchIdleDelay(): number { return this.fresh().touchIdleDelay; }
    get cardDelay(): number { return this.fresh().cardDelay; }
    get repeatDelay(): number { return this.fresh().repeatDelay; }
    get repeatInterval(): number { return this.fresh().repeatInterval; }
    get line(): number { return this.fresh().line; }
    get markerSpacing(): number { return this.fresh().markerSpacing; }
    get expandDelay(): number { return this.fresh().expandDelay; }
    get contractDelay(): number { return this.fresh().contractDelay; }
    get markerReach(): number { return this.fresh().markerReach; }
    get cardGap(): number { return this.fresh().cardGap; }

    private fresh(): HostTokens['current'] {
        if (this.stale) this.read();
        return this.current;
    }

    // Reads the style now: one query, whatever the number of tokens.
    read(): void {
        this.stale = false;
        const b = this.binding;
        b.read();
        const c = this.current;
        c.scrollSmoothing = positive(b.get(SCROLL_SMOOTHING), SMOOTH_TAU);
        c.thumbSmoothing = positive(b.get(THUMB_SMOOTHING), FOLLOW_TAU);
        c.idleDelay = positive(b.get(IDLE_DELAY), 3000);
        c.touchIdleDelay = positive(b.get(TOUCH_IDLE_DELAY), 500);
        c.cardDelay = positive(b.get(CARD_DELAY), 400);
        c.repeatDelay = positive(b.get(REPEAT_DELAY), 250);
        // A repeat every 0 ms would never let the page draw.
        c.repeatInterval = Math.max(1, positive(b.get(REPEAT_INTERVAL), 50));
        c.line = positive(b.get(LINE), 40);
        const zone = b.get(HOTZONE) as LengthPercentage | null;
        c.hotzone = zone && typeof zone === 'object' ? zone : { px: 0, percent: 0 };
        c.markerSpacing = positive(b.get(MARKER_SPACING), 6);
        c.expandDelay = positive(b.get(EXPAND_DELAY), 0);
        c.contractDelay = positive(b.get(CONTRACT_DELAY), 0);
        c.markerReach = positive(b.get(MARKER_REACH), 12);
        c.cardGap = positive(b.get(CARD_GAP), 12);
    }

    // The hot zone in px for a bar of this thickness.
    hotzoneFor(thickness: number): number {
        const zone = this.fresh().hotzone;
        return Math.max(0, zone.px + (zone.percent / 100) * thickness);
    }
}
