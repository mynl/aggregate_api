// The puck against the relief's camera: the mapping, the gains, and the loop.
//
// Phase 3 of `dev/plan-spacemouse.md`, the half that knows what an axis means
// and nothing about where it came from. `../spacemouse.js` opens the device
// and normalizes it; this turns six numbers into a camera and drives it.
//
// **A leaf: it imports nothing**, including echarts. The chart is reached
// through two injected functions, `read` and `write`, which is what keeps the
// arithmetic (the deadzone shaping, the pan basis, one step of the camera)
// under `node --test`, and what stops this module from ever holding a disposed
// instance: it resolves the live chart on the frame it needs it.
//
// The device is a **rate controller**: deflection is velocity, not position.
// Every gain below is therefore per second at full deflection, which is the
// only unit in which a number here means anything you can feel.
//
// The camera contract, from `surface.js` `readCamera`: echarts-gl writes the
// live camera back into the option's `viewControl` as the reader drags, so a
// stored camera re-sent sixty times a second fights the reader and wins. This
// works read, modify, write, **only while deflected**: each frame it reads the
// live camera, adds this tick's deltas and writes a partial option back. When
// every axis is inside the deadzone the loop stops and sends nothing, so mouse
// dragging is untouched and the damping feel is preserved. An interleaved
// drag is picked up for free, because the next tick starts from where the drag
// left the camera.

/** The mapping, in one table because conventions never survive the hardware.
 *
 * | puck axis        | camera parameter                     |
 * |------------------|--------------------------------------|
 * | twist the cap RZ | `beta`, azimuth                      |
 * | tilt RX          | `alpha`, elevation                   |
 * | slide in/out TY  | `distance`, zoom                     |
 * | slide left/right TX | `center`, camera relative horizontal |
 * | lift/press TZ    | `center`, camera relative vertical   |
 * | roll RY          | unmapped: an orbit camera has no roll |
 *
 * The signs are the plan's phase 2 question and are answered by the invert
 * flags rather than by editing this file. */
export const NAV_DEFAULTS = {
    // Degrees a second at full twist and full tilt. A quarter turn a second
    // is fast enough to swing round the box without losing the ridge.
    orbit: 90,
    elevate: 55,
    // Zoom is multiplicative: e-folds of distance a second, so the step is
    // the same fraction of where you are, at any distance. Additive zoom
    // crawls when far out and slams into the surface when close in.
    zoom: 0.9,
    // Pan, as a fraction of the current distance a second, which is what
    // echarts-gl's own mouse pan does: it scales by distance too.
    pan: 0.7,
    // Suppress all but the largest deflection. Off by default: 6DOF is the
    // point, and this is for readers who find it soupy.
    dominant: false,
    // The shaping curve. 0 is linear, 1 is a pure cube: small deflections
    // precise, full deflection fast.
    expo: 0.6,
    // Per axis, applied after shaping. Phase 2 has not read the hardware
    // yet, so these are where a reversed convention gets fixed.
    invert: { tx: false, ty: false, tz: false, rx: false, ry: false, rz: false },
};

/** echarts-gl's own bounds on the orbit camera, which it clamps to anyway.
 *
 * Restated rather than imported because they are `OrbitControl` defaults
 * rather than anything the app sets, and stepping past them here would mean
 * writing a distance the control silently refuses, which reads as a zoom that
 * sticks. */
const MIN_DISTANCE = 40;
const MAX_DISTANCE = 400;
const MIN_ALPHA = -90;
const MAX_ALPHA = 90;

/** A frame longer than this is a tab that was in the background: clamp it, or
 *  the camera leaps a full second's travel on the frame the reader comes back. */
const MAX_FRAME = 0.05;

/** No report for this long means the puck stopped talking, which is a release
 *  that got lost. Treated as centered, because a camera that drifts on after
 *  the hand comes off is the worst failure this can have. */
const STALE_MS = 300;

/**
 * The shaping curve: a blend of linear and cubic.
 *
 * Parameters
 * ----------
 * v : float
 *     One axis, already in [-1, 1] with the deadzone taken out.
 * expo : float
 *     0 for linear, 1 for a pure cube.
 *
 * Returns
 * -------
 * float
 *     The shaped axis, still in [-1, 1] and still 1 at full deflection, which
 *     is what makes the gains above readable as "per second at full travel"
 *     whatever the curve is.
 */
export function shape(v, expo = NAV_DEFAULTS.expo) {
    const k = Math.min(1, Math.max(0, expo));
    return (1 - k) * v + k * v * v * v;
}

/**
 * Everything but the largest deflection, zeroed.
 *
 * For readers who find six axes at once soupy: the puck moves one thing at a
 * time and the ambiguity of a slightly twisted push goes away. Off by default,
 * because moving three at once is the reason to own one of these.
 */
export function dominantOnly(axes) {
    let winner = null;
    let best = 0;
    for (const [name, v] of Object.entries(axes)) {
        if (Math.abs(v) > best) { best = Math.abs(v); winner = name; }
    }
    const out = {};
    for (const name of Object.keys(axes)) out[name] = name === winner ? axes[name] : 0;
    return out;
}

/**
 * The screen right and screen up directions, in the box's own space.
 *
 * Parameters
 * ----------
 * alpha, beta : float
 *     The camera's elevation and azimuth, in degrees, as `viewControl` states
 *     them.
 *
 * Returns
 * -------
 * object
 *     `{right, up}`, two orthogonal unit vectors as `[x, y, z]` triples in
 *     the grid3D box's world space, where y is the vertical.
 *
 * Notes
 * -----
 * Derived from `OrbitControl._updateTransform`, which builds the camera
 * rotation as `rotateY(-phi).rotateX(-theta)` with `theta = alpha` and
 * `phi = -beta` in radians; these are that matrix applied to the x and y unit
 * vectors. Deriving them rather than reading `camera.worldTransform` is what
 * keeps this module free of echarts, and the two agree by construction: the
 * pan `OrbitControl` does with the mouse uses exactly those two columns.
 *
 * Camera relative rather than along the data axes, because a pan along x when
 * the box has been swung round reads as the surface sliding away sideways
 * under the hand rather than following it.
 */
export function panBasis(alpha, beta) {
    const a = (alpha * Math.PI) / 180;
    const b = (beta * Math.PI) / 180;
    return {
        right: [Math.cos(b), 0, -Math.sin(b)],
        up: [-Math.sin(a) * Math.sin(b), Math.cos(a), -Math.sin(a) * Math.cos(b)],
    };
}

/**
 * One tick of the camera.
 *
 * Parameters
 * ----------
 * camera : object
 *     The live camera, `{alpha, beta, distance, center}`. Read fresh every
 *     frame rather than accumulated here, which is the whole read, modify,
 *     write contract: a mouse drag between two ticks is picked up rather than
 *     overwritten.
 * axes : object
 *     The six axes in [-1, 1], already normalized by the device layer.
 * settings : object
 *     `NAV_DEFAULTS` merged with whatever the reader has set.
 * dt : float
 *     Seconds since the last tick.
 *
 * Returns
 * -------
 * object or null
 *     A partial camera to write, or null when nothing moved. Null is not an
 *     optimization: writing an unchanged camera every frame is what fights a
 *     reader's drag.
 */
export function cameraStep(camera, axes, settings = NAV_DEFAULTS, dt = 1 / 60) {
    const how = { ...NAV_DEFAULTS, ...settings, invert: { ...NAV_DEFAULTS.invert, ...(settings.invert || {}) } };
    let shaped = {};
    for (const [name, v] of Object.entries(axes || {})) {
        shaped[name] = shape(v, how.expo) * (how.invert[name] ? -1 : 1);
    }
    if (how.dominant) shaped = dominantOnly(shaped);
    const moved = Object.values(shaped).some((v) => v !== 0);
    if (!moved || !camera || !Number.isFinite(camera.alpha)) return null;

    const distance = Number.isFinite(camera.distance) ? camera.distance : MIN_DISTANCE;
    const patch = {};
    if (shaped.rz) patch.beta = camera.beta + shaped.rz * how.orbit * dt;
    if (shaped.rx) {
        patch.alpha = Math.min(MAX_ALPHA,
                               Math.max(MIN_ALPHA, camera.alpha + shaped.rx * how.elevate * dt));
    }
    if (shaped.ty) {
        // Pushing the cap away from you takes you in, which is the convention
        // every 3Dconnexion profile ships with.
        patch.distance = Math.min(MAX_DISTANCE,
                                  Math.max(MIN_DISTANCE,
                                           distance * Math.exp(-shaped.ty * how.zoom * dt)));
    }
    if (shaped.tx || shaped.tz) {
        const { right, up } = panBasis(camera.alpha, camera.beta);
        const center = Array.isArray(camera.center) ? camera.center.slice(0, 3) : [0, 0, 0];
        const step = distance * how.pan * dt;
        // Minus, so the surface follows the hand: sliding the cap right sends
        // the camera's target left, which is the direction `OrbitControl`'s own
        // mouse pan moves it too.
        patch.center = [0, 1, 2].map((k) => (center[k] || 0)
            - right[k] * shaped.tx * step
            - up[k] * shaped.tz * step);
    }
    return Object.keys(patch).length ? patch : null;
}

/**
 * The live loop: subscribe input to it, and it drives the camera.
 *
 * Parameters
 * ----------
 * hooks : object
 *     `read()` returns the live camera or null when there is nothing to drive
 *     (no chart, or the flat reading is on screen); `write(patch)` applies a
 *     partial camera; `reset()` puts the view back, which is button 1; and
 *     `setProjection(next)` swaps perspective and orthographic, which is
 *     button 2. The last two are optional.
 * settings : object
 *     Merged over `NAV_DEFAULTS` and re-read on every tick through
 *     `nav.settings`, so the feel controls of phase 4 take effect while the
 *     puck is being held rather than at the next connection.
 *
 * Returns
 * -------
 * object
 *     `{input, stop, dispose, running, settings}`. `input` takes the device
 *     layer's message; everything else is lifecycle.
 *
 * Notes
 * -----
 * `requestAnimationFrame` when the page has one and a timer otherwise, so a
 * node test can drive `input` and `tick` without a browser. The loop starts on
 * the first deflected report and stops the moment the axes go quiet, which is
 * what leaves the mouse alone.
 */
export function createSurfaceNav(hooks, settings = {}) {
    const nav = {
        settings: { ...NAV_DEFAULTS, ...settings },
        running: false,
    };
    let axes = null;
    let at = 0;
    let last = 0;
    let frame = null;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const schedule = (fn) => (typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(fn)
        : setTimeout(() => fn(now()), 16));
    const unschedule = (id) => {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
        else clearTimeout(id);
    };

    const idle = () => !axes || !Object.values(axes).some((v) => v !== 0);

    /** One frame. Exposed so a test can step the loop without a browser. */
    nav.tick = (stamp) => {
        const t = Number.isFinite(stamp) ? stamp : now();
        const dt = Math.min(MAX_FRAME, Math.max(0, (t - last) / 1000)) || 1 / 60;
        last = t;
        // A puck that stopped talking is a puck that was let go, whatever the
        // last report said.
        if (t - at > STALE_MS) axes = null;
        if (idle()) { nav.stop(); return false; }
        const patch = cameraStep(hooks.read(), axes, nav.settings, dt);
        if (patch) hooks.write(patch);
        return true;
    };

    function run(stamp) {
        frame = null;
        if (!nav.running) return;
        if (!nav.tick(stamp)) return;
        frame = schedule(run);
    }

    nav.input = (message) => {
        if (!message) return;
        axes = message.axes;
        at = now();
        if (message.pressed) {
            // Button 1 puts the view back, button 2 swaps the projection.
            // Both act on the press rather than the release, because a rate
            // controller's buttons are held for a fraction of a second and a
            // release is where a button feels late.
            if ((message.pressed & 1) && hooks.reset) hooks.reset();
            if ((message.pressed & 2) && hooks.setProjection) {
                const camera = hooks.read();
                const held = (camera && camera.projection) || 'perspective';
                hooks.setProjection(held === 'perspective' ? 'orthographic' : 'perspective');
            }
        }
        if (idle() || nav.running) return;
        nav.running = true;
        last = now();
        frame = schedule(run);
    };

    nav.stop = () => {
        nav.running = false;
        if (frame !== null) unschedule(frame);
        frame = null;
    };

    nav.dispose = () => {
        nav.stop();
        axes = null;
    };

    return nav;
}
