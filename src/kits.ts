// Kits: a named set of part classes that replaces the default look. A kit is chosen with the kit
// attribute of the host; the parts it does not give are the default classes. A part class brings
// its own look (layers, inputs and a shadow style), so a kit is its classes and nothing else.
import { AxScrollbarDefaultButton, AxScrollbarDefaultCard, AxScrollbarDefaultCorner, AxScrollbarDefaultMarker, AxScrollbarDefaultThumb, AxScrollbarDefaultTrack, AxScrollbarDefaultTrackPiece } from './parts/default.js';
import { isPartClass } from './parts/part.js';
import type { PartClass, PartKind } from './parts/part.js';

export const PART_KINDS: PartKind[] = ['thumb', 'button', 'track', 'track-piece', 'corner', 'marker', 'card'];

export interface ScrollbarKit {
    thumb?: PartClass;
    button?: PartClass;
    track?: PartClass;
    trackPiece?: PartClass;
    corner?: PartClass;
    marker?: PartClass;
    card?: PartClass;
    // Default of the hide attribute while the kit is active (see hide.ts). Without it a kit hides
    // nothing.
    hide?: string;
}

export type PartClasses = Record<PartKind, PartClass>;

// The field of a kit that holds the class of a kind.
type ClassField = 'thumb' | 'button' | 'track' | 'trackPiece' | 'corner' | 'marker' | 'card';
const FIELDS: Record<PartKind, ClassField> = {
    thumb: 'thumb',
    button: 'button',
    track: 'track',
    'track-piece': 'trackPiece',
    corner: 'corner',
    marker: 'marker',
    card: 'card',
};

// The class a kit gives for a kind, if any.
const classOf = (kit: ScrollbarKit, kind: PartKind): PartClass | undefined => kit[FIELDS[kind]];

const BASES: { [kind: string]: string } = {
    thumb: 'AxScrollbarThumb',
    button: 'AxScrollbarButton',
    track: 'AxScrollbarTrack',
    'track-piece': 'AxScrollbarTrackPiece',
    corner: 'AxScrollbarCorner',
    marker: 'AxScrollbarMarker',
    card: 'AxScrollbarCard',
};

export const DEFAULT_CLASSES: PartClasses = {
    thumb: AxScrollbarDefaultThumb,
    button: AxScrollbarDefaultButton,
    track: AxScrollbarDefaultTrack,
    'track-piece': AxScrollbarDefaultTrackPiece,
    corner: AxScrollbarDefaultCorner,
    marker: AxScrollbarDefaultMarker,
    card: AxScrollbarDefaultCard,
};

// Shared by every copy of this package on the page, like the layers of Surface: a kit defined
// with one copy is used by scrollbars of the other.
interface Registry {
    kits: { [name: string]: ScrollbarKit };
    // Scrollbars waiting for a kit that is not defined yet.
    waiting: { [name: string]: Set<() => void> };
    // The tag each part class is defined with.
    tags: WeakMap<object, string>;
}

const REGISTRY_KEY = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/scrollbar.kits.v1') : '@ax-design/scrollbar.kits.v1';

function shared(): Registry {
    const r = (typeof globalThis !== 'undefined' ? globalThis : window) as unknown as Record<string, Registry | undefined>;
    return r[REGISTRY_KEY as string] || (r[REGISTRY_KEY as string] = { kits: {}, waiting: {}, tags: new WeakMap() });
}

type Registered = CustomElementRegistry & { getName?: (constructor: CustomElementConstructor) => string | null };

// The tag of a part class, defining it as `preferred` the first time. A class that is already
// defined, by this package or by the page, keeps its tag: customElements takes a class once. A
// default tag taken by the default class of another copy of this package is used as it is: that
// class is a part of the same kind.
export function tagOf(cls: PartClass, preferred: string): string {
    const { tags } = shared();
    const known = tags.get(cls);
    if (known) return known;
    const registry = customElements as Registered;
    const named = typeof registry.getName === 'function' ? registry.getName(cls as unknown as CustomElementConstructor) : null;
    if (named) {
        tags.set(cls, named);
        return named;
    }
    const existing = customElements.get(preferred);
    const sameDefault = existing !== undefined && cls === DEFAULT_CLASSES[cls.kind] && isPartClass(existing, cls.kind);
    if (existing !== cls && !sameDefault) customElements.define(preferred, cls as unknown as CustomElementConstructor);
    tags.set(cls, preferred);
    return preferred;
}

// The tag of each class this copy made a part of: a page makes hundreds, and the lookup of the shared registry
// and the tag's name are the same each time.
const madeTags = new WeakMap<PartClass, string>();

// A new element of a part class.
export function createPart(cls: PartClass): HTMLElement {
    let tag = madeTags.get(cls);
    if (!tag) {
        tag = tagOf(cls, `ax-scrollbar-${cls.kind}`);
        madeTags.set(cls, tag);
    }
    return document.createElement(tag);
}

// The default part classes as <ax-scrollbar-thumb> and so on.
export function defineDefaultParts(): void {
    for (const kind of PART_KINDS) tagOf(DEFAULT_CLASSES[kind], `ax-scrollbar-${kind}`);
}

// Kit names become part of tag names: ax-scrollbar-<name>-<kind>.
const NAME = /^[a-z][a-z0-9-]*$/;

// Defines a kit. Every class must extend the base class of its kind, the name is taken once
// (first wins, as with layers), and each class is defined as ax-scrollbar-<name>-<kind>.
export function defineScrollbarKit(name: string, kit: ScrollbarKit): void {
    if (!NAME.test(name)) throw new SyntaxError(`Scrollbar kit "${name}": the name must be lowercase letters, digits and dashes, starting with a letter`);
    const registry = shared();
    if (registry.kits[name]) throw new Error(`Scrollbar kit "${name}" is already defined`);
    // Checked before anything is defined, so a bad kit leaves nothing behind.
    for (const kind of PART_KINDS) {
        const cls = classOf(kit, kind);
        if (cls !== undefined && !isPartClass(cls, kind)) throw new TypeError(`Scrollbar kit "${name}": ${FIELDS[kind]} must extend ${BASES[kind]}`);
    }
    for (const kind of PART_KINDS) {
        const cls = classOf(kit, kind);
        if (cls) tagOf(cls, `ax-scrollbar-${name}-${kind}`);
    }
    registry.kits[name] = { ...kit };
    const callbacks = registry.waiting[name];
    if (!callbacks) return;
    delete registry.waiting[name];
    callbacks.forEach((callback) => callback());
}

export function hasScrollbarKit(name: string): boolean {
    return !!shared().kits[name];
}

export function scrollbarKit(name: string): ScrollbarKit | null {
    return shared().kits[name] || null;
}

// Calls back once the kit is defined. Returns the cancel function.
export function whenKitDefined(name: string, callback: () => void): () => void {
    const { waiting } = shared();
    (waiting[name] || (waiting[name] = new Set())).add(callback);
    return () => {
        if (waiting[name]) waiting[name].delete(callback);
    };
}

// The classes to build with: the kit's, and the default ones for the kinds it leaves out.
export function partClasses(kit: ScrollbarKit | null): PartClasses {
    const classes = { ...DEFAULT_CLASSES };
    if (kit) {
        for (const kind of PART_KINDS) {
            const cls = classOf(kit, kind);
            if (cls) classes[kind] = cls;
        }
    }
    return classes;
}
