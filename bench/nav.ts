// Client-side navigation from the home page of a site to a page with a page scrollbar, measured by CDP:
// long tasks during it, and the time until the thumb of the page bar is the right size and stays so.
//   bun bench/nav.ts <base url> [path]      e.g. bun bench/nav.ts http://127.0.0.1:4000 /components/scrollbar/
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const base = (process.argv[2] || '').replace(/\/$/, '');
const path = process.argv[3] || '/components/scrollbar/';
if (!base) throw new Error('usage: bun bench/nav.ts <base url> [path]');
const system = process.env.AX_BROWSER_PATH || (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : '');
const browser = await chromium.launch(system ? { executablePath: system } : {});

async function once(withProfile: boolean) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // WITHOUT=ax-scroll-view,ax-scrollbar: those elements are never defined, to see what the page costs without them.
    await page.addInitScript((without: string) => {
        const skip = new Set(without.split(',').filter(Boolean));
        const define = customElements.define.bind(customElements);
        customElements.define = ((name: string, ...rest: any[]) => (skip.has(name) ? undefined : (define as any)(name, ...rest))) as any;
    }, process.env.WITHOUT || '');
    await page.addInitScript(() => {
        const w = window as any;
        w.__long = [];
        new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__long.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(base + '/', { waitUntil: 'load' });
    // The start screen of the site comes in after its welcome: wait for the tile, then for things to calm down.
    await page.waitForFunction((id) => { const t = document.querySelector(`[data-id^="${id}"]`); return !!t && getComputedStyle(t).visibility !== 'hidden'; }, path.replace(/\/$/, ''), { timeout: 30000 });
    await page.waitForTimeout(3000);
    const cdp = await context.newCDPSession(page);
    if (withProfile) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
        await cdp.send('Profiler.start');
    }
    // The watcher starts before the click; the clock is the click's.
    await page.evaluate(() => {
        const w = window as any;
        w.__long.length = 0;
        w.__t0 = performance.now();
        w.__trace = [];
        const check = () => {
            const bar = document.querySelector('ax-scrollbar') as HTMLElement | null;
            const root = bar && bar.shadowRoot;
            const el = document.scrollingElement as HTMLElement;
            // The axis whose bar is shown (a spread page scrolls sideways).
            const states = (axis: string) => (bar!.getAttribute(`${axis}-state`) || '').split(' ');
            const vertical = states('vertical').includes('visible');
            const horizontal = states('horizontal').includes('visible');
            if (!root || (!vertical && !horizontal)) return { ok: false, thumb: -1, want: -1 };
            const v = vertical;
            const thumb = root.querySelector(`.bar.${v ? 'v' : 'h'} .thumb`) as HTMLElement | null;
            const area = root.querySelector(`.bar.${v ? 'v' : 'h'} .area`) as HTMLElement | null;
            if (!thumb || !area) return { ok: false, thumb: -1, want: -1 };
            const track = v ? area.clientHeight : area.clientWidth;
            const client = v ? el.clientHeight : el.clientWidth;
            const size = v ? el.scrollHeight : el.scrollWidth;
            // The thumb is right when it is the length of the track times client / size (not less than the minimum).
            const want = Math.min(track, Math.max(Math.min(48, track), (track * client) / Math.max(size, 1)));
            const r = thumb.getBoundingClientRect();
            const got = v ? r.height : r.width;
            return { ok: track > 0 && Math.abs(got - want) <= 1.5, thumb: got, want };
        };
        const tick = () => {
            w.__trace.push({ t: performance.now() - w.__t0, path: location.pathname, ...check() });
            if (performance.now() - w.__t0 < 8000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    await page.locator(`[data-id^="${path.replace(/\/$/, '')}"]`).first().click();
    await page.waitForFunction(() => performance.now() - (window as any).__t0 > 8100, undefined, { timeout: 20000 });
    const result = await page.evaluate((target) => {
        const w = window as any;
        const trace = w.__trace as { t: number; path: string; ok: boolean; thumb: number; want: number }[];
        // From the frames on the new page: right from this time to the end.
        const arrived = trace.findIndex((e) => e.path.replace(/\/$/, '') === target.replace(/\/$/, ''));
        let from = trace.length;
        while (from > 0 && trace[from - 1].ok) from--;
        const long = (w.__long as { start: number; duration: number }[]).filter((l) => l.start >= w.__t0 - 1).map((l) => Math.round(l.duration));
        return { arrivedMs: arrived < 0 ? null : Math.round(trace[arrived].t), thumbRightFromMs: from >= trace.length ? null : Math.round(trace[from].t), final: trace[trace.length - 1], long };
    }, path);
    let top: string[] = [];
    let attributed: any = null;
    if (withProfile) {
        const { profile } = await cdp.send('Profiler.stop');
        const nodes = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
        const parent = new Map<number, number>();
        for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
        // The scripts of the package: those that mention its tokens.
        const urls = new Set<string>(profile.nodes.map((n: any) => n.callFrame.url).filter(Boolean));
        const own = new Set<string>();
        for (const u of urls) {
            try {
                if ((await (await fetch(u)).text()).includes('--ax-scrollbar-shown-glyph-scale')) own.add(u);
            } catch {}
        }
        const inPackage = new Map<number, boolean>();
        const has = (id: number): boolean => {
            let known = inPackage.get(id);
            if (known !== undefined) return known;
            const node = nodes.get(id);
            known = own.has(node.callFrame.url) || (parent.has(id) ? has(parent.get(id)!) : false);
            inPackage.set(id, known);
            return known;
        };
        const self = new Map<string, number>();
        let total = 0;
        let run = 0;
        let longest = 0;
        for (let i = 0; i < profile.samples.length; i++) {
            const id = profile.samples[i];
            const cf = nodes.get(id).callFrame;
            const dt = (profile.timeDeltas[i] || 0) / 1000;
            if (['(idle)', '(program)', '(root)'].includes(cf.functionName)) {
                run = 0;
                continue;
            }
            if (has(id)) {
                total += dt;
                run += dt;
                longest = Math.max(longest, run);
                // The package function closest to the leaf of the stack, and what it called into.
                let at: number | undefined = id;
                while (at !== undefined && !own.has(nodes.get(at).callFrame.url)) at = parent.get(at);
                const pf = nodes.get(at!).callFrame;
                const key = `${pf.functionName || '(anon)'} ${pf.url.split('/').pop()}:${pf.lineNumber} > ${cf.functionName || '(anon)'}`;
                self.set(key, (self.get(key) || 0) + dt);
            } else run = 0;
        }
        attributed = { scripts: [...own].map((u) => u.split('/').pop()), packageInclusiveMs: Math.round(total), longestPackageBlockMs: Math.round(longest) };
        top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${v.toFixed(1)}ms ${k}`);
    }
    await context.close();
    return { ...result, top, attributed };
}

const runs = [];
for (let i = 0; i < 3; i++) runs.push(await once(false));
const profiled = await once(true);
console.log(JSON.stringify({ base, path, runs: runs.map(({ top, ...r }) => r), profiled: { attributed: profiled.attributed, top: profiled.top } }, null, 1));
await browser.close();
process.exit(0);
