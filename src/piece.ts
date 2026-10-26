// A piece is one element of the overlay: a part element (thumb, button, track, track piece,
// corner, marker, card) or a plain element (a bar). It keeps the element's `part` attribute: the
// base names, the tokens of its state and any token set with toggle(), so authors can write
// ::part(thumb-vertical thumb-hover). A part element also gets the state itself.
import { PART_BRAND, initialState } from './parts/part.js';
import type { AxScrollbarPart, PartState } from './parts/part.js';
import type { Axis } from './types.js';

// Inline styles are written only when the value changes: a frame writes many of them, and each
// write to a surface's style would make it re-read its shape.
const written = new WeakMap<HTMLElement, { [name: string]: string }>();

// Sets one inline style property (CSS name). An empty value removes it. Returns whether the value
// is a new one.
export function writeStyle(el: HTMLElement, name: string, value: string): boolean {
    let record = written.get(el);
    if (!record) {
        record = {};
        written.set(el, record);
    }
    // Nothing written yet is the same as nothing: an empty value for a property never set changes nothing.
    if ((record[name] ?? '') === value) {
        record[name] = value;
        return false;
    }
    record[name] = value;
    el.style.setProperty(name, value);
    return true;
}

export function isPart(el: Element): el is AxScrollbarPart {
    return (el as unknown as { [key: string]: unknown })[PART_BRAND as string] === true;
}

// The state fields that become part tokens, as `<prefix>-<suffix>`: the same words for every kind.
const TOKENS: [keyof PartState, string][] = [
    ['hover', 'hover'],
    ['pressed', 'pressed'],
    ['disabled', 'disabled'],
    ['engaged', 'engaged'],
];

// A marker's also: under the thumb, the last one the scroll has reached. A pressed marker counts as hovered.
const MARKER_TOKENS: [keyof PartState, string][] = TOKENS.concat([
    ['onThumb', 'on-thumb'],
    ['current', 'current'],
]);

export class Piece<E extends HTMLElement = HTMLElement> {
    // Made the first time it is needed (ensure()), and kept: a part that is never shown is never created.
    private node: E | null = null;
    private readonly make: () => E;
    // Method-style, so that a piece of a part class is a piece of an element (the hook takes what it made).
    private readonly onCreate: { hook(el: E): void }['hook'] | null;
    // The state wished for; flush() writes it.
    readonly state: PartState;
    private readonly base: string;
    // The prefix of the state tokens (`thumb` gives thumb-hover); null: the state makes no tokens.
    private readonly prefix: string | null;
    private readonly className: string;
    // The tokens set with toggle(), made when the first one is (most pieces have none).
    private extra: Set<string> | null = null;
    private written: string;
    // The state or a token changed since the last flush: a frame in which nothing changed writes nothing
    // (and builds no strings), however many parts there are.
    private dirty = true;

    // `make` builds the element; `onCreate` puts it in its place and gives it what the host forwards.
    constructor(make: () => E, base: string[], prefix: string | null, className: string, axis: Axis = 'vertical', onCreate: ((el: E) => void) | null = null) {
        this.make = make;
        this.onCreate = onCreate;
        this.className = className;
        this.base = base.join(' ');
        this.prefix = prefix;
        this.state = initialState(axis);
        this.written = this.base;
    }

    // The element if it has been made, null before.
    get element(): E | null {
        return this.node;
    }

    get created(): boolean {
        return this.node !== null;
    }

    // The element, made now if this is the first time it is needed. What was set on the piece before
    // (its state, its tokens) is written by the next flush.
    ensure(): E {
        let el = this.node;
        if (el) return el;
        el = this.node = this.make();
        el.className = this.className;
        el.setAttribute('part', this.base);
        this.written = this.base;
        this.dirty = true;
        if (this.onCreate) this.onCreate(el);
        return el;
    }

    // The element of a piece that is always there (a bar): made on the first use.
    get el(): E {
        return this.node || this.ensure();
    }

    set(patch: Partial<PartState>): void {
        const state = this.state as unknown as { [key: string]: unknown };
        for (const key of Object.keys(patch)) {
            const value = (patch as { [key: string]: unknown })[key];
            if (state[key] === value) continue;
            state[key] = value;
            this.dirty = true;
        }
    }

    // A token that is not part of the state (the lifecycle of a card). Written by flush().
    toggle(token: string, on: boolean): void {
        if (!this.extra) {
            if (!on) return;
            this.extra = new Set();
        }
        if (this.extra.has(token) === on) return;
        if (on) this.extra.add(token);
        else this.extra.delete(token);
        this.dirty = true;
    }

    flush(): void {
        const el = this.node;
        // A part that is not made yet keeps its state for when it is.
        if (!el || !this.dirty) return;
        this.dirty = false;
        const list = this.tokens();
        const part = list.length ? `${this.base} ${list.join(' ')}` : this.base;
        const changed = part !== this.written;
        if (changed) {
            this.written = part;
            el.setAttribute('part', part);
        }
        if (isPart(el)) {
            el.setPartState(this.state);
            // ::part() rules of the new tokens may change what the surface reads.
            if (changed) el.refresh();
        }
    }

    private tokens(): string[] {
        const list: string[] = [];
        if (this.prefix) for (const [key, suffix] of this.prefix === 'marker' ? MARKER_TOKENS : TOKENS) if (this.on(key)) list.push(`${this.prefix}-${suffix}`);
        if (this.extra) this.extra.forEach((token) => list.push(token));
        return list.length > 1 ? list.sort() : list;
    }

    private on(key: keyof PartState): boolean {
        return !!this.state[key] || (key === 'hover' && this.prefix === 'marker' && this.state.pressed);
    }
}
