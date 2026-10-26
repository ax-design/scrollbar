import { Bar } from './bar.js';
import type { BarState } from './bar.js';
import { CardLayer } from './cards.js';
import { followThumb } from './follow.js';
import type { Shown } from './follow.js';
import { Glide } from './glide.js';
import { DEFAULT_HIDE, HideList } from './hide.js';
import type { HidePart, ShownIndicator } from './hide.js';
import { BarInput } from './input.js';
import type { InputHost, Region } from './input.js';
import { MarkerSet } from './markers.js';
import type { PlacedMarker } from './markers.js';
import { layoutAxis, physical, snapLayout } from './geometry.js';
import type { AxisLayout, AxisMetrics } from './geometry.js';
import { createPart, partClasses, scrollbarKit, whenKitDefined } from './kits.js';
import type { ScrollbarKit } from './kits.js';
import { Piece, isPart, writeStyle } from './piece.js';
import type { ScrollTarget } from './target.js';
import { HostTokens } from './tokens.js';
import { AXES } from './types.js';
import type { Axis, Placement, ScrollMarker } from './types.js';
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
type Indicator = 'none' | 'mouse' | 'touch';

interface AxisState {
    displayed: boolean;
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

// Kept, not queried each time: its `matches` follows the setting.
const motionQuery = (): MediaQueryList | null =>
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

// Where a marker is drawn: a card sits beside the marker the user sees.
const drawnOffset = (m: PlacedMarker): number => (m.shown === null ? m.offset : m.shown);

// A node, not instanceof: the element may come from another window (an iframe).
const isElement = (entry: ScrollMarker | Element): entry is Element => typeof (entry as Node).nodeType === 'number' && (entry as Node).nodeType === 1;

// Ids of elements given as markers without an id of their own: the same element keeps its id
// across sets, so its card and hover survive a new list.
const elementIds = new WeakMap<Element, string>();
let elementCount = 0;

function elementMarker(el: Element, axis: Axis): ScrollMarker {
    let id = el.id;
    if (!id) {
        id = elementIds.get(el) || `ax-marker-element-${elementCount++}`;
        elementIds.set(el, id);
    }
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
    return { id, label, axis, element: el };
}

function clear(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// The scrollbars of one scroller (or of the page): the bars, the markers and the cards, the
// observers and the frame loop that keeps them in step with the scroll position.
export class ScrollbarController implements InputHost {
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
    private entries: (ScrollMarker | Element)[] | null = null;
    private list: ScrollMarker[] = [];
    // The kit of the kit attribute, null for the default parts or while it is not defined yet.
    private kit: ScrollbarKit | null = null;
    // Cancels the wait for a kit that is not defined yet.
    private kitWait: (() => void) | null = null;
    // The marker under the pointer, and the marker whose card is open or was last shown.
    private hovered: { axis: Axis; placed: PlacedMarker } | null = null;
    private card: { axis: Axis; id: string } | null = null;

    private connected = false;
    private frameId = 0;
    private layoutDirty = false;
    private scrollDirty = false;
    private markersDirty = false;
    private listDirty = false;
    private selectorDirty = false;
    // The markers that marker-selector made last, to see whether a new query differs.
    private matched: ScrollMarker[] = [];
    private stateDirty = false;
    private placeDirty = false;
    // Time of the last frame while something moves, 0 when nothing did.
    private lastTime = 0;

    private indicator: Indicator = 'none';
    // The indicator the bars show, or last showed while they fade out: it picks the parts of the
    // hide list.
    private lastShown: ShownIndicator = 'mouse';
    private hideList = new HideList(DEFAULT_HIDE);
    private indicatorTimer = 0;
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
    private attrObserver: MutationObserver | null = null;
    private selectorObserver: MutationObserver | null = null;

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
    set markers(value: Iterable<ScrollMarker | Element> | null) {
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
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(this.onLayoutChange);
            for (const el of this.observedElements()) this.resizeObserver.observe(el);
        }
        // A change of the text direction moves the bars.
        this.attrObserver = new MutationObserver(this.onLayoutChange);
        this.attrObserver.observe(this.host, { attributes: true, attributeFilter: ['dir'] });
        if (this.target.isDocument) this.attrObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
        this.selectorObserver = new MutationObserver(this.onContentChange);
        this.syncSelectorObserver();

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
        cancelAnimationFrame(this.frameId);
        this.frameId = 0;
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

    refresh(): void {
        // Now rather than on the next frame: a press right after must already glide with them.
        this.tokens.read();
        this.syncHide();
        this.syncLayers();
        this.syncPinned();
        // A change the parts cannot see (an attribute or a class around the element).
        for (const piece of this.pieces()) if (isPart(piece.el)) piece.el.refresh();
        this.layoutDirty = true;
        this.listDirty = true;
        this.syncSelectorObserver();
        this.syncSuspended();
        this.request();
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

    // `touch-input`: on touch the bars take input (a finger drags, pages and presses). Without it, the
    // default, the bars take no touch input: the touch indicator is the panning indicator.
    private touchInput(): boolean {
        return this.attr('touch-input') !== null;
    }

    // Whether a press of this pointer type may start on a bar now. A touch may start on a hidden
    // bar of the default look, as on the reference: the edge of the screen is where a finger scrubs.
    private interactive(touch: boolean): boolean {
        if (this.suspended()) return false;
        if (touch) return this.touchInput();
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
        return this.hideList.hidden(part, this.lastShown);
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
        this.bars = { vertical: new Bar('vertical', classes), horizontal: new Bar('horizontal', classes) };
        this.sets = {
            vertical: new MarkerSet('vertical', this.bars.vertical.markers, classes.marker),
            horizontal: new MarkerSet('horizontal', this.bars.horizontal.markers, classes.marker),
        };
        this.corner = new Piece(createPart(classes.corner), ['corner'], 'corner', 'corner');
        this.cards = new CardLayer(this.cardsEl, classes.card);
        for (const axis of AXES) this.frameEl.appendChild(this.bars[axis].root.el);
        this.frameEl.appendChild(this.corner.el);
        this.frameEl.setAttribute('aria-hidden', 'true');
        this.cardsEl.setAttribute('aria-hidden', 'true');
        this.syncHide();
        this.syncLayers();
    }

    // The `thumb-layers`, `button-layers`, ... attributes of the host, forwarded to the parts of
    // that kind as their `layers` attribute (see AxScrollbarPart.layerNames_). An attribute that is
    // not there leaves the part with the layers of its default look.
    private syncLayers(): void {
        if (!this.bars) return;
        const forward = (kind: PartKind, els: HTMLElement[]): void => {
            const value = this.attr(`${kind}-layers`);
            for (const el of els) {
                if (value === null) {
                    if (el.hasAttribute('layers')) el.removeAttribute('layers');
                } else setAttr(el, 'layers', value);
            }
        };
        const bars = AXES.map((axis) => this.bars[axis]);
        forward('thumb', bars.map((bar) => bar.thumb.el));
        forward('button', bars.flatMap((bar) => [bar.buttonStart.el, bar.buttonEnd.el]));
        forward('track', bars.map((bar) => bar.track.el));
        forward('track-piece', bars.flatMap((bar) => [bar.pieceStart.el, bar.pieceEnd.el]));
        forward('corner', [this.corner.el]);
        forward('marker', AXES.flatMap((axis) => this.sets[axis].list.map((placed) => placed.part.el)));
        forward('card', this.cards.elements());
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

    // The parts the look leaves out now go: a hovered marker and an open card of a hidden kind, so
    // that nothing of them stays behind.
    private applyHide(): void {
        const markers = this.hidden('marker');
        for (const axis of AXES) {
            this.bars[axis].setHidden({ thumb: this.hidden('thumb'), buttons: this.hidden('button'), track: this.hidden('track'), pieces: this.hidden('track-piece'), markers });
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
    }

    // Every piece that is a part element of the bars, the markers and the corner.
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

    // ---- Frame loop (6.1) ------------------------------------------------------------------

    private request(): void {
        this.stateDirty = true;
        if (this.connected && !this.frameId) this.frameId = requestAnimationFrame((time) => this.runFrame(time));
    }

    private runFrame(time: number): void {
        this.frameId = 0;
        if (!this.connected) return;
        const dt = this.lastTime ? Math.min(MAX_FRAME, time - this.lastTime) : FIRST_FRAME;
        this.lastTime = time;
        // The glide writes first, so this frame draws where it went.
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

        if (this.listDirty) {
            this.listDirty = false;
            this.collectMarkers();
            this.markersDirty = true;
        }
        // The layout pass writes before the markers are measured.
        if (this.layoutDirty) {
            this.layoutDirty = false;
            this.layoutPass();
            this.markersDirty = true;
            this.placeDirty = true;
        }
        // Hidden markers are not measured nor placed: the layout pass that shows them again
        // measures them.
        const markers = !this.hidden('marker');
        if (this.markersDirty && markers) {
            this.markersDirty = false;
            this.placeDirty = true;
            for (const axis of AXES) this.sets[axis].measure(this.target);
        }

        const rtl = this.target.rtl();
        const placing = this.placeDirty && markers;
        if (markers) this.placeDirty = false;
        const snapping = this.snapping();
        const tau = this.followTau();
        let moving = false;
        let markersMoved = false;
        for (const axis of AXES) {
            const state = this.states[axis];
            const layout = this.exactLayout(axis);
            state.layout = layout && this.snapped(axis, layout);
            if (!layout || !state.metrics) {
                state.shown = null;
                continue;
            }
            // The drawn thumb follows the real one; hit tests keep using the real one.
            state.shown = followThumb(state.dragging ? null : state.shown, layout.thumbOffset, layout.thumbLength, dt, tau);
            if (state.shown.offset !== layout.thumbOffset || state.shown.length !== layout.thumbLength) moving = true;
            const drawn = this.snapped(axis, { ...layout, thumbOffset: state.shown.offset, thumbLength: state.shown.length });
            this.bars[axis].render(drawn, rtl, snapping);
            const set = this.sets[axis];
            if (placing) set.place(layout, state.metrics.client, this.alignment(), this.tokens.markerSpacing);
            if (placing || (state.markersMoving && markers)) {
                state.markersMoving = set.draw(dt, tau, layout.track, rtl, snapping ? state.origin : null);
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
        if (markersMoved) this.updateCard();
        this.scrollDirty = false;
        this.stateDirty = false;
        // No idle frames: the loop goes on only while something is on its way.
        if (moving || this.glide.running) this.request();
        else this.lastTime = 0;
    }

    private layoutFor(axis: Axis): AxisLayout | null {
        const layout = this.exactLayout(axis);
        return layout && this.snapped(axis, layout);
    }

    // The layout at the live scroll position, before any snapping.
    private exactLayout(axis: Axis): AxisLayout | null {
        const state = this.states[axis];
        if (!state.displayed || !state.metrics) return null;
        return layoutAxis({ ...state.metrics, position: this.target.position(axis) });
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

    private layoutPass(): void {
        this.target.refreshDirection();
        this.tokens.read();
        this.decideDisplay();
        this.writeBars();
        // Read after the writes: the track of each bar depends on the inset of the other bar.
        for (const axis of AXES) {
            const state = this.states[axis];
            if (!state.displayed) {
                state.metrics = null;
                continue;
            }
            state.metrics = {
                client: this.target.client(axis),
                size: this.target.size(axis),
                track: this.bars[axis].trackLength(),
                minThumb: this.bars[axis].minThumb(),
            };
            // A page scroll moves the area by whole pixels, so the fraction read here stays valid.
            const area = this.bars[axis].area.getBoundingClientRect();
            state.origin = axis === 'vertical' ? area.top : this.target.rtl() ? -area.right : area.left;
        }
        this.rects = { vertical: null, horizontal: null };
    }

    // Steps 1 to 3: read client and size of both axes, then decide and write what is shown.
    private decideDisplay(): void {
        const rtl = this.target.rtl();
        const hostWidth = this.host.clientWidth;
        const hostHeight = this.host.clientHeight;
        for (const axis of AXES) {
            const client = this.target.client(axis);
            const size = this.target.size(axis);
            const mode = this.mode(axis);
            this.states[axis].displayed = mode === 'always' || (mode === 'auto' && size - client > 0.5);
        }
        for (const axis of AXES) this.bars[axis].setDisplayed(this.states[axis].displayed);
        this.applyHide();
        this.frameEl.classList.toggle('rtl', rtl);
        // The overlay covers the host. A document's overlay is sized by CSS.
        if (!this.target.isDocument) {
            writeStyle(this.frameEl, 'width', `${hostWidth}px`);
            writeStyle(this.frameEl, 'height', `${hostHeight}px`);
        }
    }

    // Step 4 (thickness, read) and step 5 (writes): the bars, the corner and the host custom
    // properties. The scroller is never made smaller: keeping content clear of the bars is the
    // container's, with the two size properties.
    private writeBars(): void {
        const rtl = this.target.rtl();
        const vertical = this.states.vertical.displayed;
        const horizontal = this.states.horizontal.displayed;
        const vT = vertical ? this.bars.vertical.thickness() : 0;
        const hT = horizontal ? this.bars.horizontal.thickness() : 0;
        const both = vertical && horizontal;

        writeStyle(this.bars.vertical.root.el, 'bottom', inset(both ? hT : 0));
        const hBar = this.bars.horizontal.root.el;
        writeStyle(hBar, rtl ? 'left' : 'right', inset(vT));
        writeStyle(hBar, rtl ? 'right' : 'left', '');

        writeStyle(this.corner.el, 'display', both && !this.hidden('corner') ? '' : 'none');
        writeStyle(this.corner.el, 'width', `${vT}px`);
        writeStyle(this.corner.el, 'height', `${hT}px`);

        writeStyle(this.host, '--ax-scrollbar-vertical-size', vertical ? `${vT}px` : '0px');
        writeStyle(this.host, '--ax-scrollbar-horizontal-size', horizontal ? `${hT}px` : '0px');
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
        return this.entries.map((entry) => (isElement(entry) ? elementMarker(entry, axis) : entry));
    }

    private collectMarkers(): void {
        let list: ScrollMarker[];
        if (this.entries !== null) {
            if (this.entries.some(isElement)) this.list = this.normalise();
            list = this.list.slice();
        } else {
            list = this.selectorMarkers();
        }
        this.matched = this.entries === null ? list : [];
        for (const axis of AXES) this.sets[axis].set(list);
        this.syncLayers();
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
    private cardPoint(axis: Axis, offset: number): { point: { x: number; y: number }; placement: Placement } {
        const bar = this.bars[axis];
        const barRect = bar.root.el.getBoundingClientRect();
        const area = bar.area.getBoundingClientRect();
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
    private updateCard(): void {
        const shown = this.card;
        if (!shown || this.cards.shownId !== shown.id) return;
        const placed = this.placedOf(shown.axis, shown.id);
        if (!placed) return;
        const { point, placement } = this.cardPoint(shown.axis, drawnOffset(placed));
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
        if (this.indicatorPinned()) kind = 'mouse';
        this.setIndicator(kind);
        this.armIndicator();
        this.request();
    }

    private armIndicator(): void {
        clearTimeout(this.indicatorTimer);
        this.indicatorTimer = 0;
        if (this.indicatorPinned()) return;
        const touch = this.indicator === 'touch';
        this.indicatorTimer = window.setTimeout(() => this.expireIndicator(), touch ? this.tokens.touchIdleDelay : this.tokens.idleDelay);
    }

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
        const el = this.corner.el;
        if (el.style.display === 'none') return false;
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
