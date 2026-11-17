/**
 * Webview capabilities (`webview:…sandbox:<token>`, `webview:…allow:<feature>`;
 * `spec/patch/new/webview-capabilities.md`) as the strings this host keeps of them. Which are
 * granted, and the `sandbox` and `allow` of a widget's iframe, are the driver's business
 * (`WidgetHostPlatform.loadIframe`); this module only tells them apart and spells them one way.
 */
import { capabilityIsKnown } from "@matrix-widget-tools/widget-host-bindings";

/** Whether `capability` is a webview capability the driver knows (not some string that starts like one). */
export const isWebviewCapability = (capability: string): boolean => capability.startsWith("webview:") && capabilityIsKnown(capability);

/**
 * A webview capability in the spelling of the driver (`DriverSnapshot`): the namespace of its MSC draft,
 * not the stable `m` (`webview:m.allow:camera` → `webview:org.matrix.mscXXXX.allow:camera`), so that both
 * spellings compare equal as strings in this host's own lists (what is remembered, denied, revoked).
 * The driver itself compares capabilities, not strings. Any other string as it is.
 */
export const canonicalWebview = (capability: string): string => capability.replace(/^webview:m\./, "webview:org.matrix.mscXXXX.");
