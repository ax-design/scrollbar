import { expect, test } from 'bun:test';
import { FOLLOW_TAU, SETTLE, follow, followThumb } from '../src/follow.js';

test('follow matches the reference lerp of 0.15 per 60 Hz frame', () => {
    const one = follow(0, 100, 1000 / 60, FOLLOW_TAU);
    expect(one).toBeGreaterThan(15);
    expect(one).toBeLessThan(16);
});

test('follow is the same after the same time at any frame rate', () => {
    let at60 = 0;
    for (let i = 0; i < 6; i++) at60 = follow(at60, 100, 1000 / 60, FOLLOW_TAU);
    let at120 = 0;
    for (let i = 0; i < 12; i++) at120 = follow(at120, 100, 1000 / 120, FOLLOW_TAU);
    expect(at60).toBeCloseTo(at120, 6);
});

test('follow never passes its target and lands within SETTLE', () => {
    let at = 0;
    let frames = 0;
    while (at !== 100 && frames < 1000) {
        const next = follow(at, 100, 16.7, FOLLOW_TAU);
        expect(next).toBeGreaterThan(at);
        expect(next).toBeLessThanOrEqual(100);
        at = next;
        frames++;
    }
    expect(at).toBe(100);
    expect(follow(100 - SETTLE / 2, 100, 1, FOLLOW_TAU)).toBe(100);
});

test('a tau of 0 is immediate', () => {
    expect(follow(0, 42, 16.7, 0)).toBe(42);
    expect(followThumb({ offset: 0, length: 10 }, 30, 20, 16.7, 0)).toEqual({ offset: 30, length: 20 });
});

test('followThumb lands at once without a drawn thumb and chases otherwise', () => {
    expect(followThumb(null, 30, 20, 16.7, FOLLOW_TAU)).toEqual({ offset: 30, length: 20 });
    const next = followThumb({ offset: 0, length: 20 }, 30, 40, 16.7, FOLLOW_TAU);
    expect(next.offset).toBeGreaterThan(0);
    expect(next.offset).toBeLessThan(30);
    expect(next.length).toBeGreaterThan(20);
    expect(next.length).toBeLessThan(40);
});
