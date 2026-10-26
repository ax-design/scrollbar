import { PRIORITY_IDLE, PRIORITY_POINTER, PRIORITY_PRESSED, services } from '@ax-design/surface';
import type { FrameClient, Quality } from '@ax-design/surface';
import { Bar } from './bar.js';
import type { BarHidden, BarState } from './bar.js';
import { CardLayer } from './cards.js';
import { followThumb } from './follow.js';
import type { Shown } from './follow.js';
import { Glide } from './glide.js';
import { DEFAULT_HIDE, HideList } from './hide.js';
import type { HidePart } from './hide.js';
import { BarInput } from './input.js';
import type { InputHost, Region } from './input.js';
import { MarkerSet } from './markers.js';
import type { PlacedMarker } from './markers.js';
import { layoutAxis, physical, snapLayout } from './geometry.js';
import type { AxisLayout, AxisMetrics } from './geometry.js';
import { PART_KINDS, createPart, partClasses, scrollbarKit, whenKitDefined } from './kits.js';
import type { ScrollbarKit } from './kits.js';
import { Piece, isPart, writeStyle } from './piece.js';
import type { ScrollTarget } from './target.js';
import { HostTokens } from './tokens.js';
import { AXES } from './types.js';
import type { Axis, Placement, ScrollMarker, ScrollMarkerInput } from './types.js';
import type { PartKind } from './parts/part.js';

export interface ControllerOptions {
    host: HTMLElement;
    root: ShadowRoot;
    target: ScrollTarget;
    frame: HTMLElement;       // .frame, empty: the bars and the corner are built inside
    cards: HTMLElement;       // .cards, empty
    viewport: HTMLElement | null; // ax-scroll-view only: its size and its content's are observed
}

type Metrics = Omit<AxisMetrics, 'position'>;

// What the read phase of a frame found, for its compute and write phases.
interface LayoutRead {
    rtl: boolean;
    // Per axis: the room the content needs, and whether the bar is shown for it.
    displayed: Record<Axis, boolean>;
    // Per axis: the thickness of the bar as laid out now; null for a bar that is not shown now.
    thickness: Record<Axis, number | null>;
    // Per axis: the metrics of the bar as laid out now (null for a bar that is not shown now) and the
    // screen position of the start of its track.
    metrics: Record<Axis, Metrics | null>;
    origin: Record<Axis, number>;
}

interface FrameRead {
    dt: number;
    rtl: boolean;
    snapping: boolean;
    tau: number;
    position: Record<Axis, number>;
    // The markers to build the parts of, when the list changed.
    list: ScrollMarker[] | null;
    // Where the markers are in the content, when they were measured (a new list, or elements that may have moved).
    positions: Map<ScrollMarker, number> | null;
    layout: LayoutRead | null;
    // The layout was read before the parts of a bar that is shown were made: nothing is drawn from it.
    stale: boolean;
    // The bar and the track of an open card, as laid out now.
    card: { axis: Axis; barRect: DOMRect; area: DOMRect } | null;
    // Computed: the thumb of each axis as it is and as it is drawn (null for a bar that is not drawn).
    exact: Record<Axis, AxisLayout | null>;
    drawn: Record<Axis, AxisLayout | null>;
    moving: boolean;
}

// Frame priorities between the pointer's (PRIORITY_POINTER) and an idle surface's: a scroll the
// user is watching ranks above a state that settles on its own.
const PRIORITY_SCROLL = 1e6;

type Indicator = 'none' | 'mouse' | 'touch';

interface AxisState {
    displayed: boolean;
    // The bar is laid out (not display none): its thickness and track can be read.
    laidOut: boolean;
    // Screen position of the logical start of the track, for the `snap` attribute.
    origin: number;
    metrics: Metrics | null;   // read after the writes of a layout pass
    layout: AxisLayout | null; // from the last frame, null when hidden
    // The thumb drawn, on its way to the one of `layout`; null until the bar is first drawn.
    shown: Shown | null;
    // Markers drawn on their way to their places.
    markersMoving: boolean;
    dragging: boolean;
    hover: boolean;
    near: boolean;
    // A press began on the bar (thumb, button, track, marker).
    pressed: boolean;
    // The bar is engaged (see engaged()) for the expand delay (and, once it has stopped, until the
    // contract delay is over). What the parts take as `engaged`.
    expanded: boolean;
    // What expanded is waiting to become, and the timer that gets it there.
    expandedWant: boolean;
    expandTimer: number;
}

// The children of the body that the page's bars observe for their size, at most.
const MAX_BODY_CHILDREN = 256;

const PASSIVE: AddEventListenerOptions = { passive: true };
// Presses are routed before the content sees them, and a press in the hot zone is taken from it.
const CAPTURE: AddEventListenerOptions = { capture: true, passive: false };
const CAPTURE_PASSIVE: AddEventListenerOptions = { capture: true, passive: true };
// Not passive: a touch in the hot zone must stop the page from scrolling (and a fling).
const ACTIVE: AddEventListenerOptions = { passive: false };

// Stops the click that follows a press the bar took from the content under it. The click comes
// right after the release, so the trap is removed on the next task if no click came.
function swallowClick(): void {
    const stop = (e: Event): void => {
        e.preventDefault();
        e.stopPropagation();
    };
    const end = (e: Event): void => {
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        if (e.type !== 'pointerup') return;
        window.addEventListener('click', stop, true);
        window.setTimeout(() => window.removeEventListener('click', stop, true), 0);
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
}

// Elements of the scrollbar: a press beside our bar over one of them is that scroller's.
const isScroller = (node: EventTarget): boolean => {
    const name = (node as Element).localName;
    return name === 'ax-scroll-view' || name === 'ax-scrollbar';
};

const newState = (): AxisState => ({
    displayed: false,
    laidOut: true,
    origin: 0,
    metrics: null,
    layout: null,
    shown: null,
    markersMoving: false,
    dragging: false,
    hover: false,
    near: false,
    pressed: false,
    expanded: false,
    expandedWant: false,
    expandTimer: 0,
});

// The time step of the first frame of a motion, which has no frame before it to measure from.
const FIRST_FRAME = 16.7;
// A longer gap between frames (a background tab) counts as this much, so nothing leaps.
const MAX_FRAME = 100;

// Attributes are written only when they change: a host attribute change is seen by Surface's
// observer inside the host and makes it re-read its surfaces.
function setAttr(el: HTMLElement, name: string, value: string): void {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

// Inset of a bar in px; 0 means "no inset", which the CSS default already gives.
const inset = (n: number): string => (n > 0 ? `${n}px` : '');

const devicePixelRatio = (): number => window.devicePixelRatio || 1;

// One for every scrollbar, made once: its `matches` follows the setting.
let motion: MediaQueryList | null | undefined;
const motionQuery = (): MediaQueryList | null => {
    if (motion === undefined) motion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    return motion;
};

// Where a marker is drawn: a card sits beside the marker the user sees.
const drawnOffset = (m: PlacedMarker): number => (m.shown === null ? m.offset : m.shown);

// A node, not instanceof: the element may come from another window (an iframe).
const isElement = (entry: ScrollMarkerInput | Element): entry is Element => typeof (entry as Node).nodeType === 'number' && (entry as Node).nodeType === 1;

// Ids of markers given without one: the same element (or object) keeps its id across sets, so its
// card and hover survive a new list.
const generatedIds = new WeakMap<object, string>();
let generatedCount = 0;

function generatedId(key: object): string {
    let id = generatedIds.get(key);
    if (!id) {
        id = `ax-marker-element-${generatedCount++}`;
        generatedIds.set(key, id);
    }
    return id;
}

const elementLabel = (el: Element): string => (el.getAttribute('aria-label') || el.textContent || '').trim();

function elementMarker(el: Element, axis: Axis): ScrollMarker {
    return { id: el.id || generatedId(el), label: elementLabel(el), axis, element: el };
}

// A marker object with all it needs is used as it is; one that leaves out its id or label gets them
// from its element (its own id and label for a marker without an element). Without an id the markers
// of a list would be one, as a list keeps one marker per id.
function objectMarker(entry: ScrollMarkerInput): ScrollMarker {
    if (typeof entry.id === 'string' && typeof entry.label === 'string') return entry as ScrollMarker;
    const { element } = entry;
    return {
        ...entry,
        id: typeof entry.id === 'string' ? entry.id : (element && element.id) || generatedId(element || entry),
        label: typeof entry.label === 'string' ? entry.label : element ? elementLabel(element) : '',
    };
}

function clear(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// The scrollbars of one scroller (or of the page): the bars, the markers and the cards, the
// observers, and the frame client that keeps them in step with the scroll position. It has no
// loop of its own: it asks the scheduler of Surface for a frame (request()) and does its reads,
// its math and its writes in the three phases the scheduler gives it, with every surface of the page.
export class ScrollbarController implements InputHost, FrameClient {
    private readonly options: ControllerOptions;
    private readonly host: HTMLElement;
    private readonly target: ScrollTarget;
    private readonly root: ShadowRoot;
    private readonly frameEl: HTMLElement;
    private readonly cardsEl: HTMLElement;
    private readonly glide: Glide;
    private readonly tokens: HostTokens;
    private readonly reduced: MediaQueryList | null;

    private bars!: Record<Axis, Bar>;
    private sets!: Record<Axis, MarkerSet>;
    private corner!: Piece;
    private cards!: CardLayer;
    private inputs: Partial<Record<Axis, BarInput>> = {};
    private states: Record<Axis, AxisState> = { vertical: newState(), horizontal: newState() };
    private rects: Record<Axis, DOMRect | null> = { vertical: null, horizontal: null };

    // What was set as `markers`, and the markers made of it. null: nothing was set, or null was,
    // and marker-selector is in charge.
    private entries: (ScrollMarkerInput | Element)[] | null = null;
    private list: ScrollMarker[] = [];
    // The kit of the kit attribute, null for the default parts or while it is not defined yet.
    private kit: ScrollbarKit | null = null;
    // Cancels the wait for a kit that is not defined yet.
    private kitWait: (() => void) | null = null;
    // The marker under the pointer, and the marker whose card is open or was last shown.
    private hovered: { axis: Axis; placed: PlacedMarker } | null = null;
    private card: { axis: Axis; id: string } | null = null;

    private connected = false;
    // The frame being run: what its read phase found, null while the controller is not in a frame.
    private frame: FrameRead | null = null;
    private layoutDirty = false;
    // A change of an attribute, a token, a rule: the tokens and what they decide are read again in the next frame.
    private refreshDirty = false;
    private refreshWrites = false;
    private scrollDirty = false;
    private markersDirty = false;
    private listDirty = false;
    private selectorDirty = false;
    // The markers that marker-selector made last, to see whether a new query differs.
    private matched: ScrollMarker[] = [];
    private stateDirty = false;
    private placeDirty = false;
    // Something is on its way (a thumb or a marker that follows, a glide): the next frame is wanted.
    private moving = false;
    // The client and scroll sizes of each axis at the last layout read.
    private seen: Record<Axis, { client: number; size: number } | null> = { vertical: null, horizontal: null };
    // Time of the last frame while something moves, 0 when nothing did.
    private lastTime = 0;

    private indicator: Indicator = 'none';
    // The indicator the bars show, or last showed while they fade out: with the touch indicator the
    // bars are a thumb alone, and stay so while they fade out.
    private lastShown: 'mouse' | 'touch' = 'mouse';
    private hideList = new HideList(DEFAULT_HIDE);
    private indicatorTimer = 0;
    // When the indicator ends if nothing moves, and when the timer that waits for it fires.
    private indicatorDeadline = 0;
    private indicatorTimerAt = 0;
    private cardTimer = 0;
    // Reduced motion: the open card goes away by itself after the touch idle delay.
    private dismissTimer = 0;
    // The suspended attribute as of the last refresh.
    private suspendedNow = false;
    // A touch press was taken by a bar: its touchstart must not scroll the page.
    private touchTaken = false;
    // The pointer type of the last press, wheel or key: a scroll after a touch shows the touch indicator.
    private lastInput = 'mouse';
    // The cursor written on the host (or the root element), and the author's value to put back.
    private cursorWritten = '';
    private cursorSaved = '';

    private resizeObserver: ResizeObserver | null = null;
    // Connected, and the resize observer has not reported yet: no frame is asked for until it does, and
    // everything that changed meanwhile is read by that first frame.
    private awaitingLayout = false;
    private attrObserver: MutationObserver | null = null;
    private selectorObserver: MutationObserver | null = null;
    // The page: its scroll size changes with its content, which the resize observer sees through the
    // sizes of the root, the body and the children of the body, and the mutation observer through its nodes
    // (see watchDocument). Nothing is polled.
    private documentObserver: MutationObserver | null = null;
    private bodyChildren = new Set<Element>();

    constructor(options: ControllerOptions) {
        this.options = options;
        this.host = options.host;
        this.target = options.target;
        this.root = options.root;
        this.frameEl = options.frame;
        this.cardsEl = options.cards;
        this.tokens = new HostTokens(this.host, this.root);
        this.reduced = motionQuery();
        this.glide = new Glide(this.target, () => (this.reducedMotion() ? 0 : this.tokens.scrollSmoothing));
        this.build();
    }

    // The list set, as markers; null while marker-selector is in charge.
    get markers(): ScrollMarker[] | null {
        return this.entries === null ? null : this.list;
    }

    // Markers, elements of the content, or both (an array, a NodeList). An element becomes a
    // marker of its own; it is read again whenever the markers are collected (its label may change).
    // A list, even an empty one, replaces the markers of marker-selector; null gives them back.
    set markers(value: Iterable<ScrollMarkerInput | Element> | null) {
        this.entries = value === null || value === undefined ? null : Array.from(value);
        this.list = this.normalise();
        this.listDirty = true;
        this.syncSelectorObserver();
        this.request();
    }

    // Collects and measures the markers again on the next frame, for a change the element cannot
    // see (an attribute that makes an element match marker-selector, a move by script).
    refreshMarkers(): void {
        this.listDirty = true;
        this.request();
    }

    connect(): void {
        if (this.connected) return;
        this.syncKit();
        this.connected = true;
        const { target } = this;
        target.scrollEvents.addEventListener('scroll', this.onScroll, PASSIVE);
        window.addEventListener('scroll', this.onPageScroll, PASSIVE);
        window.addEventListener('resize', this.onResize, PASSIVE);
        target.pointerArea.addEventListener('pointerdown', this.onDown, CAPTURE);
        target.pointerArea.addEventListener('pointermove', this.onMove, PASSIVE);
        target.pointerArea.addEventListener('wheel', this.onMouseInput, PASSIVE);
        target.pointerArea.addEventListener('keydown', this.onMouseInput, PASSIVE);
        target.pointerArea.addEventListener('touchstart', this.onTouchStart, ACTIVE);
        // The end of a transition or animation in the content may have moved the marker elements
        // (a page that enters with a transform): neither observer sees that.
        target.pointerArea.addEventListener('transitionend', this.onSettled, CAPTURE_PASSIVE);
        target.pointerArea.addEventListener('animationend', this.onSettled, CAPTURE_PASSIVE);
        this.leaveTarget().addEventListener('pointerleave', this.onLeave, PASSIVE);

        this.inputs = { vertical: new BarInput(this.bars.vertical, this), horizontal: new BarInput(this.bars.horizontal, this) };
        this.suspendedNow = this.suspended();

        // Layout depends on the size of the host, the viewport, the content and the bars themselves.
        // The first frame waits for the observer's first notice, which comes after the browser has laid
        // the page out: the layout this frame reads is then there already, where a frame run in the
        // same rendering update as the connect would force the browser to lay out the whole page
        // from inside the frame.
        if (typeof ResizeObserver !== 'undefined') {
            this.awaitingLayout = true;
            this.resizeObserver = new ResizeObserver(this.onResizeObserved);
            for (const el of this.observedElements()) this.resizeObserver.observe(el);
        }
        // A change of the text direction moves the bars.
        this.attrObserver = new MutationObserver(this.onLayoutChange);
        this.attrObserver.observe(this.host, { attributes: true, attributeFilter: ['dir'] });
        if (this.target.isDocument) this.attrObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
        this.selectorObserver = new MutationObserver(this.onContentChange);
        this.syncSelectorObserver();
        if (this.target.isDocument) this.watchDocument();

        setAttr(this.host, 'indicator-state', this.indicator);
        setAttr(this.host, 'last-indicator', this.lastShown);
        this.syncLayers();
        this.syncPinned();
        this.layoutDirty = true;
        this.listDirty = true;
        this.request();
        this.tokens.observe(this.onTokenChange);
    }

    disconnect(): void {
        if (!this.connected) return;
        this.connected = false;
        this.tokens.unobserve();
        if (this.kitWait) this.kitWait();
        this.kitWait = null;
        const { target } = this;
        services().scheduler.cancel(this);
        this.awaitingLayout = false;
        this.frame = null;
        this.lastTime = 0;
        this.glide.stop();
        clearTimeout(this.indicatorTimer);
        clearTimeout(this.cardTimer);
        clearTimeout(this.dismissTimer);
        for (const axis of AXES) {
            clearTimeout(this.states[axis].expandTimer);
            this.states[axis].expandTimer = 0;
            this.states[axis].expandedWant = this.states[axis].expanded = false;
        }
        this.indicatorTimer = 0;
        this.cardTimer = 0;
        this.dismissTimer = 0;

        target.scrollEvents.removeEventListener('scroll', this.onScroll);
        window.removeEventListener('scroll', this.onPageScroll);
        window.removeEventListener('resize', this.onResize);
        target.pointerArea.removeEventListener('pointerdown', this.onDown, CAPTURE);
        target.pointerArea.removeEventListener('pointermove', this.onMove);
        target.pointerArea.removeEventListener('wheel', this.onMouseInput);
        target.pointerArea.removeEventListener('keydown', this.onMouseInput);
        target.pointerArea.removeEventListener('touchstart', this.onTouchStart);
        target.pointerArea.removeEventListener('transitionend', this.onSettled, CAPTURE_PASSIVE);
        target.pointerArea.removeEventListener('animationend', this.onSettled, CAPTURE_PASSIVE);
        this.leaveTarget().removeEventListener('pointerleave', this.onLeave);

        for (const axis of AXES) this.inputs[axis]?.destroy();
        this.inputs = {};
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.resizeObserver = null;
        if (this.attrObserver) this.attrObserver.disconnect();
        this.attrObserver = null;
        if (this.selectorObserver) this.selectorObserver.disconnect();
        this.selectorObserver = null;
        if (this.documentObserver) this.documentObserver.disconnect();
        this.documentObserver = null;
        this.bodyChildren.clear();
        if (this.target.isDocument) this.unwatchLoads();

        // Hover and press tokens would otherwise stay on the parts until the next connect.
        for (const axis of AXES) {
            this.setRegionHover(axis, null);
            this.setPressed(axis, null, 0);
            this.setBarHover(axis, false);
            this.setNear(axis, false);
            this.sets[axis].setHover(null);
            this.sets[axis].setPressed(null);
            // Drawn at once on the next connect, as on the first one.
            this.states[axis].shown = null;
        }
        this.hovered = null;
        this.cards.hide(false);
        this.setIndicator('none');
    }

    // Destroys the bars, markers and cards and builds them again, for another kit.
    rebuild(): void {
        const wasConnected = this.connected;
        this.disconnect();
        this.cards.destroy();
        clear(this.frameEl);
        clear(this.cardsEl);
        this.card = null;
        this.build();
        if (wasConnected) this.connect();
    }

    // A change of an attribute or a token, or of something around the element that the observers do
    // not see. It only marks: the tokens are read at most once, when something needs them, and the
    // rest in the next frame.
    refresh(): void {
        this.tokens.invalidate();
        this.refreshDirty = true;
        this.request();
    }

    // What refresh() marked, in the read phase of the next frame: what is only state. The writes it
    // needs (applyRefreshWrites) wait for the write phase, so no controller writes before the reads
    // of the others.
    private applyRefresh(): void {
        this.refreshDirty = false;
        this.refreshWrites = true;
        this.syncHide();
        this.syncPinned();
        this.layoutDirty = true;
        this.listDirty = true;
        this.syncSelectorObserver();
        this.syncSuspended();
    }

    private applyRefreshWrites(): void {
        this.refreshWrites = false;
        this.syncLayers();
        // A change the parts cannot see (an attribute or a class around the element).
        for (const piece of this.pieces()) {
            const el = piece.element;
            if (el && isPart(el)) el.refresh();
        }
    }

    // `suspended`: the bars fade out as when the indicator ends, take no input, and the card
    // closes (a modal over the page). When it ends they show again, as after a move.
    private suspended(): boolean {
        return this.attr('suspended') !== null;
    }

    private syncSuspended(): void {
        const on = this.suspended();
        if (on === this.suspendedNow || !this.connected) {
            this.suspendedNow = on;
            return;
        }
        this.suspendedNow = on;
        if (on) {
            for (const axis of AXES) {
                this.inputs[axis]?.cancel();
                this.setNear(axis, false);
            }
            this.glide.stop();
            clearTimeout(this.indicatorTimer);
            this.indicatorTimer = 0;
            this.setIndicator('none');
            this.cards.hide(false);
        } else {
            this.showIndicator(this.lastInput === 'touch' ? 'touch' : 'mouse');
        }
    }

    // Bars take no input: while suspended, and in the default look while they are hidden, so the
    // content under an invisible bar keeps its hover and clicks. A kit may show its bars without
    // the indicator, so it decides for itself. (The bars themselves never take pointer
    // events; this is the geometry's decision.)
    private inert(): boolean {
        return this.suspended() || (this.kit === null && this.indicator === 'none');
    }

    // `touch="bar"`: on touch the bars look and work as with a mouse (a finger drags, pages and
    // presses). `indicator`, the default: the bars are a thumb alone that takes no input, the panning
    // indicator.
    private touchBar(): boolean {
        return this.attr('touch') === 'bar';
    }

    // Whether a press of this pointer type may start on a bar now. A touch may start on a hidden
    // bar of the default look, as on the reference: the edge of the screen is where a finger scrubs.
    private interactive(touch: boolean): boolean {
        if (this.suspended()) return false;
        if (touch) return this.touchBar();
        return !this.inert();
    }

    // ---- InputHost -------------------------------------------------------------------------

    // Computed fresh: a press step must see the position that the last scroll left.
    layout(axis: Axis): AxisLayout | null {
        return this.layoutFor(axis);
    }

    along(axis: Axis, clientX: number, clientY: number): number {
        const r = this.bars[axis].area.getBoundingClientRect();
        if (axis === 'vertical') return clientY - r.top;
        return this.target.rtl() ? r.right - clientX : clientX - r.left;
    }

    inZone(axis: Axis, clientX: number, clientY: number): boolean {
        return this.zoneOf(axis, clientX, clientY) !== null;
    }

    touchIdleDelay(): number {
        return this.tokens.touchIdleDelay;
    }

    reveal(kind: 'mouse' | 'touch'): void {
        if (!this.suspended()) this.showIndicator(kind);
    }

    scrollTo(axis: Axis, logical: number, smooth: boolean): void {
        if (smooth) {
            this.glide.to(axis, logical);
        } else {
            this.glide.stop(axis);
            this.target.scrollTo(axis, logical);
        }
        this.invalidate();
    }

    scrollBy(axis: Axis, delta: number): void {
        this.glide.by(axis, delta);
        this.invalidate();
    }

    goal(axis: Axis): number | null {
        return this.glide.goal(axis);
    }

    // Whether the look leaves a part out now (see hide.ts): a hidden part takes no input.
    hidden(part: HidePart): boolean {
        if (this.lastShown === 'touch' && (part === 'button' || part === 'track' || part === 'track-piece' || part === 'corner')) return true;
        return this.hideList.hidden(part);
    }

    trackClick(): 'page' | 'jump' {
        return this.attr('track-click') === 'jump' ? 'jump' : 'page';
    }

    lineStep(): number {
        return this.tokens.line;
    }

    repeatDelay(): number {
        return this.tokens.repeatDelay;
    }

    repeatInterval(): number {
        return this.tokens.repeatInterval;
    }

    client(axis: Axis): number {
        return this.target.client(axis);
    }

    hitMarker(axis: Axis, along: number): PlacedMarker | null {
        if (!this.states[axis].displayed || this.hidden('marker')) return null;
        return this.sets[axis].hit(along, this.tokens.markerReach);
    }

    pressMarker(axis: Axis, m: PlacedMarker | null): void {
        this.sets[axis].setPressed(m);
        this.states[axis].pressed = m !== null;
        this.request();
    }

    activateMarker(axis: Axis, m: PlacedMarker): void {
        if (this.emit('markeractivate', m.marker, true, m.members.map((x) => x.marker))) this.scrollTo(axis, m.anchor, true);
    }

    setRegionHover(axis: Axis, region: Region): void {
        const bar = this.bars[axis];
        bar.thumb.set({ hover: region === 'thumb' });
        bar.buttonStart.set({ hover: region === 'button-start' });
        bar.buttonEnd.set({ hover: region === 'button-end' });
        this.request();
    }

    setMarkerHover(axis: Axis, m: PlacedMarker | null, clientX: number, clientY: number): void {
        const prev = this.hovered;
        const moved = prev === null ? m !== null : m === null || prev.axis !== axis || prev.placed.marker.id !== m.marker.id;
        if (prev && prev.axis !== axis) this.sets[prev.axis].setHover(null);
        this.sets[axis].setHover(m);
        this.hovered = m ? { axis, placed: m } : null;
        if (!moved) return;

        clearTimeout(this.cardTimer);
        this.cardTimer = 0;
        const along = this.along(axis, clientX, clientY);
        if (!m) {
            if (!prev) return;
            this.emit('markerleave', prev.placed.marker, false, prev.placed.members.map((x) => x.marker));
            this.hideCard(along > prev.placed.offset);
            return;
        }

        this.emit('markerenter', m.marker, false, m.members.map((x) => x.marker));
        if (this.cards.shownId !== null) {
            // A card is open: the next marker swaps it at once, in the direction of travel.
            const forward = prev ? m.offset > prev.placed.offset : along < m.offset;
            this.showCard(m, axis, forward);
            return;
        }
        const forward = along < m.offset;
        const delay = this.tokens.cardDelay;
        if (delay <= 0) {
            this.showCard(m, axis, forward);
            return;
        }
        this.cardTimer = window.setTimeout(() => {
            this.cardTimer = 0;
            if (this.hovered && this.hovered.placed.marker.id === m.marker.id) this.showCard(m, axis, forward);
        }, delay);
    }

    setBarHover(axis: Axis, on: boolean): void {
        this.states[axis].hover = on;
        this.syncCursor();
        this.request();
    }

    // The bars take no pointer events, so the cursor is the host's: grabbing while a thumb is
    // dragged, the default arrow over a bar, otherwise the author's own. A page scrollbar sets it on
    // the root element, as its host is only an overlay. The author's inline value is put back.
    private syncCursor(): void {
        const dragging = AXES.some((axis) => this.states[axis].dragging);
        const over = AXES.some((axis) => this.states[axis].hover);
        const want = dragging ? 'grabbing' : over ? 'default' : '';
        if (want === this.cursorWritten) return;
        const el = this.target.isDocument ? document.documentElement : this.host;
        if (this.cursorWritten === '') this.cursorSaved = el.style.cursor;
        this.cursorWritten = want;
        el.style.cursor = want === '' ? this.cursorSaved : want;
    }

    setPressed(axis: Axis, region: Region, pageDirection: -1 | 0 | 1): void {
        const bar = this.bars[axis];
        bar.thumb.set({ pressed: region === 'thumb' });
        bar.buttonStart.set({ pressed: region === 'button-start' });
        bar.buttonEnd.set({ pressed: region === 'button-end' });
        bar.pieceStart.set({ pressed: region === 'track' && pageDirection === -1 });
        bar.pieceEnd.set({ pressed: region === 'track' && pageDirection === 1 });
        const state = this.states[axis];
        state.pressed = region !== null;
        const dragging = region === 'thumb';
        if (dragging !== state.dragging) {
            // A drag writes the scroll itself, and the thumb is drawn under the pointer without lag.
            if (dragging) this.glide.stop(axis);
            // Nothing may smooth the writes of a drag.
            this.target.holdInstant(dragging || AXES.some((a) => a !== axis && this.states[a].dragging));
        }
        state.dragging = dragging;
        this.syncCursor();
        this.request();
    }

    invalidate(): void {
        this.scrollDirty = true;
        this.request();
    }

    // ---- Build -----------------------------------------------------------------------------

    private build(): void {
        if (this.kitWait) this.kitWait();
        this.kitWait = null;
        const name = this.attr('kit');
        this.kit = name ? scrollbarKit(name) : null;
        // A kit defined later rebuilds the bars with it; meanwhile the default parts stand in.
        if (name && !this.kit) this.kitWait = whenKitDefined(name, () => this.rebuild());
        const classes = partClasses(this.kit);
        // Parts are made when the layout first needs them (Bar.setParts, MarkerSet.materialize, a card's
        // first opening), and kept: a bar that never shows, a kind the look hides, markers
        // that are not drawn and cards that never open make none. Each is told of a new element
        // before it is in the page, to forward its layers.
        const made = (kind: PartKind, el: HTMLElement): void => this.forwardLayers(kind, el);
        this.bars = { vertical: new Bar('vertical', classes, made), horizontal: new Bar('horizontal', classes, made) };
        const marker = (el: HTMLElement): void => made('marker', el);
        this.sets = {
            vertical: new MarkerSet('vertical', this.bars.vertical.markers, classes.marker, marker),
            horizontal: new MarkerSet('horizontal', this.bars.horizontal.markers, classes.marker, marker),
        };
        this.corner = new Piece(() => createPart(classes.corner), ['corner'], 'corner', 'corner', 'vertical', (el) => {
            made('corner', el);
            this.frameEl.appendChild(el);
        });
        this.cards = new CardLayer(this.cardsEl, classes.card, (el) => made('card', el));
        for (const axis of AXES) this.frameEl.appendChild(this.bars[axis].root.el);
        this.frameEl.setAttribute('aria-hidden', 'true');
        this.cardsEl.setAttribute('aria-hidden', 'true');
        this.syncHide();
    }

    // The `thumb-layers`, `button-layers`, ... attributes of the host, forwarded to the parts of
    // that kind as their `layers` attribute (see AxScrollbarPart.layerNames_). An attribute that is
    // not there leaves the part with the layers of its default look.
    private forwardLayers(kind: PartKind, el: HTMLElement): void {
        const value = this.attr(`${kind}-layers`);
        if (value === null) {
            if (el.hasAttribute('layers')) el.removeAttribute('layers');
        } else setAttr(el, 'layers', value);
    }

    // The parts that are made, for a change of the attributes.
    private syncLayers(): void {
        if (!this.bars) return;
        for (const kind of PART_KINDS) {
            for (const el of this.madeParts(kind)) this.forwardLayers(kind, el);
        }
    }

    // The elements of the parts of a kind that are made now.
    private madeParts(kind: PartKind): HTMLElement[] {
        const list: HTMLElement[] = [];
        const add = (piece: Piece): void => {
            if (piece.element) list.push(piece.element);
        };
        for (const axis of AXES) {
            const bar = this.bars[axis];
            if (kind === 'thumb') add(bar.thumb);
            else if (kind === 'button') [bar.buttonStart, bar.buttonEnd].forEach(add);
            else if (kind === 'track') add(bar.track);
            else if (kind === 'track-piece') [bar.pieceStart, bar.pieceEnd].forEach(add);
            else if (kind === 'marker') for (const placed of this.sets[axis].list) add(placed.part);
        }
        if (kind === 'corner') add(this.corner);
        if (kind === 'card') list.push(...this.cards.elements());
        return list;
    }

    // `indicator="pinned"`: the mouse indicator never ends, so the bars stay shown (the Always show scrollbars
    // setting of Windows). The bars are shown from the first frame, and a touch scroll shows the
    // same indicator.
    private indicatorPinned(): boolean {
        return this.attr('indicator') === 'pinned';
    }

    private pinnedApplied = false;

    private syncPinned(): void {
        if (!this.connected) return;
        if (this.indicatorPinned()) {
            this.pinnedApplied = true;
            clearTimeout(this.indicatorTimer);
            this.indicatorTimer = 0;
            if (this.indicator !== 'mouse') {
                this.setIndicator('mouse');
                this.request();
            }
        } else if (this.pinnedApplied) {
            this.pinnedApplied = false;
            if (this.indicator !== 'none') this.armIndicator();
        }
    }

    // The kit may have been defined, or its name changed, while the element was not connected.
    private syncKit(): void {
        const name = this.attr('kit');
        const kit = name ? scrollbarKit(name) : null;
        if (kit !== this.kit || (kit === null && name !== null && this.kitWait === null)) this.rebuild();
    }

    // The hide attribute, or the default of the kit, or the default look's. A kit without a default
    // hides nothing.
    private syncHide(): void {
        const kit = this.kit;
        const value = this.attr('hide');
        const fallback = kit ? (kit.hide !== undefined ? kit.hide : '') : DEFAULT_HIDE;
        this.hideList = new HideList(value !== null ? value : fallback);
    }

    // The kinds the look leaves out of a bar now.
    private barHidden(): BarHidden {
        return { thumb: this.hidden('thumb'), buttons: this.hidden('button'), track: this.hidden('track'), pieces: this.hidden('track-piece'), markers: this.hidden('marker') };
    }

    // Whether a bar that is shown now lacks a part the look shows: the layout pass makes it, and what
    // was read of the bar before that is read again.
    private partsPending(displayed: Record<Axis, boolean>): boolean {
        const hidden = this.barHidden();
        return AXES.some((axis) => displayed[axis] && this.bars[axis].missing(hidden));
    }

    // The parts the look shows now, on the bars that are shown, are made if they never were, and
    // the parts it leaves out now go: a hovered marker and an open card of a hidden kind, so that
    // nothing of them stays behind.
    // Returns whether a part came or went, which changes the room of the track.
    private applyHide(displayed: Record<Axis, boolean>): boolean {
        const markers = this.hidden('marker');
        let changed = false;
        const hidden = this.barHidden();
        for (const axis of AXES) {
            if (this.bars[axis].setParts(displayed[axis], hidden)) changed = true;
            if (markers) {
                this.sets[axis].setHover(null);
                this.sets[axis].setPressed(null);
            }
        }
        if (markers) this.hovered = null;
        if (markers || this.hidden('card')) {
            this.cards.hide(false);
            this.card = null;
        }
        return changed;
    }

    // Every piece that is a part of the bars, the markers and the corner (made or not).
    private pieces(): Piece[] {
        const list: Piece[] = [this.corner];
        for (const axis of AXES) {
            const bar = this.bars[axis];
            list.push(bar.buttonStart, bar.buttonEnd, bar.track, bar.pieceStart, bar.pieceEnd, bar.thumb);
            for (const placed of this.sets[axis].list) list.push(placed.part);
        }
        return list;
    }

    // Elements whose size changes the layout: the host, the viewport and content (or the page
    // root and body), and the bars.
    private observedElements(): Element[] {
        const list: Element[] = [this.host];
        if (this.options.viewport) {
            list.push(this.options.viewport);
            const content = this.root.querySelector('.content');
            if (content) list.push(content);
        } else {
            list.push(document.documentElement);
            if (document.body) list.push(document.body);
        }
        for (const axis of AXES) list.push(this.bars[axis].root.el, this.bars[axis].area);
        return list;
    }

    // The page's bars follow the content of the document, by observation (nothing is polled, so an
    // idle page costs nothing): the resize observer sees the root, the body and the children of the
    // body (which is where a page's content grows), the mutation observer a node added or removed,
    // and loads (images, fonts) that change what the content needs. Each only marks a layout pass.
    private watchDocument(): void {
        this.documentObserver = new MutationObserver(this.onDocumentMutation);
        this.documentObserver.observe(document.documentElement, { childList: true, subtree: true });
        this.syncBodyChildren();
        document.addEventListener('load', this.onLayoutChange, CAPTURE_PASSIVE);
        const fonts = document.fonts as FontFaceSet | undefined;
        if (fonts && fonts.addEventListener) fonts.addEventListener('loadingdone', this.onLayoutChange);
    }

    private unwatchLoads(): void {
        document.removeEventListener('load', this.onLayoutChange, CAPTURE_PASSIVE);
        const fonts = document.fonts as FontFaceSet | undefined;
        if (fonts && fonts.removeEventListener) fonts.removeEventListener('loadingdone', this.onLayoutChange);
    }

    // The children of the body are observed for their size, as they come and go.
    private syncBodyChildren(): void {
        const observer = this.resizeObserver;
        const body = document.body;
        if (!observer || !body) return;
        const next = new Set<Element>();
        for (let i = 0; i < body.children.length && next.size < MAX_BODY_CHILDREN; i++) {
            const child = body.children[i];
            if (child !== this.host) next.add(child);
        }
        this.bodyChildren.forEach((el) => {
            if (!next.has(el)) observer.unobserve(el);
        });
        next.forEach((el) => {
            if (!this.bodyChildren.has(el)) observer.observe(el);
        });
        this.bodyChildren = next;
    }

    private readonly onDocumentMutation = (records: MutationRecord[]): void => {
        // Our own host is in the document: its changes (the states, a marker part) are not the content's.
        if (records.some((r) => r.target === document.body)) this.syncBodyChildren();
        this.onLayoutChange();
    };

    private syncSelectorObserver(): void {
        const observer = this.selectorObserver;
        if (!observer || !this.connected) return;
        observer.disconnect();
        // A list set as `markers` replaces the selector, and then nothing needs watching.
        if (this.attr('marker-selector') !== null && this.entries === null) {
            observer.observe(this.contentRoot(), { childList: true, subtree: true, characterData: true, attributes: true });
        }
    }

    // Where the elements of the content are: the light DOM of the scroll view, or the page body.
    private contentRoot(): Node {
        if (this.options.viewport) return this.host;
        return document.body || document.documentElement;
    }

    // The markers of marker-selector now: every element it matches, in document order.
    private selectorMarkers(): ScrollMarker[] {
        const selector = this.attr('marker-selector');
        if (selector === null) return [];
        const scope: ParentNode = this.options.viewport ? this.host : document;
        const axis = this.markerAxis();
        let nodes: NodeListOf<Element> | Element[] = [];
        try {
            nodes = scope.querySelectorAll(selector);
        } catch {
            // An invalid selector makes no markers.
        }
        const list: ScrollMarker[] = [];
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            list.push({ id: el.id || `ax-marker-${i}`, label: (el.textContent || '').trim(), axis, element: el });
        }
        return list;
    }

    // Whether the selector matches other elements (or labels them otherwise) than the markers made
    // of it last time. A query, not a guess from the mutation records: a class that makes an element
    // match, and a removed match whose selector depends on an ancestor (a detached node no longer
    // matches), are only seen by asking the selector again.
    private selectorChanged(): boolean {
        const now = this.selectorMarkers();
        const was = this.matched;
        return now.length !== was.length || now.some((m, i) => m.element !== was[i].element || m.id !== was[i].id || m.label !== was[i].label);
    }

    // ---- Frame client (6.1) ----------------------------------------------------------------
    //
    // The controller is a client of the scheduler of Surface (the one every surface of the page runs
    // in): request() asks for a frame and the scheduler calls read, compute and write, in that order,
    // for every client that asked, so no client reads after another one has written. Anything that
    // changes (an attribute, a token, a scroll, a resize, a mutation) only marks a dirty flag and asks
    // for a frame; the frame reads once and writes after. With nothing marked there is no frame.

    private request(): void {
        this.stateDirty = true;
        if (this.connected && !this.awaitingLayout) services().scheduler.request(this);
    }

    // Surface's priorities: a press on a bar is first, then a pointer at one, then a scroll that is
    // on the way (the glide, the thumb following), then whatever only has to settle.
    priority(): number {
        if (AXES.some((axis) => this.states[axis].pressed || this.states[axis].dragging)) return PRIORITY_PRESSED;
        if (AXES.some((axis) => this.states[axis].hover || this.states[axis].near)) return PRIORITY_POINTER;
        if (this.moving || this.scrollDirty || this.glide.running) return PRIORITY_SCROLL;
        return PRIORITY_IDLE;
    }

    // Phase 1: everything the frame needs from the DOM, read before anything of the page is written.
    read(now: number): void {
        this.frame = null;
        if (!this.connected) return;
        const dt = this.lastTime ? Math.min(MAX_FRAME, now - this.lastTime) : FIRST_FRAME;
        this.lastTime = now;
        if (this.refreshDirty) this.applyRefresh();
        // The glide writes first, so this frame draws where it went (a scroll offset is not a layout).
        if (this.glide.running) {
            this.glide.step(dt);
            this.scrollDirty = true;
        }
        // The query of the selector, and a rebuild of the markers only when it found something else.
        if (this.selectorDirty) {
            this.selectorDirty = false;
            if (this.entries === null && this.selectorChanged()) this.listDirty = true;
        }
        if (!(this.listDirty || this.layoutDirty || this.markersDirty || this.scrollDirty || this.stateDirty)) {
            this.lastTime = 0;
            return;
        }
        // A scroll size that is not the one the bars were laid out for (content that grew where no
        // observer sees it, a rule that changed it) is a layout pass now, in the first frame that runs
        // (a scroll, a pointer move), rather than a bar that is wrong until the next resize.
        if (!this.layoutDirty && this.sizeChanged()) this.layoutDirty = true;

        const layout = this.layoutDirty ? this.readLayout() : null;
        // A bar that is shown for the first time lacks its parts, which this frame makes: its track is
        // read without the room of the buttons, so nothing is drawn from it (a thumb or a marker drawn
        // there would slide to its place in the next frame). The next frame reads it again.
        const stale = layout !== null && this.partsPending(layout.displayed);
        const target = this.target;
        // The markers are measured for a new list, for a layout pass and when asked; hidden ones are
        // not measured: the layout pass that shows them again measures them.
        const markersWanted = !this.hidden('marker') && !stale;
        let list: ScrollMarker[] | null = null;
        if (this.listDirty) list = this.readMarkerList();
        let positions: Map<ScrollMarker, number> | null = null;
        if (markersWanted && (list || this.markersDirty || layout)) {
            const markers = list || this.currentMarkers();
            positions = MarkerSet.measure(target, markers);
        }
        const position: Record<Axis, number> = { vertical: 0, horizontal: 0 };
        for (const axis of AXES) position[axis] = target.position(axis);
        this.frame = {
            dt,
            rtl: target.rtl(),
            snapping: this.snapping(),
            tau: this.followTau(),
            position,
            list,
            positions,
            layout,
            stale,
            card: this.readCard(),
            exact: { vertical: null, horizontal: null },
            drawn: { vertical: null, horizontal: null },
            moving: false,
        };
    }

    // Phase 2: the math, no DOM: where each thumb is and where it is drawn.
    compute(_now: number): void {
        const frame = this.frame;
        if (!frame) return;
        const { layout, dt } = frame;
        if (layout) {
            for (const axis of AXES) {
                const state = this.states[axis];
                state.displayed = layout.displayed[axis];
                state.metrics = frame.stale ? null : layout.metrics[axis];
                state.origin = layout.origin[axis];
            }
        }
        for (const axis of AXES) {
            const state = this.states[axis];
            const exact = this.exactLayout(axis, frame.position[axis]);
            state.layout = exact && this.snapped(axis, exact);
            if (!exact || !state.metrics) {
                state.shown = null;
                frame.drawn[axis] = null;
                continue;
            }
            // The drawn thumb follows the real one; hit tests keep using the real one.
            state.shown = followThumb(state.dragging ? null : state.shown, exact.thumbOffset, exact.thumbLength, dt, frame.tau);
            if (state.shown.offset !== exact.thumbOffset || state.shown.length !== exact.thumbLength) frame.moving = true;
            frame.exact[axis] = exact;
            frame.drawn[axis] = this.snapped(axis, { ...exact, thumbOffset: state.shown.offset, thumbLength: state.shown.length });
        }
    }

    // Phase 3: the writes. The layout first (what is shown, the insets), then the markers' parts, then
    // each bar and its markers, then the state of the parts and of the host.
    write(_now: number, _quality: Quality): void {
        const frame = this.frame;
        this.frame = null;
        if (!frame || !this.connected) return;
        let remeasure = false;
        if (this.refreshWrites) this.applyRefreshWrites();
        if (frame.layout) {
            this.layoutDirty = false;
            remeasure = this.writeLayout(frame.layout);
            this.placeDirty = true;
        }
        const markers = !this.hidden('marker');
        if (frame.list) {
            this.listDirty = false;
            this.applyMarkerList(frame.list);
        }
        if (frame.positions) {
            this.markersDirty = false;
            this.placeDirty = true;
            for (const axis of AXES) this.sets[axis].apply(frame.positions);
        } else if (frame.layout || frame.list) {
            // Not measured (hidden markers): the layout pass that shows them again measures them.
            this.markersDirty = true;
        }

        const placing = this.placeDirty && markers;
        if (markers) this.placeDirty = false;
        let moving = frame.moving;
        let markersMoved = false;
        for (const axis of AXES) {
            const state = this.states[axis];
            const drawn = frame.drawn[axis];
            const exact = frame.exact[axis];
            if (!drawn || !exact || !state.metrics) continue;
            this.bars[axis].render(drawn, frame.rtl, frame.snapping);
            const set = this.sets[axis];
            if (placing) {
                set.place(exact, state.metrics.client, this.alignment(), this.tokens.markerSpacing);
                // The marks of a bar that is drawn get their elements, the first time they are placed.
                set.materialize();
            }
            if (placing || (state.markersMoving && markers)) {
                state.markersMoving = set.draw(frame.dt, frame.tau, exact.track, frame.rtl, frame.snapping ? state.origin : null);
                moving = moving || state.markersMoving;
                markersMoved = true;
            }
            if (markers) set.updateTokens(drawn);
        }

        const shared = AXES.map((axis) => this.barState(axis));
        AXES.forEach((axis, i) => {
            this.bars[axis].flush(shared[i]);
            this.sets[axis].flush(shared[i]);
        });
        // The corner belongs to both bars.
        const [v, h] = shared;
        this.corner.set({ indicator: v.indicator, disabled: v.disabled && h.disabled, engaged: v.engaged || h.engaged, rtl: v.rtl });
        this.corner.flush();
        this.writeStates();
        // Markers keep their place on the track while scrolling; a card moves only with its marker.
        if (markersMoved) this.updateCard(frame.card);
        this.scrollDirty = false;
        this.stateDirty = false;
        this.moving = moving;
        // No idle frames: the client asks again only while something is on its way (or the layout
        // it wrote has to be read again).
        if (remeasure) this.layoutDirty = true;
        if (moving || this.glide.running || remeasure) this.request();
        else this.lastTime = 0;
    }

    // The scroll size or the client size of an axis is not what the bars were laid out for.
    private sizeChanged(): boolean {
        return AXES.some((axis) => {
            const seen = this.seen[axis];
            return seen !== null && (seen.client !== this.target.client(axis) || seen.size !== this.target.size(axis));
        });
    }

    // The bar and the track of the open card, which its place follows (see updateCard).
    private readCard(): FrameRead['card'] {
        const shown = this.card;
        if (!shown || this.cards.shownId !== shown.id) return null;
        const bar = this.bars[shown.axis];
        return { axis: shown.axis, barRect: bar.root.el.getBoundingClientRect(), area: bar.area.getBoundingClientRect() };
    }

    private layoutFor(axis: Axis): AxisLayout | null {
        const layout = this.exactLayout(axis);
        return layout && this.snapped(axis, layout);
    }

    // The layout at the live scroll position, before any snapping.
    private exactLayout(axis: Axis, position: number = this.target.position(axis)): AxisLayout | null {
        const state = this.states[axis];
        if (!state.displayed || !state.metrics) return null;
        return layoutAxis({ ...state.metrics, position });
    }

    private snapped(axis: Axis, layout: AxisLayout): AxisLayout {
        return this.snapping() ? snapLayout(layout, this.states[axis].origin, devicePixelRatio()) : layout;
    }

    private reducedMotion(): boolean {
        return this.reduced !== null && this.reduced.matches;
    }

    private followTau(): number {
        return this.reducedMotion() ? 0 : this.tokens.thumbSmoothing;
    }

    // `snap`: thumb edges and markers on whole device pixels, for themes drawn pixel by pixel.
    private snapping(): boolean {
        return this.attr('snap') !== null;
    }

    private barState(axis: Axis): BarState {
        const state = this.states[axis];
        this.updateExpanded(axis);
        return { indicator: this.indicator, disabled: !!state.layout && !state.layout.scrollable, engaged: state.expanded, rtl: this.target.rtl() };
    }

    // The bar is engaged for the parts (`engaged`) once engaged() has held for the expand delay,
    // and not any more after the contract delay once it has stopped (the begin times of the XAML
    // ScrollBar's expand and contract storyboards). With both delays 0s it follows them at once.
    private updateExpanded(axis: Axis): void {
        const state = this.states[axis];
        const want = this.engaged(axis);
        if (want === state.expandedWant) return;
        state.expandedWant = want;
        clearTimeout(state.expandTimer);
        state.expandTimer = 0;
        const delay = want ? this.tokens.expandDelay : this.tokens.contractDelay;
        if (delay <= 0 || this.reducedMotion()) {
            state.expanded = want;
            return;
        }
        state.expandTimer = window.setTimeout(() => {
            state.expandTimer = 0;
            state.expanded = state.expandedWant;
            this.request();
        }, delay);
    }

    // The bar is engaged: the thumb is hovered, a marker of the bar is hovered, the thumb is
    // dragged, or the pointer is in the hot zone (the collective state of the original's markerActive
    // look, see marker-look.ts).
    private engaged(axis: Axis): boolean {
        const state = this.states[axis];
        return state.near || state.dragging || this.bars[axis].thumb.state.hover || (this.hovered !== null && this.hovered.axis === axis);
    }

    private writeStates(): void {
        for (const axis of AXES) {
            const state = this.states[axis];
            const tokens: string[] = [];
            if (state.displayed) tokens.push('visible');
            if (state.layout && !state.layout.scrollable) tokens.push('disabled');
            if (state.hover) tokens.push('hover');
            if (state.near) tokens.push('near');
            if (state.expanded) tokens.push('engaged');
            if (state.pressed) tokens.push('pressed');
            setAttr(this.host, `${axis}-state`, tokens.join(' '));
        }
    }

    // ---- Layout pass (6.2) -----------------------------------------------------------------
    //
    // Split in two so that it fits the phases of a frame: readLayout() reads what the bars and the
    // scroller are now; writeLayout() decides from it what is shown and where the bars sit, and
    // says whether that changed what the reads depend on (a bar that is shown for the first time, an
    // inset, a part that went), in which case the next frame reads again. A layout that does not
    // change what it read (a resize that moved nothing of the bars) costs one frame, as every other.

    private readLayout(): LayoutRead {
        const target = this.target;
        target.refreshDirection();
        const rtl = target.rtl();
        const displayed: Record<Axis, boolean> = { vertical: false, horizontal: false };
        const thickness: Record<Axis, number | null> = { vertical: null, horizontal: null };
        const metrics: Record<Axis, Metrics | null> = { vertical: null, horizontal: null };
        const origin: Record<Axis, number> = { vertical: 0, horizontal: 0 };
        for (const axis of AXES) {
            const client = target.client(axis);
            const size = target.size(axis);
            this.seen[axis] = { client, size };
            const mode = this.mode(axis);
            displayed[axis] = mode === 'always' || (mode === 'auto' && size - client > 0.5);
            const bar = this.bars[axis];
            // A bar that was not laid out (display none) has no thickness and no track to read yet.
            if (!this.states[axis].laidOut) continue;
            thickness[axis] = bar.thickness();
            if (!displayed[axis]) continue;
            metrics[axis] = { client, size, track: bar.trackLength(), minThumb: bar.minThumb() };
            // A page scroll moves the area by whole pixels, so the fraction read here stays valid.
            const area = bar.area.getBoundingClientRect();
            origin[axis] = axis === 'vertical' ? area.top : rtl ? -area.right : area.left;
        }
        return { rtl, displayed, thickness, metrics, origin };
    }

    // Steps 1 to 3 of the layout: what is shown, then the bars, the corner and the host custom
    // properties. The scroller is never made smaller: keeping content clear of the bars is the
    // container's, with the two size properties. Returns whether a bar that the reads came from
    // changed under them.
    private writeLayout(read: LayoutRead): boolean {
        let changed = false;
        const { rtl } = read;
        for (const axis of AXES) {
            const state = this.states[axis];
            // A bar that shows for the first time was not read.
            if (read.displayed[axis] && !state.laidOut) changed = true;
            this.bars[axis].setDisplayed(read.displayed[axis]);
            state.laidOut = read.displayed[axis];
        }
        if (this.applyHide(read.displayed)) changed = true;
        this.frameEl.classList.toggle('rtl', rtl);

        const vertical = read.displayed.vertical;
        const horizontal = read.displayed.horizontal;
        const vT = vertical ? read.thickness.vertical ?? 0 : 0;
        const hT = horizontal ? read.thickness.horizontal ?? 0 : 0;
        const both = vertical && horizontal;

        const hBar = this.bars.horizontal.root.el;
        if (writeStyle(this.bars.vertical.root.el, 'bottom', inset(both ? hT : 0))) changed = true;
        if (writeStyle(hBar, rtl ? 'left' : 'right', inset(vT))) changed = true;
        if (writeStyle(hBar, rtl ? 'right' : 'left', '')) changed = true;

        // The corner is made when the bars meet, and the look shows it.
        const corner = both && !this.hidden('corner') ? this.corner.ensure() : this.corner.element;
        if (corner) {
            writeStyle(corner, 'display', both && !this.hidden('corner') ? '' : 'none');
            writeStyle(corner, 'width', `${vT}px`);
            writeStyle(corner, 'height', `${hT}px`);
        }

        writeStyle(this.host, '--ax-scrollbar-vertical-size', vertical ? `${vT}px` : '0px');
        writeStyle(this.host, '--ax-scrollbar-horizontal-size', horizontal ? `${hT}px` : '0px');
        this.rects = { vertical: null, horizontal: null };
        return changed;
    }

    private mode(axis: Axis): 'auto' | 'always' | 'hidden' {
        const value = this.attr(axis);
        return value === 'always' || value === 'hidden' ? value : 'auto';
    }

    // ---- Markers (6.5) ---------------------------------------------------------------------

    private markerAxis(): Axis {
        return this.attr('marker-axis') === 'horizontal' ? 'horizontal' : 'vertical';
    }

    private normalise(): ScrollMarker[] {
        const axis = this.markerAxis();
        if (this.entries === null) return [];
        return this.entries.map((entry) => (isElement(entry) ? elementMarker(entry, axis) : objectMarker(entry)));
    }

    // The markers now (read): the list that was set, read again as the label of an element may have
    // changed, or what the selector matches.
    private readMarkerList(): ScrollMarker[] {
        let list: ScrollMarker[];
        if (this.entries !== null) {
            this.list = this.normalise();
            list = this.list.slice();
        } else {
            list = this.selectorMarkers();
        }
        this.matched = this.entries === null ? list : [];
        return list;
    }

    // The markers the bars have parts for, both axes.
    private currentMarkers(): ScrollMarker[] {
        const markers: ScrollMarker[] = [];
        for (const axis of AXES) for (const placed of this.sets[axis].list) markers.push(placed.marker);
        return markers;
    }

    // Builds the parts of a new list (write).
    private applyMarkerList(list: ScrollMarker[]): void {
        for (const axis of AXES) this.sets[axis].set(list);
        // A card whose marker is gone closes, and so does a hover on it.
        const shown = this.card;
        if (shown && !list.some((m) => m.id === shown.id)) {
            this.cards.hide(false);
            this.card = null;
        }
        const hovered = this.hovered;
        if (hovered && !list.some((m) => m.id === hovered.placed.marker.id)) this.hovered = null;
    }

    private alignment(): number {
        // Centre by default, as the reference: the middle of the view meets the middle of the thumb.
        return this.attr('marker-align') === 'start' ? 0 : 0.5;
    }

    private placedOf(axis: Axis, id: string): PlacedMarker | null {
        return this.sets[axis].list.find((p) => p.marker.id === id) || null;
    }

    // Point and placement of a card for a marker at `offset` along its bar: the card meets the
    // inner edge of the bar, and the marker's centre.
    private cardPoint(axis: Axis, offset: number, rects?: { barRect: DOMRect; area: DOMRect }): { point: { x: number; y: number }; placement: Placement } {
        const bar = this.bars[axis];
        const barRect = rects ? rects.barRect : bar.root.el.getBoundingClientRect();
        const area = rects ? rects.area : bar.area.getBoundingClientRect();
        const rtl = this.target.rtl();
        if (axis === 'vertical') {
            return { point: { x: rtl ? barRect.right : barRect.left, y: area.top + offset }, placement: rtl ? 'right' : 'left' };
        }
        return { point: { x: area.left + physical(offset, 0, area.width, rtl), y: barRect.top }, placement: 'above' };
    }

    private showCard(m: PlacedMarker, axis: Axis, forward: boolean): void {
        // Hidden cards are not filled, sized nor placed.
        if (this.hidden('card')) return;
        const { point, placement } = this.cardPoint(axis, drawnOffset(m));
        const group = m.members.map((member) => member.marker);
        this.cards.show(m.marker, axis, point, placement, this.tokens.cardGap, forward, group);
        this.card = { axis, id: m.marker.id };
        // With reduced motion the card does not stay under a resting pointer (the reference):
        // it goes after the touch idle delay, and the next marker opens it again.
        clearTimeout(this.dismissTimer);
        this.dismissTimer = 0;
        if (this.reducedMotion()) {
            this.dismissTimer = window.setTimeout(() => {
                this.dismissTimer = 0;
                this.cards.hide(false);
            }, this.tokens.touchIdleDelay);
        }
    }

    // After a touch the bar keeps the hover for the touch idle delay (see BarInput), so the card
    // stays that long without a rule here.
    private hideCard(forward: boolean): void {
        this.cards.hide(forward);
    }

    // Keeps an open card on its marker while the layout moves.
    private updateCard(rects: FrameRead['card']): void {
        const shown = this.card;
        if (!shown || !rects || this.cards.shownId !== shown.id) return;
        const placed = this.placedOf(shown.axis, shown.id);
        if (!placed) return;
        const { point, placement } = this.cardPoint(shown.axis, drawnOffset(placed), rects);
        this.cards.reposition(point, placement, this.tokens.cardGap);
    }

    // `markers` lists every marker of a merged mark (the first is `marker`).
    private emit(type: string, marker: ScrollMarker, cancelable = false, markers: ScrollMarker[] = [marker]): boolean {
        return this.host.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, cancelable, detail: { marker, markers } }));
    }

    // ---- Indicator (6.3) and near (6.4) ----------------------------------------------------

    private setIndicator(kind: Indicator): void {
        if (this.indicator === kind) return;
        this.indicator = kind;
        if (kind !== 'none') this.lastShown = kind;
        setAttr(this.host, 'indicator-state', kind);
        setAttr(this.host, 'last-indicator', this.lastShown);
        this.layoutDirty = true;
    }

    private showIndicator(kind: 'mouse' | 'touch'): void {
        if (this.suspended()) return;
        if (this.indicatorPinned() || this.touchBar()) kind = 'mouse';
        this.setIndicator(kind);
        this.armIndicator();
        this.request();
    }

    // The indicator ends after a delay without a move. Every scroll and every pointer move starts that
    // delay again, so it is a deadline, not a timer set and cleared each time: one timer waits for
    // the deadline and, when it fires early because the deadline moved, waits again for what is left.
    private armIndicator(): void {
        if (this.indicatorPinned()) {
            clearTimeout(this.indicatorTimer);
            this.indicatorTimer = 0;
            return;
        }
        const touch = this.indicator === 'touch';
        const delay = touch ? this.tokens.touchIdleDelay : this.tokens.idleDelay;
        this.indicatorDeadline = performance.now() + delay;
        // A timer that waits for later than the deadline (the delay got shorter) is set again.
        if (this.indicatorTimer && this.indicatorTimerAt <= this.indicatorDeadline) return;
        clearTimeout(this.indicatorTimer);
        this.indicatorTimerAt = this.indicatorDeadline;
        this.indicatorTimer = window.setTimeout(this.indicatorDue, delay);
    }

    private readonly indicatorDue = (): void => {
        this.indicatorTimer = 0;
        const left = this.indicatorDeadline - performance.now();
        if (left > 1) {
            this.indicatorTimerAt = this.indicatorDeadline;
            this.indicatorTimer = window.setTimeout(this.indicatorDue, left);
            return;
        }
        this.expireIndicator();
    };

    private expireIndicator(): void {
        this.indicatorTimer = 0;
        // A pointer over a bar or in its hot zone, or a press on it, keeps the indicator.
        if (AXES.some((axis) => this.states[axis].hover || this.states[axis].near || this.states[axis].pressed)) {
            this.armIndicator();
            return;
        }
        if (this.indicator !== 'none') {
            this.setIndicator('none');
            this.request();
        }
    }

    private readonly onScroll = (): void => {
        this.scrollDirty = true;
        this.showIndicator(this.lastInput === 'touch' ? 'touch' : 'mouse');
    };

    private readonly onPageScroll = (): void => {
        this.rects = { vertical: null, horizontal: null };
    };

    private readonly onResize = (): void => {
        this.rects = { vertical: null, horizontal: null };
        this.layoutDirty = true;
        this.request();
    };

    // A host token changed (a style attribute, a rule, an animation): the parts that size from it and the
    // layout read it again, as after refresh().
    private readonly onTokenChange = (): void => {
        if (this.connected) this.refresh();
    };

    private readonly onLayoutChange = (): void => {
        this.layoutDirty = true;
        this.request();
    };

    private readonly onResizeObserved = (): void => {
        this.awaitingLayout = false;
        this.onLayoutChange();
    };

    // Any change of the content may change what the selector matches: one query on the next frame,
    // however many changes came before it. Our own attributes on the host (the states) are not the
    // content's.
    private readonly onContentChange = (records: MutationRecord[]): void => {
        if (records.every((r) => r.type === 'attributes' && r.target === this.host)) return;
        if (this.attr('marker-selector') === null || this.entries !== null) return;
        this.selectorDirty = true;
        this.request();
    };

    // Markers measured again on the next frame; our own cards and parts do not count.
    private readonly onSettled = (event: Event): void => {
        const path = event.composedPath();
        if (path.indexOf(this.frameEl) >= 0 || path.indexOf(this.cardsEl) >= 0) return;
        if (!AXES.some((axis) => this.sets[axis].list.some((m) => m.marker.element))) return;
        // A layout pass: a transform also changes the scroll range, which no observer sees.
        this.layoutDirty = true;
        this.request();
    };

    // Every press on the page (or the host) passes here first: one on a bar or in its hot zone is
    // the bar's. The bar and its zone are no element over the content (the bars take no pointer
    // events); the zone becomes the bar's only for a press that starts in it, which then holds the
    // pointer capture (as the reference's hit zone).
    private readonly onDown = (event: Event): void => {
        const e = event as PointerEvent;
        this.lastInput = e.pointerType;
        const touch = e.pointerType === 'touch';
        if (!this.interactive(touch)) return;
        // Read afresh: an ancestor that scrolled may have moved the bars since the last move.
        this.rects = { vertical: null, horizontal: null };
        const hit = this.routeAxis(e);
        if (!hit) {
            if (this.onCorner(e.clientX, e.clientY)) this.swallowCornerPress(e);
            return;
        }
        const input = this.inputs[hit.axis];
        if (!input || !input.start(e)) return;
        if (touch) this.touchTaken = true;
        // The bar takes no pointer events, so the press was over the content: its click must not
        // reach it.
        swallowClick();
    };

    // Whether a point is on the corner square, when it is shown. A native corner is no one's: it
    // takes the press and does nothing with it.
    private onCorner(x: number, y: number): boolean {
        const el = this.corner.element;
        if (!el || el.style.display === 'none') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    }

    // A press on the corner is swallowed: no focus change or text selection (default action of the
    // press), no click on the content under it. The wheel is not touched: it scrolls natively.
    private swallowCornerPress(e: PointerEvent): void {
        if (e.pointerType !== 'touch' && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        const stop = (ev: Event): void => ev.preventDefault();
        window.addEventListener('mousedown', stop, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('mousedown', stop, true), 0);
        swallowClick();
    }

    // The axis whose bar or hot zone is under the pointer of an event. Beside the bar, a scroller
    // nested in this one (under the pointer) keeps its own presses.
    private routeAxis(e: PointerEvent): { axis: Axis; onBar: boolean } | null {
        const x = e.clientX;
        const y = e.clientY;
        let found: { axis: Axis; onBar: boolean } | null = null;
        for (const axis of AXES) {
            const zone = this.zoneOf(axis, x, y);
            if (zone && (!found || zone.onBar)) found = { axis, onBar: zone.onBar };
        }
        if (!found || found.onBar) return found;
        const path = e.composedPath();
        for (const node of path) {
            if (node === this.host) break;
            if (isScroller(node)) return null;
        }
        return found;
    }

    // Wheels and keys scroll natively: a glide of ours would fight them. A wheel over a bar is no
    // exception: the bars take no pointer events, so it reaches the scroller, whose latching,
    // chaining and momentum are the browser's.
    private readonly onMouseInput = (): void => {
        this.lastInput = 'mouse';
        this.glide.stop();
    };

    // A touch that a bar took must not scroll the page or go on with a fling (the pointerdown
    // came first); only then is the touch cancelled, so elsewhere the page scrolls as usual. A touch
    // on the content takes the scroll over and stops the glide.
    private readonly onTouchStart = (event: Event): void => {
        const e = event as TouchEvent;
        const taken = this.touchTaken || AXES.some((axis) => this.inputs[axis]?.pressing);
        this.touchTaken = false;
        if (taken) {
            if (e.cancelable) e.preventDefault();
            return;
        }
        if (event.composedPath().indexOf(this.frameEl) < 0) this.glide.stop();
    };

    private readonly onMove = (event: Event): void => {
        const e = event as PointerEvent;
        if (e.pointerType === 'touch' || this.suspended()) return;
        const x = e.clientX;
        const y = e.clientY;
        this.updateNear(x, y);
        // The page scrollbar shows for a pointer at a bar, not for every move over the page; so does
        // a scroll view with `indicator="near"`.
        const zones = AXES.map((axis) => this.zoneOf(axis, x, y));
        const atBar = this.target.isDocument || this.attr('indicator') === 'near';
        if (!atBar || zones.some((z) => z !== null)) this.showIndicator('mouse');
        // During a press the bar that holds the pointer follows it itself.
        if (AXES.some((axis) => this.inputs[axis]?.pressing)) return;
        AXES.forEach((axis, i) => {
            const input = this.inputs[axis];
            const zone = zones[i];
            if (!input) return;
            if (zone && !this.nestedUnder(e, zone.onBar)) input.hoverAt(x, y, zone.onBar);
            else input.leave();
        });
    };

    private nestedUnder(e: PointerEvent, onBar: boolean): boolean {
        if (onBar) return false;
        for (const node of e.composedPath()) {
            if (node === this.host) return false;
            if (isScroller(node)) return true;
        }
        return false;
    }

    // A finger leaves when it is lifted: its state lingers instead (see BarInput).
    private readonly onLeave = (event: Event): void => {
        if ((event as PointerEvent).pointerType === 'touch') return;
        for (const axis of AXES) {
            this.setNear(axis, false);
            this.inputs[axis]?.leave();
        }
    };

    private leaveTarget(): EventTarget {
        return this.target.isDocument ? document.documentElement : this.host;
    }

    setNear(axis: Axis, near: boolean): void {
        if (this.states[axis].near === near) return;
        this.states[axis].near = near;
        this.request();
    }

    // The near state: the pointer is in the hot zone of a bar, along its span. The zone is
    // --ax-scrollbar-hotzone deep from the bar's outer edge inward (percentages of the thickness).
    private updateNear(x: number, y: number): void {
        const rtl = this.target.rtl();
        for (const axis of AXES) {
            const state = this.states[axis];
            this.setNear(axis, state.displayed && this.isNear(axis, x, y, rtl));
        }
    }

    private isNear(axis: Axis, x: number, y: number, rtl: boolean): boolean {
        const r = this.barRect(axis);
        const vertical = axis === 'vertical';
        const zone = this.tokens.hotzoneFor(vertical ? r.width : r.height);
        if (zone <= 0) return false;
        if (vertical) {
            if (y < r.top || y > r.bottom) return false;
            return rtl ? x >= r.left && x <= r.left + zone : x >= r.right - zone && x <= r.right;
        }
        return x >= r.left && x <= r.right && y >= r.bottom - zone && y <= r.bottom;
    }

    // Whether a point is on a shown bar (onBar) or in its hot zone; null for neither.
    private zoneOf(axis: Axis, x: number, y: number): { onBar: boolean } | null {
        if (!this.states[axis].displayed) return null;
        const r = this.barRect(axis);
        if (r.width <= 0 || r.height <= 0) return null;
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return { onBar: true };
        return this.isNear(axis, x, y, this.target.rtl()) ? { onBar: false } : null;
    }

    // Cached between pointer moves: a layout pass, a scroll of the page or a resize drops it.
    private barRect(axis: Axis): DOMRect {
        let r = this.rects[axis];
        if (!r) {
            r = this.bars[axis].root.el.getBoundingClientRect();
            this.rects[axis] = r;
        }
        return r;
    }

    // ---- Observers and config --------------------------------------------------------------

    private attr(name: string): string | null {
        return this.host.getAttribute(name);
    }
}
