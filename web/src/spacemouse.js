// The 6DOF puck over WebHID: the device, and nothing about what it drives.
//
// Phase 3 of `dev/plan-spacemouse.md`, the half that knows about hardware. It
// opens a 3Dconnexion device, parses its input reports into six axes in
// [-1, 1] and a button mask, and hands those to whoever subscribed. It holds
// no chart, names no camera parameter, and would drive a 2-D pan or the editor
// just as well. `charts/surface-nav.js` is the half that knows what the axes
// mean, and the two share no vocabulary on purpose.
//
// **The parsing is a pure function over a `DataView`**, which is what lets
// `node --test` hold it down against reports captured by
// `public/dev/spacemouse-probe.html` rather than against a device.
//
// Two layouts are read, because the family ships both: report 1 as three
// translations with report 2 as three rotations, or a single combined report
// carrying all six. The report's own length chooses.
//
// **The author's SpaceMouse Wireless sends the combined form** (probe run
// 2026-08-12, recorded in `dev/plan-spacemouse.md`): one collection, usage
// page 0x01 usage 0x08, input reports 1, 3 and 23; report 1 twelve bytes
// carrying all six axes at about 55 a second; report 3 the buttons, also
// twelve bytes; report 23 the battery. Travel is exactly plus or minus 350 on
// every axis, which is where `TUNING.scale` comes from rather than from the
// documentation it happens to agree with.
//
// One device, one module state. The chooser grant is per origin rather than
// per chart, only one surface is ever on screen, and a second handle on the
// same unit would mean two sets of reports and two cameras fighting.

/** 3Dconnexion, and Logitech for units old enough to carry their vendor id. */
export const VENDORS = [0x256f, 0x046d];

/** The multi axis collection, which is the one to open when a receiver
 *  exposes several. Usage page 'generic desktop', usage 'multi axis
 *  controller'. */
const MULTI_AXIS = { usagePage: 0x01, usage: 0x08 };

/**
 * Counts at full deflection, and the deadzone as a fraction of it.
 *
 * 350 is the documented travel for the `0xC62E` family and is provisional
 * until the probe says otherwise; the deadzone is what stops a puck resting
 * against its own spring from drifting the camera all afternoon.
 */
export const TUNING = { scale: 350, deadzone: 0.05 };

const AXES = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'];

const zeroAxes = () => ({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 });

let device = null;
let counts = zeroAxes();
let buttons = 0;
let tuning = { ...TUNING };
let watching = false;
const inputs = new Set();
const statuses = new Set();

/** Signed 16 bit words, little endian: every candidate layout is int16 triples. */
function words(view) {
    const out = [];
    for (let i = 0; i + 1 < view.byteLength; i += 2) out.push(view.getInt16(i, true));
    return out;
}

/**
 * One input report, as the axis counts or the button mask it carries.
 *
 * Parameters
 * ----------
 * reportId : int
 *     The report's id. WebHID delivers it separately and strips it from the
 *     data, so byte zero of `view` is the first payload byte.
 * view : DataView
 *     The report body.
 *
 * Returns
 * -------
 * object or null
 *     `{axes}` with whichever of the six the report carried, or `{buttons}`
 *     as a bitmask, or null for a report this does not recognize. A battery
 *     report is the common case for the last one, and dropping it silently is
 *     right: it is not an error, it is a report about something else.
 *
 * Notes
 * -----
 * The counts are raw here rather than normalized, because the deadzone and
 * the full scale are tuning and the parse is a fact. `normalize` applies the
 * tuning.
 */
export function parseReport(reportId, view) {
    if (!view || !view.byteLength) return null;
    const w = words(view);
    // Report 0 is the no-report-ids case, which some units enumerate as. A
    // combined packet is the only thing it can be, so it is read as one.
    if ((reportId === 1 || reportId === 0) && w.length >= 6) {
        return { axes: { tx: w[0], ty: w[1], tz: w[2], rx: w[3], ry: w[4], rz: w[5] } };
    }
    if (reportId === 1 && w.length >= 3) {
        return { axes: { tx: w[0], ty: w[1], tz: w[2] } };
    }
    if (reportId === 2 && w.length >= 3) {
        return { axes: { rx: w[0], ry: w[1], rz: w[2] } };
    }
    if (reportId === 3) {
        // Four bytes at most, and this is not tidiness. The author's unit
        // sends report 3 as **twelve** bytes, and JavaScript's bitwise
        // operators work on int32: a loop over all twelve shifts byte 4 by 32,
        // which wraps it back onto bits 0 to 7 and invents a press of button
        // 1, which is the camera reset. Thirty-two buttons is more than any of
        // these have.
        let mask = 0;
        const width = Math.min(4, view.byteLength);
        for (let i = 0; i < width; i += 1) mask |= view.getUint8(i) << (8 * i);
        return { buttons: mask >>> 0 };
    }
    // Report 23 is the battery, byte 0 a percentage, arriving every few
    // seconds. Dropped rather than surfaced: nothing here asks how full the
    // puck is, and a report about something else is not an error.
    return null;
}

/**
 * Raw counts to six axes in [-1, 1], with the deadzone taken out.
 *
 * Parameters
 * ----------
 * raw : object
 *     Counts per axis.
 * how : object
 *     `{scale, deadzone}`; the module's own tuning by default.
 *
 * Returns
 * -------
 * object
 *     The six axes, each zero inside the deadzone and reaching 1 at full
 *     deflection.
 *
 * Notes
 * -----
 * Rescaled past the deadzone rather than merely clipped, so the first
 * movement out of it is a slow one. Clipping leaves the axis jumping from
 * nothing to the deadzone width the moment it is crossed, which reads as a
 * dead control that then lurches.
 */
export function normalize(raw, how = tuning) {
    const scale = how.scale || TUNING.scale;
    const dead = Math.min(0.9, Math.max(0, how.deadzone ?? TUNING.deadzone));
    const out = zeroAxes();
    for (const axis of AXES) {
        const unit = Math.max(-1, Math.min(1, (raw[axis] || 0) / scale));
        const size = Math.abs(unit);
        out[axis] = size <= dead ? 0 : Math.sign(unit) * ((size - dead) / (1 - dead));
    }
    return out;
}

/** Whether this browser has WebHID at all. False in Firefox, Safari and iPad. */
export function isSupported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.hid);
}

/** Whether a device is open and delivering. */
export function isConnected() {
    return Boolean(device && device.opened);
}

/** The device's name, for a control that has to say what it is holding. */
export function deviceName() {
    return device ? (device.productName || 'SpaceMouse') : '';
}

/** Change the scale or the deadzone; the feel settings of phase 4 call this. */
export function setTuning(next) {
    tuning = { ...tuning, ...(next || {}) };
}

/**
 * Subscribe to input.
 *
 * The handler is called on every report that moves anything, with
 * `{axes, buttons, pressed, released}`: `axes` normalized, `buttons` the live
 * mask, and the two edge masks so a consumer can act on a press without
 * tracking the previous frame itself.
 *
 * Returns a function that unsubscribes. A consumer that forgets to call it
 * keeps a disposed chart alive, which is the whole reason it is returned
 * rather than left to a matching `off` call.
 */
export function subscribe(handler) {
    inputs.add(handler);
    return () => inputs.delete(handler);
}

/** Subscribe to connection changes, for a control that says what it is doing. */
export function watch(handler) {
    statuses.add(handler);
    return () => statuses.delete(handler);
}

function announce() {
    for (const handler of statuses) {
        try { handler({ connected: isConnected(), name: deviceName() }); } catch { /* a listener's own */ }
    }
}

function onInputReport(event) {
    const patch = parseReport(event.reportId, event.data);
    if (!patch) return;
    const before = buttons;
    if (patch.axes) counts = { ...counts, ...patch.axes };
    if (patch.buttons !== undefined) buttons = patch.buttons;
    const message = {
        axes: normalize(counts),
        buttons,
        pressed: buttons & ~before,
        released: before & ~buttons,
    };
    for (const handler of inputs) {
        try { handler(message); } catch { /* a listener's own problem */ }
    }
}

/** The multi axis collection first, then anything of ours. */
function preferred(devices) {
    const ours = devices.filter((d) => VENDORS.includes(d.vendorId));
    const axes = ours.filter((d) => (d.collections || []).some(
        (c) => c.usagePage === MULTI_AXIS.usagePage && c.usage === MULTI_AXIS.usage));
    return axes[0] || ours[0] || null;
}

/**
 * Watch for the device going away and coming back.
 *
 * A wireless puck sleeps, a receiver gets unplugged, and a laptop suspends.
 * All three arrive as `disconnect`, and the answer is the same: forget the
 * handle, say so, and let the reader reattach. Armed once, on the first open,
 * because these are page-level events and the app may never touch a surface.
 */
function watchDevice() {
    if (watching || !isSupported()) return;
    watching = true;
    navigator.hid.addEventListener('disconnect', (event) => {
        if (event.device !== device) return;
        device = null;
        counts = zeroAxes();
        buttons = 0;
        announce();
    });
    navigator.hid.addEventListener('connect', async (event) => {
        // Only what was already granted, and only when nothing is open: this
        // is the puck waking up, not a new device asking to be adopted.
        if (device || !VENDORS.includes(event.device.vendorId)) return;
        await open(event.device);
    });
}

async function open(next) {
    if (!next) return false;
    try {
        if (!next.opened) await next.open();
    } catch {
        return false;                    // in use elsewhere, or refused
    }
    device = next;
    counts = zeroAxes();
    buttons = 0;
    device.addEventListener('inputreport', onInputReport);
    watchDevice();
    announce();
    return true;
}

/**
 * Open a device the reader has already granted, silently.
 *
 * The one-time chooser grant persists per origin, so a reload should not ask
 * again. Returns false when nothing is granted, which is not an error: it is
 * the ordinary state of a reader who has never connected a puck.
 */
export async function reattach() {
    if (!isSupported() || isConnected()) return isConnected();
    try {
        return await open(preferred(await navigator.hid.getDevices()));
    } catch {
        return false;
    }
}

/**
 * Ask for a device, which shows the browser's chooser.
 *
 * Must be called from a user gesture; WebHID refuses otherwise, and that is
 * the point of the rule rather than an obstacle to it.
 */
export async function connect() {
    if (!isSupported()) return false;
    if (await reattach()) return true;
    try {
        const granted = await navigator.hid.requestDevice({
            filters: VENDORS.map((vendorId) => ({ vendorId })),
        });
        return await open(preferred(granted));
    } catch {
        return false;                    // dismissed, or refused by policy
    }
}

/** Let the device go, leaving the grant in place so reattach is silent. */
export async function disconnect() {
    const held = device;
    device = null;
    counts = zeroAxes();
    buttons = 0;
    announce();
    if (!held) return;
    held.removeEventListener('inputreport', onInputReport);
    try { await held.close(); } catch { /* already gone */ }
}
