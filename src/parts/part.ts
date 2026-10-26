// The parts of the scrollbar as elements: each piece a user sees (thumb, buttons, track, corner,
// markers, cards) is a surface that knows its own state. The bar tells it the state and the part
// reflects it as attributes. The classes of this file are the contract of each kind: they draw
// nothing and animate nothing. A look is a subclass (the default one is in default.ts, a kit's is
// its own): it brings its layers, its look inputs and its own shadow style sheet, which reads the
// state as `:host([hover])` and so on.
import { AxSurface, appearance, services } from '@ax-design/surface';
import type { Quality, Values } from '@ax-design/surface';
import { CORE_SCHEMA } from '@ax-design/surface/schema';
import * as T from '../tokens.js';
import type { Axis } from '../types.js';
import { LookAnimator, lookProperties } from './animator.js';
import type { Look, Smoothing } from './animator.js';

export type PartKind = 'thumb' | 'button' | 'track' | 'track-piece' | 'corner' | 'marker' | 'card';

export interface PartState {
    axis: Axis;
    direction: 'start' | 'end' | null; // buttons and track pieces: start/end; others null
    hover: boolean;      // own hover (a pressed marker counts as hovered)
    pressed: boolean;    // own press (drag, button held, page repeat toward a track piece, marker pressed)
    disabled: boolean;   // the axis has nothing to scroll
    indicator: 'none' | 'mouse' | 'touch';
    // The bar is engaged (see Controller.engaged): thumb or marker hovered, dragging, pointer near
    // or over it, after the expand delay and until the contract delay is over.
    engaged: boolean;
    onThumb: boolean;    // markers
    current: boolean;    // markers
    rtl: boolean;        // the scroller reads right to left (the bars sit on its left, a slide goes the other way)
}

export function initialState(axis: Axis = 'vertical'): PartState {
    return { axis, direction: null, hover: false, pressed: false, disabled: false, indicator: 'none', onThumb: false, current: false, engaged: false, rtl: false };
}

// Marks part classes across copies of this package: a kit built against another copy still
// passes the check (a brand, not instanceof).
export const PART_BRAND = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/scrollbar.part') : '@ax-design/scrollbar.part';

// A part class: one of the base classes below or a subclass of it.
export interface PartClass {
    new (): AxScrollbarPart;
    readonly kind: PartKind;
    readonly prototype: AxScrollbarPart;
}

// Whether `cls` is a part class of that kind: it extends the base class of the kind, from any copy.
export function isPartClass(cls: unknown, kind: PartKind): cls is PartClass {
    if (typeof cls !== 'function' || !cls.prototype) return false;
    return (cls.prototype as { [key: string]: unknown })[PART_BRAND as string] === true && (cls as unknown as PartClass).kind === kind;
}

// The reflected attributes: the same words as the part names (`thumb-hover` is `[hover]`).
const BOOLEANS: [keyof PartState, string][] = [
    ['hover', 'hover'],
    ['pressed', 'pressed'],
    ['disabled', 'disabled'],
    ['engaged', 'engaged'],
    ['onThumb', 'on-thumb'],
    ['current', 'current'],
    ['rtl', 'rtl'],
];

function sameState(a: PartState, b: PartState): boolean {
    for (const key of Object.keys(a) as (keyof PartState)[]) if (a[key] !== b[key]) return false;
    return true;
}

// The time step of the first frame of a motion, which has no frame before it to measure from.
const FIRST_FRAME = 16.7;
// A longer gap between frames (a background tab) counts as this much, so nothing leaps.
const MAX_FRAME = 100;

// The style sheets of a class: the `styles` of each class of its chain that has its own, base
// first, so a subclass refines what its base class sets. One sheet per class, shared by every
// instance. A browser without constructable style sheets gets style elements instead.
const sheets = new WeakMap<object, (CSSStyleSheet | string)[]>();

function sheetsOf(cls: typeof AxScrollbarPart): (CSSStyleSheet | string)[] {
    let list = sheets.get(cls);
    if (list) return list;
    const texts: string[] = [];
    for (let c: unknown = cls; typeof c === 'function' && c !== AxSurface; c = Object.getPrototypeOf(c)) {
        const own = Object.prototype.hasOwnProperty.call(c, 'styles') ? (c as typeof AxScrollbarPart).styles : '';
        if (own) texts.unshift(own);
    }
    const constructable = typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in Document.prototype && 'replaceSync' in CSSStyleSheet.prototype;
    list = texts.map((text) => {
        if (!constructable) return text;
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
        return sheet;
    });
    sheets.set(cls, list);
    return list;
}

// What every part resets on itself, from its own (lowest) shadow style: the Surface properties
// would otherwise reach a part from a rule on the bar or from an ancestor that tilts, in browsers
// without @property, where custom properties inherit. The look that follows sets what it wants.
const SURFACE_PROPERTIES = [...CORE_SCHEMA.map((spec) => spec.name), '--ax-fill-color', '--ax-border-color', '--elevation-depth', '--elevation-color'];
const RESET = `:host {\n${SURFACE_PROPERTIES.map((name) => `    ${name}: initial;`).join('\n')}\n}\n`;

// The base of every part: Surface, the kind, the state and its reflected attributes, and the
// shadow style of the class chain. A look is a subclass that sets `styles`, `extraSchema`,
// `defaultLayers_()` and `look()`; kits subclass the contract class of a kind.
export abstract class AxScrollbarPart extends AxSurface {
    static schemaKey = 'ax-scrollbar-part';
    static extraSchema: typeof AxSurface.extraSchema = [];
    // The shadow style of this class, added after the one of its base class. The state is read as
    // `:host([hover])`, the axis as `:host([axis="vertical"])`, and so on (the reflected attributes).
    static styles = RESET;
    // Set by each base class below.
    static readonly kind: PartKind;
    // A look that shows nothing while the indicator is `none` (the default parts: they fade out and
    // slide away). Such a part is paused (see AxSurface.paused) while it is hidden, so a page of
    // scroll views costs no frame, no style read and no drawing until a bar shows: it starts paused,
    // pauses again when its fade out has ended, and runs again when the indicator comes.
    static hiddenAtRest = false;

    private state: PartState = initialState();
    private stateSet = false;
    private readonly animator = new LookAnimator();
    private lastStep = 0;
    // The time constants, taken from the surface's values at the start of each motion.
    private smoothing: Smoothing = { state: 0, fade: 0, slide: 0, fadeIn: 0, fadeOut: 0 };
    // The look properties last written, so a value at rest is not written again.
    private written: { [name: string]: string } = {};

    private get hiddenAtRest(): boolean {
        return (this.constructor as typeof AxScrollbarPart).hiddenAtRest;
    }

    // The last step of the look is still on its way (see stepLook).
    private stepping = false;
    // The part has been told to be hidden (the indicator was none) before its first step.
    private sawHidden = false;

    constructor() {
        super();
        if (this.hiddenAtRest) this.paused = true;
        const root = this.shadowRoot as ShadowRoot;
        const list = sheetsOf(this.constructor as typeof AxScrollbarPart);
        if (list.length && typeof list[0] !== 'string') root.adoptedStyleSheets = root.adoptedStyleSheets.concat(list as CSSStyleSheet[]);
        else
            for (const text of list) {
                const style = document.createElement('style');
                style.textContent = text as string;
                root.appendChild(style);
            }
    }

    get [PART_BRAND as unknown as string](): boolean {
        return true;
    }

    get partState(): Readonly<PartState> {
        return this.state;
    }

    // Called by the bar. Reflects the state as attributes, for the shadow style sheet and kits,
    // tells the subclass, and refreshes the surface: Surface does not see attribute changes
    // inside a third-party shadow root.
    setPartState(next: PartState): void {
        if (this.stateSet && sameState(this.state, next)) return;
        this.stateSet = true;
        const prev = this.state;
        this.state = { ...next };
        this.setAttribute('axis', next.axis);
        if (next.direction) this.setAttribute('direction', next.direction);
        else this.removeAttribute('direction');
        for (const [key, name] of BOOLEANS) this.toggleAttribute(name, (next[key] as boolean) || (key === 'hover' && next.pressed && (this.constructor as typeof AxScrollbarPart).kind === 'marker'));
        this.stateChanged(prev, next);
        if (next.indicator === 'none') this.sawHidden = true;
        if (this.hiddenAtRest && next.indicator !== 'none') this.paused = false;
        this.refresh();
    }

    // The parts lie in the box of the scrollbar's element: one watch of its visibility serves them all.
    protected visibilityTarget(): Element {
        const root = this.getRootNode() as ShadowRoot;
        return root.host || this;
    }

    // For subclasses that react to a state change themselves.
    protected stateChanged(_prev: PartState, _next: PartState): void {}

    // The layers of the part, in paint order: the part's `layers` attribute, as Surface reads it
    // (the host forwards `thumb-layers` and so on), or the look's. (Surface's own name.)
    protected layerNames_(): string[] {
        const names = this.getAttribute('layers');
        return names === null ? this.defaultLayers_() : names.split(/\s+/).filter(Boolean);
    }

    // The layers the part draws without a `layers` attribute: none. A look names its own.
    protected defaultLayers_(): string[] {
        return [];
    }

    // The look this part moves toward: null for none, which is the contract (nothing is animated).
    // A look returns its inputs as computed on the part, in its current state (see default.ts).
    protected look(_state: Readonly<PartState>, _values: Values): Look | null {
        return null;
    }

    // Counts what changes the styles the part reads (its state, its tokens, a refresh) and the count
    // its last read saw. The scrollbar writes the state of a part in its own write phase, which can
    // come after the part's read in the same frame: that read is then stale, and the part reads
    // again in the next frame instead of stepping toward values of the state it no longer has.
    private changes = 0;
    private seenChanges = 0;

    refresh(): void {
        this.changes++;
        super.refresh();
    }

    read(): void {
        this.seenChanges = this.changes;
        super.read();
    }

    // Phase 3 of the surface frame: one step of the look toward the state's values, then the draw.
    write(now: number, quality: Quality): void {
        if (this.seenChanges !== this.changes) {
            super.write(now, quality);
            this.refresh();
            return;
        }
        // The look steps first: a look that landed on its colours this frame (an instant one, or
        // the last step of a motion) is read back and drawn in this same frame, so a state change
        // paints in the frame that reflects it, not one frame later.
        const again = this.stepLook(now);
        super.write(now, quality);
        // After the draw, which clears the dirty flags: the colours of a motion are read next frame.
        if (again) this.refresh();
        // Hidden for good (until the indicator comes): nothing more to read or draw.
        else if (this.hiddenAtRest && !this.stepping && this.state.indicator === 'none' && this.animator.current && this.animator.current.opacity === 0) this.paused = true;
    }

    disconnectedCallback(): void {
        super.disconnectedCallback();
        this.lastStep = 0;
    }

    // One step of the look, written as custom properties on the part, in the write phase of a frame
    // of the scheduler. The colours are drawn by the layers, which see them only after the surface
    // has read the styles again: a colour that changed asks for a surface frame (refresh), which
    // reads them and steps on. The opacity, the slide and the size are CSS (the size reaches the
    // surface as a resize), so a motion of those alone asks the scheduler for a frame without
    // reading the part's styles: a fade of the bars costs no style reads.
    private stepLook(now: number): boolean {
        const values = this.currentValues;
        if (!values) return false;
        const target = this.look(this.state, values);
        if (!target) return false;
        const dt = this.lastStep ? Math.min(MAX_FRAME, now - this.lastStep) : FIRST_FRAME;
        if (!this.lastStep) this.smoothing = readSmoothing(values);
        // The first look of a part that was paused while hidden starts from its hidden look, so that it fades in
        // as it does after any other time the indicator was away, and does not appear at once. (A part that
        // is shown from its start, as with indicator="pinned", is there from the first frame.)
        if (!this.animator.current && this.hiddenAtRest && this.sawHidden && this.state.indicator !== 'none') {
            const hidden = this.look({ ...this.state, indicator: 'none' }, values);
            if (hidden) this.animator.step(hidden, FIRST_FRAME, this.smoothing);
        }
        const moving = this.animator.step(target, dt, this.smoothing);
        this.stepping = moving;
        this.lastStep = moving ? now : 0;
        let colors = false;
        for (const [name, value] of lookProperties(this.animator.current!)) {
            if (this.written[name] === value) continue;
            this.written[name] = value;
            this.style.setProperty(name, value);
            if (COLOR_PROPERTIES.indexOf(name) >= 0) colors = true;
        }
        // The colours are drawn from the next frame's read, which every part of the page does together
        // (a read inside this write would be one style recalculation per part).
        if (colors) return true;
        if (moving) services().scheduler.request(this);
        return false;
    }
}

// The look properties the layers draw (see stepLook).
const COLOR_PROPERTIES = ['--ax-scrollbar-shown-color', '--ax-scrollbar-shown-border-color', '--ax-scrollbar-shown-glyph-color', '--ax-scrollbar-shown-glyph-scale'];

// The time constants of a look, in ms: from the part's schema, 0 under reduced motion.
function readSmoothing(values: Values): Smoothing {
    if (appearance().reducedMotion) return { state: 0, fade: 0, slide: 0, fadeIn: 0, fadeOut: 0 };
    const ms = (name: string): number => {
        const value = values.number(name);
        return isFinite(value) ? Math.max(0, value) : 0;
    };
    return { state: ms(T.STATE_SMOOTHING), fade: ms(T.FADE_SMOOTHING), slide: ms(T.SLIDE_SMOOTHING), fadeIn: ms(T.FADE_IN_DURATION), fadeOut: ms(T.FADE_OUT_DURATION) };
}

// The kinds are the classes a kit extends: the contract of each, which draws nothing. The bar
// places a part along the bar; across the bar a thumb fills it unless its look says otherwise.
export class AxScrollbarThumb extends AxScrollbarPart {
    static readonly kind: PartKind = 'thumb';
    static styles = `:host([axis="vertical"]) { left: 0; right: 0; }\n:host([axis="horizontal"]) { top: 0; bottom: 0; }\n`;
}

export class AxScrollbarButton extends AxScrollbarPart {
    static readonly kind: PartKind = 'button';
}

export class AxScrollbarTrack extends AxScrollbarPart {
    static readonly kind: PartKind = 'track';
}

// The track on one side of the thumb (`direction` start or end). The thumb moves on every scroll
// frame, and a surface that changed its size on each one would measure, resolve its shape and
// check its animations each time, and restyle itself (a part has many properties). So the
// piece's box is the whole track, which changes only on a layout pass, and the bar clips it to
// its side of the thumb with a plain wrapper, the one element restyled per frame: the piece's
// shape is the track's, cut where the thumb is.
export class AxScrollbarTrackPiece extends AxScrollbarPart {
    static readonly kind: PartKind = 'track-piece';

    private spanNow = { offset: 0, length: 0 };

    // The part of the track the piece shows now, in logical px from the start of the track.
    get span(): Readonly<{ offset: number; length: number }> {
        return this.spanNow;
    }

    // Called by the bar on every frame it draws the piece; the clip is the bar's.
    setSpan(offset: number, length: number): void {
        if (offset !== this.spanNow.offset || length !== this.spanNow.length) this.spanNow = { offset, length };
    }
}

export class AxScrollbarCorner extends AxScrollbarPart {
    static readonly kind: PartKind = 'corner';
}

export class AxScrollbarMarker extends AxScrollbarPart {
    static readonly kind: PartKind = 'marker';
}
