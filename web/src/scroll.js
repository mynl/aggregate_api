/**
 * The scroll policy, in one place (author's rule, 2026-09-06; mechanics a147,
 * the clamp and the settled anchor a150).
 *
 * The page repositions for exactly two kinds of gesture, and never otherwise:
 *
 *   program gesture     Build, Ctrl+Enter, Reformat, the Occ/Reins/GCN derive
 *                       buttons, picking an example (menu, palette, Ctrl+Shift
 *                       ring). The editor box tops the page, always, in both
 *                       directions: these gestures mean "start reading from
 *                       the program". `anchorEditor()`.
 *
 *   navigation gesture  a group tab, a sub-tab, an in-pane view pill. The
 *                       page scrolls DOWN ONLY, and only as far as it must:
 *                       to the first of the group tab strip topping the page
 *                       or the exhibit's bottom edge coming into view. A tall
 *                       exhibit gets the full strip-at-top anchor; a short
 *                       one stops the moment it is fully visible; a reader
 *                       already at or past the target is reading content, and
 *                       the page stays where it is. `anchorNav(pane)`, via
 *                       `anchorNavSettled` when the gesture loads content.
 *
 * Everything else moves the page not at all: typing, page load, the landing
 * and examples auto-builds, and every form inside a pane (the pricing forms,
 * the ruin Draw and Sample buttons, the bounds form, quick re). The reader
 * operating a form is already looking at it. That rule is closed: a new
 * in-pane control gets no scroll call unless it is a view pill, in which case
 * it gets the navigation anchor and nothing else.
 *
 * One scroll per gesture, fired once the gesture's content is in place, and
 * none after. The clamp is defined on post-load geometry, so a gesture that
 * fetches waits for its loader before measuring (`anchorNavSettled`); a pane
 * already rendered resolves in a microtask and the scroll fires effectively
 * at gesture time. The a145/a146 two-pass mechanism (scroll now, scroll again
 * when the fetch settles) was removed at a147 for three defects, and each has
 * a specific answer here: the `.tab-content` floor in site.css keeps the strip
 * target reachable while panes swap, and the pane-bottom clamp is by
 * construction within the document once the content it measures exists; the
 * measurement waits for the loader plus two animation frames, so the DOM it
 * reads has laid out and painted; and a reader who scrolls between gesture
 * and settle has taken control, so the deferred anchor is skipped.
 *
 * `behavior: 'smooth'` is deliberate: with reachable targets the animation
 * completes, and a reader's wheel or touch input cancelling it mid-glide is
 * the reader taking control, which is correct.
 */

/* A reader within this many pixels of the target counts as already there, so
   sub-pixel layout differences do not produce a two-pixel crawl. */
const EPS = 2;

/** Gap between the sticky header's bottom edge and the anchored element. */
const BREATH = 6;

/* At settle, a reader who has scrolled more than this many pixels since the
   gesture has taken control, and the deferred anchor is skipped. Tuned at
   kick-the-tires (plan a150). */
const READER_MOVED = 24;

/**
 * Document-space scroll offset that puts `el`'s top just under the sticky
 * header, floored at zero.
 */
function targetFor(el) {
    const header = document.querySelector('header.sticky-top');
    const top = el.getBoundingClientRect().top + window.scrollY
        - (header ? header.offsetHeight : 0) - BREATH;
    return Math.max(0, top);
}

/** Program gesture: the editor box leads. Scrolls in both directions. */
export function anchorEditor() {
    const box = document.getElementById('editor-box');
    if (!box) return;
    window.scrollTo({ top: targetFor(box), behavior: 'smooth' });
}

/**
 * Navigation gesture: down only, and only as far as there is something to see.
 *
 * The target is the strip-at-top anchor clamped by the offset that brings the
 * bottom of `pane` into view, whichever asks for less scroll. If the reader is
 * already at or below that target the page does not move: either the exhibit's
 * bottom is already visible, or they have scrolled into content and the
 * gesture only swaps what the content is.
 *
 * Parameters
 * ----------
 * pane : Element, optional
 *     The active `.tab-pane` wrapping the gesture's content. Its bottom edge
 *     caps the scroll, so a short exhibit stops the moment it is fully
 *     visible. The pane, not the document, is what "bottom of the page"
 *     measures: the `.tab-content` floor in site.css pads the document a full
 *     viewport below short content to keep targets reachable, so the document
 *     bottom means nothing. With no pane the clamp drops and the strip anchor
 *     stands alone, the pre-a150 behavior.
 */
export function anchorNav(pane) {
    const strip = document.querySelector('.out-tabs');
    if (!strip) return;
    let target = targetFor(strip);
    if (pane) {
        const bottom = pane.getBoundingClientRect().bottom + window.scrollY
            - window.innerHeight + BREATH;
        target = Math.max(0, Math.min(target, bottom));
    }
    if (window.scrollY >= target - EPS) return;
    window.scrollTo({ top: target, behavior: 'smooth' });
}

/**
 * Navigation gesture whose content is still loading: anchor once it settles.
 *
 * Awaits `loading`, then two animation frames so the DOM the loader built has
 * laid out and painted, then anchors clamped to `pane`. A rejected `loading`
 * still anchors: the error node the loader rendered is then the content to
 * read. If the reader has scrolled more than `READER_MOVED` pixels since
 * `gestureY`, they have taken control and the anchor is skipped.
 *
 * Parameters
 * ----------
 * pane : Element
 *     The active `.tab-pane`, passed through to `anchorNav`.
 * loading : Promise
 *     The gesture's load; the anchor fires when it settles. For a pane
 *     already rendered this resolves in a microtask and the scroll fires
 *     effectively at gesture time.
 * gestureY : number, optional
 *     `window.scrollY` at gesture time. Defaults to the value at call time,
 *     which is gesture time at every call site except the group tabs, where
 *     the pending-gesture token in main.js carries it.
 */
export async function anchorNavSettled(pane, loading, gestureY = window.scrollY) {
    try { await loading; } catch { /* the error pane is the content to read */ }
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    if (Math.abs(window.scrollY - gestureY) > READER_MOVED) return;
    anchorNav(pane);
}
