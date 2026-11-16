import { parseConfig, showError, startWrapper } from "./wrapper";

try {
  if (window.parent === window) throw new Error("the compat wrapper must be embedded by a widget host");
  startWrapper(parseConfig(new URLSearchParams(location.search)), document.body);
} catch (e) {
  console.error("[widget-compat-wrapper] could not start:", e);
  showError((e as Error).message);
}
