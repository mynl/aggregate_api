// Keep the `data-why` footnote inside the viewport.
//
// The page has one hand rolled tooltip, drawn in CSS as a `::after` on any
// `.nav-off[data-why]`, and it is used in three places: the dark group tabs, the
// dark sub-tab leaves, and the Allocate leaf's `.massive-toggle` placeholder.
// The box is centered on its anchor (`left: 50%; translateX(-50%)`) and capped
// at `TIP_WIDTH`, so an anchor near either edge of the window puts half of a
// 230px box outside it. Reinsurance's Plot leaf is the worst case: it is the
// first leaf in its row, the row starts at the content's left edge, and the
// button is about 45px wide, so the footnote overhangs by roughly 90px and the
// first words of the explanation are simply not on screen. The mirror case
// exists at the right edge and both get worse as the window narrows.
//
// The fix is a shift the page measures, handed to CSS as `--tip-shift` and
// added inside the existing `translateX`. With no variable set the rule is byte
// identical to what it was, so nothing regresses if this never runs.
//
// **The arrow does not move.** It is a separate `::before`, still centered on
// the anchor, because the arrow points at the control while the box slides to
// stay readable. That is what every tooltip library does when it shifts rather
// than flips.
//
// Rejected: `:first-child` / `:last-child` anchoring, which is pure CSS and no
// script. It fixes the two ends of one row and nothing else, so a wide footnote
// on the second of six leaves still clips on a narrow window, and the ask was
// the general case. CSS anchor positioning with `position-try-fallbacks` is the
// real answer and is not available on the iPad, which is a supported target.

/**
 * The widest the footnote can be, in px.
 *
 * Mirrors `max-width: 230px` on `.nav-off[data-why]::after` in `site.css`. The
 * two have to agree, and a measurement is not available: the box is a
 * pseudo-element, so there is no node to call `getBoundingClientRect` on. The
 * shift is computed against the cap rather than the actual text, which means a
 * short footnote is sometimes shifted further than it strictly needs. That is
 * the safe direction: it stays on screen either way.
 */
const TIP_WIDTH = 230;

/** How much clear space to leave between the box and the window edge, in px. */
const MARGIN = 8;

/**
 * The shift that keeps a box of `TIP_WIDTH`, centered on `rect`, on screen.
 *
 * Parameters
 * ----------
 * rect : DOMRect
 *     The anchor's client rectangle.
 * viewport : number
 *     The viewport width in px.
 *
 * Returns
 * -------
 * number
 *     Pixels to add to the box's own `-50%` centering. Positive moves it right,
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
export function tipShift(rect, viewport) {
    const center = rect.left + rect.width / 2;
    let left = center - TIP_WIDTH / 2;
    let shift = 0;
    const overRight = (left + TIP_WIDTH) - (viewport - MARGIN);
    if (overRight > 0) {
        shift -= overRight;
        left -= overRight;
    }
    const overLeft = MARGIN - left;
    if (overLeft > 0) shift += overLeft;
    return Math.round(shift);
}

/**
 * Wire the clamp once, delegated on `document`.
 *
 * Delegated rather than bound per element, so nothing has to be re-wired when
 * `renderSubTabs` rebuilds a row or `applyCapabilityGating` re-marks the group
 * tabs, which happens on every build.
 *
 * `pointerenter` and `focus` are listened for in the capture phase, because
 * neither bubbles. That is also why this cannot simply watch `mouseover`: the
 * tooltip is drawn for `:focus-visible` as well as `:hover`, and a keyboard
 * reader tabbing onto a dark leaf has to get the same clamped box.
 *
 * The variable is cleared on the way out. Leaving it set would be harmless while
 * the anchor stays put, and wrong the moment the window is resized with the
 * pointer elsewhere.
 */
export function mountTipClamp(root = document) {
    const anchorOf = (target) => (
        target instanceof Element ? target.closest('[data-why]') : null);

    const place = (event) => {
        const anchor = anchorOf(event.target);
        if (!anchor) return;
        const shift = tipShift(anchor.getBoundingClientRect(), window.innerWidth);
        anchor.style.setProperty('--tip-shift', `${shift}px`);
    };
    const clear = (event) => {
        const anchor = anchorOf(event.target);
        if (anchor) anchor.style.removeProperty('--tip-shift');
    };

    root.addEventListener('pointerenter', place, true);
    root.addEventListener('focus', place, true);
    root.addEventListener('pointerleave', clear, true);
    root.addEventListener('blur', clear, true);
}
