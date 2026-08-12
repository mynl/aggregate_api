// The feel: what turns a puck that works into one worth using.
//
// Phase 4 of `dev/plan-spacemouse.md`. Everything here is preference rather
// than mechanism: how fast each axis is, which way round it goes, how much of
// the travel is ignored, how sharply the curve rises, and whether six axes at
// once is a pleasure or a soup. `surface-nav.js` holds the defaults and does
// the arithmetic; this holds the reader's answer, and persists it.
//
// Sticky under `aggapi.spacemouse`, the same try and catch pattern the chart
// view state uses: a browser in private mode refuses the write, and a control
// that works but forgets is better than one that throws.
//
// The debug readout lives **in the panel** rather than over the canvas. It is
// the tuning loop made visible, so it belongs beside the sliders it is there to
// justify, and the canvas is the thing being tuned: covering a corner of it
// with numbers about itself is the wrong trade.

import * as spacemouse from '../spacemouse.js';
import { el, empty } from '../utils/dom.js';
import { NAV_DEFAULTS } from './surface-nav.js';

const FEEL_KEY = 'aggapi.spacemouse';

/** The reader's settings, over the nav's defaults and the device's deadzone. */
const FEEL_DEFAULTS = {
    orbit: NAV_DEFAULTS.orbit,
    elevate: NAV_DEFAULTS.elevate,
    zoom: NAV_DEFAULTS.zoom,
    pan: NAV_DEFAULTS.pan,
    expo: NAV_DEFAULTS.expo,
    dominant: NAV_DEFAULTS.dominant,
    invert: { ...NAV_DEFAULTS.invert },
    deadzone: 0.05,
    debug: false,
};

/** The five axes that drive something. Roll is unmapped: an orbit camera has
 *  no roll, so an invert flag for it would be a control over nothing. */
const MAPPED = [
    ['rz', 'twist', 'orbit, the azimuth'],
    ['rx', 'tilt', 'elevation, how high the camera stands'],
    ['ty', 'push', 'zoom, in and out'],
    ['tx', 'slide', 'pan, left and right on screen'],
    ['tz', 'lift', 'pan, up and down on screen'],
];

/** The four gains, as the sliders that set them. Ranges are wide enough to be
 *  wrong in both directions, which is what makes a slider worth having. */
const GAINS = [
    ['orbit', 'twist', 10, 270, 5, 'degrees a second at full twist'],
    ['elevate', 'tilt', 10, 180, 5, 'degrees a second at full tilt'],
    ['zoom', 'zoom', 0.1, 3, 0.05, 'e-folds of distance a second'],
    ['pan', 'pan', 0.1, 3, 0.05, 'fraction of the distance a second'],
];

let feel = (() => {
    try {
        const held = JSON.parse(localStorage.getItem(FEEL_KEY) || '{}');
        return { ...FEEL_DEFAULTS, ...held,
                 invert: { ...FEEL_DEFAULTS.invert, ...(held.invert || {}) } };
    } catch {
        return { ...FEEL_DEFAULTS, invert: { ...FEEL_DEFAULTS.invert } };
    }
})();

/** What the integrator reads: the gains and the curve, without the device's. */
function navSettings() {
    return {
        orbit: feel.orbit,
        elevate: feel.elevate,
        zoom: feel.zoom,
        pan: feel.pan,
        expo: feel.expo,
        dominant: feel.dominant,
        invert: { ...feel.invert },
    };
}

/** The current settings, for a nav being created before any panel exists. */
export function feelForNav() {
    return navSettings();
}

/** The deadzone is the device's, so it is applied there rather than held twice. */
function applyTuning() {
    spacemouse.setTuning({ deadzone: feel.deadzone });
}
applyTuning();

function persist() {
    try { localStorage.setItem(FEEL_KEY, JSON.stringify(feel)); } catch { /* private mode */ }
}

/**
 * The settings affordance: a button, and the row it opens.
 *
 * Parameters
 * ----------
 * hooks : object
 *     `nav`, the live integrator, whose `settings` this writes so a slider
 *     moved with the cap held takes effect on the next frame rather than at
 *     the next connection; `camera()`, the live camera for the debug readout;
 *     and `register(off)`, which the strip calls when it rebuilds, so a
 *     subscription cannot outlive the panel that reads it.
 *
 * Returns
 * -------
 * object
 *     `{button, panel}`, for the caller to place in its own row.
 */
export function feelControls({ nav, camera, register }) {
    const panel = el('div', { className: 'spacemouse-feel', hidden: 'hidden' });
    const button = el('button', {
        type: 'button',
        className: 'exhibit-toggle',
        title: 'How the puck feels: the speed of each axis, which way round it '
            + 'goes, the deadzone, the curve, and a live readout for tuning '
            + 'against. Kept per browser',
        onClick: () => {
            const open = !panel.hasAttribute('hidden');
            panel.toggleAttribute('hidden', open);
            button.classList.toggle('active', !open);
        },
    }, 'feel');
    button.disabled = !spacemouse.isSupported();
    if (button.disabled) {
        button.title = 'This browser has no WebHID, so there is no puck to tune.';
    }

    const push = () => {
        if (nav) nav.settings = navSettings();
        applyTuning();
        persist();
    };

    // The readout subscribes, and the panel is redrawn whenever it is toggled
    // or the defaults are put back. Held in one place and dropped before each
    // redraw, so toggling it twice does not leave a handler writing into nodes
    // that are no longer on the page.
    let readoutOff = null;
    const dropReadout = () => { if (readoutOff) readoutOff(); readoutOff = null; };
    register(dropReadout);

    function draw() {
        dropReadout();
        empty(panel);
        panel.appendChild(el('div', { className: 'spacemouse-feel-note' },
            'Gains are per second at full deflection, which is the only unit '
            + 'in which they mean anything you can feel.'));

        const grid = el('div', { className: 'spacemouse-feel-grid' });
        for (const [key, label, min, max, step, hint] of GAINS) {
            const value = el('span', { className: 'spacemouse-feel-value' },
                             String(feel[key]));
            const input = el('input', {
                type: 'range', min: String(min), max: String(max), step: String(step),
                value: String(feel[key]), title: hint,
                onInput: () => {
                    feel[key] = Number(input.value);
                    value.textContent = String(feel[key]);
                    push();
                },
            });
            grid.append(el('label', { title: hint }, label), input, value);
        }
        // The curve and the deadzone, in the same grid: both are shaping and
        // both are read as fractions.
        for (const [key, label, max, hint] of [
            ['expo', 'curve', 1, '0 is linear, 1 is a pure cube: small '
                + 'deflections precise, full deflection fast'],
            ['deadzone', 'deadzone', 0.3, 'How much of the travel around the '
                + 'center is ignored, so a puck resting against its own spring '
                + 'does not drift the camera'],
        ]) {
            const value = el('span', { className: 'spacemouse-feel-value' },
                             feel[key].toFixed(2));
            const input = el('input', {
                type: 'range', min: '0', max: String(max), step: '0.01',
                value: String(feel[key]), title: hint,
                onInput: () => {
                    feel[key] = Number(input.value);
                    value.textContent = feel[key].toFixed(2);
                    push();
                },
            });
            grid.append(el('label', { title: hint }, label), input, value);
        }
        panel.appendChild(grid);

        const flags = el('div', { className: 'spacemouse-feel-flags' });
        flags.appendChild(el('span', { className: 'exhibit-group-label' }, 'reverse'));
        for (const [axis, label, what] of MAPPED) {
            flags.appendChild(check(`${label}`, feel.invert[axis],
                `Reverse ${label}: ${what}`, (on) => { feel.invert[axis] = on; push(); }));
        }
        panel.appendChild(flags);

        const options = el('div', { className: 'spacemouse-feel-flags' });
        options.appendChild(check('one axis at a time', feel.dominant,
            'Suppress everything but the largest deflection. For readers who '
            + 'find six axes at once soupy; off by default, because moving '
            + 'three at once is the reason to own one of these',
            (on) => { feel.dominant = on; push(); }));
        options.appendChild(check('live readout', feel.debug,
            'The axes as they arrive and the camera they are driving, which '
            + 'is the tuning loop made visible',
            (on) => { feel.debug = on; persist(); draw(); }));
        options.appendChild(el('button', {
            type: 'button',
            className: 'exhibit-toggle',
            title: 'Back to the settings this shipped with',
            onClick: () => {
                feel = { ...FEEL_DEFAULTS, invert: { ...FEEL_DEFAULTS.invert } };
                push();
                draw();
            },
        }, 'defaults'));
        panel.appendChild(options);

        if (feel.debug) {
            panel.appendChild(readout(camera, (off) => { readoutOff = off; }));
        }
    }

    draw();
    return { button, panel };
}

/** A checkbox with its label, in the row's own type size. */
function check(label, on, title, onChange) {
    const input = el('input', { type: 'checkbox' });
    input.checked = Boolean(on);
    input.addEventListener('change', () => onChange(input.checked));
    return el('label', { className: 'spacemouse-feel-check', title }, input, label);
}

/**
 * The live readout: six axis bars and the camera they are driving.
 *
 * Written straight into the nodes on each report rather than through a render
 * pass, because it arrives at the report rate and rebuilding the panel sixty
 * times a second to look at six numbers would be the slowest thing on the
 * page. Nothing is written when the puck is quiet, so an idle reader with the
 * readout open costs nothing.
 */
function readout(camera, hold) {
    const host = el('div', { className: 'spacemouse-readout' });
    const bars = {};
    for (const [axis, label] of MAPPED.concat([['ry', 'roll', '']])) {
        const fill = el('i');
        const bar = el('div', { className: 'spacemouse-bar' }, fill);
        const value = el('span', { className: 'spacemouse-feel-value' }, '0.00');
        host.append(el('label', {}, `${label} ${axis.toUpperCase()}`), bar, value);
        bars[axis] = { fill, value };
    }
    const line = el('div', { className: 'spacemouse-readout-camera' }, 'camera: idle');
    host.appendChild(line);
    hold(spacemouse.subscribe((message) => {
        for (const [axis, bar] of Object.entries(bars)) {
            const v = message.axes[axis] || 0;
            bar.fill.style.left = `${50 + Math.min(0, v * 50)}%`;
            bar.fill.style.width = `${Math.abs(v) * 50}%`;
            bar.value.textContent = v.toFixed(2);
        }
        const held = camera && camera();
        line.textContent = held
            ? `camera: alpha ${held.alpha.toFixed(1)}, beta ${held.beta.toFixed(1)},`
                + ` distance ${(held.distance || 0).toFixed(1)},`
                + ` center ${(held.center || [0, 0, 0]).map((v) => v.toFixed(1)).join(', ')},`
                + ` ${held.projection || 'perspective'}`
            : 'camera: nothing to drive';
    }));
    return host;
}
