// The `scrollbar-glyph` layer: the arrow of a button, a chevron drawn as an SVG polygon in the
// button, so it stays sharp at every zoom and device pixel ratio. Its geometry is the layer's own
// inputs: the width and height of its box, the thickness of its arms, and where the box sits along
// the axis; set on the button (`::part(button)`) and not inherited. Its colour and scale are the
// button's animated look, read from the shown values.
import type { SurfaceFrame, SurfaceLayer } from '@ax-design/surface';
import type { Rgba } from '@ax-design/typed-om';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type GlyphDirection = 'up' | 'down' | 'left' | 'right';

export const GLYPH_WIDTH = '--ax-scrollbar-glyph-width';
export const GLYPH_HEIGHT = '--ax-scrollbar-glyph-height';
export const GLYPH_THICKNESS = '--ax-scrollbar-glyph-thickness';
export const GLYPH_OFFSET = '--ax-scrollbar-glyph-offset';
export const GLYPH_SHAPE = '--ax-scrollbar-glyph-shape';
export const GLYPH_COLOR = '--ax-scrollbar-shown-glyph-color';
export const GLYPH_SCALE = '--ax-scrollbar-shown-glyph-scale';
export const GLYPH_CORNER_RADIUS = '--ax-scrollbar-glyph-corner-radius';

export type GlyphShape = 'chevron' | 'triangle';

// Typed as Surface's schema: it may bundle another version of typed-om than this package. The
// direction is set on the button by the theme.
const schema: SurfaceLayer['schema'] = [
    { name: GLYPH_COLOR, syntax: { type: 'color' }, initial: 'rgba(0, 0, 0, 0)', inherits: false, register: true },
    { name: '--ax-scrollbar-glyph-direction', syntax: { type: 'keyword', values: ['up', 'down', 'left', 'right'] }, initial: 'up', inherits: false, register: true },
    // Percentages are of the button's size across the bar.
    { name: GLYPH_WIDTH, syntax: { type: 'length-percentage' }, initial: '50%', inherits: false, register: true },
    { name: GLYPH_HEIGHT, syntax: { type: 'length-percentage' }, initial: '25%', inherits: false, register: true },
    { name: GLYPH_THICKNESS, syntax: { type: 'length-percentage' }, initial: '12.5%', inherits: false, register: true },
    // auto: centred along the axis.
    { name: GLYPH_OFFSET, syntax: { type: 'length', keywords: ['auto'] }, initial: 'auto', inherits: false, register: true },
    // chevron: two arms of the given thickness. triangle: filled, the box's width at its base and its
    // height from base to tip (the caret glyphs of Segoe Fluent Icons); the thickness is not used.
    { name: GLYPH_SHAPE, syntax: { type: 'keyword', values: ['chevron', 'triangle'] }, initial: 'chevron', inherits: false, register: true },
    // The radius of every corner of the outline (0px: sharp). It scales with the glyph.
    { name: GLYPH_CORNER_RADIUS, syntax: { type: 'length' }, initial: '0px', inherits: false, register: true },
    // Written by the button's animator (a pressed button's arrow is smaller).
    { name: GLYPH_SCALE, syntax: { type: 'number' }, initial: '1', inherits: false, register: true },
];

interface Point {
    x: number;
    y: number;
}

// The geometry of a chevron, in px. `width` is across the bar, `height` along it (the depth from
// the tip to the ends of the arms), `thickness` the arms measured along the bar. `offset` is the
// gap between the glyph's box and the button's edge on the side of the track (the side the
// chevron points away from); null centres it.
export interface Chevron {
    width: number;
    height: number;
    thickness: number;
    offset: number | null;
    shape?: GlyphShape;
    // The radius of every corner, px (default 0: sharp); see roundedPath().
    radius?: number;
    // The glyph is drawn at this scale about the centre of its box (default 1).
    scale?: number;
}

// The six points of a chevron pointing `direction` in a button of `width` x `height`: the tip,
// the outer end of one arm, its inner end, the inner tip, the other arm's inner and outer ends.
export function chevron(width: number, height: number, glyph: Chevron, direction: GlyphDirection): Point[] {
    const vertical = direction === 'up' || direction === 'down';
    const across = vertical ? width : height;
    const along = vertical ? height : width;
    const w = glyph.width;
    const h = glyph.height;
    const t = Math.min(glyph.thickness, h);
    // Pointing up in a box whose top left is the origin: x across, y along.
    const up: Point[] =
        glyph.shape === 'triangle'
            ? [
                  { x: w / 2, y: 0 },
                  { x: w, y: h },
                  { x: 0, y: h },
              ]
            : [
                  { x: w / 2, y: 0 },
                  { x: w, y: h - t },
                  { x: w, y: h },
                  { x: w / 2, y: t },
                  { x: 0, y: h },
                  { x: 0, y: h - t },
              ];
    const x0 = (across - w) / 2;
    // The track is below an up glyph: the offset is from the bottom of the box.
    const y0 = glyph.offset === null ? (along - h) / 2 : along - glyph.offset - h;
    const k = glyph.scale === undefined ? 1 : glyph.scale;
    const local = up.map((p) => ({ x: x0 + w / 2 + (p.x - w / 2) * k, y: y0 + h / 2 + (p.y - h / 2) * k }));
    switch (direction) {
        case 'down':
            return local.map((p) => ({ x: p.x, y: along - p.y }));
        case 'left':
            return local.map((p) => ({ x: p.y, y: p.x }));
        case 'right':
            return local.map((p) => ({ x: along - p.y, y: p.x }));
        default:
            return local;
    }
}

// The closed outline through `points` with each corner rounded by a circular arc of `radius`
// (tangent to both edges): a path to fill, not to stroke. A corner whose arc would need more than
// half of an adjacent edge gets a smaller radius, so neighbouring arcs never overlap. A radius of 0
// gives the plain polygon.
export function roundedPath(points: Point[], radius: number): string {
    const n = points.length;
    if (n < 3) return '';
    const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);
    if (!(radius > 0)) return 'M' + points.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join('L') + 'Z';
    let d = '';
    for (let i = 0; i < n; i++) {
        const a = points[(i + n - 1) % n];
        const b = points[i];
        const c = points[(i + 1) % n];
        const lenA = Math.hypot(a.x - b.x, a.y - b.y);
        const lenC = Math.hypot(c.x - b.x, c.y - b.y);
        const ux = (a.x - b.x) / lenA;
        const uy = (a.y - b.y) / lenA;
        const vx = (c.x - b.x) / lenC;
        const vy = (c.y - b.y) / lenC;
        const cos = Math.max(-1, Math.min(1, ux * vx + uy * vy));
        const half = Math.acos(cos) / 2;
        const tan = Math.tan(half);
        // Straight through (or a spike): no arc.
        if (!(tan > 1e-6) || !isFinite(tan)) {
            d += (i ? 'L' : 'M') + `${fmt(b.x)} ${fmt(b.y)}`;
            continue;
        }
        const reach = Math.min(radius / tan, lenA / 2, lenC / 2);
        const r = reach * tan;
        // The turn is clockwise on screen (y down) when the cross product of the edges is positive.
        const sweep = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0 ? 1 : 0;
        d += (i ? 'L' : 'M') + `${fmt(b.x + ux * reach)} ${fmt(b.y + uy * reach)}A${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(b.x + vx * reach)} ${fmt(b.y + vy * reach)}`;
    }
    return d + 'Z';
}

const css = (c: Rgba): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
const round = (n: number): number => Math.round(n * 1000) / 1000;

export function createGlyphLayer(): SurfaceLayer {
    let svg: SVGSVGElement;
    let polygon: SVGPolygonElement;
    let outline: SVGPathElement;
    let key = '';
    return {
        schema,
        static: true,
        attach(container) {
            svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('aria-hidden', 'true');
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
            polygon = document.createElementNS(SVG_NS, 'polygon');
            outline = document.createElementNS(SVG_NS, 'path');
            svg.appendChild(polygon);
            svg.appendChild(outline);
            container.appendChild(svg);
            key = '';
        },
        detach() {
            if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
        },
        write(frame: SurfaceFrame) {
            const { changed, values, width, height } = frame;
            if (!changed.style && !changed.size && !changed.appearance && !changed.motion) return false;
            const direction = (values.keyword('--ax-scrollbar-glyph-direction') || 'up') as GlyphDirection;
            const across = direction === 'up' || direction === 'down' ? width : height;
            const glyph: Chevron = {
                width: Math.max(0, values.lp(GLYPH_WIDTH, across)),
                height: Math.max(0, values.lp(GLYPH_HEIGHT, across)),
                thickness: Math.max(0, values.lp(GLYPH_THICKNESS, across)),
                offset: values.unset(GLYPH_OFFSET) ? null : values.length(GLYPH_OFFSET),
                shape: values.keyword(GLYPH_SHAPE) === 'triangle' ? 'triangle' : 'chevron',
                radius: Math.max(0, values.length(GLYPH_CORNER_RADIUS)),
                scale: values.number(GLYPH_SCALE),
            };
            const corners = chevron(width, height, glyph, direction);
            // Rounded corners (with the glyph's scale) are a path; sharp ones keep the polygon.
            const radius = (glyph.radius || 0) * (glyph.scale === undefined ? 1 : glyph.scale);
            const rounded = radius > 0;
            const points = rounded ? roundedPath(corners, radius) : corners.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
            // Forced colours do not reach SVG paint: the glyph takes the text colour, as a button's.
            const forced = !!frame.appearance && frame.appearance.forcedColors;
            const color = values.color(GLYPH_COLOR);
            const fill = forced ? 'ButtonText' : css(color);
            const opacity = frame.opacity >= 1 ? '1' : String(frame.opacity);
            const next = `${width} ${height}|${points}|${fill}|${opacity}`;
            if (next === key) return false;
            key = next;
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
            svg.setAttribute('opacity', opacity);
            const shape = rounded ? outline : polygon;
            const other = rounded ? polygon : outline;
            other.removeAttribute(rounded ? 'points' : 'd');
            shape.setAttribute(rounded ? 'd' : 'points', points);
            shape.setAttribute('fill', fill);
            return false;
        },
    };
}
