// Page side of the browser test. Registers the elements of page.html and exposes window.axTest:
// small read and write helpers that run.ts calls through page.evaluate. Input comes from the driver.
import * as scrollbar from '../src/index.js';
import { hasScrollbarKit, register } from '../src/index.js';
// The Minimal look of the demo, to check what its rules make of the default parts.
import minimalCss from '../demo/minimal.css' with { type: 'text' };
import cyberpunkCss from '../demo/cyberpunk.css' with { type: 'text' };
// The Windows 11 look of the demo, with the acrylic layer its track names.
import win11Css from '../demo/win11.css' with { type: 'text' };
// The Windows XP kit of the package.
import { adoptLunaSchemes, defineLunaKit, lunaSchemes } from '../src/kits/luna/index.js';
import { registerAcrylicLayer } from '@ax-design/acrylic';
import { registerLayer } from '@ax-design/surface';

// Counts the animation frames the page requests, to see that an idle scrollbar requests none.
let requested = 0;
const nativeFrame = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    requested++;
    return nativeFrame(callback);
};

register();
registerAcrylicLayer();
// Two layers of the checks: each is an empty container named layer-<name> in the part's shadow root.
for (const name of ['test-a', 'test-b']) registerLayer(name, () => ({ static: true, attach() {}, detach() {}, write: () => false }));

interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface LogEntry {
    type: string;
    id?: string; // the marker id of a markeractivate event
}

// Scrollers made by a check inside a shadow root of their own (see plainMake), by name.
const plains = new Map<string, { host: HTMLElement; view: HTMLElement }>();

const SCROLLERS = ['v', 'rtl', 'both', 'always', 'auto', 'surf', 'snap', 'kit', 'sel', 'tr'];
const ALL = SCROLLERS.concat('page');
const logs = new Map<string, LogEntry[]>();
const watched = new Set<string>();

// The four markers of #v sit on the headings of its four 500px sections.
const v = el('v') as HTMLElement & { markers: unknown };
v.markers = [0, 500, 1000, 1500].map((p) => ({ id: `m${p}`, label: `Section ${p}`, element: document.getElementById(`h${p}`)! }));

function el(id: string): HTMLElement {
    const plain = plains.get(id);
    if (plain) return plain.view;
    const found = document.getElementById(id);
    if (!found) throw new Error(`no element #${id}`);
    return found;
}

function root(id: string): ShadowRoot {
    const shadow = el(id).shadowRoot;
    if (!shadow) throw new Error(`#${id} has no shadow root`);
    return shadow;
}

// The selector of a part name. The buttons and the track pieces have the names `button button-start
// button-vertical`, so `button-end-vertical` is the one that has all three.
function partSelector(name: string): string {
    const m = /^(button|track-piece)-(start|end)-(vertical|horizontal)$/.exec(name);
    return m ? `[part~="${m[1]}-${m[2]}"][part~="${m[1]}-${m[3]}"]` : `[part~="${name}"]`;
}

function part(id: string, name: string): HTMLElement {
    const found = root(id).querySelector<HTMLElement>(partSelector(name));
    if (!found) throw new Error(`#${id} has no part "${name}"`);
    return found;
}

// The area is the track box of a bar: the thumb and the markers are placed inside it.
function area(id: string, axis: 'vertical' | 'horizontal'): HTMLElement {
    const found = root(id).querySelector<HTMLElement>(`.bar.${axis === 'vertical' ? 'v' : 'h'} > .area`);
    if (!found) throw new Error(`#${id} has no ${axis} area`);
    return found;
}

// Element by a name: a part token, 'host', 'area-<axis>' or 'marker:<id>'.
function target(id: string, name: string): HTMLElement {
    if (name === 'host') return el(id);
    if (name.startsWith('area-')) return area(id, name.slice(5) as 'vertical' | 'horizontal');
    if (name.startsWith('marker:')) {
        const found = root(id).querySelector<HTMLElement>(`[data-id="${name.slice(7)}"]`);
        if (!found) throw new Error(`#${id} has no marker ${name.slice(7)}`);
        return found;
    }
    return part(id, name);
}

const tokens = (node: Element): string[] => (node.getAttribute('part') || '').split(/\s+/).filter(Boolean);

function rect(node: Element): Box {
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function watch(id: string, type: string): void {
    const key = `${id}:${type}`;
    if (watched.has(key)) return;
    watched.add(key);
    el(id).addEventListener(type, (event) => {
        const detail = (event as CustomEvent).detail as { marker?: { id: string } } | null;
        const list = logs.get(id) ?? [];
        list.push({ type, id: detail?.marker?.id });
        logs.set(id, list);
    });
}

// What a vertical bar draws, read at once: the thumb and the track pieces along the track, and
// the scroll position.
interface Drawn {
    scroll: number;
    thumbTop: number;
    thumbLength: number;
    pieceStart: number;
    pieceEndTop: number;
}

function drawn(id: string): Drawn {
    const a = area(id, 'vertical').getBoundingClientRect();
    const thumb = part(id, 'thumb-vertical').getBoundingClientRect();
    // A piece is the whole track clipped to its span.
    type Spanned = HTMLElement & { span: { offset: number; length: number } };
    const start = (part(id, 'track-piece-start-vertical') as Spanned).span;
    const end = (part(id, 'track-piece-end-vertical') as Spanned).span;
    const scroll = id === 'page' ? window.scrollY : el(id).scrollTop;
    return { scroll, thumbTop: thumb.top - a.top, thumbLength: thumb.height, pieceStart: start.length, pieceEndTop: end.offset };
}

// Everything that moves: the scroll positions and the thumbs of every scroller.
function motionKey(): string {
    const parts: number[] = [window.scrollX, window.scrollY];
    for (const id of ALL) {
        if (id !== 'page') parts.push(el(id).scrollTop, el(id).scrollLeft);
        for (const name of ['thumb-vertical', 'thumb-horizontal']) {
            const r = part(id, name).getBoundingClientRect();
            parts.push(r.left, r.top, r.width, r.height);
        }
        // The markers follow the scroll too.
        root(id).querySelectorAll('.slot').forEach((slot) => parts.push(slot.getBoundingClientRect().top, slot.getBoundingClientRect().left));
    }
    return parts.join(',');
}

let sampler: { id: string; rows: Drawn[]; frame: number } | null = null;

type Scroller = HTMLElement & { refresh(): void; rectCalls?: number; spied?: boolean };

const axTest = {
    // Resolves after n animation frames.
    frames(n: number): Promise<void> {
        return new Promise((resolve) => {
            const step = (left: number): void => {
                if (left <= 0) resolve();
                else requestAnimationFrame(() => step(left - 1));
            };
            step(n);
        });
    },

    // Resolves once nothing moves for three frames (every glide and follow is over), or after 3 s.
    settle(): Promise<void> {
        return new Promise((resolve) => {
            const until = performance.now() + 3000;
            let last = '';
            let still = 0;
            const step = (): void => {
                const key = motionKey();
                still = key === last ? still + 1 : 0;
                last = key;
                if (still >= 3 || performance.now() > until) resolve();
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    },

    // The animation frames requested so far.
    requestedFrames(): number {
        return requested;
    },

    // The animation frames requested in the next ms milliseconds.
    framesIn(ms: number): Promise<number> {
        const start = requested;
        return new Promise((resolve) => setTimeout(() => resolve(requested - start), ms));
    },

    drawn(id: string): Drawn {
        return drawn(id);
    },

    // Samples what a vertical bar draws on every frame, until stopSample.
    startSample(id: string): void {
        const rows: Drawn[] = [];
        const run = { id, rows, frame: 0 };
        const tick = (): void => {
            rows.push(drawn(id));
            run.frame = requestAnimationFrame(tick);
        };
        run.frame = requestAnimationFrame(tick);
        sampler = run;
    },

    stopSample(): Drawn[] {
        if (!sampler) return [];
        cancelAnimationFrame(sampler.frame);
        const rows = sampler.rows;
        sampler = null;
        return rows;
    },

    // A custom property on the host, then a refresh as the element does for a style change.
    setStyle(id: string, name: string, value: string | null): void {
        const host = el(id) as Scroller;
        if (value) host.style.setProperty(name, value);
        else host.style.removeProperty(name);
        host.refresh();
    },

    // A custom property on the host and nothing else: the element has to notice it by itself.
    setToken(id: string, name: string, value: string): void {
        (el(id) as Scroller).style.setProperty(name, value);
    },

    // A style element of the document, by key (an empty css removes it), then a refresh of every
    // scroller: the parts read the ::part() rules of the page again.
    addStyle(key: string, css: string): void {
        document.head.querySelectorAll(`style[data-key="${key}"]`).forEach((node) => node.remove());
        if (css) {
            const style = document.createElement('style');
            style.setAttribute('data-key', key);
            style.textContent = css;
            document.head.appendChild(style);
        }
        for (const id of ALL) (el(id) as Scroller).refresh();
    },

    // The same inside the shadow root of a scroller made by plainMake.
    plainStyle(id: string, css: string): void {
        const plain = plains.get(id);
        if (!plain) throw new Error(`no plain scroller ${id}`);
        const shadow = plain.host.shadowRoot!;
        let style = shadow.querySelector<HTMLStyleElement>('style[data-test]');
        if (!style) {
            style = document.createElement('style');
            style.setAttribute('data-test', '');
            shadow.appendChild(style);
        }
        style.textContent = css;
        (plain.view as Scroller).refresh();
    },

    // A scroll view inside a shadow root of its own, with the given css, attributes and content.
    plainMake(id: string, css: string, attrs: Record<string, string>, html: string): void {
        const host = document.createElement('div');
        host.style.cssText = 'position: fixed; left: 0; top: 0; width: 320px; height: 240px; z-index: 100; background: #fff;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `ax-scroll-view { display: block; width: 320px; height: 240px; } ${css}`;
        shadow.appendChild(style);
        const view = document.createElement('ax-scroll-view');
        for (const name of Object.keys(attrs)) view.setAttribute(name, attrs[name]);
        view.innerHTML = html;
        shadow.appendChild(view);
        document.body.appendChild(host);
        plains.set(id, { host, view });
    },

    // A row of Luna scroll views in one shadow root, for the grip checks: `count` vertical ones above `count`
    // horizontal ones, of growing lengths, at fractional places, with snap. Returns where their thumbs are.
    lunaRow(count: number, css: string): void {
        if (!hasScrollbarKit('luna')) defineLunaKit();
        const host = document.createElement('div');
        host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1400px; height: 420px; z-index: 100; background: #fff;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `${lunaSchemes} ax-scroll-view { position: absolute; display: block; background: #f4f4f4; --ax-scrollbar-repeat-delay: 60s; } ${css}`;
        shadow.appendChild(style);
        // The horizontal views lie in two rows, each after the other.
        let after = [10, 10];
        for (let i = 0; i < count; i++) {
            for (const axis of ['vertical', 'horizontal'] as const) {
                const view = document.createElement('ax-scroll-view');
                for (const [name, value] of Object.entries({ kit: 'luna', class: 'luna-blue', snap: '', touch: 'bar', [axis]: 'always', [axis === 'vertical' ? 'horizontal' : 'vertical']: 'never' })) view.setAttribute(name, value);
                const long = 101 + i * 9;
                const wide = Math.round(long * (1.25 + i * 0.11));
                const row = i < count / 2 ? 0 : 1;
                const left = (axis === 'vertical' ? 10 + i * 66 : after[row]) + (i % 3) * 0.37;
                const top = (axis === 'vertical' ? 10 : 190 + row * 100) + (i % 4) * 0.21;
                if (axis === 'horizontal') after[row] += long - 20 + 12;
                view.style.cssText = axis === 'vertical' ? `left: ${left}px; top: ${top}px; width: 60px; height: ${long}px;` : `left: ${left}px; top: ${top}px; width: ${long - 20}px; height: 60px;`;
                view.innerHTML = axis === 'vertical' ? `<div style="width: 40px; height: ${wide}px"></div>` : `<div style="height: 40px; width: ${Math.round((long - 20) * (1.25 + i * 0.11))}px"></div>`;
                shadow.appendChild(view);
                plains.set(`lg-${axis}-${i}`, { host, view });
            }
        }
        document.body.appendChild(host);
    },

    lunaRowRemove(count: number): void {
        for (let i = 0; i < count; i++) for (const axis of ['vertical', 'horizontal']) plains.delete(`lg-${axis}-${i}`);
        document.querySelectorAll('body > div').forEach((n) => {
            if ((n as HTMLElement).style.width === '1400px') n.remove();
        });
    },

    // Every view of the row scrolled to `step` times its own stride.
    lunaScroll(count: number, step: number): void {
        for (let i = 0; i < count; i++) {
            for (const axis of ['vertical', 'horizontal']) {
                const view = el(`lg-${axis}-${i}`) as HTMLElement;
                if (axis === 'vertical') view.scrollTop = step * (3 + i * 2) + i;
                else view.scrollLeft = step * (3 + i * 2) + i;
            }
        }
    },

    // The thumbs of the row in CSS px.
    lunaThumbs(count: number): { axis: string; l: number; t: number; w: number; h: number }[] {
        const out: { axis: string; l: number; t: number; w: number; h: number }[] = [];
        for (let i = 0; i < count; i++) {
            for (const axis of ['vertical', 'horizontal']) {
                const r = target(`lg-${axis}-${i}`, `thumb-${axis}`).getBoundingClientRect();
                out.push({ axis, l: r.left, t: r.top, w: r.width, h: r.height });
            }
        }
        return out;
    },

    // The pixels of a screenshot (base64 of a PNG) at the given device pixels, as [r, g, b] each.
    async pixels(b64: string, points: [number, number][]): Promise<number[][]> {
        const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
        const canvas = new OffscreenCanvas(img.width, img.height);
        const g = canvas.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return points.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)));
    },

    // Whether the grip of every thumb of a screenshot is crisp. A grip is crisp when, down the middle of
    // its lines, there are eight rows of `n` device pixels (n = round(dpr), as a line is) that alternate
    // between one light colour and one dark colour, and every row is of one colour from end to end; it
    // is centred as the theme centres it. Returns what is wrong, one string per thumb.
    async gripCheck(b64: string, dpr: number, thumbs: { axis: string; l: number; t: number; w: number; h: number }[]): Promise<string[]> {
        const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
        const canvas = new OffscreenCanvas(img.width, img.height);
        const g = canvas.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const data = g.getImageData(0, 0, img.width, img.height).data;
        const px = (x: number, y: number): number[] => {
            const o = (y * img.width + x) * 4;
            return [data[o], data[o + 1], data[o + 2]];
        };
        const same = (a: number[], b: number[]): boolean => Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 && Math.abs(a[2] - b[2]) <= 2;
        const n = Math.max(1, Math.round(dpr));
        const across = Math.round(5 * dpr);
        const problems: string[] = [];
        thumbs.forEach((th, index) => {
            const vertical = th.axis === 'vertical';
            const x0 = Math.round(th.l * dpr);
            const y0 = Math.round(th.t * dpr);
            const length = Math.round((vertical ? th.h : th.w) * dpr);
            const at = (along: number, cross: number): number[] => (vertical ? px(x0 + cross, y0 + along) : px(x0 + along, y0 + cross));
            const name = `${th.axis} thumb ${index >> 1} (${length} device px)`;
            const runs: { c: number[]; start: number; len: number }[] = [];
            for (let a = 0; a < length; a++) {
                const c = at(a, across + 3 * n);
                const last = runs[runs.length - 1];
                if (last && same(last.c, c)) last.len++;
                else runs.push({ c, start: a, len: 1 });
            }
            let found = -1;
            for (let s = 0; s + 8 <= runs.length && found < 0; s++) {
                const w = runs.slice(s, s + 8);
                if (w.every((r) => r.len === n) && [2, 4, 6].every((k) => same(w[0].c, w[k].c)) && [3, 5, 7].every((k) => same(w[1].c, w[k].c)) && !same(w[0].c, w[1].c)) found = s;
            }
            if (found < 0) {
                problems.push(`${name}: no eight alternating rows of ${n} px (runs ${runs.map((r) => `${r.len}@${r.c.join('.')}`).join(' ')})`);
                return;
            }
            const want = Math.max(0, Math.floor((length - 8 * n) / 2));
            if (runs[found].start !== want) problems.push(`${name}: the grip starts at ${runs[found].start}, centred is ${want}`);
            for (let k = 0; k < 8; k++) {
                for (let r = 0; r < n; r++) {
                    const row = runs[found + k].start + r;
                    const first = at(row, across + n);
                    for (let cross = across + n; cross < across + 6 * n; cross++) {
                        if (!same(at(row, cross), first)) {
                            problems.push(`${name}: line ${k} is not of one colour (pixel ${cross - across - n} of its row: ${Array.from({ length: 8 * n }, (_, q) => at(row, across + q).join('.')).join(' ')})`);
                            return;
                        }
                    }
                }
            }
        });
        return problems;
    },

    // A custom property as computed on a part.
    partToken(id: string, name: string, property: string): string {
        return getComputedStyle(target(id, name)).getPropertyValue(property).trim();
    },

    // Replaces the page scrollbar by one of the given attributes, with a style sheet in the document.
    makePage(css: string, attrs: Record<string, string>): void {
        document.getElementById('page')?.remove();
        const style = document.createElement('style');
        style.setAttribute('data-page', '');
        style.textContent = css;
        document.head.appendChild(style);
        const bar = document.createElement('ax-scrollbar');
        bar.id = 'page';
        for (const name of Object.keys(attrs)) bar.setAttribute(name, attrs[name]);
        document.body.appendChild(bar);
    },

    removePage(): void {
        document.getElementById('page')?.remove();
        document.querySelectorAll('style[data-page]').forEach((n) => n.remove());
        // The other helpers expect a page scrollbar: an unstyled one stands in.
        const bar = document.createElement('ax-scrollbar');
        bar.id = 'page';
        document.body.appendChild(bar);
    },

    // Whether a part is paused (see AxSurface.paused).
    partPaused(id: string, name: string): boolean {
        return !!(target(id, name) as unknown as { paused: boolean }).paused;
    },

    // Shows the bars of a scroller as a pointer moving over it does (a hidden bar draws nothing, so a check of
    // what is drawn wakes it first).
    wake(id: string): void {
        const host = el(id);
        const r = host.getBoundingClientRect();
        host.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: r.left + 4, clientY: r.top + 4, bubbles: true, composed: true }));
    },

    // Puts the host of a scroller made by plainMake at a place, in CSS px (fractions allowed).
    plainPlace(id: string, left: number, top: number): void {
        const plain = plains.get(id);
        if (!plain) throw new Error(`no plain scroller ${id}`);
        plain.host.style.left = `${left}px`;
        plain.host.style.top = `${top}px`;
    },

    // Defines the Luna kit (once) and returns the stylesheet of its colour schemes, as text.
    lunaKit(): string {
        if (!hasScrollbarKit('luna')) defineLunaKit();
        return lunaSchemes;
    },

    // Adopts the colour schemes into the document; the number of adopted sheets before and after, twice.
    adoptLuna(): number[] {
        const before = document.adoptedStyleSheets.length;
        adoptLunaSchemes();
        const once = document.adoptedStyleSheets.length;
        adoptLunaSchemes();
        return [before, once, document.adoptedStyleSheets.length];
    },

    // The Minimal look of the demo, as text.
    minimalCss(): string {
        return minimalCss;
    },

    // The Cyber Punk look of the demo, as text.
    cyberpunkCss(): string {
        return cyberpunkCss;
    },

    // The Windows 11 look of the demo, as text.
    win11Css(): string {
        return win11Css;
    },

    // Whether the bar element of an axis has an attribute (its reflected state: engaged).
    barAttr(id: string, axis: 'vertical' | 'horizontal', name: string): boolean {
        const bar = root(id).querySelector(`.bar.${axis === 'vertical' ? 'v' : 'h'}`);
        return !!bar && bar.hasAttribute(name);
    },

    // The value of an attribute of a part, null when it has none.
    partAttr(id: string, name: string, attribute: string): string | null {
        return target(id, name).getAttribute(attribute);
    },

    // The `layers` attribute of the first element of each part kind: thumb, button, track, corner...
    layersAttr(id: string, name: string): string | null {
        return target(id, name).getAttribute('layers');
    },

    // Adds a heading to the content of a scroller and has it collect its markers again.
    appendHeading(id: string, text: string): void {
        const view = el(id) as Scroller & { refreshMarkers(): void };
        const heading = document.createElement('h2');
        heading.textContent = text;
        heading.id = text;
        view.appendChild(heading);
        view.refreshMarkers();
    },

    plainRemove(id: string): void {
        const plain = plains.get(id);
        if (plain) plain.host.remove();
        plains.delete(id);
    },

    setAttr(id: string, name: string, value: string | null): void {
        if (value === null) el(id).removeAttribute(name);
        else el(id).setAttribute(name, value);
    },

    // Every scroller and the page back to the top, and the event logs empty.
    reset(): void {
        for (const id of SCROLLERS) {
            const host = el(id);
            host.scrollTop = 0;
            host.scrollLeft = 0;
        }
        window.scrollTo(0, 0);
        logs.clear();
    },

    box(id: string, name: string): Box {
        return rect(target(id, name));
    },

    tokens(id: string, name: string): string[] {
        return tokens(target(id, name));
    },

    tagOf(id: string, name: string): string {
        return target(id, name).tagName;
    },

    display(id: string, name: string): string {
        return getComputedStyle(target(id, name)).display;
    },

    hostAttr(id: string, name: string): string {
        return el(id).getAttribute(name) ?? '';
    },

    hostCustom(id: string, name: string): string {
        return getComputedStyle(el(id)).getPropertyValue(name).trim();
    },

    // The scroll position through the host and through the viewport (they must agree).
    scrollOf(id: string): { host: number; left: number; viewport: number; viewportLeft: number } {
        if (id === 'page') return { host: window.scrollY, left: window.scrollX, viewport: window.scrollY, viewportLeft: window.scrollX };
        const host = el(id);
        const vp = part(id, 'viewport');
        return { host: host.scrollTop, left: host.scrollLeft, viewport: vp.scrollTop, viewportLeft: vp.scrollLeft };
    },

    setScroll(id: string, top: number, left?: number): void {
        const host = el(id);
        host.scrollTop = top;
        if (left !== undefined) host.scrollLeft = left;
    },

    scrollPage(y: number): void {
        window.scrollTo(0, y);
    },

    metrics(id: string): { clientHeight: number; scrollHeight: number; clientWidth: number; scrollWidth: number } {
        if (id === 'page') {
            const se = document.scrollingElement as HTMLElement;
            return { clientHeight: document.documentElement.clientHeight, scrollHeight: se.scrollHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: se.scrollWidth };
        }
        const vp = part(id, 'viewport');
        return { clientHeight: vp.clientHeight, scrollHeight: vp.scrollHeight, clientWidth: vp.clientWidth, scrollWidth: vp.scrollWidth };
    },

    // The cards of a scroller: text, part tokens (with `open` for a card that is open) and box.
    cards(id: string): { text: string; classes: string[]; box: Box }[] {
        return Array.from(root(id).querySelectorAll<HTMLElement>('[part~="card"]')).map((card) => {
            const text = card.querySelector('[part~="card-content"]')?.textContent?.trim() ?? '';
            const classes = tokens(card);
            if (card.classList.contains('open')) classes.push('open');
            return { text, classes, box: rect(card) };
        });
    },

    watch(id: string, type: string): void {
        watch(id, type);
    },

    // The ids of the marks drawn on the vertical bar, in track order.
    marks(id: string): string[] {
        return Array.from(root(id).querySelectorAll<HTMLElement>('.bar.v .slot'))
            .filter((slot) => getComputedStyle(slot).display !== 'none')
            .map((slot) => (slot.firstElementChild as HTMLElement).dataset.id || '');
    },

    // An inline property of a part (the values the component writes on it).
    look(id: string, name: string, property: string): string {
        return target(id, name).style.getPropertyValue(property).trim();
    },

    computed(id: string, name: string, property: string): string {
        return getComputedStyle(target(id, name)).getPropertyValue(property);
    },

    // What a pointer at a point of the host's shadow root would hit: the part names of the element.
    hitAt(id: string, x: number, y: number): string {
        const hit = root(id).elementFromPoint(x, y);
        return hit ? hit.getAttribute('part') || hit.className || hit.tagName : '';
    },

    // The open card's text, or '' when none is open (one that is closing does not count).
    openCard(id: string): string {
        const card = Array.from(root(id).querySelectorAll<HTMLElement>('[part~="card-open"]'))[0];
        return card ? card.querySelector('[part~="card-content"]')?.textContent?.trim() ?? '' : '';
    },

    // An attribute of an element in the shadow root of a part (its layers), '' when there is none.
    inner(id: string, name: string, selector: string, attribute: string): string {
        const found = target(id, name).shadowRoot?.querySelector(selector);
        return found ? found.getAttribute(attribute) ?? '' : '';
    },

    // The computed display and style of a part's parent (the clip wrapper of a track piece).
    parentDisplay(id: string, name: string): string {
        return getComputedStyle(target(id, name).parentElement as HTMLElement).display;
    },

    parentStyle(id: string, name: string, property: string): string {
        return getComputedStyle(target(id, name).parentElement as HTMLElement).getPropertyValue(property);
    },

    // An inline property of a part on every frame for ms milliseconds: [time, value] rows.
    sample(id: string, name: string, property: string, ms: number): Promise<[number, string][]> {
        const node = target(id, name);
        const rows: [number, string][] = [];
        const start = performance.now();
        return new Promise((resolve) => {
            const step = (): void => {
                const now = performance.now();
                rows.push([now - start, node.style.getPropertyValue(property).trim()]);
                if (now - start < ms) requestAnimationFrame(step);
                else resolve(rows);
            };
            requestAnimationFrame(step);
        });
    },

    // The scrollTop of a scroll host on every frame for ms milliseconds: [time, scrollTop] rows.
    scrollSample(id: string, ms: number): Promise<[number, number][]> {
        const host = el(id);
        const rows: [number, number][] = [];
        const start = performance.now();
        return new Promise((resolve) => {
            const step = (): void => {
                const now = performance.now();
                rows.push([now - start, host.scrollTop]);
                if (now - start < ms) requestAnimationFrame(step);
                else resolve(rows);
            };
            requestAnimationFrame(step);
        });
    },

    // Counts the getBoundingClientRect calls on an element (the markers are measured with it).
    spyRects(elementId: string): void {
        const node = el(elementId) as Scroller;
        node.rectCalls = 0;
        if (node.spied) return;
        node.spied = true;
        const original = node.getBoundingClientRect.bind(node);
        node.getBoundingClientRect = () => {
            node.rectCalls = (node.rectCalls || 0) + 1;
            return original();
        };
    },

    rectCalls(elementId: string): number {
        return (el(elementId) as Scroller).rectCalls || 0;
    },

    log(id: string): LogEntry[] {
        return logs.get(id) ?? [];
    },

    // What the page scrollbar did to the document: its style text, scrollbar-width and the gutter.
    pageNative(): { styleText: string; scrollbarWidth: string; gutter: number } {
        const style = document.getElementById('ax-scrollbar-document');
        return {
            styleText: style?.textContent ?? '',
            scrollbarWidth: getComputedStyle(document.documentElement).getPropertyValue('scrollbar-width'),
            gutter: window.innerWidth - document.documentElement.clientWidth,
        };
    },
};

(window as unknown as Record<string, unknown>).axTest = axTest;
(window as unknown as Record<string, unknown>).axScrollbar = scrollbar;
(window as unknown as Record<string, unknown>).axReady = true;
