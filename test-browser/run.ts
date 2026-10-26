import { existsSync } from 'node:fs';
// Builds page.html and runs the browser checks of the scrollbar against it.
// Usage: bun test-browser/run.ts [chromium|firefox|webkit ...]   (default: chromium)
import { join } from 'node:path';
import { deriveTones, toOklch } from '../src/kits/luna/tones.js';

const dir = import.meta.dir;
const dist = join(dir, 'dist');
// Sibling packages resolve to their sources through the `source` export condition.
// The acrylic package: a sibling checkout's sources when there is one (with the same copies of the
// others as ours), else the installed package.
const sibling = join(dir, '../../acrylic/src/index.ts');
const useSibling = existsSync(sibling);
const built = await Bun.build({
    entrypoints: [join(dir, 'page.html')],
    outdir: dist,
    conditions: ['source'],
    plugins: [
        // The Luna kit imports the package by name: the sources of this checkout.
        {
            name: 'ax-scrollbar',
            setup(b) {
                b.onResolve({ filter: /^@ax-design\/scrollbar$/ }, () => ({ path: join(dir, '../src/index.ts') }));
            },
        },
        ...(!useSibling ? [] : [{
            name: 'ax-acrylic',
            setup(b: any) {
                b.onResolve({ filter: /^@ax-design\/acrylic$/ }, () => ({ path: sibling }));
                for (const name of ['surface', 'shape', 'typed-om']) {
                    b.onResolve({ filter: new RegExp(`^@ax-design/${name}$`) }, (args: { importer: string }) => (args.importer.includes('/acrylic/') ? { path: join(dir, `../../${name}/src/index.ts`) } : undefined));
                }
            },
        }]),
    ],
});
if (!built.success) throw new Error(built.logs.join('\n'));

const server = Bun.serve({
    port: 0,
    fetch(req) {
        const path = new URL(req.url).pathname;
        const file = Bun.file(join(dist, path === '/' ? 'page.html' : path));
        return file.size ? new Response(file) : new Response('', { status: 404 });
    },
});

interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface Ctx {
    page: any;
    call<T = any>(fn: string, ...args: unknown[]): Promise<T>;
    box(id: string, name: string): Promise<Box>;
    tokens(id: string, name: string): Promise<string[]>;
    frames(n?: number): Promise<void>;
    // Waits until every glide and follow is over.
    settle(): Promise<void>;
    sleep(ms: number): Promise<void>;
    reset(): Promise<void>;
    park(): Promise<void>;
    // A second page in a context with touch, driven by CDP touch events. Made on first use.
    touch(): Promise<TouchCtx>;
    // A page of its own at a device pixel ratio; close() when done.
    scaled(dpr: number): Promise<{ page: any; call<T = any>(fn: string, ...args: unknown[]): Promise<T>; close(): Promise<void> }>;
    // A browser of its own whose screen has `dpr` device pixels per CSS px (--force-device-scale-factor), as a
    // zoomed or scaled desktop has: layout and snapping are in device pixels, which an emulated ratio does not do.
    real(dpr: number): Promise<{ page: any; call<T = any>(fn: string, ...args: unknown[]): Promise<T>; close(): Promise<void> }>;
}

interface TouchCtx {
    page: any;
    call<T = any>(fn: string, ...args: unknown[]): Promise<T>;
    box(id: string, name: string): Promise<Box>;
    tokens(id: string, name: string): Promise<string[]>;
    frames(n?: number): Promise<void>;
    settle(): Promise<void>;
    sleep(ms: number): Promise<void>;
    reset(): Promise<void>;
    // One finger: down, moved, lifted.
    start(x: number, y: number): Promise<void>;
    move(x: number, y: number): Promise<void>;
    end(): Promise<void>;
}

class CheckFailure extends Error {}

const expect = (ok: boolean, message: string): void => {
    if (!ok) throw new CheckFailure(message);
};

const round = (n: number): number => Number(n.toFixed(3));

const near = (actual: number, want: number, tol: number, what: string): void => {
    if (!(Math.abs(actual - want) <= tol)) throw new CheckFailure(`${what}: got ${round(actual)}, want ${round(want)} +-${tol}`);
};

const isInt = (n: number): boolean => Math.abs(n - Math.round(n)) < 0.01;
const centre = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
const has = (tokens: string[], token: string): boolean => tokens.includes(token);

// The two marker positions are fixed by the page: #v scrolls 1800px, its thumb travels as the track minus the thumb.
const MAX_V = 1800;

type Check = { name: string; run: (t: Ctx) => Promise<void> };

const checks: Check[] = [
    {
        name: 'properties are registered with the browser by register() and defineLunaKit(), before any part is made: a part first made later invalidates no page',
        run: async (t) => {
            // A registered property reads as its initial value on any element; one that is not, as nothing.
            const registered = (names: string[]) =>
                t.page.evaluate((list) => list.filter((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() !== ''), names);
            // The host tokens, the look inputs, the CSS-only ones, the fill and the glyph layers, the elevation of a card.
            const package_ = ['--ax-scrollbar-thickness', '--ax-scrollbar-idle-delay', '--ax-scrollbar-part-size', '--ax-scrollbar-part-color', '--ax-scrollbar-card-slide-distance', '--ax-scrollbar-part-fill-clip', '--ax-scrollbar-glyph-width', '--ax-scrollbar-glyph-shape', '--elevation-depth'];
            const got = await registered(package_);
            expect(got.length === package_.length, `not registered by register(): ${package_.filter((n) => !got.includes(n)).join(' ')}`);
            // The Luna tokens: with the kit, before the first Luna part.
            const luna = ['--luna-light', '--luna-accent-light', '--luna-accent', '--luna-accent-deep', '--luna-glyph'];
            expect(!(await t.call<boolean>('hasLuna')), 'precondition: the Luna kit is not defined yet');
            expect((await registered(luna)).length === 0, 'the Luna tokens are registered before the kit is defined');
            await t.call('defineLuna');
            const lunaGot = await registered(luna);
            expect(lunaGot.length === luna.length, `not registered by defineLunaKit(): ${luna.filter((n) => !lunaGot.includes(n)).join(' ')}`);
        },
    },
    {
        name: 'thumb length and offset',
        run: async (t) => {
            await t.reset();
            const area = await t.box('v', 'area-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            // The 20px minimum (min-height) wins over round(track * 200 / 2000) for this 180px track.
            near(thumb.height, Math.max(20, Math.round((area.height * 200) / 2000)), 1, 'thumb length at top');
            near(thumb.top - area.top, 0, 0.01, 'thumb offset at top');

            await t.call('setScroll', 'v', 900);
            await t.settle();
            const m = await t.call('metrics', 'v');
            expect(m.scrollHeight - m.clientHeight === MAX_V, `precondition: max scroll is ${m.scrollHeight - m.clientHeight}, want ${MAX_V}`);
            const area2 = await t.box('v', 'area-vertical');
            const thumb2 = await t.box('v', 'thumb-vertical');
            const travel = area2.height - thumb2.height;
            near(thumb2.top - area2.top, (900 / MAX_V) * travel, 0.01, 'thumb offset at scrollTop 900');
        },
    },
    {
        name: 'host proxies scrollTop and scroll event',
        run: async (t) => {
            await t.reset();
            await t.call('watch', 'v', 'scroll');
            await t.call('setScroll', 'v', 100);
            await t.frames(3);
            const s = await t.call('scrollOf', 'v');
            expect(s.host === 100, `host.scrollTop is ${s.host}, want 100`);
            expect(s.viewport === 100, `viewport.scrollTop is ${s.viewport}, want 100`);
            const events = await t.call<{ type: string }[]>('log', 'v');
            expect(events.some((e) => e.type === 'scroll'), `no scroll event on the host (saw ${events.length} events)`);
        },
    },
    {
        name: 'drag thumb scrolls by 30 * ratio',
        run: async (t) => {
            await t.reset();
            const area = await t.box('v', 'area-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            const m = await t.call('metrics', 'v');
            const ratio = (m.scrollHeight - m.clientHeight) / (area.height - thumb.height);
            const c = centre(thumb);
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            await t.page.mouse.move(c.x, c.y + 30, { steps: 6 });
            await t.page.mouse.up();
            await t.frames(2);
            const s = await t.call('scrollOf', 'v');
            near(s.host, 30 * ratio, 1, 'scrollTop after dragging the thumb 30px');
        },
    },
    {
        name: 'track page step, hold repeats to the thumb, piece token',
        run: async (t) => {
            await t.reset();
            const area = await t.box('v', 'area-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            const m = await t.call('metrics', 'v');
            const max = m.scrollHeight - m.clientHeight;
            const travel = area.height - thumb.height;
            // pageStep(client, line) = max(line, client - line) = max(40, 160).
            const step = Math.max(40, m.clientHeight - 40);
            // Pointer 30px below the thumb: along the track it is 60px from the start.
            const x = thumb.left + thumb.width / 2;
            const y = thumb.bottom + 40;
            const along = y - area.top;

            // A single click pages once and stops (the press ends before the repeat delay).
            await t.page.mouse.move(x, y);
            await t.page.mouse.down();
            await t.page.mouse.up();
            await t.settle();
            near((await t.call('scrollOf', 'v')).host, step, 0.5, 'scrollTop after one click on the track');

            // Holding: pages repeatedly until the thumb reaches the pointer.
            await t.reset();
            await t.page.mouse.move(x, y);
            await t.page.mouse.down();
            await t.frames(2);
            const held = await t.tokens('v', 'track-piece-end-vertical');
            expect(has(held, 'track-piece-pressed'), `track-piece-pressed missing while held (tokens: ${held.join(' ')})`);

            // The repeat stops once the thumb covers the pointer (2.4: the token means a repeat is held).
            let want = step;
            const offset = (p: number) => (Math.min(p, max) / max) * travel;
            while (along >= offset(want) + thumb.height) want += step;
            await t.sleep(100 + 5 * 30);
            await t.settle();
            near((await t.call('scrollOf', 'v')).host, want, 0.5, 'scrollTop when the thumb reaches the pointer');
            const stopped = await t.tokens('v', 'track-piece-end-vertical');
            expect(!has(stopped, 'track-piece-pressed'), 'track-piece-pressed still set after the repeat stopped');
            await t.sleep(150);
            near((await t.call('scrollOf', 'v')).host, want, 0.5, 'scrollTop after the repeat stopped (no more steps)');

            await t.page.mouse.up();
            await t.frames(2);
            const released = await t.tokens('v', 'track-piece-end-vertical');
            expect(!has(released, 'track-piece-pressed'), 'track-piece-pressed still set after release');
        },
    },
    {
        name: 'end button steps by 40 and repeats',
        run: async (t) => {
            await t.reset();
            const b = await t.box('v', 'button-end-vertical');
            const c = centre(b);
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            await t.page.mouse.up();
            await t.settle();
            near((await t.call('scrollOf', 'v')).host, 40, 0.5, 'scrollTop after one click on the end button');

            await t.reset();
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            await t.frames(2);
            const held = await t.tokens('v', 'button-end-vertical');
            expect(has(held, 'button-pressed'), 'button-pressed missing while held');
            // The first step is at press, then one per repeat-interval after repeat-delay.
            await t.sleep(100 + 5 * 30);
            await t.page.mouse.up();
            await t.settle();
            const s = (await t.call('scrollOf', 'v')).host;
            expect(s >= 160, `scrollTop after holding the end button is ${s}, want at least 160 (repeats)`);
        },
    },
    {
        name: 'indicator mouse, timeout, hover on bar',
        run: async (t) => {
            await t.reset();
            const delay = await t.call<string>('hostCustom', 'v', '--ax-scrollbar-idle-delay');
            expect(delay === '0.3s', `precondition: --ax-scrollbar-idle-delay is ${delay}`);
            const timeout = 300;
            await t.park();
            await t.sleep(timeout + 150);
            expect((await t.call('hostAttr', 'v', 'indicator-state')) === 'none', 'indicator not none before any move');

            await t.page.mouse.move(100, 100);
            await t.frames(2);
            expect((await t.call('hostAttr', 'v', 'indicator-state')) === 'mouse', `indicator after a move is "${await t.call('hostAttr', 'v', 'indicator-state')}"`);
            await t.sleep(timeout + 150);
            expect((await t.call('hostAttr', 'v', 'indicator-state')) === 'none', 'indicator still mouse after the hide delay');

            const bar = await t.box('v', 'scrollbar-vertical');
            await t.page.mouse.move(bar.left + bar.width / 2, 100);
            await t.frames(2);
            const vs = await t.call('hostAttr', 'v', 'vertical-state');
            expect(vs.split(' ').includes('hover'), `vertical-state is "${vs}", want hover over the bar`);
            expect((await t.call('hostAttr', 'v', 'indicator-state')) === 'mouse', 'indicator not mouse over the bar');
            // A pointer over the bar keeps the indicator past the timeout.
            await t.sleep(timeout + 150);
            expect((await t.call('hostAttr', 'v', 'indicator-state')) === 'mouse', 'indicator expired while the pointer is over the bar');
        },
    },
    {
        name: 'not scrollable: always shows disabled, auto hides',
        run: async (t) => {
            await t.reset();
            const alwaysState = (await t.call('hostAttr', 'always', 'vertical-state')).split(' ');
            expect(has(alwaysState, 'visible') && has(alwaysState, 'disabled'), `always: vertical-state "${alwaysState.join(' ')}", want visible disabled`);
            expect((await t.call('display', 'always', 'scrollbar-vertical')) !== 'none', 'always: bar display is none');
            const aArea = await t.box('always', 'area-vertical');
            const aThumb = await t.box('always', 'thumb-vertical');
            near(aThumb.height, aArea.height, 0.5, 'always: thumb fills the track');

            const autoState = (await t.call('hostAttr', 'auto', 'vertical-state')).split(' ');
            expect(!has(autoState, 'visible'), `auto: vertical-state "${autoState.join(' ')}", want no visible`);
            expect((await t.call('display', 'auto', 'scrollbar-vertical')) === 'none', `auto: bar display is ${await t.call('display', 'auto', 'scrollbar-vertical')}, want none`);
        },
    },
    {
        name: 'both bars overlay the viewport (no inset), draw the corner and write their sizes on the host',
        run: async (t) => {
            await t.reset();
            const vs = (await t.call('hostAttr', 'both', 'vertical-state')).split(' ');
            const hs = (await t.call('hostAttr', 'both', 'horizontal-state')).split(' ');
            expect(has(vs, 'visible') && has(hs, 'visible'), `both: states "${vs.join(' ')}" / "${hs.join(' ')}", want both visible`);

            const host = await t.box('both', 'host');
            const vp = await t.box('both', 'viewport');
            const vBar = await t.box('both', 'scrollbar-vertical');
            const hBar = await t.box('both', 'scrollbar-horizontal');
            const corner = await t.box('both', 'corner');
            const vT = vBar.width;
            const hT = hBar.height;
            near(vT, 10, 0.5, 'vertical bar thickness');
            near(host.right - vp.right, 0, 0.5, 'the viewport is not made smaller on the right');
            near(host.bottom - vp.bottom, 0, 0.5, 'the viewport is not made smaller at the bottom');
            near(vBar.right, host.right, 0.5, 'the vertical bar is at the right edge, over the viewport');
            near(vBar.bottom, host.bottom - hT, 0.5, 'the vertical bar ends above the horizontal one');
            near(hBar.right, host.right - vT, 0.5, 'the horizontal bar ends before the vertical one');
            expect((await t.call('display', 'both', 'corner')) !== 'none', 'corner is not displayed with both bars');
            near(corner.width, vT, 0.5, 'corner width');
            near(corner.height, hT, 0.5, 'corner height');
            near(corner.left, host.right - vT, 0.5, 'corner at the bottom right');
            const custom = await t.call<string>('hostCustom', 'both', '--ax-scrollbar-vertical-size');
            expect(custom === '10px', `--ax-scrollbar-vertical-size is "${custom}", want 10px`);
            const horizontal = await t.call<string>('hostCustom', 'both', '--ax-scrollbar-horizontal-size');
            expect(horizontal === '10px', `--ax-scrollbar-horizontal-size is "${horizontal}", want 10px`);
        },
    },
    {
        name: 'the corner takes presses (no scroll, no selection, no click on the content) and lets the wheel scroll',
        run: async (t) => {
            await t.reset();
            // Listeners on the content under the corner count what reaches it.
            await t.page.evaluate(() => {
                const content = document.getElementById('both')!.firstElementChild as HTMLElement;
                const seen = { down: 0, click: 0, select: 0, mouseDown: 0 };
                (window as any).__corner = seen;
                content.addEventListener('click', () => seen.click++);
                content.addEventListener('mousedown', () => seen.mouseDown++);
                document.addEventListener('selectstart', () => seen.select++);
            });
            const read = () => t.page.evaluate(() => ({ ...(window as any).__corner }));
            const corner = await t.box('both', 'corner');
            const c = centre(corner);
            const before = await t.call('scrollOf', 'both');
            await t.page.mouse.move(c.x, c.y);
            await t.frames(2);
            await t.page.mouse.down();
            await t.page.mouse.move(c.x - 1, c.y - 1);
            await t.page.mouse.up();
            await t.frames(2);
            const seen = await read();
            expect(seen.click === 0, `a click on the corner reached the content (${seen.click})`);
            expect(seen.mouseDown === 0, `a mousedown on the corner reached the content (${seen.mouseDown})`);
            expect(seen.select === 0, `a press on the corner started a text selection (${seen.select})`);
            const after = await t.call('scrollOf', 'both');
            expect(after.host === before.host, `a press on the corner scrolled (${before.host} -> ${after.host})`);
            // A click just outside the corner, on the content, still arrives.
            await t.page.mouse.click(corner.left - 30, corner.top - 30);
            expect((await read()).click === 1, 'a click beside the corner did not reach the content');
            // The wheel over the corner scrolls the scroller natively.
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.wheel(0, 100);
            await t.frames(4);
            expect((await t.call('scrollOf', 'both')).host > 0, 'the wheel over the corner did not scroll');
            await t.reset();
        },
    },
    {
        name: 'rtl: horizontal thumb at right edge, drag left scrolls to end, bar on left',
        run: async (t) => {
            await t.reset();
            const area = await t.box('rtl', 'area-horizontal');
            const thumb = await t.box('rtl', 'thumb-horizontal');
            const host = await t.box('rtl', 'host');
            const vBar = await t.box('rtl', 'scrollbar-vertical');
            near(thumb.right, area.right, 0.5, 'horizontal thumb right edge at scroll start');
            near(vBar.left, host.left, 0.5, 'vertical bar on the left edge');
            expect(vBar.right < host.left + host.width / 2, 'vertical bar is not in the left half');

            const m = await t.call('metrics', 'rtl');
            const ratio = (m.scrollWidth - m.clientWidth) / (area.width - thumb.width);
            const c = centre(thumb);
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            await t.page.mouse.move(c.x - 30, c.y, { steps: 6 });
            await t.page.mouse.up();
            await t.frames(2);
            // scrollLeft runs negative toward the end in right-to-left layouts.
            const s = await t.call('scrollOf', 'rtl');
            near(s.left, -30 * ratio, 1, 'scrollLeft after dragging the thumb left 30px');
        },
    },
    {
        name: 'markers: position, on-thumb, current, card, swap, leave, click',
        run: async (t) => {
            await t.reset();
            const area = await t.box('v', 'area-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            const m = await t.call('metrics', 'v');
            const max = m.scrollHeight - m.clientHeight;
            expect(max === MAX_V, `precondition: max scroll is ${max}`);
            const travel = area.height - thumb.height;

            // Marker centre on the track: anchor / max * travel at scroll 0.
            for (const p of [0, 500, 1000, 1500]) {
                const mb = await t.box('v', `marker:m${p}`);
                near(mb.top + mb.height / 2, area.top + (p / max) * travel, 0.5, `marker m${p} centre on the track`);
            }

            let m0 = await t.tokens('v', 'marker:m0');
            let m500 = await t.tokens('v', 'marker:m500');
            expect(has(m0, 'marker-on-thumb') && !has(m500, 'marker-on-thumb'), `at 0: marker-on-thumb wrong (m0 "${m0.join(' ')}", m500 "${m500.join(' ')}")`);
            expect(has(m0, 'marker-current') && !has(m500, 'marker-current'), 'at 0: marker-current is not m0');

            await t.call('setScroll', 'v', 900);
            await t.settle();
            const m1000 = await t.tokens('v', 'marker:m1000');
            m0 = await t.tokens('v', 'marker:m0');
            m500 = await t.tokens('v', 'marker:m500');
            expect(has(m1000, 'marker-on-thumb') && !has(m0, 'marker-on-thumb'), 'at 900: marker-on-thumb did not follow the thumb to m1000');
            expect(has(m500, 'marker-current') && !has(m1000, 'marker-current'), 'at 900: marker-current is not m500');

            await t.call('setScroll', 'v', MAX_V);
            await t.settle();
            expect(has(await t.tokens('v', 'marker:m1500'), 'marker-current'), 'at the end: marker-current is not m1500');

            // Hover a marker: the card opens at the left of the bar.
            await t.reset();
            await t.page.mouse.move(...Object.values(centre(await t.box('v', 'marker:m500'))) as [number, number]);
            await t.frames(2);
            let shown = (await t.call<any[]>('cards', 'v')).filter((c) => c.classes.includes('open'));
            expect(shown.length === 1 && shown[0].text === 'Section 500', `hover m500: open cards ${JSON.stringify(shown.map((c) => c.text))}`);
            const bar = await t.box('v', 'scrollbar-vertical');
            expect(shown[0].box.right <= bar.left, 'card is not at the left of the bar');
            near(bar.left - shown[0].box.right, 12, 1, 'card gap to the bar (12px by default, the reference cardOffset)');

            // Jump straight to m1000 (one move, no marker-free step): the card swaps.
            await t.page.mouse.move(...Object.values(centre(await t.box('v', 'marker:m1000'))) as [number, number], { steps: 1 });
            await t.frames(1);
            const cards = await t.call<any[]>('cards', 'v');
            const old = cards.find((c) => c.text === 'Section 500');
            const next = cards.find((c) => c.text === 'Section 1000' && c.classes.includes('open'));
            expect(next !== undefined, 'swap: no open card for Section 1000');
            expect(old !== undefined && old.classes.includes('card-exit'), `swap: old card classes "${old?.classes.join(' ')}", want card-exit`);
            expect(next.classes.includes('card-forward'), `swap: new card classes "${next.classes.join(' ')}", want card-forward`);

            // Leave: the card closes after its exit transition (0.1s in the test theme).
            const t0 = Date.now();
            await t.page.mouse.move(100, 100);
            const afterLeave = await t.call<any[]>('cards', 'v');
            expect(afterLeave.some((c) => c.classes.includes('card-exit')), 'leave: no card in card-exit right after leaving');
            let closedAt = -1;
            while (Date.now() - t0 < 1000) {
                if (!(await t.call<any[]>('cards', 'v')).some((c) => c.classes.includes('open'))) {
                    closedAt = Date.now() - t0;
                    break;
                }
                await t.sleep(5);
            }
            expect(closedAt >= 0, 'leave: the card is still open after 1s');
            expect(closedAt >= 90, `leave: card closed after ${closedAt}ms, before its 100ms exit transition`);

            // Click a marker: markeractivate fires and the view scrolls to the marker.
            await t.reset();
            await t.call('watch', 'v', 'markeractivate');
            const c500 = centre(await t.box('v', 'marker:m500'));
            await t.page.mouse.move(c500.x, c500.y);
            await t.page.mouse.down();
            await t.page.mouse.up();
            const logged = await t.call<{ type: string; id?: string }[]>('log', 'v');
            expect(logged.some((e) => e.type === 'markeractivate' && e.id === 'm500'), `markeractivate for m500 not seen (log ${JSON.stringify(logged)})`);
            // The scroll is smooth (no reduced motion): poll until it settles on the anchor.
            let got = -1;
            const deadline = Date.now() + 2000;
            while (Date.now() < deadline) {
                got = (await t.call('scrollOf', 'v')).viewport;
                if (Math.abs(got - 500) < 1) break;
                await t.sleep(20);
            }
            near(got, 500, 1, 'scrollTop after clicking m500');
        },
    },
    {
        name: 'the default thumb is an ax-scrollbar-thumb surface drawn with scrollbar-fill, with its state',
        run: async (t) => {
            await t.reset();
            const tag = await t.call('tagOf', 'surf', 'thumb-vertical');
            expect(tag === 'AX-SCROLLBAR-THUMB', `thumb is ${tag}, want AX-SCROLLBAR-THUMB`);
            const thumb = await t.box('surf', 'thumb-vertical');
            const c = centre(thumb);
            await t.page.mouse.move(c.x, c.y);
            await t.frames(4);
            const look = await t.page.evaluate(() => {
                const el = (document.getElementById('surf') as HTMLElement).shadowRoot!.querySelector('[part~="thumb-vertical"]') as HTMLElement & { partState: Record<string, unknown> };
                const path = el.shadowRoot!.querySelector('.layer-scrollbar-fill svg > path') as SVGPathElement | null;
                return {
                    surface: typeof (el as unknown as { refresh?: unknown }).refresh === 'function',
                    d: path ? path.getAttribute('d') || '' : '',
                    fill: path ? path.getAttribute('fill') || '' : '',
                    radius: getComputedStyle(el).getPropertyValue('--ax-radius').trim(),
                    hoverAttr: el.hasAttribute('hover'),
                    axisAttr: el.getAttribute('axis'),
                    state: el.partState,
                };
            });
            expect(look.surface, 'the thumb has no refresh(): not a surface');
            expect(look.d.length > 0, 'the fill layer drew no outline');
            expect(look.fill.startsWith('rgba(') && !look.fill.endsWith(', 0)'), `the fill colour is "${look.fill}"`);
            expect(look.radius === '0px', `--ax-radius on the thumb is "${look.radius}", want 0px (square)`);
            expect((await t.tokens('surf', 'thumb-vertical')).includes('thumb-hover'), `thumb part is "${(await t.tokens('surf', 'thumb-vertical')).join(' ')}", want thumb-hover`);
            expect(look.hoverAttr && look.axisAttr === 'vertical', `reflected attributes: hover ${look.hoverAttr}, axis ${look.axisAttr}`);
            expect(look.state.hover === true && look.state.engaged === true && look.state.indicator === 'mouse', `partState ${JSON.stringify(look.state)}`);
            await t.park();
            await t.frames(2);
            expect(!(await t.tokens('surf', 'thumb-vertical')).includes('thumb-hover'), 'thumb-hover still set after leaving');
        },
    },
    {
        name: 'state visuals animate with --ax-scrollbar-state-smoothing, 0s is instant',
        run: async (t) => {
            const size = () =>
                t.page.evaluate(() => {
                    const el = (document.getElementById('surf') as HTMLElement).shadowRoot!.querySelector('[part~="thumb-vertical"]') as HTMLElement;
                    return el.getBoundingClientRect().width;
                });
            const hoverAndSample = async (): Promise<{ first: number; last: number }> => {
                await t.reset();
                await t.sleep(1500); // the parts at rest, narrow
                const c = centre(await t.box('surf', 'thumb-vertical'));
                await t.page.mouse.move(c.x, c.y);
                await t.frames(2);
                const first = await size();
                await t.sleep(600);
                return { first, last: await size() };
            };
            // A thumb that changes its size with the state: thin at rest, wide while hovered.
            await t.call('addStyle', 'states', '#surf::part(thumb) { --ax-scrollbar-part-size: 4px; } #surf::part(thumb-hover) { --ax-scrollbar-part-size: 10px; }');
            try {
            const slow = await hoverAndSample();
            expect(slow.first > 4.01 && slow.first < 9.99, `two frames after hovering the thumb is ${round(slow.first)}px wide, want on its way from 4 to 10`);
            near(slow.last, 10, 0.05, 'thumb width once the hover settled');
            await t.call('setStyle', 'surf', '--ax-scrollbar-state-smoothing', '0s');
            {
                const fast = await hoverAndSample();
                near(fast.first, 10, 0.05, 'thumb width two frames after hovering with 0s');
            }
            } finally {
                await t.call('addStyle', 'states', '');
                await t.call('setStyle', 'surf', '--ax-scrollbar-state-smoothing', '');
                await t.park();
            }
        },
    },
    {
        name: 'state paint latency: with 0s smoothing the fill is drawn in the frame that follows the state attribute (press, hover)',
        run: async (t) => {
            // Changes the thumb's state the way the bar does, inside a frame, then runs a chain of
            // rAF callbacks, each after the surface's frame of its tick: the result is the first
            // frame, counted from the one that followed the change, by whose end the fill path's
            // colour had changed (0: the frame that reflects the state, 1: one frame later).
            const lag = (change: { hover?: boolean; pressed?: boolean }): Promise<number> =>
                t.page.evaluate(
                    (c) =>
                        new Promise<number>((resolve) => {
                            const el = (document.getElementById('surf') as HTMLElement).shadowRoot!.querySelector('[part~="thumb-vertical"]') as any;
                            const fillOf = () => el.shadowRoot.querySelector('svg path')?.getAttribute('fill');
                            // The bar writes the part names with the state (see Piece); so does this.
                            const token = (name: string, on: boolean) => {
                                const list = new Set<string>((el.getAttribute('part') || '').split(/\s+/).filter(Boolean));
                                if (on) list.add(name);
                                else list.delete(name);
                                el.setAttribute('part', [...list].join(' '));
                            };
                            requestAnimationFrame(() => {
                                const before = fillOf();
                                if ('hover' in c) token('thumb-hover', !!c.hover);
                                if ('pressed' in c) token('thumb-pressed', !!c.pressed);
                                el.setPartState({ ...el.partState, ...c });
                                const chain = (n: number) =>
                                    requestAnimationFrame(() => {
                                        if (fillOf() !== before) resolve(n);
                                        else if (n < 8) chain(n + 1);
                                        else resolve(-1);
                                    });
                                chain(0);
                            });
                        }),
                    change,
                );
            await t.reset();
            await t.sleep(300);
            // The colours are the inputs of the part: ::part() rules, one per state.
            const set = async (on: boolean) => {
                await t.call('setStyle', 'surf', '--ax-scrollbar-state-smoothing', on ? '0s' : '');
                await t.call(
                    'addStyle',
                    'latency',
                    on
                        ? `#surf::part(thumb) { --ax-scrollbar-part-color: rgb(200, 0, 0); } #surf::part(thumb-hover) { --ax-scrollbar-part-color: rgb(0, 200, 0); } #surf::part(thumb-pressed) { --ax-scrollbar-part-color: rgb(0, 0, 200); }`
                        : '',
                );
            };
            await set(true);
            try {
                await t.frames(3);
                const into = await lag({ hover: true });
                await t.frames(3);
                const press = await lag({ pressed: true });
                await t.frames(3);
                const release = await lag({ pressed: false });
                await t.frames(3);
                const out = await lag({ hover: false });
                expect(release === 0, `press release: the fill changed ${release} frames late, want 0`);
                expect(press === 0, `press: the fill changed ${press} frames late, want 0`);
                expect(out === 0, `hover out: the fill changed ${out} frames late, want 0`);
                expect(into === 0, `hover in: the fill changed ${into} frames late, want 0`);
            } finally {
                await t.page.mouse.up().catch(() => {});
                await set(false);
                await t.park();
            }
        },
    },
    {
        name: 'hide attribute: an empty list shows the buttons with a glyph, hide="button" hides them, the default look hides nothing with the mouse',
        run: async (t) => {
            await t.reset();
            expect((await t.call('tagOf', 'v', 'button-end-vertical')) === 'AX-SCROLLBAR-BUTTON', 'the button is not an ax-scrollbar-button');
            expect((await t.call('display', 'v', 'button-end-vertical')) !== 'none', 'hide="": the end button is not displayed');
            const glyph = await t.page.evaluate(() => {
                const el = (document.getElementById('v') as HTMLElement).shadowRoot!.querySelector('[part~="button-end"][part~="button-vertical"]') as HTMLElement;
                const polygon = el.shadowRoot!.querySelector('.layer-scrollbar-glyph polygon');
                return polygon ? polygon.getAttribute('points') || '' : '';
            });
            expect(glyph.split(' ').length === 6, `the glyph polygon is "${glyph}", want a chevron of 6 points`);
            const withButtons = await t.box('v', 'area-vertical');
            await t.call('setAttr', 'v', 'hide', 'button');
            try {
                await t.settle();
                expect((await t.call('display', 'v', 'button-end-vertical')) === 'none', 'hide="button": the end button is displayed');
                const without = await t.box('v', 'area-vertical');
                near(without.height - withButtons.height, 20, 0.5, 'the track takes the room of the two buttons');
                await t.call('setAttr', 'v', 'hide', null);
                await t.settle();
                expect((await t.call('display', 'v', 'button-end-vertical')) !== 'none', 'no attribute, no kit: the default look shows the buttons with the mouse indicator');
            } finally {
                await t.call('setAttr', 'v', 'hide', '');
                await t.settle();
            }
        },
    },
    {
        name: 'ax-scrollbar hides native scrollbar and follows window.scrollTo',
        run: async (t) => {
            await t.reset();
            const native = await t.call('pageNative');
            expect(native.styleText.includes('scrollbar-width: none'), 'document style has no scrollbar-width: none');
            expect(native.gutter === 0, `native scrollbar takes ${native.gutter}px`);
            await t.call('scrollPage', 1200);
            await t.settle();
            const m = await t.call('metrics', 'page');
            const max = m.scrollHeight - m.clientHeight;
            expect(max > 0, 'page is not scrollable');
            const area = await t.box('page', 'area-vertical');
            const thumb = await t.box('page', 'thumb-vertical');
            const travel = area.height - thumb.height;
            near(thumb.top - area.top, (1200 / max) * travel, 0.5, 'page thumb offset after scrollTo(0, 1200)');
            await t.call('scrollPage', 0);
            await t.frames(2);
        },
    },
    {
        name: 'ax-scrollbar follows the size of the document and the places of its markers without a scroll or a resize: a style sheet changes the content inside a box that keeps its size',
        run: async (t) => {
            await t.reset();
            await t.page.evaluate(() => {
                const bar = document.getElementById('page') as HTMLElement;
                const shell = document.createElement('div');
                shell.id = 'doc-shell';
                shell.style.cssText = 'position: absolute; left: 0; top: 0; width: 100px; height: 50px';
                shell.innerHTML = '<style>#doc-inner { position: relative; width: 2000px; height: 3000px } .dm { position: absolute; left: 0; margin: 0 } #dm1 { top: 1000px } #dm2 { top: 2000px }</style><div id="doc-inner"><h4 id="dm1" class="dm">One</h4><h4 id="dm2" class="dm">Two</h4></div>';
                document.body.appendChild(shell);
                bar.setAttribute('marker-selector', '.dm');
            });
            await t.settle();
            const read = async () => {
                const m = await t.call('metrics', 'page');
                const area = await t.box('page', 'area-vertical');
                const thumb = await t.box('page', 'thumb-vertical');
                const areaX = await t.box('page', 'area-horizontal');
                const thumbX = await t.box('page', 'thumb-horizontal');
                const m1 = await t.box('page', 'marker:dm1');
                const m2 = await t.box('page', 'marker:dm2');
                return { m, area, thumb, areaX, thumbX, y1: m1.top - area.top, y2: m2.top - area.top };
            };
            try {
                const before = await read();
                await t.page.evaluate(() => {
                    const sheet = new CSSStyleSheet();
                    sheet.replaceSync('#doc-inner { width: 6000px; height: 9000px } #dm1 { top: 3000px } #dm2 { top: 6000px } ');
                    (window as unknown as { docSheet: CSSStyleSheet }).docSheet = sheet;
                    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
                });
                // A style sheet gives no mutation and no resize of anything observed, and nothing is polled:
                // the page's bars compare its size in the first frame that runs, here for a pointer at the bar.
                await t.page.mouse.move(796, 300);
                await t.sleep(1000);
                const after = await read();
                const real = await t.page.evaluate(() => document.scrollingElement!.scrollHeight);
                expect(real > before.m.scrollHeight, `precondition: the document grew (${before.m.scrollHeight} to ${real})`);
                // The truth: what a window resize lays out.
                await t.page.evaluate(() => window.dispatchEvent(new Event('resize')));
                await t.sleep(1000);
                const truth = await read();
                near(after.thumb.height, truth.thumb.height, 0.5, 'thumb height without a resize');
                near(after.thumbX.width, truth.thumbX.width, 0.5, 'horizontal thumb width without a resize');
                near(after.y1, truth.y1, 0.5, 'first marker without a resize');
                near(after.y2, truth.y2, 0.5, 'second marker without a resize');
                expect(Math.abs(after.thumb.height - before.thumb.height) > 1, `the thumb did not change with the document (${before.thumb.height} and ${after.thumb.height})`);
                // A node added: the next frame or two.
                await t.page.evaluate(() => {
                    const add = document.createElement('div');
                    add.style.cssText = 'position: absolute; top: 0; left: 0; width: 1px; height: 14000px';
                    document.getElementById('doc-inner')!.appendChild(add);
                });
                await t.sleep(1000);
                const added = await read();
                await t.page.evaluate(() => window.dispatchEvent(new Event('resize')));
                await t.sleep(1000);
                const addedTruth = await read();
                near(added.thumb.height, addedTruth.thumb.height, 0.5, 'thumb height after a node was added');
                near(added.y2, addedTruth.y2, 0.5, 'marker after a node was added');
                expect(Math.abs(added.thumb.height - after.thumb.height) > 1, 'the thumb did not change when a node grew the document');
            } finally {
                await t.page.evaluate(() => {
                    const w = window as unknown as { docSheet?: CSSStyleSheet };
                    if (w.docSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== w.docSheet);
                    document.getElementById('doc-shell')?.remove();
                    document.getElementById('page')?.removeAttribute('marker-selector');
                });
                await t.sleep(1000);
            }
        },
    },
    {
        name: 'snap: thumb edges on whole device pixels at a fractional y',
        run: async (t) => {
            await t.reset();
            const area = await t.box('snap', 'area-vertical');
            expect(!isInt(area.top), `precondition: track top ${area.top} is whole, the test needs a fraction`);
            for (const at of [0, 200]) {
                await t.call('setScroll', 'snap', at);
                await t.settle();
                const thumb = await t.box('snap', 'thumb-vertical');
                expect(isInt(thumb.top), `scrollTop ${at}: thumb top ${thumb.top} is not whole (track top ${area.top})`);
                expect(isInt(thumb.height), `scrollTop ${at}: thumb height ${thumb.height} is not whole`);
            }
        },
    },
    {
        name: 'glide: a button click animates, two quick clicks add up',
        run: async (t) => {
            await t.reset();
            const c = centre(await t.box('v', 'button-end-vertical'));
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            await t.page.mouse.up();
            await t.frames(1);
            const first = (await t.call('scrollOf', 'v')).host;
            expect(first > 0 && first < 40, `one frame after a click scrollTop is ${first}, want strictly between 0 and 40`);
            await t.settle();
            near((await t.call('scrollOf', 'v')).host, 40, 0.5, 'scrollTop after the glide of one click');

            await t.reset();
            await t.page.mouse.move(c.x, c.y);
            await t.call('startSample', 'v');
            for (let i = 0; i < 2; i++) {
                await t.page.mouse.down();
                await t.page.mouse.up();
            }
            await t.settle();
            const rows = await t.call<{ scroll: number }[]>('stopSample');
            near(rows[rows.length - 1].scroll, 80, 0.5, 'scrollTop after two quick clicks');
            // From the first frame that moved to the one that arrived, every frame moves on: the
            // second click joins the glide instead of waiting for the first to end.
            const values = rows.map((r) => r.scroll);
            const from = values.findIndex((v) => v > 0);
            const to = values.findIndex((v) => v >= 79.5);
            const way = values.slice(from, to + 1);
            for (let i = 1; i < way.length; i++) {
                expect(way[i] > way[i - 1], `the glide stood still or turned back at ${round(way[i - 1])} (frames ${way.map(round).join(' ')})`);
            }
        },
    },
    {
        name: 'glide: holding a button rises without jumps',
        run: async (t) => {
            await t.reset();
            const c = centre(await t.box('v', 'button-end-vertical'));
            await t.page.mouse.move(c.x, c.y);
            await t.call('startSample', 'v');
            await t.page.mouse.down();
            await t.sleep(400);
            await t.page.mouse.up();
            await t.settle();
            const rows = (await t.call<{ scroll: number }[]>('stopSample')).map((r) => r.scroll);
            let biggest = 0;
            for (let i = 1; i < rows.length; i++) {
                expect(rows[i] >= rows[i - 1], `scrollTop went back from ${rows[i - 1]} to ${rows[i]}`);
                biggest = Math.max(biggest, rows[i] - rows[i - 1]);
            }
            expect(biggest <= 40, `scrollTop jumped by ${round(biggest)} in one frame, more than one line`);
            expect(rows[rows.length - 1] >= 200, `scrollTop after holding 400ms is ${rows[rows.length - 1]}, want the repeats (at least 200)`);
        },
    },
    {
        name: 'glide: track page animates, the repeat stops at the pointer by the goal',
        run: async (t) => {
            await t.reset();
            const area = await t.box('v', 'area-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            const m = await t.call('metrics', 'v');
            const max = m.scrollHeight - m.clientHeight;
            const travel = area.height - thumb.height;
            const step = Math.max(40, m.clientHeight - 40);
            const x = thumb.left + thumb.width / 2;
            const y = thumb.bottom + 40;
            const along = y - area.top;

            await t.page.mouse.move(x, y);
            await t.page.mouse.down();
            await t.page.mouse.up();
            await t.frames(1);
            const first = (await t.call('scrollOf', 'v')).host;
            expect(first > 0 && first < step, `one frame after a track click scrollTop is ${first}, want strictly between 0 and ${step}`);
            await t.settle();
            near((await t.call('scrollOf', 'v')).host, step, 0.5, 'scrollTop after the glide of one page');

            // Held: a repeat that looked at the lagging position would page past the pointer.
            await t.reset();
            let want = step;
            const offset = (p: number) => (Math.min(p, max) / max) * travel;
            while (along >= offset(want) + thumb.height) want += step;
            await t.page.mouse.move(x, y);
            await t.call('startSample', 'v');
            await t.page.mouse.down();
            await t.sleep(400);
            await t.settle();
            await t.page.mouse.up();
            const rows = (await t.call<{ scroll: number }[]>('stopSample')).map((r) => r.scroll);
            near(rows[rows.length - 1], want, 0.5, 'scrollTop when the held page stops');
            expect(Math.max(...rows) <= want + 0.5, `the held page went past ${want} (max ${Math.max(...rows)})`);
        },
    },
    {
        name: 'follow: a programmatic scroll moves the drawn thumb over frames',
        run: async (t) => {
            await t.reset();
            const before = await t.call('drawn', 'v');
            const area = await t.box('v', 'area-vertical');
            const want = (900 / MAX_V) * (area.height - before.thumbLength);
            await t.call('setScroll', 'v', 900);
            await t.frames(1);
            const mid = await t.call('drawn', 'v');
            expect(mid.thumbTop > before.thumbTop && mid.thumbTop < want, `one frame after scrollTop = 900 the thumb is at ${round(mid.thumbTop)}, want strictly between ${before.thumbTop} and ${round(want)}`);
            // The track pieces are cut at the drawn thumb, not at the real one.
            near(mid.pieceStart, mid.thumbTop, 0.01, 'start piece ends at the drawn thumb');
            near(mid.pieceEndTop, mid.thumbTop + mid.thumbLength, 0.01, 'end piece starts at the drawn thumb end');
            await t.settle();
            near((await t.call('drawn', 'v')).thumbTop, want, 0.01, 'thumb offset once the follow is over');
            // Nothing moves any more once the bars have faded out: the frame loops have stopped.
            await t.sleep(1500);
            const frames = await t.call<number>('framesIn', 200);
            expect(frames === 0, `${frames} animation frames were requested in 200ms of rest`);
        },
    },
    {
        name: 'follow: the dragged thumb stays under the pointer',
        run: async (t) => {
            await t.reset();
            const start = await t.call('drawn', 'v');
            const c = centre(await t.box('v', 'thumb-vertical'));
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            for (let k = 1; k <= 5; k++) {
                await t.page.mouse.move(c.x, c.y + 7 * k);
                await t.frames(1);
                const d = await t.call('drawn', 'v');
                near(d.thumbTop - start.thumbTop, 7 * k, 0.05, `thumb moved with the pointer after ${7 * k}px`);
            }
            await t.page.mouse.up();
        },
    },
    {
        name: 'tokens: --ax-scrollbar-scroll-smoothing: 0s and --ax-scrollbar-thumb-smoothing: 0s are instant',
        run: async (t) => {
            await t.call('setStyle', 'v', '--ax-scrollbar-scroll-smoothing', '0s');
            await t.call('setStyle', 'v', '--ax-scrollbar-thumb-smoothing', '0s');
            try {
                await instant(t, 'tokens 0s');
            } finally {
                await t.call('setStyle', 'v', '--ax-scrollbar-scroll-smoothing', '');
                await t.call('setStyle', 'v', '--ax-scrollbar-thumb-smoothing', '');
            }
        },
    },
    {
        name: 'tokens: --ax-scrollbar-scroll-smoothing: 200ms glides slower than the default',
        run: async (t) => {
            // The share of the 40px glide done 40ms after the first frame that moved, on the page's clock.
            const progressAt40ms = async (): Promise<number> => {
                await t.reset();
                const c = centre(await t.box('v', 'button-end-vertical'));
                await t.page.mouse.move(c.x, c.y);
                const sampling = t.call<[number, number][]>('scrollSample', 'v', 400);
                await t.page.mouse.down();
                await t.page.mouse.up();
                const rows = await sampling;
                await t.settle();
                near((await t.call('scrollOf', 'v')).host, 40, 0.5, 'scrollTop after the glide');
                const first = rows.find((r) => r[1] > 0);
                expect(first !== undefined, 'the click did not start a glide within 400ms');
                const at = rows.find((r) => r[0] >= first![0] + 40);
                expect(at !== undefined, 'no frame 40ms after the glide began');
                return at![1] / 40;
            };
            const normal = await progressAt40ms();
            await t.call('setStyle', 'v', '--ax-scrollbar-scroll-smoothing', '200ms');
            try {
                const slow = await progressAt40ms();
                expect(slow + 0.2 < normal, `40ms after the glide began: ${round(slow * 100)}% with 200ms, ${round(normal * 100)}% with the default 50ms`);
            } finally {
                await t.call('setStyle', 'v', '--ax-scrollbar-scroll-smoothing', '');
            }
        },
    },
    {
        name: 'reduced motion: glide and follow are instant',
        run: async (t) => {
            await t.page.emulateMedia({ reducedMotion: 'reduce' });
            try {
                await instant(t, 'reduced motion');
            } finally {
                await t.page.emulateMedia({ reducedMotion: 'no-preference' });
            }
        },
    },
    {
        name: 'track-click="jump": a quick click glides to the pointer, press and move drags',
        run: async (t) => {
            await t.call('setAttr', 'v', 'track-click', 'jump');
            try {
                await t.reset();
                const area = await t.box('v', 'area-vertical');
                const thumb = await t.box('v', 'thumb-vertical');
                const m = await t.call('metrics', 'v');
                const ratio = (m.scrollHeight - m.clientHeight) / (area.height - thumb.height);
                const x = thumb.left + thumb.width / 2;
                const y = area.top + 120;
                const want = (120 - thumb.height / 2) * ratio;

                await t.page.mouse.move(x, y);
                await t.page.mouse.down();
                await t.page.mouse.up();
                await t.frames(1);
                const first = (await t.call('scrollOf', 'v')).host;
                expect(first > 0 && first < want, `one frame after a jump click scrollTop is ${first}, want strictly between 0 and ${round(want)}`);
                await t.settle();
                near((await t.call('scrollOf', 'v')).host, want, 1, 'scrollTop after a jump click');
                const landed = await t.box('v', 'thumb-vertical');
                near(landed.top + landed.height / 2, y, 0.5, 'thumb centre at the pointer after a jump');

                // Held longer than 300ms without moving: no jump.
                await t.reset();
                await t.page.mouse.move(x, y);
                await t.page.mouse.down();
                await t.sleep(350);
                await t.page.mouse.up();
                await t.settle();
                near((await t.call('scrollOf', 'v')).host, 0, 0.5, 'scrollTop after a slow press on the track');

                // Moved along the axis: a drag from where the pointer is when it starts.
                await t.reset();
                await t.page.mouse.move(x, y);
                await t.page.mouse.down();
                await t.page.mouse.move(x, y + 3);
                await t.page.mouse.move(x, y + 8);
                await t.frames(1);
                const dragStart = await t.call('drawn', 'v');
                const tokens = await t.tokens('v', 'thumb-vertical');
                expect(has(tokens, 'thumb-pressed'), `thumb tokens "${tokens.join(' ')}" during a jump drag, want thumb-pressed`);
                await t.page.mouse.move(x, y + 18);
                await t.frames(1);
                const dragged = await t.call('drawn', 'v');
                near(dragged.thumbTop - dragStart.thumbTop, 10, 0.05, 'thumb follows the pointer once the press drags');
                near(dragged.scroll - dragStart.scroll, 10 * ratio, 1, 'scrollTop follows the drag');
                await t.page.mouse.up();
                await t.settle();
                near((await t.call('scrollOf', 'v')).host, dragged.scroll, 0.5, 'no jump after a drag');
            } finally {
                await t.call('setAttr', 'v', 'track-click', null);
            }
        },
    },
    {
        name: 'wheel over a bar scrolls only that scroller, natively, also while a glide runs',
        run: async (t) => {
            await t.reset();
            await t.call('scrollPage', 0);
            const bar = await t.box('v', 'scrollbar-vertical');
            const x = bar.left + bar.width / 2;
            await t.page.mouse.move(x, bar.top + bar.height / 2);
            await t.page.mouse.wheel(0, 100);
            await t.settle();
            const after = await t.call<{ viewport: number }>('scrollOf', 'v');
            expect(after.viewport > 0, `wheel over the bar did not scroll the view (scrollTop ${after.viewport})`);
            expect((await t.page.evaluate(() => window.scrollY)) === 0, 'wheel over the bar scrolled the page');

            // A glide of ours (a track page) is running: the wheel takes the scroll over from it and
            // the page gets none of it.
            await t.reset();
            const thumb = await t.box('v', 'thumb-vertical');
            const y = thumb.bottom + 40;
            await t.page.mouse.move(x, y);
            await t.page.mouse.down();
            await t.frames(3);
            await t.page.mouse.up();
            const before = (await t.call('scrollOf', 'v')).viewport;
            await t.page.mouse.wheel(0, 100);
            await t.settle();
            const during = await t.call<{ viewport: number }>('scrollOf', 'v');
            // The page step is 160: a glide that went on under the wheel would end at 260 or more.
            expect(before < 160 && during.viewport > before && during.viewport < 255, `wheel during a glide: scrollTop ${before} -> ${during.viewport}, want the glide stopped`);
            expect((await t.page.evaluate(() => window.scrollY)) === 0, 'wheel during a glide scrolled the page');
            await t.reset();
        },
    },
    {
        name: 'wheel at the end of a scroller within one gesture stays with it; a new gesture at the end chains to the page',
        run: async (t) => {
            await t.reset();
            await t.call('scrollPage', 0);
            const bar = await t.box('v', 'scrollbar-vertical');
            await t.call('setScroll', 'v', MAX_V - 150);
            await t.settle();
            const x = bar.left + bar.width / 2;
            const y = bar.top + bar.height / 2;
            await t.page.mouse.move(x, y);
            // Real gestures (with begin, update and end phases, as a touchpad or a wheel makes them):
            // separate wheel events of the driver are a gesture each, and would not show latching.
            const cdp = await t.page.context().newCDPSession(t.page);
            try {
                // One gesture runs past the end of the view: the browser keeps it with the scroller.
                await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: -600, gestureSourceType: 'mouse', speed: 800 });
                await t.frames(10);
                const end = (await t.call('scrollOf', 'v')).viewport;
                expect(end === MAX_V, `the view did not reach its end: ${end}`);
                const page1 = await t.page.evaluate(() => window.scrollY);
                expect(page1 === 0, `the wheel went on to the page within the gesture (scrollY ${page1})`);
                // A new gesture at the end goes to the page.
                await t.sleep(300);
                await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: -300, gestureSourceType: 'mouse', speed: 800 });
                await t.frames(10);
            } finally {
                await cdp.detach();
            }
            const page2 = await t.page.evaluate(() => window.scrollY);
            expect(page2 > 0, 'a new gesture at the end of the view did not chain to the page');
            expect((await t.call('scrollOf', 'v')).viewport === MAX_V, 'the view moved past its end');
            await t.call('scrollPage', 0);
        },
    },
    {
        name: 'the bars take no pointer events, in every look and kit: not even a rule of the author gives them back',
        run: async (t) => {
            await t.reset();
            const all = () =>
                t.page.evaluate(() => {
                    const bad: string[] = [];
                    for (const host of Array.from(document.querySelectorAll('ax-scroll-view, ax-scrollbar'))) {
                        const root = host.shadowRoot;
                        if (!root) continue;
                        for (const node of Array.from(root.querySelectorAll('.frame, .frame *, .cards, .cards *'))) {
                            if (getComputedStyle(node).pointerEvents !== 'none') bad.push(`${host.id}:${node.getAttribute('part') || node.className || node.localName}`);
                        }
                    }
                    return bad;
                });
            expect((await all()).length === 0, `parts with pointer events: ${(await all()).join(', ')}`);
            await t.page.evaluate(() => {
                const style = document.createElement('style');
                style.id = 'events';
                style.textContent = 'ax-scroll-view::part(scrollbar-vertical), ax-scroll-view::part(thumb-vertical), ax-scroll-view::part(button-end-vertical), ax-scroll-view::part(corner), ax-scroll-view::part(track-vertical) { pointer-events: auto !important; }';
                document.head.appendChild(style);
            });
            try {
                expect((await all()).length === 0, `an author rule gave parts pointer events: ${(await all()).join(', ')}`);
                const thumb = centre(await t.box('v', 'thumb-vertical'));
                const hit = await t.call<string>('hitAt', 'v', thumb.x, thumb.y);
                expect(!/thumb|track|scrollbar|button|marker/.test(hit), `a point on the thumb hits ${hit}`);
                // Still, the thumb is dragged: the input is the host's, by geometry.
                const area = await t.box('v', 'area-vertical');
                const box = await t.box('v', 'thumb-vertical');
                const m = await t.call('metrics', 'v');
                const ratio = (m.scrollHeight - m.clientHeight) / (area.height - box.height);
                await t.page.mouse.move(thumb.x, thumb.y);
                await t.page.mouse.down();
                // Over the text on the way: the press must not start a selection there.
                await t.page.mouse.move(thumb.x - 150, thumb.y + 30, { steps: 5 });
                await t.page.mouse.up();
                await t.frames(2);
                near((await t.call('scrollOf', 'v')).host, 30 * ratio, 1, 'scrollTop after dragging the thumb of a bar without pointer events');
                expect((await t.page.evaluate(() => String(window.getSelection()))) === '', 'the drag selected text of the content');
            } finally {
                await t.page.evaluate(() => document.getElementById('events')!.remove());
            }
            await t.reset();
        },
    },
    {
        name: 'cursor: the host shows the default arrow over a bar and grabbing while dragging, and gets the author\'s value back',
        run: async (t) => {
            await t.reset();
            await t.page.evaluate(() => ((document.getElementById('v') as HTMLElement).style.cursor = 'crosshair'));
            try {
                const cursor = () => t.call<string>('computed', 'v', 'host', 'cursor');
                const thumb = centre(await t.box('v', 'thumb-vertical'));
                const bar = await t.box('v', 'scrollbar-vertical');
                await t.page.mouse.move(100, 100);
                await t.frames(2);
                expect((await cursor()) === 'crosshair', `away from the bars the cursor is ${await cursor()}`);
                await t.page.mouse.move(bar.left + bar.width / 2, bar.top + 100);
                await t.frames(2);
                expect((await cursor()) === 'default', `over the bar the cursor is ${await cursor()}`);
                await t.page.mouse.move(thumb.x, thumb.y);
                await t.page.mouse.down();
                await t.page.mouse.move(thumb.x - 80, thumb.y + 20, { steps: 4 });
                await t.frames(2);
                expect((await cursor()) === 'grabbing', `while dragging the cursor is ${await cursor()}`);
                await t.page.mouse.up();
                await t.page.mouse.move(100, 100);
                await t.frames(2);
                expect((await cursor()) === 'crosshair', `after the drag, away from the bars the cursor is ${await cursor()}`);
            } finally {
                await t.page.evaluate(() => ((document.getElementById('v') as HTMLElement).style.cursor = ''));
            }
            await t.park();
        },
    },
    {
        name: 'a press on a marker over the thumb drags the thumb; without moving it clicks the marker',
        run: async (t) => {
            await t.reset();
            // At 900 the thumb covers m1000.
            await t.call('setScroll', 'v', 900);
            await t.settle();
            const mb = await t.box('v', 'marker:m1000');
            const c = centre(mb);
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            await t.frames(1);
            const pressed = await t.tokens('v', 'thumb-vertical');
            expect(has(pressed, 'thumb-pressed'), `the thumb is not pressed (tokens "${pressed.join(' ')}")`);
            await t.page.mouse.move(c.x, c.y + 20, { steps: 4 });
            await t.page.mouse.up();
            await t.settle();
            const dragged = await t.call<{ viewport: number }>('scrollOf', 'v');
            expect(dragged.viewport > 900, `the drag did not scroll (scrollTop ${dragged.viewport})`);

            await t.call('setScroll', 'v', 900);
            await t.settle();
            await t.call('watch', 'v', 'markeractivate');
            const mb2 = await t.box('v', 'marker:m1000');
            const c2 = centre(mb2);
            await t.page.mouse.move(c2.x, c2.y);
            await t.page.mouse.down();
            await t.page.mouse.up();
            await t.frames(2);
            const events = await t.call<{ type: string; id?: string }[]>('log', 'v');
            expect(events.some((e) => e.type === 'markeractivate' && e.id === 'm1000'), 'a click without moving did not activate the marker');
        },
    },
    {
        name: 'markers closer than the spacing share one mark, and its card lists all of them',
        run: async (t) => {
            await t.reset();
            // m0 and a marker 5px further down the content land on the same spot of the track.
            await t.page.evaluate(() => {
                const v = document.getElementById('v') as HTMLElement & { markers: unknown[] };
                v.markers = [
                    { id: 'a', label: 'First', position: 0 },
                    { id: 'b', label: 'Second', position: 5 },
                    { id: 'c', label: 'Far', position: 1500 },
                ];
            });
            await t.settle();
            const shown = await t.page.evaluate(() =>
                [...(document.getElementById('v') as HTMLElement).shadowRoot!.querySelectorAll('.bar.v .slot')]
                    .filter((slot) => getComputedStyle(slot).display !== 'none')
                    .map((slot) => (slot.firstElementChild as HTMLElement).dataset.id),
            );
            expect(shown.join(',') === 'a,c', `drawn marks are ${shown.join(',')}, want a,c`);
            const mb = await t.box('v', 'marker:a');
            const c = centre(mb);
            await t.page.mouse.move(c.x - 20, c.y);
            await t.page.mouse.move(c.x, c.y, { steps: 3 });
            await t.frames(4);
            const cards = await t.call<{ text: string; classes: string[] }[]>('cards', 'v');
            const open = cards.find((card) => card.classes.indexOf('card-open') >= 0);
            expect(!!open && open.text.indexOf('First') >= 0 && open.text.indexOf('Second') >= 0, `the card does not list both markers: ${JSON.stringify(cards)}`);
            await t.page.mouse.move(5, 5);
            await t.page.evaluate(() => {
                const v = document.getElementById('v') as HTMLElement & { markers: unknown };
                v.markers = [0, 500, 1000, 1500].map((p) => ({ id: `m${p}`, label: `Section ${p}`, element: document.getElementById(`h${p}`)! }));
            });
            await t.settle();
        },
    },
    {
        name: 'markers from elements: a NodeList and a mixed array, ids kept per element',
        run: async (t) => {
            await t.reset();
            const read = () =>
                t.page.evaluate(() => {
                    const v = document.getElementById('v') as HTMLElement & { markers: { id: string; label: string }[] };
                    return v.markers.map((m) => `${m.id}=${m.label}`);
                });
            await t.page.evaluate(() => {
                const v = document.getElementById('v') as HTMLElement & { markers: unknown };
                v.markers = document.getElementById('v')!.querySelectorAll('h3');
            });
            await t.settle();
            const listed = await read();
            expect(listed.join(',') === 'h0=Section 0,h500=Section 500,h1000=Section 1000,h1500=Section 1500', `markers from a NodeList: ${listed.join(',')}`);
            const area = await t.box('v', 'area-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            const travel = area.height - thumb.height;
            const mb = await t.box('v', 'marker:h1000');
            near(mb.top + mb.height / 2, area.top + (1000 / MAX_V) * travel, 0.5, 'marker h1000 at its element');

            const setMixed = () =>
                t.page.evaluate(() => {
                    const v = document.getElementById('v') as HTMLElement & { markers: unknown };
                    v.markers = [document.getElementById('h500')!, { id: 'plain', label: 'Plain', position: 1500 }, document.querySelector('#v .noid')!];
                });
            await setMixed();
            await t.settle();
            const mixed = await read();
            await setMixed();
            const again = await read();
            expect(mixed.length === 3 && mixed[0] === 'h500=Section 500' && mixed[1] === 'plain=Plain' && /^ax-marker-element-\d+=Labelled$/.test(mixed[2]), `mixed markers: ${mixed.join(',')}`);
            expect(again[2] === mixed[2], `the element without an id got another id: ${mixed[2]}, then ${again[2]}`);
            // The em sits 200px below the heading at 1000 (plus the heading's height).
            const id = mixed[2].split('=')[0];
            const em = await t.box('v', `marker:${id}`);
            expect(em.top > mb.top, 'the element marker is not placed below the 1000 heading');
            await t.page.evaluate(() => {
                const v = document.getElementById('v') as HTMLElement & { markers: unknown };
                v.markers = [0, 500, 1000, 1500].map((p) => ({ id: `m${p}`, label: `Section ${p}`, element: document.getElementById(`h${p}`)! }));
            });
            await t.settle();
        },
    },
    {
        name: 'card: the default render clamps each label, has the font of the default theme and its max width',
        run: async (t) => {
            await t.reset();
            await t.page.mouse.move(...(Object.values(centre(await t.box('v', 'marker:m500'))) as [number, number]));
            await t.frames(2);
            const card = await t.page.evaluate(() => {
                const host = document.getElementById('v') as HTMLElement;
                const el = host.shadowRoot!.querySelector('.card.open') as HTMLElement;
                const line = el.querySelector('[part~="card-content"] > .line') as HTMLElement;
                const ls = getComputedStyle(line);
                return {
                    tag: el.tagName,
                    clamp: ls.getPropertyValue('-webkit-line-clamp'),
                    overflow: ls.overflow,
                    font: getComputedStyle(el).fontFamily,
                    page: getComputedStyle(host).fontFamily,
                    maxWidth: getComputedStyle(el).maxWidth,
                };
            });
            expect(card.tag === 'AX-SCROLLBAR-CARD', `the card is ${card.tag}`);
            expect(card.clamp === '2' && card.overflow === 'hidden', `the label is clamped to ${card.clamp} lines (overflow ${card.overflow}), want 2`);
            expect(card.font.startsWith('"Segoe UI"'), `the card font is ${card.font}, want the default theme's Segoe UI`);
            expect(card.maxWidth === '320px', `the card max width is ${card.maxWidth}`);
            await t.park();
        },
    },
    {
        name: 'kits: a class that does not extend the base of its kind throws',
        run: async (t) => {
            const result = await t.page.evaluate(() => {
                const { defineScrollbarKit, hasScrollbarKit, AxScrollbarTrack } = window.axScrollbar;
                const messages: string[] = [];
                for (const kit of [{ thumb: class extends HTMLElement {} }, { thumb: AxScrollbarTrack }]) {
                    try {
                        defineScrollbarKit('bad', kit as never);
                        messages.push('no error');
                    } catch (e) {
                        messages.push(`${(e as Error).name}: ${(e as Error).message}`);
                    }
                }
                return { messages, defined: hasScrollbarKit('bad') };
            });
            for (const m of result.messages) expect(m === 'TypeError: Scrollbar kit "bad": thumb must extend AxScrollbarThumb', `defineScrollbarKit gave "${m}"`);
            expect(!result.defined, 'the bad kit was defined');
        },
    },
    {
        name: 'kits: kit="name" replaces the thumb with a subclass that gets partState; missing kinds fall back',
        run: async (t) => {
            await t.reset();
            await t.page.evaluate(() => {
                const { defineScrollbarKit, AxScrollbarThumb } = window.axScrollbar;
                class TestThumb extends AxScrollbarThumb {
                    // The kit's look is the class's own shadow style.
                    static styles = ':host { outline-offset: 3px; }';
                    seen: string[] = [];
                    protected stateChanged(_prev: unknown, next: { hover: boolean }): void {
                        this.seen.push(next.hover ? 'hover' : 'rest');
                    }
                }
                defineScrollbarKit('test', { thumb: TestThumb, hide: 'corner' });
                document.getElementById('kit')!.setAttribute('kit', 'test');
            });
            await t.settle();
            expect((await t.call('tagOf', 'kit', 'thumb-vertical')) === 'AX-SCROLLBAR-TEST-THUMB', `the thumb is ${await t.call('tagOf', 'kit', 'thumb-vertical')}`);
            expect((await t.call('tagOf', 'kit', 'track-vertical')) === 'AX-SCROLLBAR-TRACK', 'the track does not fall back to the default class');
            expect((await t.call('display', 'kit', 'button-end-vertical')) !== 'none', 'the kit default hide="corner" does not show the buttons');
            const c = centre(await t.box('kit', 'thumb-vertical'));
            await t.page.mouse.move(c.x, c.y);
            await t.frames(3);
            const info = await t.page.evaluate(() => {
                const root = (document.getElementById('kit') as HTMLElement).shadowRoot!;
                const thumb = root.querySelector('[part~="thumb-vertical"]') as HTMLElement & { seen: string[]; partState: { hover: boolean; axis: string } };
                return {
                    seen: thumb.seen,
                    state: thumb.partState,
                    // The structure style is one sheet that every scrollbar root adopts; no other style
                    // source (not the change detector that typed-om puts in the root to watch the host tokens).
                    styleElements: root.adoptedStyleSheets.length + Array.from(root.querySelectorAll('style')).filter((style) => !(style.textContent || '').includes('ax-typed-om')).length,
                    offset: getComputedStyle(thumb).outlineOffset,
                };
            });
            expect(info.state.hover && info.state.axis === 'vertical', `partState ${JSON.stringify(info.state)}`);
            expect(info.seen[info.seen.length - 1] === 'hover', `stateChanged saw ${info.seen.join(' ')}`);
            expect(info.styleElements === 1, `the scrollbar's shadow root has ${info.styleElements} style sheets, want its structure alone`);
            expect(info.offset === '3px', `the part's own shadow style does not apply (outline-offset ${info.offset})`);
            await t.park();
            // Without the attribute the default parts come back.
            await t.call('setAttr', 'kit', 'kit', null);
            await t.settle();
            expect((await t.call('tagOf', 'kit', 'thumb-vertical')) === 'AX-SCROLLBAR-THUMB', 'the default thumb did not come back');
            expect((await t.call('hostAttr', 'kit', 'kit')) === '', 'precondition: kit removed');
        },
    },
    {
        name: 'B13: the part components carry their look; the scrollbar\'s shadow root has structure only; a kit is classes',
        run: async (t) => {
            await t.reset();
            await t.page.evaluate(() => {
                const { defineScrollbarKit, AxScrollbarThumb, AxScrollbarDefaultThumb } = window.axScrollbar;
                class Bare extends AxScrollbarThumb {}
                class Refined extends AxScrollbarDefaultThumb {
                    static styles = ':host { --ax-scrollbar-part-color: #123456; }';
                }
                defineScrollbarKit('b13-bare', { thumb: Bare });
                defineScrollbarKit('b13-refined', { thumb: Refined });
            });
            const info = async (kit: string | null) => {
                await t.call('setAttr', 'kit', 'kit', kit);
                await t.settle();
                // A hidden bar draws nothing: show it.
                await t.call('wake', 'kit');
                await t.frames(3);
                return t.page.evaluate(() => {
                    const root = (document.getElementById('kit') as HTMLElement).shadowRoot!;
                    const thumb = root.querySelector('[part~="thumb-vertical"]') as HTMLElement;
                    const sheets = (el: HTMLElement) => (el.shadowRoot!.adoptedStyleSheets || []).map((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n')).join('\n');
                    return {
                        structure: sheets(root.host as HTMLElement) + Array.from(root.querySelectorAll('style')).map((style) => style.textContent).join('\n'),
                        thumbSheets: sheets(thumb),
                        svgs: thumb.shadowRoot!.querySelectorAll('svg').length,
                        color: getComputedStyle(thumb).getPropertyValue('--ax-scrollbar-part-color'),
                        opacity: getComputedStyle(thumb).opacity,
                    };
                });
            };
            try {
                const base = await info(null);
                expect(base.structure.includes('.viewport') && base.structure.includes('.bar'), 'the structure sheet of the scrollbar root was not found');
                expect(!/part-color|shown-color|--ax-fill-color/.test(base.structure), 'the scrollbar shadow root sets a look input');
                expect(base.thumbSheets.includes('--ax-scrollbar-part-color: #cdcdcd'), 'the default thumb does not carry its look in its own shadow root');
                expect(base.svgs === 1, `the default thumb draws ${base.svgs} fill layers, want 1`);
                const bare = await info('b13-bare');
                expect(bare.svgs === 0, `a thumb that extends the contract class draws ${bare.svgs} layers, want none`);
                expect(!bare.thumbSheets.includes('part-color'), 'a thumb that extends the contract class has the default look');
                expect(bare.opacity === '1', `a contract thumb is shown at once (opacity ${bare.opacity})`);
                const refined = await info('b13-refined');
                expect(refined.svgs === 1 && refined.color.replace(/\s/g, '') === 'rgb(18,52,86)', `a thumb that extends the default one refines it: ${refined.svgs} layers, colour ${refined.color}`);
            } finally {
                await t.call('setAttr', 'kit', 'kit', null);
                await t.settle();
            }
        },
    },
    {
        name: 'kits: a kit defined after the host connects is picked up, and its card renders the content',
        run: async (t) => {
            await t.reset();
            await t.call('setAttr', 'kit', 'kit', 'late');
            await t.settle();
            expect((await t.call('tagOf', 'kit', 'thumb-vertical')) === 'AX-SCROLLBAR-THUMB', 'before the kit exists the default thumb stands in');
            await t.page.evaluate(() => {
                const { defineScrollbarKit, AxScrollbarCard, AxScrollbarThumb } = window.axScrollbar;
                class LateThumb extends AxScrollbarThumb {}
                class LateCard extends AxScrollbarCard {
                    protected render(markers: { label: string }[], content: HTMLElement): void {
                        const b = document.createElement('b');
                        b.textContent = `${markers.length}: ${markers.map((m) => m.label).join(', ')}`;
                        content.appendChild(b);
                    }
                }
                (document.getElementById('kit') as HTMLElement & { markers: unknown }).markers = [{ id: 'k', label: 'Kit 600', element: document.getElementById('k600') }];
                defineScrollbarKit('late', { thumb: LateThumb, card: LateCard });
            });
            await t.settle();
            expect((await t.call('tagOf', 'kit', 'thumb-vertical')) === 'AX-SCROLLBAR-LATE-THUMB', `after the kit is defined the thumb is ${await t.call('tagOf', 'kit', 'thumb-vertical')}`);
            expect((await t.call('display', 'kit', 'button-end-vertical')) !== 'none', 'a kit without a hide default hides the buttons');
            await t.page.mouse.move(...(Object.values(centre(await t.box('kit', 'marker:k'))) as [number, number]));
            await t.frames(2);
            const open = (await t.call<{ text: string; classes: string[] }[]>('cards', 'kit')).find((c) => c.classes.includes('open'));
            expect(!!open && open.text === '1: Kit 600', `the kit card shows ${JSON.stringify(open)}`);
            await t.park();
            await t.call('setAttr', 'kit', 'kit', null);
            await t.settle();
        },
    },
    // ---- Audit gaps (B3): hot zone, drags, suspended, page scrollbar, markers, cards ----------
    {
        name: 'hot zone: beside the bar the pointer hovers the thumb and the markers; marker-reach is 12',
        run: async (t) => {
            await t.reset();
            const bar = await t.box('v', 'scrollbar-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            // 5px inside the bar's inner edge: in the 200% (20px) zone, not on the bar.
            const x = bar.left - 5;
            await t.page.mouse.move(x, thumb.top + thumb.height / 2);
            await t.frames(2);
            const tt = await t.tokens('v', 'thumb-vertical');
            const vs = (await t.call<string>('hostAttr', 'v', 'vertical-state')).split(' ');
            expect(has(tt, 'thumb-hover'), `beside the thumb: thumb tokens "${tt.join(' ')}", want thumb-hover`);
            expect(has(vs, 'near') && !has(vs, 'hover'), `beside the bar: vertical-state "${vs.join(' ')}", want near without hover`);
            const m500 = centre(await t.box('v', 'marker:m500'));
            await t.page.mouse.move(x, m500.y);
            await t.frames(2);
            expect((await t.call('openCard', 'v')) === 'Section 500', `beside a marker: open card "${await t.call('openCard', 'v')}"`);
            // Out of the zone: nothing hovered, the card goes.
            await t.page.mouse.move(bar.left - 25, m500.y);
            await t.frames(2);
            expect((await t.call('openCard', 'v')) === '', 'out of the zone the card stays open');
            expect(!has(await t.tokens('v', 'thumb-vertical'), 'thumb-hover'), 'out of the zone the thumb stays hovered');
            // 10px from a marker along the bar is within the default reach of 12.
            await t.page.mouse.move(bar.left + bar.width / 2, m500.y + 10);
            await t.frames(2);
            expect((await t.call('openCard', 'v')) === 'Section 500', `10px from a marker: open card "${await t.call('openCard', 'v')}", want Section 500 (reach 12)`);
            await t.park();
        },
    },
    {
        name: 'hot zone: a press beside the bar drags, its click does not reach the content; out of the zone the content has it',
        run: async (t) => {
            await t.reset();
            await t.call('watch', 'v', 'click');
            const bar = await t.box('v', 'scrollbar-vertical');
            const area = await t.box('v', 'area-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            const m = await t.call('metrics', 'v');
            const ratio = (m.scrollHeight - m.clientHeight) / (area.height - thumb.height);
            const c = centre(thumb);
            await t.page.mouse.move(bar.left - 6, c.y);
            await t.page.mouse.down();
            await t.page.mouse.move(bar.left - 6, c.y + 30, { steps: 6 });
            await t.page.mouse.up();
            await t.frames(2);
            near((await t.call('scrollOf', 'v')).host, 30 * ratio, 1, 'scrollTop after dragging 30px beside the bar');
            const log = await t.call<{ type: string }[]>('log', 'v');
            expect(!log.some((e) => e.type === 'click'), 'the click of a press in the zone reached the content');
            await t.reset();
            await t.call('watch', 'v', 'click');
            await t.page.mouse.move(bar.left - 25, c.y);
            await t.page.mouse.down();
            await t.page.mouse.move(bar.left - 25, c.y + 30, { steps: 3 });
            await t.page.mouse.up();
            await t.frames(2);
            expect((await t.call('scrollOf', 'v')).host === 0, 'a press out of the zone scrolled');
        },
    },
    {
        name: 'cards while dragging: a thumb drag scrubs through the markers',
        run: async (t) => {
            await t.reset();
            const c = centre(await t.box('v', 'thumb-vertical'));
            const m500 = centre(await t.box('v', 'marker:m500'));
            const m1000 = centre(await t.box('v', 'marker:m1000'));
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            await t.page.mouse.move(c.x, m500.y, { steps: 4 });
            await t.frames(2);
            const first = await t.call<string>('openCard', 'v');
            expect(has(await t.tokens('v', 'thumb-vertical'), 'thumb-pressed'), 'the thumb is not dragged');
            await t.page.mouse.move(c.x, m1000.y, { steps: 4 });
            await t.frames(2);
            const second = await t.call<string>('openCard', 'v');
            await t.page.mouse.up();
            expect(first === 'Section 500', `dragging over m500: open card "${first}"`);
            expect(second === 'Section 1000', `dragging on to m1000: open card "${second}"`);
            await t.park();
        },
    },
    {
        name: 'drag resync: a scroll by script during a drag moves the drag along instead of snapping back',
        run: async (t) => {
            await t.reset();
            const area = await t.box('v', 'area-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            const m = await t.call('metrics', 'v');
            const ratio = (m.scrollHeight - m.clientHeight) / (area.height - thumb.height);
            const c = centre(thumb);
            await t.page.mouse.move(c.x, c.y);
            await t.page.mouse.down();
            await t.page.mouse.move(c.x, c.y + 5);
            await t.frames(1);
            const before = (await t.call('scrollOf', 'v')).host;
            near(before, 5 * ratio, 1, 'precondition: scrollTop after 5px of drag');
            await t.call('setScroll', 'v', before + 300);
            await t.frames(2);
            await t.page.mouse.move(c.x, c.y + 6);
            await t.frames(1);
            const after = (await t.call('scrollOf', 'v')).host;
            await t.page.mouse.up();
            near(after, before + 300 + ratio, 1, 'scrollTop after one more px of drag');
        },
    },
    {
        name: 'marker-on-thumb follows the drawn thumb, not the real one',
        run: async (t) => {
            await t.call('setStyle', 'v', '--ax-scrollbar-thumb-smoothing', '400ms');
            try {
                await t.reset();
                await t.call('setScroll', 'v', 900);
                await t.frames(1);
                const early = await t.tokens('v', 'marker:m1000');
                expect(!has(early, 'marker-on-thumb'), 'one frame after scrollTop = 900 m1000 is on the thumb that has not arrived yet');
                await t.settle();
                expect(has(await t.tokens('v', 'marker:m1000'), 'marker-on-thumb'), 'once the thumb arrived m1000 is not on it');
            } finally {
                await t.call('setStyle', 'v', '--ax-scrollbar-thumb-smoothing', '');
            }
        },
    },
    {
        name: 'suspended: the bars fade out, take no input, and show again',
        run: async (t) => {
            await t.reset();
            // Over the bar, where the indicator stays.
            const barBox = await t.box('v', 'scrollbar-vertical');
            await t.page.mouse.move(barBox.left + barBox.width / 2, barBox.bottom - 30);
            await t.sleep(700);
            const opacity = async () => parseFloat(await t.call<string>('look', 'v', 'thumb-vertical', '--ax-scrollbar-shown-opacity'));
            near(await opacity(), 1, 0.001, 'precondition: thumb opacity while shown');
            await t.call('setAttr', 'v', 'suspended', '');
            try {
                await t.frames(2);
                expect((await t.call('hostAttr', 'v', 'indicator-state')) === 'none', 'suspended: the indicator is not none');
                const fading = await opacity();
                expect(fading > 0 && fading < 1, `two frames after suspending the thumb opacity is ${fading}, want a fade`);
                await t.sleep(400);
                near(await opacity(), 0, 0.001, 'thumb opacity once faded');
                const c = centre(await t.box('v', 'thumb-vertical'));
                await t.page.mouse.move(c.x, c.y);
                await t.page.mouse.down();
                await t.page.mouse.move(c.x, c.y + 30, { steps: 3 });
                await t.page.mouse.up();
                await t.frames(2);
                expect((await t.call('scrollOf', 'v')).host === 0, 'suspended: a drag on the bar scrolled');
                expect((await t.call('hostAttr', 'v', 'indicator-state')) === 'none', 'suspended: a move showed the indicator');
            } finally {
                await t.call('setAttr', 'v', 'suspended', null);
            }
            await t.frames(2);
            expect((await t.call('hostAttr', 'v', 'indicator-state')) === 'mouse', 'after suspended the bars do not show again');
            await t.park();
        },
    },
    {
        name: 'page scrollbar: --ax-scrollbar-z-index, and the indicator only near the bar',
        run: async (t) => {
            await t.reset();
            const z = () => t.page.evaluate(() => getComputedStyle(document.getElementById('page')!).zIndex);
            expect((await z()) === '2147483000', `default z-index ${await z()}`);
            await t.call('setStyle', 'page', '--ax-scrollbar-z-index', '5');
            expect((await z()) === '5', `z-index with the token 5 is ${await z()}`);
            await t.call('setStyle', 'page', '--ax-scrollbar-z-index', '');
            await t.sleep(450);
            expect((await t.call('hostAttr', 'page', 'indicator-state')) === 'none', 'precondition: page indicator none');
            await t.page.mouse.move(400, 300, { steps: 3 });
            await t.frames(2);
            expect((await t.call('hostAttr', 'page', 'indicator-state')) === 'none', 'a move over the page far from the bar shows the page scrollbar');
            // 784: in the 20px zone of the 10px page bar (790 to 800), not on it.
            await t.page.mouse.move(784, 300);
            await t.frames(2);
            const vs = (await t.call<string>('hostAttr', 'page', 'vertical-state')).split(' ');
            expect((await t.call('hostAttr', 'page', 'indicator-state')) === 'mouse', 'a move in the zone of the page bar does not show it');
            expect(has(vs, 'near'), `page vertical-state "${vs.join(' ')}", want near`);
            await t.park();
            await t.sleep(450);
            await t.call('scrollPage', 200);
            await t.frames(2);
            expect((await t.call('hostAttr', 'page', 'indicator-state')) === 'mouse', 'a page scroll does not show the page scrollbar');
            await t.call('scrollPage', 0);
            await t.frames(2);
        },
    },
    {
        name: 'markers are measured again after a transition in the content, and by refreshMarkers()',
        run: async (t) => {
            await t.reset();
            await t.page.evaluate(() => {
                const box = document.getElementById('tr-box')!;
                box.style.transition = 'none';
                box.style.transform = 'translateY(56px)';
                void box.offsetHeight;
                (document.getElementById('tr') as HTMLElement & { markers: unknown }).markers = [document.getElementById('tr600')!];
            });
            await t.frames(3);
            const at = async () => centre(await t.box('tr', 'marker:tr600')).y;
            const during = await at();
            await t.page.evaluate(() => {
                const box = document.getElementById('tr-box')!;
                box.style.transition = 'transform 200ms linear';
                box.style.transform = 'none';
            });
            await t.sleep(350);
            await t.settle();
            const after = await at();
            await t.page.evaluate(() => (document.getElementById('tr') as HTMLElement & { refreshMarkers(): void }).refreshMarkers());
            await t.settle();
            const fresh = await at();
            expect(Math.abs(during - fresh) > 2, `precondition: the transform moved the marker by ${round(during - fresh)}px only`);
            near(after, fresh, 0.1, 'marker after the transition ended (refreshMarkers gives the truth)');
        },
    },
    {
        name: 'appearance slide: hidden parts sit --ax-scrollbar-slide-distance toward the edge',
        run: async (t) => {
            await t.call('setStyle', 'surf', '--ax-scrollbar-idle-delay', '200ms');
            await t.call('setStyle', 'surf', '--ax-scrollbar-slide-distance', '3px');
            try {
                await t.reset();
                // Over the bar the indicator stays; the slide settles at 0.
                const c = centre(await t.box('surf', 'thumb-vertical'));
                await t.page.mouse.move(c.x, c.y);
                await t.sleep(1500);
                expect((await t.call('look', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-slide')) === '0px', `shown: slide ${await t.call('look', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-slide')}`);
                await t.park();
                await t.sleep(1800);
                expect((await t.call('look', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-slide')) === '3px', `hidden: slide ${await t.call('look', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-slide')}`);
            } finally {
                await t.call('setStyle', 'surf', '--ax-scrollbar-idle-delay', '');
                await t.call('setStyle', 'surf', '--ax-scrollbar-slide-distance', '');
            }
        },
    },
    {
        name: 'invisible bars take no input in the default look',
        run: async (t) => {
            await t.reset();
            await t.sleep(3200);
            expect((await t.call('hostAttr', 'surf', 'indicator-state')) === 'none', 'precondition: #surf hidden');
            const bar = await t.box('surf', 'scrollbar-vertical');
            const cx = bar.left + bar.width / 2;
            const cy = bar.top + bar.height / 2;
            const hidden = await t.call<string>('hitAt', 'surf', cx, cy);
            expect(!hidden.includes('scrollbar') && !hidden.includes('thumb') && !hidden.includes('track'), `hidden bar is hit: ${hidden}`);
        },
    },
    {
        name: 'marker-align is center by default',
        run: async (t) => {
            await t.reset();
            const area = await t.box('sel', 'area-vertical');
            const thumb = await t.box('sel', 'thumb-vertical');
            const m = await t.call('metrics', 'sel');
            const max = m.scrollHeight - m.clientHeight;
            const anchor = 300 - m.clientHeight / 2;
            const want = area.top + (anchor / max) * (area.height - thumb.height) + thumb.height / 2;
            near(centre(await t.box('sel', 'marker:s300')).y, want, 0.5, 'centre of the s300 marker');
        },
    },
    {
        name: 'marker observer: any change queries the selector once per frame, the markers are rebuilt only when the matches differ',
        run: async (t) => {
            await t.reset();
            await t.page.evaluate(() => {
                const host = document.getElementById('sel') as HTMLElement & { __count: number };
                host.__count = 0;
                host.querySelectorAll = function (this: Element, selector: string) {
                    // Only the queries of marker-selector: the focus check of the viewport queries too.
                    if (selector === this.getAttribute('marker-selector')) (this as unknown as { __count: number }).__count++;
                    return Element.prototype.querySelectorAll.call(this, selector);
                } as typeof host.querySelectorAll;
            });
            const count = () => t.page.evaluate(() => (document.getElementById('sel') as HTMLElement & { __count: number }).__count);
            try {
                // The markers are measured when they are collected: a spy on the heading sees a rebuild.
                await t.page.evaluate(() => {
                    const h = document.getElementById('s300') as HTMLElement & { __rects: number };
                    h.__rects = 0;
                    h.getBoundingClientRect = function (this: Element) {
                        (this as unknown as { __rects: number }).__rects++;
                        return Element.prototype.getBoundingClientRect.call(this);
                    };
                });
                const rects = () => t.page.evaluate(() => (document.getElementById('s300') as HTMLElement & { __rects: number }).__rects);
                for (let i = 1; i <= 5; i++) {
                    await t.page.evaluate((n) => {
                        const tick = document.getElementById('tick')!;
                        if (n % 2) tick.textContent = String(n);
                        else (tick.firstChild as Text).data = String(n);
                    }, i);
                    await t.frames(1);
                }
                await t.frames(2);
                expect((await count()) >= 1 && (await count()) <= 5, `a ticking counter queried the selector ${await count()} times, want one per frame at most`);
                expect((await rects()) === 0, `a ticking counter rebuilt the markers (${await rects()} measures)`);
                // Many changes in one task: one query on the next frame.
                const before = await count();
                await t.page.evaluate(() => {
                    const tick = document.getElementById('tick')!;
                    for (let i = 0; i < 50; i++) tick.setAttribute('data-n', String(i));
                });
                await t.frames(3);
                expect((await count()) - before === 1, `50 changes in one task queried the selector ${(await count()) - before} times, want 1`);
                await t.page.evaluate(() => {
                    ((document.getElementById('s300')!.firstChild) as Text).data = 'Beta';
                });
                await t.frames(3);
                expect((await rects()) >= 1, 'the text of a heading changed and the markers were not collected');
                await t.page.mouse.move(...(Object.values(centre(await t.box('sel', 'marker:s300'))) as [number, number]));
                await t.frames(2);
                expect((await t.call('openCard', 'sel')) === 'Beta', `card after the label changed: "${await t.call('openCard', 'sel')}"`);
                await t.park();
                await t.page.evaluate(() => {
                    const h = document.createElement('h4');
                    h.id = 's-new';
                    h.textContent = 'New';
                    // Far enough from s300 not to share its mark.
                    h.style.margin = '500px 0 0';
                    document.getElementById('sel-more')!.appendChild(h);
                });
                await t.frames(3);
                expect((await t.call<string[]>('marks', 'sel')).join(',') === 's300,s-new', `marks after adding a heading: ${(await t.call<string[]>('marks', 'sel')).join(',')}`);
            } finally {
                await t.page.evaluate(() => {
                    const host = document.getElementById('sel') as HTMLElement & { querySelectorAll?: unknown };
                    delete host.querySelectorAll;
                    delete (document.getElementById('s300') as HTMLElement & { getBoundingClientRect?: unknown }).getBoundingClientRect;
                    document.getElementById('sel-more')!.textContent = '';
                    document.getElementById('s300')!.textContent = 'Alpha';
                });
                await t.frames(3);
            }
        },
    },
    {
        name: 'marker-selector: a class change that makes an element match adds a marker, and taking it away removes it',
        run: async (t) => {
            await t.reset();
            const marks = () => t.call<string[]>('marks', 'sel');
            await t.call('setAttr', 'sel', 'marker-selector', 'h4, .pick');
            try {
                await t.page.evaluate(() => {
                    const p = document.createElement('p');
                    p.id = 'later';
                    p.textContent = 'Later';
                    p.style.margin = '500px 0 0';
                    document.getElementById('sel-more')!.appendChild(p);
                });
                await t.frames(3);
                expect((await marks()).join(',') === 's300', `before the class: marks ${(await marks()).join(',')}`);
                await t.page.evaluate(() => document.getElementById('later')!.classList.add('pick'));
                await t.frames(3);
                expect((await marks()).join(',') === 's300,later', `after adding the class: marks ${(await marks()).join(',')}`);
                await t.page.evaluate(() => document.getElementById('later')!.removeAttribute('class'));
                await t.frames(3);
                expect((await marks()).join(',') === 's300', `after removing the class: marks ${(await marks()).join(',')}`);
                // An id change is an attribute change too: the marker keeps up with its element.
                await t.page.evaluate(() => {
                    const p = document.getElementById('later')!;
                    p.className = 'pick';
                    p.id = 'renamed';
                });
                await t.frames(3);
                expect((await marks()).join(',') === 's300,renamed', `after an id change: marks ${(await marks()).join(',')}`);
            } finally {
                await t.call('setAttr', 'sel', 'marker-selector', 'h4');
                await t.page.evaluate(() => (document.getElementById('sel-more')!.textContent = ''));
                await t.frames(3);
            }
        },
    },
    {
        name: 'marker-selector: removing a match whose selector depends on an ancestor removes its marker',
        run: async (t) => {
            await t.reset();
            const marks = () => t.call<string[]>('marks', 'sel');
            await t.call('setAttr', 'sel', 'marker-selector', 'h4, .article h2');
            try {
                await t.page.evaluate(() => {
                    const box = document.createElement('div');
                    box.className = 'article';
                    box.style.marginTop = '500px';
                    box.innerHTML = '<h2 id="deep">Deep</h2>';
                    document.getElementById('sel-more')!.appendChild(box);
                });
                await t.frames(3);
                expect((await marks()).join(',') === 's300,deep', `with the article: marks ${(await marks()).join(',')}`);
                // The heading alone goes: a detached node no longer matches `.article h2`.
                await t.page.evaluate(() => document.getElementById('deep')!.remove());
                await t.frames(3);
                expect((await marks()).join(',') === 's300', `after removing the heading: marks ${(await marks()).join(',')}`);
            } finally {
                await t.call('setAttr', 'sel', 'marker-selector', 'h4');
                await t.page.evaluate(() => (document.getElementById('sel-more')!.textContent = ''));
                await t.frames(3);
            }
        },
    },
    {
        name: 'markers: marker-selector alone; a markers list replaces it; null gives it back',
        run: async (t) => {
            await t.reset();
            const marks = () => t.call<string[]>('marks', 'sel');
            const getter = () => t.page.evaluate(() => (document.getElementById('sel') as HTMLElement & { markers: unknown }).markers);
            expect((await marks()).join(',') === 's300', `selector alone: marks ${(await marks()).join(',')}`);
            expect((await getter()) === null, `selector alone: markers is ${JSON.stringify(await getter())}, want null`);
            await t.page.evaluate(() => {
                (document.getElementById('sel') as HTMLElement & { markers: unknown }).markers = [{ id: 'x', label: 'X', position: 600 }];
            });
            await t.frames(3);
            expect((await marks()).join(',') === 'x', `with a list: marks ${(await marks()).join(',')}, want x only`);
            // The selector is not watched while a list is set.
            await t.page.evaluate(() => {
                const h = document.createElement('h4');
                h.textContent = 'Ignored';
                document.getElementById('sel-more')!.appendChild(h);
            });
            await t.frames(3);
            expect((await marks()).join(',') === 'x', `with a list, a new heading added a mark: ${(await marks()).join(',')}`);
            await t.page.evaluate(() => {
                (document.getElementById('sel') as HTMLElement & { markers: unknown }).markers = [];
            });
            await t.frames(3);
            expect((await marks()).length === 0, `with an empty list: marks ${(await marks()).join(',')}`);
            await t.page.evaluate(() => {
                document.getElementById('sel-more')!.textContent = '';
                (document.getElementById('sel') as HTMLElement & { markers: unknown }).markers = null;
            });
            await t.frames(3);
            expect((await marks()).join(',') === 's300', `after null: marks ${(await marks()).join(',')}, want the selector's`);
            expect((await getter()) === null, 'after null: markers is not null');
        },
    },
    {
        name: 'drag: scroll-behavior smooth !important does not smooth it, the host shows grabbing',
        run: async (t) => {
            await t.reset();
            await t.page.evaluate(() => {
                const style = document.createElement('style');
                style.id = 'smooth';
                style.textContent = 'ax-scroll-view::part(viewport) { scroll-behavior: smooth !important; }';
                document.head.appendChild(style);
            });
            const inline = () =>
                t.page.evaluate(() => {
                    const vp = (document.getElementById('v') as HTMLElement).shadowRoot!.querySelector('.viewport') as HTMLElement;
                    return `${vp.style.getPropertyValue('scroll-behavior')}/${vp.style.getPropertyPriority('scroll-behavior')}`;
                });
            try {
                const area = await t.box('v', 'area-vertical');
                const thumb = await t.box('v', 'thumb-vertical');
                const m = await t.call('metrics', 'v');
                const ratio = (m.scrollHeight - m.clientHeight) / (area.height - thumb.height);
                const c = centre(thumb);
                await t.page.mouse.move(c.x, c.y);
                await t.page.mouse.down();
                await t.page.mouse.move(c.x, c.y + 30, { steps: 3 });
                const now = (await t.call('scrollOf', 'v')).host;
                const during = await inline();
                const cursor = await t.call<string>('computed', 'v', 'host', 'cursor');
                await t.page.mouse.up();
                near(now, 30 * ratio, 1, 'scrollTop right after the drag moves (no frame in between)');
                expect(during === 'auto/important', `scroll-behavior on the viewport during the drag: ${during}`);
                expect(cursor === 'grabbing', `cursor of the host during the drag: ${cursor}`);
                expect((await inline()) === '/', `scroll-behavior left on the viewport after the drag: ${await inline()}`);
                expect((await t.call<string>('computed', 'v', 'host', 'cursor')) !== 'grabbing', 'grabbing after the drag');
            } finally {
                await t.page.evaluate(() => document.getElementById('smooth')!.remove());
            }
        },
    },
    {
        name: 'reduced motion: the card goes after --ax-scrollbar-touch-idle-delay',
        run: async (t) => {
            await t.page.emulateMedia({ reducedMotion: 'reduce' });
            await t.call('setStyle', 'v', '--ax-scrollbar-touch-idle-delay', '300ms');
            try {
                await t.reset();
                await t.page.mouse.move(...(Object.values(centre(await t.box('v', 'marker:m500'))) as [number, number]));
                await t.frames(2);
                expect((await t.call('openCard', 'v')) === 'Section 500', 'reduced motion: the card did not open');
                await t.sleep(500);
                expect((await t.call('openCard', 'v')) === '', 'reduced motion: the card is still open after the touch idle delay');
            } finally {
                await t.page.emulateMedia({ reducedMotion: 'no-preference' });
                await t.call('setStyle', 'v', '--ax-scrollbar-touch-idle-delay', '');
            }
        },
    },
    // ---- Touch (a context with hasTouch, CDP touch events) -------------------------------------
    {
        name: 'touch: a swipe along the bar in the hot zone drags from where it starts; the page does not scroll',
        run: async (t) => {
            const u = await t.touch();
            await u.call('setAttr', 'v', 'touch', 'bar');
            try {
                await u.reset();
                await u.call('setScroll', 'v', 900);
                await u.settle();
                const bar = await u.box('v', 'scrollbar-vertical');
                const area = await u.box('v', 'area-vertical');
                const thumb = await u.box('v', 'thumb-vertical');
                const m = await u.call('metrics', 'v');
                const ratio = (m.scrollHeight - m.clientHeight) / (area.height - thumb.height);
                // Below the thumb and beside the bar: no thumb under the finger, the drag is relative.
                const x = bar.left - 5;
                const y = thumb.bottom + 40;
                await u.start(x, y);
                await u.move(x, y - 6);
                await u.move(x, y - 26);
                await u.move(x, y - 46);
                const active = await u.tokens('v', 'thumb-vertical');
                await u.end();
                await u.frames(2);
                expect(has(active, 'thumb-pressed'), `during the swipe the thumb tokens are "${active.join(' ')}", want thumb-pressed`);
                near((await u.call('scrollOf', 'v')).host, 900 - 40 * ratio, 1.5, 'scrollTop after a 40px swipe up (after the 6px that decided it)');
            } finally {
                await u.call('setAttr', 'v', 'touch', null);
            }
        },
    },
    {
        name: 'touch: within the deadzone and across the bar nothing drags; out of the zone the content scrolls natively',
        run: async (t) => {
            const u = await t.touch();
            await u.call('setAttr', 'v', 'touch', 'bar');
            try {
                await u.reset();
                await u.call('setScroll', 'v', 900);
                await u.settle();
                const bar = await u.box('v', 'scrollbar-vertical');
                const x = bar.left - 5;
                const y = bar.top + 100;
                await u.start(x, y);
                await u.move(x + 3, y + 4);
                await u.frames(2);
                near((await u.call('scrollOf', 'v')).host, 900, 0.5, 'scrollTop within the 5px deadzone');
                // 20 across, 5 along: a gesture of the page; later moves along the bar do not drag.
                await u.move(x - 20, y + 5);
                await u.move(x - 20, y + 45);
                await u.end();
                await u.frames(3);
                near((await u.call('scrollOf', 'v')).host, 900, 0.5, 'scrollTop after a swipe across the bar');
                // On the content the browser scrolls: a finger moving up scrolls toward the end.
                await u.start(100, 170);
                for (let k = 1; k <= 6; k++) await u.move(100, 170 - 20 * k);
                await u.end();
                await u.sleep(300);
                const native = (await u.call('scrollOf', 'v')).host;
                expect(native > 950, `a swipe on the content did not scroll natively (scrollTop ${native})`);
            } finally {
                await u.call('setAttr', 'v', 'touch', null);
            }
        },
    },
    {
        name: 'touch: a quick tap in the zone glides to it',
        run: async (t) => {
            const u = await t.touch();
            await u.call('setAttr', 'v', 'touch', 'bar');
            try {
                await u.reset();
                const bar = await u.box('v', 'scrollbar-vertical');
                const area = await u.box('v', 'area-vertical');
                const thumb = await u.box('v', 'thumb-vertical');
                const m = await u.call('metrics', 'v');
                const ratio = (m.scrollHeight - m.clientHeight) / (area.height - thumb.height);
                const y = area.top + 120;
                const want = (120 - thumb.height / 2) * ratio;
                await u.start(bar.left - 5, y);
                await u.end();
                await u.frames(1);
                const first = (await u.call('scrollOf', 'v')).host;
                expect(first > 0 && first < want, `one frame after a tap scrollTop is ${first}, want on its way to ${round(want)}`);
                await u.settle();
                near((await u.call('scrollOf', 'v')).host, want, 1, 'scrollTop after a tap');
            } finally {
                await u.call('setAttr', 'v', 'touch', null);
            }
        },
    },
    {
        name: 'touch: the finger hovers markers and opens their cards; they linger --ax-scrollbar-touch-idle-delay after release',
        run: async (t) => {
            const u = await t.touch();
            await u.call('setStyle', 'v', '--ax-scrollbar-touch-idle-delay', '1s');
            await u.call('setAttr', 'v', 'touch', 'bar');
            try {
                await u.reset();
                const bar = await u.box('v', 'scrollbar-vertical');
                const m500 = centre(await u.box('v', 'marker:m500'));
                const m1000 = centre(await u.box('v', 'marker:m1000'));
                const x = bar.left - 5;
                await u.start(x, m500.y);
                await u.frames(2);
                const first = await u.call<string>('openCard', 'v');
                for (let k = 1; k <= 4; k++) await u.move(x, m500.y + ((m1000.y - m500.y) * k) / 4);
                await u.frames(2);
                const second = await u.call<string>('openCard', 'v');
                await u.end();
                await u.sleep(300);
                const lingering = await u.call<string>('openCard', 'v');
                const vs = (await u.call<string>('hostAttr', 'v', 'vertical-state')).split(' ');
                expect(first === 'Section 500', `finger on m500: open card "${first}"`);
                expect(second === 'Section 1000', `finger moved to m1000: open card "${second}"`);
                expect(lingering === 'Section 1000', `300ms after release: open card "${lingering}", want it to linger`);
                expect(has(vs, 'near'), `300ms after release vertical-state "${vs.join(' ')}", want near`);
                await u.sleep(1000);
                expect((await u.call('openCard', 'v')) === '', 'the card is still open after the idle delay');
                expect(!(await u.call<string>('hostAttr', 'v', 'vertical-state')).split(' ').includes('near'), 'near stays after the idle delay');
            } finally {
                await u.call('setStyle', 'v', '--ax-scrollbar-touch-idle-delay', '');
                await u.call('setAttr', 'v', 'touch', null);
            }
        },
    },
    // ---- B4: shape everywhere, hide, the default look's tokens ----------------------------------
    {
        name: 'track pieces are surfaces: the whole track clipped to their side of the thumb, drawn with their colour',
        run: async (t) => {
            await t.reset();
            const tag = await t.call('tagOf', 'v', 'track-piece-start-vertical');
            expect(tag === 'AX-SCROLLBAR-TRACK-PIECE', `the start piece is ${tag}`);
            await t.call('setScroll', 'v', 900);
            await t.settle();
            const area = await t.box('v', 'area-vertical');
            const piece = await t.box('v', 'track-piece-start-vertical');
            const thumb = await t.box('v', 'thumb-vertical');
            near(piece.top, area.top, 0.5, 'the piece box starts with the track');
            near(piece.height, area.height, 0.5, 'the piece box is as long as the track');
            const d = await t.call('drawn', 'v');
            near(d.pieceStart, thumb.top - area.top, 0.5, 'the start piece shows the track up to the thumb');
            near(d.pieceEndTop, thumb.bottom - area.top, 0.5, 'the end piece shows the track from the thumb on');
            const clip = await t.call<string>('parentStyle', 'v', 'track-piece-end-vertical', 'clip-path');
            expect(clip.startsWith('inset('), `the wrapper of the end piece clips with "${clip}"`);
            // Shown, the bar is still not hit (the geometry finds the track): the pieces take no pointer events.
            await t.page.mouse.move(area.left - 120, area.top + 20);
            await t.frames(2);
            const x = area.left + area.width / 2;
            const above = await t.call<string>('hitAt', 'v', x, thumb.top - 3);
            const below = await t.call<string>('hitAt', 'v', x, thumb.bottom + 3);
            expect(!above.includes('track-piece') && !below.includes('track-piece'), `hit above the thumb "${above}", below "${below}"`);
            const path = () => t.call<string>('inner', 'v', 'track-piece-end-vertical', '.layer-scrollbar-fill svg > path', 'd');
            expect((await path()) === '', 'a transparent piece draws a path');
            await t.call('addStyle', 'piece', 'ax-scroll-view::part(track-piece) { --ax-scrollbar-part-color: rgb(255, 0, 0); }');
            try {
                await t.sleep(700);
                const fill = await t.call<string>('inner', 'v', 'track-piece-end-vertical', '.layer-scrollbar-fill svg > path', 'fill');
                expect((await path()).length > 0 && fill === 'rgba(255, 0, 0, 1)', `with --ax-scrollbar-part-color on the piece it draws "${fill}"`);
            } finally {
                await t.call('addStyle', 'piece', '');
                await t.park();
            }
        },
    },
    {
        name: 'hide: each part goes and takes no input; hidden markers are not measured, hidden cards do not open',
        run: async (t) => {
            await t.reset();
            await t.call('watch', 'v', 'markerenter');
            const area = await t.box('v', 'area-vertical');
            const m500 = centre(await t.box('v', 'marker:m500'));
            const hide = async (value: string) => {
                await t.call('setAttr', 'v', 'hide', value);
                await t.frames(3);
            };
            const markersDisplay = () => t.page.evaluate(() => getComputedStyle((document.getElementById('v') as HTMLElement).shadowRoot!.querySelector('.bar.v .markers')!).display);
            try {
                // The thumb: not displayed, and a press where it is does not drag.
                await hide('thumb');
                expect((await t.call('display', 'v', 'thumb-vertical')) === 'none', 'hide="thumb": the thumb is displayed');
                await t.page.mouse.move(area.left + area.width / 2, area.top + 5);
                await t.page.mouse.down();
                await t.page.mouse.move(area.left + area.width / 2, area.top + 35, { steps: 4 });
                await t.page.mouse.up();
                await t.frames(3);
                expect((await t.call('scrollOf', 'v')).host === 0, 'a press where the hidden thumb is dragged it');

                // The track: with its pieces, and a press on it does not page.
                await hide('track');
                expect((await t.call('display', 'v', 'track-vertical')) === 'none', 'hide="track": the track is displayed');
                expect((await t.call('parentDisplay', 'v', 'track-piece-end-vertical')) === 'none', 'hide="track": the pieces are displayed');
                await t.page.mouse.move(area.left + area.width / 2, area.bottom - 5);
                await t.page.mouse.down();
                await t.page.mouse.up();
                await t.sleep(300);
                expect((await t.call('scrollOf', 'v')).host === 0, 'a press on the hidden track paged');

                // The pieces alone: the track stays, and pages.
                await hide('track-piece');
                expect((await t.call('display', 'v', 'track-vertical')) !== 'none', 'hide="track-piece": the track is not displayed');
                expect((await t.call('parentDisplay', 'v', 'track-piece-end-vertical')) === 'none', 'hide="track-piece": the pieces are displayed');
                await t.page.mouse.move(area.left + area.width / 2, area.bottom - 5);
                await t.page.mouse.down();
                await t.page.mouse.up();
                await t.settle();
                expect((await t.call('scrollOf', 'v')).host > 0, 'with only the pieces hidden, a press on the track does not page');
                await t.call('setScroll', 'v', 0);
                await t.settle();

                await hide('button');
                expect((await t.call('display', 'v', 'button-end-vertical')) === 'none', 'hide="button": the end button is displayed');

                // Markers: not displayed, not hit, not measured.
                await t.call('spyRects', 'h500');
                await hide('marker');
                expect((await markersDisplay()) === 'none', 'hide="marker": the markers are displayed');
                await t.call('spyRects', 'h500');
                await t.page.evaluate(() => (document.getElementById('v') as HTMLElement & { refreshMarkers(): void }).refreshMarkers());
                await t.frames(3);
                expect((await t.call<number>('rectCalls', 'h500')) === 0, 'hidden markers were measured');
                // Forget the markers the pointer crossed before.
                await t.call('reset');
                await t.page.mouse.move(m500.x, m500.y);
                await t.frames(3);
                expect(!(await t.call<{ type: string }[]>('log', 'v')).some((e) => e.type === 'markerenter'), 'a hidden marker was entered');
                await t.park();
                await hide('');
                expect((await t.call<number>('rectCalls', 'h500')) > 0, 'shown again, the markers were not measured');

                // Cards: the marker is entered, its card does not open.
                await hide('card');
                await t.page.mouse.move(m500.x, m500.y);
                await t.frames(3);
                expect((await t.call<{ type: string }[]>('log', 'v')).some((e) => e.type === 'markerenter'), 'with hidden cards the marker is not entered');
                expect((await t.call('openCard', 'v')) === '', 'hide="card": a card opened');
                await t.park();
            } finally {
                await t.call('setAttr', 'v', 'hide', '');
                await t.park();
                await t.settle();
            }
            // The corner, on the scroller with both bars.
            await t.call('setAttr', 'both', 'hide', 'corner');
            try {
                await t.frames(3);
                expect((await t.call('display', 'both', 'corner')) === 'none', 'hide="corner": the corner is displayed');
            } finally {
                await t.call('setAttr', 'both', 'hide', '');
                await t.frames(3);
            }
            expect((await t.call('display', 'both', 'corner')) !== 'none', 'hide="": the corner is not displayed');
        },
    },
    {
        name: 'touch="indicator" (default): the touch indicator is a thumb alone (no buttons, track or corner), stays so while it fades, and the mouse brings the parts back; touch="bar" shows them on touch',
        run: async (t) => {
            const u = await t.touch();
            await u.reset();
            const parts = async () => ({
                buttons: (await u.call('display', 'v', 'button-end-vertical')) !== 'none',
                track: (await u.call('display', 'v', 'track-vertical')) !== 'none',
            });
            const touchScroll = async (host: { left: number; top: number }) => {
                const x = host.left + 100;
                const y = host.top + 150;
                await u.start(x, y);
                for (let i = 1; i <= 6; i++) await u.move(x, y - i * 12);
                await u.end();
                await u.frames(3);
            };
            try {
                const host = await u.box('v', 'host');
                await u.page.mouse.move(host.left + 60, host.top + 60);
                await u.frames(3);
                expect((await u.call('hostAttr', 'v', 'indicator-state')) === 'mouse', 'precondition: mouse indicator');
                let p = await parts();
                expect(p.buttons && p.track, `mouse: buttons shown ${p.buttons}, track shown ${p.track}`);
                await touchScroll(host);
                expect((await u.call('hostAttr', 'v', 'indicator-state')) === 'touch', `after a touch scroll the indicator is ${await u.call('hostAttr', 'v', 'indicator-state')}`);
                p = await parts();
                expect(!p.buttons && !p.track, `touch: buttons shown ${p.buttons}, track shown ${p.track}`);
                // Fading out (touch idle delay 100ms) it keeps the parts of the touch indicator.
                await u.sleep(400);
                expect((await u.call('hostAttr', 'v', 'indicator-state')) === 'none', 'precondition: the indicator ended');
                p = await parts();
                expect(!p.buttons && !p.track, `fading out after touch, buttons shown ${p.buttons}, track shown ${p.track}`);
                await u.page.mouse.move(host.left + 70, host.top + 70);
                await u.frames(3);
                expect((await u.call('hostAttr', 'v', 'indicator-state')) === 'mouse', 'precondition: mouse again');
                p = await parts();
                expect(p.buttons && p.track, `mouse again: buttons shown ${p.buttons}, track shown ${p.track}`);
                // touch="bar": a touch scroll shows the mouse indicator and every part.
                await u.sleep(400);
                await u.call('setAttr', 'v', 'touch', 'bar');
                await u.settle();
                await touchScroll(host);
                expect((await u.call('hostAttr', 'v', 'indicator-state')) === 'mouse', `touch="bar": after a touch scroll the indicator is ${await u.call('hostAttr', 'v', 'indicator-state')}`);
                p = await parts();
                expect(p.buttons && p.track, `touch="bar": buttons shown ${p.buttons}, track shown ${p.track}`);
            } finally {
                await u.call('setAttr', 'v', 'touch', null);
            }
        },
    },
    {
        name: 'glyph geometry inputs (--ax-scrollbar-part-glyph-*, set on ::part(button)) change the drawn chevron',
        run: async (t) => {
            await t.reset();
            const points = () => t.call<string>('inner', 'v', 'button-end-vertical', '.layer-scrollbar-glyph polygon', 'points');
            await t.call('wake', 'v');
            await t.frames(3);
            const before = await points();
            await t.call('addStyle', 'glyph', 'ax-scroll-view::part(button) { --ax-scrollbar-glyph-width: 6px; --ax-scrollbar-glyph-height: 4px; --ax-scrollbar-glyph-thickness: 2px; --ax-scrollbar-glyph-offset: 1px; }');
            try {
                await t.call('wake', 'v');
                await t.frames(3);
                // A down chevron in a 10px button: 6px wide, 4px deep, 1px below the track.
                const after = await points();
                expect(after === '5,5 8,3 8,1 5,3 2,1 2,3', `the chevron is "${after}" (was "${before}")`);
            } finally {
                await t.call('addStyle', 'glyph', '');
            }
        },
    },
    {
        name: 'Surface Shape properties set with ::part() reach the parts (the default theme sets them in the shadow root, outer rules win)',
        run: async (t) => {
            await t.reset();
            const radius = () => t.call<string>('computed', 'surf', 'thumb-vertical', '--ax-radius');
            // The fill inside the border is a polyline: a capsule has many corners, a square four.
            const arcs = async () => ((await t.call<string>('inner', 'surf', 'thumb-vertical', '.layer-scrollbar-fill svg > path', 'd')).match(/L/g) || []).length > 8;
            const c = centre(await t.box('surf', 'thumb-vertical'));
            await t.page.mouse.move(c.x - 100, c.y);
            await t.sleep(300);
            expect((await radius()).trim() === '0px' && !(await arcs()), `default: --ax-radius ${await radius()}, arcs ${await arcs()}`);
            await t.call('addStyle', 'shape', '#surf::part(thumb) { --ax-radius: 50%; } #v::part(marker) { --ax-radius: 1px; }');
            try {
                await t.sleep(300);
                expect((await radius()).trim() === '50%', `::part(thumb) --ax-radius: 50% gives --ax-radius ${await radius()}`);
                expect(await arcs(), 'a capsule thumb draws a square outline');
                const marker = await t.call<string>('computed', 'v', 'marker:m500', '--ax-radius');
                expect(marker.trim() === '1px', `::part(marker) --ax-radius: 1px gives the marker --ax-radius ${marker}`);
            } finally {
                await t.call('addStyle', 'shape', '');
                await t.park();
            }
        },
    },
    {
        name: 'fade durations: --ax-scrollbar-fade-in-duration and -fade-out-duration fade linearly',
        run: async (t) => {
            await t.call('setStyle', 'surf', '--ax-scrollbar-idle-delay', '700ms');
            const at = (rows: [number, string][], from: number, ms: number): number => {
                const row = rows.find((r) => r[0] >= from + ms) || rows[rows.length - 1];
                return parseFloat(row[1]);
            };
            // A linear fade of `duration` ms: on every frame that falls inside it, the opacity must be the
            // ramp's value at the frame's own page time. The ramp starts between the last frame still at the
            // old value and the first frame past it, so it starts at the middle of that gap.
            const linearFade = (rows: [number, string][], rising: boolean, duration: number): { frames: number; worst: number; at: string } => {
                const values = rows.map(([time, v]) => [time, parseFloat(v)] as [number, number]);
                const edge = values.findIndex(([, v]) => (rising ? v > 0 : v < 1));
                if (edge < 1) throw new Error(`the fade did not start inside the sample: ${JSON.stringify(values.slice(0, 5))}`);
                const start = (values[edge - 1][0] + values[edge][0]) / 2;
                let frames = 0;
                let worst = 0;
                let worstAt = '';
                for (const [time, v] of values.slice(edge)) {
                    const elapsed = time - start;
                    if (elapsed < 0 || elapsed > duration) continue;
                    const ramp = Math.min(1, Math.max(0, elapsed / duration));
                    const expected = rising ? ramp : 1 - ramp;
                    frames++;
                    if (Math.abs(v - expected) > worst) {
                        worst = Math.abs(v - expected);
                        worstAt = `${round(elapsed)}ms: ${round(v)}, linear ${round(expected)}`;
                    }
                }
                return { frames, worst, at: worstAt };
            };
            try {
                await t.reset();
                await t.sleep(1200);
                const host = await t.box('surf', 'host');
                // Exponential by default: 100ms in, well past half way.
                await t.page.mouse.move(host.left + 40, host.top + 40);
                let rows = await t.call<[number, string][]>('sample', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-opacity', 300);
                let start = (rows.find((r) => parseFloat(r[1]) > 0) || rows[0])[0];
                expect(at(rows, start, 100) > 0.65, `exponential fade: ${at(rows, start, 100)} after 100ms`);
                await t.park();
                await t.sleep(1500);

                await t.call('setStyle', 'surf', '--ax-scrollbar-fade-in-duration', '400ms');
                await t.call('setStyle', 'surf', '--ax-scrollbar-fade-out-duration', '400ms');
                // Start sampling before the pointer moves in, so the fade's first frames are in the rows. The
                // window ends before the 700ms hide delay, so the fade out does not begin inside it.
                const fadingIn = t.call<[number, string][]>('sample', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-opacity', 600);
                await t.sleep(60);
                await t.page.mouse.move(host.left + 40, host.top + 40);
                rows = await fadingIn;
                const inFade = linearFade(rows, true, 400);
                expect(inFade.frames >= 5, `only ${inFade.frames} frames inside the 400ms fade in`);
                expect(inFade.worst <= 0.1, `fade in is not linear over 400ms: worst ${inFade.at}`);
                const inStart = (rows.find((r) => parseFloat(r[1]) > 0) || rows[0])[0];
                const settled = rows.filter((r) => r[0] - inStart >= 450);
                expect(settled.length > 0 && settled.every((r) => parseFloat(r[1]) === 1), `the fade in did not end: ${JSON.stringify(rows.filter((_, i) => i % 3 === 0))}`);
                // Out: after the hide delay, linear over 400ms.
                const fadingOut = t.call<[number, string][]>('sample', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-opacity', 1500);
                await t.sleep(60);
                await t.park();
                rows = await fadingOut;
                const outFade = linearFade(rows, false, 400);
                expect(outFade.frames >= 5, `only ${outFade.frames} frames inside the 400ms fade out`);
                expect(outFade.worst <= 0.1, `fade out is not linear over 400ms: worst ${outFade.at}`);
            } finally {
                await t.call('setStyle', 'surf', '--ax-scrollbar-idle-delay', '');
                await t.call('setStyle', 'surf', '--ax-scrollbar-fade-in-duration', '');
                await t.call('setStyle', 'surf', '--ax-scrollbar-fade-out-duration', '');
            }
        },
    },
    {
        name: 'card look: the inputs and real CSS on ::part(card): colour, border, text colour, padding and font size',
        run: async (t) => {
            await t.reset();
            await t.call(
                'addStyle',
                'card',
                `ax-scroll-view::part(card) { --ax-scrollbar-part-color: rgb(0, 0, 255); --ax-scrollbar-part-border-color: rgb(0, 255, 0); --ax-border-width: 3px;
                    color: rgb(255, 255, 0); padding: 5px 7px; font-size: 15px; }`,
            );
            try {
                await t.page.mouse.move(...(Object.values(centre(await t.box('v', 'marker:m500'))) as [number, number]));
                await t.sleep(400);
                const look = await t.page.evaluate(() => {
                    const card = (document.getElementById('v') as HTMLElement).shadowRoot!.querySelector('[part~="card-open"]') as HTMLElement;
                    const paths = card.shadowRoot!.querySelectorAll('.layer-scrollbar-fill svg > path');
                    const style = getComputedStyle(card);
                    return {
                        color: style.color,
                        fontSize: style.fontSize,
                        padding: `${style.paddingTop} ${style.paddingRight}`,
                        fill: paths[0].getAttribute('fill'),
                        ring: paths[1].getAttribute('d') ? paths[1].getAttribute('fill') : '',
                    };
                });
                expect(look.color === 'rgb(255, 255, 0)' && look.fontSize === '15px', `text ${look.color} ${look.fontSize}`);
                expect(look.padding === '5px 7px', `padding ${look.padding}`);
                expect(look.fill === 'rgba(0, 0, 255, 1)' && look.ring === 'rgba(0, 255, 0, 1)', `drawn: fill ${look.fill}, border ${look.ring}`);
            } finally {
                await t.call('addStyle', 'card', '');
                await t.park();
            }
        },
    },
    {
        name: 'card shadow: the default card has the elevation layer, at depth 0 and no CSS shadow; --elevation-depth and --elevation-color on ::part(card) change it',
        run: async (t) => {
            await t.reset();
            await t.page.mouse.move(...(Object.values(centre(await t.box('v', 'marker:m500'))) as [number, number]));
            await t.sleep(400);
            const read = () =>
                t.page.evaluate(() => {
                    const card = (document.getElementById('v') as HTMLElement).shadowRoot!.querySelector('[part~="card-open"]') as HTMLElement;
                    const canvas = card.shadowRoot!.querySelector('.layer-elevation canvas') as HTMLCanvasElement | null;
                    const style = getComputedStyle(card);
                    let tint = '';
                    if (canvas) {
                        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
                        let best = 0;
                        for (let i = 3; i < data.length; i += 4) if (data[i] > best) { best = data[i]; tint = `${data[i - 3]},${data[i - 2]},${data[i - 1]}`; }
                    }
                    return { layers: card.shadowRoot!.querySelectorAll('[class^="layer-"]').length, canvas: !!canvas, depth: style.getPropertyValue('--elevation-depth').trim(), filter: style.filter, boxShadow: style.boxShadow, tint };
                });
            try {
                let card = await read();
                expect(card.canvas && card.depth === '0', `elevation layer ${card.canvas}, depth "${card.depth}"`);
                expect(card.filter === 'none' && card.boxShadow === 'none', `filter "${card.filter}", box-shadow "${card.boxShadow}"`);
                await t.call('addStyle', 'glow', 'ax-scroll-view::part(card) { --elevation-depth: 16; --elevation-color: rgb(255, 0, 255); }');
                await t.sleep(300);
                card = await read();
                expect(card.depth === '16' && card.tint === '255,0,255', `glow: depth "${card.depth}", shadow colour ${card.tint}`);
            } finally {
                await t.call('addStyle', 'glow', '');
                await t.park();
            }
        },
    },
    {
        name: 'thumb sizes: engaged and hover apart (::part(thumb-engaged), ::part(thumb-hover) set --ax-scrollbar-part-size)',
        run: async (t) => {
            await t.reset();
            await t.call('setStyle', 'surf', '--ax-scrollbar-state-smoothing', '0s');
            await t.call('addStyle', 'sizes', '#surf::part(thumb-engaged) { --ax-scrollbar-part-size: 6px; } #surf::part(thumb-hover) { --ax-scrollbar-part-size: 8px; }');
            try {
                const bar = await t.box('surf', 'scrollbar-vertical');
                const thumb = await t.box('surf', 'thumb-vertical');
                const size = () => t.call<string>('look', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-size');
                // In the hot zone below the thumb: engaged, not over the thumb.
                await t.page.mouse.move(bar.left - 5, thumb.bottom + 30);
                await t.frames(4);
                expect((await size()) === '6px', `engaged: ${await size()}`);
                await t.page.mouse.move(...(Object.values(centre(thumb)) as [number, number]));
                await t.frames(4);
                expect((await size()) === '8px', `hover: ${await size()}`);
            } finally {
                await t.call('addStyle', 'sizes', '');
                await t.call('setStyle', 'surf', '--ax-scrollbar-state-smoothing', '');
                await t.park();
            }
        },
    },
    {
        name: 'marker states: ::part(marker-current) and ::part(marker-on-thumb marker-hover) set the colour, later rules win',
        run: async (t) => {
            await t.reset();
            await t.call('setStyle', 'v', '--ax-scrollbar-state-smoothing', '0s');
            await t.call(
                'addStyle',
                'markers',
                '#v::part(marker-current) { --ax-scrollbar-part-color: rgb(0, 0, 255); } #v::part(marker-on-thumb marker-hover) { --ax-scrollbar-part-color: rgb(0, 255, 0); }',
            );
            const color = (id: string) => t.call<string>('look', 'v', `marker:${id}`, '--ax-scrollbar-shown-color');
            try {
                // A motion keeps the time constants it started with: let the bars' appearance end.
                await t.sleep(1500);
                // m500 is the current one and lies before the thumb.
                await t.call('setScroll', 'v', 700);
                await t.settle();
                const tm = await t.tokens('v', 'marker:m500');
                expect(has(tm, 'marker-current') && !has(tm, 'marker-on-thumb'), `precondition: m500 tokens ${tm.join(' ')}`);
                expect((await color('m500')) === 'rgba(0, 0, 255, 1)', `current: ${await color('m500')}`);
                // At the top m0 is on the thumb: hovered there it takes the on-thumb hover colour.
                await t.call('setScroll', 'v', 0);
                await t.settle();
                await t.page.mouse.move(...(Object.values(centre(await t.box('v', 'marker:m0'))) as [number, number]));
                await t.frames(4);
                const t0 = await t.tokens('v', 'marker:m0');
                expect(has(t0, 'marker-on-thumb') && has(t0, 'marker-hover'), `precondition: m0 tokens ${t0.join(' ')}`);
                expect((await color('m0')) === 'rgba(0, 255, 0, 1)', `on the thumb, hovered: ${await color('m0')}`);
            } finally {
                await t.call('addStyle', 'markers', '');
                await t.call('setStyle', 'v', '--ax-scrollbar-state-smoothing', '');
                await t.park();
            }
        },
    },
    {
        name: 'layout tokens of the default look: thickness, padding, thumb minimum length, button length',
        run: async (t) => {
            const content = '<div style="width: 80000px; height: 80000px"></div>';
            await t.call('plainMake', 'lay', '', { hide: '', vertical: 'always', horizontal: 'always' }, content);
            try {
                await t.frames(4);
                const read = async () => ({
                    bar: await t.box('lay', 'scrollbar-vertical'),
                    barH: await t.box('lay', 'scrollbar-horizontal'),
                    area: await t.box('lay', 'area-vertical'),
                    thumb: await t.box('lay', 'thumb-vertical'),
                    thumbH: await t.box('lay', 'thumb-horizontal'),
                    button: await t.box('lay', 'button-end-vertical'),
                    buttonH: await t.box('lay', 'button-end-horizontal'),
                });
                let m = await read();
                near(m.bar.width, 17, 0.01, 'default thickness');
                near(m.area.left - m.bar.left, 0, 0.01, 'default padding');
                near(m.thumb.height, 48, 0.01, 'default thumb minimum length');
                near(m.button.width, 17, 0.01, 'default button: as wide as the bar inside its padding');
                near(m.button.height, 33, 0.01, 'default button length');
                await t.call('setStyle', 'lay', '--ax-scrollbar-button-length', 'auto');
                await t.frames(4);
                near((await read()).button.height, 17, 0.01, 'button length auto: a square');
                const tokens: [string, string][] = [
                    ['--ax-scrollbar-thickness', '20px'],
                    ['--ax-scrollbar-padding', '3px'],
                    ['--ax-scrollbar-thumb-min-length', '40px'],
                    ['--ax-scrollbar-button-length', '24px'],
                ];
                for (const [name, value] of tokens) await t.call('setStyle', 'lay', name, value);
                await t.frames(4);
                await t.settle();
                await t.sleep(600);
                m = await read();
                near(m.bar.width, 20, 0.01, '--ax-scrollbar-thickness: vertical bar width');
                near(m.barH.height, 20, 0.01, '--ax-scrollbar-thickness: horizontal bar height');
                near(m.area.left - m.bar.left, 3, 0.01, '--ax-scrollbar-padding');
                near(m.thumb.height, 40, 0.01, '--ax-scrollbar-thumb-min-length: vertical thumb');
                near(m.thumbH.width, 40, 0.01, '--ax-scrollbar-thumb-min-length: horizontal thumb');
                near(m.button.height, 24, 0.01, '--ax-scrollbar-button-length: vertical button');
                near(m.buttonH.width, 24, 0.01, '--ax-scrollbar-button-length: horizontal button');
                near(m.button.width, 14, 0.01, 'the button is as wide as the bar inside its padding');
            } finally {
                await t.call('plainRemove', 'lay');
            }
        },
    },
    {
        name: 'thickness token, live: the default look follows --ax-scrollbar-thickness (17 -> 24 -> 8 -> 17) with no refresh',
        run: async (t) => {
            const content = '<h2 style="margin: 0; height: 1200px">One</h2><h2 style="margin: 0; height: 1200px">Two</h2><h2 style="margin: 0; height: 1200px">Three</h2><div style="width: 6000px; height: 1px"></div>';
            await t.call('plainMake', 'live', '', { hide: '', vertical: 'always', horizontal: 'always', 'marker-selector': 'h2', indicator: 'pinned' }, content);
            try {
                await t.frames(4);
                const glyph = async (name: string) => {
                    const points = (await t.call<string>('inner', 'live', name, '.layer-scrollbar-glyph polygon', 'points')).split(' ').map((p) => p.split(',').map(Number));
                    const xs = points.map((p) => p[0]);
                    const ys = points.map((p) => p[1]);
                    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
                };
                const check = async (th: number) => {
                    const k = th / 17;
                    await t.frames(6);
                    await t.settle();
                    const where = `at ${th}px: `;
                    const bar = await t.box('live', 'scrollbar-vertical');
                    near(bar.width, th, 0.01, where + 'vertical bar width');
                    near((await t.box('live', 'scrollbar-horizontal')).height, th, 0.01, where + 'horizontal bar height');
                    const thumb = await t.box('live', 'thumb-vertical');
                    near(thumb.width, th, 0.02, where + 'vertical thumb width fills the bar');
                    near((await t.box('live', 'thumb-horizontal')).height, th, 0.02, where + 'horizontal thumb height fills the bar');
                    for (const name of ['button-start-vertical', 'button-end-vertical']) {
                        const b = await t.box('live', name);
                        near(b.width, th, 0.02, where + `${name} width`);
                        near(b.height, 33 * k, 0.02, where + `${name} length`);
                    }
                    near((await t.box('live', 'button-end-horizontal')).width, 33 * k, 0.02, where + 'horizontal button length');
                    const g = await glyph('button-end-vertical');
                    near(g.right - g.left, 10.944 * k, 0.01, where + 'glyph width');
                    near(g.bottom - g.top, 9.673 * k, 0.01, where + 'glyph height');
                    near((g.left + g.right) / 2, th / 2, 0.01, where + 'glyph centred across');
                    // The end button points down: its base is 7px (scaled) from the end button's top edge.
                    near(g.top, 7 * k, 0.01, where + 'glyph offset from the track end of the button');
                    const marker = await t.box('live', 'marker-vertical');
                    near(marker.height, 2 * k, 0.02, where + 'marker thickness along the bar');
                    return { marker };
                };
                await check(17);
                for (const th of [24, 8, 17]) {
                    await t.call('setToken', 'live', '--ax-scrollbar-thickness', `${th}px`);
                    const { marker } = await check(th);
                    // A marker is 9px for a 17px bar, 13px when it is the current one.
                    expect(Math.abs(marker.width - (9 * th) / 17) < 0.05 || Math.abs(marker.width - (13 * th) / 17) < 0.05, `at ${th}px: marker width is ${round(marker.width)}`);
                }
                // The hovered marker is as wide as the bar.
                await t.call('setToken', 'live', '--ax-scrollbar-thickness', '24px');
                await t.frames(6);
                const c = centre(await t.box('live', 'marker-vertical'));
                await t.page.mouse.move(c.x, c.y);
                await t.sleep(300);
                near((await t.box('live', 'marker-vertical')).width, 24, 0.05, 'the hovered marker is as wide as a 24px bar');
                await t.park();
            } finally {
                await t.call('plainRemove', 'live');
                await t.park();
            }
        },
    },
    {
        name: 'Luna kit (@ax-design/scrollbar/kits/luna): the parts of the kit draw with the scheme, and the schemes are adopted once',
        run: async (t) => {
            const schemes = await t.call<string>('lunaKit');
            for (const name of ['blue', 'olive', 'silver', 'purple', 'orange', 'pink', 'gold']) expect(schemes.includes(`.luna-${name}`), `no scheme class luna-${name}`);
            const [before, once, twice] = await t.call<number[]>('adoptLuna');
            expect(once === before + 1 && twice === once, `adoptLunaSchemes adds one sheet and only one: ${before}, ${once}, ${twice}`);
            await t.call('plainMake', 'luna', schemes, { kit: 'luna', class: 'luna-blue', vertical: 'always', horizontal: 'always' }, '<div style="width: 3000px; height: 3000px"></div>');
            try {
                await t.frames(6);
                near((await t.box('luna', 'scrollbar-vertical')).width, 17, 0.01, 'the Luna bar is 17px');
                expect((await t.call<string>('tagOf', 'luna', 'thumb-vertical')) === 'AX-SCROLLBAR-LUNA-THUMB', 'the thumb is the kit\'s class');
                near((await t.box('luna', 'thumb-vertical')).width, 17, 0.01, 'the Luna thumb fills the bar');
                const light = await t.call<string | null>('partAttr', 'luna', 'thumb-vertical', 'light');
                expect(light === 'top-left', `the blue scheme is lit from the top left: ${light}`);
            } finally {
                await t.call('plainRemove', 'luna');
            }
        },
    },
    {
        name: 'fill, border and arrow colours per state: the thumb and the buttons, rest, hover, pressed',
        run: async (t) => {
            const css = `ax-scroll-view {
                --ax-scrollbar-state-smoothing: 0s; --ax-scrollbar-fade-smoothing: 0s; --ax-scrollbar-slide-distance: 0px;
                --ax-scrollbar-button-length: 20px; --ax-scrollbar-repeat-delay: 5s;
            }
            ax-scroll-view::part(thumb) { --ax-scrollbar-part-color: rgb(10, 0, 0); --ax-scrollbar-part-border-color: rgb(0, 10, 0); }
            ax-scroll-view::part(thumb-hover) { --ax-scrollbar-part-color: rgb(20, 0, 0); --ax-scrollbar-part-border-color: rgb(0, 20, 0); }
            ax-scroll-view::part(thumb-pressed) { --ax-scrollbar-part-color: rgb(30, 0, 0); --ax-scrollbar-part-border-color: rgb(0, 30, 0); }
            ax-scroll-view::part(button) { --ax-scrollbar-part-color: rgb(0, 0, 10); --ax-scrollbar-part-border-color: rgb(10, 10, 0); --ax-scrollbar-part-glyph-color: rgb(0, 10, 10); }
            ax-scroll-view::part(button-hover) { --ax-scrollbar-part-color: rgb(0, 0, 20); --ax-scrollbar-part-border-color: rgb(20, 20, 0); --ax-scrollbar-part-glyph-color: rgb(0, 20, 20); }
            ax-scroll-view::part(button-pressed) { --ax-scrollbar-part-color: rgb(0, 0, 30); --ax-scrollbar-part-border-color: rgb(30, 30, 0); --ax-scrollbar-part-glyph-color: rgb(0, 30, 30); }`;
            await t.call('plainMake', 'col', css, { hide: '' }, '<div style="height: 4000px"></div>');
            const look = (name: string, property: string) => t.call<string>('look', 'col', name, property);
            const colours = async (name: string) => [await look(name, '--ax-scrollbar-shown-color'), await look(name, '--ax-scrollbar-shown-border-color'), await look(name, '--ax-scrollbar-shown-glyph-color')];
            try {
                const host = await t.box('col', 'host');
                await t.page.mouse.move(host.left + 20, host.top + 20);
                await t.sleep(300);
                const thumb = centre(await t.box('col', 'thumb-vertical'));
                const button = centre(await t.box('col', 'button-end-vertical'));
                const rgba = (...c: number[]) => `rgba(${c.join(', ')}, 1)`;
                let got = await colours('thumb-vertical');
                expect(got[0] === rgba(10, 0, 0) && got[1] === rgba(0, 10, 0), `thumb at rest: ${got}`);
                await t.page.mouse.move(thumb.x, thumb.y);
                await t.frames(4);
                got = await colours('thumb-vertical');
                expect(got[0] === rgba(20, 0, 0) && got[1] === rgba(0, 20, 0), `thumb hovered: ${got}`);
                await t.page.mouse.down();
                await t.frames(4);
                got = await colours('thumb-vertical');
                expect(got[0] === rgba(30, 0, 0) && got[1] === rgba(0, 30, 0), `thumb pressed: ${got}`);
                await t.page.mouse.up();
                got = await colours('button-end-vertical');
                expect(got.join() === [rgba(0, 0, 10), rgba(10, 10, 0), rgba(0, 10, 10)].join(), `button at rest: ${got}`);
                await t.page.mouse.move(button.x, button.y);
                await t.frames(4);
                got = await colours('button-end-vertical');
                expect(got.join() === [rgba(0, 0, 20), rgba(20, 20, 0), rgba(0, 20, 20)].join(), `button hovered: ${got}`);
                await t.page.mouse.down();
                await t.frames(4);
                got = await colours('button-end-vertical');
                expect(got.join() === [rgba(0, 0, 30), rgba(30, 30, 0), rgba(0, 30, 30)].join(), `button pressed: ${got}`);
                await t.page.mouse.up();
                await t.frames(4);
                // What the glyph layer draws is the glyph colour of the state.
                const fill = await t.call<string>('inner', 'col', 'button-end-vertical', '.layer-scrollbar-glyph polygon', 'fill');
                expect(fill === 'rgba(0, 20, 20, 1)', `the arrow layer fills with "${fill}" after the release (hovered)`);
            } finally {
                await t.page.mouse.up().catch(() => {});
                await t.call('plainRemove', 'col');
                await t.park();
            }
        },
    },
    {
        name: 'marker size and thickness: a tick across x along the bar, auto is a dot',
        run: async (t) => {
            const css = `ax-scroll-view { --ax-scrollbar-state-smoothing: 0s; --ax-scrollbar-fade-smoothing: 0s; --ax-scrollbar-slide-distance: 0px; }`;
            const html = '<div style="height: 4000px"><h2 id="a" style="margin: 3000px 0 0">A</h2></div>';
            await t.call('plainMake', 'mk', css, { hide: '', 'marker-selector': 'h2', 'marker-align': 'start', horizontal: 'hidden' }, html);
            try {
                const host = await t.box('mk', 'host');
                await t.page.mouse.move(host.left + 20, host.top + 20);
                await t.sleep(300);
                const dot = await t.box('mk', 'marker:a');
                near(dot.width, 9, 0.01, 'default marker width');
                near(dot.height, 2, 0.01, 'default marker thickness: a flat tick');
                await t.call('plainStyle', 'mk', 'ax-scroll-view::part(marker) { --ax-scrollbar-part-size: 4px; --ax-scrollbar-part-thickness: auto; }');
                await t.frames(4);
                const dotted = await t.box('mk', 'marker:a');
                near(dotted.width, 4, 0.01, 'marker width');
                near(dotted.height, 4, 0.01, 'a thickness of auto: a dot');
                await t.call('plainStyle', 'mk', 'ax-scroll-view::part(marker) { --ax-scrollbar-part-size: 9px; --ax-scrollbar-part-thickness: 2px; }');
                await t.frames(4);
                const tick = await t.box('mk', 'marker:a');
                near(tick.width, 9, 0.01, '--ax-scrollbar-part-size: across the bar');
                near(tick.height, 2, 0.01, '--ax-scrollbar-part-thickness: along the bar');
                // The pointer on it: the hover size across, the thickness unchanged.
                await t.call('plainStyle', 'mk', 'ax-scroll-view::part(marker) { --ax-scrollbar-part-size: 9px; --ax-scrollbar-part-thickness: 2px; } ax-scroll-view::part(marker-hover) { --ax-scrollbar-part-size: 17px; }');
                const c = centre(tick);
                await t.page.mouse.move(c.x, c.y);
                await t.frames(4);
                const hover = await t.box('mk', 'marker:a');
                near(hover.width, 17, 0.01, 'hovered marker width');
                near(hover.height, 2, 0.01, 'hovered marker thickness');
            } finally {
                await t.call('plainRemove', 'mk');
                await t.park();
            }
        },
    },
    {
        name: 'kits: the default of hide is the kit\'s; a kit without one hides nothing; the attribute wins',
        run: async (t) => {
            await t.reset();
            await t.page.evaluate(() => {
                const { defineScrollbarKit } = window.axScrollbar;
                defineScrollbarKit('hidekit-plain', {});
                defineScrollbarKit('hidekit-own', { hide: 'track' });
            });
            // A part is shown when it is made and displayed; one the look leaves out is not made at all.
            const shown = async () => ({
                buttons: (await t.call<boolean>('made', 'kit', 'button-end-vertical')) && (await t.call('display', 'kit', 'button-end-vertical')) !== 'none',
                track: (await t.call<boolean>('made', 'kit', 'track-vertical')) && (await t.call('display', 'kit', 'track-vertical')) !== 'none',
            });
            try {
                await t.call('setAttr', 'kit', 'kit', 'hidekit-plain');
                await t.settle();
                let s = await shown();
                expect(s.buttons && s.track, `no hide: buttons shown ${s.buttons}, track shown ${s.track}`);
                await t.call('setAttr', 'kit', 'kit', 'hidekit-own');
                await t.settle();
                s = await shown();
                expect(s.buttons && !s.track, `hide: "track": buttons shown ${s.buttons}, track shown ${s.track}`);
                // The kit was rebuilt, and the track that its look leaves out was never made.
                expect(!(await t.call<boolean>('made', 'kit', 'track-vertical')), 'hide: "track": the track element is made though the look leaves it out');
                expect(!(await t.call<boolean>('made', 'kit', 'track-piece-start-vertical')), 'hide: "track": a track piece is made though the track is left out');
                await t.call('setAttr', 'kit', 'hide', '');
                await t.settle();
                s = await shown();
                expect(s.buttons && s.track, `the attribute hide="" overrides the kit: buttons shown ${s.buttons}, track shown ${s.track}`);
                // It is made the first time it is wanted, and kept when it is left out again.
                await t.call('setAttr', 'kit', 'hide', 'track');
                await t.settle();
                expect(await t.call<boolean>('made', 'kit', 'track-vertical'), 'the track is gone when it is left out again, want it kept (display none)');
                expect((await t.call('display', 'kit', 'track-vertical')) === 'none', 'the track that is left out is displayed');
            } finally {
                await t.call('setAttr', 'kit', 'hide', null);
                await t.call('setAttr', 'kit', 'kit', null);
                await t.settle();
            }
        },
    },
    {
        name: 'parts on demand: a part is made the first time the layout needs it and kept; a bar that never shows, a kind the look hides, markers that are hidden and cards that never open make none',
        run: async (t) => {
            const html = '<div id="c" style="height: 3000px"><h2 id="A" style="margin: 0">A</h2><h2 id="B" style="margin: 900px 0 0">B</h2></div>';
            const attrs = { 'marker-selector': 'h2', indicator: 'pinned', 'thumb-layers': 'scrollbar-fill test-a' };
            await t.page.evaluate(() => {
                const { defineScrollbarKit, AxScrollbarThumb } = window.axScrollbar;
                if (!window.axScrollbar.hasScrollbarKit('b18')) defineScrollbarKit('b18', { thumb: class extends AxScrollbarThumb {} });
            });
            await t.call('plainMake', 'od', '', attrs, html);
            const made = (name: string) => t.call<boolean>('made', 'od', name);
            const count = () => t.call<Record<string, number>>('madeCount', 'od');
            // The counts as sorted text: the order of the keys is not the point.
            const text = (counts: Record<string, number>) => JSON.stringify(Object.entries(counts).sort());
            try {
                await t.frames(6);
                // Content that scrolls on one axis: that bar's parts, its markers, and nothing else.
                const first = await count();
                expect(text(first) === text({ thumb: 1, button: 2, track: 1, 'track-piece': 2, marker: 2 }), `a view that scrolls vertically made ${JSON.stringify(first)}, want the vertical bar and its two markers`);
                for (const name of ['thumb-horizontal', 'button-start-horizontal', 'button-end-horizontal', 'track-horizontal', 'track-piece-start-horizontal', 'track-piece-end-horizontal', 'corner', 'card']) {
                    expect(!(await made(name)), `${name} is made, though no bar of that part shows`);
                }
                expect(await made('thumb-vertical'), 'the thumb of the bar that shows is not made');

                // Content that grows wide: the horizontal bar shows for the first time, and its parts and the corner are made then,
                // with the layers of the attribute set before they existed.
                await t.call('plainStyle', 'od', '#c { width: 3000px; }');
                await t.frames(8);
                const both = await count();
                expect(text(both) === text({ thumb: 2, button: 4, track: 2, 'track-piece': 4, corner: 1, marker: 2 }), `a view that scrolls both ways made ${JSON.stringify(both)}`);
                expect((await t.call<string | null>('layersAttr', 'od', 'thumb-horizontal')) === 'scrollbar-fill test-a', 'the thumb made later has no layers from the attribute');
                // The part is drawn, not only made: it is placed along its track.
                const bar = await t.box('od', 'scrollbar-horizontal');
                const thumb = await t.box('od', 'thumb-horizontal');
                expect(thumb.width > 0 && thumb.left >= bar.left && thumb.right <= bar.right, `the thumb made later is at ${JSON.stringify(thumb)} in the bar ${JSON.stringify(bar)}`);

                // The bar goes away: its parts stay (not displayed), and are not made again when it comes back.
                const before = await t.call<string>('identity', 'od', 'thumb-horizontal');
                await t.call('plainStyle', 'od', '#c { width: 10px; }');
                await t.frames(8);
                expect(await made('thumb-horizontal'), 'the thumb of a bar that went away is not kept');
                await t.call('plainStyle', 'od', '#c { width: 3000px; }');
                await t.frames(8);
                expect((await t.call<string>('identity', 'od', 'thumb-horizontal')) === before, 'the thumb is made again when its bar comes back');
                expect(text(await count()) === text(both), 'parts were made again');

                // A kind the look hides is not made; it is made the first time the look shows it, and kept.
                await t.call('setAttr', 'od', 'hide', 'marker button');
                await t.frames(6);
                const kept = await count();
                expect(kept.marker === 2 && kept.button === 4, `parts that were made are kept when the look hides them: ${JSON.stringify(kept)}`);
                expect((await t.call('display', 'od', 'button-end-vertical')) === 'none', 'a hidden button is displayed');
                await t.call('plainRemove', 'od');
                await t.call('plainMake', 'od', '', { ...attrs, hide: 'marker button card' }, html);
                await t.frames(8);
                const bare = await count();
                expect(text(bare) === text({ thumb: 1, track: 1, 'track-piece': 2 }), `a view that hides markers and buttons made ${JSON.stringify(bare)}`);
                await t.call('setAttr', 'od', 'hide', 'card');
                await t.frames(8);
                const shown = await count();
                expect(text(shown) === text({ thumb: 1, button: 2, track: 1, 'track-piece': 2, marker: 2 }), `the buttons and the markers are not made when the look first shows them: ${JSON.stringify(shown)}`);

                // A card is made when the first one opens, and kept.
                await t.call('setAttr', 'od', 'hide', null);
                await t.frames(4);
                expect(!(await made('card')), 'a card is made before a marker was hovered');
                const mc = centre(await t.box('od', 'marker:A'));
                await t.page.mouse.move(mc.x, mc.y);
                await t.sleep(700);
                expect((await t.call('openCard', 'od')) === 'A', `the card shows "${await t.call('openCard', 'od')}"`);
                expect((await count()).card === 1, `the first card opened made ${(await count()).card} card elements, want one`);
                await t.park();
                await t.sleep(900);
                expect(await made('card'), 'the card is not kept after it closed');

                // The classes of a kit are used the same way: the part made later is the kit's.
                await t.call('plainRemove', 'od');
                await t.call('plainMake', 'od', '', { ...attrs, kit: 'b18' }, html);
                await t.frames(6);
                expect((await t.call('tagOf', 'od', 'thumb-vertical')) === 'AX-SCROLLBAR-B18-THUMB', `the thumb is ${await t.call('tagOf', 'od', 'thumb-vertical')}`);
                expect(!(await made('thumb-horizontal')), 'a kit thumb is made for a bar that does not show');
                await t.call('plainStyle', 'od', '#c { width: 3000px; }');
                await t.frames(8);
                expect((await t.call('tagOf', 'od', 'thumb-horizontal')) === 'AX-SCROLLBAR-B18-THUMB', `the thumb made later is ${await t.call('tagOf', 'od', 'thumb-horizontal')}`);
                expect((await t.call('tagOf', 'od', 'button-end-horizontal')) === 'AX-SCROLLBAR-BUTTON', 'a kind the kit leaves out is not the default class');
            } finally {
                await t.call('plainRemove', 'od');
                await t.park();
            }
        },
    },
    {
        name: 'mount forces no style or layout: the first frame waits for the resize observer and reads a page that is laid out already',
        run: async (t) => {
            const html = '<div id="c" style="height: 3000px; width: 3000px"><h2 id="A" style="margin: 0">A</h2><h2 id="B" style="margin: 900px 0 0">B</h2></div>';
            const cdp = await t.page.context().newCDPSession(t.page);
            const events: { name: string; args?: { beginData?: { stackTrace?: { functionName: string }[] } } }[] = [];
            cdp.on('Tracing.dataCollected', (e: { value: typeof events }) => events.push(...e.value));
            const done = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
            // The page's own scrollbar follows every change of the document, in the frame of the change (it was
            // connected long ago, and reads what the change made dirty): it is out of the page while the view mounts.
            await t.call('detachPage');
            await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack'] } });
            try {
                // Both bars, markers and a corner: the whole of what a view makes.
                await t.call('plainMake', 'fl', '', { 'marker-selector': 'h2', indicator: 'pinned' }, html);
                await t.frames(8);
            } finally {
                await cdp.send('Tracing.end');
                await done;
                await cdp.detach();
                await t.call('attachPage');
            }
            // The package's reads of layout: a style or layout run that one of them forced shows it in its stack.
            const reads = new Set(['readLayout', 'client', 'size', 'rtl', 'refreshDirection', 'viewport', 'contentOffset', 'position', 'trackLength', 'thickness', 'minThumb', 'measure', 'readCard', 'barRect', 'along']);
            const forced = events.filter((e) => (e.name === 'Layout' || e.name === 'UpdateLayoutTree') && (e.args?.beginData?.stackTrace || []).some((f) => reads.has(f.functionName)));
            try {
                expect(forced.length === 0, `${forced.length} style or layout runs were forced by the scrollbar's reads while it mounted: ${forced.map((e) => (e.args?.beginData?.stackTrace || []).slice(0, 4).map((f) => f.functionName).join(' < ')).join(' | ')}`);
                // And it did its work: the bars are laid out and drawn.
                expect(JSON.stringify(Object.entries(await t.call<Record<string, number>>('madeCount', 'fl')).sort()) === JSON.stringify(Object.entries({ thumb: 2, button: 4, track: 2, 'track-piece': 4, corner: 1, marker: 2 }).sort()), 'the view did not make its parts');
                const thumb = await t.box('fl', 'thumb-vertical');
                expect(thumb.height > 0, 'the thumb is not drawn');
            } finally {
                await t.call('plainRemove', 'fl');
                await t.park();
            }
        },
    },
    {
        name: 'cascade: an outer ::part(thumb) rule replaces the default value in every state; the states that should differ are written again',
        run: async (t) => {
            await t.reset();
            await t.call('setStyle', 'surf', '--ax-scrollbar-state-smoothing', '0s');
            const colour = () => t.call<string>('look', 'surf', 'thumb-vertical', '--ax-scrollbar-shown-color');
            try {
                const thumb = centre(await t.box('surf', 'thumb-vertical'));
                await t.page.mouse.move(thumb.x, thumb.y);
                await t.frames(4);
                expect((await colour()).startsWith('rgba(218, 218, 218'), `the default hovered thumb is ${await colour()}, want #dadada`);
                await t.call('addStyle', 'cascade', '#surf::part(thumb) { --ax-scrollbar-part-color: rgb(255, 0, 0); }');
                await t.frames(4);
                expect((await colour()).startsWith('rgba(255, 0, 0'), `a rule on ::part(thumb) leaves the hover colour of the default: ${await colour()}`);
                await t.call('addStyle', 'cascade', '#surf::part(thumb) { --ax-scrollbar-part-color: rgb(255, 0, 0); } #surf::part(thumb-hover) { --ax-scrollbar-part-color: rgb(0, 0, 255); }');
                await t.frames(4);
                expect((await colour()).startsWith('rgba(0, 0, 255'), `a rule on ::part(thumb-hover) written again does not win: ${await colour()}`);
            } finally {
                await t.call('addStyle', 'cascade', '');
                await t.call('setStyle', 'surf', '--ax-scrollbar-state-smoothing', '');
                await t.park();
            }
        },
    },
    {
        name: 'card content: the fitted width is a custom property, so ::part(card-content) can override it',
        run: async (t) => {
            await t.reset();
            const width = () => t.call<string>('computed', 'v', 'card-content', 'width').then((v) => v.trim());
            const mc = centre(await t.box('v', 'marker:m500'));
            try {
                await t.page.mouse.move(mc.x, mc.y);
                await t.sleep(400);
                expect((await t.call('openCard', 'v')) === 'Section 500', 'the card did not open');
                const fitted = await width();
                expect(fitted !== '' && fitted !== 'auto' && parseFloat(fitted) > 0, `fitted width ${fitted}`);
                await t.call('addStyle', 'fit', 'ax-scroll-view::part(card-content) { width: 500px; }');
                await t.frames(3);
                expect((await width()) === '500px', `::part(card-content) width: 500px gives ${await width()}`);
            } finally {
                await t.call('addStyle', 'fit', '');
                await t.park();
            }
        },
    },
    {
        name: 'touch: indicator (the default) takes no touch input; bar lets a finger on the bar drag',
        run: async (t) => {
            const u = await t.touch();
            await u.reset();
            await u.call('setScroll', 'v', 0);
            const drag = async () => {
                const bar = await u.box('v', 'scrollbar-vertical');
                const thumb = centre(await u.box('v', 'thumb-vertical'));
                await u.start(thumb.x, thumb.y);
                for (let i = 1; i <= 8; i++) await u.move(thumb.x, thumb.y + i * 10);
                await u.end();
                await u.settle();
                void bar;
                return (await u.call('scrollOf', 'v')).host as number;
            };
            // The default: no attribute, so the panning indicator takes no touch input.
            const passive = await drag();
            expect(passive === 0, `with touch="indicator" a finger on the thumb scrolled to ${passive}`);
            try {
                await u.call('setAttr', 'v', 'touch', 'bar');
                await u.call('setScroll', 'v', 0);
                await u.settle();
                const active = await drag();
                expect(active > 0, 'with touch="bar" a finger on the thumb did not drag');
            } finally {
                await u.call('setAttr', 'v', 'touch', null);
                await u.call('setScroll', 'v', 0);
            }
        },
    },
    {
        name: 'Minimal (demo/minimal.css, the default parts styled with ::part()): the thin bar, its dots, and the card',
        run: async (t) => {
            const css = await t.call<string>('minimalCss');
            const html = '<div style="height: 4000px"><h2 id="a" style="margin: 2000px 0 0">Alpha</h2></div>';
            await t.call('plainMake', 'mn', css, { class: 'minimal', hide: 'button', 'marker-selector': 'h2', 'marker-align': 'center', horizontal: 'hidden' }, html);
            const look = (name: string, property: string) => t.call<string>('look', 'mn', name, property);
            const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
            const colour = (got: string, want: number[], what: string) => {
                const g = parse(got);
                expect(g.length === 4 && want.every((n, i) => Math.abs(g[i] - n) <= (i === 3 ? 0.003 : 0.5)), `${what}: ${got}, want ${want.join(', ')}`);
            };
            try {
                const host = await t.box('mn', 'host');
                await t.page.mouse.move(host.left + 100, host.top + 100);
                await t.sleep(900);
                const bar = await t.box('mn', 'scrollbar-vertical');
                near(bar.width, 14, 0.01, 'bar thickness');
                near((await t.box('mn', 'area-vertical')).left - bar.left, 2, 0.01, 'bar padding');
                near((await t.box('mn', 'thumb-vertical')).height, 32, 0.01, 'thumb minimum length');
                // A kind the look leaves out is never made, so it is neither displayed nor in the page.
                expect(!(await t.call<boolean>('made', 'mn', 'button-end-vertical')) && !(await t.call<boolean>('made', 'mn', 'button-start-vertical')), 'hide="button": the buttons are made');
                expect(await t.call<boolean>('made', 'mn', 'thumb-vertical'), 'the thumb of the bar that shows is not made');
                near((await t.box('mn', 'thumb-vertical')).width, 4, 0.01, 'thumb width at rest');
                colour(await look('thumb-vertical', '--ax-scrollbar-shown-color'), [0, 0, 0, 0.4], 'thumb at rest');
                colour(await look('thumb-vertical', '--ax-scrollbar-shown-border-color'), [0, 0, 0, 0], 'thumb border');
                expect((await t.call<string>('computed', 'mn', 'thumb-vertical', '--ax-radius')).trim() === '50%', 'the thumb is not a capsule');
                expect((await t.call<string>('computed', 'mn', 'thumb-vertical', '--ax-scrollbar-part-fill-clip')).trim() === 'border-box', 'the thumb fill clip is not the border box');
                const dot = await t.box('mn', 'marker:a');
                near(dot.width, 4, 0.01, 'marker width');
                near(dot.height, 4, 0.01, 'a marker is a dot');
                const tc = centre(await t.box('mn', 'thumb-vertical'));
                await t.page.mouse.move(tc.x, tc.y);
                await t.sleep(700);
                near((await t.box('mn', 'thumb-vertical')).width, 10, 0.05, 'thumb width under the pointer');
                colour(await look('thumb-vertical', '--ax-scrollbar-shown-color'), [0, 0, 0, 0.6], 'thumb hovered');
                const mc = centre(await t.box('mn', 'marker:a'));
                await t.page.mouse.move(mc.x, mc.y);
                await t.sleep(700);
                expect((await t.call('openCard', 'mn')) === 'Alpha', `the card shows "${await t.call('openCard', 'mn')}"`);
                const card = (property: string) => t.call<string>('computed', 'mn', 'card-open', property).then((v) => v.trim());
                expect((await card('--ax-fill-color')) === 'rgb(255, 255, 255)', `card fill ${await card('--ax-fill-color')}`);
                expect((await card('--elevation-depth')) === '8', `card elevation ${await card('--elevation-depth')}`);
                expect((await card('--ax-radius')) === '4px', `card radius ${await card('--ax-radius')}`);
                expect((await card('--ax-border-width')) === '0px', `card border ${await card('--ax-border-width')}`);
                const pad = [await card('padding-top'), await card('padding-right')].join(' ');
                expect(pad === '6px 10px' && (await card('max-width')) === '240px', `card padding ${pad}, max width ${await card('max-width')}`);
                expect((await card('transition-duration')).startsWith('0.15s'), `card fade ${await card('transition-duration')}`);
            } finally {
                await t.call('plainRemove', 'mn');
                await t.park();
            }
        },
    },
    {
        name: 'Minimal scales with --ax-scrollbar-thickness: bar, padding, minimum thumb, thumb at rest and engaged, and dots are the 14px numbers times thickness / 14',
        run: async (t) => {
            const css = await t.call<string>('minimalCss');
            const html = '<div style="height: 4000px"><h2 id="a" style="margin: 2000px 0 0">Alpha</h2></div>';
            await t.call('plainMake', 'mn', css, { class: 'minimal', hide: 'button', 'marker-selector': 'h2', 'marker-align': 'center', horizontal: 'hidden' }, html);
            try {
                for (const thickness of [8, 14, 24]) {
                    const k = thickness / 14;
                    await t.call('setStyle', 'mn', '--ax-scrollbar-thickness', `${thickness}px`);
                    await t.page.mouse.move(0, 0);
                    await t.sleep(900);
                    const host = await t.box('mn', 'host');
                    await t.page.mouse.move(host.left + 100, host.top + 100);
                    await t.sleep(700);
                    const bar = await t.box('mn', 'scrollbar-vertical');
                    near(bar.width, thickness, 0.01, `${thickness}px: bar thickness`);
                    near((await t.box('mn', 'area-vertical')).left - bar.left, 2 * k, 0.01, `${thickness}px: bar padding`);
                    near((await t.box('mn', 'thumb-vertical')).height, 32 * k, 0.01, `${thickness}px: thumb minimum length`);
                    near((await t.box('mn', 'thumb-vertical')).width, 4 * k, 0.05, `${thickness}px: thumb width at rest`);
                    near((await t.box('mn', 'marker:a')).width, 4 * k, 0.05, `${thickness}px: marker width`);
                    const tc = centre(await t.box('mn', 'thumb-vertical'));
                    await t.page.mouse.move(tc.x, tc.y);
                    await t.sleep(700);
                    near((await t.box('mn', 'thumb-vertical')).width, 10 * k, 0.05, `${thickness}px: thumb width under the pointer`);
                }
            } finally {
                await t.call('plainRemove', 'mn');
                await t.park();
            }
        },
    },
    {
        name: 'Windows 8 (the default look): bar, buttons, thumb, track, arrows and markers',
        run: async (t) => {
            const css = '';
            const html = '<div style="height: 4000px"><h2 id="a" style="margin: 2000px 0 0">Alpha</h2><h2 id="b" style="margin: 1500px 0 0">Beta</h2></div>';
            const attrs = { 'marker-selector': 'h2', 'marker-align': 'center', horizontal: 'hidden' };
            await t.call('plainMake', 'w8', css, attrs, html);
            const look = (name: string, property: string) => t.call<string>('look', 'w8', name, property);
            try {
                const host = await t.box('w8', 'host');
                await t.page.mouse.move(host.left + 100, host.top + 100);
                // The fade in is 250ms and linear.
                await t.sleep(500);
                const bar = await t.box('w8', 'scrollbar-vertical');
                const area = await t.box('w8', 'area-vertical');
                const thumb = await t.box('w8', 'thumb-vertical');
                const end = await t.box('w8', 'button-end-vertical');
                near(bar.width, 17, 0.01, 'bar thickness');
                near(area.left - bar.left, 0, 0.01, 'bar padding');
                near(end.width, 17, 0.01, 'button width across the bar');
                near(end.height, 33, 0.01, 'button length along the bar');
                near(thumb.height, 48, 0.01, 'thumb minimum length');
                near(thumb.width, 17, 0.01, 'thumb thickness at rest');
                near(thumb.left, bar.left, 0.01, 'the thumb fills the bar across');
                const borderWidth = await t.call<string>('computed', 'w8', 'thumb-vertical', '--ax-border-width');
                expect(borderWidth.trim() === '1px', `thumb border width ${borderWidth}`);
                const clip = await t.call<string>('computed', 'w8', 'thumb-vertical', '--ax-scrollbar-part-fill-clip');
                expect(clip.trim() === 'padding-box', `fill clip ${clip}`);
                expect((await t.call<string>('computed', 'w8', 'thumb-vertical', '--ax-radius')).trim() === '0px', 'the thumb is not square');
                expect(+(await look('track-vertical', '--ax-scrollbar-shown-opacity')) === 1, 'the bar is not fully shown after the fade in');

                const colours = async (name: string) => [await look(name, '--ax-scrollbar-shown-color'), await look(name, '--ax-scrollbar-shown-border-color'), await look(name, '--ax-scrollbar-shown-glyph-color')];
                // Alpha is written to 4 digits of a value that was an 8-bit alpha in the style sheet:
                // compare it to the 8-bit step.
                const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
                const sameColor = (a: string, b: string) => {
                    const x = parse(a);
                    const y = parse(b);
                    return x.length === 4 && y.length === 4 && x.every((n, i) => Math.abs(n - y[i]) <= (i === 3 ? 0.003 : 0.5));
                };
                const want = (got: string[], expected: (string | null)[], what: string) =>
                    expect(expected.every((e, i) => e === null || sameColor(got[i], e)), `${what}: ${got.join(' | ')}, want ${expected.join(' | ')}`);
                want(await colours('track-vertical'), ['rgba(213, 213, 213, 0.349)'], 'track');
                want(await colours('thumb-vertical'), ['rgba(205, 205, 205, 1)', 'rgba(85, 85, 85, 0.231)'], 'thumb at rest');
                want(await colours('button-end-vertical'), ['rgba(213, 213, 213, 0.349)', null, 'rgba(0, 0, 0, 0.6)'], 'button at rest');

                const tc = centre(thumb);
                await t.page.mouse.move(tc.x, tc.y);
                await t.frames(3);
                want(await colours('thumb-vertical'), ['rgba(218, 218, 218, 1)', 'rgba(183, 183, 183, 0.42)'], 'thumb hovered (instant)');
                await t.page.mouse.down();
                await t.frames(3);
                want(await colours('thumb-vertical'), ['rgba(0, 0, 0, 0.6)', 'rgba(85, 85, 85, 0.929)'], 'thumb pressed (instant)');
                await t.page.mouse.up();
                near((await t.box('w8', 'thumb-vertical')).width, 17, 0.01, 'thumb thickness pressed');

                // The arrow of the end button: a 10.944 x 9.673 chevron, 7px from the button's edge on the track.
                const points = (await t.call<string>('inner', 'w8', 'button-end-vertical', '.layer-scrollbar-glyph polygon', 'points'))
                    .split(' ')
                    .map((p) => p.split(',').map(Number));
                const xs = points.map((p) => p[0]);
                const ys = points.map((p) => p[1]);
                near(Math.min(...xs), (17 - 10.944) / 2, 0.01, 'arrow left');
                near(Math.max(...xs) - Math.min(...xs), 10.944, 0.01, 'arrow width');
                near(Math.min(...ys), 7, 0.01, 'arrow top: 7px below the button start');
                near(Math.max(...ys) - Math.min(...ys), 9.673, 0.01, 'arrow height');
                const bc = centre(await t.box('w8', 'button-end-vertical'));
                await t.page.mouse.move(bc.x, bc.y);
                await t.frames(3);
                want(await colours('button-end-vertical'), ['rgba(218, 218, 218, 1)', null, 'rgba(0, 0, 0, 1)'], 'button hovered');
                await t.page.mouse.down();
                await t.frames(3);
                want(await colours('button-end-vertical'), ['rgba(0, 0, 0, 0.6)', null, 'rgba(255, 255, 255, 1)'], 'button pressed');
                await t.page.mouse.up();
                await t.park();
                await t.call('setScroll', 'w8', 0);
                await t.settle();

                // Markers: 9 x 2 ticks, a light grey at rest, darker when current, darkest hovered; white on the thumb.
                const m = await t.box('w8', 'marker:b');
                near(m.width, 9, 0.01, 'marker width');
                near(m.height, 2, 0.01, 'marker thickness');
                await t.page.mouse.move(host.left + 100, host.top + 100);
                await t.frames(3);
                want([await look('marker:b', '--ax-scrollbar-shown-color')], ['rgba(156, 156, 156, 1)'], 'marker at rest');
                await t.call('setScroll', 'w8', 2000);
                await t.settle();
                const ta = await t.tokens('w8', 'marker:a');
                expect(has(ta, 'marker-on-thumb') && has(ta, 'marker-current'), `precondition: marker a tokens ${ta.join(' ')}`);
                want([await look('marker:a', '--ax-scrollbar-shown-color')], ['rgba(255, 255, 255, 1)'], 'marker on the thumb and current (white; the size says current)');
                near((await t.box('w8', 'marker:a')).width, 13, 0.01, 'current marker width');
                const mc = centre(await t.box('w8', 'marker:a'));
                await t.page.mouse.move(mc.x, mc.y);
                await t.frames(3);
                want([await look('marker:a', '--ax-scrollbar-shown-color')], ['rgba(255, 255, 255, 1)'], 'marker on the thumb and hovered');
                near((await t.box('w8', 'marker:a')).width, 17, 0.01, 'hovered marker width (edge to edge)');
            } finally {
                await t.page.mouse.up().catch(() => {});
                await t.call('plainRemove', 'w8');
                await t.park();
            }
        },
    },
    {
        name: 'Cyber Punk (demo/cyberpunk.css, the default parts styled with ::part()): bevel shape on every part, diamond markers',
        run: async (t) => {
            const css = await t.call<string>('cyberpunkCss');
            const html = '<div style="height: 4000px"><h2 id="a" style="margin: 2000px 0 0">Alpha</h2><h2 id="b" style="margin: 1500px 0 0">Beta</h2></div>';
            const attrs = { class: 'cyber', hide: '', 'marker-selector': 'h2', 'marker-align': 'center', horizontal: 'hidden' };
            await t.call('plainMake', 'cy', css, attrs, html);
            try {
                const host = await t.box('cy', 'host');
                await t.page.mouse.move(host.left + 100, host.top + 100);
                await t.sleep(600);
                // Default parts: no kit, so the default classes.
                expect((await t.call('tagOf', 'cy', 'thumb-vertical')) === 'AX-SCROLLBAR-THUMB', 'the thumb is not the default class');
                expect((await t.call('tagOf', 'cy', 'button-end-vertical')) === 'AX-SCROLLBAR-BUTTON', 'the button is not the default class');
                expect((await t.call('tagOf', 'cy', 'marker:b')) === 'AX-SCROLLBAR-MARKER', `the marker is ${await t.call('tagOf', 'cy', 'marker:b')}`);
                // The bevel is in effect on each part, and is not the surface's own property (a token of the host).
                for (const name of ['thumb-vertical', 'button-end-vertical', 'track-vertical', 'marker:b']) {
                    const shape = (await t.call<string>('computed', 'cy', name, '--ax-corner-shape')).trim();
                    expect(shape === 'bevel', `${name}: --ax-corner-shape is "${shape}", want bevel`);
                }
                // The outline of the fill is a cut rectangle: no arc commands, and more than 4 vertices, with a diagonal.
                const outline = (name: string) => t.call<string>('inner', 'cy', name, '.layer-scrollbar-fill svg > path', 'd');
                const points = (d: string) => (d.match(/-?\d*\.?\d+/g) || []).map(Number).reduce<number[][]>((acc, n, i) => (i % 2 ? (acc[acc.length - 1].push(n), acc) : (acc.push([n]), acc)), []).filter((p, i, all) => i === 0 || p[0] !== all[0][0] || p[1] !== all[0][1]);
                // Only the top-left and bottom-right corners are cut (the per-corner radius tokens square the
                // others): six vertices, two diagonal edges, and the square corners are vertices of the outline.
                for (const name of ['thumb-vertical', 'button-end-vertical', 'track-vertical']) {
                    const d = await outline(name);
                    expect(!/[AaCcQq]/.test(d), `${name}: the outline has curves: ${d}`);
                    const pts = points(d);
                    expect(pts.length === 6, `${name}: ${pts.length} vertices in ${d}, want 6`);
                    const diagonals = pts.filter((p, i) => p[0] !== pts[(i + 1) % pts.length][0] && p[1] !== pts[(i + 1) % pts.length][1]);
                    expect(diagonals.length === 2, `${name}: ${diagonals.length} diagonal edges, want 2`);
                    const xs = pts.map((p) => p[0]);
                    const ys = pts.map((p) => p[1]);
                    const has = (x: number, y: number) => pts.some((p) => Math.abs(p[0] - x) < 0.01 && Math.abs(p[1] - y) < 0.01);
                    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
                    expect(has(x1, y0) && has(x0, y1), `${name}: the top-right and bottom-left corners are not square: ${d}`);
                    expect(!has(x0, y0) && !has(x1, y1), `${name}: the top-left and bottom-right corners are not cut: ${d}`);
                }
                // The marker: a square turned on its corner. Size and thickness are equal, and the outline has the
                // four midpoints of the sides as its only vertices.
                const m = await t.box('cy', 'marker:b');
                near(m.width, 7, 0.01, 'marker width');
                near(m.height, m.width, 0.01, 'marker thickness equals its size');
                const d = await outline('marker:b');
                const pts = points(d);
                expect(pts.length === 4, `marker: ${pts.length} vertices in ${d}, want 4 (a diamond)`);
                const xs = pts.map((p) => p[0]);
                const ys = pts.map((p) => p[1]);
                const w = Math.max(...xs) - Math.min(...xs);
                const h = Math.max(...ys) - Math.min(...ys);
                near(w, 7, 0.01, 'diamond width');
                near(h, 7, 0.01, 'diamond height');
                const cx = Math.min(...xs) + w / 2;
                const cy = Math.min(...ys) + h / 2;
                expect(pts.every((p) => (Math.abs(p[0] - cx) < 0.01 && Math.abs(Math.abs(p[1] - cy) - 3.5) < 0.01) || (Math.abs(p[1] - cy) < 0.01 && Math.abs(Math.abs(p[0] - cx) - 3.5) < 0.01)), `marker is not a true diamond: ${d}`);
                // Hovered: bigger and still a diamond (thickness follows the size).
                const mc = centre(m);
                await t.page.mouse.move(mc.x, mc.y);
                await t.sleep(500);
                const hm = await t.box('cy', 'marker:b');
                near(hm.width, 10, 0.3, 'hovered marker width');
                near(hm.height, hm.width, 0.3, 'hovered marker stays square');
                expect(points(await outline('marker:b')).length === 4, 'the hovered marker is not a diamond');
            } finally {
                await t.page.mouse.move(0, 0);
                await t.call('plainRemove', 'cy');
                await t.park();
            }
        },
    },
    {
        name: 'Windows 8 (the default look): the card (ToolTip), and the touch indicator that hides the track and the buttons',
        run: async (t) => {
            const css = '';
            const html = '<div style="height: 4000px"><h2 id="a" style="margin: 2000px 0 0">Alpha</h2><h2 id="b" style="margin: 1500px 0 0">Beta</h2></div>';
            const attrs = { 'marker-selector': 'h2', 'marker-align': 'center', horizontal: 'hidden' };
            await t.call('plainMake', 'w8c', css, attrs, html);
            try {
                const host = await t.box('w8c', 'host');
                await t.page.mouse.move(host.left + 100, host.top + 100);
                await t.sleep(400);
                const mc = centre(await t.box('w8c', 'marker:b'));
                await t.page.mouse.move(mc.x, mc.y);
                // card-delay 400ms.
                await t.sleep(250);
                expect((await t.call('openCard', 'w8c')) === '', 'the card opened before --ax-scrollbar-card-delay (400ms)');
                await t.sleep(600);
                expect((await t.call('openCard', 'w8c')) === 'Beta', `the card shows "${await t.call('openCard', 'w8c')}"`);
                const card = (property: string) => t.call<string>('computed', 'w8c', 'card-open', property).then((v) => v.trim());
                const content = (property: string) => t.call<string>('computed', 'w8c', 'card-content', property);
                expect((await card('--ax-fill-color')) === 'rgb(255, 255, 255)', `card fill ${await card('--ax-fill-color')}`);
                expect((await card('--ax-border-color')) === 'rgb(128, 128, 128)', `card border ${await card('--ax-border-color')}`);
                const cardPad = [await card('padding-top'), await card('padding-right'), await card('padding-bottom')].join(' ');
                expect(cardPad === '8px 12px 9px', `card padding (XAML 6 10 7 plus the 2px border) ${cardPad}`);
                expect((await card('color')) === 'rgb(102, 102, 102)', `card text ${await card('color')}`);
                expect((await card('font-size')) === '12px', `card font size ${await card('font-size')}`);
                expect((await card('font-family')).startsWith('"Segoe UI"'), `card font ${await card('font-family')}`);
                expect((await card('max-width')) === '320px', `card max width ${await card('max-width')}`);
                expect((await card('--ax-radius')) === '0px', `card radius ${await card('--ax-radius')}`);
                // No shadow: the elevation of the card is 0 (--elevation-depth on ::part(card)), and no CSS shadow or filter.
                expect((await card('--elevation-depth')) === '0', `the card has an elevation: ${await card('--elevation-depth')}`);
                expect((await card('box-shadow')) === 'none' && (await card('filter')) === 'none', `the card has a CSS shadow: ${await card('box-shadow')} ${await card('filter')}`);
            } finally {
                await t.call('plainRemove', 'w8c');
                await t.park();
            }
            // Touch: the panning indicator.
            const u = await t.touch();
            await u.call('plainMake', 'w8t', css, attrs, html);
            try {
                const host = await u.box('w8t', 'host');
                const x = host.left + 100;
                const y = host.top + 180;
                await u.start(x, y);
                for (let i = 1; i <= 6; i++) await u.move(x, y - i * 12);
                await u.end();
                await u.frames(4);
                expect((await u.call('hostAttr', 'w8t', 'indicator-state')) === 'touch', `indicator ${await u.call('hostAttr', 'w8t', 'indicator-state')}`);
                const look = (name: string, property: string) => u.call<string>('look', 'w8t', name, property);
                expect((await u.call('display', 'w8t', 'button-end-vertical')) === 'none', 'touch: the buttons are displayed');
                expect((await u.call('display', 'w8t', 'track-vertical')) === 'none', 'touch: the track is displayed');
                const thumb = await u.box('w8t', 'thumb-vertical');
                const bar = await u.box('w8t', 'scrollbar-vertical');
                near(thumb.width, 4, 0.01, 'touch: the thumb is 4px across');
                near(thumb.left - bar.left, 6.5, 0.01, 'touch: the thumb is centred in the 17px column');
                expect((await look('thumb-vertical', '--ax-scrollbar-shown-color')) === 'rgba(205, 205, 205, 1)', 'touch: thumb colour');
                expect((await look('thumb-vertical', '--ax-scrollbar-shown-border-color')) === 'rgba(154, 154, 154, 0.49)', 'touch: thumb border');
                const minLength = await u.call<string>('computed', 'w8t', 'thumb-vertical', 'min-height');
                expect(minLength === '17px', `touch: thumb minimum length ${minLength}`);
                const tick = await u.box('w8t', 'marker:b');
                near(tick.width, 4, 0.01, 'touch: marker width');
                near(tick.height, 1, 0.01, 'touch: marker thickness');
            } finally {
                await u.call('plainRemove', 'w8t');
            }
        },
    },
    {
        name: 'engaged: thumb hover, marker hover, drag and the hot zone engage the bar; idle and scrolling look the same; the opacity is native',
        run: async (t) => {
            const css = `ax-scroll-view { --ax-scrollbar-state-smoothing: 0s; --ax-scrollbar-fade-smoothing: 0s; --ax-scrollbar-fade-in-duration: 0s; --ax-scrollbar-fade-out-duration: 0s; --ax-scrollbar-hotzone: 0px; --ax-scrollbar-idle-delay: 60s;
                }
                ax-scroll-view::part(marker) { --ax-scrollbar-part-color: rgb(255, 0, 0); --ax-scrollbar-part-opacity: 0.3; }
                ax-scroll-view::part(marker-engaged) { --ax-scrollbar-part-color: rgb(0, 0, 255); --ax-scrollbar-part-opacity: 1; }`;
            const html = '<div style="height: 3000px"><h2 id="A" style="margin: 0">A</h2><h2 id="B" style="margin: 900px 0 0">B</h2><h2 id="C" style="margin: 900px 0 0">C</h2></div>';
            await t.call('plainMake', 'eg', css, { hide: '', 'marker-selector': 'h2', 'marker-align': 'start', horizontal: 'hidden' }, html);
            try {
                await t.frames(4);
                // The bar is hidden at first and draws nothing; the delay to hide it again is 60s.
                await t.call('wake', 'eg');
                await t.frames(4);
                const alpha = async (id: string) => +(await t.call<string>('look', 'eg', `marker:${id}`, '--ax-scrollbar-shown-alpha'));
                const color = (id: string) => t.call<string>('look', 'eg', `marker:${id}`, '--ax-scrollbar-shown-color');
                const engaged = async () => ({
                    bar: await t.call<boolean>('barAttr', 'eg', 'vertical', 'engaged'),
                    marker: (await t.call<string | null>('partAttr', 'eg', 'marker:C', 'engaged')) !== null,
                    host: (await t.call<string>('hostAttr', 'eg', 'vertical-state')).split(' ').includes('engaged'),
                    token: has(await t.tokens('eg', 'marker:C'), 'marker-engaged'),
                });
                const idle = async (what: string) => {
                    const e = await engaged();
                    expect(!e.bar && !e.marker && !e.host && !e.token, `${what}: engaged ${JSON.stringify(e)}`);
                    expect((await color('C')) === 'rgba(255, 0, 0, 1)' && near2(await alpha('C'), 0.3), `${what}: marker ${await color('C')} alpha ${await alpha('C')}`);
                };
                const near2 = (a: number, b: number) => Math.abs(a - b) < 0.001;
                const on = async (what: string) => {
                    const e = await engaged();
                    expect(e.bar && e.marker && e.host && e.token, `${what}: not engaged ${JSON.stringify(e)}`);
                    expect((await color('C')) === 'rgba(0, 0, 255, 1)' && near2(await alpha('C'), 1), `${what}: marker ${await color('C')} alpha ${await alpha('C')}`);
                };
                await idle('at rest');
                // Native opacity of the marker: the alpha, times the fade of the bar (1: shown).
                await t.call('setScroll', 'eg', 300);
                await t.settle();
                await idle('scrolling');
                const opacity = +(await t.call<string>('computed', 'eg', 'marker:C', 'opacity'));
                near(opacity, 0.3, 0.001, 'the CSS opacity of an idle marker');

                // The pointer over the bar but not the thumb (no hot zone): not engaged.
                const thumb = await t.box('eg', 'thumb-vertical');
                const bar = await t.box('eg', 'scrollbar-vertical');
                await t.page.mouse.move(bar.left + bar.width / 2, bar.bottom - 20);
                await t.frames(4);
                await idle('over the track');

                // Thumb hovered.
                await t.page.mouse.move(...(Object.values(centre(thumb)) as [number, number]));
                await t.frames(4);
                await on('thumb hovered');
                near(+(await t.call<string>('computed', 'eg', 'marker:C', 'opacity')), 1, 0.001, 'the CSS opacity of an engaged marker');
                await t.page.mouse.move(bar.left + bar.width / 2, bar.bottom - 20);
                await t.frames(4);
                await idle('thumb left');

                // A marker hovered: marker B is below the thumb, on the track.
                const mc = centre(await t.box('eg', 'marker:B'));
                await t.page.mouse.move(mc.x, mc.y);
                await t.frames(4);
                await on('marker hovered');
                await t.page.mouse.move(5, 235);
                await t.frames(4);
                await idle('marker left');

                // Dragging: engaged while the pointer is far from the bar.
                const th = centre(await t.box('eg', 'thumb-vertical'));
                await t.page.mouse.move(th.x, th.y);
                await t.page.mouse.down();
                await t.page.mouse.move(100, th.y + 20, { steps: 4 });
                await t.frames(4);
                await on('dragging, pointer away from the bar');
                await t.page.mouse.up();
                await t.park();
                await t.frames(4);
                await idle('drag over');

                // The hot zone: 200% of the bar's thickness.
                await t.call('setStyle', 'eg', '--ax-scrollbar-hotzone', '200%');
                await t.page.mouse.move(bar.left - 8, bar.bottom - 20);
                await t.frames(4);
                await on('in the hot zone');
                await t.page.mouse.move(bar.left - 60, bar.bottom - 20);
                await t.frames(4);
                await idle('out of the hot zone');
            } finally {
                await t.page.mouse.up().catch(() => {});
                await t.call('plainRemove', 'eg');
                await t.park();
            }
        },
    },
    {
        name: 'a pressed marker is styled with ::part(marker-pressed) and has the part names marker-pressed and marker-hover, and the pressed attribute; marker-active is gone',
        run: async (t) => {
            const css = `ax-scroll-view { --ax-scrollbar-fade-smoothing: 0s; --ax-scrollbar-hotzone: 0px; --ax-scrollbar-idle-delay: 60s; --ax-scrollbar-state-smoothing: 0s;
                }
                ax-scroll-view::part(marker) { --ax-scrollbar-part-opacity: 0.2; }
                ax-scroll-view::part(marker-engaged) { --ax-scrollbar-part-opacity: 1; }
                ax-scroll-view::part(marker-hover) { --ax-scrollbar-part-color: rgb(1, 2, 3); }
                ax-scroll-view::part(marker-pressed) { --ax-scrollbar-part-color: rgb(9, 8, 7); --ax-scrollbar-part-size: 11px; }`;
            const html = '<div style="height: 3000px"><h2 id="A" style="margin: 0">A</h2><h2 id="B" style="margin: 900px 0 0">B</h2><h2 id="C" style="margin: 900px 0 0">C</h2></div>';
            await t.call('plainMake', 'pr', css, { hide: '', 'marker-selector': 'h2', 'marker-align': 'start', horizontal: 'hidden' }, html);
            try {
                await t.frames(4);
                await t.call('setScroll', 'pr', 300);
                await t.settle();
                const mc = centre(await t.box('pr', 'marker:C'));
                await t.page.mouse.move(mc.x, mc.y);
                await t.frames(3);
                expect((await t.call<string>('look', 'pr', 'marker:C', '--ax-scrollbar-shown-color')) === 'rgba(1, 2, 3, 1)', 'hovered marker colour');
                // Pressed: the pressed colour and size, the part names `marker-pressed`, never `marker-active`.
                await t.page.mouse.down();
                await t.frames(3);
                expect((await t.call<string>('look', 'pr', 'marker:C', '--ax-scrollbar-shown-color')) === 'rgba(9, 8, 7, 1)', `pressed marker colour ${await t.call<string>('look', 'pr', 'marker:C', '--ax-scrollbar-shown-color')}`);
                near((await t.box('pr', 'marker:C')).width, 11, 0.01, 'pressed marker size');
                const tokens = await t.tokens('pr', 'marker:C');
                expect(has(tokens, 'marker-pressed') && has(tokens, 'marker-hover') && !has(tokens, 'marker-active'), `tokens ${tokens.join(' ')}`);
                expect((await t.call<string | null>('partAttr', 'pr', 'marker:C', 'pressed')) !== null, 'the pressed attribute of the part');
                await t.page.mouse.up();
                await t.park();
                await t.frames(3);
                expect((await t.call<string | null>('partAttr', 'pr', 'marker:C', 'pressed')) === null, 'the pressed attribute stays after the release');

            } finally {
                await t.page.mouse.up().catch(() => {});
                await t.call('plainRemove', 'pr');
                await t.park();
            }
        },
    },
    {
        name: 'engaged: the marker opacity follows the state smoothing, not at once',
        run: async (t) => {
            const css = `ax-scroll-view { --ax-scrollbar-fade-smoothing: 0s; --ax-scrollbar-hotzone: 0px; --ax-scrollbar-idle-delay: 60s; --ax-scrollbar-state-smoothing: 300ms; }
                ax-scroll-view::part(marker) { --ax-scrollbar-part-opacity: 0.2; }
                ax-scroll-view::part(marker-engaged) { --ax-scrollbar-part-opacity: 1; }`;
            const html = '<div style="height: 3000px"><h2 id="A" style="margin: 0">A</h2><h2 id="B" style="margin: 900px 0 0">B</h2><h2 id="C" style="margin: 900px 0 0">C</h2></div>';
            await t.call('plainMake', 'sm', css, { hide: '', 'marker-selector': 'h2', 'marker-align': 'start', horizontal: 'hidden' }, html);
            try {
                await t.frames(4);
                await t.call('setScroll', 'sm', 300);
                await t.settle();
                await t.sleep(300);
                const th = centre(await t.box('sm', 'thumb-vertical'));
                const sampling = t.call<[number, string][]>('sample', 'sm', 'marker:B', '--ax-scrollbar-shown-alpha', 900);
                await t.page.mouse.move(th.x, th.y);
                const values = (await sampling).map((r) => +r[1]);
                expect(values.some((v) => v > 0.25 && v < 0.95), `no step between idle and engaged: ${values.slice(0, 14).join(' ')}`);
                near(values[values.length - 1], 1, 0.05, 'engaged alpha at the end (a time constant of 300ms: 96% after 900ms)');
                expect(near2(values[0], 0.2), `idle alpha ${values[0]}`);
            } finally {
                await t.call('plainRemove', 'sm');
                await t.park();
            }
            function near2(a: number, b: number): boolean {
                return Math.abs(a - b) < 0.01;
            }
        },
    },
    {
        name: 'part layers: thumb-layers, track-layers and the others reach the parts as `layers`; live, removed, unknown names',
        run: async (t) => {
            const html = '<div style="height: 3000px; width: 3000px"><h2 id="A" style="margin: 0">A</h2><h2 id="B" style="margin: 900px 0 0">B</h2></div>';
            const attrs = { hide: '', vertical: 'always', horizontal: 'always', 'marker-selector': 'h2', indicator: 'pinned', 'thumb-layers': 'scrollbar-fill test-a', 'track-layers': 'scrollbar-fill test-b' };
            await t.call('plainMake', 'ly', '', attrs, html);
            try {
                await t.frames(4);
                const layers = async (name: string) => {
                    const found: string[] = [];
                    for (const layer of ['scrollbar-fill', 'scrollbar-glyph', 'test-a', 'test-b', 'nope']) {
                        if ((await t.call<string>('inner', 'ly', name, `.layer-${layer}`, 'class')) !== '') found.push(layer);
                    }
                    return found.join(' ');
                };
                expect((await layers('thumb-vertical')) === 'scrollbar-fill test-a', `thumb layers: ${await layers('thumb-vertical')}`);
                expect((await layers('thumb-horizontal')) === 'scrollbar-fill test-a', 'the thumb of the other bar');
                expect((await layers('track-vertical')) === 'scrollbar-fill test-b', `track layers: ${await layers('track-vertical')}`);
                // The kinds without an attribute keep the layers of the default look (the button has the arrow too).
                expect((await layers('button-end-vertical')) === 'scrollbar-fill scrollbar-glyph', `button layers: ${await layers('button-end-vertical')}`);
                expect((await layers('track-piece-end-vertical')) === 'scrollbar-fill', 'track piece layers');
                expect((await t.call<string | null>('layersAttr', 'ly', 'thumb-vertical')) === 'scrollbar-fill test-a', 'the layers attribute of the part');
                expect((await t.call<string | null>('layersAttr', 'ly', 'button-end-vertical')) === null, 'a part without configuration has no layers attribute');

                // Live: the thumb's layers change, the others stay.
                await t.call('setAttr', 'ly', 'thumb-layers', 'test-b scrollbar-fill');
                await t.frames(4);
                expect((await layers('thumb-vertical')) === 'scrollbar-fill test-b', `thumb layers after the change: ${await layers('thumb-vertical')}`);
                expect((await layers('track-vertical')) === 'scrollbar-fill test-b', 'the track did not change');
                // Unknown names are left out, as Surface does, and nothing throws.
                await t.call('setAttr', 'ly', 'thumb-layers', 'scrollbar-fill nope test-a');
                await t.frames(4);
                expect((await layers('thumb-vertical')) === 'scrollbar-fill test-a', `unknown layer: ${await layers('thumb-vertical')}`);
                // Empty: no layers at all.
                await t.call('setAttr', 'ly', 'thumb-layers', '');
                await t.frames(4);
                expect((await layers('thumb-vertical')) === '', `empty layers: ${await layers('thumb-vertical')}`);
                // Removed: the default look's again.
                await t.call('setAttr', 'ly', 'thumb-layers', null);
                await t.frames(4);
                expect((await layers('thumb-vertical')) === 'scrollbar-fill', `removed: ${await layers('thumb-vertical')}`);
                expect((await t.call<string | null>('layersAttr', 'ly', 'thumb-vertical')) === null, 'the layers attribute of the part stays');

                // Every kind: markers (also ones made later), the corner, the pieces, the buttons, the cards.
                for (const kind of ['marker', 'corner', 'track-piece', 'button', 'card']) await t.call('setAttr', 'ly', `${kind}-layers`, 'scrollbar-fill test-a');
                await t.call('appendHeading', 'ly', 'C');
                await t.frames(4);
                expect((await layers('marker:A')) === 'scrollbar-fill test-a', `marker layers: ${await layers('marker:A')}`);
                expect((await layers('marker:C')) === 'scrollbar-fill test-a', `a marker made after the attribute: ${await layers('marker:C')}`);
                expect((await layers('corner')) === 'scrollbar-fill test-a', `corner layers: ${await layers('corner')}`);
                expect((await layers('track-piece-end-vertical')) === 'scrollbar-fill test-a', 'track piece layers set');
                expect((await layers('button-end-vertical')) === 'scrollbar-fill test-a', 'button layers set (the arrow layer is replaced, as Surface would)');
                // A card is made when the first one opens, with the layers of its attribute.
                expect(!(await t.call<boolean>('made', 'ly', 'card')), 'a card is made before any marker was hovered');
                const mc = centre(await t.box('ly', 'marker:A'));
                await t.page.mouse.move(mc.x, mc.y);
                await t.sleep(700);
                expect((await t.call('openCard', 'ly')) === 'A', `the card shows "${await t.call('openCard', 'ly')}"`);
                const card = await t.call<string | null>('partAttr', 'ly', 'card', 'layers');
                expect(card === 'scrollbar-fill test-a', `card layers attribute: ${card}`);
            } finally {
                await t.call('plainRemove', 'ly');
                await t.park();
            }
        },
    },
    {
        name: 'expand and contract delays: the engaged parts (the thumb widens and the track and buttons fade in) follow --ax-scrollbar-expand-delay, and go after --ax-scrollbar-contract-delay',
        run: async (t) => {
            const css = `ax-scroll-view { --ax-scrollbar-thickness: 12px; --ax-scrollbar-padding: 0px; --ax-scrollbar-hotzone: 100%; --ax-scrollbar-idle-delay: 60s;
                --ax-scrollbar-state-smoothing: 0s; --ax-scrollbar-fade-smoothing: 0s; --ax-scrollbar-fade-in-duration: 0s; --ax-scrollbar-fade-out-duration: 0s;
                --ax-scrollbar-expand-delay: 300ms; --ax-scrollbar-contract-delay: 400ms; }
                ax-scroll-view::part(thumb) { --ax-scrollbar-part-size: 2px; }
                ax-scroll-view::part(thumb-engaged), ax-scroll-view::part(thumb-hover), ax-scroll-view::part(thumb-pressed) { --ax-scrollbar-part-size: 6px; }
                ax-scroll-view::part(track) { --ax-scrollbar-part-color: rgb(0, 128, 0); --ax-scrollbar-part-opacity: 0; }
                ax-scroll-view::part(track-engaged) { --ax-scrollbar-part-opacity: 1; }`;
            await t.call('plainMake', 'ex', css, { hide: 'button', horizontal: 'hidden' }, '<div style="height: 3000px"></div>');
            try {
                await t.frames(4);
                await t.call('setScroll', 'ex', 100);
                await t.settle();
                const size = () => t.call<string>('look', 'ex', 'thumb-vertical', '--ax-scrollbar-shown-size');
                const opacity = () => t.call<string>('look', 'ex', 'track-vertical', '--ax-scrollbar-shown-opacity');
                const expanded = async () => (await t.call<string | null>('partAttr', 'ex', 'thumb-vertical', 'engaged')) !== null;
                expect((await size()) === '2px' && +(await opacity()) === 0, `collapsed: ${await size()}, track opacity ${await opacity()}`);
                const bar = await t.box('ex', 'scrollbar-vertical');
                const inside = { x: bar.left + 6, y: bar.top + 120 };

                // Over the bar: still collapsed before the delay, expanded after it.
                await t.page.mouse.move(inside.x, inside.y);
                await t.sleep(150);
                expect((await size()) === '2px' && !(await expanded()), `before the expand delay: ${await size()}`);
                await t.sleep(350);
                expect((await size()) === '6px' && +(await opacity()) === 1 && (await expanded()), `after the expand delay: ${await size()}, track opacity ${await opacity()}`);

                // Left: still expanded before the contract delay, collapsed after it.
                await t.park();
                await t.sleep(200);
                expect((await size()) === '6px' && (await expanded()), `before the contract delay: ${await size()}`);
                await t.sleep(450);
                expect((await size()) === '2px' && !(await expanded()) && +(await opacity()) === 0, `after the contract delay: ${await size()}, track opacity ${await opacity()}`);

                // A visit shorter than the expand delay expands nothing.
                await t.page.mouse.move(inside.x, inside.y);
                await t.sleep(120);
                await t.park();
                await t.sleep(600);
                expect((await size()) === '2px' && !(await expanded()), `after a short visit: ${await size()}`);

                // Back before the contract delay is over: it never contracts.
                await t.page.mouse.move(inside.x, inside.y);
                await t.sleep(450);
                expect(await expanded(), 'expanded again');
                await t.park();
                await t.sleep(200);
                await t.page.mouse.move(inside.x, inside.y);
                await t.sleep(600);
                expect((await size()) === '6px' && (await expanded()), `it contracted although the pointer came back: ${await size()}`);

                // A press does not wait: pressing the thumb expands (and a drag keeps it expanded away from the bar).
                await t.park();
                await t.sleep(700);
                expect(!(await expanded()), 'precondition: contracted');
                const th = await t.box('ex', 'thumb-vertical');
                await t.page.mouse.move(th.left + 6, th.top + 20);
                await t.page.mouse.down();
                await t.sleep(450);
                await t.page.mouse.move(100, th.top + 60, { steps: 3 });
                await t.sleep(200);
                expect((await size()) === '6px' && (await expanded()), `dragging: ${await size()}`);
                await t.page.mouse.up();
            } finally {
                await t.page.mouse.up().catch(() => {});
                await t.call('plainRemove', 'ex');
                await t.park();
            }
        },
    },
    {
        name: 'indicator="pinned": the mouse indicator never ends, from the first frame, and without the attribute it ends again',
        run: async (t) => {
            const css = 'ax-scroll-view { --ax-scrollbar-idle-delay: 150ms; --ax-scrollbar-fade-smoothing: 0s; }';
            await t.call('plainMake', 'pn', css, { hide: '', indicator: 'pinned', horizontal: 'hidden' }, '<div style="height: 3000px"></div>');
            try {
                await t.frames(4);
                expect((await t.call<string>('hostAttr', 'pn', 'indicator-state')) === 'mouse', `indicator at the start: ${await t.call<string>('hostAttr', 'pn', 'indicator-state')}`);
                expect(+(await t.call<string>('look', 'pn', 'thumb-vertical', '--ax-scrollbar-shown-opacity')) === 1, 'the thumb is shown from the start');
                await t.call('setScroll', 'pn', 200);
                await t.sleep(700);
                expect((await t.call<string>('hostAttr', 'pn', 'indicator-state')) === 'mouse', 'the indicator ended after the hide delay');
                await t.call('setAttr', 'pn', 'indicator', null);
                await t.sleep(700);
                expect((await t.call<string>('hostAttr', 'pn', 'indicator-state')) === 'none', `unpinned: ${await t.call<string>('hostAttr', 'pn', 'indicator-state')}`);
                await t.call('setAttr', 'pn', 'indicator', 'pinned');
                await t.frames(4);
                expect((await t.call<string>('hostAttr', 'pn', 'indicator-state')) === 'mouse', 'pinned again');
            } finally {
                await t.call('plainRemove', 'pn');
                await t.park();
            }
        },
    },
    {
        name: 'track extend, triangle glyph and the pressed arrow scale: ::part(track-vertical) geometry, --ax-scrollbar-glyph-shape, --ax-scrollbar-part-glyph-scale on ::part(button-pressed)',
        run: async (t) => {
            const css = `ax-scroll-view { --ax-scrollbar-thickness: 12px; --ax-scrollbar-padding: 0px; --ax-scrollbar-button-length: 15px; --ax-scrollbar-state-smoothing: 0s;
             }
                ax-scroll-view::part(button) { --ax-scrollbar-part-glyph-color: rgb(0, 0, 0); --ax-scrollbar-glyph-width: 6px; --ax-scrollbar-glyph-height: 3px; --ax-scrollbar-glyph-offset: 5.5px; }`;
            await t.call('plainMake', 'tx', css, { hide: '', horizontal: 'hidden', vertical: 'always' }, '<div style="height: 3000px"></div>');
            try {
                // A hidden bar draws nothing: show it.
                await t.call('wake', 'tx');
                await t.frames(4);
                const bar = await t.box('ex' === 'ex' ? 'tx' : 'tx', 'scrollbar-vertical');
                let track = await t.box('tx', 'track-vertical');
                near(track.top - bar.top, 15, 0.01, 'the track starts under the buttons by default');
                await t.call('plainStyle', 'tx', css + ' ax-scroll-view::part(track-vertical) { top: -15px; bottom: -15px; }');
                await t.frames(4);
                track = await t.box('tx', 'track-vertical');
                near(track.top - bar.top, 0, 0.01, 'the track reaches the top of the bar');
                near(bar.bottom - track.bottom, 0, 0.01, 'the track reaches the bottom of the bar');
                near(track.width, 12, 0.01, 'the track is as wide as the bar');

                const points = async () =>
                    (await t.call<string>('inner', 'tx', 'button-end-vertical', '.layer-scrollbar-glyph polygon', 'points')).split(' ').map((p) => p.split(',').map(Number));
                expect((await points()).length === 6, 'a chevron by default');
                await t.call('plainStyle', 'tx', 'ax-scroll-view::part(button) { --ax-scrollbar-glyph-shape: triangle; }');
                await t.frames(4);
                let p = await points();
                expect(p.length === 3, `triangle: ${p.length} points`);
                const width = (list: number[][]) => Math.max(...list.map((q) => q[0])) - Math.min(...list.map((q) => q[0]));
                const height = (list: number[][]) => Math.max(...list.map((q) => q[1])) - Math.min(...list.map((q) => q[1]));
                near(width(p), 6, 0.01, 'triangle width');
                near(height(p), 3, 0.01, 'triangle height');
                // The end button points down: its tip is the lowest point, 5.5px from the button's track end (the top).
                near(Math.min(...p.map((q) => q[1])), 5.5, 0.01, 'the base of the triangle is 5.5px from the track end');

                // Pressed: scaled about its centre.
                await t.call('plainStyle', 'tx', 'ax-scroll-view::part(button) { --ax-scrollbar-glyph-shape: triangle; } ax-scroll-view::part(button-pressed) { --ax-scrollbar-part-glyph-scale: 0.5; }');
                const c = centre(await t.box('tx', 'button-end-vertical'));
                await t.page.mouse.move(c.x, c.y);
                await t.page.mouse.down();
                await t.frames(6);
                p = await points();
                near(width(p), 3, 0.02, 'pressed triangle width at scale 0.5');
                near(height(p), 1.5, 0.02, 'pressed triangle height');
                await t.page.mouse.up();
                await t.park();
                await t.frames(6);
                p = await points();
                near(width(p), 6, 0.02, 'released triangle width');
            } finally {
                await t.page.mouse.up().catch(() => {});
                await t.call('plainRemove', 'tx');
                await t.park();
            }
        },
    },
    {
        name: 'Windows 11 (demo/win11.css, the default parts styled with ::part() and an acrylic layer on the track): geometry, expand timing, variants, marker states',
        run: async (t) => {
            const css = await t.call<string>('win11Css');
            const html = '<div style="height: 4000px; width: 2000px"><h2 id="a" style="margin: 0">Alpha</h2><h2 id="b" style="margin: 1500px 0 0">Beta</h2><h2 id="c" style="margin: 1500px 0 0">Gamma</h2></div>';
            const attrs = {
                class: 'win11', hide: '', 'track-layers': 'scrollbar-fill acrylic', 'marker-selector': 'h2', 'marker-align': 'center',
                horizontal: 'hidden', 'data-variant': 'default',
            };
            await t.call('plainMake', 'w11', css, attrs, html);
            try {
                // A hidden bar draws nothing: show it.
                await t.call('wake', 'w11');
                await t.frames(4);
                // Tokens only, on the default parts.
                expect((await t.call('tagOf', 'w11', 'thumb-vertical')) === 'AX-SCROLLBAR-THUMB', 'the thumb is not the default class');
                expect((await t.call('tagOf', 'w11', 'track-vertical')) === 'AX-SCROLLBAR-TRACK', 'the track is not the default class');
                // The acrylic is a layer of the track, by configuration; the thumb has the fill alone.
                expect((await t.call<string>('inner', 'w11', 'track-vertical', '.layer-acrylic', 'class')) !== '', 'the track has no acrylic layer');
                expect((await t.call<string>('inner', 'w11', 'track-vertical', '.layer-scrollbar-fill', 'class')) !== '', 'the track lost its fill layer');
                expect((await t.call<string>('inner', 'w11', 'thumb-vertical', '.layer-acrylic', 'class')) === '', 'the thumb has the acrylic layer');
                await t.call('setScroll', 'w11', 100);
                await t.settle();

                // Collapsed: a 2px thumb centred in a 12px bar, no track, no buttons shown (but laid out: 15px).
                const bar = await t.box('w11', 'scrollbar-vertical');
                near(bar.width, 12, 0.01, 'bar thickness (ScrollBarSize)');
                const look = (name: string, property: string) => t.call<string>('look', 'w11', name, property);
                await t.sleep(400);
                let thumb = await t.box('w11', 'thumb-vertical');
                near(thumb.width, 2, 0.01, 'collapsed thumb width');
                near(thumb.left - bar.left, 5, 0.01, 'collapsed thumb offset');
                expect(+(await look('track-vertical', '--ax-scrollbar-shown-opacity')) === 0, 'the track shows before the pointer is over the bar');
                expect(+(await look('button-end-vertical', '--ax-scrollbar-shown-opacity')) === 0, 'the buttons show before the pointer is over the bar');
                near((await t.box('w11', 'button-end-vertical')).height, 15, 0.01, 'the buttons are laid out while transparent');
                near((await t.box('w11', 'track-vertical')).height, bar.height, 0.01, 'the track spans the whole bar, under the buttons');
                near(thumb.height, Math.max(24, (bar.height - 30) * (bar.height / 4000)), 6, 'thumb length');

                // Expanded after 400ms, to 6px; the track and the buttons fade in.
                await t.page.mouse.move(bar.left + 6, bar.top + 150);
                await t.sleep(250);
                near((await t.box('w11', 'thumb-vertical')).width, 2, 0.01, 'thumb width 250ms after the pointer came');
                await t.sleep(600);
                thumb = await t.box('w11', 'thumb-vertical');
                near(thumb.width, 6, 0.05, 'expanded thumb width');
                near(thumb.left - bar.left, 3, 0.05, 'expanded thumb offset');
                expect(+(await look('track-vertical', '--ax-scrollbar-shown-opacity')) === 1 && +(await look('button-end-vertical', '--ax-scrollbar-shown-opacity')) === 1, 'the track and the buttons are not shown when expanded');
                const rgba = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
                const thumbColor = rgba(await look('thumb-vertical', '--ax-scrollbar-shown-color'));
                near(thumbColor[3], 0.447, 0.002, 'thumb alpha (ControlStrongFillColorDefault #72000000)');
                // The thumb has the same colour pressed (all three ScrollBarThumbFill resources name one colour).
                const tc = centre(await t.box('w11', 'thumb-vertical'));
                await t.page.mouse.move(tc.x, tc.y);
                await t.page.mouse.down();
                await t.sleep(300);
                near(rgba(await look('thumb-vertical', '--ax-scrollbar-shown-color'))[3], 0.447, 0.002, 'pressed thumb alpha');
                near((await t.box('w11', 'thumb-vertical')).width, 6, 0.05, 'pressed thumb width');
                await t.page.mouse.up();

                // The arrows: triangles, ControlStrongFillColorDefault, TextFillColorSecondary hovered.
                const bc = centre(await t.box('w11', 'button-end-vertical'));
                // Rounded corners (--ax-scrollbar-glyph-corner-radius: 1px): a filled path, an arc at each of the three corners.
                const outline = () => t.call<string>('inner', 'w11', 'button-end-vertical', '.layer-scrollbar-glyph path', 'd');
                const glyph = async () => [...(await outline()).matchAll(/[MLA][^MLAZ]*?(-?[\d.]+) (-?[\d.]+)(?=[MLAZ])/g)].map((m) => [Number(m[1]), Number(m[2])]);
                expect(((await outline()).match(/A/g) || []).length === 3, `the arrow is not a rounded triangle: "${await outline()}"`);
                const arrow = await glyph();
                const ys = arrow.map((q) => q[1]);
                const across = Math.max(...arrow.map((q) => q[0])) - Math.min(...arrow.map((q) => q[0]));
                expect(across > 3 && across <= 7, `the rounded triangle is ${across}px wide, want within its 7px`);
                expect(Math.max(...ys) - Math.min(...ys) <= 4, 'the rounded triangle is inside its 4px height');
                await t.page.mouse.move(bc.x, bc.y);
                await t.sleep(300);
                near(rgba(await look('button-end-vertical', '--ax-scrollbar-shown-glyph-color'))[3], 0.62, 0.003, 'hovered arrow alpha (TextFillColorSecondary #9E000000)');
                const wide = Math.max(...(await glyph()).map((q) => q[0])) - Math.min(...(await glyph()).map((q) => q[0]));
                await t.page.mouse.down();
                await t.sleep(300);
                const small = Math.max(...(await glyph()).map((q) => q[0])) - Math.min(...(await glyph()).map((q) => q[0]));
                near(small / wide, 0.875, 0.01, 'pressed arrow scale (ScrollBarButtonArrowScalePressed)');
                await t.page.mouse.up();

                // Left: it contracts after 500ms.
                await t.park();
                await t.sleep(300);
                near((await t.box('w11', 'thumb-vertical')).width, 6, 0.05, 'thumb width 300ms after the pointer left');
                await t.sleep(900);
                near((await t.box('w11', 'thumb-vertical')).width, 2, 0.05, 'thumb width after the contract delay');
                expect(+(await look('track-vertical', '--ax-scrollbar-shown-opacity')) === 0, 'the track stays after the contract delay');

                // Markers (B9.1): accent dashes at full opacity on the track, the state in the size; white on the thumb,
                // hidden while the bar is collapsed.
                const markerColor = async (id: string) => rgba(await look(`marker:${id}`, '--ax-scrollbar-shown-color')).map((n, i) => (i === 3 ? n : Math.round(n)));
                const alpha = async (id: string) => +(await look(`marker:${id}`, '--ax-scrollbar-shown-alpha'));
                await t.call('setScroll', 'w11', 1520);
                await t.settle();
                await t.sleep(900);
                // Beta is current and under the thumb at the middle of the track; Alpha is before the thumb; Gamma after it.
                let c = await markerColor('c');
                expect(c.join() === '0,90,158,1' && near3(await alpha('c'), 1), `collapsed, on the track: ${c.join()} alpha ${await alpha('c')}`);
                let m = await t.box('w11', 'marker:c');
                near(m.width, 4, 0.05, 'collapsed marker width');
                near(m.height, 2, 0.01, 'marker thickness');
                const ta = await t.tokens('w11', 'marker:b');
                expect(has(ta, 'marker-on-thumb') && has(ta, 'marker-current'), `precondition: marker b ${ta.join(' ')}`);
                expect(near3(await alpha('b'), 0), `a marker on the collapsed thumb is hidden: alpha ${await alpha('b')}`);
                // Engaged: pointer on the bar.
                await t.page.mouse.move(bar.left + 6, bar.top + 55);
                await t.sleep(700);
                c = await markerColor('c');
                expect(c.join() === '0,90,158,1' && near3(await alpha('c'), 1), `engaged: ${c.join()} alpha ${await alpha('c')}`);
                m = await t.box('w11', 'marker:c');
                near(m.width, 6, 0.05, 'engaged marker width');
                near(m.height, 2, 0.01, 'engaged marker thickness');
                c = await markerColor('b');
                expect(c.slice(0, 3).join() === '255,255,255' && near3(c[3], 1) && near3(await alpha('b'), 1), `on the engaged thumb: ${c.join()} alpha ${await alpha('b')}`);
                m = await t.box('w11', 'marker:b');
                near(m.width, 6, 0.05, 'a marker on the engaged thumb is as wide as the thumb');
                near(m.height, 2, 0.01, 'its thickness');
                // The current marker on the track (before the thumb): 8 x 2.
                await t.call('setScroll', 'w11', 2400);
                await t.settle();
                await t.sleep(700);
                m = await t.box('w11', 'marker:b');
                const tb = await t.tokens('w11', 'marker:b');
                expect(has(tb, 'marker-current') && !has(tb, 'marker-on-thumb'), `precondition: marker b ${tb.join(' ')}`);
                near(m.width, 8, 0.05, 'current marker width');
                await t.call('setScroll', 'w11', 1520);
                await t.settle();
                await t.sleep(700);
                // Hovered on the track: 10 x 3.
                const gc = centre(await t.box('w11', 'marker:c'));
                await t.page.mouse.move(gc.x, gc.y);
                await t.sleep(700);
                c = await markerColor('c');
                expect(c.join() === '0,90,158,1', `hovered: ${c.join()}`);
                m = await t.box('w11', 'marker:c');
                near(m.width, 10, 0.05, 'hovered marker width');
                near(m.height, 3, 0.05, 'hovered marker thickness');
                // Pressed: 8 x 3.
                await t.page.mouse.down();
                await t.sleep(300);
                m = await t.box('w11', 'marker:c');
                near(m.width, 8, 0.05, 'pressed marker width');
                near(m.height, 3, 0.05, 'pressed marker thickness');
                await t.page.mouse.up();
                await t.park();
                // Hovered on the thumb: white, as wide as the thumb, 3px tall.
                await t.call('setScroll', 'w11', 1520);
                await t.settle();
                const mb = centre(await t.box('w11', 'marker:b'));
                await t.page.mouse.move(mb.x, mb.y);
                await t.sleep(700);
                c = await markerColor('b');
                expect(c.slice(0, 3).join() === '255,255,255', `hovered on the thumb: ${c.join()}`);
                m = await t.box('w11', 'marker:b');
                near(m.width, 6, 0.05, 'hovered marker on the thumb: width');
                near(m.height, 3, 0.05, 'hovered marker on the thumb: thickness');
                await t.park();

                // The card: ToolTip look.
                await t.sleep(600);
                const gc2 = centre(await t.box('w11', 'marker:c'));
                await t.page.mouse.move(gc2.x, gc2.y);
                await t.sleep(600);
                const cardCss = async (name: string) => (await t.call<string>('computed', 'w11', 'card', name)).trim();
                expect((await cardCss('max-width')) === '360px', `card max width ${await cardCss('max-width')}`);
                expect((await cardCss('--ax-radius')) === '4px', `card radius ${await cardCss('--ax-radius')}`);
                expect((await cardCss('padding')) === '7px 10px 9px', `card padding (ToolTipBorderPadding plus the 1px border) ${await cardCss('padding')}`);
                await t.park();

                // Full: pinned, expanded from the start, never fades; the arrows are in front of the track.
                await t.call('setAttr', 'w11', 'data-variant', 'full');
                await t.call('setAttr', 'w11', 'indicator', 'pinned');
                await t.sleep(500);
                near((await t.box('w11', 'thumb-vertical')).width, 6, 0.05, 'Full: the thumb is expanded at rest');
                expect(+(await look('track-vertical', '--ax-scrollbar-shown-opacity')) === 1 && +(await look('button-end-vertical', '--ax-scrollbar-shown-opacity')) === 1, 'Full: the track and the buttons are shown at rest');
                // Both arrows are in front of the track, which reaches under them, in the normal arrow colour.
                for (const name of ['button-start-vertical', 'button-end-vertical']) {
                    expect((await t.call<string>('computed', 'w11', name, 'z-index')) === '1', `${name} is not in front of the track`);
                    const fill = await t.call<string>('inner', 'w11', name, '.layer-scrollbar-glyph path', 'fill');
                    near(rgba(fill)[3], 0.447, 0.002, `${name}: arrow colour`);
                }
                const host = await t.box('w11', 'host');
                // Minimal (Chromium Fluent overlay, minimal mode): the thumb alone, 4px at the viewport side, 9px on the bar.
                await t.call('setAttr', 'w11', 'indicator', null);
                await t.call('setAttr', 'w11', 'data-variant', 'minimal');
                await t.call('setAttr', 'w11', 'hide', 'button track corner');
                await t.call('setAttr', 'w11', 'indicator', 'near');
                await t.park();
                await t.sleep(2600);
                const mbar = await t.box('w11', 'scrollbar-vertical');
                near(mbar.width, 15, 0.01, 'Minimal: bar thickness (kScrollbarThickness)');
                // A pointer over the content shows nothing; a scroll does.
                await t.page.mouse.move(host.left + 100, host.top + 100);
                await t.sleep(300);
                expect((await t.call<string>('hostAttr', 'w11', 'indicator-state')) === 'none', 'Minimal: the pointer over the content showed the indicator');
                await t.call('setScroll', 'w11', 1700);
                await t.sleep(300);
                let mt = await t.box('w11', 'thumb-vertical');
                near(mt.width, 4, 0.05, 'Minimal: thin thumb');
                near(mbar.right - mt.right, 3, 0.05, 'Minimal: the thin thumb sits 3px from the viewport edge, on its side');
                await t.page.mouse.move(mbar.left + 8, mbar.top + 150);
                await t.sleep(400);
                mt = await t.box('w11', 'thumb-vertical');
                near(mt.width, 9, 0.05, 'Minimal: the thumb grows under the pointer');
                near(mbar.right - mt.right, 3, 0.05, 'Minimal: the grown thumb keeps its outer edge');
                expect((await t.call<string>('display', 'w11', 'track-vertical')) === 'none' && (await t.call<string>('display', 'w11', 'button-end-vertical')) === 'none', 'Minimal: the track or the buttons are displayed');
                const tcm = centre(mt);
                await t.page.mouse.move(tcm.x, tcm.y);
                await t.sleep(300);
                near(rgba(await look('thumb-vertical', '--ax-scrollbar-shown-color'))[0], 99, 0.6, 'Minimal: the hovered thumb is #636363');
                await t.park();
                await t.sleep(1800);
                expect((await t.call<string>('hostAttr', 'w11', 'indicator-state')) === 'none', 'Minimal: the bar did not fade out');
            } finally {
                await t.page.mouse.up().catch(() => {});
                await t.call('plainRemove', 'w11');
                await t.park();
            }
            function near3(a: number, b: number): boolean {
                return Math.abs(a - b) < 0.004;
            }
        },
    },
    {
        name: 'markers given as objects with element and axis keep their own ticks',
        run: async (t) => {
            const result = await t.page.evaluate(async () => {
                const view = document.createElement('ax-scroll-view') as any;
                view.id = 'mk';
                view.style.cssText = 'position:absolute;left:20px;top:20px;width:300px;height:200px;';
                view.innerHTML = '<div style="width:1500px;height:2000px;position:relative"></div>';
                const box = view.firstElementChild as HTMLElement;
                const make = (axis: string, at: number) => {
                    const e = document.createElement('i');
                    e.style.cssText = `position:absolute;${axis === 'vertical' ? 'top' : 'left'}:${at}px;width:2px;height:2px`;
                    box.appendChild(e);
                    return e;
                };
                document.body.appendChild(view);
                view.markers = [
                    { id: 'a', label: 'A', axis: 'vertical', element: make('vertical', 100) },
                    { id: 'b', label: 'B', axis: 'vertical', element: make('vertical', 700) },
                    { id: 'c', label: 'C', axis: 'vertical', element: make('vertical', 1300) },
                    { id: 'd', label: 'D', axis: 'horizontal', element: make('horizontal', 200) },
                    { id: 'e', label: 'E', axis: 'horizontal', element: make('horizontal', 900) },
                ];
                await new Promise((r) => setTimeout(r, 300));
                const sh = view.shadowRoot;
                const ticks = (cls: string) =>
                    Array.from(sh.querySelectorAll(`.bar.${cls} .slot`))
                        .filter((s: any) => getComputedStyle(s).display !== 'none')
                        .map((s: any) => [s.firstElementChild.dataset.id, s.style.transform]);
                const out = { v: ticks('v'), h: ticks('h') };
                view.remove();
                return out;
            });
            // The same without ids and labels: they come from the elements, one tick for each.
            const bare = await t.page.evaluate(async () => {
                const view = document.createElement('ax-scroll-view') as any;
                view.style.cssText = 'position:absolute;left:20px;top:20px;width:300px;height:200px;';
                view.innerHTML = '<div style="height:2000px;position:relative"></div>';
                const list = [100, 700, 1300].map((at, i) => {
                    const e = document.createElement('i');
                    e.textContent = 'Bare ' + i;
                    e.style.cssText = `position:absolute;top:${at}px;width:2px;height:2px`;
                    view.firstElementChild.appendChild(e);
                    return { axis: 'vertical', element: e };
                });
                document.body.appendChild(view);
                view.markers = list;
                await new Promise((r) => setTimeout(r, 300));
                const rows = Array.from(view.shadowRoot.querySelectorAll('.bar.v .slot')).map((x: any) => [getComputedStyle(x).display, x.style.transform]);
                const labels = view.markers.map((m: any) => m.label);
                view.remove();
                return { rows, labels };
            });
            expect(bare.rows.length === 3 && new Set(bare.rows.map((r: string[]) => r[1])).size === 3, `markers without ids: ${JSON.stringify(bare.rows)}`);
            expect(bare.labels.join('|') === 'Bare 0|Bare 1|Bare 2', `labels of markers without labels: ${bare.labels}`);
            const ids = (rows: string[][]) => rows.map((r) => r[0]).join(',');
            expect(ids(result.v) === 'a,b,c', `vertical ticks: ${JSON.stringify(result.v)}`);
            expect(ids(result.h) === 'd,e', `horizontal ticks: ${JSON.stringify(result.h)}`);
            expect(new Set(result.v.map((r: string[]) => r[1])).size === 3, `vertical ticks share a place: ${JSON.stringify(result.v)}`);
        },
    },
    {
        name: 'a11y: Tab goes into the content when it has a link, and skips the viewport',
        run: async (t) => {
            await mountA11y(t, '<p>Intro</p><a id="a11y-link" href="#x">First link</a><p>More</p>');
            try {
                expect((await viewportTabindex(t)) === null, `the viewport has tabindex ${await viewportTabindex(t)} with a link inside`);
                await t.page.focus('#a11y-before');
                await t.page.keyboard.press('Tab');
                expect((await focusPath(t)) === 'a#a11y-link', `Tab from the button reached ${await focusPath(t)}, want the link`);
                await t.page.keyboard.press('Tab');
                expect((await focusPath(t)) === 'button#a11y-after', `the next Tab reached ${await focusPath(t)}, want the button after the view`);
                await t.page.keyboard.press('Shift+Tab');
                await t.page.keyboard.press('Shift+Tab');
                expect((await focusPath(t)) === 'button#a11y-before', `Shift+Tab ended on ${await focusPath(t)}, want the button before the view`);
            } finally {
                await unmountA11y(t);
            }
        },
    },
    {
        name: 'a11y: a text-only view takes focus and the keys scroll it',
        run: async (t) => {
            await mountA11y(t, '<p>Only text</p>', 3000);
            try {
                expect((await viewportTabindex(t)) === '0', `the viewport has tabindex ${await viewportTabindex(t)} with no focusable content`);
                await t.page.focus('#a11y-before');
                await t.page.keyboard.press('Tab');
                expect((await focusPath(t)) === 'div.viewport', `Tab reached ${await focusPath(t)}, want the viewport`);
                const top = () => t.page.evaluate(() => (document.getElementById('a11y-view') as any).scrollTop as number);
                const wait = async () => {
                    await t.call('frames', 3);
                    await t.sleep(150);
                };
                await t.page.keyboard.press('PageDown');
                await wait();
                const afterPage = await top();
                expect(afterPage > 100, `PageDown left scrollTop at ${afterPage}`);
                await t.page.keyboard.press('ArrowDown');
                await wait();
                const afterArrow = await top();
                expect(afterArrow > afterPage, `ArrowDown left scrollTop at ${afterArrow} (was ${afterPage})`);
                await t.page.keyboard.press('End');
                await wait();
                const max = await t.page.evaluate(() => { const v = document.getElementById('a11y-view') as any; return v.scrollHeight - v.clientHeight; });
                near(await top(), max, 1, 'scrollTop after End');
                await t.page.keyboard.press('Home');
                await wait();
                near(await top(), 0, 1, 'scrollTop after Home');
            } finally {
                await unmountA11y(t);
            }
        },
    },
    {
        name: 'a11y: adding or removing a focusable child flips the tabindex',
        run: async (t) => {
            await mountA11y(t, '<p>Text</p><div id="a11y-slot"></div>');
            try {
                const step = async (what: string, change: string, want: string | null) => {
                    await t.page.evaluate(`(() => { const view = document.getElementById('a11y-view'); const slot = document.getElementById('a11y-slot'); ${change} })()`);
                    await t.call('frames', 2);
                    const got = await viewportTabindex(t);
                    expect(got === want, `${what}: tabindex is ${got}, want ${want}`);
                };
                expect((await viewportTabindex(t)) === '0', 'text only: tabindex is not 0');
                await step('a button added', "slot.innerHTML = '<button id=\"a11y-btn\">Go</button>'", null);
                await step('the button removed', "slot.innerHTML = ''", '0');
                await step('a link added', "slot.innerHTML = '<a id=\"a11y-ln\">no href</a>'", '0');
                await step('the link gets an href', "document.getElementById('a11y-ln').setAttribute('href', '#y')", null);
                await step('the link leaves the Tab order', "document.getElementById('a11y-ln').setAttribute('tabindex', '-1')", '0');
                await step('an input added', "slot.innerHTML = '<input id=\"a11y-in\">'", null);
                await step('the input disabled', "document.getElementById('a11y-in').disabled = true", '0');
                await step('a nested [tabindex=0] added', "slot.innerHTML = '<div><span tabindex=\"0\">x</span></div>'", null);
            } finally {
                await unmountA11y(t);
            }
        },
    },
    {
        name: 'a11y: bars and cards never take focus, are aria-hidden, and the tree shows only the content',
        run: async (t) => {
            await mountA11y(t, '<h2>Heading</h2><a href="#x">A link</a><p>Body text</p>', 2000, true);
            try {
                // Hover a marker to have a card open, so the card is in the shadow root too.
                await t.call('frames', 3);
                const info = await t.page.evaluate(() => {
                    const view = document.getElementById('a11y-view') as any;
                    const root = view.shadowRoot as ShadowRoot;
                    const hidden = (selector: string) => Array.from(root.querySelectorAll(selector)).map((n) => n.getAttribute('aria-hidden'));
                    const focusable = Array.from(root.querySelectorAll('.frame *, .cards *, .frame, .cards')).filter((n: any) => n.tabIndex >= 0 || n.hasAttribute('tabindex'));
                    return { frame: hidden('.frame'), cards: hidden('.cards'), focusable: focusable.length, cardsText: (root.querySelector('.cards') as HTMLElement).textContent };
                });
                expect(info.frame.length === 1 && info.frame[0] === 'true', `.frame aria-hidden: ${info.frame}`);
                expect(info.cards.length === 1 && info.cards[0] === 'true', `.cards aria-hidden: ${info.cards}`);
                expect(info.focusable === 0, `${info.focusable} parts of the bars or cards can take focus`);
                // Tab through the whole view and past it: nothing in the bars or cards is visited.
                await t.page.focus('#a11y-before');
                const visited: string[] = [];
                for (let i = 0; i < 4; i++) {
                    await t.page.keyboard.press('Tab');
                    visited.push(await focusPath(t));
                    if (visited[visited.length - 1] === 'button#a11y-after') break;
                }
                expect(visited.join(' > ') === 'a > button#a11y-after', `Tab order: ${visited.join(' > ')}`);
                const snapshot: string = await t.page.locator('#a11y-view').ariaSnapshot();
                expect(snapshot.includes('Heading') && snapshot.includes('A link') && snapshot.includes('Body text'), `the tree misses the content:\n${snapshot}`);
                expect(!snapshot.includes('Marker label') && !/scrollbar|thumb|button|track/i.test(snapshot), `the tree shows the bars or cards:\n${snapshot}`);
                expect(!/role|aria-label/.test(await t.page.evaluate(() => (document.getElementById('a11y-view') as HTMLElement).outerHTML.slice(0, 120))), 'the host got a role or label');
            } finally {
                await unmountA11y(t);
            }
        },
    },
    {
        name: 'a11y: forced colours hide the overlay and bring back the native scrollbar',
        run: async (t) => {
            await mountA11y(t, '<p>Text</p>', 2000);
            try {
                const read = () =>
                    t.page.evaluate(() => {
                        const view = document.getElementById('a11y-view') as any;
                        const root = view.shadowRoot as ShadowRoot;
                        return {
                            frame: getComputedStyle(root.querySelector('.frame') as HTMLElement).display,
                            cards: getComputedStyle(root.querySelector('.cards') as HTMLElement).display,
                            width: getComputedStyle(root.querySelector('.viewport') as HTMLElement).scrollbarWidth,
                        };
                    });
                let state = await read();
                expect(state.frame !== 'none' && state.width === 'none', `normal: ${JSON.stringify(state)}`);
                await t.page.emulateMedia({ forcedColors: 'active' });
                state = await read();
                expect(state.frame === 'none' && state.cards === 'none', `forced colours: the overlay is shown: ${JSON.stringify(state)}`);
                expect(state.width !== 'none', `forced colours: the viewport scrollbar-width is ${state.width}`);
                await t.page.emulateMedia({ forcedColors: 'none' });
                state = await read();
                expect(state.frame !== 'none' && state.width === 'none', `forced colours off: ${JSON.stringify(state)}`);
            } finally {
                await t.page.emulateMedia({ forcedColors: 'none' });
                await unmountA11y(t);
            }
        },
    },
    {
        name: 'a11y: forced colours on the page scrollbar',
        run: async (t) => {
            try {
                const read = () =>
                    t.page.evaluate(() => {
                        const bar = document.getElementById('page') as HTMLElement;
                        const root = bar.shadowRoot as ShadowRoot;
                        return {
                            frame: getComputedStyle(root.querySelector('.frame') as HTMLElement).display,
                            cards: getComputedStyle(root.querySelector('.cards') as HTMLElement).display,
                            width: getComputedStyle(document.documentElement).scrollbarWidth,
                        };
                    });
                let state = await read();
                expect(state.frame !== 'none' && state.width === 'none', `normal: ${JSON.stringify(state)}`);
                await t.page.emulateMedia({ forcedColors: 'active' });
                state = await read();
                expect(state.frame === 'none' && state.cards === 'none', `forced colours: the overlay is shown: ${JSON.stringify(state)}`);
                expect(state.width !== 'none', `forced colours: the document scrollbar-width is ${state.width}`);
                await t.page.emulateMedia({ forcedColors: 'none' });
                state = await read();
                expect(state.frame !== 'none' && state.width === 'none', `forced colours off: ${JSON.stringify(state)}`);
            } finally {
                await t.page.emulateMedia({ forcedColors: 'none' });
            }
        },
    },
    {
        name: 'alignment: the thumb and the buttons paint the same columns at DPR 1.25 and 1.5, without and with snap, at fractional places',
        run: async (t) => {
            // Solid red thumb and blue buttons: their painted columns can be told apart from the screenshot.
            const css = `ax-scroll-view, ax-scrollbar { --ax-scrollbar-fade-in-duration: 0s; --ax-scrollbar-state-smoothing: 0s; --ax-scrollbar-fade-smoothing: 0s; --ax-scrollbar-slide-distance: 0px; }
            ax-scroll-view::part(thumb), ax-scrollbar::part(thumb) { --ax-scrollbar-part-color: rgb(255, 0, 0); --ax-scrollbar-part-border-color: rgba(0, 0, 0, 0); }
            ax-scroll-view::part(button), ax-scrollbar::part(button) { --ax-scrollbar-part-color: rgb(0, 0, 255); --ax-scrollbar-part-border-color: rgba(0, 0, 0, 0); --ax-scrollbar-part-glyph-color: rgba(0, 0, 0, 0); }`;
            const failures: string[] = [];
            for (const dpr of [1.25, 1.5]) {
                const s = await t.scaled(dpr);
                try {
                    for (const snap of [false, true]) {
                        // The page scrollbar (a fixed overlay at the edge of the window) and a scroll view at fractional places.
                        for (const [left, top] of [[-1, -1], [10, 20], [10.3, 20.4], [10.6, 20.7], [10.85, 20.15]]) {
                            const id = left < 0 ? 'page' : 'al';
                            const attrs = { indicator: 'pinned', vertical: 'always', hide: 'track', ...(snap ? { snap: '' } : {}) };
                            if (left < 0) await s.call('makePage', css, attrs);
                            else {
                                await s.call('plainMake', 'al', css, attrs, '<div style="height: 2000px"></div>');
                                await s.call('plainPlace', 'al', left, top);
                            }
                            await s.call('settle');
                            await Bun.sleep(300);
                            const thumb: Box = await s.call('box', id, 'thumb-vertical');
                            const button: Box = await s.call('box', id, 'button-start-vertical');
                            const shot: Buffer = await s.page.screenshot();
                            const columns = (y: number): Promise<[number, number]> =>
                                s.page.evaluate(
                                    async ([b64, row, from, to]: [string, number, number, number]) => {
                                        const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
                                        const canvas = new OffscreenCanvas(img.width, img.height);
                                        const g = canvas.getContext('2d')!;
                                        g.drawImage(img, 0, 0);
                                        const px = g.getImageData(from, row, to - from, 1).data;
                                        let first = -1;
                                        let last = -1;
                                        for (let i = 0; i < px.length; i += 4) {
                                            if (px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235) continue;
                                            if (first < 0) first = from + i / 4;
                                            last = from + i / 4;
                                        }
                                        return [first, last] as [number, number];
                                    },
                                    [shot.toString('base64'), y, Math.floor((thumb.left - 4) * dpr), Math.ceil((thumb.right + 4) * dpr)],
                                );
                            const onThumb = await columns(Math.round((thumb.top + thumb.height / 2) * dpr));
                            const onButton = await columns(Math.round((button.top + button.height / 2) * dpr));
                            if (onThumb[0] !== onButton[0] || onThumb[1] !== onButton[1]) failures.push(`dpr ${dpr}${snap ? ' snap' : ''} ${id === 'page' ? 'page bar' : `at ${left},${top}`}: thumb ${onThumb}, button ${onButton}`);
                            if (left < 0) await s.call('removePage');
                            else await s.call('plainRemove', 'al');
                        }
                    }
                } finally {
                    await s.close();
                }
            }
            expect(failures.length === 0, failures.join('; '));
        },
    },
    {
        name: 'Luna auto tones: the accent, its deep tone and the arrows follow --luna-accent-light (white arrows on a dark body, tinted dark ones on a light one), and so do the rings and grip lines',
        run: async (t) => {
            const luna = `--luna-light: top-left; --luna-diagonal: 1; --luna-glint: 0; --luna-face: #ece9d8; --luna-text: #fff; --luna-disabled: #f0f0e6; --luna-highlight: 1; --luna-shade: 0.72; --luna-gloss: 0.182; --luna-depth: 0.196; --luna-hot: 0.624; --luna-press: 0.675; --luna-relief: 1; --luna-etch: 0;`;
            const metal = `--luna-light: top; --luna-diagonal: 0; --luna-glint: 0; --luna-face: #e0dfe3; --luna-text: #0e1010; --luna-disabled: #f0f0e6; --luna-highlight: 0.731; --luna-shade: 0.913; --luna-gloss: 1; --luna-depth: 1; --luna-hot: 1; --luna-press: 0; --luna-relief: 0.686; --luna-etch: 1;`;
            // The colours of the user's report: pale blue, dark green, mid purple, then pale gold and dark grey of a metallic one.
            const cases: { name: string; body: string; numbers: string; metallic: boolean; white: boolean; shade: number; highlight: number }[] = [
                { name: 'pale blue', body: '#cfe0ff', numbers: luna, metallic: false, white: false, shade: 0.72, highlight: 1 },
                { name: 'dark green', body: '#1f4d2a', numbers: luna, metallic: false, white: true, shade: 0.72, highlight: 1 },
                { name: 'mid purple', body: '#8a63c9', numbers: luna, metallic: false, white: true, shade: 0.72, highlight: 1 },
                { name: 'pale gold', body: '#ffe6b0', numbers: metal, metallic: true, white: false, shade: 0.913, highlight: 0.731 },
                { name: 'dark grey', body: '#3a3a3a', numbers: metal, metallic: true, white: true, shade: 0.913, highlight: 0.731 },
            ];
            const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
            const failures: string[] = [];
            for (const c of cases) {
                const css = `.t { ${c.numbers} --luna-accent-light: ${c.body}; }`;
                const schemes: string = await t.call('lunaKit');
                await t.call('plainMake', 'auto', schemes + css, { kit: 'luna', class: 't', vertical: 'always', horizontal: 'never', snap: '' }, '<div style="width: 200px; height: 1500px"></div>');
                try {
                    await t.frames(8);
                    await t.park();
                    await t.sleep(200);
                    const tone = (part: string, property: string) => t.call<string>('partToken', 'auto', part, property);
                    const want = deriveTones(rgb(c.body), c.metallic);
                    const got = { accent: await tone('thumb-vertical', '--luna-tone-accent'), deep: await tone('thumb-vertical', '--luna-tone-accent-deep'), glyph: await tone('button-start-vertical', '--luna-tone-glyph') };
                    if (got.accent !== want.accent || got.deep !== want.deep || got.glyph !== want.glyph) failures.push(`${c.name}: tones ${JSON.stringify(got)}, derived ${JSON.stringify(want)}`);
                    const [lb, cb, hb] = toOklch(rgb(c.body));
                    const g = toOklch(rgb(got.glyph));
                    if (c.white) {
                        if (got.glyph !== '#ffffff') failures.push(`${c.name}: the arrows are ${got.glyph}, want white on a body of lightness ${lb.toFixed(2)}`);
                    } else {
                        if (got.glyph === '#ffffff' || g[0] > 0.6) failures.push(`${c.name}: the arrows ${got.glyph} are not dark on a body of lightness ${lb.toFixed(2)}`);
                        const dh = Math.abs(((g[2] - hb + 540) % 360) - 180);
                        if (cb > 0.02 && dh > 25) failures.push(`${c.name}: the arrows ${got.glyph} have hue ${g[2].toFixed(0)}, the body ${hb.toFixed(0)}`);
                    }
                    // Painted: the arrow's pixel is the glyph tone under 13% white, the dark grip line is the deep tone
                    // under 65.5% white and the shade, the light one is the body under the highlight's white.
                    const shot: Buffer = await t.page.screenshot();
                    const button = await t.box('auto', 'button-start-vertical');
                    const thumb = await t.box('auto', 'thumb-vertical');
                    const start = Math.floor((Math.round(thumb.height) - 8) / 2);
                    const points: [number, number][] = [
                        [Math.round(button.left) + 8, Math.round(button.top) + 7],
                        [Math.round(thumb.left) + 5 + 3, Math.round(thumb.top) + start + 1],
                        [Math.round(thumb.left) + 5 + 3, Math.round(thumb.top) + start],
                    ];
                    const [arrow, dark, light] = await t.call<number[][]>('pixels', shot.toString('base64'), points);
                    const over = (base: number[], white: number): number[] => base.map((v) => v * (1 - white) + 255 * white);
                    const sameish = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]) <= 4);
                    const wantArrow = over(rgb(got.glyph), 0.13);
                    const wantDark = over(rgb(got.deep), 0.655).map((v) => v * (1 - c.shade * 0.22));
                    const wantLight = over(rgb(c.body), c.highlight * 0.435);
                    if (!sameish(arrow, wantArrow)) failures.push(`${c.name}: the arrow is painted ${arrow}, want ${wantArrow.map(Math.round)}`);
                    if (!sameish(dark, wantDark)) failures.push(`${c.name}: the dark grip line is painted ${dark}, want ${wantDark.map(Math.round)}`);
                    if (!sameish(light, wantLight)) failures.push(`${c.name}: the light grip line is painted ${light}, want ${wantLight.map(Math.round)}`);
                } finally {
                    await t.call('plainRemove', 'auto');
                }
            }
            // A scheme that sets its tones keeps them: the tone of a shipped scheme is its own value, not a derived one.
            const schemes: string = await t.call('lunaKit');
            await t.call('plainMake', 'auto', schemes, { kit: 'luna', class: 'luna-olive', vertical: 'always', horizontal: 'never', snap: '' }, '<div style="height: 1500px"></div>');
            try {
                await t.frames(8);
                const tone = (part: string, property: string) => t.call<string>('partToken', 'auto', part, property);
                // Olive Green sets its glyph white itself; Blue's dark blue-grey arrows are its own too.
                expect((await tone('button-start-vertical', '--luna-tone-glyph')) === 'rgb(255, 255, 255)' || (await tone('button-start-vertical', '--luna-tone-glyph')) === '#ffffff', `Olive Green's arrows: ${await tone('button-start-vertical', '--luna-tone-glyph')}`);
                expect(!!(await tone('thumb-vertical', '--luna-tone-accent')), 'the accent of Olive Green is empty');
                const olive = deriveTones(rgb('#aec193'), false);
                expect(olive.glyph === '#ffffff', `the arrows derived for Olive Green's body are ${olive.glyph}, want white`);
            } finally {
                await t.call('plainRemove', 'auto');
            }
            expect(failures.length === 0, failures.join('; '));
        },
    },
    {
        name: 'Luna grip: four crisp light and dark lines at 100%, 110%, 125%, 150% and 200%, on vertical and horizontal thumbs of every length, at every scroll position',
        run: async (t) => {
            const failures: string[] = [];
            const count = 12;
            for (const dpr of [1, 1.1, 1.25, 1.5, 2]) {
                const s = await t.real(dpr);
                try {
                    const schemes: string = await s.call('lunaKit');
                    const got: number = await s.page.evaluate(() => window.devicePixelRatio);
                    expect(Math.abs(got - dpr) < 1e-3, `the browser did not take the ratio ${dpr}: ${got}`);
                    await s.call('lunaRow', count, '');
                    for (const step of [0, 1, 3, 7]) {
                        await s.call('lunaScroll', count, step);
                        await s.call('settle');
                        await Bun.sleep(400);
                        await s.page.mouse.move(1400, 600);
                        let previous = '';
                        let shot: Buffer = await s.page.screenshot();
                        // Wait until two screenshots agree, as a frame of the scroll may still be on its way.
                        for (let i = 0; i < 10 && shot.toString('base64') !== previous; i++) {
                            previous = shot.toString('base64');
                            await Bun.sleep(250);
                            shot = await s.page.screenshot();
                        }
                        const thumbs = await s.call('lunaThumbs', count);
                        const problems: string[] = await s.call('gripCheck', shot.toString('base64'), dpr, thumbs);
                        for (const problem of problems) failures.push(`dpr ${dpr} step ${step}: ${problem}`);
                    }
                    void schemes;
                } finally {
                    await s.close();
                }
            }
            const kinds = new Map<string, number>();
            for (const f of failures) kinds.set(f.replace(/ thumb \d+ \(\d+ device px\).*/, ''), (kinds.get(f.replace(/ thumb \d+ \(\d+ device px\).*/, '')) ?? 0) + 1);
            expect(failures.length === 0, `${failures.length} grips are not crisp (${[...kinds].map(([k, n]) => `${k}: ${n}`).join(', ')}): ${failures.slice(0, 3).join('; ')}`);
        },
    },
    {
        name: 'idle is free: after the bars settle, 3 s without a frame callback or a timer; the page bar follows its document by observation',
        run: async (t) => {
            const s = await t.scaled(1);
            try {
                await Bun.sleep(2500);
                // Counted from here: every frame callback (the page counts its requests) and every timer.
                await s.page.evaluate(() => {
                    const w = window as unknown as { __timers: number };
                    w.__timers = 0;
                    const st = window.setTimeout.bind(window);
                    const si = window.setInterval.bind(window);
                    window.setTimeout = ((...a: Parameters<typeof setTimeout>) => (w.__timers++, st(...a))) as typeof setTimeout;
                    window.setInterval = ((...a: Parameters<typeof setInterval>) => (w.__timers++, si(...a))) as typeof setInterval;
                });
                const framesBefore = await s.call<number>('requestedFrames');
                await Bun.sleep(3000);
                const frames = (await s.call<number>('requestedFrames')) - framesBefore;
                const timers = await s.page.evaluate(() => (window as unknown as { __timers: number }).__timers);
                expect(frames === 0, `${frames} frame callbacks were requested while nothing moved`);
                expect(timers === 0, `${timers} timers were set while nothing moved (the page bar polls its document?)`);

                // A child of the body that grows: the page bar sees it by observation, with no timer to ask.
                await s.page.evaluate(() => {
                    const grow = document.createElement('div');
                    grow.id = 'grow';
                    grow.style.cssText = 'position: relative; height: 100px; width: 10px';
                    document.body.appendChild(grow);
                });
                await Bun.sleep(300);
                const before: Box = await s.call('box', 'page', 'thumb-vertical');
                await s.page.evaluate(() => {
                    document.getElementById('grow')!.style.height = '20000px';
                });
                await Bun.sleep(500);
                const after: Box = await s.call('box', 'page', 'thumb-vertical');
                expect(after.height < before.height - 1, `the page thumb did not follow a growing document (${before.height} to ${after.height})`);
                const quiet = await s.page.evaluate(() => (window as unknown as { __timers: number }).__timers);
                expect(quiet === 0, `${quiet} timers were set while the document grew`);
            } finally {
                await s.close();
            }
        },
    },
    {
        name: 'hidden bars are paused: the parts of a bar nobody has seen draw nothing, the first show fades in, and the parts pause again after the fade out',
        run: async (t) => {
            const css = 'ax-scroll-view { --ax-scrollbar-idle-delay: 200ms; --ax-scrollbar-fade-in-duration: 400ms; --ax-scrollbar-fade-out-duration: 100ms; }';
            await t.call('plainMake', 'hp', css, { hide: '', horizontal: 'hidden', 'marker-selector': 'h2' }, '<div style="height: 3000px"><h2 style="margin: 0">A</h2><h2 style="margin: 900px 0 0">B</h2></div>');
            try {
                await t.frames(6);
                expect(await t.call<boolean>('partPaused', 'hp', 'thumb-vertical'), 'the thumb of a bar that has not shown is not paused');
                expect(await t.call<boolean>('partPaused', 'hp', 'button-end-vertical'), 'a button of a bar that has not shown is not paused');
                expect(await t.call<boolean>('partPaused', 'hp', 'marker:ax-marker-0'), 'a marker of a bar that has not shown is not paused');
                expect((await t.call<string>('inner', 'hp', 'thumb-vertical', '.layer-scrollbar-fill', 'class')) === '', 'a thumb that has not shown has built its layers');
                const sampling = t.call<[number, string][]>('sample', 'hp', 'thumb-vertical', '--ax-scrollbar-shown-opacity', 250);
                await t.sleep(40);
                await t.call('wake', 'hp');
                const rows = await sampling;
                const first = rows.findIndex((r) => parseFloat(r[1]) > 0);
                expect(first >= 0, 'the thumb never showed');
                const early = rows.filter((r) => parseFloat(r[1]) > 0).slice(0, 4).map((r) => parseFloat(r[1]));
                expect(early.length >= 3 && early[0] < 0.2 && early[early.length - 1] < 0.6, `the first show does not fade in: ${early}`);
                expect(!(await t.call<boolean>('partPaused', 'hp', 'thumb-vertical')), 'the thumb is paused while shown');
                // After the idle delay and the fade out, the parts pause again.
                await t.sleep(1000);
                expect(await t.call<boolean>('partPaused', 'hp', 'thumb-vertical'), 'the thumb did not pause after the fade out');
                expect(await t.call<boolean>('partPaused', 'hp', 'marker:ax-marker-0'), 'a marker did not pause after the fade out');
            } finally {
                await t.call('plainRemove', 'hp');
            }
        },
    },
];

// A scroll view of the accessibility checks, fixed in a corner and preceded and followed by a button,
// first in the page so that Tab reaches it before the other scrollers. `markers` gives it one marker.
async function mountA11y(t: Ctx, html: string, height = 600, markers = false): Promise<void> {
    await t.page.evaluate(
        ([content, tall, withMarkers]: [string, number, boolean]) => {
            const holder = document.createElement('div');
            holder.id = 'a11y-holder';
            holder.style.cssText = 'position:fixed;left:0;top:0;width:260px;z-index:99999;background:#fff';
            holder.innerHTML = `<button id="a11y-before">Before</button><ax-scroll-view id="a11y-view" style="position:relative;display:block;width:240px;height:150px"><div style="min-height:${tall}px">${content}</div></ax-scroll-view><button id="a11y-after">After</button>`;
            document.body.prepend(holder);
            if (withMarkers) {
                const view = document.getElementById('a11y-view') as any;
                view.markers = [{ element: view.querySelector('h2'), label: 'Marker label' }];
            }
        },
        [html, height, markers],
    );
    await t.call('frames', 3);
}

async function unmountA11y(t: Ctx): Promise<void> {
    await t.page.evaluate(() => document.getElementById('a11y-holder')?.remove());
    await t.page.mouse.move(5, 595);
}

// The tabindex attribute of the viewport of #a11y-view, null when it has none.
function viewportTabindex(t: Ctx): Promise<string | null> {
    return t.page.evaluate(() => ((document.getElementById('a11y-view') as any).shadowRoot.querySelector('.viewport') as HTMLElement).getAttribute('tabindex'));
}

// The focused element, through the shadow roots: tag, then #id or .class.
function focusPath(t: Ctx): Promise<string> {
    return t.page.evaluate(() => {
        let active: Element | null = document.activeElement;
        while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
        if (!active) return '';
        const tag = active.tagName.toLowerCase();
        if (tag === 'a' && !active.id) return 'a';
        return active.id ? `${tag}#${active.id}` : active.className ? `${tag}.${active.className}` : tag;
    });
}

// AX_CHECK=<regular expression> runs only the checks whose name matches.
if (process.env.AX_CHECK) {
    const only = new RegExp(process.env.AX_CHECK);
    checks.splice(0, checks.length, ...checks.filter((check) => only.test(check.name)));
}

// A button click, a track page and a programmatic scroll of #v land at once, with nothing drawn on the way.
async function instant(t: Ctx, what: string): Promise<void> {
    await t.reset();
    const c = centre(await t.box('v', 'button-end-vertical'));
    await t.page.mouse.move(c.x, c.y);
    await t.page.mouse.down();
    await t.page.mouse.up();
    expect((await t.call('scrollOf', 'v')).host === 40, `${what}: scrollTop right after a button click is ${(await t.call('scrollOf', 'v')).host}, want 40`);

    await t.reset();
    const area = await t.box('v', 'area-vertical');
    const before = await t.call('drawn', 'v');
    await t.call('setScroll', 'v', 900);
    await t.frames(1);
    const d = await t.call('drawn', 'v');
    near(d.thumbTop, (900 / MAX_V) * (area.height - before.thumbLength), 0.01, `${what}: thumb offset one frame after scrollTop = 900`);
}

// Plays the checks in one browser. Each check prints one line, then a summary line.
async function runBrowser(name: string): Promise<{ passed: number; total: number }> {
    const pw = (await import('playwright')) as any;
    // AX_BROWSER_PATH (or the NixOS system chromium, when present) instead of playwright's bundled build.
    const system = name === 'chromium' ? process.env.AX_BROWSER_PATH || (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : '') : '';
    const launch = system ? { executablePath: system } : {};
    let browser: any;
    try {
        browser = await pw[name].launch(launch);
    } catch (e) {
        console.log(`${name}: launch failed: ${String((e as Error).message).split('\n')[0]}`);
        return { passed: 0, total: checks.length };
    }
    try {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
        page.on('pageerror', (e: Error) => console.log(`PAGEERROR ${e.message.split('\n')[0]}`));
        await page.goto(`http://127.0.0.1:${server.port}/`);
        await page.waitForFunction(() => (window as any).axReady === true);

        const call = (fn: string, ...args: unknown[]) =>
            page.evaluate(([name, list]: [string, unknown[]]) => (window as any).axTest[name](...list), [fn, args]);
        // Parked outside every scroller and bar, so no hover state leaks between checks.
        const park = () => page.mouse.move(5, 595);
        const ctx: Ctx = {
            touch: async () => {
                throw new Error('touch context not ready');
            },
            scaled: async () => {
                throw new Error('scaled context not ready');
            },
            real: async () => {
                throw new Error('real context not ready');
            },
            page,
            call,
            box: (id, n) => call('box', id, n),
            tokens: (id, n) => call('tokens', id, n),
            frames: (n = 2) => call('frames', n),
            settle: () => call('settle'),
            sleep: (ms) => Bun.sleep(ms),
            park,
            async reset() {
                await page.mouse.up().catch(() => {});
                await park();
                await call('reset');
                await call('settle');
            },
        };

        ctx.scaled = async (dpr) => {
            const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
            const sp = await context.newPage();
            await sp.goto(`http://127.0.0.1:${server.port}/`);
            await sp.waitForFunction(() => (window as any).axReady === true);
            return {
                page: sp,
                call: (fn: string, ...args: unknown[]) => sp.evaluate(([n, list]: [string, unknown[]]) => (window as any).axTest[n](...list), [fn, args]),
                close: () => context.close(),
            };
        };

        ctx.real = async (dpr) => {
            const own = await pw[name].launch({ ...launch, args: [`--force-device-scale-factor=${dpr}`, '--window-size=1500,700', '--disable-gpu', '--disable-partial-raster'] });
            const context = await own.newContext({ viewport: null });
            const rp = await context.newPage();
            await rp.goto(`http://127.0.0.1:${server.port}/`);
            await rp.waitForFunction(() => (window as any).axReady === true);
            return {
                page: rp,
                call: (fn: string, ...args: unknown[]) => rp.evaluate(([n, list]: [string, unknown[]]) => (window as any).axTest[n](...list), [fn, args]),
                close: () => own.close(),
            };
        };

        let touchCtx: TouchCtx | null = null;
        ctx.touch = async () => {
            if (touchCtx) return touchCtx;
            const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, hasTouch: true });
            const tp = await context.newPage();
            await tp.goto(`http://127.0.0.1:${server.port}/`);
            await tp.waitForFunction(() => (window as any).axReady === true);
            const cdp = await context.newCDPSession(tp);
            const tcall = (fn: string, ...args: unknown[]) =>
                tp.evaluate(([n, list]: [string, unknown[]]) => (window as any).axTest[n](...list), [fn, args]);
            const touch = (type: string, points: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
            let last = { x: 0, y: 0 };
            touchCtx = {
                page: tp,
                call: tcall,
                box: (id, n) => tcall('box', id, n),
                tokens: (id, n) => tcall('tokens', id, n),
                frames: (n = 2) => tcall('frames', n),
                settle: () => tcall('settle'),
                sleep: (ms) => Bun.sleep(ms),
                async reset() {
                    await tcall('reset');
                    await tcall('settle');
                },
                async start(x, y) {
                    last = { x, y };
                    await touch('touchStart', [last]);
                },
                async move(x, y) {
                    last = { x, y };
                    await touch('touchMove', [last]);
                },
                async end() {
                    await touch('touchEnd', []);
                },
            };
            return touchCtx;
        };

        let passed = 0;
        for (const check of checks) {
            if (process.env.AX_ONLY && !check.name.includes(process.env.AX_ONLY)) continue;
            try {
                await check.run(ctx);
                passed++;
                console.log(`PASS ${check.name}`);
            } catch (e) {
                const message = (e as Error).message.split('\n')[0];
                console.log(`FAIL ${check.name}: ${message}`);
            }
        }
        console.log(`${name}: ${passed}/${checks.length} passed`);
        return { passed, total: checks.length };
    } finally {
        await browser.close();
    }
}

let failed = 0;
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium']) {
    const { passed, total } = await runBrowser(name);
    failed += total - passed;
}
server.stop();
process.exit(failed ? 1 : 0);
