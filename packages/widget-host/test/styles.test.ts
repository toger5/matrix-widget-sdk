/**
 * The stylesheets. `src/styles/<area>.css` are the design rules, `src/views/**\/*.css` the app-only rules;
 * `src/styles/app.css` lists both in cascade layers, `.storybook/preview.css` adds the story-only `.storybook/mockup.css`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(pkg, path), "utf8");

interface Import {
  /** Package-relative path. */
  file: string;
  layer?: string;
}

/** The `@import`s of a manifest, in order. */
function imports(manifest: string): Import[] {
  const found = [...read(manifest).matchAll(/@import\s+(?:url\()?"([^"]+)"\)?\s*(?:layer\(([\w.-]+)\))?\s*;/g)];
  return found.map(([, target, layer]) => ({ file: relative(pkg, resolve(pkg, dirname(manifest), target)), layer }));
}

/** The files below `dir` whose name matches `pattern`, package-relative. */
function files(dir: string, pattern = /\.css$/): string[] {
  return readdirSync(join(pkg, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(pkg, path)).isDirectory()) return files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}
const cssFiles = (dir: string) => files(dir);

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const MANIFEST = "src/styles/app.css";
/** Element Web's shared components and Compound, from their packages (layer `element`). */
const PACKAGES = ["@vector-im/compound-design-tokens/", "@vector-im/compound-web/", "@element-hq/web-shared-components/"];
const fromPackage = (i: Import) => PACKAGES.some((p) => i.file.includes(p));
const all = imports(MANIFEST);
const app = all.filter((i) => !fromPackage(i));
/** The design rules: every stylesheet of src/styles apart from the manifest. */
const designFiles = cssFiles("src/styles").filter((f) => f !== MANIFEST);
const isDesign = (file: string) => file.startsWith("src/styles/");

describe("stylesheets", () => {
  it("the manifest declares the layers", () => {
    expect(read(MANIFEST).match(/^@layer [^;{]+;/m)?.[0]).toBe("@layer element, tokens, base, atoms, views;");
    // the packages in the layer element, below the host's layers
    expect(all.filter(fromPackage).map((i) => i.layer)).toEqual(["element", "element", "element"]);
  });

  it("every file is imported once, with a layer; the app-only files after the design files of their layer", () => {
    // every CSS file of src/ apart from the manifest: one that is not listed would style nothing
    expect(app.map((i) => i.file).sort()).toEqual(cssFiles("src").filter((f) => f !== MANIFEST).sort());
    expect(app.every((i) => isDesign(i.file) || i.file.startsWith("src/views/"))).toBe(true);
    for (const i of app) expect(i.layer, i.file).toBeDefined();
    // the design files in their layers: tokens, base, atoms, then the areas
    for (const name of ["tokens", "base", "atoms"]) expect(app.find((i) => i.file === `src/styles/${name}.css`)?.layer).toBe(name);
    expect(app.filter((i) => isDesign(i.file) && !["tokens", "base", "atoms"].includes(i.layer!)).every((i) => i.layer === "views")).toBe(true);
    const lastDesign = (layer: string) => app.findLastIndex((i) => i.layer === layer && isDesign(i.file));
    app.forEach((i, n) => !isDesign(i.file) && expect(n, i.file).toBeGreaterThan(lastDesign(i.layer!)));
  });

  it("the manifests hold no rules: an unlayered rule would win over every layer", () => {
    for (const manifest of [MANIFEST, ".storybook/preview.css"]) {
      const rest = withoutComments(read(manifest))
        .replace(/^@layer [^;{]+;/m, "")
        .replace(/@import\s+(?:url\()?"[^"]*"\)?[^;]*;/g, "");
      expect(rest.trim(), manifest).toBe("");
    }
  });

  it("no module imports a stylesheet of its own: it would land in the document, not in the shadow root", () => {
    // Only `src/main.tsx` (the manifest, adopted into the shadow root) and the self-hosted fonts (`@font-face` works
    // only in the document) import CSS; a view's rules are listed in `src/styles/app.css` instead.
    const allowed = new Map([
      ["src/main.tsx", ["./styles/app.css?inline"]],
      ["src/styles/fonts.ts", null],
    ]);
    for (const file of files("src", /\.tsx?$/)) {
      const found = [...read(file).matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)"([^"]+\.css(?:\?[^"]*)?)"/g)].map((m) => m[1]);
      if (!found.length) continue;
      expect(allowed.has(file), `${file} imports ${found.join(", ")}`).toBe(true);
      const only = allowed.get(file);
      if (only) expect(found, file).toEqual(only);
      else expect(found.every((f) => f.startsWith("@fontsource/")), file).toBe(true);
    }
  });

  it("Storybook loads the app's stylesheet and the story-only rules", () => {
    expect(imports(".storybook/preview.css")).toEqual([
      { file: MANIFEST, layer: undefined },
      { file: ".storybook/mockup.css", layer: "views" },
    ]);
  });

  it("only the manifests import, and theme selectors also match inside the shadow root", () => {
    for (const file of [...designFiles, ...cssFiles("src/views"), ".storybook/mockup.css"]) {
      const css = withoutComments(read(file));
      expect(css, file).not.toMatch(/@import/);
      expect(css, file).not.toMatch(/:root\[data-theme/); // `:root` is not in the shadow tree: `[data-theme=…]`
    }
  });

  it("app-only rules use tokens, no raw colors", () => {
    for (const file of cssFiles("src/views")) {
      // a mask's gradient stops are alpha values, not colors
      const css = withoutComments(read(file)).replace(/(-webkit-)?mask-image:[^;}]*/g, "");
      expect(css, file).not.toMatch(/#[0-9a-f]{3,8}\b|(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    }
  });
});
