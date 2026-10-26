import type { Axis } from './types.js';

export interface ViewportBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

// What the controller reads from the scroller. Logical positions are the ones of geometry.ts:
// 0 at the start of the content, growing toward the end, also in right-to-left layouts.
export interface ScrollTarget {
    readonly scroller: HTMLElement;     // the element that scrolls (viewport div, or the document's scrolling element)
    readonly scrollEvents: EventTarget; // where 'scroll' fires: the viewport, or window
    readonly pointerArea: EventTarget;  // where pointer moves over the scroller are seen: the host, or document
    readonly isDocument: boolean;
    // Cached: reading the direction is a style query, too costly for every scroll frame.
    rtl(): boolean;
    // Reads the direction again, on a layout pass.
    refreshDirection(): void;
    position(axis: Axis): number;
    client(axis: Axis): number;
    size(axis: Axis): number;
    // Instant: every glide of the component is its own (glide.ts).
    scrollTo(axis: Axis, logical: number): void;
    // While on, scroll-behavior stays auto (important) for the whole of a drag, so no author rule
    // can smooth one of its writes, also between them.
    holdInstant(on: boolean): void;
    // `viewport` and `position` are what viewport() and position(axis) give now, for a caller that measures many
    // elements and has read them once.
    contentOffset(el: Element, axis: Axis, viewport?: ViewportBox, position?: number): number;
    viewport(): ViewportBox;
}

class Target implements ScrollTarget {
    constructor(
        readonly scroller: HTMLElement,
        readonly scrollEvents: EventTarget,
        readonly pointerArea: EventTarget,
        readonly isDocument: boolean,
        // The box whose client size is the visible length: the scroller, or documentElement for the page.
        private readonly box: HTMLElement,
    ) {}

    private direction: boolean | null = null;

    rtl(): boolean {
        if (this.direction === null) this.direction = getComputedStyle(this.scroller).direction === 'rtl';
        return this.direction;
    }

    refreshDirection(): void {
        this.direction = null;
    }

    position(axis: Axis): number {
        if (axis === 'vertical') return this.scroller.scrollTop;
        // 0 - x rather than -x: a zero scroll position must stay +0.
        return this.rtl() ? 0 - this.scroller.scrollLeft : this.scroller.scrollLeft;
    }

    client(axis: Axis): number {
        return axis === 'vertical' ? this.box.clientHeight : this.box.clientWidth;
    }

    size(axis: Axis): number {
        return axis === 'vertical' ? this.scroller.scrollHeight : this.scroller.scrollWidth;
    }

    scrollTo(axis: Axis, logical: number): void {
        const horizontal = axis === 'horizontal';
        const value = horizontal && this.rtl() ? 0 - logical : logical;
        // An author's scroll-behavior: smooth, even an !important one, would turn an instant jump
        // into a glide: an inline important declaration wins over every author rule.
        const restore = this.held ? null : this.forceInstant();
        if (this.isDocument) {
            if (horizontal) window.scrollTo(value, window.scrollY);
            else window.scrollTo(window.scrollX, value);
        } else if (horizontal) {
            this.scroller.scrollLeft = value;
        } else {
            this.scroller.scrollTop = value;
        }
        if (restore) restore();
    }

    // The restore of a hold, null while none is on.
    private held: (() => void) | null = null;

    holdInstant(on: boolean): void {
        if (on && !this.held) {
            this.held = this.forceInstant();
        } else if (!on && this.held) {
            this.held();
            this.held = null;
        }
    }

    // Sets scroll-behavior: auto !important on the element whose behaviour applies (the root
    // element for the page) and returns the function that puts the author's inline value back.
    private forceInstant(): () => void {
        const style = (this.isDocument ? document.documentElement : this.scroller).style;
        const value = style.getPropertyValue('scroll-behavior');
        const priority = style.getPropertyPriority('scroll-behavior');
        style.setProperty('scroll-behavior', 'auto', 'important');
        return () => {
            if (value) style.setProperty('scroll-behavior', value, priority);
            else style.removeProperty('scroll-behavior');
        };
    }

    contentOffset(el: Element, axis: Axis, v: ViewportBox = this.viewport(), position: number = this.position(axis)): number {
        const r = el.getBoundingClientRect();
        if (axis === 'vertical') return r.top - v.top + position;
        if (!this.rtl()) return r.left - v.left + position;
        return v.left + v.width - r.right + position;
    }

    viewport(): ViewportBox {
        if (this.isDocument) return { left: 0, top: 0, width: this.box.clientWidth, height: this.box.clientHeight };
        // The client box starts inside the borders, so the scrollbar's own border is not counted.
        const r = this.scroller.getBoundingClientRect();
        return {
            left: r.left + this.scroller.clientLeft,
            top: r.top + this.scroller.clientTop,
            width: this.scroller.clientWidth,
            height: this.scroller.clientHeight,
        };
    }
}

export function elementTarget(viewport: HTMLElement, host: HTMLElement): ScrollTarget {
    return new Target(viewport, viewport, host, false, viewport);
}

export function documentTarget(): ScrollTarget {
    const scroller = (document.scrollingElement || document.documentElement) as HTMLElement;
    return new Target(scroller, window, document, true, document.documentElement);
}
