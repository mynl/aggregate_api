# plan-ui-enhancements-01 — small UI polish

Status: **ready** (small, low-risk). Target: batch into the next 1.0.0a* release.
A catch-all for quick UI fixes. First entries: make the remaining form `<input>`s
phone-friendly (the editor already got this treatment in a4).

## 1. Stop iOS magnifying form inputs on focus
iOS Safari/WebKit zooms the page when a focused input's font is < 16px. These
are all ~12.5px (`.78rem`) and zoom on a phone:
- Price tab: `#price-p`, `#price-target-val` (`.price-field input`)
- bs dropdown: `#bs-custom` (`.bs-custom input`)

**Fix:** a phone-only bump to 16px (desktop keeps the tighter size):
```css
@media (max-width: 575.98px) {
    .price-field input,
    .bs-custom input { font-size: 16px; }
}
```
(Mirrors the editor's `min-height: 4.5em` / 16px mobile treatment.)

## 2. Suppress the iOS AutoFill (key / credit-card / PIN) accessory bar
WebKit pops the AutoFill bar above the keyboard when it guesses an input might be
credentials/payment. Mark these fields as not-a-form-field:
- `#price-p`, `#price-target-val` → `autocomplete="off" inputmode="decimal"`
- `#bs-custom` → `autocomplete="off" inputmode="decimal"`
  (it accepts fractions like `1/64`, so keep `type="text"`; `inputmode="decimal"`
  just hints the keypad — verify it doesn't block `/`. If it does, drop inputmode
  and keep `autocomplete="off"`.)

Also harmless-and-correct for numeric fields: `autocorrect="off"
autocapitalize="off"`.

**Caveat:** for real `<input>`s `autocomplete="off"` is fairly reliable
(unlike the editor's contenteditable), but iOS still doesn't *guarantee*
suppression. If the bar persists it's OS-level and not web-controllable.

## Files
- `web/src/styles/site.css` — the media-query block (item 1).
- `web/index.html` — the input attributes (item 2): the two Price inputs in the
  `#t-price` form and `#bs-custom` in the bs dropdown.

## Effort
~10 minutes, no backend, eyeball-verify on an iPhone.
