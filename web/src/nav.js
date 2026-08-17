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
 * `dividerBefore: true` draws a thin rule to the left of a leaf, splitting its
 * row into groups. One user, Pricing, where the first four leaves work outward
 * from one calibration and the fifth asks the opposite question.
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
                // The object's own picture, whichever chart the library says
                // that is. Not a name: an aggregate's is 'agg' and a
                // bivariate's is 'joint_surface', and choosing between them
                // here would be the per-kind table `primary_chart` retired.
                primaryChart: true,
                why: 'the library publishes no chart for this object yet',
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
                hint: 'VaR, TVaR and xsVaR by return period',
            },
            // Moved up from More at a55. It answers "can I believe any of the
            // numbers above", which is the question a reader has while looking
            // at them, not one worth walking into a specialist menu for. It
            // sits after Tail because it is a verdict on what Plot, Summary
            // and Tail just showed.
            validation: {
                label: 'Validation',
                exhibit: 'validation',
                why: 'needs computed moments',
                hint: 'theoretical vs empirical moments; reads “not unreasonable” on a clean build',
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
        // Plot first since a55, so the row parallels Overview: the picture, then
        // the tables that quantify it. Key order is row order, and `activeLeaf`
        // lands on the first *live* leaf, so a reinsured aggregate now opens on
        // Plot. A reinsured portfolio still opens on Summary, because
        // `chart_reins` is registered for `Aggregate` alone. That was logged as
        // the `replot` item; library a244 settled it the other way, as the
        // author's decision for 1.0: a book's units cede on different stages,
        // so a portfolio-level gross / ceded / net triple would have to pretend
        // they cede on the same one. So the leaf is dark there on purpose.
        leaves: {
            plot: {
                label: 'Plot',
                chart: 'reins',
                why: 'needs a cession; add one below',
                hint: 'what the cession does to the shape, and to the tail',
            },
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
        },
    },
    // Five leaves, and the row reads `Calibrate  Stand-alone  Allocate  Plot |
    // Evaluate`. The first four are one story: Calibrate determines the
    // distortion parameters, Stand-alone applies those same families to each
    // part as a price in its own right, Allocate takes the one premium and
    // splits it across those parts so they foot to the whole, and Plot draws
    // the conditional machinery that decides the split. Evaluate runs the other
    // way, starting from a premium already held and reporting what stress it
    // survives, which is why it sits behind a divider rather than beside them.
    //
    // Stand-alone and Allocate are the pane's two comparisons and the reason
    // they are two tabs. Summing the parts priced alone against the whole is
    // the diversification story; decomposing the whole into the parts is the
    // consistency one. Through a102 both answered to the name Allocate, and
    // only the second is an allocation.
    pricing: {
        label: 'Pricing',
        leaves: {
            calibrate: { label: 'Calibrate', flag: 'canPrice',
                         why: 'an aggregate or a portfolio only',
                         hint: 'one row per distortion family, each fitted to '
                             + 'the same premium target' },
            standalone: { label: 'Stand-alone', flag: 'canPrice',
                          why: 'an aggregate or a portfolio only',
                          hint: 'the calibrated families applied to each part '
                              + 'as prices in their own right, and the sum '
                              + 'against the whole' },
            allocate: { label: 'Allocate', flag: 'canNaturalAllocation',
                        why: 'needs a book of units or an occurrence cession',
                        hint: 'one premium split across the parts on one '
                            + 'basis: units of a book, or the halves of an '
                            + 'occurrence program' },
            // The only pricing leaf that fetches on activation, and the only
            // one gated on a chart. It asks a question of the object rather
            // than of a form: a kappa curve conditions on an outcome, not on a
            // distortion, so there is no calibration for it to wait for.
            plot: { label: 'Plot', chart: 'kappa',
                    why: 'needs a book of units or an occurrence cession',
                    hint: 'the kappa curves behind the allocation: what each '
                        + 'part expects, given the whole' },
            evaluate: { label: 'Evaluate', flag: 'canEvaluate',
                        dividerBefore: true,
                        why: 'needs an object that can be priced',
                        hint: 'the stress a premium already held survives: the '
                            + 'distortion in each family that values the '
                            + 'margin at zero' },
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
            // Not the same question as Overview / Tail, which is the
            // return-period ladder read off the computed grid. This is the
            // analytic classification of the frequency, severity and aggregate
            // tails: the family, the support, sub or super exponential on each
            // side, bounded, concentrated. It holds before any grid is chosen.
            //
            // The two were drawn as one pane through a50, which was wrong on
            // the merits and invisible anyway: that pane fetched
            // `tail_behavior_df` through the *frame* route, which resolves
            // names out of `_CSV_FRAMES` and has never carried that one, so the
            // request 404'd and the loader swallowed it.
            behavior: {
                label: 'Tail behavior',
                exhibit: 'tail_behavior',
                why: 'needs a full loss distribution, so an aggregate or a portfolio',
                hint: 'the decay class on each side, and whether the support is bounded',
            },
            window: {
                label: 'Window',
                exhibit: 'bs_window',
                why: 'needs an FFT grid',
                // Says what the columns *are*, which the table did not. Each row
                // is one estimate of the range the aggregate needs, as
                // [x_min, x_max]; W is that range's width, and bs and log2 are
                // the grid it implies, since W = bs * 2**log2.
                hint: 'each row proposes a window [x_min, x_max] of width '
                    + 'W = x_max - x_min, and the grid bs · 2^log2 that covers '
                    + 'it; the selected row is the one used',
            },
            dependency: {
                label: 'Dependency',
                exhibit: 'dependency',
                why: 'a bivariate only',
                hint: 'the copula and what it does to the joint; a bivariate only',
            },
            // Gated on `hasSharpen`, which is not the negation of the
            // `canSharpen` behind the action-row button: that one asks whether
            // running a probe is worth offering, this asks whether one has run
            // and left an audit to read. An object can answer yes to both.
            sharpen: {
                label: 'Sharpen',
                flag: 'hasSharpen',
                why: 'press Sharpen on the action row first; this is its audit',
                hint: 'every grid the probe tried and what it scored; lower is '
                    + 'better, and the selected row is the one it moved to',
            },
            narrative: {
                label: 'Narrative',
                hint: 'the object’s own text, verbatim',
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
 * @param {object} caps `{built, exhibits: Set, charts: Set, primaryChart, flags}`.
 */
export function leafAvailable(caps, group, key) {
    const leaf = leafOf(group, key);
    if (!leaf || leaf.soon) return false;
    if (leaf.exhibit) return caps.exhibits.has(leaf.exhibit);
    if (leaf.primaryChart) return Boolean(caps.primaryChart);
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
        primaryChart: cap.primary_chart || null,
        flags: {
            canPrice: Boolean(cap.can_price),
            canEvaluate: Boolean(cap.can_evaluate),
            canSharpen: Boolean(cap.can_sharpen),
            hasSharpen: Boolean(cap.has_sharpen),
            canPnl: Boolean(cap.can_pnl),
            canHints: Boolean(cap.can_hints),
            canReins: Boolean(cap.can_reins),
            canViews: Boolean(cap.can_views),
            reinsBases: cap.reins_bases || [],
            canBounds: Boolean(cap.can_bounds),
            canAllocate: Boolean(cap.can_allocate),
            // Not `canAllocate`, which is the Bounds group's per-unit range and
            // is a portfolio alone. This is the Pricing group's Allocate leaf:
            // has the object parts to split one premium across, meaning the
            // units of a book or the halves of an occurrence program.
            canNaturalAllocation: Boolean(cap.can_natural_allocation),
            hasPremium: Boolean(cap.has_premium),
            // The number, not the flag: the Evaluate form prefills its premium
            // box from it. Null wherever `hasPremium` is false, since the two
            // are one fact and the api derives one from the other.
            premium: cap.premium ?? null,
            needsPremium: Boolean(cap.needs_premium),
        },
    };
}
