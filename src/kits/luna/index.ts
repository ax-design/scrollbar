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
import button from './button.js';
import card from './card.js';
import corner from './corner.js';
import marker from './marker.js';
import piece from './piece.js';
import raised from './raised.js';
import schemes from './schemes.js';
import shades from './shades.js';
import thumb from './thumb.js';
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
// The schema of the raised parts: the light.
const SCHEMA_KEY = 'ax-scrollbar-luna-raised';
const SCHEMA = [LIGHT_SPEC];

// Called from each raised part's write(): the surface reads the tokens in its read phase, so this runs once
// per frame with the values of that read, and only writes the attribute when the mode changed (a
// scheme switch re-reads the parts through the attribute observer of the surface).
function reflectLight(part: HTMLElement, values: Values | null): void {
    const light = values?.keyword(LIGHT) || 'top-left';
    if (part.getAttribute('light') !== light) part.setAttribute('light', light);
}

// The look is the class's shadow style alone: no surface layer draws (the default fill would cover
// the construction), and no look is animated (XP switches states at once and its bars never fade).
// Bar-level geometry the kit needs is a host token set on the part itself: the thumb's minimum
// length, the button's length (the bar's thickness, 17px, is the default of the token).
class LunaThumb extends AxScrollbarThumb {
    static schemaKey = SCHEMA_KEY;
    static extraSchema = SCHEMA;
    static styles = [shades, raised, thumb].join('\n');

    write(now: number, quality: Quality): void {
        super.write(now, quality);
        reflectLight(this, this.currentValues);
    }
}

class LunaButton extends AxScrollbarButton {
    static schemaKey = SCHEMA_KEY;
    static extraSchema = SCHEMA;
    static styles = [shades, raised, button].join('\n');

    write(now: number, quality: Quality): void {
        super.write(now, quality);
        reflectLight(this, this.currentValues);
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
