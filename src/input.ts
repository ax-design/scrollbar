// Pointer handling of one bar: hover, drag of the thumb, the buttons, paging on the track,
// markers and touch gestures. Scrolling always goes through the host, which owns the layout and
// the scroller.
import type { Bar } from './bar.js';
import type { AxisLayout } from './geometry.js';
import { dragTo, jumpTo, layoutAt, pageDirection, pageStep } from './geometry.js';
import type { HidePart } from './hide.js';
import type { PlacedMarker } from './markers.js';
import type { Axis } from './types.js';

export type Region = 'thumb' | 'button-start' | 'button-end' | 'track' | null;


export interface InputHost {
    layout(axis: Axis): AxisLayout | null; // last computed layout, null when the bar is hidden
    along(axis: Axis, clientX: number, clientY: number): number; // logical pointer offset in the track area
    // Whether a point is on the bar or in its hot zone: the area whose presses and hover are the bar's.
    inZone(axis: Axis, clientX: number, clientY: number): boolean;
    // smooth: through the glide. Instant: stops the glide of that axis.
    scrollTo(axis: Axis, logical: number, smooth: boolean): void;
    // Through the glide, from its goal while it runs, so repeated steps add up.
    scrollBy(axis: Axis, delta: number): void;
    goal(axis: Axis): number | null; // where the glide of that axis is heading, null when none runs
    // Whether the look leaves a part out now: a hidden part takes no input.
    hidden(part: HidePart): boolean;
    trackClick(): 'page' | 'jump';
    client(axis: Axis): number; // client length of the scroller on that axis
    lineStep(): number;
    repeatDelay(): number;
    repeatInterval(): number;
    touchIdleDelay(): number; // ms the state of a touch stays after the finger is lifted (touch-idle-delay)
    hitMarker(axis: Axis, along: number): PlacedMarker | null;
    pressMarker(axis: Axis, m: PlacedMarker | null): void;
    activateMarker(axis: Axis, m: PlacedMarker): void;
    setRegionHover(axis: Axis, region: Region): void;
    setMarkerHover(axis: Axis, m: PlacedMarker | null, clientX: number, clientY: number): void;
    setBarHover(axis: Axis, on: boolean): void;
    // The near state, which a touch sets itself: it has no hover to come from.
    setNear(axis: Axis, on: boolean): void;
    // Shows the bars, as a press on them does.
    reveal(kind: 'mouse' | 'touch'): void;
    setPressed(axis: Axis, region: Region, pageDirection: -1 | 0 | 1): void;
    invalidate(): void;
}

// A marker counts as clicked on release when the pointer moved less than this in total.
const CLICK_SLOP = 4;
// track-click="jump", and a touch tap: a press released within this many ms and moved less than
// JUMP_SLOP px along the axis jumps; one that moves further drags.
const JUMP_TIME = 300;
const JUMP_SLOP = 5;
// A touch decides what it is once it has moved this far on either axis (the reference's deadzone).
const TOUCH_DEADZONE = 5;
// ... and it drags when it moved this many times more along the bar than across it; otherwise it
// is a gesture of the page (a back swipe) and only hovers.
const TOUCH_SLOPE = 1.5;
// A scroll position this far from the one the drag wrote last was moved by someone else.
const RESYNC = 2;

interface Press {
    mode: 'marker' | 'drag' | 'button' | 'page' | 'jump' | 'touch';
    pointerId: number;
    touch: boolean;
    time: number; // event time of the press
    // Where the press started, and the last pointer position, and the px travelled since the press.
    startX: number;
    startY: number;
    x: number;
    y: number;
    travel: number;
    // Drag: where it started, along the track and in scroll position, and the position it wrote last.
    startAlong: number;
    startPosition: number;
    written: number | null;
    // Button and page: -1 toward the start, 1 toward the end, 0 when the press has no direction.
    dir: -1 | 0 | 1;
    marker: PlacedMarker | null;
    // Button: the pointer is over the button, so the repeat runs.
    over: boolean;
    // Touch: not decided yet, along the bar (a drag), or across it (left to the page).
    intent: 'undetermined' | 'along' | 'across';
}

// Whether a point lies inside an element's box.
const under = (el: HTMLElement, x: number, y: number): boolean => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
};

// The input of one bar. Presses and hover reach it from the host (see the controller's pointer
// routing), because the bar takes no pointer events itself and they count in the hot zone beside
// it too; during a press the bar holds the pointer capture (which an element without pointer
// events can hold) and its own listeners follow the pointer.
export class BarInput {
    private readonly bar: Bar;
    private readonly host: InputHost;
    private readonly axis: Axis;
    private press: Press | null = null;
    private timer: number | null = null;
    // After a touch, the hover and near state stay a while (lingerTimer); hovering says there is a
    // hover state to clear.
    private lingerTimer: number | null = null;
    private hovering = false;

    constructor(bar: Bar, host: InputHost) {
        this.bar = bar;
        this.host = host;
        this.axis = bar.axis;
        const el = bar.root.el;
        el.addEventListener('pointermove', this.onPointerMove);
        el.addEventListener('pointerup', this.onPointerUp);
        el.addEventListener('pointercancel', this.onPointerCancel);
        el.addEventListener('lostpointercapture', this.onLostCapture);
        el.addEventListener('contextmenu', this.onContextMenu);
    }

    destroy(): void {
        const el = this.bar.root.el;
        el.removeEventListener('pointermove', this.onPointerMove);
        el.removeEventListener('pointerup', this.onPointerUp);
        el.removeEventListener('pointercancel', this.onPointerCancel);
        el.removeEventListener('lostpointercapture', this.onLostCapture);
        el.removeEventListener('contextmenu', this.onContextMenu);
        this.cancel();
    }

    get pressing(): boolean {
        return this.press !== null;
    }

    // Ends everything at once: the press, the linger and the hover (suspended, disconnected).
    cancel(): void {
        this.release();
        this.clearLinger();
        this.clearHover();
    }

    // A press on the bar or in its hot zone, routed by the host. Returns whether the bar took it.
    start(e: PointerEvent): boolean {
        if (this.press) return false;
        const touch = e.pointerType === 'touch';
        if (!touch && e.button !== 0) return false;
        const layout = this.host.layout(this.axis);
        if (!layout) return false;
        const { clientX: x, clientY: y } = e;
        const along = this.host.along(this.axis, x, y);
        // A marker under the pointer wins over the thumb and the track below it.
        const marker = this.host.hitMarker(this.axis, along);
        const region = this.regionFor(layout, x, y, along);
        if (!marker && !region) return false;
        // No text selection and no focus change, as on Windows.
        e.preventDefault();
        this.clearLinger();
        this.host.reveal(touch ? 'touch' : 'mouse');
        // Also for a press beside the bar: the zone becomes the bar's only for this press.
        try {
            this.bar.root.el.setPointerCapture(e.pointerId);
        } catch {
            // The pointer is no longer active.
        }
        const press: Press = {
            mode: 'marker',
            pointerId: e.pointerId,
            touch,
            time: e.timeStamp,
            startX: x,
            startY: y,
            x,
            y,
            travel: 0,
            startAlong: along,
            startPosition: layout.position,
            written: null,
            dir: 0,
            marker,
            over: false,
            intent: 'undetermined',
        };
        this.press = press;
        const button = region === 'button-start' || region === 'button-end';
        if (touch && !(button && !marker)) {
            // A finger: hover, and decide on the first moves whether it drags (see touchMove).
            press.mode = 'touch';
            this.host.setNear(this.axis, true);
            this.host.setPressed(this.axis, 'track', 0);
            this.scrub(press);
        } else if (marker && pageDirection(layout, along) === 0 && !this.host.hidden('thumb')) {
            // A marker on the thumb must not take the thumb away: the press drags, and counts as a
            // click on the marker only if it is released without moving (finish()).
            press.mode = 'drag';
            this.host.pressMarker(this.axis, marker);
            this.host.setPressed(this.axis, 'thumb', 0);
        } else if (marker) {
            this.host.pressMarker(this.axis, marker);
        } else if (region === 'thumb') {
            press.mode = 'drag';
            this.host.setPressed(this.axis, 'thumb', 0);
        } else if (region === 'track' && this.host.trackClick() === 'jump') {
            press.mode = 'jump';
            this.host.setPressed(this.axis, 'track', 0);
        } else if (region === 'track') {
            press.mode = 'page';
            press.dir = pageDirection(this.heading(layout), along);
            this.host.setPressed(this.axis, 'track', press.dir);
            if (press.dir) {
                this.pageOnce(press);
                this.later(this.host.repeatDelay(), () => this.repeatPage(press));
            }
        } else if (button) {
            press.mode = 'button';
            press.dir = region === 'button-start' ? -1 : 1;
            press.over = true;
            this.host.setPressed(this.axis, region, 0);
            this.scrollBy(press.dir * this.host.lineStep());
            this.later(this.host.repeatDelay(), () => this.repeatButton(press));
        }
        return true;
    }

    // A mouse or pen over the bar or its hot zone, without a press. `overBar`: on the bar itself.
    hoverAt(x: number, y: number, overBar: boolean): void {
        if (this.press) return;
        const { axis, host } = this;
        const layout = host.layout(axis);
        if (!layout) {
            this.leave();
            return;
        }
        this.clearLinger();
        const along = host.along(axis, x, y);
        host.setRegionHover(axis, this.regionFor(layout, x, y, along));
        host.setMarkerHover(axis, host.hitMarker(axis, along), x, y);
        host.setBarHover(axis, overBar);
        this.hovering = true;
    }

    // The pointer left the zone. A touch that lingers keeps its state until the linger is over.
    leave(): void {
        if (this.press || this.lingerTimer !== null || !this.hovering) return;
        this.clearHover();
    }

    private readonly onPointerMove = (e: PointerEvent): void => {
        const p = this.press;
        if (!p || e.pointerId !== p.pointerId) return;
        p.travel += Math.hypot(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX;
        p.y = e.clientY;
        if (p.mode === 'touch') this.touchMove(p);
        if (p.mode === 'jump') this.jumpToDrag(p);
        if (p.mode === 'drag') this.drag(p);
        else if (p.mode === 'button') this.trackButton(p);
    };

    private readonly onPointerUp = (e: PointerEvent): void => this.finish(e, true);
    private readonly onPointerCancel = (e: PointerEvent): void => this.finish(e, false);
    private readonly onLostCapture = (e: PointerEvent): void => this.finish(e, false);

    // Only while a press goes on: a right-click or long touch must not open the browser menu.
    private readonly onContextMenu = (e: Event): void => {
        if (this.press) e.preventDefault();
    };

    private finish(e: PointerEvent, click: boolean): void {
        const p = this.press;
        if (!p || e.pointerId !== p.pointerId) return;
        const quick = e.timeStamp - p.time < JUMP_TIME;
        if (p.touch) {
            // A quick tap that never moved: on a marker it activates it, elsewhere it jumps there.
            if (click && p.mode === 'touch' && p.intent === 'undetermined' && quick) {
                if (p.marker) this.host.activateMarker(this.axis, p.marker);
                else this.jump(p.x, p.y);
            }
            this.release();
            // The state of the touch (near, the hovered marker and its card) stays for the linger,
            // counted from the press, so a long hold has read the card already.
            this.linger(this.host.touchIdleDelay() - (e.timeStamp - p.time));
            return;
        }
        if (click && p.marker && p.travel < CLICK_SLOP) this.host.activateMarker(this.axis, p.marker);
        if (click && p.mode === 'jump' && quick) this.jump(e.clientX, e.clientY);
        this.release();
        // A mouse shows its hover again where it is.
        const { clientX: x, clientY: y } = e;
        if (this.host.inZone(this.axis, x, y)) this.hoverAt(x, y, under(this.bar.root.el, x, y));
        else this.clearHover();
    }

    // Ends the press: stops the repeat, gives the pointer back and clears the pressed state.
    private release(): void {
        this.clearTimer();
        const p = this.press;
        if (!p) return;
        // Cleared first: releasing the capture fires lostpointercapture, which must find no press.
        this.press = null;
        const el = this.bar.root.el;
        if (el.hasPointerCapture(p.pointerId)) el.releasePointerCapture(p.pointerId);
        if (p.marker && p.mode !== 'touch') this.host.pressMarker(this.axis, null);
        this.host.setPressed(this.axis, null, 0);
    }

    // A touch decides once it leaves the deadzone: steep along the bar, it drags from where it is
    // (relative, from anywhere in the zone); otherwise the page may have it, and it only hovers.
    private touchMove(p: Press): void {
        this.scrub(p);
        if (p.intent !== 'undetermined') return;
        const dx = Math.abs(p.x - p.startX);
        const dy = Math.abs(p.y - p.startY);
        if (dx <= TOUCH_DEADZONE && dy <= TOUCH_DEADZONE) return;
        const vertical = this.axis === 'vertical';
        const alongMove = vertical ? dy : dx;
        const across = vertical ? dx : dy;
        if (alongMove / Math.max(across, 0.1) <= TOUCH_SLOPE) {
            p.intent = 'across';
            return;
        }
        p.intent = 'along';
        // Pressing the thumb stops a glide that runs, so the drag starts where the scroll is.
        this.host.setPressed(this.axis, 'thumb', 0);
        const layout = this.host.layout(this.axis);
        if (!layout) return;
        p.mode = 'drag';
        p.startAlong = this.host.along(this.axis, p.x, p.y);
        p.startPosition = layout.position;
        p.written = null;
    }

    private drag(p: Press): void {
        const layout = this.host.layout(this.axis);
        if (!layout) return;
        // Something else moved the scroll under the drag (momentum, keys, a script): the drag goes
        // on from there instead of pulling it back.
        if (p.written !== null && Math.abs(layout.position - p.written) > RESYNC) p.startPosition += layout.position - p.written;
        const along = this.host.along(this.axis, p.x, p.y);
        const to = dragTo(layout, p.startPosition, along - p.startAlong);
        this.host.scrollTo(this.axis, to, false);
        p.written = to;
        this.host.invalidate();
        this.scrub(p);
    }

    // During a drag or a touch, the markers under the pointer are hovered and show their cards,
    // so the headings can be scrubbed through; outside the zone none is.
    private scrub(p: Press): void {
        const { x, y } = p;
        const m = this.host.inZone(this.axis, x, y) ? this.host.hitMarker(this.axis, this.host.along(this.axis, x, y)) : null;
        this.host.setMarkerHover(this.axis, m, x, y);
        this.hovering = true;
    }

    // A jump press that moves along the axis becomes a drag from where the pointer is now.
    private jumpToDrag(p: Press): void {
        const along = this.host.along(this.axis, p.x, p.y);
        if (Math.abs(along - p.startAlong) <= JUMP_SLOP) return;
        // Pressing the thumb stops a glide that runs, so the drag starts where the scroll is.
        this.host.setPressed(this.axis, 'thumb', 0);
        const layout = this.host.layout(this.axis);
        if (!layout) return;
        p.mode = 'drag';
        p.startAlong = along;
        p.startPosition = layout.position;
        p.written = null;
    }

    // Glides to where the thumb is centred on the pointer.
    private jump(x: number, y: number): void {
        const layout = this.host.layout(this.axis);
        if (layout) this.host.scrollTo(this.axis, jumpTo(layout, this.host.along(this.axis, x, y)), true);
    }

    // The layout where a running glide is heading: a page repeat stops when the thumb will reach
    // the pointer, not when it has.
    private heading(layout: AxisLayout): AxisLayout {
        const goal = this.host.goal(this.axis);
        return goal === null ? layout : layoutAt(layout, goal);
    }

    // The button repeats only while the pointer is over it. Leaving pauses, coming back waits
    // the repeat delay again, as a new press would.
    private trackButton(p: Press): void {
        const el = p.dir < 0 ? this.bar.buttonStart.el : this.bar.buttonEnd.el;
        const over = under(el, p.x, p.y);
        if (over === p.over) return;
        p.over = over;
        if (over) {
            this.host.setPressed(this.axis, p.dir < 0 ? 'button-start' : 'button-end', 0);
            this.later(this.host.repeatDelay(), () => this.repeatButton(p));
        } else {
            this.clearTimer();
            this.host.setPressed(this.axis, null, 0);
        }
    }

    private repeatButton(p: Press): void {
        this.scrollBy(p.dir * this.host.lineStep());
        this.later(this.host.repeatInterval(), () => this.repeatButton(p));
    }

    // Pages on while the thumb is still on the side of the pointer where the press started.
    private repeatPage(p: Press): void {
        const layout = this.host.layout(this.axis);
        const along = this.host.along(this.axis, p.x, p.y);
        if (!layout || pageDirection(this.heading(layout), along) !== p.dir) {
            this.host.setPressed(this.axis, 'track', 0);
            return;
        }
        this.pageOnce(p);
        this.later(this.host.repeatInterval(), () => this.repeatPage(p));
    }

    private pageOnce(p: Press): void {
        this.scrollBy(p.dir * pageStep(this.host.client(this.axis), this.host.lineStep()));
    }

    private scrollBy(amount: number): void {
        if (this.host.layout(this.axis)) this.host.scrollBy(this.axis, amount);
    }

    // The region of the bar at a point on it or beside it in the hot zone: the point is moved
    // across onto the middle of the bar. Inside the track the real layout decides between the thumb
    // and the track (the thumb drawn may still be on its way, and the default one is narrower than
    // the bar).
    private regionFor(layout: AxisLayout, x: number, y: number, along: number): Region {
        const r = this.bar.root.el.getBoundingClientRect();
        const vertical = this.axis === 'vertical';
        const px = vertical ? (r.left + r.right) / 2 : x;
        const py = vertical ? y : (r.top + r.bottom) / 2;
        const { buttonStart, buttonEnd, area } = this.bar;
        if (under(buttonStart.el, px, py)) return 'button-start';
        if (under(buttonEnd.el, px, py)) return 'button-end';
        if (!under(area, px, py)) return null;
        // Hidden buttons are not displayed, so the tests above miss them; a hidden thumb or track
        // is still under the area.
        const region = pageDirection(layout, along) === 0 ? 'thumb' : 'track';
        return this.host.hidden(region) ? null : region;
    }

    private clearHover(): void {
        this.hovering = false;
        this.host.setRegionHover(this.axis, null);
        this.host.setMarkerHover(this.axis, null, 0, 0);
        this.host.setBarHover(this.axis, false);
    }

    private linger(ms: number): void {
        this.clearLinger();
        if (ms <= 0) {
            this.endTouch();
            return;
        }
        this.lingerTimer = window.setTimeout(() => {
            this.lingerTimer = null;
            this.endTouch();
        }, ms);
    }

    private endTouch(): void {
        this.clearHover();
        this.host.setNear(this.axis, false);
    }

    private clearLinger(): void {
        if (this.lingerTimer !== null) window.clearTimeout(this.lingerTimer);
        this.lingerTimer = null;
    }

    // One timer at a time: each step schedules the next one.
    private later(ms: number, fn: () => void): void {
        this.clearTimer();
        this.timer = window.setTimeout(() => {
            this.timer = null;
            fn();
        }, ms);
    }

    private clearTimer(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }
}
