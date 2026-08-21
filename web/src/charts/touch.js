// Touch coordinates for the WebGL pick, which `echarts-gl` reads off the wrong
// object.
//
// **This compensates for a defect in a dependency, not in this app.** The chain,
// each link read in the shipped source under `web/node_modules`:
//
//   1. `zrender/lib/core/env.js:67` sets `pointerEventsSupported` from
//      `'onpointerdown' in window && (browser.edge || (browser.ie && version >=
//      11))`, so it is false on Safari and `HandlerProxy.js:197` takes the touch
//      branch: zrender listens for `touchstart`, `touchmove` and `touchend`.
//   2. `zrender/lib/core/event.js:52` normalizes a touch event by reading
//      `changedTouches[0]` and writing `zrX` and `zrY` onto it. It writes no
//      `offsetX` or `offsetY`, and a `TouchEvent` carries neither.
//   3. `zrender/lib/Handler.js:17` sets `packet.offsetX = event.zrX`, so
//      anything reading the zrender event PACKET is fine. That is why orbit
//      rotation already works on an iPad: `OrbitControl` reads the packet.
//   4. `echarts-gl/src/core/LayerGL.js:503` does `e = e.event` first, dropping
//      from the packet to the raw event, then calls `this.pickObject(e.offsetX,
//      e.offsetY)`. On touch that is `pickObject(undefined, undefined)`, so
//      nothing is picked, `_dispatchDataEvent` never runs, and the `click`
//      handler in `mount.js` that places the cuts never fires. Lines 442, 458
//      and 492 have the same defect, which is why hover and the readout on the
//      surface are dead there too.
//
// So the raw event needs the coordinate the packet already has. Read
// `LayerGL.js` before assuming this is still needed: if a later `echarts-gl`
// reads the packet, this module is dead and should be deleted rather than kept
// as a shim nobody dares remove. Nothing here patches or wraps the dependency,
// which is the point: the fix lives in our code and leaves theirs alone.
//
// There is a second, independent limit this does NOT address.
// `HandlerProxy.js:138` synthesizes a click from touch only when `touchend`
// lands within `TOUCH_CLICK_DELAY`, 300ms, and a carefully aimed tap on an iPad
// often takes longer. See `dev/plan-idevice-ui.md` section 6 for the recognizer
// that would answer it, deliberately unbuilt until the device says it bites.

/**
 * The point of a touch relative to an element rectangle.
 *
 * Pure, and separated from the listener for exactly that reason: it is the only
 * part of this module `node --test` can reach, the web suite having no DOM.
 *
 * Parameters
 * ----------
 * rect : object
 *     Anything with `left` and `top`, so a `DOMRect` or a plain object.
 * touch : object
 *     Anything with `clientX` and `clientY`, so a `Touch` or a plain object.
 *
 * Returns
 * -------
 * dict
 *     `{x, y}` in the rectangle's own coordinates.
 */
export function touchPoint(rect, touch) {
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

/**
 * Give every touch event under `host` the `offsetX` and `offsetY` a mouse event
 * would have carried.
 *
 * Parameters
 * ----------
 * host : Element
 *     The chart's container. Not the chart instance and not zrender's viewport
 *     root, so the listeners survive the dispose and re-`init` that switching
 *     between the flat and relief readings performs.
 *
 * Returns
 * -------
 * callable
 *     Unsubscribes, matching the `register(off)` convention the control strip
 *     already uses.
 *
 * Notes
 * -----
 * **Capture phase, which is what makes this work without patching anything.**
 * zrender's own listeners sit on its viewport root, a descendant of `host`, so
 * ours runs first and the properties are already there by the time `LayerGL`
 * reads them.
 *
 * The rectangle is the **touch target's**, which is the canvas. That is what a
 * real mouse event's `offsetX` is relative to, and what `LayerGL.pickObject`
 * treats as viewport coordinates. `Touch.target` stays the element the gesture
 * started on for the whole gesture, which is the right answer for a drag as
 * well as for a tap.
 */
export function stampTouchCoordinates(host) {
    if (!host || !host.addEventListener) return () => {};
    const types = ['touchstart', 'touchmove', 'touchend'];
    const stamp = (event) => {
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        const target = (touch.target && touch.target.getBoundingClientRect)
            ? touch.target
            : host;
        const { x, y } = touchPoint(target.getBoundingClientRect(), touch);
        try {
            Object.defineProperty(event, 'offsetX', { value: x, configurable: true });
            Object.defineProperty(event, 'offsetY', { value: y, configurable: true });
        } catch {
            // A browser that refuses leaves the pick exactly as broken as it
            // was, which is the right failure: this adds a coordinate or it
            // does not, and it never takes one away.
        }
    };
    for (const type of types) host.addEventListener(type, stamp, true);
    return () => {
        for (const type of types) host.removeEventListener(type, stamp, true);
    };
}
