// The `data-why` footnote: one node, and the clamp that keeps it on screen.
//
// The page has one hand rolled tooltip and it is used in three places: the dark
// group tabs, the dark sub-tab leaves, and the approximation pill that cannot
// be plotted. Every one of them carries `data-why`, which is set exactly when
// there is a reason to show and removed when there is not, so the attribute is
// the whole test. The Allocate leaf's `Massive joint` placeholder was a fourth
// through a173, when it was retired.
//
// **Why it is a node rather than a pseudo-element.** Through a137 the box was
// `.nav-off[data-why]:hover::after` and the arrow was the matching `::before`.
// That box shared `::after` with the width ghost `site.css` draws inside every
// tab, the one that lays a tab out at its BOLD width so selecting it does not
// shove the strip along. The tooltip rule set `position: absolute`, absolute
// takes the pseudo-element out of flow, its contribution to the element's
// intrinsic width went with it, and the tab collapsed to its unbold width for
// exactly as long as the pointer was on it. Every dark tab got NARROWER on
// hover, at both levels, which is what the author reported as the tabs
// jittering.
//
// There is no way out of that in CSS alone: an element has two pseudo-elements,
// the ghost has one and the arrow has the other. So the box and the arrow move
// out here, `::after` goes back to being the ghost and only the ghost, and
// nothing moves. `.tip::after` draws the arrow, which a real node can afford
// because it has two pseudo-elements of its own.
//
// The clamp is why this module existed in the first place. The box is centered
// on its anchor and capped at `TIP_WIDTH`, so an anchor near either edge of the
// window puts half of it outside. Reinsurance's Plot leaf is the worst case: it
// is the first leaf in its row, the row starts at the content's left edge, and
// the button is about 45px wide, so the footnote overhangs by roughly 90px and
// the first words are simply not on screen. The mirror case exists at the right
// edge and both get worse as the window narrows.
//
// **The arrow does not move.** The box slides to stay readable; the arrow keeps
// pointing at the control, which is what every tooltip library does when it
// shifts rather than flips. It was a separate `::before` centered on the anchor
// and is now `.tip::after` placed at `--tip-arrow`, the anchor's center measured
// from the box's own left edge. Same rule, same picture.
//
// Rejected: `:first-child` / `:last-child` anchoring, which is pure CSS and no
// script. It fixes the two ends of one row and nothing else, so a wide footnote
// on the second of six leaves still clips on a narrow window, and the ask was
// the general case. CSS anchor positioning with `position-try-fallbacks` is the
// real answer and is not available on the iPad, which is a supported target.

/**
 * The widest the footnote can be, in px.
 *
 * Mirrors `max-width: 230px` on `.tip` in `site.css`, and is the default for
 * `tipShift`'s third argument rather than the only value it can take. The mount
 * measures the live node and passes the real width, which a pseudo-element
 * could not be asked for; the constant is what the arithmetic falls back to
 * when there is nothing to measure, which is every call from the tests.
 */
const TIP_WIDTH = 230;

/** How much clear space to leave between the box and the window edge, in px. */
const MARGIN = 8;

/** Gap between the anchor's bottom edge and the top of the box, in px. The
 *  arrow lives in it. Mirrors the `top: calc(100% + 7px)` this replaces. */
const GAP = 7;

/**
 * The shift that keeps a box of `width`, centered on `rect`, on screen.
 *
 * Parameters
 * ----------
 * rect : DOMRect
 *     The anchor's client rectangle.
 * viewport : number
 *     The viewport width in px.
 * width : number
 *     The box's width in px. Defaults to `TIP_WIDTH`, the CSS cap.
 *
 * Returns
 * -------
 * number
 *     Pixels to add to the box's own centering. Positive moves it right,
 *     negative left, and zero means it already fits.
 *
 * Notes
 * -----
 * Pure, and exported for that reason: the arithmetic is the whole of what this
 * module decides, and it is worth checking without a DOM.
 *
 * The left correction is applied after the right one, so a viewport too narrow
 * to hold the box at all pins it to the left edge rather than the right. Left is
 * where the text starts, which is the half worth keeping.
 */
export function tipShift(rect, viewport, width = TIP_WIDTH) {
    const center = rect.left + rect.width / 2;
    let left = center - width / 2;
    let shift = 0;
    const overRight = (left + width) - (viewport - MARGIN);
    if (overRight > 0) {
        shift -= overRight;
        left -= overRight;
    }
    const overLeft = MARGIN - left;
    if (overLeft > 0) shift += overLeft;
    return Math.round(shift);
}

/**
 * Wire the footnote once, delegated on `document`.
 *
 * Delegated rather than bound per element, so nothing has to be re-wired when
 * `renderSubTabs` rebuilds a row or `applyCapabilityGating` re-marks the group
 * tabs, which happens on every build.
 *
 * Parameters
 * ----------
 * root : Document or Element
 *     Where to listen. Defaults to `document`.
 *
 * Returns
 * -------
 * object
 *     `{node, hide}`, for a caller that wants to put the box away itself. The
 *     app does not, and takes neither.
 *
 * Notes
 * -----
 * `pointerover` and `focusin` rather than `pointerenter` and `focus`, which is
 * both simpler and a fix. The first pair bubbles, so one listener on the
 * document sees every anchor without the capture phase, and, more to the point,
 * a `pointerover` on something that is NOT an anchor is the signal to put the
 * box away. That covers the case four capture listeners could not: a row
 * rebuilt while the box is open leaves the anchor detached, so its
 * `pointerleave` never fires and the footnote would hang there explaining a
 * control that is no longer on the page.
 *
 * The keyboard path is `:focus-visible`, matched here rather than left to CSS,
 * so tabbing onto a dark leaf draws the same clamped box and clicking one does
 * not. Wrapped, because a browser without the selector should show the box
 * rather than throw.
 *
 * Scroll is listened for in the capture phase: it does not bubble from an inner
 * scroller, and a box left behind by a scrolled anchor points at nothing.
 */
export function mountTips(root = document) {
    const doc = root.ownerDocument || root;
    const node = doc.createElement('div');
    node.className = 'tip';
    node.setAttribute('role', 'tooltip');
    // Never announced. A dark control carries its reason in `aria-label`, set
    // beside `data-why` by `applyCapabilityGating` and `renderSubTabs`, so a
    // screen reader has already been told and this would be the second copy.
    node.setAttribute('aria-hidden', 'true');
    node.hidden = true;
    doc.body.appendChild(node);

    let anchor = null;

    const hide = () => {
        anchor = null;
        node.hidden = true;
    };

    const show = (next) => {
        anchor = next;
        node.textContent = next.getAttribute('data-why') || '';
        node.hidden = false;
        // Measured after it is in the document and before it is placed: the box
        // wraps, so its width is whatever the text and the `max-width` settle
        // on, and the clamp is only as good as the number it is given. The old
        // rule had to assume the cap on every call, which shifted a short
        // footnote further than it needed. One layout pass, inside one event.
        const rect = next.getBoundingClientRect();
        const width = node.offsetWidth;
        const center = rect.left + rect.width / 2;
        const left = center - width / 2
            + tipShift(rect, doc.documentElement.clientWidth, width);
        node.style.left = `${Math.round(left)}px`;
        node.style.top = `${Math.round(rect.bottom + GAP)}px`;
        // Where the arrow sits inside the box, so it keeps pointing at the
        // control while the box slides.
        node.style.setProperty('--tip-arrow', `${Math.round(center - left)}px`);
    };

    const anchorOf = (target) => (
        target instanceof Element ? target.closest('[data-why]') : null);

    root.addEventListener('pointerover', (event) => {
        const next = anchorOf(event.target);
        if (next) show(next);
        else if (anchor) hide();
    });
    root.addEventListener('focusin', (event) => {
        const next = anchorOf(event.target);
        let wanted = false;
        try { wanted = Boolean(next) && next.matches(':focus-visible'); }
        catch { wanted = Boolean(next); }
        if (wanted) show(next);
        else if (anchor) hide();
    });
    root.addEventListener('focusout', () => { if (anchor) hide(); });
    // The pointer left the window entirely, which no `pointerover` reports.
    doc.addEventListener('pointerleave', hide);
    doc.addEventListener('scroll', hide, true);
    (doc.defaultView || globalThis).addEventListener('resize', hide);

    return { node, hide };
}
