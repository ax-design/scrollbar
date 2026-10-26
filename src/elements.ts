import { ScrollbarController } from './controller.js';
import { DOCUMENT_STYLE, SHADOW_STYLE } from './style.js';
import { documentTarget, elementTarget } from './target.js';
import { watchFocus } from './focus.js';
import type { ScrollMarker, ScrollMarkerInput } from './types.js';

// Server-side rendering imports this module without a DOM.
const ElementBase: typeof HTMLElement = typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement);

// Every attribute that configures the controller. A kit change rebuilds it, the others refresh it.
const CONFIG_ATTRIBUTES = [
    'vertical',
    'horizontal',
    'hide',
    'marker-selector',
    'marker-axis',
    'marker-align',
    'snap',
    'kit',
    'track-click',
    'suspended',
    'touch',
    'indicator',
    // The layers of each kind of part (see AxScrollbarPart.layerNames_).
    'thumb-layers',
    'button-layers',
    'track-layers',
    'track-piece-layers',
    'corner-layers',
    'marker-layers',
    'card-layers',
];

// The host is the page's full-window overlay: it takes no pointer events, and neither do its bars (see style.ts). Its stacking
// is a token, so a page with modals can put it under them.
const DOCUMENT_HOST = ':host { position: fixed; inset: 0; overflow: visible; pointer-events: none; z-index: var(--ax-scrollbar-z-index, 2147483000); } .frame.document { inset: 0; }';
const DOCUMENT_STYLE_ID = 'ax-scrollbar-document';

// The document style is shared by the connected page scrollbars, and removed with the last one.
let documentStyleUses = 0;

function acquireDocumentStyle(): void {
    if (documentStyleUses++ > 0) return;
    const style = document.createElement('style');
    style.id = DOCUMENT_STYLE_ID;
    style.textContent = DOCUMENT_STYLE;
    document.head.appendChild(style);
}

function releaseDocumentStyle(): void {
    if (--documentStyleUses > 0) return;
    const style = document.getElementById(DOCUMENT_STYLE_ID);
    if (style) style.remove();
}

abstract class ScrollbarElement extends ElementBase {
    static get observedAttributes(): string[] {
        return CONFIG_ATTRIBUTES.slice();
    }

    protected controller!: ScrollbarController;

    // The list set, as markers, or null while marker-selector is in charge.
    get markers(): ScrollMarker[] | null {
        return this.controller.markers;
    }

    // Markers, elements of the content (an array, a NodeList), or both mixed. A list, even an empty
    // one, replaces the markers of marker-selector; null gives them back to the selector.
    set markers(value: Iterable<ScrollMarkerInput | Element> | null) {
        this.controller.markers = value;
    }

    // Public: layout pass on the next frame, for changes the element cannot see.
    refresh(): void {
        this.controller.refresh();
    }

    // Public: collects the markers and measures them again on the next frame, after a change the
    // element cannot see (markers moved by script, an element that now matches the selector).
    refreshMarkers(): void {
        this.controller.refreshMarkers();
    }

    attributeChangedCallback(name: string): void {
        if (name === 'kit') this.controller.rebuild();
        else this.controller.refresh();
    }
}

// The shadow root of an element: its structure and placement style, and its markup. The style is one
// sheet that every root of the kind adopts, and the markup is cloned from one template, so a page of
// scroll views parses neither again for each (a browser without constructable style sheets gets a
// style element in the template).
const adoptable = typeof CSSStyleSheet === 'function' && typeof Document !== 'undefined' && 'adoptedStyleSheets' in Document.prototype && 'replaceSync' in CSSStyleSheet.prototype;
const shadowSheets: { [kind: string]: CSSStyleSheet } = {};
const shadowTemplates: { [kind: string]: HTMLTemplateElement } = {};

function fillShadow(root: ShadowRoot, kind: string, css: string, markup: string): void {
    let template = shadowTemplates[kind];
    if (!template) {
        template = shadowTemplates[kind] = document.createElement('template');
        template.innerHTML = adoptable ? markup : `<style>${css}</style>${markup}`;
    }
    if (adoptable) {
        let sheet = shadowSheets[kind];
        if (!sheet) {
            sheet = shadowSheets[kind] = new CSSStyleSheet();
            sheet.replaceSync(css);
        }
        root.adoptedStyleSheets = [sheet];
    }
    root.appendChild(template.content.cloneNode(true));
}

// A scroll container with scrollbars on both axes. Scrolling is the element's own: the scrollbars
// only show and drive the viewport.
export class AxScrollView extends ScrollbarElement {
    static readonly ElementName = 'ax-scroll-view';
    readonly viewport: HTMLElement;
    private unwatchFocus: (() => void) | null = null;

    constructor() {
        super();
        // delegatesFocus: focusing the host focuses the viewport while it takes focus, so the keys scroll it.
        const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
        fillShadow(root, 'view', SHADOW_STYLE, '<div class="viewport" part="viewport"><div class="content" part="content"><slot></slot></div></div><div class="frame"></div><div class="cards"></div>');
        this.viewport = root.querySelector('.viewport') as HTMLElement;
        this.controller = new ScrollbarController({
            host: this,
            root,
            target: elementTarget(this.viewport, this),
            frame: root.querySelector('.frame') as HTMLElement,
            cards: root.querySelector('.cards') as HTMLElement,
            viewport: this.viewport,
        });
    }

    connectedCallback(): void {
        this.viewport.addEventListener('scroll', this.reemit);
        this.viewport.addEventListener('scrollend', this.reemit);
        // The viewport takes focus only while the content has nothing that can.
        this.unwatchFocus = watchFocus(this, this.viewport);
        this.controller.connect();
    }

    disconnectedCallback(): void {
        if (this.unwatchFocus) this.unwatchFocus();
        this.unwatchFocus = null;
        this.viewport.removeEventListener('scroll', this.reemit);
        this.viewport.removeEventListener('scrollend', this.reemit);
        this.controller.disconnect();
    }

    // The viewport's scroll events, seen on the element like an element's own scroll.
    private readonly reemit = (event: Event): void => {
        this.dispatchEvent(new Event(event.type));
    };

    get scrollTop(): number {
        return this.viewport.scrollTop;
    }

    set scrollTop(value: number) {
        this.viewport.scrollTop = value;
    }

    get scrollLeft(): number {
        return this.viewport.scrollLeft;
    }

    set scrollLeft(value: number) {
        this.viewport.scrollLeft = value;
    }

    get scrollHeight(): number {
        return this.viewport.scrollHeight;
    }

    get scrollWidth(): number {
        return this.viewport.scrollWidth;
    }

    scrollTo(x?: ScrollToOptions | number, y?: number): void {
        if (typeof x === 'number') this.viewport.scrollTo(x, y || 0);
        else this.viewport.scrollTo(x);
    }

    scrollBy(x?: ScrollToOptions | number, y?: number): void {
        if (typeof x === 'number') this.viewport.scrollBy(x, y || 0);
        else this.viewport.scrollBy(x);
    }

    scroll(x?: ScrollToOptions | number, y?: number): void {
        this.scrollTo(x, y);
    }
}

// The scrollbars of the page. Only one can be active: the second one warns and stays inert.
export class AxScrollbar extends ScrollbarElement {
    static readonly ElementName = 'ax-scrollbar';
    private static active: AxScrollbar | null = null;

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        fillShadow(root, 'page', SHADOW_STYLE + DOCUMENT_HOST, '<div class="frame document"></div><div class="cards"></div>');
        this.controller = new ScrollbarController({
            host: this,
            root,
            target: documentTarget(),
            frame: root.querySelector('.frame') as HTMLElement,
            cards: root.querySelector('.cards') as HTMLElement,
            viewport: null,
        });
    }

    connectedCallback(): void {
        if (AxScrollbar.active === this) return;
        if (AxScrollbar.active) {
            console.warn('<ax-scrollbar>: a page has one page scrollbar; this one stays inert.');
            return;
        }
        AxScrollbar.active = this;
        acquireDocumentStyle();
        this.controller.connect();
    }

    disconnectedCallback(): void {
        if (AxScrollbar.active !== this) return;
        AxScrollbar.active = null;
        this.controller.disconnect();
        releaseDocumentStyle();
    }
}
