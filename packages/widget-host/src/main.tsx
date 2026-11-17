import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { uniffiInitAsync } from "@matrix-widget-sdk/host";

import { AppRoot } from "./app/AppRoot";
import { AppController } from "./app/controller";
import { installTestHook } from "./app/testHook";
import { migrateCapabilityStore } from "./lib/capabilityStore";
import { setupDriverLogging } from "./lib/hostLogging";
import "./styles/fonts";
import css from "./styles/app.css?inline";

// One stylesheet for the document (the tokens on `:root`, the page itself) and for the shadow root (the views).
// `app.css` lists the design rules (`src/styles/<area>.css`) and the app-only rules (`src/views/**`); Vite inlines them (an adopted sheet ignores `@import`).
const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
// A changed CSS file replaces the sheet's rules in place: no reload, so the DevBackend keeps its rooms.
import.meta.hot?.accept("./styles/app.css?inline", (module) => {
  if (module) sheet.replaceSync(module.default as string);
});

/**
 * The host element. The UI is rendered into its shadow root; the widget iframes are its
 * light-DOM children and are displayed through `<slot>`s, so a widget can move on screen without
 * its iframe moving in the DOM (which would reload it).
 */
const host = document.getElementById("root")!;
const shadow = host.attachShadow({ mode: "open" });
shadow.adoptedStyleSheets = [sheet];
const mount = document.createElement("div");
mount.className = "app-mount";
shadow.append(mount);
const root = createRoot(mount);

try {
  // The driver's wasm module; nothing from the bindings works before this resolves.
  await uniffiInitAsync();
  const params = new URLSearchParams(location.search);
  setupDriverLogging(params.get("log"), params.get("logFilter"));
  migrateCapabilityStore();
  const controller = new AppController();
  installTestHook(controller);
  root.render(
    <StrictMode>
      <AppRoot controller={controller} host={host} />
    </StrictMode>,
  );
  await controller.start(params);
} catch (e) {
  console.error(e);
  root.render(<div className="app login-page danger">The widget host could not start: {String(e)}</div>);
}
