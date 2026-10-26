import { register } from '@ax-design/scrollbar';
import { bindScroll } from '@ax-design/scroll';
import { registerAcrylicLayer } from '@ax-design/acrylic';
import { adoptLunaSchemes, defineLunaKit } from '@ax-design/scrollbar/kits/luna';

register();
// The Luna kit is defined by name; the elements pick it with kit="luna". Its colour schemes are classes
// (luna-blue ...) that the page adopts.
defineLunaKit();
adoptLunaSchemes();
// The acrylic layer of Windows 11: the track names it among its layers (track-layers).
registerAcrylicLayer();

// The variants of the Windows 11 look (win11.css sets what a variant changes, on the parts and on the host; here is what
// only an attribute can set): Default is the auto-hiding bar, Minimal the indicator alone, Full the bar permanently expanded.
type Win11Variant = 'default' | 'minimal' | 'full';
const WIN11: Record<Win11Variant, { hide: string; touchInput: boolean; indicator: 'auto' | 'near' | 'pinned'; note: string }> = {
    default: {
        hide: 'button:touch track:touch corner:touch',
        touchInput: false,
        indicator: 'auto',
        note: 'Default: the scrollbar of native Windows 11 apps (WinUI ScrollBar). Nothing at rest; a 2px line shows when the pointer moves over the list, and over the bar it grows into thumb, acrylic track and arrows after 400ms.',
    },
    minimal: {
        hide: 'button track corner',
        touchInput: true,
        indicator: 'near',
        note: 'Minimal: the Fluent overlay scrollbar of Chrome and Edge in minimal mode (Chromium source). A thumb alone, shown by scrolling or by the pointer at the bar, 4px thin at the edge, 9px and darker under the pointer; it fades after 750ms.',
    },
    full: {
        hide: 'button:touch track:touch corner:touch',
        touchInput: false,
        indicator: 'pinned',
        note: 'Full: Settings > Accessibility > Always show scrollbars (WinUI ScrollBar, expanded): the 6px thumb, acrylic track and arrows are always there.',
    },
};

const win11Views = Array.from(document.querySelectorAll<HTMLElement>('ax-scroll-view.win11'));

function setWin11(el: HTMLElement, variant: Win11Variant): void {
    el.dataset.variant = variant;
    el.setAttribute('hide', WIN11[variant].hide);
    el.toggleAttribute('touch-input', WIN11[variant].touchInput);
    el.setAttribute('indicator', WIN11[variant].indicator);
    if (el === win11Views[0]) {
        const note = document.getElementById('win11-variant-note');
        if (note) note.textContent = WIN11[variant].note;
    }
}

const win11Variant = document.getElementById('win11-variant') as HTMLSelectElement;
win11Variant.addEventListener('change', () => win11Views.forEach((view) => setWin11(view, win11Variant.value as Win11Variant)));
win11Views.forEach((view) => setWin11(view, win11Variant.value as Win11Variant));

// The hub scrolls sideways with the wheel, as the Start screen does.
const hub = document.querySelector<HTMLElement & { viewport: HTMLElement }>('ax-scroll-view.hub');
if (hub) bindScroll(hub.viewport);

// One page scrollbar at a time, with the look of the select: Windows 8 is the default look (nothing set), Minimal, Windows 11
// and Cyber Punk are the default parts styled with ::part() by minimal.css, win11.css (an acrylic layer on the track, three
// variants) and cyberpunk.css (a class each), Windows XP is a kit.
const select = document.getElementById('page-theme') as HTMLSelectElement;
let pageBar: HTMLElement | null = null;

function setPageBar(): void {
    pageBar?.remove();
    pageBar = null;
    const bar = document.createElement('ax-scrollbar');
    bar.setAttribute('marker-selector', 'h2');
    bar.setAttribute('marker-align', 'center');
    if (select.value !== 'win8') bar.setAttribute('touch-input', '');
    if (select.value === 'minimal') {
        bar.className = 'minimal';
        bar.setAttribute('hide', 'button');
    }
    if (select.value === 'cyber') {
        bar.className = 'cyber';
        bar.setAttribute('hide', 'button');
    }
    if (select.value.startsWith('win11-')) {
        bar.className = 'win11';
        bar.setAttribute('track-layers', 'scrollbar-fill acrylic');
        setWin11(bar, select.value.slice(6) as Win11Variant);
    }
    if (select.value === 'luna') bar.setAttribute('kit', 'luna');
    // Pixel themes (Windows 8, XP, Cyber Punk) snap to device pixels; Windows 11 and Minimal are vector.
    if (select.value !== 'minimal' && !select.value.startsWith('win11-')) bar.setAttribute('snap', '');
    document.body.append(bar);
    pageBar = bar;
}

select.addEventListener('change', setPageBar);
setPageBar();

// The Luna scheme is one class on the body: the XP window and an XP page scrollbar follow it.
const scheme = document.getElementById('luna-scheme') as HTMLSelectElement;
scheme.addEventListener('change', () => {
    document.body.className = `luna-${scheme.value}`;
});
