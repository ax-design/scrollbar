// The hover card of a marker. It owns its content: render() fills it for the markers of the mark
// the pointer is on, and a kit subclasses the card to render anything there. This is the contract:
// it draws nothing.
import type { ScrollMarker } from '../types.js';
import { AxScrollbarPart } from './part.js';
import type { PartKind } from './part.js';

export class AxScrollbarCard extends AxScrollbarPart {
    static readonly kind: PartKind = 'card';
    // A card is a popover, which the browser gives a border, a padding, a background and scrolling:
    // none of them here, so the look starts from a bare box. (The bar places it; see style.ts.)
    static styles = ':host { padding: 0; border: 0; background: none; color: inherit; overflow: visible; }\n';

    private box: HTMLElement | null = null;

    // The element the content goes in, `part="card-content"`, in the surface's default slot.
    // Made on first use: a custom element must not add children in its constructor.
    get content(): HTMLElement {
        if (!this.box) {
            this.box = document.createElement('div');
            this.box.setAttribute('part', 'card-content');
            this.box.className = 'content-text';
            this.appendChild(this.box);
        }
        return this.box;
    }

    // Called by the scrollbar when the card opens: the markers of the mark, the one the pointer
    // is on first (one marker unless several share the mark). The content is emptied first.
    present(markers: ScrollMarker[]): void {
        const content = this.content;
        content.textContent = '';
        content.style.removeProperty('--ax-scrollbar-fit-width');
        this.render(markers, content);
    }

    // The contract: each label on a line of its own.
    protected render(markers: ScrollMarker[], content: HTMLElement): void {
        for (const marker of markers) {
            const line = document.createElement('div');
            line.textContent = marker.label;
            content.appendChild(line);
        }
    }
}
