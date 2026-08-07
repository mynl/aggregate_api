/**
 * The navigation skeleton, and the rules that decide what is live in it.
 *
 * Split from `main.js` so the rules can be checked without a browser. Nothing
 * here touches the DOM, fetches anything, or knows how a leaf renders: it is
 * the shape of the menu plus four pure functions over a capability payload.
 * `main.js` supplies the loaders, keyed `group:leaf`.
 *
 * The skeleton is editorial and the leaves are derived. Which groups exist,
 * what they are called and what order they sit in is a judgment about how
 * insurance work proceeds, so the app authors it. Whether a given leaf is live
 * for the object in front of you is a fact, so the library computes it and this
 * only asks.
 *
 * Three ways a leaf is gated, and which one it uses decides where a future leaf
 * goes:
 *
 *   `exhibit`  a library exhibit; lights from `available_exhibits`, so a new
 *              registration upstream reaches the menu with no edit here
 *   `chart`    a library chart; lights from `available_charts`
 *   `flag`     app behavior with no library document behind it, so a capability
 *              flag says; each flag names its consumer in `capability.py`
 *
 * A leaf with none of the three is available wherever an object is: Density is
 * a bulk frame with no exhibit, Narrative is the object's own text.
 *
 * `soon: true` greys a leaf that is designed but not built. Per the house rule
 * nothing is hidden, so what is coming is visible and plainly not ready.
 *
 * `why` is what a dark leaf says on hover. It states what *does* answer, not
 * what this object lacks, because the reader is deciding what to build next.
 * See `whyLeaf` / `whyGroup`.
 */

/**
 * The six groups, in the order they are drawn.
 *
 * **Key order is load bearing.** It is the tab strip's order, it is what
 * `Alt+1…6` indexes, and it has to match the `<ul class="out-tabs">` list in
 * `index.html`, which is the same order written a second time in markup.
 * `dev/scripts/check-nav.mjs` parses that list and asserts the two agree.
 *
 * The order is the demo flow: look at the gross book, add reinsurance, decide
 * what to charge for what is left, then read the economics of the result.
 * Bounds is orthogonal to all four and sits late; More is the specialist
 * frames. Through a48 Economics sat second, which put a P&L's group, dark for
 * every object most sessions build, in the position the eye reaches first.
 */
export const NAV_GROUPS = {
    overview: {
        label: 'Overview',
        leaves: {
            plot: {
                label: 'Plot',
                hint: 'the distribution and its tail, linked on one cursor',
            },
            summary: {
                label: 'Summary',
                exhibit: 'summary',
                why: 'a severity carries no summary frame',
                hint: 'moments and key percentiles',
            },
            tail: {
                label: 'Tail',
                exhibit: 'tail',
                why: 'needs a full loss distribution, so an aggregate or a portfolio',
                hint: 'return periods, then how each tail behaves',
            },
        },
    },
    reinsurance: {
        label: 'Reinsurance',
        // The one group that is live with every leaf dark. An aggregate with no
        // cession has nothing to tabulate or draw, and is exactly the object
        // you want to add cover to, so the entry box below the row is the
        // group's content until there is a program to describe. `alsoLive`
        // says so declaratively rather than special-casing the group name in
        // `groupAvailable`.
        alsoLive: 'canReins',
        leaves: {
            summary: {
                label: 'Summary',
                exhibit: 'reins',
                why: 'needs a cession; add one below',
                hint: 'the program layer by layer',
            },
            stats: {
                label: 'Stats',
                exhibit: 'reins',
                why: 'needs a cession; add one below',
                hint: 'gross, ceded and net moments',
            },
            density: {
                label: 'Density',
                exhibit: 'reins',
                why: 'needs a cession; add one below',
                hint: 'the three distributions on one grid',
            },
            plot: {
                label: 'Plot',
                chart: 'reins',
                why: 'needs a cession; add one below',
                hint: 'what the cession does to the shape, and to the tail',
            },
        },
    },
    pricing: {
        label: 'Pricing',
        leaves: {
            determine: { label: 'Determine', flag: 'canPrice',
                         why: 'an aggregate or a portfolio only' },
            evaluate: { label: 'Evaluate', flag: 'canEvaluate',
                        why: 'needs an object that can be priced' },
        },
    },
    economics: {
        label: 'Economics',
        leaves: {
            ledger: {
                label: 'Ledger',
                exhibit: 'economic',
                why: 'a P&L only',
                hint: 'the P&L sheet, line by line',
            },
            ratios: {
                label: 'Ratios',
                exhibit: 'economic_ratios',
                why: 'a P&L only',
                hint: 'the same sheet read as ratios',
            },
            waterfall: {
                label: 'Waterfall',
                exhibit: 'economic_waterfall',
                why: 'a P&L tower only',
                hint: 'the margin walk, gross to net; a tower only',
            },
        },
    },
    bounds: {
        label: 'Bounds',
        leaves: {
            bounds: {
                label: 'Bounds',
                flag: 'canBounds',
                why: 'an aggregate or a portfolio only',
                hint: 'every distortion consistent with this premium, as a band',
            },
            pricing: {
                label: 'Pricing Bounds',
                flag: 'canBounds',
                why: 'an aggregate or a portfolio only',
                hint: 'what a second risk can cost, given this one priced there',
            },
            allocation: {
                label: 'Allocation Bounds',
                flag: 'canAllocate',
                why: 'a portfolio only',
                hint: 'per-unit ranges consistent with the total; a portfolio only',
            },
        },
    },
    more: {
        label: 'More',
        leaves: {
            validation: {
                label: 'Validation',
                exhibit: 'validation',
                why: 'needs computed moments',
                hint: 'theoretical vs empirical moments; reads “not unreasonable” on a clean build',
                copy: true,
            },
            stats: {
                label: 'Stats',
                exhibit: 'stats',
                why: 'needs computed moments',
                hint: 'frequency / severity / aggregate moments; raw moment rows are dropped',
            },
            density: {
                label: 'Density',
                hint: 'binned to a power-of-two display grid; copy / save from the grid',
            },
            window: {
                label: 'Window',
                exhibit: 'bs_window',
                why: 'needs an FFT grid',
                hint: 'bucket / window estimator; the selected row is the chosen grid',
            },
            dependency: {
                label: 'Dependency',
                exhibit: 'dependency',
                why: 'a bivariate only',
                hint: 'the copula and what it does to the joint; a bivariate only',
            },
            narrative: {
                label: 'Narrative',
                hint: 'the object’s own text, verbatim',
                copy: true,
            },
        },
    },
};

/** The leaf definition for a group, by key. */
export function leafOf(group, key) {
    return NAV_GROUPS[group]?.leaves?.[key];
}

/**
 * Why a leaf is dark, in the reader's terms rather than the gate's.
 *
 * The rules above already know every one of these; until a47 they simply never
 * said. A Severity lights 3 leaves out of 22, and a wall of grey that explains
 * itself on hover is a map of what the object is rather than a broken page.
 *
 * Phrased as what *does* answer ("a portfolio only") rather than as what this
 * object lacks, because the reader is deciding what to build next.
 *
 * @returns {string} the reason, or a generic fallback if a leaf carries none.
 */
export function whyLeaf(group, key) {
    return leafOf(group, key)?.why || 'not available for this object';
}

/**
 * Why a whole group is dark: the reason its first leaf gives.
 *
 * Derived rather than declared, so a group cannot drift from the leaves under
 * it.
 *
 * Through a48 this took the reason only when **every** leaf agreed on it, and
 * fell back to the generic line otherwise. Three of the four groups that can
 * grey do not agree, so three of the four said nothing:
 *
 *   Economics    "a P&L only" twice and "a P&L tower only" once
 *   Pricing      "an aggregate or a portfolio only" and "needs an object that
 *                can be priced"
 *   Bounds       "an aggregate or a portfolio only" twice and "a portfolio
 *                only" once
 *
 * In each the first leaf's reason is the group's reason and the others are
 * narrower cases inside it, which is not a coincidence: a group's leaves run
 * from its general answer to its specialized ones, and `activeLeaf` lands on
 * the first live one for exactly that reason. So the first leaf speaks for the
 * group. A group whose first leaf is genuinely narrower than the group would
 * need to say so itself; none is today.
 */
export function whyGroup(group) {
    const first = Object.keys(NAV_GROUPS[group]?.leaves || {})
        .map((key) => leafOf(group, key)?.why)
        .find(Boolean);
    return first || 'not available for this object';
}

/**
 * Is this leaf live for the object described by `caps`?
 *
 * Nothing here knows about kinds, which is the point: this replaced two
 * hand-written tables saying what each kind could not do, and one of them had
 * drifted (it greyed a bivariate's grid-sizing pane, which the object serves
 * perfectly well).
 *
 * @param {object} caps `{built, exhibits: Set, charts: Set, flags: object}`.
 */
export function leafAvailable(caps, group, key) {
    const leaf = leafOf(group, key);
    if (!leaf || leaf.soon) return false;
    if (leaf.exhibit) return caps.exhibits.has(leaf.exhibit);
    if (leaf.chart) return caps.charts.has(leaf.chart);
    if (leaf.flag) return Boolean(caps.flags?.[leaf.flag]);
    return Boolean(caps.built);
}

/**
 * A group is live when any of its leaves is, or when it carries its own
 * `alsoLive` flag and that flag is set.
 *
 * The second clause is for a group whose content is not all leaves: the
 * Reinsurance entry box sits below the sub-tab row and is the whole point of
 * the group for an object with no cession yet.
 */
export function groupAvailable(caps, group) {
    const def = NAV_GROUPS[group];
    if (!def) return false;
    if (def.alsoLive && caps.flags?.[def.alsoLive]) return true;
    return Object.keys(def.leaves || {})
        .some((key) => leafAvailable(caps, group, key));
}

/**
 * The leaf a group should show: the one it was last left on, if it still
 * answers, otherwise its first live one.
 *
 * Each group remembers its own, so stepping away from Pricing and back returns
 * you where you were rather than to its first leaf. Falls back to the first
 * leaf when nothing is live, so a greyed group still has a well-defined pill to
 * draw as active rather than none.
 */
export function activeLeaf(caps, remembered, group) {
    const keys = Object.keys(NAV_GROUPS[group]?.leaves || {});
    if (remembered && leafAvailable(caps, group, remembered)) return remembered;
    return keys.find((key) => leafAvailable(caps, group, key)) || keys[0];
}

/** Shape a build response's capability block into the form the rules take. */
export function capsFromResponse(capability, built = true) {
    const cap = capability || {};
    return {
        built: built && Boolean(capability),
        exhibits: new Set((cap.exhibits || []).map((e) => e.name)),
        charts: new Set(cap.charts || []),
        flags: {
            canPrice: Boolean(cap.can_price),
            canEvaluate: Boolean(cap.can_evaluate),
            canSharpen: Boolean(cap.can_sharpen),
            canPnl: Boolean(cap.can_pnl),
            canReins: Boolean(cap.can_reins),
            canBounds: Boolean(cap.can_bounds),
            canAllocate: Boolean(cap.can_allocate),
            hasPremium: Boolean(cap.has_premium),
            needsPremium: Boolean(cap.needs_premium),
        },
    };
}
