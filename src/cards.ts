// CardLayer: the hover cards of the markers. Two card elements are used in turn, so the card that
// is leaving can play its exit while the next one plays its enter. The card element renders its
// content itself (AxScrollbarCard.render).
import { longestTiming, placeCard } from './geometry.js';
import { createPart } from './kits.js';
import type { AxScrollbarCard } from './parts/card.js';
import type { PartClass } from './parts/part.js';
import { Piece } from './piece.js';
import type { Axis, Placement, ScrollMarker } from './types.js';

// The card stays this far inside the viewport.
const MARGIN = 4;
// Above everything, for the fallback without the top layer.
const Z_TOP = '2147483647';
// Every token that says where a card is in its life. The axis token is not one of them: it stays.
const STATE_TOKENS = [
    'card-enter',
    'card-open',
    'card-exit',
    'card-forward',
    'card-backward',
    'card-first',
    'card-swap',
];

interface Card {
    part: Piece;
    el: AxScrollbarCard;
    marker: ScrollMarker | null;
    timer: number | null;
}

export class CardLayer {
    // The card showing a marker. A card that is closing is not active.
    private active: Card | null = null;
    private readonly cards: Card[];
    // Checked here rather than at module load, so the module can be imported without a DOM.
    private readonly popover: boolean;

    // `cls` is the card class, AxScrollbarCard or a kit's subclass of it.
    constructor(container: HTMLElement, cls: PartClass) {
        this.popover = 'popover' in HTMLElement.prototype;
        this.cards = [this.createCard(container, cls), this.createCard(container, cls)];
    }

    // The two card elements, for the host to forward `card-layers` to.
    elements(): HTMLElement[] {
        return this.cards.map((card) => card.el);
    }

    get shownId(): string | null {
        return this.active?.marker?.id ?? null;
    }

    show(
        marker: ScrollMarker,
        axis: Axis,
        point: { x: number; y: number },
        placement: Placement,
        gap: number,
        forward: boolean,
        // The markers a merged mark stands for, the shown one first; [marker] for a single one.
        group: ScrollMarker[] = [marker],
    ): void {
        const current = this.active;
        if (current && current.marker && current.marker.id === marker.id) {
            this.reposition(point, placement, gap);
            return;
        }
        const first = current === null;
        if (current) this.close(current, forward);
        // The other card, so the one that is closing keeps its exit running.
        const card = this.cards[0] === current ? this.cards[1] : this.cards[0];
        this.open(card, marker, group, axis, first, forward, point, placement, gap);
        this.active = card;
    }

    hide(forward: boolean): void {
        if (!this.active) return;
        this.close(this.active, forward);
        this.active = null;
    }

    // The open card follows a marker that moves.
    reposition(point: { x: number; y: number }, placement: Placement, gap: number): void {
        if (this.active) this.place(this.active, point, placement, gap);
    }

    destroy(): void {
        for (const card of this.cards) {
            if (card.timer !== null) window.clearTimeout(card.timer);
            card.timer = null;
            card.part.el.remove();
        }
        this.active = null;
    }

    private createCard(container: HTMLElement, cls: PartClass): Card {
        const el = createPart(cls) as AxScrollbarCard;
        const part = new Piece(el, ['card'], null, 'card');
        if (this.popover) el.setAttribute('popover', 'manual');
        else el.style.zIndex = Z_TOP;
        container.appendChild(el);
        return { part, el, marker: null, timer: null };
    }

    private open(
        card: Card,
        marker: ScrollMarker,
        group: ScrollMarker[],
        axis: Axis,
        first: boolean,
        forward: boolean,
        point: { x: number; y: number },
        placement: Placement,
        gap: number,
    ): void {
        // Reopened while it was closing: the pending hide must not close it again.
        if (card.timer !== null) {
            window.clearTimeout(card.timer);
            card.timer = null;
        }
        card.marker = marker;
        card.el.present(group);

        const part = card.part;
        part.set({ axis });
        part.toggle('card-vertical', axis === 'vertical');
        part.toggle('card-horizontal', axis === 'horizontal');
        part.toggle('card-enter', true);
        part.toggle('card-open', false);
        part.toggle('card-exit', false);
        this.setDirection(card, forward);
        part.toggle('card-first', first);
        part.toggle('card-swap', !first);
        this.paint(card, true);
        this.showPopover(card);

        // Balanced text is as wide as its longest line, not as wide as its block. The width is a
        // custom property the structure style puts on the content, so ::part(card-content) can override it.
        const content = card.el.content;
        const range = document.createRange();
        range.selectNodeContents(content);
        content.style.setProperty('--ax-scrollbar-fit-width', Math.ceil(range.getBoundingClientRect().width) + 'px');
        this.place(card, point, placement, gap);

        // Reading a computed style forces the flush that gives the enter state a frame to start from.
        void getComputedStyle(part.el).opacity;
        part.toggle('card-enter', false);
        part.toggle('card-open', true);
        this.paint(card, true);
    }

    private close(card: Card, forward: boolean): void {
        const part = card.part;
        part.toggle('card-open', false);
        part.toggle('card-exit', true);
        this.setDirection(card, forward);
        this.paint(card, true);

        // The card stays until its exit transition and animation have run.
        const style = getComputedStyle(part.el);
        const wait = Math.max(
            longestTiming(style.transitionDuration, style.transitionDelay),
            longestTiming(style.animationDuration, style.animationDelay),
        );
        if (wait > 0) card.timer = window.setTimeout(() => this.finish(card), wait);
        else this.finish(card);
    }

    private finish(card: Card): void {
        card.timer = null;
        for (const token of STATE_TOKENS) card.part.toggle(token, false);
        this.paint(card, false);
        if (this.popover) {
            try {
                card.part.el.hidePopover();
            } catch {
                // Already hidden.
            }
        }
    }

    // Puts the card beside the point, inside the viewport, from its size as it is now.
    private place(card: Card, point: { x: number; y: number }, placement: Placement, gap: number): void {
        const el = card.part.el;
        const rect = el.getBoundingClientRect();
        const root = document.documentElement;
        const size = { width: rect.width, height: rect.height };
        const viewport = { width: root.clientWidth, height: root.clientHeight };
        const at = placeCard(point, size, placement, gap, viewport, MARGIN);
        el.style.left = at.left + 'px';
        el.style.top = at.top + 'px';
    }

    private setDirection(card: Card, forward: boolean): void {
        card.part.toggle('card-forward', forward);
        card.part.toggle('card-backward', !forward);
    }

    // `open` is internal: the card is displayed while it is shown or closing.
    private paint(card: Card, shown: boolean): void {
        card.part.flush();
        card.part.el.classList.toggle('open', shown);
    }

    private showPopover(card: Card): void {
        if (!this.popover) return;
        try {
            card.part.el.showPopover();
        } catch {
            // Already showing.
        }
    }
}
