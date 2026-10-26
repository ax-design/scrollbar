// The `scrollbar-fill` layer: the fill and the border of a part, drawn as SVG on its shape, as the
// `fill` layer of Surface does, with two differences the parts need:
//
// * The fill can stop at the inner edge of the border (`--ax-scrollbar-part-fill-clip: padding-box`),
//   as a XAML Border paints its background: a translucent border then shows what is under the
//   part, not the part's own fill (the Windows 8 thumb).
// * The SVG stretches with its element until the next frame redraws it. A track piece changes its
//   length on every scroll frame, and the surface learns the new size from a ResizeObserver, one
//   frame after the browser laid it out; a stretched rectangle is the right picture meanwhile,
//   where a scaled one (the SVG default) leaves gaps at both ends.
//
// Parts never tilt and never move in 3D (see AxScrollbarPart), and the overlay is hidden in
// forced colours mode (the native scrollbars come back), so neither is handled here.
import { toSvgPath } from '@ax-design/shape';
import type { Point } from '@ax-design/shape';
import type { SurfaceFrame, SurfaceLayer } from '@ax-design/surface';
import type { Rgba } from '@ax-design/typed-om';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const FILL_CLIP = '--ax-scrollbar-part-fill-clip';

// Typed as Surface's schema: it may bundle another version of typed-om than this package. The
// colours are Surface's own fill properties (same definition, so registering twice is harmless).
const schema: SurfaceLayer['schema'] = [
    { name: '--ax-fill-color', syntax: { type: 'color' }, initial: 'rgba(0, 0, 0, 0)', inherits: true, register: true },
    { name: '--ax-border-color', syntax: { type: 'color' }, initial: 'rgba(0, 0, 0, 0)', inherits: true, register: true },
    { name: FILL_CLIP, syntax: { type: 'keyword', values: ['border-box', 'padding-box'] }, initial: 'border-box', inherits: false, register: true },
];

const css = (c: Rgba): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
const round = (n: number): number => Math.round(n * 1000) / 1000;

function polyline(points: Point[]): string {
    if (!points.length) return '';
    return 'M' + points.map((p) => `${round(p.x)} ${round(p.y)}`).join('L') + 'Z';
}

// Sets an attribute only when the value differs: SVG attribute writes cost style and layout.
function set(el: Element, name: string, value: string): void {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function createScrollbarFillLayer(): SurfaceLayer {
    let svg: SVGSVGElement;
    let fill: SVGPathElement;
    // The border: the outline and its inner edge, even-odd.
    let ring: SVGPathElement;
    return {
        schema,
        static: true,
        attach(container) {
            svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
            fill = document.createElementNS(SVG_NS, 'path');
            ring = document.createElementNS(SVG_NS, 'path');
            ring.setAttribute('fill-rule', 'evenodd');
            svg.appendChild(fill);
            svg.appendChild(ring);
            container.appendChild(svg);
        },
        detach() {
            if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
        },
        write(frame: SurfaceFrame) {
            const { changed, values } = frame;
            if (!changed.style && !changed.size && !changed.motion) return false;
            const fillColor = values.color('--ax-fill-color');
            const borderColor = values.color('--ax-border-color');
            const border = borderColor[3] > 0 && frame.borderWidths.some((w) => w > 0);
            // Nothing to see (a track piece of most looks): no path is built or written, so a part
            // that resizes on every frame costs no SVG work.
            if (fillColor[3] <= 0 && !border) {
                set(fill, 'd', '');
                set(ring, 'd', '');
                return false;
            }
            const box = frame.paint;
            set(svg, 'viewBox', `${box.left} ${box.top} ${box.width} ${box.height}`);
            set(svg, 'opacity', frame.opacity >= 1 ? '1' : String(frame.opacity));
            const outline = toSvgPath(frame.shape.outline);
            const inner = border ? polyline(frame.ringInner()) : '';
            const clipped = border && values.keyword(FILL_CLIP) === 'padding-box';
            set(fill, 'd', fillColor[3] > 0 ? (clipped ? inner : outline) : '');
            set(fill, 'fill', css(fillColor));
            set(ring, 'd', border ? `${outline} ${inner}` : '');
            set(ring, 'fill', css(borderColor));
            return false;
        },
    };
}
