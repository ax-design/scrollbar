// Benchmark page: 20 <ax-scroll-view> with the default look and markers. Nothing is mounted until
// the driver calls window.bench.mount(), so the driver can measure the mount.
import { register } from '../src/index.js';

register();

const COUNT = 20;
const HEADINGS = 12;

function make(i: number): HTMLElement {
    // ?plain: the same content in plain scrolling divs, the floor of the platform.
    const view = document.createElement(location.search.includes('plain') ? 'div' : 'ax-scroll-view');
    if (location.search.includes('plain')) view.style.cssText = 'width:300px;height:200px;overflow:auto;background:#f4f4f4';
    view.id = `v${i}`;
    const hide = new URLSearchParams(location.search).get('hide');
    if (hide) view.setAttribute('hide', hide);
    view.setAttribute('marker-selector', 'h3');
    const tall = document.createElement('div');
    tall.className = 'tall';
    for (let k = 0; k < HEADINGS; k++) {
        const h = document.createElement('h3');
        h.id = `v${i}-h${k}`;
        h.style.top = `${k * 1600}px`;
        h.textContent = `Section ${k}`;
        tall.appendChild(h);
    }
    view.appendChild(tall);
    return view;
}

(window as any).bench = {
    mount(): void {
        const grid = document.getElementById('grid')!;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < COUNT; i++) fragment.appendChild(make(i));
        grid.appendChild(fragment);
        // ?page: the page scrollbar too, over a document that scrolls.
        if (location.search.includes('page')) {
            grid.style.height = '3000px';
            document.body.appendChild(document.createElement('ax-scrollbar'));
        }
    },
    unmount(): void {
        document.getElementById('grid')!.textContent = '';
    },
};
(window as any).benchReady = true;
