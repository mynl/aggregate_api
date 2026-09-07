/**
 * The scroll policy, in one place (author's rule, 2026-09-06; mechanics a147).
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
 *                       group tab strip tops the page, but DOWN ONLY: a reader
 *                       already at or past the strip is reading content, and
 *                       the page stays where it is. `anchorNav()`.
 *
 * Everything else moves the page not at all: typing, page load, the landing
 * and examples auto-builds, and every form inside a pane (the pricing forms,
 * the ruin Draw and Sample buttons, the bounds form, quick re). The reader
 * operating a form is already looking at it. That rule is closed: a new
 * in-pane control gets no scroll call unless it is a view pill, in which case
 * it gets `anchorNav()` and nothing else.
 *
 * One scroll per gesture, fired at gesture time, and none after. The a145/a146
 * two-pass mechanism (scroll now, scroll again when the fetch settles) existed
 * because a pane swap collapsed the document below the scroll target and the
 * browser clamped the first pass. The `.tab-content` floor in site.css keeps
 * both targets reachable at every moment, so the settle pass, and with it
 * every way a late scroll could yank the reader, is gone.
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
 * Navigation gesture: the group tab strip leads, down only.
 *
 * If the reader is already at or below the strip's anchor point the page does
 * not move: they have scrolled into content and the gesture only swaps what
 * the content is.
 */
export function anchorNav() {
    const strip = document.querySelector('.out-tabs');
    if (!strip) return;
    const target = targetFor(strip);
    if (window.scrollY >= target - EPS) return;
    window.scrollTo({ top: target, behavior: 'smooth' });
}
