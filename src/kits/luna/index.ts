// The Windows XP (Luna) scrollbar as a kit: part classes that replace the default parts by
// dependency injection. Each class extends the contract class of its kind and brings its own look,
// the rules of its kind in a shadow style of its own (`:host` and its pseudo-elements); nothing is
// drawn from outside and nothing of the default look is switched off. Define it with
// `defineLunaKit()`, pick it with kit="luna", and put a scheme class (luna-blue, luna-olive,
// luna-silver, luna-purple, luna-orange, luna-pink, luna-gold) on an ancestor: the schemes are the
// stylesheet `lunaSchemes`, which `adoptLunaSchemes()` adds to a document or a shadow root.
import {
    AxScrollbarButton,
    AxScrollbarCard,
    AxScrollbarCorner,
    AxScrollbarMarker,
    AxScrollbarThumb,
    AxScrollbarTrack,
    AxScrollbarTrackPiece,
    defineScrollbarKit,
} from '@ax-design/scrollbar';
import type { Quality, Values } from '@ax-design/surface';
import { registerProperties } from '@ax-design/typed-om';
import button from './button.js';
import card from './card.js';
import corner from './corner.js';
import marker from './marker.js';
import piece from './piece.js';
import raised from './raised.js';
import schemes from './schemes.js';
import shades from './shades.js';
import thumb from './thumb.js';
import { gripPlace, isWholeRatio } from './grip.js';
import { deriveTones } from './tones.js';
import type { Tones } from './tones.js';
import track from './track.js';

// The colour schemes: a class per scheme, setting the tones and numbers the parts read (see the
// header of the stylesheet). Put the class on an ancestor of the scroll view.
export const lunaSchemes: string = schemes;

const adopted = new WeakSet<Document | ShadowRoot>();

// Adds `lunaSchemes` to a document or to the shadow root that holds the scroll views; once per root.
export function adoptLunaSchemes(root: Document | ShadowRoot = document): void {
    if (adopted.has(root)) return;
    adopted.add(root);
    if ('adoptedStyleSheets' in root && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(lunaSchemes);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return;
    }
    const style = document.createElement('style');
    style.textContent = lunaSchemes;
    (root instanceof Document ? root.head : root).appendChild(style);
}

// The direction of the light is part of a colour scheme's design, not of its colours: Blue, Olive
// Green and the schemes derived from Blue are lit from the top left (a drop shadow on the right, a
// corner highlight), Silver and Gold from straight above (symmetric). The scheme sets it as a keyword token on an
// ancestor (luna-schemes.css); the raised parts (thumb, buttons) read it with their other tokens and reflect it as the
// attribute `light`, because a selector can switch geometry on an attribute but not on a custom
// property's value. Inherited, so the scheme class reaches the parts.
const LIGHT = '--luna-light';
const LIGHT_SPEC: (typeof AxScrollbarThumb.extraSchema)[number] = {
    name: LIGHT,
    syntax: { type: 'keyword', values: ['top-left', 'top'] },
    initial: 'top-left',
    inherits: true,
    register: true,
};
// The schema of the raised parts: the light, the colour the tones follow and the tones that may be `auto`.
const ACCENT_LIGHT = '--luna-accent-light';
const AUTO_TONES: { name: string; tone: keyof Tones; used: string }[] = [
    { name: '--luna-accent', tone: 'accent', used: '--luna-tone-accent' },
    { name: '--luna-accent-deep', tone: 'deep', used: '--luna-tone-accent-deep' },
    { name: '--luna-glyph', tone: 'glyph', used: '--luna-tone-glyph' },
];
// Set on the thumb by the bar while it snaps (the package documents it with `snap`).
const THUMB_NUDGE = '--ax-scrollbar-thumb-nudge';
const SCHEMA_KEY = 'ax-scrollbar-luna-raised';
const SCHEMA: typeof AxScrollbarThumb.extraSchema = [
    LIGHT_SPEC,
    // Blue's, for a scheme that sets none.
    { name: ACCENT_LIGHT, syntax: { type: 'color' }, initial: '#bdd3ff', inherits: true, register: true },
    ...AUTO_TONES.map((t) => ({ name: t.name, syntax: { type: 'color' as const, keywords: ['auto'] }, initial: 'auto', inherits: true, register: true })),
];

// What each part last derived from, so that a part whose scheme did not change writes nothing.
const derivedFrom = new WeakMap<HTMLElement, string>();

// Called from each raised part's write(): the surface reads the tokens in its read phase, so this runs once
// per frame with the values of that read, and only writes when the scheme changed (a scheme switch re-reads
// the parts through the attribute observer of the surface). It reflects the light as the attribute `light`,
// and writes the tones the scheme leaves `auto` (derived from the colour of the body, see tones.ts) on the
// part, where the rules of the roles read them; a tone the scheme sets is left to the rules.
function reflectScheme(part: HTMLElement, values: Values | null): void {
    const light = values?.keyword(LIGHT) || 'top-left';
    if (part.getAttribute('light') !== light) part.setAttribute('light', light);
    if (!values) return;
    const body = values.raw(ACCENT_LIGHT);
    const set = AUTO_TONES.map((t) => values.raw(t.name));
    const key = `${light} ${body} ${set.join(' ')}`;
    if (derivedFrom.get(part) === key) return;
    derivedFrom.set(part, key);
    const derived = Array.isArray(body) ? deriveTones(body, light === 'top') : null;
    AUTO_TONES.forEach((t, i) => {
        if (derived && set[i] === 'auto') part.style.setProperty(t.used, derived[t.tone]);
        else part.style.removeProperty(t.used);
    });
}

// The look is the class's shadow style alone: no surface layer draws (the default fill would cover
// the construction), and no look is animated (XP switches states at once and its bars never fade).
// Bar-level geometry the kit needs is a host token set on the part itself: the thumb's minimum
// length, the button's length (the bar's thickness, 17px, is the default of the token).
class LunaThumb extends AxScrollbarThumb {
    static schemaKey = SCHEMA_KEY;
    static extraSchema = SCHEMA;
    static styles = [shades, raised, thumb].join('\n');

    constructor() {
        super();
        // The grip lines: the light box and the dark box, drawn by the rules of thumb.ts.
        const root = this.shadowRoot as ShadowRoot;
        for (const name of ['grip-a', 'grip-b']) {
            const line = document.createElement('div');
            line.className = `grip ${name}`;
            root.appendChild(line);
        }
    }

    // What the grip is drawn from, read in the read phase (see placeGrip), and what it was last placed for.
    private gripNeeds: { device: boolean; axis: string; length: number; ratio: number; cross: number } = { device: false, axis: 'height', length: 0, ratio: 1, cross: 0 };
    private gripFor = '';

    // Reads what the grip needs: the length the bar wrote on the thumb and the nudge it carries (inline
    // styles), the device pixel ratio, and, where the grip is drawn in device pixels, where the thumb
    // starts across the bar.
    read(): void {
        super.read();
        const axis = this.getAttribute('axis') === 'horizontal' ? 'width' : 'height';
        const length = parseFloat(this.style.getPropertyValue(axis));
        const ratio = window.devicePixelRatio || 1;
        const nudge = parseFloat(this.style.getPropertyValue(THUMB_NUDGE)) || 0;
        const device = length > 0 && (!isWholeRatio(ratio) || nudge !== 0);
        let cross = 0;
        if (device) {
            const rect = this.getBoundingClientRect();
            cross = (axis === 'width' ? rect.top : rect.left) * ratio;
        }
        this.gripNeeds = { device, axis, length, ratio, cross };
    }

    write(now: number, quality: Quality): void {
        super.write(now, quality);
        reflectScheme(this, this.currentValues);
        this.placeGrip();
    }

    // Draws the grip in device pixels where the theme's 1px lines would not be crisp (grip.ts): where a CSS px
    // is not a whole number of device pixels, and where a snapped thumb is moved by a fraction of one (the
    // bar writes the nudge that carries what is drawn in it back, bar.ts). A change of the thumb's length,
    // of its place across, of the axis or of the device pixel ratio (a zoom is a resize, which re-reads
    // every surface) places it again.
    private placeGrip(): void {
        const { device, axis, length, ratio, cross } = this.gripNeeds;
        if (device !== (this.getAttribute('grip') === 'device')) {
            if (device) this.setAttribute('grip', 'device');
            else this.removeAttribute('grip');
        }
        if (!device) {
            this.gripFor = '';
            return;
        }
        const key = `${axis} ${length} ${ratio} ${Math.round(cross * 1000)}`;
        if (key === this.gripFor) return;
        this.gripFor = key;
        const place = gripPlace(length, ratio, cross);
        this.style.setProperty('--k-grip-unit', `${place.unit}px`);
        this.style.setProperty('--k-grip-along', `${place.along}px`);
        this.style.setProperty('--k-grip-across', `${place.across}px`);
    }
}

class LunaButton extends AxScrollbarButton {
    static schemaKey = SCHEMA_KEY;
    static extraSchema = SCHEMA;
    static styles = [shades, raised, button].join('\n');

    write(now: number, quality: Quality): void {
        super.write(now, quality);
        reflectScheme(this, this.currentValues);
    }
}

class LunaTrack extends AxScrollbarTrack {
    static styles = [shades, track].join('\n');
}

class LunaTrackPiece extends AxScrollbarTrackPiece {
    static styles = [shades, piece].join('\n');
}

class LunaCorner extends AxScrollbarCorner {
    static styles = corner;
}

class LunaMarker extends AxScrollbarMarker {
    static styles = marker;
}

// The XP info tip: plain text, one line per heading of the mark, no wrapping of a short label and no
// clamp, as the tips of that system (the contract's render). Long labels wrap at the tip's max width.
class LunaCard extends AxScrollbarCard {
    static styles = card;
}

// Defines the kit; once per page.
export function defineLunaKit(): void {
    // The tokens the parts read are registered now, with the kit: registered when the first part builds its
    // schema, they would invalidate the style of the whole page after it was laid out (a document-wide
    // recalculation for five properties), where now it is the style of what is about to be added.
    registerProperties(SCHEMA);
    defineScrollbarKit('luna', {
        thumb: LunaThumb,
        button: LunaButton,
        track: LunaTrack,
        trackPiece: LunaTrackPiece,
        corner: LunaCorner,
        marker: LunaMarker,
        card: LunaCard,
    });
}
