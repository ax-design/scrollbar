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

// Where the card goes relative to the bar.
export type Placement = 'left' | 'right' | 'above' | 'below';
