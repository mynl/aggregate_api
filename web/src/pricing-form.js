// The pricing form: one anchor, one target, one verb.
//
// Five leaves ask the same question in three spellings. Pricing / Calibrate
// fixes capital and names a cost of capital or a loss ratio; Pricing / Evaluate
// fixes capital and names a premium; the three Bounds leaves do the same and
// then sweep. `Aggregate.price_pentagon` has always taken exactly one capital
// anchor and exactly one pricing target, premium among them, so the three forms
// are one form over a signature the library already publishes. This is that
// form, built once and mounted where it is needed.
//
// It holds no arithmetic. The preview line is a server round trip to
// `price_pentagon`, and every number the form reports is one the library
// completed. See `dev/done/plan-pricing-form.md`.

import { api, errorMessage } from './api.js';
import { $, el, empty } from './utils/dom.js';
import { debounce } from './utils/debounce.js';

/** The capital anchor: which of the two the reader fixes. */
const ANCHORS = [
    ['p', 'p', 'a VaR probability in (0, 1]'],
    ['a', 'assets', 'an asset level, snapped to the grid'],
];

/**
 * The pricing target, in the caller's vocabulary.
 *
 * `premium` joined at a100. It is the spelling the Bounds group has always used
 * and the one Evaluate takes, so adding it is what lets one form serve all
 * five leaves. Each carries the default the box takes when it is chosen, and
 * `null` means "leave the box alone", which is what a premium wants: the
 * pentagon on hand fills it, and there is no sensible number otherwise.
 */
const TARGETS = [
    ['coc', 'CoC', '0.15', 'cost of capital, the pentagon’s ROE'],
    ['lr', 'LR', '0.9', 'loss ratio'],
    ['premium', 'Premium', null, 'the premium itself'],
];

//: Sticky across objects and across leaves, because it is a preference rather
//: than a fact about the object in the box. Read once; every form instance
//: shares the one value, so stepping between Pricing and Bounds does not change
//: which basis is selected under you.
let priceBasis = (() => {
    try { return localStorage.getItem('aggapi.priceBasis') || 'gross'; }
    catch { return 'gross'; }
})();

//: The expense ratio, shared by every form that draws the box (Calibrate,
//: Allocate, Evaluate) so the three leaves reopen consistent. Module state
//: beside `priceBasis` but, unlike it, NOT persisted: an expense load is a
//: fact about the program being priced, not a reader preference. Null means
//: the box is empty or zero, and nothing travels: the default path is
//: byte-identical to a form with no box.
let expenseRatio = null;

/** The three whole-program views, in the order the forms draw them. */
const BASES = [
    ['gross', 'Gross'],
    ['net occ', 'Net occ'],
    ['net', 'Net'],
];

/**
 * Build a pricing form into `host`.
 *
 * Parameters
 * ----------
 * host : HTMLElement
 *     Emptied and filled. The form is one sentence in a flex row: the lede,
 *     the basis group, the anchor pair, the target pair joined by `and`, a
 *     period, the verb, a `?`, then whatever `extras` adds below.
 * opts.verb : string
 *     The button's word, and its stem while busy ('Calibrate' / 'Calibrating').
 *     On a form with no basis group it also opens the sentence, as the lede
 *     `'<verb> at'`.
 * opts.onSubmit : function
 *     Called with the body the form reads, `{p|a, coc|lr|premium, basis}`.
 * opts.basisLabel : string or null
 *     The sentence lede before the basis group, capitalized as the first word
 *     ('calibrate on' draws as 'Calibrate on'), or null to draw no basis group
 *     at all. 'calibrate on' names what is being fitted; 'premium is' names
 *     what the number in the box means. The distinction is the Evaluate leaf's.
 *     Since a184 the row reads as one sentence in the Quick Re idiom: the lede
 *     and the `qr-op` connectives do the work the retired band label and `◦`
 *     spacer used to, and a `?` carries the explanation (`opts.help`).
 * opts.targets : array of string, optional
 *     Which targets to offer. Defaults to all three. Evaluate passes
 *     `['premium']`, which draws a plain label since there is nothing to switch.
 * opts.preview : boolean
 *     Draw the pentagon preview line under the form.
 * opts.allowBlank : boolean
 *     Read an empty box as "unstated" rather than as "incomplete". Evaluate
 *     alone: a blank premium means the object's own consideration, and a blank
 *     anchor is the library's unlimited reading, which solves over the whole
 *     distribution and reports four families rather than five.
 * opts.expense : boolean
 *     Draw the expense ratio clause, `, and [0][expense ratio].` An empty or
 *     zero box sends nothing, so the default path is byte-identical to a form
 *     without it. The value is shared across the mounts that opt in (module
 *     state beside `priceBasis`), and it is dead with a why on a P&L, whose
 *     ledger states its own expenses. The api owns the arithmetic: a premium
 *     target rides as gross and the runner feeds the engine
 *     `premium * (1 - e)`; this form holds no arithmetic, as ever.
 * opts.help : string, optional
 *     The explanation behind the `?` at the end of the row: what the anchor
 *     means, what the target means, what the preview line reports. Written at
 *     the mount, one sentence block per leaf; the Quick Re `?` is the model.
 *     The caller initializes the Bootstrap tooltip, since this module does not
 *     import bootstrap.
 * opts.extras : HTMLElement, optional
 *     Placed below the form row and above the preview line. The Bounds
 *     `against` field is the only user.
 * opts.basisOnly : function, optional
 *     `(bases, kind) => bases` narrowing the object's own basis list to the
 *     ones *this leaf* can send. The Allocate leaf is the user: a natural
 *     allocation splits a gross premium, so an aggregate offers Gross alone
 *     there while its other views stay drawn and dark. A form that narrows
 *     neither reads nor writes the shared sticky choice, because its selection
 *     is a fact about the leaf rather than a preference of the reader.
 * opts.basisWhy : string, optional
 *     What a basis the object *has* says when this leaf refuses it. Only
 *     meaningful with `basisOnly`; the reasons for a basis the object lacks are
 *     the same everywhere and stay where they are.
 * opts.context : function
 *     Returns `{id, kind, bases, canPreview}` for the object now on screen. A
 *     function rather than a value because one form outlives many objects.
 * opts.onChange : function, optional
 *     Called whenever the form's answer may have moved: a keystroke in either
 *     box, a switch of anchor, target or basis, or a programmatic `write`.
 *     The Pr Ruin pane is the user: its picture tracks the form live, so it
 *     re-requests off the same events that refresh the preview line. Debounce
 *     is the caller's, since only the caller knows what a request costs.
 *
 * Returns
 * -------
 * object
 *     `{read, write, setBusy, sync, note, setDormant}`. `read` is what the
 *     button posts, `write` adopts a held pricing, `sync` redraws the greying
 *     when the object changes, `note` prints a line where the preview would
 *     go, and `setDormant` puts the whole form to sleep.
 */
export function createPricingForm(host, opts) {
    const {
        verb, onSubmit, basisLabel = null,
        targets = TARGETS.map((t) => t[0]),
        preview = false, allowBlank = false, help = null, extras = null,
        expense = false,
        basisOnly = null, basisWhy = null, context, onChange = null,
    } = opts;

    empty(host);
    const row = el('div', { className: 'tab-tools price-form' });
    // The sentence idiom, Quick Re's: boxes joined by operator words in the
    // `qr-op` face, so the row reads as one clause rather than as a form. The
    // connectives do the work the a157 band label and the `◦` spacer used to.
    // Punctuation hugs the clause it closes (`price-punct` swallows the flex
    // gap), because a comma floating mid-gap reads as a typo.
    const opWord = (text) => el('span', { className: 'qr-op' }, text);
    const punct = (text) => el('span', { className: 'qr-op price-punct' }, text);
    // The lede is the first word of the sentence: the basis label where there
    // is a basis group, else the verb phrase ('Compute at', 'Draw at').
    row.appendChild(opWord(basisLabel
        ? basisLabel[0].toUpperCase() + basisLabel.slice(1)
        : `${verb} at`));
    const basisHost = el('span', { className: 'price-basis' });
    if (basisLabel) {
        row.appendChild(basisHost);
        row.appendChild(punct(','));
    }

    // Value box then switch, so the control that changes what the box means is
    // also the one that labels it. Through a99 the choice was stated twice, a
    // `btn-group` and a `<span>` repeating its selection, and the span needed a
    // `min-width` to stop the row shifting on every switch. A `btn-group` draws
    // all its members always, so its width does not move and neither does the
    // row.
    const anchorInput = el('input', {
        type: 'number', step: '0.001', min: '0', max: '1',
        value: '0.99', autocomplete: 'off',
    });
    const anchorGroup = el('div', {
        className: 'btn-group btn-group-sm', role: 'group',
    });
    anchorGroup.setAttribute('aria-label', 'capital anchor');
    if (allowBlank) anchorInput.placeholder = 'none';
    const anchorField = el('label', { className: 'price-field' }, anchorInput);
    row.appendChild(anchorField);
    row.appendChild(anchorGroup);

    row.appendChild(punct(','));
    // `and` joins the last two clauses, so with an expense clause it moves
    // there and a plain comma stands here.
    if (!expense) row.appendChild(opWord('and'));

    const targetInput = el('input', {
        type: 'number', step: '0.01', value: '0.15', autocomplete: 'off',
    });
    const targetGroup = el('div', {
        className: 'btn-group btn-group-sm', role: 'group',
    });
    targetGroup.setAttribute('aria-label', 'pricing target');
    const targetField = el('label', { className: 'price-field' }, targetInput);
    row.appendChild(targetField);
    row.appendChild(targetGroup);

    let expenseInput = null;
    if (expense) {
        row.appendChild(punct(','));
        row.appendChild(opWord('and'));
        expenseInput = el('input', {
            type: 'number', step: '0.01', min: '0', max: '0.99',
            value: expenseRatio != null ? String(expenseRatio) : '0',
            autocomplete: 'off',
        });
        row.appendChild(el('label', { className: 'price-field' }, expenseInput));
        row.appendChild(el('span', { className: 'price-unit' }, 'expense ratio'));
    }
    row.appendChild(punct('.'));

    const button = el('button', { className: 'btn btn-primary btn-sm' }, verb);
    row.appendChild(button);
    if (help) {
        // The Quick Re `?`, verbatim: the whole explanation on demand rather
        // than a gloss nobody reads twice. The mount initializes the tooltip.
        row.appendChild(el('button', {
            type: 'button', className: 'qr-help', title: help,
            'aria-label': `how ${verb} reads these boxes`,
        }, '?'));
    }
    host.appendChild(row);
    if (extras) host.appendChild(extras);

    const previewNode = preview ? el('p', { className: 'price-preview' }) : null;
    if (previewNode) host.appendChild(previewNode);

    let anchor = 'p';
    let target = targets.includes('coc') ? 'coc' : targets[0];
    // The whole form asleep: every control drawn and dead. One flag rather
    // than per-control bookkeeping, because the groups re-render themselves
    // and would otherwise forget they were put to sleep.
    let dormant = false;

    // ---- the three segmented controls ----

    /** One segmented control: same widget for the anchor, target and basis. */
    function renderGroup(group, members, selected, onPick) {
        empty(group);
        for (const [value, label, why, dead] of members) {
            const b = el('button', {
                type: 'button',
                title: why,
                className: 'btn btn-outline-secondary'
                    + (value === selected && !dead ? ' active' : ''),
            }, label);
            if (dead || dormant) {
                // A dormant member keeps its selection highlight: the form is
                // asleep, not unanswered, so it still shows what it would ask.
                b.disabled = true;
                if (dead) b.setAttribute('aria-label', `${label}, ${why}`);
            } else {
                b.addEventListener('click', () => onPick(value));
            }
            group.appendChild(b);
        }
    }

    function renderAnchor() {
        renderGroup(anchorGroup, ANCHORS, anchor, (value) => {
            if (value === anchor) return;
            anchor = value;
            // A probability lives in (0, 1] and steps by a thousandth; an asset
            // level is money and does neither, so the box's constraints move
            // with the choice rather than silently rejecting every asset figure.
            const isP = anchor === 'p';
            anchorInput.step = isP ? '0.001' : '1';
            if (isP) anchorInput.max = '1'; else anchorInput.removeAttribute('max');
            anchorInput.value = isP ? '0.99' : '';
            renderAnchor();
            if (!isP) anchorInput.focus();
            // The switch changes the whole question, so the line answers at
            // once rather than through the debounce that absorbs typing.
            refresh();
        });
    }

    function renderTarget() {
        const members = TARGETS.filter((t) => targets.includes(t[0]))
            .map(([value, label, , why]) => [value, label, why]);
        if (members.length < 2) {
            // Nothing to switch. Evaluate asks one question and a one-member
            // group would be a control that cannot be operated.
            empty(targetGroup);
            targetGroup.appendChild(
                el('span', { className: 'price-unit' }, members[0]?.[1] || ''));
            return;
        }
        renderGroup(targetGroup, members, target, (value) => {
            if (value === target) return;
            target = value;
            const preset = TARGETS.find((t) => t[0] === value)?.[2];
            if (preset !== null && preset !== undefined) targetInput.value = preset;
            targetInput.step = value === 'premium' ? '1' : '0.01';
            renderTarget();
            refresh();
        });
    }

    /** The bases this leaf may send: the object's own, narrowed by the leaf. */
    function liveBases() {
        const { bases = [], kind } = context() || {};
        return basisOnly ? basisOnly(bases, kind) : bases;
    }

    /**
     * The basis this form is on, or null where it has none to state.
     *
     * A narrowing leaf takes its own answer and leaves the shared sticky choice
     * alone: what it sends is a fact about the tab, not a preference, and
     * writing the sticky from here would change which basis the Calibrate form
     * one pill over is calibrating on.
     */
    function currentBasis() {
        const live = liveBases();
        if (!live.length) return null;
        if (basisOnly) return live[0];
        // Fall back to the first live basis when the sticky choice is one this
        // object cannot answer, so a stored 'net occ' does not silently price
        // the wrong thing on the next object.
        if (!live.includes(priceBasis)) priceBasis = live[0];
        return priceBasis;
    }

    /**
     * The basis group, always drawn and never emptied.
     *
     * House rule: a control the object cannot use greys out and says why, so
     * the reader learns the choice exists and that this object does not offer
     * it. Which members are live comes from the capability block, which since
     * a100 locks a Portfolio to net, and then from the leaf, which since a104
     * can narrow that further; `whyDead` is where both read as a sentence.
     */
    function renderBasis() {
        if (!basisLabel) return;
        empty(basisHost);
        const { bases = [], kind } = context() || {};
        const live = liveBases();
        // No label of its own since a184: the sentence lede two nodes to the
        // left is the label, and a second copy inside the clause would be the
        // "said twice" failure the lede exists to avoid.
        const group = el('div', { className: 'btn-group btn-group-sm', role: 'group' });
        group.setAttribute('aria-label', basisLabel);
        const selected = currentBasis();
        const whyDead = (value) => {
            // The object has this view and this leaf will not take it, which is
            // a different sentence from the object not having it at all.
            if (basisWhy && bases.includes(value)) return basisWhy;
            if (kind === 'port') {
                return value === 'net'
                    ? 'this book has no cession'
                    : 'a book has no cession of its own: its units cede on their '
                      + 'own stages and it takes what they produce';
            }
            if (kind === 'pnl') return 'a P&L states a premium on every row of its ledger';
            return bases.length
                ? 'this program has no distinct basis of that kind'
                : 'needs a cession; add one on the Reinsurance tab';
        };
        const members = BASES.map(([value, label]) => {
            const dead = !live.includes(value);
            return [value, label, dead ? whyDead(value) : `calibrated on the ${label.toLowerCase()} view`, dead];
        });
        renderGroup(group, members, selected, (value) => {
            if (basisOnly) return;         // one live member, and it is not a choice
            priceBasis = value;
            try { localStorage.setItem('aggapi.priceBasis', value); }
            catch { /* private mode */ }
            renderBasis();
            // Both legs of the anchor come off the chosen view, so the preview
            // is a different reading and not a relabeling of the one on screen.
            refresh();
        });
        basisHost.appendChild(group);
    }

    // ---- the preview line ----
    //
    // The pentagon this form would complete, kept current as you type.
    // Debounced at 350 ms on the trailing edge, because a keystroke is not a
    // question. Ticketed against out-of-order answers, since the boxes move
    // while a request is in flight and an older reading must not overwrite a
    // newer one. Dimmed rather than blanked after 120 ms, so the last good
    // reading stays on screen and says it is not current instead of flickering
    // on every digit.
    //
    // A refusal is the preview text. The library's guards (an unbounded anchor
    // at p = 1, a loss ratio implying a premium above the assets, a premium
    // below the expected loss) are sentences written to be read, and this line
    // is where the reader is already looking. That is the whole reason it
    // answers before the button is pressed rather than after.
    let ticket = 0;
    let held = null;

    async function renderPreview() {
        if (!previewNode) return;
        const blank = () => {
            previewNode.textContent = '';
            previewNode.classList.remove('is-pending');
        };
        const { id, canPreview } = context() || {};
        if (!id || !canPreview) return blank();
        const body = read();
        if (!body) return blank();
        // Under `allowBlank` an empty box says "unstated", and `price_pentagon`
        // needs exactly one capital anchor and exactly one target, so an
        // unstated one leaves nothing to preview. The route's refusal ("pass
        // exactly one of p or a") is a real sentence but it is not one this
        // state has earned: the Evaluate leaf clears its anchor on purpose, to
        // ask for the library's unlimited reading, and a deliberate choice must
        // not come back looking like a mistake.
        if (allowBlank && (body[anchor] == null || body[target] == null)) {
            return blank();
        }

        const mine = ++ticket;
        const pending = setTimeout(() => {
            if (mine === ticket) previewNode.classList.add('is-pending');
        }, 120);
        const settle = (text) => {
            clearTimeout(pending);
            if (mine !== ticket) return;
            previewNode.textContent = text;
            previewNode.classList.remove('is-pending');
        };
        try {
            const q = await api.pricingPreview(id, body);
            held = q;
            // PQ as a ratio to three places, matching every table on the pane:
            // it is premium over capital, and a leverage of 4.6 reads as 4.6
            // rather than as 460%.
            const tail = `assets ${money(q.assets)}, `
                + `loss ratio ${percent(q.lr)}, PQ ${q.pq?.toFixed(3) ?? ''}, `
                + `and CoC ${percent(q.coc)}`;
            // The premium lead. A P&L reports its ledger's own pair; a request
            // that carried an expense ratio reports the gross reading beside
            // the technical premium; otherwise the line is what it always was.
            if (q.net_of_expense_premium != null) {
                settle(`Preview: gross premium ${money(q.gross_premium)}, net `
                    + `of expense premium ${money(q.net_of_expense_premium)}, `
                    + tail);
            } else if (q.gross_premium != null) {
                settle(`Preview: gross premium ${money(q.gross_premium)}, `
                    + `net premium ${money(q.premium)}, ` + tail);
            } else {
                settle(`Preview: premium ${money(q.premium)}, ` + tail);
            }
        } catch (err) {
            held = null;
            settle(errorMessage(err));
        }
    }

    const previewSoon = debounce(renderPreview, 350);
    // A switch changes the whole question, so both readers answer at once; a
    // keystroke is absorbed by the debounce above and by the caller's own.
    const refresh = () => { renderPreview(); onChange?.(); };

    for (const input of [anchorInput, targetInput]) {
        input.addEventListener('input', () => { previewSoon(); onChange?.(); });
    }
    if (expenseInput) {
        // Keystrokes write the shared value as well as this box, which is what
        // keeps the three opted-in leaves consistent without a store.
        expenseInput.addEventListener('input', () => {
            const value = parseFloat(expenseInput.value);
            expenseRatio = Number.isFinite(value) && value > 0 ? value : null;
            previewSoon();
            onChange?.();
        });
    }

    button.addEventListener('click', () => {
        const body = read();
        if (body) onSubmit(body);
    });

    /**
     * The body this form describes, or null if it describes none.
     *
     * An empty box is not a mistake, it is a box you have not finished typing
     * in, so an incomplete form is silent rather than an error. Under
     * `allowBlank` an empty box is a statement instead: it says "unstated", and
     * the field simply does not travel.
     */
    function read() {
        const body = {};
        const anchorVal = parseFloat(anchorInput.value);
        const targetVal = parseFloat(targetInput.value);
        if (Number.isFinite(anchorVal)) body[anchor] = anchorVal;
        else if (!allowBlank) return null;
        if (Number.isFinite(targetVal)) body[target] = targetVal;
        else if (!allowBlank) return null;
        // `basis` travels only where it means something. Since a100 the
        // capability block is the single authority on what the object offers,
        // and it locks a Portfolio to net; since a104 the leaf can narrow that
        // again. A basis neither of them allows is never sent.
        const basis = basisLabel ? currentBasis() : null;
        if (basis) body.basis = basis;
        // The expense clause, where drawn and live. Empty or zero sends
        // nothing, and a P&L's dead box never travels: the ledger is the
        // authority on that book's expenses.
        if (expenseInput && !expenseInput.disabled) {
            const e = parseFloat(expenseInput.value);
            if (Number.isFinite(e) && e > 0) body.expense_ratio = e;
        }
        return body;
    }

    /**
     * Adopt a held pricing, so a leaf opens on what the reader has been using.
     *
     * Writes the **question** and not only its answer: a pricing struck at a
     * cost of capital arrives showing that cost of capital, with the premium it
     * implies on the preview line beneath. Passing null leaves the form alone,
     * which is what an arrival with nothing held wants.
     */
    function write(pricing) {
        if (!pricing) { refresh(); return; }
        anchor = pricing.anchor === 'a' ? 'a' : 'p';
        const isP = anchor === 'p';
        anchorInput.step = isP ? '0.001' : '1';
        if (isP) anchorInput.max = '1'; else anchorInput.removeAttribute('max');
        const anchorVal = isP ? pricing.octet?.p : pricing.octet?.assets;
        if (Number.isFinite(anchorVal)) anchorInput.value = String(anchorVal);
        if (targets.includes(pricing.target)) {
            target = pricing.target;
            const value = pricing.octet?.[pricing.target === 'coc' ? 'coc' : pricing.target];
            if (Number.isFinite(value)) targetInput.value = String(value);
        } else if (targets.includes('premium')
                   && Number.isFinite(pricing.octet?.premium)) {
            // The leaf does not offer the target this was struck with, so it
            // takes the premium that target resolved to, which is the same
            // pricing in the spelling this leaf does offer.
            target = 'premium';
            targetInput.value = String(pricing.octet.premium);
        }
        targetInput.step = target === 'premium' ? '1' : '0.01';
        // The expense ratio the pricing was struck with, when it carried one;
        // a pricing struck bare leaves the shared value where it stands.
        if (expenseInput && !expenseInput.disabled
                && Number.isFinite(pricing.expense)) {
            expenseInput.value = String(pricing.expense);
            expenseRatio = pricing.expense > 0 ? pricing.expense : null;
        }
        renderAnchor();
        renderTarget();
        refresh();
    }

    /** Print a sentence where the preview goes, and stop the line contradicting it. */
    function note(text) {
        if (!previewNode) return;
        ticket += 1;                       // any answer in flight is now stale
        previewNode.textContent = text;
        previewNode.classList.remove('is-pending');
    }

    function setBusy(on, busyWord) {
        button.disabled = on || dormant;
        button.textContent = on ? busyWord : verb;
    }

    /**
     * The expense box's own greying and refresh.
     *
     * Dead with a why on a P&L, whose ledger states its own expenses, and
     * refreshed from the shared value so a leaf opens showing what was typed
     * on another one. The focused box is left alone: a sync must not retype
     * under the reader's cursor.
     */
    function syncExpense() {
        if (!expenseInput) return;
        const isPnl = (context() || {}).kind === 'pnl';
        expenseInput.disabled = dormant || isPnl;
        expenseInput.title = isPnl
            ? 'the ledger states its own expenses'
            : 'gross expense as a fraction of premium; empty or zero sends nothing';
        if (document.activeElement !== expenseInput) {
            expenseInput.value = expenseRatio != null ? String(expenseRatio) : '0';
        }
    }

    /** Redraw what depends on the object: the basis greying, and the line. */
    function sync() {
        syncExpense();
        renderBasis();
        refresh();
    }

    /**
     * Put the whole form to sleep, or wake it: every control drawn and dead.
     *
     * For a P&L, which carries a premium and an asset level on every row of its
     * ledger, so there is no single one to state and nothing for the verb to
     * add. Dormant rather than hidden, per the author's ruling: the controls
     * stay on screen so the reader learns the question exists, and the `note()`
     * sentence says why this object answers it by itself.
     */
    function setDormant(on) {
        dormant = Boolean(on);
        row.classList.toggle('is-dormant', dormant);
        anchorInput.disabled = dormant;
        targetInput.disabled = dormant;
        button.disabled = dormant;
        syncExpense();
        renderAnchor();
        renderTarget();
        renderBasis();
    }

    renderAnchor();
    renderTarget();
    renderBasis();

    return { read, write, setBusy, sync, note, setDormant,
             held: () => held, button };
}

/** Money, grouped and to the cent, the same reading the tables give it. */
export function money(value) {
    return Number.isFinite(value)
        ? value.toLocaleString('en-US', { minimumFractionDigits: 2,
                                          maximumFractionDigits: 2 })
        : '';
}

/** A ratio as a percent to one place. */
export function percent(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '';
}
