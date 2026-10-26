// Performance benchmark of the scrollbar, driven by CDP.
//   bun bench/run.ts [label]      prints a JSON result and writes bench/results-<label>.json
// 20 <ax-scroll-view> (default look, markers): rAF callbacks and timers at idle, main-thread frame
// time while one view is wheel-scrolled, scripting and long tasks while the views mount.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dir = import.meta.dir;
const label = process.argv[2] || 'run';
const out = join(dir, 'dist');
const built = await Bun.build({ entrypoints: [join(dir, 'page.html')], outdir: out, conditions: ['source'] });
if (!built.success) throw new Error(built.logs.join('\n'));
const jsFiles = built.outputs.filter((o) => o.path.endsWith('.js')).map((o) => o.path);

// Module of each line of the bundles (Bun marks a module with a `// path` comment).
type LineMap = { file: string; starts: { line: number; module: string }[] };
const maps: LineMap[] = [];
for (const file of jsFiles) {
    const starts: LineMap['starts'] = [];
    (await Bun.file(file).text()).split('\n').forEach((text, i) => {
        const m = /^\/\/ (\S+\.(?:ts|js|mjs))$/.exec(text);
        if (m) starts.push({ line: i, module: m[1] });
    });
    maps.push({ file: file.split('/').pop()!, starts });
}
const moduleOf = (url: string, line: number): string => {
    const name = url.split('/').pop()!.split('?')[0];
    const map = maps.find((m) => m.file === name);
    if (!map) return url ? `other:${name}` : '(native)';
    let found = '(bundle)';
    for (const s of map.starts) {
        if (s.line <= line) found = s.module;
        else break;
    }
    return found;
};
// The package is the scrollbar's own sources (not its dependencies).
const isPackage = (module: string): boolean => /(^|\/)scrollbar\/src\//.test(module) || /^(\.\.\/)*src\//.test(module) || /^\.\.\/src\//.test(module);

const server = Bun.serve({
    port: 0,
    fetch(req) {
        const path = new URL(req.url).pathname;
        const file = Bun.file(join(out, path === '/' ? 'page.html' : path));
        return file.size ? new Response(file) : new Response('', { status: 404 });
    },
});
const url = `http://127.0.0.1:${server.port}/`;

const system = process.env.AX_BROWSER_PATH || (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : '');
const browser = await chromium.launch(system ? { executablePath: system } : {});

// Counters installed before any script: frame callbacks and timers, optionally with the stack that asked.
const INSTRUMENT = (capture: boolean) => `
(() => {
    const c = window.__c = { raf: 0, rafRun: 0, timeout: 0, interval: 0, stacks: [], long: [] };
    const stack = () => (${capture} ? new Error().stack : '');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
        c.raf++;
        const s = stack();
        if (s) c.stacks.push({ kind: 'raf', stack: s });
        return raf((t) => { c.rafRun++; cb(t); });
    };
    const st = window.setTimeout.bind(window);
    window.setTimeout = (...a) => { c.timeout++; const s = stack(); if (s) c.stacks.push({ kind: 'timeout', stack: s }); return st(...a); };
    const si = window.setInterval.bind(window);
    window.setInterval = (...a) => { c.interval++; const s = stack(); if (s) c.stacks.push({ kind: 'interval', stack: s }); return si(...a); };
    try {
        new PerformanceObserver((list) => { for (const e of list.getEntries()) c.long.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
    } catch {}
})();
`;

async function open(capture = false, query = '') {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(INSTRUMENT(capture));
    await page.goto(url + query);
    await page.waitForFunction(() => (window as any).benchReady === true);
    const cdp = await context.newCDPSession(page);
    return { context, page, cdp };
}

const counters = (page: any) => page.evaluate(() => { const { stacks, long, ...rest } = (window as any).__c; return { ...rest, stacks: stacks.length }; });
const resetCounters = (page: any) => page.evaluate(() => { const c = (window as any).__c; c.raf = c.rafRun = c.timeout = c.interval = 0; c.stacks.length = 0; });

// Stack frames of the page's bundle, as modules.
function stackModules(stack: string): string[] {
    const list: string[] = [];
    for (const m of stack.matchAll(/\(?(https?:\/\/[^\s)]+?):(\d+):\d+\)?/g)) list.push(moduleOf(m[1], Number(m[2]) - 1));
    return list;
}

// ---- Tracing ---------------------------------------------------------------------------------

interface TraceEvent { name: string; ph: string; ts: number; dur?: number; pid: number; tid: number; cat: string; args?: any }

async function trace(cdp: any, run: () => Promise<void>): Promise<TraceEvent[]> {
    const events: TraceEvent[] = [];
    cdp.on('Tracing.dataCollected', (e: { value: TraceEvent[] }) => events.push(...e.value));
    const done = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'blink.user_timing'] } });
    await run();
    await cdp.send('Tracing.end');
    await done;
    return events;
}

// The renderer main thread: the CrRendererMain thread with the most tasks.
function mainThread(events: TraceEvent[]): { pid: number; tid: number } {
    const names = new Map<string, string>();
    for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
    const counts = new Map<string, number>();
    for (const e of events) {
        if (e.name !== 'RunTask' || names.get(`${e.pid}:${e.tid}`) !== 'CrRendererMain') continue;
        counts.set(`${e.pid}:${e.tid}`, (counts.get(`${e.pid}:${e.tid}`) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const [pid, tid] = best[0].split(':').map(Number);
    return { pid, tid };
}

const percentile = (values: number[], p: number): number => {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const round = (n: number, d = 2): number => Number(n.toFixed(d));

// ---- Phases ----------------------------------------------------------------------------------

// Idle: after the mount has settled, nothing moves for 5 s.
async function idle(query = '') {
    const { context, page } = await open(true, query);
    await page.evaluate(() => (window as any).bench.mount());
    await Bun.sleep(4000);
    const settle = await counters(page);
    await resetCounters(page);
    await Bun.sleep(5000);
    const c = await page.evaluate(() => (window as any).__c);
    const attributed = (kind: string) => c.stacks.filter((s: any) => s.kind === kind && stackModules(s.stack).some(isPackage)).length;
    const result = {
        settleRafCallbacks: settle.rafRun,
        idleRafRequests: c.raf,
        idleRafCallbacks: c.rafRun,
        idleRafFromPackage: attributed('raf'),
        idleTimeouts: c.timeout,
        idleTimeoutsFromPackage: attributed('timeout'),
        idleIntervals: c.interval,
    };
    await context.close();
    return result;
}

// Mount: scripting of the package (Profiler self time) while 20 views are created and settle.
async function mount() {
    const { context, page, cdp } = await open(false);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
    const events = await trace(cdp, async () => {
        await cdp.send('Profiler.start');
        await page.evaluate(() => (window as any).bench.mount());
        await Bun.sleep(2000);
    });
    const { profile } = await cdp.send('Profiler.stop');
    const nodes = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
    const self = new Map<string, number>();
    const fns = new Map<string, number>();
    let total = 0;
    for (let i = 0; i < profile.samples.length; i++) {
        const node = nodes.get(profile.samples[i]);
        const dt = (profile.timeDeltas[i] || 0) / 1000;
        const cf = node.callFrame;
        if (cf.functionName === '(idle)' || cf.functionName === '(program)' || cf.functionName === '(root)') continue;
        const module = cf.functionName === '(garbage collector)' ? '(gc)' : cf.url ? moduleOf(cf.url, cf.lineNumber) : '(native)';
        self.set(module, (self.get(module) || 0) + dt);
        const key = `${cf.functionName || '(anon)'} ${module}:${cf.lineNumber}`;
        fns.set(key, (fns.get(key) || 0) + dt);
        total += dt;
    }
    if (process.env.BENCH_PROFILE) console.log([...fns.entries()].filter(([k]) => /src\//.test(k) && !/\.\.\//.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(1)}ms ${k}`).join('\n'));
    let pkg = 0;
    const byModule: Record<string, number> = {};
    for (const [m, ms] of [...self.entries()].sort((a, b) => b[1] - a[1])) {
        if (isPackage(m)) pkg += ms;
        if (byModule && Object.keys(byModule).length < 12) byModule[m] = round(ms);
    }
    const { pid, tid } = mainThread(events);
    const tasks = events.filter((e) => e.name === 'RunTask' && e.pid === pid && e.tid === tid && e.dur !== undefined);
    const mainBusy = tasks.reduce((s, e) => s + e.dur! / 1000, 0);
    const longTasks = tasks.filter((e) => e.dur! > 50000).map((e) => round(e.dur! / 1000, 1));
    const observed = await page.evaluate(() => (window as any).__c.long.map((l: any) => Math.round(l.duration)));
    await context.close();
    return {
        packageScriptingMs: round(pkg),
        allScriptingMs: round(total),
        topModules: byModule,
        mainThreadBusyMs: round(mainBusy),
        longTasksOver50ms: longTasks,
        observedLongTasks: observed,
    };
}

// Wheel: 3 s of continuous wheel events over one view; main-thread time per frame.
async function wheel(query = '') {
    const { context, page, cdp } = await open(false, query);
    await page.evaluate(() => (window as any).bench.mount());
    await Bun.sleep(2500);
    const box = await page.evaluate(() => { const r = document.getElementById('v0')!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(box.x, box.y);
    await Bun.sleep(300);
    await resetCounters(page);
    const profiling = !!process.env.BENCH_PROFILE;
    if (profiling) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
        await cdp.send('Profiler.start');
    }
    const events = await trace(cdp, async () => {
        const end = performance.now() + 3000;
        let down = true;
        let travelled = 0;
        while (performance.now() < end) {
            const step = 40;
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: down ? step : -step });
            travelled += down ? step : -step;
            if (travelled > 8000) down = false;
            if (travelled < 0) down = true;
            await Bun.sleep(16);
        }
        await Bun.sleep(200);
    });
    if (profiling) {
        const { profile } = await cdp.send('Profiler.stop');
        const nodes = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
        const fns = new Map<string, number>();
        for (let i = 0; i < profile.samples.length; i++) {
            const cf = nodes.get(profile.samples[i]).callFrame;
            if (['(idle)', '(program)', '(root)'].includes(cf.functionName)) continue;
            const key = `${cf.functionName || '(anon)'} ${cf.url ? moduleOf(cf.url, cf.lineNumber) : ''}`;
            fns.set(key, (fns.get(key) || 0) + (profile.timeDeltas[i] || 0) / 1000);
        }
        console.log([...fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(1)}ms ${k}`).join('\n'));
    }
    const c = await counters(page);
    const { pid, tid } = mainThread(events);
    const main = events.filter((e) => e.pid === pid && e.tid === tid);
    const tasks = main.filter((e) => e.name === 'RunTask' && e.dur !== undefined).sort((a, b) => a.ts - b.ts);
    const breakdown: Record<string, number> = {};
    for (const name of ['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'FireAnimationFrame', 'FunctionCall', 'EventDispatch', 'IntersectionObserverController::computeIntersections', 'HitTest', 'ScrollLayer', 'UpdateLayer', 'RunTask']) {
        breakdown[name] = round(main.filter((e) => e.name === name && e.dur !== undefined).reduce((a, e) => a + e.dur! / 1000, 0), 1);
    }
    if (process.env.BENCH_PROFILE) console.log(breakdown);
    // A frame is the span from one commit to the next; its time is the main-thread task time inside it
    // (the input events, the frame callbacks, style, layout and paint that led to the commit).
    const commits = main.filter((e) => e.name === 'Commit').map((e) => e.ts + (e.dur || 0)).sort((a, b) => a - b);
    const frames: number[] = [];
    for (let i = 1; i < commits.length; i++) {
        const from = commits[i - 1];
        const to = commits[i];
        let busy = 0;
        for (const t of tasks) {
            const s = Math.max(t.ts, from);
            const e = Math.min(t.ts + t.dur!, to);
            if (e > s) busy += e - s;
        }
        frames.push(busy / 1000);
    }
    const longTasks = tasks.filter((e) => e.dur! > 50000).length;
    await context.close();
    return {
        frames: frames.length,
        frameMsP50: round(percentile(frames, 50)),
        frameMsP95: round(percentile(frames, 95)),
        frameMsMax: round(Math.max(0, ...frames)),
        rafCallbacks: c.rafRun,
        timers: c.timeout + c.interval,
        longTasksOver50ms: longTasks,
    };
}

if (process.env.BENCH_ONLY === 'mount') {
    console.log(JSON.stringify(await mount(), null, 2));
    await browser.close();
    process.exit(0);
}
if (process.env.BENCH_ONLY === 'wheel') {
    console.log(JSON.stringify(await wheel(process.env.BENCH_QUERY || ''), null, 2));
    await browser.close();
    process.exit(0);
}
// The run with the median of a metric out of `n` runs (a machine is noisy).
async function median<T>(n: number, run: () => Promise<T>, key: (r: T) => number): Promise<T & { runs: number[] }> {
    const results: T[] = [];
    for (let i = 0; i < n; i++) results.push(await run());
    results.sort((a, b) => key(a) - key(b));
    return { ...results[Math.floor(n / 2)], runs: results.map((r) => round(key(r))) };
}
const result = {
    label,
    idle: await idle(),
    idleWithPageScrollbar: await idle('?page'),
    mount: await median(5, mount, (r) => r.packageScriptingMs),
    wheel: await median(5, () => wheel(), (r) => r.frameMsP95),
};
await Bun.write(join(dir, `results-${label}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
await browser.close();
server.stop();
process.exit(0);
