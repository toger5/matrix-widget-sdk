/**
 * The stylesheets. `design/css/*.css` are the design rules, used by the mockups (`design/mock.css`) and the app
 * (`src/styles/app.css`) alike; `src/views/**\/*.css` are the app-only rules. Both lists must stay in step.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(pkg, path), "utf8");
const FONTS = /^https:\/\/fonts\.googleapis\.com\//;

interface Import {
  /** Package-relative path, or the URL. */
  file: string;
  layer?: string;
}

/** The `@import`s of a manifest, in order. */
function imports(manifest: string): Import[] {
  const found = [...read(manifest).matchAll(/@import\s+(?:url\()?"([^"]+)"\)?\s*(?:layer\(([\w.-]+)\))?\s*;/g)];
  return found.map(([, target, layer]) => ({
    file: /^https?:/.test(target) ? target : relative(pkg, resolve(pkg, dirname(manifest), target)),
    layer,
  }));
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

const layerStatement = (manifest: string) => read(manifest).match(/^@layer [^;{]+;/m)?.[0];
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const mock = imports("design/mock.css");
const app = imports("src/styles/app.css");

describe("stylesheets", () => {
  it("both manifests declare the same layers", () => {
    expect(layerStatement("design/mock.css")).toBe("@layer tokens, base, atoms, views;");
    expect(layerStatement("src/styles/app.css")).toBe(layerStatement("design/mock.css"));
  });

  it("the app imports the design files of the mockups in the same order and layers", () => {
    const designOfMock = mock.filter((i) => !FONTS.test(i.file) && i.file !== "design/css/mockup.css");
    expect(app.filter((i) => i.file.startsWith("design/"))).toEqual(designOfMock);
  });

  it("every file is imported once, with a layer", () => {
    // every CSS file of design/ and src/ apart from the manifests: one that is not listed would style nothing
    const designFiles = cssFiles("design").filter((f) => f !== "design/mock.css");
    const srcFiles = cssFiles("src").filter((f) => f !== "src/styles/app.css");
    expect(mock.filter((i) => !FONTS.test(i.file)).map((i) => i.file).sort()).toEqual(designFiles.sort());
    expect(app.filter((i) => i.file.startsWith("src/")).map((i) => i.file).sort()).toEqual(srcFiles.sort());
    expect(app.every((i) => i.file.startsWith("design/css/") || i.file.startsWith("src/views/"))).toBe(true);
    for (const i of [...mock.filter((i) => !FONTS.test(i.file)), ...app]) expect(i.layer, i.file).toBeDefined();
    // the app-only files come after the design files of their layer
    const lastDesign = (layer: string) => app.findLastIndex((i) => i.layer === layer && i.file.startsWith("design/"));
    app.forEach((i, n) => i.file.startsWith("src/") && expect(n, i.file).toBeGreaterThan(lastDesign(i.layer!)));
  });

  it("the manifests hold no rules: an unlayered rule would win over every layer", () => {
    for (const manifest of ["design/mock.css", "src/styles/app.css", ".storybook/preview.css"]) {
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

  it("Storybook loads the app's stylesheet and the mockup-only rules", () => {
    expect(imports(".storybook/preview.css")).toEqual([
      { file: "src/styles/app.css", layer: undefined },
      { file: "design/css/mockup.css", layer: "views" },
    ]);
  });

  it("only the manifests import, and theme selectors also match inside the shadow root", () => {
    for (const file of [...cssFiles("design/css"), ...cssFiles("src/views")]) {
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
