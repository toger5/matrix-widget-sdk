import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { uniffiInitAsync } from "@matrix-widget-tools/widget-host-bindings";

import { AppRoot } from "./app/AppRoot";
import { AppController } from "./app/controller";
import { installTestHook } from "./app/testHook";
import { setupDriverLogging } from "./lib/hostLogging";
import "./styles/fonts";
import css from "./styles/app.css?inline";

// One stylesheet for the document (the tokens on `:root`, the page itself) and for the shadow root (the views).
const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

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
