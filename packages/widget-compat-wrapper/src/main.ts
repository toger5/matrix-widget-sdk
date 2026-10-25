import { parseConfig, startWrapper } from "./wrapper";

try {
  if (window.parent === window) throw new Error("the compat wrapper must be embedded by a widget host");
  startWrapper(parseConfig(new URLSearchParams(location.search)), document.body);
} catch (e) {
  const error = document.createElement("div");
  error.id = "error";
  error.textContent = `Widget compat wrapper: ${(e as Error).message}`;
  document.body.append(error);
}
