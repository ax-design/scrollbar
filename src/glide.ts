// The glide of every scroll the component starts: buttons, track pages, markers and track jumps.
// It is the glide of @ax-design/scroll, run per axis toward a goal that the next step can move,
// so repeated steps add up instead of starting over.
import { nextStep } from '@ax-design/scroll';
import type { ScrollTarget } from './target.js';
import { AXES } from './types.js';
import type { Axis } from './types.js';

// A position this far from the last one written means someone else scrolled: the glide gives way.
const EXTERNAL = 2;

interface Run {
    goal: number;
    // The position written by the last step, null before the first one.
    written: number | null;
}

export class Glide {
    private readonly target: ScrollTarget;
    // The glide time in ms; 0 jumps (token 0, or reduced motion).
    private readonly tau: () => number;
    private readonly runs: Record<Axis, Run | null> = { vertical: null, horizontal: null };

    constructor(target: ScrollTarget, tau: () => number) {
        this.target = target;
        this.tau = tau;
    }

    get running(): boolean {
        return this.runs.vertical !== null || this.runs.horizontal !== null;
    }

    goal(axis: Axis): number | null {
        const run = this.runs[axis];
        return run ? run.goal : null;
    }

    // From the goal of a glide that is running, so quick steps add up.
    by(axis: Axis, delta: number): void {
        const run = this.runs[axis];
        this.to(axis, (run ? run.goal : this.target.position(axis)) + delta);
    }

    to(axis: Axis, logical: number): void {
        const max = Math.max(0, this.target.size(axis) - this.target.client(axis));
        const goal = Math.min(Math.max(logical, 0), max);
        if (this.tau() <= 0) {
            this.runs[axis] = null;
            this.target.scrollTo(axis, goal);
            return;
        }
        const run = this.runs[axis];
        if (run) run.goal = goal;
        else this.runs[axis] = { goal, written: null };
    }

    stop(axis?: Axis): void {
        for (const each of axis ? [axis] : AXES) this.runs[each] = null;
    }

    // One frame, `dt` ms after the last one.
    step(dt: number): void {
        for (const axis of AXES) {
            const run = this.runs[axis];
            if (!run) continue;
            const at = this.target.position(axis);
            if (run.written !== null && Math.abs(at - run.written) > EXTERNAL) {
                this.runs[axis] = null;
                continue;
            }
            const next = nextStep(at, run.goal, dt, this.tau());
            // Instant write: the glide is ours, the browser must not smooth it again.
            this.target.scrollTo(axis, next.at);
            run.written = next.at;
            if (next.done) this.runs[axis] = null;
        }
    }
}
