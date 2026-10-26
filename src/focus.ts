// Keyboard focus of a scroll container: it takes focus with tabindex="0" only while nothing inside
// it can, so a text-only region stays scrollable by keys (WCAG 2.1.1) and a region with links or
// buttons adds no Tab stop of its own: focus goes into the content and the keys scroll from there.

// What makes content focusable without a tabindex.
const NATIVE = 'a[href], button, input, select, textarea, summary, iframe, audio[controls], video[controls]';
// Elements that need a tabindex or contenteditable to take focus, checked one by one below.
const CANDIDATES = `${NATIVE}, [tabindex], [contenteditable]`;
// The attributes that can change what takes focus.
const FOCUS_ATTRIBUTES = ['tabindex', 'href', 'disabled', 'contenteditable', 'controls', 'type'];

// Whether one element of the content can take focus.
function takesFocus(el: Element): boolean {
    const tab = el.getAttribute('tabindex');
    const index = tab === null ? NaN : parseInt(tab, 10);
    // -1 is out of the Tab order, so it does not count, not even for a link.
    if (index < 0) return false;
    // A disabled control cannot take focus, and a hidden input is not in the page at all.
    if (el.matches(':disabled') || el.matches('input[type="hidden"]')) return false;
    // An explicit tabindex, a native control, or editable content.
    return !isNaN(index) || el.matches(NATIVE) || (el instanceof HTMLElement && el.isContentEditable);
}

function hasFocusableContent(host: Element): boolean {
    const list = host.querySelectorAll(CANDIDATES);
    for (let i = 0; i < list.length; i++) if (takesFocus(list[i])) return true;
    return false;
}

// Keeps the tabindex of `viewport` right for the light DOM content of `host`, now and whenever the
// content changes. Returns the function that stops watching.
export function watchFocus(host: Element, viewport: HTMLElement): () => void {
    const sync = (): void => {
        if (hasFocusableContent(host)) viewport.removeAttribute('tabindex');
        else viewport.setAttribute('tabindex', '0');
    };
    const observer = new MutationObserver(sync);
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: FOCUS_ATTRIBUTES });
    sync();
    return () => observer.disconnect();
}
