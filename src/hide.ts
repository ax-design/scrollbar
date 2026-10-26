// The hide attribute: a list of the parts a look leaves out. A token is a part name (the names of
// the `part` attribute), hidden with every indicator, or `part:mouse` / `part:touch`, hidden only
// while that indicator shows. While
// the bars fade out (indicator none) they keep the parts of the indicator they fade out from, so a
// part that the touch indicator hides does not flash in as the bars go.

export type HidePart = 'thumb' | 'button' | 'track' | 'track-piece' | 'corner' | 'marker' | 'card';
export type ShownIndicator = 'mouse' | 'touch';

const PARTS: HidePart[] = ['thumb', 'button', 'track', 'track-piece', 'corner', 'marker', 'card'];
const INDICATORS: ShownIndicator[] = ['mouse', 'touch'];

// What the default look hides: with the touch indicator it is a thumb alone.
export const DEFAULT_HIDE = 'button:touch track:touch corner:touch';

export class HideList {
    // Per part, the indicators it is hidden with.
    private readonly rules: { [part: string]: { mouse: boolean; touch: boolean } } = {};

    // Unknown parts and qualifiers are left out, as CSS drops what it does not know.
    constructor(text: string) {
        for (const token of text.split(/\s+/)) {
            if (!token) continue;
            const [name, qualifier, extra] = token.split(':');
            if (extra !== undefined || PARTS.indexOf(name as HidePart) < 0) continue;
            if (qualifier !== undefined && INDICATORS.indexOf(qualifier as ShownIndicator) < 0) continue;
            const rule = this.rules[name] || (this.rules[name] = { mouse: false, touch: false });
            if (qualifier === undefined || qualifier === 'mouse') rule.mouse = true;
            if (qualifier === undefined || qualifier === 'touch') rule.touch = true;
        }
    }

    hidden(part: HidePart, indicator: ShownIndicator): boolean {
        const rule = this.rules[part];
        return !!rule && rule[indicator];
    }
}
