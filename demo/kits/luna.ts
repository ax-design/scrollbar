// The Windows XP (Luna) scrollbar as a kit: part classes that replace the default parts by
// dependency injection. Each class extends the contract class of its kind and brings its own look,
// the rules of its kind in a shadow style of its own (luna-*.css, `:host` and its pseudo-elements);
// nothing is drawn from outside and nothing of the default look is switched off. Pick it with
// kit="luna" and a scheme class (luna-blue, luna-olive, luna-silver, luna-purple, luna-gold,
// luna-orange, luna-pink) on an ancestor.
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
import button from './luna-button.css' with { type: 'text' };
import card from './luna-card.css' with { type: 'text' };
import corner from './luna-corner.css' with { type: 'text' };
import marker from './luna-marker.css' with { type: 'text' };
import piece from './luna-piece.css' with { type: 'text' };
import raised from './luna-raised.css' with { type: 'text' };
import shades from './luna-shades.css' with { type: 'text' };
import thumb from './luna-thumb.css' with { type: 'text' };
import track from './luna-track.css' with { type: 'text' };

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
