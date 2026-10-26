export type Axis = 'vertical' | 'horizontal';
export const AXES: Axis[] = ['vertical', 'horizontal'];

export interface ScrollMarker {
    id: string;
    label: string;
    // The axis whose bar shows the marker. Default 'vertical'.
    axis?: Axis;
    // Logical position in px along the axis, in scroll coordinates (0 = start of the content).
    // Ignored when `element` is given.
    position?: number;
    // An element in the content: its start edge is the position, measured again on every layout.
    element?: Element;
    // Free data for card renderers.
    data?: unknown;
}

// A marker as given to the `markers` property: an `id` and a `label` it leaves out are made of its
// element (its id or a generated one, its aria-label or text), so markers of elements need only
// the element.
export type ScrollMarkerInput = Omit<ScrollMarker, 'id' | 'label'> & { id?: string; label?: string };

// Where the card goes relative to the bar.
export type Placement = 'left' | 'right' | 'above' | 'below';
