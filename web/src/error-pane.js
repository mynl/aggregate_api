// Format Plan B's ErrorReport JSON for human reading.
//
// ErrorReport shape (from src/aggregate/parser_errors.py):
//
//   {
//     "kind":        "parse" | "lex" | "limit",
//     "message":     "Unexpected identifier 'mixedd'.",
//     "line":        1,
//     "column":      41,
//     "got":         "mixedd",
//     "expected":    ["MIXED", "NOTE", "$END"],
//     "expected_labels": ["'mixed'", "'note'", "end of input"],
//     "suggestions": ["mixed"],
//     "source":      "agg X 100 claims sev lognorm 100 cv 2 mixedd poisson 0.5",
//     "caret":       "                                        ^^^^^^",
//   }
//
// We render it as a monospaced block with the caret line under the
// source. Suggestions become a "did you mean" line in italics.

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
            el('div', { className: 'agg-ratelimit-title' }, 'Easy there — grab a coffee ☕'),
            el('div', { className: 'agg-ratelimit-msg' },
                "We're glad you're enjoying ", el('code', {}, 'aggregate'),
                "! It's a shared, free resource, so builds are gently rate-limited "
                + 'to keep it snappy for everyone. ', wait),
            el('div', { className: 'agg-ratelimit-sub small text-muted' },
                'Want unlimited builds? ', el('code', {}, 'aggregate'),
                ' is open source — ',
                el('a', {
                    href: 'https://github.com/mynl/aggregate',
                    target: '_blank', rel: 'noopener',
                }, 'run it locally'),
                '.')),
    );
}

export function renderError(err) {
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

    const labels = detail.expected_labels || detail.expected || [];
    if (labels.length) {
        parts.push(el('div', { className: 'small text-muted' },
            'Expected: ', labels.join(', '), '.'));
    }

    return el('div', { className: 'alert alert-warning agg-error-pane', role: 'alert' },
        ...parts,
    );
}
