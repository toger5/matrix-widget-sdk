/**
 * The webview capabilities of a widget (`webview:…sandbox:<token>`, `webview:…allow:<feature>`;
 * `spec/patch/new/webview-capabilities.md`) and the iframe attributes they make. The driver decides
 * which it grants (the base `sandbox` tokens without asking, `allow-top-navigation` never) and
 * builds the attributes (`webview_attributes`); this module only picks them out of a list.
 *
 * Every widget iframe starts strict, `sandbox="allow-scripts allow-same-origin"` and nothing in
 * `allow`; a grant applies with a reload of the iframe (`WidgetRuntime`, `widget/reload`).
 */
import { capabilityIsKnown, webviewAttributes } from "@matrix-widget-tools/widget-host-bindings";

import type { WebviewAttributes } from "../appViewModel";

/** Whether `capability` is a webview capability the driver knows (not some string that starts like one). */
export const isWebviewCapability = (capability: string): boolean => capability.startsWith("webview:") && capabilityIsKnown(capability);

/** The webview capabilities of `capabilities`, each once, in their order. */
export const webviewCapabilities = (capabilities: readonly string[]): string[] => [...new Set(capabilities.filter(isWebviewCapability))];

/** The iframe attributes of a widget holding `capabilities` (the driver's `webview_attributes`; anything else in the list is ignored). */
export function webviewFor(capabilities: readonly string[]): WebviewAttributes {
  const { sandbox, allow } = webviewAttributes(webviewCapabilities(capabilities));
  return { sandbox, allow };
}

export const sameWebview = (a: WebviewAttributes, b: WebviewAttributes): boolean => a.sandbox === b.sandbox && a.allow === b.allow;
