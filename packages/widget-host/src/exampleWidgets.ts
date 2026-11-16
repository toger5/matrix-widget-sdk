/**
 * Widget state events of the repository's test widgets (`packages/test-widgets`, port 5175 of
 * `npm run dev`). Plain data: the rooms the URL parameters describe, the prefill of the
 * DevBackendView's widget form and the tests use them.
 */
import type { StateEvent } from "./widgetStateEvent";

/**
 * Where the test widgets are served, with a trailing slash: `VITE_TEST_WIDGETS_URL` at build time
 * (the dev site sets it, see `scripts/build-dev-site.mjs`), else the dev server of `npm run dev`.
 * A path is resolved against this app's base URL, so `../widgets/` names a sibling of the app.
 */
export const TEST_WIDGETS_URL = new URL(
  import.meta.env.VITE_TEST_WIDGETS_URL || "http://localhost:5175/",
  new URL(import.meta.env.BASE_URL, globalThis.location?.origin ?? "http://localhost"),
).href;

export const EXAMPLE_NEW: StateEvent = {
  type: "m.widget",
  state_key: "widget-1",
  content: { name: "New test widget", url: `${TEST_WIDGETS_URL}new/`, uses_widget_api: true },
};

export const EXAMPLE_LEGACY: StateEvent = {
  type: "im.vector.modular.widgets",
  state_key: "widget-1",
  content: {
    type: "m.custom",
    name: "Legacy test widget",
    // Template variables are resolved by the compat wrapper, not by this host. The base url
    // variable produces a nested `https://` inside the already nested legacy url.
    url: `${TEST_WIDGETS_URL}legacy/?title=$title&widgetId=$matrix_widget_id&userId=$matrix_user_id&baseUrl=$org.matrix.msc4039.matrix_base_url&theme=$org.matrix.msc2873.client_theme`,
    waitForIframeLoad: true,
    creatorUserId: "@alice:example.org",
    data: { title: "Notes & more" },
  },
};
