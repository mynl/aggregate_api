/* global document, fetch, Office */

/**
 * The task pane: an About page for the AGG functions.
 *
 * The shared runtime loads this page so the custom functions have Office.js;
 * the page itself only explains them. The editor pane is `[excel-pane]`, later.
 *
 * It reads /v1/meta itself rather than importing ../functions/functions:
 * webpack bundles each entry separately, so an import here would run a second
 * copy of that module, with its own memo and request limit, in the same runtime.
 */

declare const __API_BASE__: string;

Office.onReady(async () => {
  const line = document.getElementById("server");
  if (!line) return;
  try {
    const meta = await (await fetch(`${__API_BASE__}/v1/meta`)).json();
    line.textContent = `Server: aggregate_api ${meta.version}, aggregate ${meta.aggregate_version}`;
  } catch {
    line.textContent = "Server: unreachable";
  }
});
