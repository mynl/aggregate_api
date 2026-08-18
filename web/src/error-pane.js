// Format the library's ErrorReport JSON for human reading.
//
// The full report the server sends, which is `ErrorReport.to_dict()` from
// `aggregate/parser_errors.py` (an `asdict` over the dataclass, so this list is
// exactly its fields and nothing else):
//
//   {
//     "line":        1,
//     "column":      41,
//     "source":      "agg X 100 claims sev lognorm 100 cv 2 mixedd poisson 0.5",
//     "source_line": "agg X 100 claims sev lognorm 100 cv 2 mixedd poisson 0.5",
//     "caret":       "                                        ^^^^^^",
//     "got":         "mixedd",
//     "got_type":    "NAME",
//     "expected":    ["'mixed'", "'note'", "end of input"],
//     "expected_terminals": ["MIXED", "NOTE", "$END"],
//     "suggestions": ["mixed"],
//     "message":     "Unexpected identifier 'mixedd'.",
//   }
//
// Corrected at a49. This block used to document a `kind` field and an
// `expected_labels` field, neither of which exists: `expected` **is** the
// human-friendly list (`expected_terminals` is the raw Lark one), and the
// `detail.expected_labels || detail.expected` below has always been resolving
// on its second operand.
//
// We render it as a monospaced block with the caret line under the
// source. Suggestions become a "did you mean" line in italics.
//
// The one-line form of the same report now also goes into the status strip
// (`failureLine` in main.js), so the reader is told what was wrong without
// scrolling. This pane is the detail: the source, the caret, and what would
// have been accepted there.

import * as history from './history.js';
import { el } from './utils/dom.js';

/**
 * Friendly panel shown when a build is rate-limited (HTTP 429).
 *
 * Builds are the one throttled endpoint on the shared public demo; rather
 * than a bare "HTTP 429" we explain why, suggest a short wait (honoring the
 * Retry-After header when present), and point at running locally for no
 * limits. ``retryAfter`` is the header value (seconds) or undefined.
 */
export function renderRateLimit(retryAfter) {
    const secs = Number(retryAfter);
    const wait = Number.isFinite(secs) && secs > 0
        ? `Please try again in about ${secs} second${secs === 1 ? '' : 's'}.`
        : 'Please give it a moment and try again.';
    return el('div', { className: 'agg-ratelimit' },
        el('div', { className: 'agg-ratelimit-icon' },
            el('i', { className: 'bi bi-cup-hot' })),
        el('div', {},
            el('div', { className: 'agg-ratelimit-title' }, 'Easy there. Grab a coffee ☕'),
            el('div', { className: 'agg-ratelimit-msg' },
                "We're glad you're enjoying ", el('code', {}, 'aggregate'),
                "! It's a shared, free resource, so builds are gently rate-limited "
                + 'to keep it snappy for everyone. ', wait),
            el('div', { className: 'agg-ratelimit-sub small text-muted' },
                'Want unlimited builds? ', el('code', {}, 'aggregate'),
                ' is open source, so you can ',
                el('a', {
                    href: 'https://github.com/mynl/aggregate',
                    target: '_blank', rel: 'noopener',
                }, 'run it locally'),
                '.')),
    );
}

/**
 * The pane for a name the server's copy of your session no longer holds.
 *
 * `{error: 'recipe_not_found', kind, name, message}`, which the build route
 * sends when a reference resolves to nothing. The usual cause is not a typo: a
 * session's recipe base is dropped when it goes idle, when the registry evicts
 * it under load, or when the server restarts, and after that a reference to
 * something you built yourself names nothing.
 *
 * `onRebuild` is called with the program that declared the missing entry, when
 * history still holds one. That is the whole point of naming the entry rather
 * than describing the failure: the fix is one press away.
 */
function renderMissingEntry(detail, onRebuild) {
    const label = detail.kind ? `${detail.kind} ${detail.name}` : detail.name;
    const program = history.findDeclaring(detail.kind, detail.name);
    const parts = [
        el('div', { className: 'mb-1' },
            'The declaration ', el('code', {}, label),
            ' is not in this session any more, so the program cannot be built.'),
        el('div', { className: 'small text-muted mb-2' },
            detail.message || ''),
    ];
    if (program && typeof onRebuild === 'function') {
        const button = el('button', {
            className: 'btn btn-sm btn-outline-secondary',
            type: 'button',
        }, `Rebuild ${label}`);
        button.addEventListener('click', () => onRebuild(program));
        parts.push(button);
    } else {
        parts.push(el('div', { className: 'small' },
            'Build it again, then rebuild this program.'));
    }
    return el('div', { className: 'alert alert-warning agg-error-pane', role: 'alert' },
        ...parts);
}

export function renderError(err, onRebuild) {
    const body = (err && err.body) || {};
    const detail = body.detail || body || {};

    // A plain-string detail (a build-time semantic error like "Unknown
    // distortion kind 'dualx'; available: …") isn't an ErrorReport dict, so it
    // has no .line / .message and would otherwise fall through to the generic
    // "Request failed" branch. Render the message directly.
    if (typeof detail === 'string') {
        return el('div', { className: 'alert alert-warning agg-error-pane', role: 'alert' },
            detail);
    }

    // Checked ahead of the ErrorReport branches: this detail carries a
    // `message` and would otherwise render as a bare sentence, losing the one
    // thing the reader can act on.
    if (detail.error === 'recipe_not_found') {
        return renderMissingEntry(detail, onRebuild);
    }

    // Generic non-parse fallback (HTTP 500, network failure, etc.):
    if (!detail.line && !detail.message) {
        return el('div', { className: 'alert alert-danger', role: 'alert' },
            err?.message || 'Request failed',
        );
    }

    const parts = [];

    if (detail.line && detail.column) {
        parts.push(el('div', { className: 'small text-muted' },
            `Parse error at line ${detail.line}, column ${detail.column}.`));
    }

    if (detail.source) {
        // Render as a single <pre>, source on one line, caret beneath.
        const pre = el('pre', { className: 'agg-error-source mb-2' });
        pre.appendChild(el('code', {}, detail.source + '\n'));
        if (detail.caret) {
            pre.appendChild(el('code', { className: 'agg-error-caret' }, detail.caret));
        }
        parts.push(pre);
    }

    if (detail.message) {
        parts.push(el('div', { className: 'mb-1' }, detail.message));
    }

    if (Array.isArray(detail.suggestions) && detail.suggestions.length) {
        parts.push(el('div', { className: 'fst-italic mb-2' },
            'Did you mean: ',
            detail.suggestions.join(', '),
            '?'));
    }

    // `expected` is the human-friendly list. The `expected_labels` name this
    // used to try first has never been sent by anything; see the header.
    const labels = detail.expected || [];
    if (labels.length) {
        parts.push(el('div', { className: 'small text-muted' },
            'Expected: ', labels.join(', '), '.'));
    }

    return el('div', { className: 'alert alert-warning agg-error-pane', role: 'alert' },
        ...parts,
    );
}
