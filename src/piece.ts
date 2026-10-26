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

// Sets one inline style property (CSS name). An empty value removes it.
export function writeStyle(el: HTMLElement, name: string, value: string): void {
    let record = written.get(el);
    if (!record) {
        record = {};
        written.set(el, record);
    }
    if (record[name] === value) return;
    record[name] = value;
    el.style.setProperty(name, value);
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
    readonly el: E;
    // The state wished for; flush() writes it.
    readonly state: PartState;
    private readonly base: string;
    // The prefix of the state tokens (`thumb` gives thumb-hover); null: the state makes no tokens.
    private readonly prefix: string | null;
    private readonly extra = new Set<string>();
    private written: string;

    constructor(el: E, base: string[], prefix: string | null, className: string, axis: Axis = 'vertical') {
        this.el = el;
        this.el.className = className;
        this.base = base.join(' ');
        this.prefix = prefix;
        this.state = initialState(axis);
        this.written = this.base;
        this.el.setAttribute('part', this.base);
    }

    set(patch: Partial<PartState>): void {
        Object.assign(this.state, patch);
    }

    // A token that is not part of the state (the lifecycle of a card). Written by flush().
    toggle(token: string, on: boolean): void {
        if (on) this.extra.add(token);
        else this.extra.delete(token);
    }

    flush(): void {
        const el = this.el;
        const part = [this.base].concat(this.tokens()).join(' ');
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
        this.extra.forEach((token) => list.push(token));
        return list.sort();
    }

    private on(key: keyof PartState): boolean {
        return !!this.state[key] || (key === 'hover' && this.prefix === 'marker' && this.state.pressed);
    }
}
