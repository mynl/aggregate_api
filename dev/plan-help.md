# plan-help — short in-SPA help

Status: **agreed design** (no code yet). Reference mock: `hacks/mockup-09.html`
(open it, click `?` top-right). Target: a small 1.0.0a* bump — batch with other
plans into one release.

A compact, always-available help affordance so a first-time visitor can orient
themselves without leaving the page, and without permanently eating screen space.

## Trigger (always visible, top-right)
A `bi-question-circle` icon button in the header `nav-meta` row, after
`docs · github`. Always shown, including on phones where the version chips hide
(help matters more on mobile). Opens the panel on demand; the content is not
persistently on screen.

## Format — decided
**Right-side Bootstrap offcanvas**, ~360px (86vw cap on small screens), opened
by the `?`, closed by its ✕ or the backdrop. (Considered and rejected: a
popover — too cramped for the tab/controls guide; a modal — blocks the page; a
persistent strip — eats screen space.)

## Content (final — mirrors `hacks/mockup-09.html`)
Heading: **DecL playground—quick help** (em dash, no surrounding spaces).

1. **Lead** — "Build and explore compound *(aggregate)* loss distributions from
   a simple **DecL** program." (No "one-line" qualifier — portfolios are
   multiline; that nuance is omitted to keep the line clean.)
2. **Try it** — paste-ready example with a **Load it** button (drops it into the
   editor) and a "then press Ctrl+Enter" hint:
   `agg Demo 100 claims 1000 xs 0 sev lognorm 90 cv 1.5 poisson`
3. **Keys** — `Ctrl+Enter` build · `Ctrl+Space` autocomplete · `↑ ↓` step
   through history · `Alt+↑ ↓` step through examples · `✕` clear the editor.
4. **Controls** (one line each, colon-separated):
   - **Build**: run the program (same as Ctrl+Enter)
   - **Examples**: load a ready-made program
   - **log2**: FFT grid size, 2^log2 buckets (auto picks it, max 16)
   - **bs**: bucket size / resolution (auto picks it)
5. **Output tabs** (one line each, colon-separated):
   - **Info**: object summary & grid settings
   - **Describe**: Freq / Sev / Agg moments
   - **Plot**: visualize the object
   - **Price**: pricing metrics and allocation analysis
   - **Reins**: ceded / net by layer
   - **More ▾**: Stats · Density · bs window
6. **Learn more** —
   [DecL language reference](https://aggregate.readthedocs.io/en/latest/4_dec_Language_Reference.html)
   · aggregate library on github.
7. **Fair-use note** — "This is a shared, free demo, so builds are rate-limited.
   Want no limits? `aggregate` is open source—run it locally." (ties into the
   friendly-429 card.)

Punctuation house style: **colons** in the Controls / Output-tabs lists; em
dashes carry **no surrounding spaces**.

## Behavior decisions
- **Alt+↑/↓ is documented** (in the Keys list). The author kept forgetting the
  history-vs-examples distinction — which is exactly why it's surfaced, not
  hidden. (Note: this supersedes the earlier "keep it secret" idea.)
- **Load it** button is wired — drops the example into the editor (the only
  interactive bit; the rest of the panel is static).
- **Auto-open once?** Optional: pop the panel on first visit (localStorage
  `seen` flag), then on-demand. *(Lean: don't auto-open.)*
- **`?` / F1 to toggle** the panel — nice-to-have, optional.

## Port notes (when this lands)
- Add the `?` button to `web/index.html` `nav-meta`, the offcanvas markup at end
  of `<main>`/body, and the `.help-*` CSS to `web/src/styles/site.css` (all
  present in the mockup's inlined `<style>`).
- Bootstrap JS is already bundled, so the offcanvas needs no new dependency.
- Wire **Load it** to `editor.setText(...)` + `editor.focus()` (same path the
  Examples dropdown uses).

## Effort
Small: a header `?` + one offcanvas + static content + the Load-it wiring. ~Half
a day incl. polish. No backend.
