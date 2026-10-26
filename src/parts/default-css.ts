// The shadow style of the default parts: the Windows 8 (Modern UI) scrollbar, with the numbers of
// the Windows 8.1 XAML ScrollBar, ScrollViewer and ToolTip templates (generic.xaml). Each part is
// a surface drawn with the scrollbar-fill layer, and its own style sets, on itself and in each of
// its states, the look inputs (--ax-scrollbar-part-color, -border-color, -glyph-color, -size,
// -thickness, -opacity, -glyph-scale: see tokens.ts) and the Surface Shape properties. The part's
// animator reads those as the target of its motion and writes the shown values
// (--ax-scrollbar-shown-*, see animator.ts), which the rules below put on the fill, the opacity
// and the size. The bar's own numbers (17px, no padding, buttons 33/17 of the thickness long, 48px thumbs,
// the fades, the idle times) are the initial values of the host tokens.
//
// These rules are `:host` rules of the part's own shadow root, so a ::part() rule of the page
// overrides them whatever its specificity (the outer context wins for normal declarations): it
// replaces the value of what it sets in every state of the part, and the states that should
// differ are written again. States are written in this order of rules (equal specificity, later
// wins): rest, [current, on-thumb], hover, pressed, then the touch indicator.
//
// Before the first frame of the animator, a part has the size of its input.
// The Windows 8 numbers are those of a 17px bar; every size of the look is that number scaled by
// the bar's thickness / 17px, so a bar of another thickness is the same drawing scaled. The
// thickness is the host token, which inherits into the part's shadow root. `INNER` is the room
// across the bar inside its padding: a thumb or a hovered marker fills it.
const THICKNESS_TOKEN = 'var(--ax-scrollbar-thickness)';
const INNER = `calc(${THICKNESS_TOKEN} - 2 * var(--ax-scrollbar-padding))`;
const scaled = (px: number): string => `calc(${THICKNESS_TOKEN} * ${px} / 17)`;
const SIZE = 'var(--ax-scrollbar-shown-size, var(--ax-scrollbar-part-size))';
const THICKNESS = `var(--ax-scrollbar-shown-thickness, ${SIZE})`;
const SLIDE = 'var(--ax-scrollbar-shown-slide, 0px)';
// Where the thumb sits across the bar: 0 at the inner edge, 1 at the outer edge (the viewport's), 0.5 centred.
const ALIGN = 'var(--ax-scrollbar-part-align)';
const NEG_SLIDE = `calc(-1 * ${SLIDE})`;
const CARD_SLIDE = 'var(--ax-scrollbar-card-slide-distance)';

const COLOR = '--ax-scrollbar-part-color';
const BORDER = '--ax-scrollbar-part-border-color';
const GLYPH = '--ax-scrollbar-part-glyph-color';
const SIZE_INPUT = '--ax-scrollbar-part-size';
const THICKNESS_INPUT = '--ax-scrollbar-part-thickness';

const VERTICAL = ':host([axis="vertical"])';
const HORIZONTAL = ':host([axis="horizontal"])';
const VERTICAL_RTL = ':host([axis="vertical"][rtl])';

// One rule: `state` is what follows `:host`, `set` the declarations.
const rule = (state: string, set: string): string => `:host${state} { ${set} }\n`;

// What every part of the bar has: fully hidden until its animator has stepped, a 1px border and the
// fill stopping at its inner edge (XAML paints a Border's background inside the border, so a
// translucent border shows what is under the part), the fill and the border as the shown colours.
const COMMON = (opacity = 'var(--ax-scrollbar-shown-opacity, 0)'): string =>
    rule(
        '',
        `opacity: ${opacity}; --ax-fill-color: var(--ax-scrollbar-shown-color, transparent); --ax-border-color: var(--ax-scrollbar-shown-border-color, transparent); --ax-border-width: 1px; --ax-scrollbar-part-fill-clip: padding-box;`,
    );

// The slide of a part toward the outer edge of the bar, across it.
const SLIDE_RULES =
    rule('([axis="vertical"])', `transform: translateX(${SLIDE});`) +
    rule('([axis="vertical"][rtl])', `transform: translateX(${NEG_SLIDE});`) +
    rule('([axis="horizontal"])', `transform: translateY(${SLIDE});`);

// Thumb: the bar's full thickness in every state, square. The touch indicator is the panning
// indicator: a 4px thumb in the middle of the column with a 1px border, all alike (it has no hover).
export const THUMB_CSS =
    COMMON() +
    rule('', `${SIZE_INPUT}: ${INNER}; ${COLOR}: #cdcdcd; ${BORDER}: rgba(85, 85, 85, 0.231);`) +
    rule('([hover])', `${COLOR}: #dadada; ${BORDER}: rgba(183, 183, 183, 0.42);`) +
    rule('([pressed])', `${COLOR}: rgba(0, 0, 0, 0.6); ${BORDER}: rgba(85, 85, 85, 0.929);`) +
    rule('([touch])', `${SIZE_INPUT}: 4px; ${COLOR}: #cdcdcd; ${BORDER}: rgba(154, 154, 154, 0.49);`) +
    `${VERTICAL} { right: auto; width: ${SIZE}; left: calc((100% - ${SIZE}) * ${ALIGN} + ${SLIDE}); }\n` +
    `${VERTICAL_RTL} { left: calc((100% - ${SIZE}) * (1 - ${ALIGN}) - ${SLIDE}); }\n` +
    `${HORIZONTAL} { bottom: auto; height: ${SIZE}; top: calc((100% - ${SIZE}) * ${ALIGN} + ${SLIDE}); }\n`;

// Buttons: the track colour at rest, the arrow black on a hovered button and white on a pressed
// one. The arrow is a 10.944 x 9.673 chevron, arms 4.118 deep, 7px from the edge of the button
// next to the track, centred across (the numbers of a 17px bar, scaled with the thickness).
export const BUTTON_CSS =
    COMMON() +
    // Above the track and the pieces that slide.
    rule('', 'z-index: 1;') +
    rule(
        '',
        `${COLOR}: rgba(213, 213, 213, 0.349); ${GLYPH}: rgba(0, 0, 0, 0.6); --ax-scrollbar-glyph-width: ${scaled(10.944)}; --ax-scrollbar-glyph-height: ${scaled(9.673)}; --ax-scrollbar-glyph-thickness: ${scaled(4.118)}; --ax-scrollbar-glyph-offset: ${scaled(7)};`,
    ) +
    rule('([hover])', `${COLOR}: #dadada; ${GLYPH}: #000;`) +
    rule('([pressed])', `${COLOR}: rgba(0, 0, 0, 0.6); ${GLYPH}: #fff;`) +
    SLIDE_RULES +
    rule('([axis="vertical"][direction="start"])', '--ax-scrollbar-glyph-direction: up;') +
    rule('([axis="vertical"][direction="end"])', '--ax-scrollbar-glyph-direction: down;') +
    rule('([axis="horizontal"][direction="start"])', '--ax-scrollbar-glyph-direction: left;') +
    rule('([axis="horizontal"][direction="end"])', '--ax-scrollbar-glyph-direction: right;') +
    rule('([axis="horizontal"][direction="start"][rtl])', '--ax-scrollbar-glyph-direction: right;') +
    rule('([axis="horizontal"][direction="end"][rtl])', '--ax-scrollbar-glyph-direction: left;');

// Track and corner: the track colour #59D5D5D5.
export const TRACK_CSS = COMMON() + rule('', `${COLOR}: rgba(213, 213, 213, 0.349);`) + SLIDE_RULES;

// The track on one side of the thumb: it draws nothing of its own, and slides with the track.
export const PIECE_CSS = COMMON() + SLIDE_RULES;

export const CORNER_CSS = COMMON() + rule('', `${COLOR}: rgba(213, 213, 213, 0.349);`);

// Markers: flat ticks 9px across and 2px along the bar (for a 17px bar). They rest light, the current
// section is a medium grey and 13px, the hovered one the darkest and as wide as the bar. On the thumb they turn white, also
// when hovered or current (the size marks those). The marker's own opacity is a second channel
// that multiplies the fade. The size is across the bar, the thickness along it (the part writes
// the size for a thickness of auto: a dot). On touch they are 4px x 1px, all alike.
export const MARKER_CSS =
    COMMON('calc(var(--ax-scrollbar-shown-opacity, 0) * var(--ax-scrollbar-shown-alpha, 1))') +
    rule('', `${SIZE_INPUT}: ${scaled(9)}; ${THICKNESS_INPUT}: ${scaled(2)}; ${COLOR}: #9c9c9c;`) +
    rule('([current])', `${SIZE_INPUT}: ${scaled(13)}; ${COLOR}: #666;`) +
    rule('([on-thumb])', `${COLOR}: #fff;`) +
    rule('([hover])', `${SIZE_INPUT}: ${INNER}; ${COLOR}: #1a1a1a;`) +
    rule('([on-thumb][hover])', `${COLOR}: #fff;`) +
    rule('([axis][touch])', `${SIZE_INPUT}: 4px; ${THICKNESS_INPUT}: 1px; ${COLOR}: rgba(0, 0, 0, 0.4);`) +
    `${VERTICAL} { width: ${SIZE}; height: ${THICKNESS}; transform: translateX(${SLIDE}); }\n` +
    `${VERTICAL_RTL} { transform: translateX(${NEG_SLIDE}); }\n` +
    `${HORIZONTAL} { height: ${SIZE}; width: ${THICKNESS}; transform: translateY(${SLIDE}); }\n`;

// The card is the ToolTip: white, a 2px #808080 border, #666 Segoe UI 12px, padding 8px 12px 9px
// (6 10 7 inside the border), at most 320px, square, no shadow (elevation depth 0). Real CSS for its
// text and box (color, font, padding, max-width, set on ::part(card)), the look inputs for its
// fill, and the elevation layer for its shadow, which follows the card's Shape. It fades with the
// bar's fade durations and slides in from the side of approach over
// --ax-scrollbar-card-slide-duration on the showPopup curve; it fades out without moving.
export const CARD_CSS =
    rule(
        '',
        `--ax-radius: 0px; --ax-border-width: 2px; --elevation-depth: 0; --elevation-color: transparent; --ax-scrollbar-part-fill-clip: padding-box;
        ${COLOR}: #fff; ${BORDER}: #808080;
        --ax-fill-color: var(--ax-scrollbar-part-color); --ax-border-color: var(--ax-scrollbar-part-border-color);
        --ax-scrollbar-shown-lines: var(--ax-scrollbar-part-lines);
        padding: 8px 12px 9px; color: #666; font: 12px/1.4 "Segoe UI", "Segoe UI Web (West European)", system-ui, sans-serif; max-width: 320px;
        opacity: 0; transform: translateY(0);
        transition: opacity var(--ax-scrollbar-fade-in-duration) linear, transform var(--ax-scrollbar-card-slide-duration) cubic-bezier(0.1, 0.9, 0.2, 1);`,
    ) +
    rule('([part~="card-enter"][part~="card-forward"])', `transform: translateY(calc(-1 * ${CARD_SLIDE}));`) +
    rule('([part~="card-enter"][part~="card-backward"])', `transform: translateY(${CARD_SLIDE});`) +
    rule('([part~="card-open"])', 'opacity: 1; transform: none;') +
    rule('([part~="card-exit"])', 'opacity: 0; transition-duration: var(--ax-scrollbar-fade-out-duration);') +
    rule('([part~="card-horizontal"][part~="card-enter"][part~="card-forward"])', `transform: translateX(calc(-1 * ${CARD_SLIDE}));`) +
    rule('([part~="card-horizontal"][part~="card-enter"][part~="card-backward"])', `transform: translateX(${CARD_SLIDE});`) +
    '@media (prefers-reduced-motion: reduce) { :host { transition-property: opacity; transform: none !important; } }\n';

// The lines of the default card: balanced, each clamped to --ax-scrollbar-part-lines lines with an
// ellipsis. Inline on the lines, which are the content's children and out of reach of this shadow style.
export const LINE_STYLE = 'display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--ax-scrollbar-shown-lines); overflow: hidden; text-wrap: balance;';
