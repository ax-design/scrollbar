// The hide attribute: a plain space-separated list of the parts a look never shows (the names of the
// `part` attribute). Unknown names are left out, as CSS drops what it does not know.

export type HidePart = 'thumb' | 'button' | 'track' | 'track-piece' | 'corner' | 'marker' | 'card';

const PARTS: HidePart[] = ['thumb', 'button', 'track', 'track-piece', 'corner', 'marker', 'card'];

// What the default look hides: nothing. (Windows 8 shows the buttons and the track with a mouse;
// the touch indicator leaves them out by itself, see `touch` in the controller.)
export const DEFAULT_HIDE = '';

export class HideList {
    private readonly parts = new Set<string>();

    constructor(text: string) {
        for (const token of text.split(/\s+/)) {
            if (PARTS.indexOf(token as HidePart) >= 0) this.parts.add(token);
        }
    }

    hidden(part: HidePart): boolean {
        return this.parts.has(part);
    }
}
