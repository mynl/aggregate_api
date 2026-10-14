// DecL help: the library's anatomy page, opened from the `?` in the program box,
// and its one-page card, opened from Menu ▸ DecL on one page.
//
// The library writes the pages (words, styles, syntax colors) and the api serves
// them as HTML fragments. What is here is only what the Lab adds: where each page
// opens and how it closes, the `in-lab` class that shows the Lab's own notes, a
// Load button on every example the anatomy marks loadable, and printing the card.
//
// Plan `dev/done/plan-1.7.0-decl-help.md`, steps [anatomy] and [card].

/** The text on the `?` when the installed library has no help. */
export const UNAVAILABLE = 'DecL help arrives with aggregate 1.2.0';

/**
 * The programs a fragment marks loadable, in document order.
 *
 * Read from the `data-load` attribute and nothing else: the library writes each
 * program there verbatim, so the host never depends on the page's markup (the
 * plan's Q3).
 *
 * @param {ParentNode} root the inserted fragment.
 * @returns {Array<{node: Element, program: string}>}
 */
export function loadables(root) {
    return [...root.querySelectorAll('[data-load]')]
        .map((node) => ({ node, program: node.getAttribute('data-load') || '' }))
        .filter(({ program }) => program.trim() !== '');
}

/**
 * Wire the `?`, the popover, and its ways of closing.
 *
 * Parameters
 * ----------
 * button : HTMLButtonElement
 *     The `?` in the editor's margin column. Disabled until `offer` says the
 *     library has the anatomy.
 * pop : HTMLElement
 *     The popover, holding `.decl-pop-close` and `.decl-pop-slot`.
 * main : HTMLElement
 *     Takes `decl-open` while the help is open, which dims the output.
 * fetchFragment : function(string): Promise<string>
 *     Fetches one form's HTML. Called at most once per form while it succeeds.
 * onLoad : function(string)
 *     Puts a program in the editor. Called by a Load button; must not build.
 * card : object
 *     Menu ▸ DecL on one page: `item` (the menu button), `why` (the line under
 *     its label that gives the reason when it is unavailable), `slot` (the
 *     sheet's body), `printBtn`, and `show()`, which opens the sheet. The sheet
 *     is a Bootstrap modal, so its `✕` and Esc are Bootstrap's.
 *
 * Returns
 * -------
 * object
 *     `offer(meta)` to enable both entry points from `/v1/meta`, `open()`,
 *     `close()` and `isOpen()` for the popover, and `openCard()`. `close` is safe
 *     to call at any time, and `build()` calls it.
 *
 * Notes
 * -----
 * Every route to closed runs the same `close`: the popover's `✕`, the `?`, Esc, a
 * click on the dimmed output, and any build. The `?` pressed while open is that
 * same close, so its label never changes meaning with state.
 *
 * Load loads and does not build (author, 2026-10-13), and the help stays open,
 * because a reader using it is composing with the slot table beside them. Build
 * closes the help and shows the result.
 */
export function mountDeclHelp({ button, pop, main, fetchFragment, onLoad, card }) {
    const slot = pop.querySelector('.decl-pop-slot');
    const closeBtn = pop.querySelector('.decl-pop-close');
    // One request per form, kept while it succeeds; a failure is forgotten so
    // the next open tries again.
    const pending = new Map();
    let open = false;

    function fragment(form) {
        if (!pending.has(form)) {
            const p = fetchFragment(form);
            p.catch(() => pending.delete(form));
            pending.set(form, p);
        }
        return pending.get(form);
    }

    function message(target, text) {
        const p = document.createElement('p');
        p.className = 'decl-pop-msg';
        p.textContent = text;
        target.replaceChildren(p);
    }

    /**
     * Insert a fragment into `target` and add what only the Lab has.
     *
     * Any other help section in the document goes first, so opening the card
     * takes the anatomy out of the popover and the reverse. The library scopes
     * every rule to its form, so two cannot restyle each other; one at a time is
     * hygiene now, not correctness (the plan's Q2). Load buttons go on the
     * anatomy only: the card is for reading and printing.
     */
    function insert(target, html, { loads }) {
        for (const old of document.querySelectorAll('.decl-help')) old.remove();
        const host = document.createElement('div');
        host.innerHTML = html;
        const section = host.querySelector('.decl-help');
        if (!section) { message(target, 'The DecL help arrived empty.'); return; }
        section.classList.add('in-lab');
        for (const { node, program } of loads ? loadables(section) : []) {
            const load = document.createElement('button');
            load.type = 'button';
            // A code block takes the button inside its top right corner; any
            // other loadable (the anatomy table) below its bottom right, since
            // its first row runs to the edge. See `.dh-load` in site.css.
            load.className = node.tagName === 'PRE' ? 'dh-load' : 'dh-load dh-load-below';
            load.textContent = 'Load';
            load.title = 'Put this program in the editor';
            load.addEventListener('click', (ev) => {
                ev.stopPropagation();
                onLoad(program);
            });
            node.prepend(load);
        }
        target.replaceChildren(section);
    }

    async function show() {
        open = true;
        pop.hidden = false;
        main.classList.add('decl-open');
        button.setAttribute('aria-expanded', 'true');
        if (slot.querySelector('.decl-help.dh-anatomy')) return;
        message(slot, 'Loading DecL help…');
        try {
            const html = await fragment('anatomy');
            if (open) insert(slot, html, { loads: true });
        } catch (err) {
            if (open) message(slot, `DecL help could not be loaded: ${err.message}`);
        }
    }

    /** Menu ▸ DecL on one page: close the popover, open the sheet, fill it. */
    async function showCard() {
        close();
        card.show();
        if (card.slot.querySelector('.decl-help.dh-card')) return;
        message(card.slot, 'Loading the DecL card…');
        try {
            insert(card.slot, await fragment('card'), { loads: false });
        } catch (err) {
            message(card.slot, `The DecL card could not be loaded: ${err.message}`);
        }
    }

    /**
     * Print the sheet alone, on one Letter landscape page.
     *
     * The `@page` rule is injected for the one print and removed after it,
     * rather than written in site.css, because `@page` cannot be scoped to a
     * class: a permanent rule would change how every other page of the app
     * prints. `printing-decl-card` on `body` is what the print CSS keys on to
     * hide everything but the sheet's body. The card keeps its own colors in
     * print (it sets `print-color-adjust` on itself), so nothing here does.
     */
    function printCard() {
        const page = document.createElement('style');
        page.textContent = '@page { size: letter landscape; margin: 0; }';
        document.head.append(page);
        document.body.classList.add('printing-decl-card');
        window.addEventListener('afterprint', () => {
            page.remove();
            document.body.classList.remove('printing-decl-card');
        }, { once: true });
        window.print();
    }

    function close() {
        if (!open) return;
        open = false;
        pop.hidden = true;
        main.classList.remove('decl-open');
        button.setAttribute('aria-expanded', 'false');
    }

    button.addEventListener('click', () => (open ? close() : show()));
    closeBtn.addEventListener('click', close);
    // Esc closes from anywhere, the editor included, unless something nearer
    // took it first: CodeMirror's completion list prevents the default when it
    // closes itself, and that press should not also close the help.
    document.addEventListener('keydown', (ev) => {
        if (open && ev.key === 'Escape' && !ev.defaultPrevented) close();
    });
    // A click on the dimmed output closes the help and does nothing else, so a
    // reader dismissing it does not also press a leaf they cannot see properly.
    // Capture, so the swallowed click never reaches the pane's own handlers.
    main.addEventListener('click', (ev) => {
        if (!open) return;
        const area = pop.parentElement;
        if (!(ev.target instanceof Node) || area.contains(ev.target)) return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
    }, true);

    card.item.addEventListener('click', showCard);
    card.printBtn.addEventListener('click', printCard);

    return {
        offer(meta) {
            const forms = Array.isArray(meta?.decl_help) ? meta.decl_help : [];
            const anatomy = forms.includes('anatomy');
            button.disabled = !anatomy;
            button.title = anatomy ? 'DecL help' : UNAVAILABLE;
            const hasCard = forms.includes('card');
            card.item.disabled = !hasCard;
            card.why.textContent = hasCard ? '' : UNAVAILABLE;
        },
        open: show,
        close,
        isOpen: () => open,
        openCard: showCard,
    };
}
