// The shadow style of a scroll view or of the page scrollbar: structure and placement only. The
// frame, the bars, the areas and the slots, and where each part sits along the bar and its size
// along it, from the bar's layout and the host tokens (thickness, padding, button length, thumb
// minimum length). No rule here draws a part and none sets what a part's look sets: a rule of this
// root wins over the `:host` rules of a part's own shadow root, so the look (across size, slide,
// colours, opacity) lives in the part classes.
const STRUCTURE = `
:host { display: block; position: relative; overflow: hidden; }
:host([hidden]) { display: none; }
.viewport { position: absolute; inset: 0; overflow: auto; outline: none; }
.viewport:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
@media not all and (forced-colors: active) {
  .viewport { scrollbar-width: none; }
  .viewport::-webkit-scrollbar { display: none; width: 0; height: 0; }
}
.content { min-width: 100%; min-height: 100%; box-sizing: border-box; }
.frame { position: absolute; left: 0; top: 0; }
.bar { position: absolute; display: flex; box-sizing: border-box;
       user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
.bar.v { top: 0; right: 0; bottom: 0; flex-direction: column; }
.bar.h { left: 0; right: 0; bottom: 0; flex-direction: row; }
.frame.rtl .bar.v { right: auto; left: 0; }
.bar.v { width: var(--ax-scrollbar-thickness); padding: var(--ax-scrollbar-padding); }
.bar.h { height: var(--ax-scrollbar-thickness); padding: var(--ax-scrollbar-padding); }
/* The button length is 33/17 of the thickness unless the token is set (the Windows 8 proportion). A
   length of auto is a square: the length follows the width the bar gives it (with aspect-ratio;
   older browsers need a length). */
.button { flex: none; box-sizing: border-box; position: relative; }
.bar.v > .button { height: var(--ax-scrollbar-button-length, calc(var(--ax-scrollbar-thickness) * 33 / 17)); aspect-ratio: 1; }
.bar.h > .button { width: var(--ax-scrollbar-button-length, calc(var(--ax-scrollbar-thickness) * 33 / 17)); aspect-ratio: 1; }
.area { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; contain: layout; }
.track, .clip, .piece, .thumb, .markers { position: absolute; box-sizing: border-box; }
.track, .clip, .piece, .markers { left: 0; top: 0; right: 0; bottom: 0; }
.bar.v .thumb { top: 0; min-height: var(--ax-scrollbar-thumb-min-length); }
.bar.h .thumb { left: 0; min-width: var(--ax-scrollbar-thumb-min-length); }
/* The touch indicator is a short thumb. */
:host([last-indicator="touch"]) { --ax-scrollbar-thumb-min-length: 17px; }
.slot { position: absolute; display: flex; align-items: center; justify-content: center; }
.bar.v .slot { left: 0; right: 0; top: 0; height: 0; }
.bar.h .slot { top: 0; bottom: 0; left: 0; width: 0; flex-direction: column; }
.marker { flex: none; box-sizing: border-box; }
.corner { position: absolute; bottom: 0; right: 0; box-sizing: border-box; }
.frame.rtl .corner { right: auto; left: 0; }
.card { position: fixed; left: 0; top: 0; margin: 0; inset: auto; width: max-content; height: auto;
        box-sizing: border-box; }
.card:not(.open) { display: none; }
.content-text { display: block; width: var(--ax-scrollbar-fit-width, auto); }
/* The bars and the cards take no pointer events, in every look and kit: all input is found by
   geometry from the host's pointer area (see the controller), and a wheel over a bar reaches the
   scroller natively. Important, and in the shadow style: an author's rule on a part cannot undo
   it (for important declarations the inner context wins). */
.frame, .frame *, .cards, .cards * { pointer-events: none !important; }
@media (forced-colors: active) { .frame, .cards { display: none; } }
@media print { .frame, .cards { display: none; } }
`;

export const SHADOW_STYLE = STRUCTURE;

// Injected once into the document while an <ax-scrollbar> is connected.
export const DOCUMENT_STYLE = `
@media not all and (forced-colors: active) {
  html { scrollbar-width: none; }
  html::-webkit-scrollbar { display: none; width: 0; height: 0; }
}
`;
