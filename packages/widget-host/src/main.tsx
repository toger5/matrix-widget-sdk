import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { uniffiInitAsync } from "@matrix-widget-tools/widget-host-bindings";

import { App } from "./App";
import { setupDriverLogging } from "./lib/hostLogging";
import "./app.css";

const root = createRoot(document.getElementById("root")!);
try {
  // The driver's wasm module; nothing from the bindings works before this resolves.
  await uniffiInitAsync();
  const params = new URLSearchParams(location.search);
  setupDriverLogging(params.get("log"), params.get("logFilter"));
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (e) {
  console.error(e);
  root.render(<div className="centered error">The widget host could not start: {String(e)}</div>);
}
