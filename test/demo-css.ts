// Checks of the demo looks (demo/minimal.css, demo/win11.css, demo/cyberpunk.css). A look is rules on the host
// (the bar's tokens) and rules on the parts (::part()): each rule may set only what its selector can, and
// the states of a part are written in the order of the cascade (rest, engaged, hover, pressed; markers:
// rest, engaged, current, on thumb, hover, on thumb and hover, pressed).
import { CORE_SCHEMA } from '@ax-design/surface/schema';
import { CSS_PROPERTIES, HOST_PROPERTIES, INPUT_PROPERTIES, LOOK_PROPERTIES, PART_ALIGN } from '../src/tokens.js';
import { GLYPH_CORNER_RADIUS, GLYPH_HEIGHT, GLYPH_OFFSET, GLYPH_SHAPE, GLYPH_THICKNESS, GLYPH_WIDTH } from '../src/parts/glyph.js';
import { FILL_CLIP } from '../src/parts/fill.js';

// One selector of a rule: `.cyber::part(thumb)` has parts [['thumb']], `::part(marker-on-thumb marker-hover)` has
// one list of two names. `parts` is empty for a rule on the host.
export interface Rule {
    selector: string;
    parts: string[][];
    declarations: { name: string; value: string }[];
}

// The part kinds, longest first (track-piece before track).
const KINDS = ['track-piece', 'scrollbar', 'thumb', 'button', 'track', 'corner', 'marker', 'card'];
const SUFFIX = /^(?:-(?:start|end|vertical|horizontal|hover|pressed|engaged|disabled|current|on-thumb|content|open|enter|exit|forward|backward|first|swap))*$/;

export function kindOf(name: string): string | null {
    for (const kind of KINDS) if (name === kind || name.startsWith(kind + '-')) return SUFFIX.test(name.slice(kind.length)) ? kind : null;
    return null;
}

const names = (list: { name: string }[]): string[] => list.map((spec) => spec.name);

// What a part sets: its inputs, the glyph geometry of a button, the fill clip, and the surface's shape and elevation.
const PART_INPUT = new Set<string>([...names(INPUT_PROPERTIES), GLYPH_WIDTH, GLYPH_HEIGHT, GLYPH_THICKNESS, GLYPH_OFFSET, GLYPH_SHAPE, GLYPH_CORNER_RADIUS, FILL_CLIP, PART_ALIGN]);
const SHAPE = new Set<string>([...names(CORE_SCHEMA), '--elevation-depth', '--elevation-color']);
// What the host sets: the tokens of the bar, its timings and its card (not the inputs of a part).
const HOST_TOKEN = new Set<string>(
    [...names(HOST_PROPERTIES), ...names(CSS_PROPERTIES), ...names(LOOK_PROPERTIES)].filter((name) => !PART_INPUT.has(name)),
);
// The real CSS of a card's text, box and motion, on ::part(card), and the geometry of the track, on ::part(track-vertical)
// and ::part(track-horizontal).
const CARD_CSS = new Set(['color', 'font-family', 'font-size', 'padding', 'max-width', 'transition', 'transition-duration']);
const TRACK_CSS = new Set(['top', 'bottom', 'left', 'right']);

const STRIP = /\/\*[\s\S]*?\*\//g;

export function rulesOf(css: string): Rule[] {
    const rules: Rule[] = [];
    for (const match of css.replace(STRIP, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const declarations = match[2]
            .split(';')
            .map((d) => d.trim())
            .filter((d) => d !== '')
            .map((d) => {
                const colon = d.indexOf(':');
                return { name: d.slice(0, colon).trim(), value: d.slice(colon + 1).trim() };
            });
        // A group of selectors is one rule per selector, with the same declarations.
        for (const piece of match[1].split(',')) {
            const selector = piece.trim();
            const parts = [...selector.matchAll(/::part\(([^)]*)\)/g)].map((m) => m[1].trim().split(/\s+/));
            rules.push({ selector, parts, declarations });
        }
    }
    return rules;
}

// The problems of a look: unknown part names, a host token on a part or a part input on the host, a drawing
// property, and a part state written before a state of a higher rank.
export function problems(css: string): string[] {
    const out: string[] = [];
    for (const rule of rulesOf(css)) {
        if (rule.parts.length === 0) {
            for (const { name, value } of rule.declarations) {
                if (name.startsWith('--')) {
                    if (!HOST_TOKEN.has(name) && !name.startsWith('--acrylic-')) out.push(`${rule.selector}: ${name} is not a host token`);
                } else out.push(`${rule.selector}: ${name}: ${value} is a drawing property`);
            }
            continue;
        }
        const card = rule.parts.every((list) => kindOf(list[0]) === 'card');
        const track = rule.parts.every((list) => kindOf(list[0]) === 'track');
        for (const list of rule.parts) for (const part of list) if (!kindOf(part)) out.push(`${rule.selector}: ${part} is not a part name`);
        for (const { name, value } of rule.declarations) {
            if (name.startsWith('--')) {
                if (!PART_INPUT.has(name) && !SHAPE.has(name)) out.push(`${rule.selector}: ${name} is not a part input`);
            } else if (!(card && CARD_CSS.has(name)) && !(track && TRACK_CSS.has(name))) out.push(`${rule.selector}: ${name}: ${value} is not the card's text, the track's geometry or a part input`);
        }
    }
    return out.concat(stateOrder(css));
}

// The rank of a state in the cascade of its part: a later rank wins over an earlier one at equal specificity.
function rank(kind: string, tokens: string[]): number {
    const has = (state: string) => tokens.includes(`${kind}-${state}`);
    if (kind === 'marker') {
        if (has('pressed')) return 6;
        if (has('on-thumb') && has('hover')) return 5;
        if (has('hover')) return 4;
        if (has('on-thumb')) return 3;
        if (has('current')) return 2;
        return has('engaged') ? 1 : 0;
    }
    if (kind === 'card' || kind === 'scrollbar') return has('exit') ? 1 : 0;
    if (has('pressed')) return 3;
    if (has('hover')) return 2;
    return has('engaged') ? 1 : 0;
}

// The states of each part are written in order, in the rules that are not under a host state (those are
// the variant and touch blocks, which override by their own specificity and are checked by the browser).
export function stateOrder(css: string): string[] {
    const out: string[] = [];
    const previous = new Map<string, number>();
    // A media block restates the states in full after the rules it replaces, in the same order.
    const plain = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
    for (const rule of rulesOf(plain)) {
        if (rule.selector.includes('[') || rule.parts.length === 0) continue;
        // Rules on the axis of a part (the track's geometry) are not states.
        if (rule.parts[0].some((name) => /-(vertical|horizontal)$/.test(name))) continue;
        const kind = kindOf(rule.parts[0][0]);
        if (!kind) continue;
        const r = rank(kind, rule.parts[0]);
        const before = previous.get(kind) ?? 0;
        if (r < before) out.push(`${rule.selector}: a state of rank ${r} written after one of rank ${before}`);
        previous.set(kind, Math.max(r, before));
    }
    return out;
}

// The scrollbar tokens a look sets that the core does not know (on the host or on a part).
export function unknownNames(css: string): string[] {
    const known = new Set<string>([...PART_INPUT, ...SHAPE, ...HOST_TOKEN]);
    const used = new Set<string>();
    for (const rule of rulesOf(css)) for (const { name } of rule.declarations) if (name.startsWith('--ax-scrollbar-')) used.add(name);
    return [...used].filter((name) => !known.has(name));
}

export function scrollbarNames(css: string): Set<string> {
    const used = new Set<string>();
    for (const rule of rulesOf(css)) for (const { name } of rule.declarations) if (name.startsWith('--ax-scrollbar-')) used.add(name);
    return used;
}

// The value a rule of the host sets (the last one of the look), and the value a single-selector rule of a
// part sets: `partValue(css, 'marker-on-thumb marker-hover', '--ax-scrollbar-part-color')`. Host state rules
// (with an attribute) are not counted: the value is the base one.
export function hostValue(css: string, name: string): string | undefined {
    let value: string | undefined;
    for (const rule of rulesOf(css)) {
        if (rule.selector.includes('[') || rule.parts.length !== 0) continue;
        for (const d of rule.declarations) if (d.name === name) value = d.value;
    }
    return value;
}

export function partValue(css: string, tokens: string, name: string): string | undefined {
    let value: string | undefined;
    for (const rule of rulesOf(css)) {
        if (rule.selector.includes('[') || rule.parts.length !== 1 || rule.parts[0].join(' ') !== tokens) continue;
        for (const d of rule.declarations) if (d.name === name) value = d.value;
    }
    return value;
}
