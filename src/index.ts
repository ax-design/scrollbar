import { registerElevationLayer } from '@ax-design/elevation';
import { hasLayer, register as registerSurface, registerLayer } from '@ax-design/surface';
import { AxScrollbar, AxScrollView } from './elements.js';
import { defineDefaultParts } from './kits.js';
import { createScrollbarFillLayer } from './parts/fill.js';
import { createGlyphLayer } from './parts/glyph.js';

export { AxScrollView, AxScrollbar } from './elements.js';
export { defineScrollbarKit, hasScrollbarKit } from './kits.js';
export type { ScrollbarKit } from './kits.js';
export { AxScrollbarPart, AxScrollbarButton, AxScrollbarCorner, AxScrollbarMarker, AxScrollbarThumb, AxScrollbarTrack, AxScrollbarTrackPiece, isPartClass } from './parts/part.js';
export type { PartClass, PartKind, PartState } from './parts/part.js';
export { AxScrollbarCard } from './parts/card.js';
export {
    AxScrollbarDefaultButton,
    AxScrollbarDefaultCard,
    AxScrollbarDefaultCorner,
    AxScrollbarDefaultMarker,
    AxScrollbarDefaultThumb,
    AxScrollbarDefaultTrack,
    AxScrollbarDefaultTrackPiece,
} from './parts/default.js';
export type { Look } from './parts/animator.js';
export type { Axis, Placement, ScrollMarker } from './types.js';

// Defines <ax-scroll-view>, <ax-scrollbar>, the default parts (<ax-scrollbar-thumb> and so on),
// the scrollbar-fill, scrollbar-glyph and elevation layers, and <ax-surface> with its layers. Safe to call
// more than once.
export function register(): void {
    registerSurface();
    registerElevationLayer();
    // Another copy of this package may have registered it already.
    if (!hasLayer('scrollbar-fill')) registerLayer('scrollbar-fill', createScrollbarFillLayer);
    if (!hasLayer('scrollbar-glyph')) registerLayer('scrollbar-glyph', createGlyphLayer);
    defineDefaultParts();
    if (!customElements.get(AxScrollView.ElementName)) customElements.define(AxScrollView.ElementName, AxScrollView);
    if (!customElements.get(AxScrollbar.ElementName)) customElements.define(AxScrollbar.ElementName, AxScrollbar);
}
