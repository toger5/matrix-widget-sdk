/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Serve .wasm files compressed from the dev and the preview server, neither of which compresses anything: with
 * brotli where the browser accepts it, else gzip. Firefox only accepts brotli over https, and unlike Chrome does
 * not make an exception for http://localhost, so it gets gzip here.
 * On localhost this does not make loading faster; it shows the transfer size a compressing web server would give.
 * The compressed copy is cached per file, so restart the server after rebuilding a wasm module.
 */
function compressWasm(): Plugin {
  const cache = new Map<string, Buffer>();
  /** `resolve` maps a request path to a file on disk. */
  const middleware =
    (resolve: (path: string) => string): Connect.NextHandleFunction =>
    (req, res, next) => {
      const [rawPath, query = ""] = (req.url ?? "").split("?");
      const path = decodeURIComponent(rawPath);
      // `?import` marks a request for the JS module Vite makes of an imported asset (for `?url`, a module
      // exporting the file's URL), not for the file.
      const isModule = query.split("&").includes("import");
      const accepted = String(req.headers["accept-encoding"] ?? "").split(",").map((e) => e.trim().split(";")[0]);
      const encoding = accepted.includes("br") ? "br" : accepted.includes("gzip") ? "gzip" : undefined;
      if (!path.endsWith(".wasm") || isModule || !encoding) return next();
      let body: Buffer | undefined;
      try {
        const file = resolve(path);
        const key = `${encoding}:${file}`;
        body = cache.get(key);
        if (!body) {
          const content = readFileSync(file);
          // Brotli quality 5 takes about a second. 11, which a production server would precompute, takes far longer.
          body =
            encoding === "br"
              ? brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
              : gzipSync(content);
          cache.set(key, body);
        }
      } catch {
        return next();
      }
      res.writeHead(200, {
        "Content-Type": "application/wasm",
        "Content-Encoding": encoding,
        Vary: "Accept-Encoding",
        "Content-Length": body.length,
      });
      res.end(body);
    };
  return {
    name: "compress-wasm",
    configureServer(server) {
      // Files outside the root (the workspace packages) are requested as /@fs/<absolute path>.
      server.middlewares.use(
        middleware((p) => (p.startsWith("/@fs/") ? p.slice("/@fs".length) : join(server.config.root, p))),
      );
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware((p) => join(server.config.root, server.config.build.outDir, p)));
    },
  };
}

export default defineConfig({
  plugins: [react(), compressWasm()],
  // @matrix-org/emojibase-bindings (in Element Web's shared components) reads this at load time; there is no `process` in a browser.
  define: { "process.env.MAX_EMOJI_VERSION": "undefined" },
  // The English strings of Element Web's shared components: the package ships them in `src/`, which its `exports` do not list.
  resolve: {
    alias: {
      "@element-hq/web-shared-components/en_EN.json": join(dirname(createRequire(import.meta.url).resolve("@element-hq/web-shared-components")), "../src/i18n/strings/en_EN.json"),
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  // Unit tests only; `e2e/` holds the Playwright tests (`npm run e2e`).
  test: { include: ["test/**/*.test.ts"] },
  // Both bindings packages load their .wasm by URL at runtime; keep them out of dependency pre-bundling.
  optimizeDeps: { exclude: ["@matrix-widget-sdk/host", "matrix-sdk-uniffi-js"] },
  build: {
    rollupOptions: {
      // `index.html` is the app; `widget_compatibility_wrapper/` the compat wrapper (`../widget-compat-wrapper`)
      // for legacy widgets.
      input: ["index.html", "widget_compatibility_wrapper/index.html"],
    },
  },
});
