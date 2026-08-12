// Fetch wrappers for the /v1/* endpoints.
//
// One small layer over the browser's fetch:
//
// * _json() does the JSON serialize/deserialize dance and turns any
//   non-2xx response into an ApiError that carries the parsed body.
//   The body shape for parse errors is Plan B's ErrorReport, which
//   error-pane.js knows how to render.
// * api.plotUrl() returns a string (not a Promise) -- callers stick
//   it straight into <img src="…"> and let the browser fetch it.

import { API_BASE } from './config.js';

export class ApiError extends Error {
    constructor(status, body, retryAfter) {
        super((body && body.message) || `HTTP ${status}`);
        this.status = status;
        this.body = body;          // raw response body, JSON-parsed if possible
        this.retryAfter = retryAfter;   // Retry-After header (seconds), if any
    }
}

function qs(params) {
    const pairs = [];
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    return pairs.join('&');
}

async function _json(method, path, body) {
    const r = await fetch(API_BASE + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    // Try to parse as JSON whether ok or not -- 4xx/5xx still carry
    // the structured error body for the SPA to render.
    let data = null;
    const text = await r.text();
    if (text) {
        try { data = JSON.parse(text); }
        catch { data = { message: text }; }
    }
    if (!r.ok) throw new ApiError(r.status, data, r.headers.get('Retry-After'));
    return data;
}

export const api = {
    // Builds + cache
    build:        (decl, opts = {}) => _json('POST', '/v1/objects', { decl, ...opts }),
    list:         ()                => _json('GET',  '/v1/objects'),
    manifest:     (id)              => _json('GET',  `/v1/objects/${id}`),
    drop:         (id)              => _json('DELETE', `/v1/objects/${id}`),

    // Per-button data.
    //
    // The *tables* no longer come through here: they take one `frameIr` fetch
    // and render either way off it (see `tables.js`). What is left reaching for
    // a `FrameResponse` is the bulk densities via `frameOf`; the charts stopped
    // needing one at a62, when every picture became a chart document.
    //
    // `unit_density_df` came off this list there too. It existed for the
    // portfolio chart, which read per-unit columns off a common grid and drew
    // them itself; the `port` document carries each unit on its own native
    // grid, which a windowed book does not share with the portfolio's. The
    // route stays, since it is a public api and a legitimate frame to fetch.
    info:         (id)              => _json('GET',  `/v1/objects/${id}/info`),
    meta_of:      (id)              => _json('GET',  `/v1/objects/${id}/meta`),
    tail_df:      (id)              => _json('GET',  `/v1/objects/${id}/tail_df`),
    stats_df:     (id)              => _json('GET',  `/v1/objects/${id}/stats_df`),
    density_df:   (id, p = {})      => _json('GET',  `/v1/objects/${id}/density_df?${qs(p)}`),
    /**
     * A frame as a table document (the IR) for the static view.
     *
     * The presentation counterpart to the frame endpoints above. Built from the
     * DataFrame, so it keeps the two things the JSON form throws away: the row
     * index (sparsified into stub rowspans rather than reprinted per row) and
     * spanned MultiIndex column headers. Rendered client side by the walker in
     * `tables.js`.
     */
    /**
     * One document per frame, at house precision. There is no `precision`
     * parameter since a68: the exact values ride in every document under
     * `include_raw`, so full precision is a rendering the client does with
     * `atFullPrecision` and it costs no round trip.
     */
    frameIr:      (id, which) =>
        _json('GET', `/v1/objects/${id}/frame/${which}?format=ir`),
    /**
     * A library exhibit as its envelope: title, then one table document per
     * block. The library owns the business translation per perspective
     * (captions, row flags, drops, relabeling), so this is the path for an
     * exhibit that has no plain frame route behind it, and the richer path for
     * one that does.
     */
    exhibit:      (id, name, perspective = 'insurer') =>
        _json('GET', `/v1/objects/${id}/exhibit/${name}?perspective=${perspective}`),
    /**
     * A chart as a chart document (the library's chart IR).
     *
     * The chart sibling of `frameIr`: the library emitter owns every semantic
     * decision (series, axes, scales, marks, and any display reduction, which
     * arrives already applied). The client only adapts the document to
     * ECharts; see chartdoc-to-echarts.js.
     *
     * `params` are the grid charts' knob: `window` (quantile depth, in halves),
     * `detail` (target cells per axis) and `encoding`. They travel in the URL
     * because they change the bytes, so they belong in what the ETag answers
     * for. Which grid comes back is the library's decision, taken before the
     * reduction; asking for a depth is not the same as cropping what arrives,
     * and cropping here could not recover resolution already averaged away.
     */
    chartDoc:     (id, name, params = {}) => _json(
        'GET',
        `/v1/objects/${id}/chart/${name}${Object.keys(params).length ? `?${qs(params)}` : ''}`,
    ),
    kappa:        (id, p = {})      => _json('GET',  `/v1/objects/${id}/kappa?${qs(p)}`),

    // Reinsurance
    reinsDescription: (id)          => _json('GET',  `/v1/objects/${id}/reins_description`),
    /**
     * Loss at each probability, exact and rounded to three figures.
     *
     * For Quick Re, which lets attach and detach be written as probabilities.
     * `tail_df` carries VaR by return period, so it reaches q(0.99) and not
     * q(0.5); this reaches any of them.
     *
     * @param {string} basis `'aggregate'` (the annual law) or `'occurrence'`
     *   (the per-claim one). Not a convenience: an occurrence cession applies
     *   to a single claim, so a percentage means a different number on each
     *   tier, and reading both off the annual law writes layers that can never
     *   attach.
     */
    quantiles:    (id, ps, basis = 'aggregate') =>
        _json('GET',
              `/v1/objects/${id}/quantiles?p=${ps.join(',')}&basis=${basis}`),
    /**
     * Any named frame as a `FrameResponse`, by its route name.
     *
     * Generic despite where it started: the reinsurance frames were the first
     * caller, but every per-frame route answers the same shape at the same
     * place. This is the **bulk** path, for frames too long to carry as a
     * document (the densities), and the fallback when one comes back truncated.
     */
    frameOf:      (id, which, p = {}) => _json('GET', `/v1/objects/${id}/${which}?${qs(p)}`),

    // Pricing.
    //
    // Three routes, and two of them answer with exhibit envelopes rather than
    // frames: `calibrate_distortions` and `evaluate` return result objects, and
    // the library registers `pricing.calibrate`, `pricing.allocate` and
    // `pricing.evaluate` on those. So the app posts a form and draws a
    // document, exactly as every other table leaf does; nothing on this pane is
    // assembled here or formatted here.
    /**
     * The pentagon this form would complete, as scalars, with no calibration.
     *
     * The one pricing call that answers with numbers, because it feeds a line
     * of prose that updates as the reader types. It is also where the library's
     * unbounded anchor guard reaches them: a refusal is the preview text.
     */
    pricingPreview: (id, body) =>
        _json('POST', `/v1/objects/${id}/pricing/preview`, body),
    /**
     * Fit the distortion set: the `pricing.calibrate` and `pricing.allocate`
     * envelopes, each under both perspectives.
     *
     * One press fills two subtabs, and both readings travel, so stepping
     * between the leaves and flipping RAW to INSURER are both free.
     */
    pricingCalibrate: (id, body) =>
        _json('POST', `/v1/objects/${id}/pricing/calibrate`, body),
    /** The breakeven acceptability panel, as the `pricing.evaluate` envelope. */
    pricingEvaluate: (id, body) =>
        _json('POST', `/v1/objects/${id}/pricing/evaluate`, body),

    /**
     * `?ir=true` always: the Price frames are computed by this POST, so the
     * generic document route cannot reach them and they have to travel with the
     * response. Asking up front is what keeps the table view instant in both
     * directions instead of costing a re-POST on the flip.
     */
    price:        (id, body)        => _json('POST', `/v1/objects/${id}/price?ir=true`, body),
    /** Reinsured objects: calibrate on one basis, price them all. */
    reinsPrice:   (id, body)        => _json('POST', `/v1/objects/${id}/reins_price?ir=true`, body),
    pricing_at:   (id, body)        => _json('POST', `/v1/objects/${id}/pricing_at`, body),
    /**
     * The evaluation half of Pricing: the breakeven acceptability panel for a
     * premium already set. `?ir=true` for the same reason `price` asks.
     */
    evaluate:     (id, body)        => _json('POST', `/v1/objects/${id}/evaluate?ir=true`, body),

    // The derivations. Each answers with the DecL that reproduces the object
    // *and* the object, so the editor and the panes move together and the id
    // is the one an ordinary build of that text would produce.
    sharpen:      (id)              => _json('POST', `/v1/objects/${id}/sharpen`, {}),
    pnl:          (id, body = {})   => _json('POST', `/v1/objects/${id}/pnl`, body),
    reins:        (id, cession)     => _json('POST', `/v1/objects/${id}/reins`, { cession }),

    // DecL editor support
    complete:     (decl, cursor)    => _json('POST', '/v1/decl/complete', { decl, cursor }),
    lex:          (decl)            => _json('POST', '/v1/decl/lex', { decl }),
    formatDecl:   (decl)            => _json('POST', '/v1/decl/format', { decl }),

    // Metadata
    // group: 'topic' (default) | 'kind' | 'role'
    examples:     (group = '')      => _json('GET',  `/v1/examples?${qs({ group })}`),
    /** The `role:hero` entries. One is picked at random and built on landing. */
    heroes:       ()                => _json('GET',  '/v1/examples/heroes'),
    meta:         ()                => _json('GET',  '/v1/meta'),
    /** House plot style (aggregate.style's color cycle etc.) for the charts. */
    style:        ()                => _json('GET',  '/v1/meta/style'),
    health:       ()                => _json('GET',  '/v1/health'),

    // No `plotUrl`. The server-rendered figure route left with matplotlib at
    // a60: every chart is a document, the browser draws it, and the export is
    // the picture actually on screen rather than a second rendering of it.

    /** Everything the object says about itself in prose, in one payload. */
    narrative:    (id)              => _json('GET',  `/v1/objects/${id}/narrative`),

    // Pricing bounds. All three are payloads: the envelope became a chart
    // document at a60, where it had been an image identified by its query.
    boundsEnvelope:   (id, p = {}) =>
        _json('GET', `/v1/objects/${id}/bounds/envelope?${qs(p)}`),
    allocationBounds: (id, body)    =>
        _json('POST', `/v1/objects/${id}/bounds/allocation?ir=true`, body),
    pricingBounds:    (id, body)    =>
        _json('POST', `/v1/objects/${id}/bounds/pricing?ir=true`, body),

    /** Download-all-session-models URL. form: 'raw' (as typed) | 'agg' (canonical). */
    sessionModelsUrl: (form = 'raw') => `${API_BASE}/v1/session/models.agg?form=${form}`,
    // Per-frame CSV download/copy is handled by CsvGrid's own export controls;
    // the /frame/{which}.csv backend endpoints remain for full-frame API access.
};
