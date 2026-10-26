import { expect, test } from 'bun:test';
import { SMOOTH_TAU } from '@ax-design/scroll';
import { Glide } from '../src/glide.js';
import type { ScrollTarget } from '../src/target.js';
import type { Axis } from '../src/types.js';

// A scroller without a DOM: 1000 px of content in a 200 px view on both axes.
function fakeTarget(): ScrollTarget & { at: Record<Axis, number>; writes: number } {
    const at: Record<Axis, number> = { vertical: 0, horizontal: 0 };
    const target = {
        at,
        writes: 0,
        position: (axis: Axis) => at[axis],
        client: () => 200,
        size: () => 1000,
        scrollTo(axis: Axis, logical: number) {
            at[axis] = logical;
            target.writes++;
        },
    };
    return target as unknown as ScrollTarget & { at: Record<Axis, number>; writes: number };
}

function run(glide: Glide, frames = 200): number {
    let n = 0;
    while (glide.running && n < frames) {
        glide.step(16.7);
        n++;
    }
    return n;
}

test('by glides from the position and ends on the goal', () => {
    const target = fakeTarget();
    const glide = new Glide(target, () => SMOOTH_TAU);
    glide.by('vertical', 40);
    expect(target.writes).toBe(0);
    expect(glide.goal('vertical')).toBe(40);
    glide.step(16.7);
    expect(target.at.vertical).toBeGreaterThan(0);
    expect(target.at.vertical).toBeLessThan(40);
    run(glide);
    expect(target.at.vertical).toBe(40);
    expect(glide.goal('vertical')).toBeNull();
});

test('steps while a glide runs add up from its goal', () => {
    const target = fakeTarget();
    const glide = new Glide(target, () => SMOOTH_TAU);
    glide.by('vertical', 40);
    glide.step(16.7);
    glide.by('vertical', 40);
    expect(glide.goal('vertical')).toBe(80);
    run(glide);
    expect(target.at.vertical).toBe(80);
});

test('goals are clamped to the scroll range', () => {
    const target = fakeTarget();
    const glide = new Glide(target, () => SMOOTH_TAU);
    glide.to('vertical', 5000);
    expect(glide.goal('vertical')).toBe(800);
    glide.to('horizontal', -50);
    expect(glide.goal('horizontal')).toBe(0);
});

test('a tau of 0 jumps at once', () => {
    const target = fakeTarget();
    const glide = new Glide(target, () => 0);
    glide.by('vertical', 40);
    glide.by('vertical', 40);
    expect(target.at.vertical).toBe(80);
    expect(glide.running).toBe(false);
});

test('a scroll from elsewhere stops the glide', () => {
    const target = fakeTarget();
    const glide = new Glide(target, () => SMOOTH_TAU);
    glide.to('vertical', 400);
    glide.step(16.7);
    target.at.vertical += 50;
    glide.step(16.7);
    expect(glide.running).toBe(false);
    expect(glide.goal('vertical')).toBeNull();
});

test('stop drops one axis or both', () => {
    const target = fakeTarget();
    const glide = new Glide(target, () => SMOOTH_TAU);
    glide.to('vertical', 400);
    glide.to('horizontal', 400);
    glide.stop('vertical');
    expect(glide.goal('vertical')).toBeNull();
    expect(glide.goal('horizontal')).toBe(400);
    glide.stop();
    expect(glide.running).toBe(false);
});
