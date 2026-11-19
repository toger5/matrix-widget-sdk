/**
 * `npm run widget-shots`: screenshots of the two test widgets (packages/test-widgets), each running in
 * the host on the `lab` seed with its capabilities approved. Only the widget's iframe is captured.
 * Written to `packages/test-widgets/screenshots/<name>.png`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LAB, LEGACY, LEGACY_WIDGET, NEW, NEW_WIDGET, test } from "../host";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../../test-widgets/screenshots");

const WIDGETS = [
  { name: "new", id: NEW, key: NEW_WIDGET },
  { name: "legacy", id: LEGACY, key: LEGACY_WIDGET },
];

for (const w of WIDGETS) {
  test(`screenshot of the ${w.name} test widget`, async ({ host }) => {
    await host.page.setViewportSize({ width: 1440, height: 900 });
    await host.populate("lab", { sidePanel: null, leftBarCollapsed: true, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [w.key] }] });
    await host.ready(w.id);
    // the widget logs its start (capabilities, notify_ready) after the host saw it ready
    await host.page.waitForTimeout(500);
    await host.iframe(w.id).screenshot({ path: join(OUT, `${w.name}.png`), animations: "disabled" });
  });
}
