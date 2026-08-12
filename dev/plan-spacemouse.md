# Plan [SpaceMouse-Surface]: a 6DOF puck for the joint surface, in the app and out of it

> **Status: executed a86 to a89, 2026-08-12.** All four phases have landed.
> What is open is what needs the hardware: the phase 2 findings block, and
> acceptance items 1 and 2. The plan stays in `dev/` until those are written
> in, then moves to `dev/done/`.
>
> **Original status, ready for execution, 2026-08-12.** Author has decided the
> WebHID route and asked for the mesh export folded in. App repo only: no LIB work,
> no server work, no wire change, so no symlink into `aggregate_REFACTOR`.
> Layers on the `plan-3d-plot.md` surface (modules landed a73 to a76) and must
> not disturb it: no echarts-gl version change, no change to the iPad path,
> everything feature-detected and greyed elsewhere per the house rule.

## Device facts (measured 2026-08-12, on the author's machine)

- **3Dconnexion SpaceMouse Wireless via its USB receiver**: `HID\VID_256F&PID_C62E`,
  enumerated as a HID multi-axis controller. Two physical buttons.
- **3DxWare is installed and its service is live**: the `3Dconnexion KMJ
  Emulator` virtual device is present, and the settings dump
  (`C:/tmp/dm.3dxz`, read during planning) was written by `3DxService.exe`
  version 17.9.14.3006 (3DxWare 10.9.14.745) with an update check dated today.
- **The settings are factory defaults.** The dump contains only `Global.xml`,
  `UserInfo.xml` and a version stamp: no per-application profiles, no custom
  button or axis mappings. Nothing to migrate; the driver has never been
  configured.

**Driver stance: keep 3DxWare installed.** Their bundled viewer is the payoff
of the export phase and needs the driver; uninstalling would kill that route.
The known risk of coexistence is double action: raw HID reports flow to WebHID
regardless (Windows HIDClass duplicates input reports to every open handle),
but the driver may *also* interpret the motion through the KMJ emulator (its
fallback in unsupported applications is scrolling and zooming the page). If
the probe observes that, the fix is one-time and recorded in this plan when
found: add Chrome to 3DxWare's application list with all mappings disabled, or
stop `3DxService` for the session. Uninstalling is the last resort, not the
recommendation.

Expected report layout for the `0xC62E` family, to be **verified, not
assumed**, in phase 2: report ID 1 carries `TX, TY, TZ` as three little-endian
int16, report ID 2 carries `RX, RY, RZ`, report ID 3 carries the button
bitmask; full deflection is roughly plus or minus 350. Some firmware sends a
single 12-byte combined report under ID 1 instead. `requestDevice` may also
surface more than one `HIDDevice` for the unit (the receiver exposes extra
collections); the one to open is the multi-axis collection, usage page `0x01`
usage `0x08`.

## What the reader gets

1. **Download buttons on the surface leaf**: `.stl` and `.obj` of the drawn
   surface, loadable in 3Dconnexion's viewer (native, fully tuned 6DOF
   navigation with zero integration code), Windows 3D Viewer, Blender, or a
   slicer. This lands first: it is independent of everything else, it is an
   afternoon of work, and it auditions how the loss surface feels under the
   puck before the in-app tuning starts.
2. **A SpaceMouse connect control on the surface leaf**: once granted, the
   puck orbits, zooms and pans the live echarts-gl chart, composing with
   mouse drag rather than fighting it, with feel settings that stick.

## The echarts-gl camera contract (read before writing the integrator)

`web/src/charts/surface.js` already documents the trap this plan must respect
(`readCamera`, `surface.js:77-114`): echarts-gl writes the live camera back
into the option's `viewControl` object as the reader drags, so re-sending a
stored camera sixty times a second fights the reader and wins. The integrator
therefore works read-modify-write **only while deflected**: each animation
frame, read the live `viewControl` (the `readCamera` reach, cheap, no
`getOption` clone), add this tick's deltas, and `setOption` a partial
`{grid3D: {viewControl: {...}}}`. When every axis is inside the deadzone the
loop goes fully idle and sends nothing, so mouse interaction is untouched and
the existing damping feel is preserved. Interleaved mouse drags are picked up
automatically because each tick starts from the live camera.

Defaults to return to on reset (from `surfaceOverrides`, `surface.js:230-241`):
`alpha 24, beta 40, distance 190`, center at the origin. Note `readCamera`
currently preserves `alpha, beta, distance` only; this plan extends the
read and the redraw path to carry `center` too, so a panned camera survives a
control-driven rebuild the same way an orbited one already does.

The device is a **rate controller**: deflection is velocity, not position.
The mapping, all signs and assignments in one table in the module because
conventions never survive contact with the hardware (phase 2 verifies):

| puck axis | camera parameter |
|---|---|
| twist the cap (RZ) | `beta`, azimuth |
| tilt toward or away (RX) | `alpha`, elevation |
| slide toward or away (TY) | `distance`, zoom |
| slide left or right (TX) | `center` pan, camera-relative horizontal |
| lift or press (TZ) | `center` pan, camera-relative vertical |
| roll left or right (RY) | unmapped: an orbit camera has no roll |
| button 1 | reset camera to the chart's initial view |
| button 2 | toggle `projection` perspective and orthographic |

Camera-relative pan derives its basis from the live `alpha` and `beta` so the
surface follows the hand in screen space rather than sliding along data axes.

## Phases

Each phase is one `[aNN]` version bump with a one-line commit and its
CHANGELOG section, per house rules. Phase 1 is independent of the rest and
deliberately first.

### Phase 1 `[Surface-Mesh-Export]` **landed a86**

`web/src/charts/mesh-export.js`, pure functions, no dependencies. Input: the
same display-space grid arrays the renderer already builds (the
`surface-geometry.js` output that feeds echarts-gl), which is the decision
that matters here: the export bakes in the display normalization and the
current z aspect, so the mesh is the box the reader sees, not a pancake in
raw units (losses in the thousands against densities near zero). A height
field triangulates as two triangles per grid cell; masked or NaN cells are
skipped, leaving holes rather than inventing geometry; winding is consistent
with normals up.

Two writers:

- **Binary STL**: 80-byte header naming the object and generator, uint32
  triangle count, fifty bytes per triangle. Geometry only, and the format a
  slicer wants.
- **OBJ**: plain text vertices and faces. Geometry only in phase 1; the
  viridis coloring is the stretch below.

UI: two buttons on the surface leaf's existing controls row (the draw-style
row), `Download .stl` and `Download .obj`, greyed with a why when no surface
is drawn, per the never-hide rule. Blob download, filename
`<object name>-surface.stl` / `.obj`. No wire change, no server change,
consistent with the purist ruling: this is a rendering of the served
document, exactly as the ECharts drawing is.

Tests (`node --test`, beside `test/surface-geometry.test.js`): a golden 3 by 3
grid asserting vertex and triangle counts, STL byte length `84 + 50n`, OBJ
face indices in range and 1-based, a masked cell dropping exactly two
triangles, and normals pointing up on a flat grid.

**Stretch, author gate, not in this phase**: color. Either OBJ plus MTL with
a small viridis strip texture and height-mapped UVs (portable), or a
hand-written GLB with vertex colors (self-contained, ~150 lines). Decide
after seeing the monochrome mesh in the 3Dconnexion viewer; record the
verdict here.

**Verdict, author, 2026-08-12: GLB with vertex colors, and the shell stays.**
The OBJ opened in the viewer and read as "just the surface element". Offered a
solid (a skirt to a base plane and a bottom cap), a solid with color, color
alone, or leaving it, the author took **color alone**: the file is a rendering
of a height field, not a model of a block, and a slicer's complaint about an
open shell is the slicer's business. Landed a91.

Why GLB rather than OBJ with an MTL: one file. A material file is a second
download that has to land in the same folder under the name the OBJ writes,
and a texture would be a third, so a reader who saves one of three gets an
untextured mesh and no explanation. STL carries no color at all, so `.obj` and
`.stl` stay geometry and the colored reading is its own format. Colors are
written linear, as glTF requires, against the visualMap's own `[zMin, zMax]`
rather than the drawn box, which reaches lower.

**Execution notes, a86.** As planned, with four things worth recording.

1. The heights come from a named array in `surfaceOption`
   (`chartdoc-to-echarts.js`) rather than from `surface-geometry.js`: the
   drawn height is `height(density)`, which that module never computes,
   because the log reading and the log floor are the option builder's. The
   plan's "display-space grid arrays the renderer already builds" is that
   array, now taken once and read twice.
2. The z range written is the **snapped axis box** (`niceBox(zBase, zMax)`),
   not the data extent, so the base drop and the round-numbered lid come
   with the file and the relief stands at the height it stands at on screen.
   The x and y extents are the data's: echarts widens a value axis to round
   numbers and matching that would mean reading the live axis model for a
   difference no viewer shows.
3. The box dimensions are read back off the merged option's `grid3D`, so the
   proportions are not a second constant that can drift from
   `surfaceOverrides`.
4. The buttons are greyed until the first surface is drawn, which needed one
   new thing: the strip is built before the first render, so `syncTools`
   rebuilds it the first time "is there a surface to save" changes. Every
   other control reads the document, which is in hand before anything is
   drawn.

Measured on the `bvagg` fixture (94 by 117): 21,576 triangles, 10,998
vertices, a 1.08 MB STL and a 652 kB OBJ. **Open question for the author,
after the viewer**: whether a 21k triangle mesh is the right density or
whether the export should offer the coarser grid the floor image uses.

### Phase 2 `[SpaceMouse-Probe]` **page landed a87, findings recorded a90**

A standalone probe page, `web/public/dev/spacemouse-probe.html`, self
contained (inline script, no bundle imports), served by `npm run dev` or the
built app: a connect button (`navigator.hid.requestDevice` with filters for
vendor `0x256F`, and `0x046D` for older units), a live hex dump of every
input report with its report ID, decoded int16 readings per candidate layout,
and live axis bars. It stays in the tree afterward as the tuning and
regression tool; it is inert without a user gesture and invisible from the
app's navigation.

Deliverables, **recorded back into this plan as a findings block**:

1. The exact report IDs, layout and axis ranges of this unit.
2. Which `HIDDevice` entry among those the receiver exposes is the multi-axis
   collection.
3. Behavior with `3DxService` running versus stopped: whether reports flow to
   WebHID in both states (expected yes) and whether the KMJ emulator causes
   double action in Chrome (if yes, the one-time 3DxWare configuration that
   silences it, applied and written down).
4. Wireless behavior: sleep and wake timing, whether `disconnect` and
   `connect` events fire around sleep, behavior when the receiver is
   unplugged and replugged.
5. A feel note: sensible starting gains per axis at the observed ranges.

**The page is at `/dev/spacemouse-probe.html`**, under `npm run dev` and in
the built app alike (Vite copies `public/` verbatim, and the service worker
takes navigations network first, so it never serves a stale copy). It is not
linked from anywhere.

#### Findings, from the author's unit, 2026-08-12

Run by the author on the SpaceMouse Wireless, `256f:c62e`, with 3DxWare
installed and its service live. Answered at a90, which fixed the two things
they turned up.

1. **Report IDs, lengths and layout.** Three input reports, all twelve bytes:

   | id | bytes | rate | what |
   |---|---|---|---|
   | 1 | 12 | ~55 a second | all six axes, int16 little endian, `TX TY TZ RX RY RZ` |
   | 3 | 12 | on change | the button mask, in byte 0 |
   | 23 | 12 | every few seconds | the battery, byte 0 a percentage |

   So this unit sends the **combined** form, and report 2 never appears. The
   parser chose it correctly by length with no change. Travel is exactly plus
   or minus 350 on every axis, which confirms `TUNING.scale`. Buttons read
   `0x3`: bit 0 the left, bit 1 the right, which is the mapping phase 3
   assumed.

   **Bug this found.** Report 3 being twelve bytes broke the mask loop: a
   shift per byte puts byte 4 at 32 bits, JavaScript's bitwise operators are
   int32, and it wraps onto bits 0 to 7. A stray byte there would have read
   as button 1, which is the camera reset, firing itself in the reader's
   hands. Capped at four bytes and read unsigned at a90, with a test.

2. **The device entry.** One `HIDDevice` and one collection, usage page
   `0x01` usage `0x08`, the multi axis controller. The receiver exposes no
   extra collections on this unit, so `preferred()` has nothing to choose
   between and picks the right thing either way.

3. **3DxWare coexistence: no double action.** With `3DxService` running, the
   raw reports reach WebHID and the KMJ emulator does not also scroll or zoom
   the page. Nothing to configure, and the driver stays installed, which is
   what the export phase wanted.

4. **Sleep, wake and replug**: not yet observed. Nothing hangs on it: the
   `connect` and `disconnect` handlers are armed whether or not a device is
   open, and a disconnect forgets the handle and repaints the control.
   Worth a note here when it is seen.

5. **Gains.** Untouched. The observed range is exactly the one the defaults
   were written against, so `orbit 90`, `elevate 55`, `zoom 0.9`, `pan 0.7`
   stand until the author says otherwise, and the feel panel moves them.

**Direction, corrected at a90.** The author's rule is that the picture follows
the hand: press the cap down and the surface goes down with it. The puck
reports a press as **positive** TZ, so the vertical pan needs the opposite
sign from the horizontal, which a88 did not have and which showed up as the
image running away upward from a downward press. The horizontal was already
right. The zoom and twist directions are unconfirmed; both are one reverse
flag away in the feel panel if they turn out backwards.

### Phase 3 `[SpaceMouse-WebHID]` **landed a88**

Two modules, device and camera kept apart so neither knows the other's
vocabulary:

- **`web/src/spacemouse.js`**, the device layer, no chart knowledge. Feature
  detection (`navigator.hid` present); silent reattach on load via
  `getDevices()` so the one-time chooser grant persists across reloads;
  connect flow behind a user gesture; `connect` / `disconnect` handlers for
  sleep, wake and receiver replug; report parsing per the probe's findings
  into a normalized state: six axes in [-1, 1] after deadzone, plus button
  edge events. Exposes subscribe and unsubscribe, current state, and a
  connected flag. Parsing is a pure function over `DataView`, unit tested
  with synthetic reports captured by the probe.
- **`web/src/charts/surface-nav.js`**, the integrator, beside `surface.js`.
  Owns the mapping table above, the per-axis gains, the rAF loop with the
  read-modify-write contract from the camera section, reset and projection
  buttons, and the enable and disable lifecycle: it attaches to the live
  chart instance when the surface leaf activates and detaches on
  `disposePaneChart`, chart rebuild, or leaf switch, never holding a disposed
  instance.

UI: a `SpaceMouse` control on the surface controls row. Greyed with a why
when `navigator.hid` is absent (Firefox, Safari, iPad) or no device is
granted; a click runs the chooser; connected state shows plainly. The iPad
acceptance path from `plan-3d-plot.md` is untouched by construction, since
the control renders greyed and no gl behavior changes.

Tests: parser and integrator math (deadzone, expo, camera-relative pan basis)
as pure-function node tests; the browser loop is exercised through the probe
page and manual acceptance.

**Execution notes, a88.** As planned. Six things worth recording.

1. **The write path is `setOption`, not the control.** `Grid3DView.render`
   calls `control.setFromViewControlModel`, so a partial
   `{grid3D: {viewControl}}` merge does move the camera, and with the
   option's `animation: false` it sets rather than eases. The lighter path
   (reaching the view's private `_control` and calling `setAlpha` and
   friends, which is what a mouse drag does) is deliberately not taken: it
   is two underscores deep in a third party. If the rebuild cost per frame
   ever shows, that is the fallback, and it is the only thing that would
   change.
2. **`grid3DChangeCamera` is not the way in.** The action exists and looks
   like the answer, but its handler only writes the model option
   (`componentModel.setView`) and its `update: 'series:updateCamera'` reaches
   series views rather than the control. It is how echarts-gl syncs the
   option *after* a drag, not how anything drives the camera.
3. **The pan basis is derived rather than read.** `OrbitControl` builds the
   camera rotation as `rotateY(-phi).rotateX(-theta)` with `theta = alpha`
   and `phi = -beta` in radians, so screen right is `(cos b, 0, -sin b)` and
   screen up is `(-sin a sin b, cos a, -sin a cos b)`. That keeps
   `surface-nav.js` free of echarts, and it agrees with the mouse pan by
   construction, which moves `center` along those same two columns scaled by
   distance.
4. **Zoom is multiplicative** (e-folds a second), clamped to echarts-gl's own
   `minDistance` 40 and `maxDistance` 400. Additive zoom crawls when far out
   and slams into the surface when close in, and writing past the clamps
   reads as a zoom that sticks.
5. **Silence is a release.** No report for 300 ms zeroes the axes. The
   release report is the one that must not be lost.
6. **`readCamera` gained `center` and `projection`**, and returns only the
   keys it actually has: the result is spread over the preset's
   `viewControl`, where a key present with an undefined value overwrites a
   default rather than letting it stand.

Signs are provisional until the phase 2 findings land: `ty` positive zooms
in, `rz` positive orbits right, `rx` positive raises the camera, and a slide
moves the target against the hand so the surface follows it. Each is one
`invert` flag away from its opposite, and phase 4 puts those flags in the UI.

### Phase 4 `[SpaceMouse-Feel]` **landed a89**

The difference between working and wanting to use it:

- Per-axis gain, invert flags, deadzone width, and an expo curve (cubic
  blend) so small deflections are precise and full deflection is fast.
- A dominant-axis option (suppress all but the largest deflection) for
  readers who find 6DOF soupy; off by default.
- Sticky preferences under `aggapi.spacemouse` in localStorage, the existing
  try-catch pattern for private mode.
- A small settings affordance on the surface controls row (a popover or
  details row) with the gains, inverts, deadzone, dominant-axis toggle, and a
  reset-to-defaults.
- A debug overlay (toggle in the settings affordance): live axis bars and the
  current camera numbers, which is the tuning loop made visible. Off by
  default.

**Execution notes, a89.** As planned, with three decisions worth recording.

1. **A row under the strip, not a popover.** Nothing floats over the chart,
   nothing is positioned against a button, and the panel is as tall as it
   needs to be. `flex-basis: 100%` inside the wrapping strip is the whole
   mechanism.
2. **The readout lives in the panel** rather than over the canvas. It is
   there to justify the sliders above it, and the canvas is the thing being
   tuned: numbers about a picture, drawn on that picture, is the wrong trade.
3. **The deadzone stays in the device layer**, where the axes are normalized,
   and the panel calls `setTuning`. Everything else is `nav.settings`, read
   every tick, so a slider moved with the cap held takes effect on the next
   frame. Roll gets no reverse flag: it drives nothing, and a control over
   nothing is worse than no control.

## Acceptance

1. **Out of app**: an exported `.obj` and `.stl` of a `BivariateAggregate`
   surface load in the 3Dconnexion viewer and in Windows 3D Viewer, at a
   sensible aspect, and navigate under the puck natively. The STL slices in a
   slicer without manifold complaints.
2. **In app, Chrome**: grant once, reload, and the device reattaches without
   a chooser. The puck orbits, zooms and pans the live surface at interactive
   rate; mouse drag continues to work between and during sessions; releasing
   the cap stops the camera dead (no drift); unplugging the receiver mid
   session degrades silently and replug reattaches.
3. **Everywhere else**: Firefox, Safari and the iPad show the greyed control
   with a why, and nothing else changes. `npm run build` output size moves
   only by the new modules; the echarts-gl pin is untouched.
4. **Tests**: the node suite passes with the new parser, integrator and
   writer tests; `check-nav.mjs` untouched (no new leaves, the controls ride
   the existing surface leaf).

### Where acceptance stands, 2026-08-12 (a89)

**Item 4, met.** 52 node tests pass, 19 of them new across the writers, the
parser and the integrator. `check-nav.mjs` untouched: no leaf moved.

**Item 3, met except in other browsers.** The bundle moved 151.8 kB to
163.2 kB, which is the four new modules and nothing else; the `echarts-gl`
chunk is byte for byte the same and the pin was not touched. The greyed path
is written and reads its state from `navigator.hid`, but it has only been seen
in a browser that has WebHID, so the Firefox, Safari and iPad reading is
unconfirmed.

**Item 1, met for the OBJ, and it produced the color ruling.** All three
writers were exercised in the running app on `CopulaWindFlood`: a 1.4 MB STL
of 28,000 triangles at exactly `84 + 50n` bytes, an 817 kB OBJ recording the
box and the drawn height axis, and (a91) a 679 kB GLB that parses end to end
with its viridis spanning the ramp. The author opened the OBJ in
3Dconnexion's viewer: it loads, and it is bare, which is what settled the
stretch above. The GLB in that viewer, and a slicer's opinion of the STL, are
still unread. Expect the slicer to note an open shell: a height field is not
a solid, deliberately and now by ruling.

**Item 2, open, and it is the one that needs the hardware.** Nothing in the
device path has met a device. The probe page is the first thing to run, and
its findings block above is where its answers go.

**Also observed, not reproduced**: one zrender exception
(`eachBuiltinLayer`, reading `'0'` of null) during a first draw in a session
where a second build was fired at a chart mid render. It is inside the 2-D
instance, on the path where the relief falls back to the flat reading until
the gl chunk lands, which predates this plan. A clean load, build and draw
produced an empty console, so it is recorded here rather than chased, and it
earns a punchlist entry only if it recurs on a path a reader can take.

## Out of scope, recorded so they are choices rather than gaps

- The 3DxWare SDK and navlib route (their local WebSocket server driving our
  camera): heavy integration, needs their driver protocol, and echarts-gl
  exposes no full camera matrix API to hand it. The WebHID route replaces it.
- Roll: an orbit camera cannot represent it; RY stays unmapped until some
  future control wants it.
- Driving 2D charts (dataZoom panning) and the DecL editor: fun, later, a
  one-line subscribe if ever wanted.
- Multi-device support and the Universal Receiver's multi-instrument mode:
  this plan targets the author's `0xC62E` unit; the vendor filter admits
  other 3Dconnexion products but their layouts are verified only when one
  exists to test.
- GLB and colored export: the stretch note in phase 1, author gated.

## Cadence

Four phases, four `[aNN]` bumps, one-line commits, CHANGELOG sections as the
real descriptions, `dev/TODO.md` ticked as phases land. Probe findings are
written into this plan at phase 2, and the plan moves to `dev/done/` when
phase 4 lands.

**As executed**: a86 the mesh export, a87 the probe page, a88 the device layer
and the integrator, a89 the feel. The move to `dev/done/` waits on the findings
block, which is the one deliverable a machine without the puck cannot write.
