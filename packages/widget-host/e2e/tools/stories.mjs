// Checks that the stories and everything that names them agree. Run after adding, renaming or removing a story:
//   node e2e/tools/stories.mjs
// The stories are those of the Storybook index (`storybook index`, no server needed). Reports, and exits with 1 if
// there is any:
// - a story without a row in e2e/stories.md, a row of no story, a story with more than one row;
// - a story that a test marks (`.story("<id>")` in e2e/*.spec.ts) whose row does not name that spec file, or says
//   "not reachable", "sketch" or "catalogue"; a row that says none of these of a story no test marks; a row that
//   says "sketch" of a story that is no sketch;
// - an id that is no story: in a `.story("…")` call, or any story id (`<title>--<export>` in kebab case; `*` is a
//   wildcard) in e2e/, src/ (the stories included), docs/product.md, README.md, docs/findings.md and the
//   process docs that use story ids as examples (the widget-host-ui agent, the widget-host and sketch-stories
//   skills). The target of a sketch (its id without `sketch-`) counts as known: a sketch of a new view names its
//   future story;
// - a sketch (`*.sketch.stories.tsx`, title `Sketch/…`, tag `sketch`: always all three) whose title is not
//   `Sketch/` + the title of `<View>.stories.tsx` next to it (or, without one, does not end in `<View>`);
// - a sketch whose row does not say **sketch**, or whose target exists and whose row does not say "redraw";
// - a sketch that uses the app: `useDispatch`, `useState`, `useReducer`, or an import from `src/app`.
// It only reads files (and writes the index to a temporary directory).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const read = (file) => readFileSync(file, "utf8");
const rel = (file) => relative(root, file);
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// The stories, from the index Storybook builds without a server.
const tmp = mkdtempSync(join(tmpdir(), "stories-"));
let entries;
try {
  const out = join(tmp, "index.json");
  execFileSync(join(root, "../../node_modules/.bin/storybook"), ["index", "-c", ".storybook", "-o", out], { cwd: root, stdio: "pipe" });
  entries = Object.values(JSON.parse(read(out)).entries).filter((e) => e.type === "story");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const stories = new Map(entries.map((e) => [e.id, e]));
const SKETCH = "sketch-";
const isSketch = (e) => e.importPath.endsWith(".sketch.stories.tsx");
const sketches = entries.filter(isSketch);
const targets = new Set(sketches.map((e) => e.id.slice(SKETCH.length)));
const known = (id) =>
  id.includes("*") ? entries.some((e) => new RegExp(`^${id.replaceAll("*", ".*")}$`).test(e.id)) : stories.has(id) || targets.has(id);

const problems = [];

// e2e/stories.md: one row per story.
const tablePath = join(root, "e2e/stories.md");
const table = read(tablePath);
const rows = new Map(); // story id → text of its row
for (const m of table.matchAll(/^\| `([^`]+)` \|(.*)\|\s*$/gm)) {
  const [, id, text] = m;
  if (!stories.has(id)) problems.push(`e2e/stories.md:${lineOf(table, m.index)}: "${id}" is no story`);
  else if (rows.has(id)) problems.push(`e2e/stories.md:${lineOf(table, m.index)}: "${id}" has a second row`);
  else rows.set(id, text);
}
for (const id of stories.keys()) if (!rows.has(id)) problems.push(`e2e/stories.md: story "${id}" has no row`);

// The marks: `.story("<id>")` in the spec files.
const marks = new Map(); // story id → spec files
const specs = walk(join(root, "e2e")).filter((f) => f.endsWith(".spec.ts"));
for (const file of specs) {
  const text = read(file);
  for (const m of text.matchAll(/\.story\((["'`])([^"'`]+)\1\)/g)) {
    if (!stories.has(m[2])) problems.push(`${rel(file)}:${lineOf(text, m.index)}: .story("${m[2]}"): no such story`);
    else marks.set(m[2], new Set([...(marks.get(m[2]) ?? []), basename(file)]));
  }
}
const KINDS = ["**not reachable**", "**sketch**", "**catalogue**"];
for (const [id, text] of rows) {
  const kind = KINDS.find((k) => text.includes(k));
  const marked = marks.get(id);
  if (marked) {
    if (kind) problems.push(`e2e/stories.md: "${id}" says ${kind}, but ${[...marked].join(", ")} marks it`);
    for (const spec of marked) if (!text.includes(`\`${spec}\``)) problems.push(`e2e/stories.md: the row of "${id}" does not name \`${spec}\`, which marks it`);
  } else if (!kind) {
    problems.push(`e2e/stories.md: "${id}": no test marks it (\`.story("${id}")\`); else say ${KINDS.join(", ")}`);
  }
  if (text.includes("**sketch**") && !isSketch(stories.get(id))) problems.push(`e2e/stories.md: "${id}" says **sketch** but is no sketch story`);
}

// Story ids named anywhere in the sources and docs.
const ID = /(?<![\w*-])([a-z0-9*]+(?:-[a-z0-9*]+)*--[a-z0-9*]+(?:-[a-z0-9*]+)*)(?![\w*-])/g;
const sources = [
  ...walk(join(root, "src")),
  ...walk(join(root, "e2e")),
  ...["docs/product.md", "README.md", "docs/findings.md"].map((f) => join(root, f)),
  ...["agents/widget-host-ui.md", "skills/widget-host/SKILL.md", "skills/sketch-stories/SKILL.md"].map((f) => join(root, "../../.claude", f)),
].filter((f) => /\.(ts|tsx|mjs|md)$/.test(f));
for (const file of sources) {
  const text = read(file);
  for (const m of text.matchAll(ID)) if (!known(m[1])) problems.push(`${rel(file)}:${lineOf(text, m.index)}: "${m[1]}" is no story`);
}

// Sketches.
for (const e of entries) {
  const flags = { file: isSketch(e), title: e.title.startsWith("Sketch/"), tag: e.tags.includes("sketch") };
  if (new Set(Object.values(flags)).size > 1) {
    problems.push(`${e.importPath}: "${e.id}" is a sketch by ${Object.keys(flags).filter((k) => flags[k]).join(" and ")} only (a sketch: *.sketch.stories.tsx, title "Sketch/…", tags: ["sketch"])`);
  }
}
const titleOf = (file) => /\bconst meta\b[^=]*=\s*\{[\s\S]*?\btitle:\s*"([^"]+)"/.exec(read(file))?.[1];
for (const file of new Set(sketches.map((e) => resolve(root, e.importPath)))) {
  const view = basename(file, ".sketch.stories.tsx");
  const title = titleOf(file);
  const sibling = join(dirname(file), `${view}.stories.tsx`);
  if (existsSync(sibling)) {
    if (title !== `Sketch/${titleOf(sibling)}`) problems.push(`${rel(file)}: title "${title}" is not "Sketch/" + the title of ${rel(sibling)} ("${titleOf(sibling)}")`);
  } else if (!title?.endsWith(`/${view}`)) {
    problems.push(`${rel(file)}: title "${title}" does not end in "/${view}"`);
  }
  const text = read(file);
  for (const m of text.matchAll(/\b(useDispatch|useState|useReducer)\b/g)) problems.push(`${rel(file)}:${lineOf(text, m.index)}: a sketch uses no ${m[1]}: no intents, no view state`);
  for (const m of text.matchAll(/\bfrom\s+"(\.[^"]+)"/g)) {
    if (!relative(join(root, "src/app"), resolve(dirname(file), m[1])).startsWith("..")) problems.push(`${rel(file)}:${lineOf(text, m.index)}: a sketch imports nothing from src/app ("${m[1]}")`);
  }
}
for (const e of sketches) {
  const text = rows.get(e.id);
  if (text === undefined) continue;
  if (!text.includes("**sketch**")) problems.push(`e2e/stories.md: the row of the sketch "${e.id}" does not say **sketch**`);
  const target = e.id.slice(SKETCH.length);
  if (stories.has(target) && !/\bredraw/i.test(text)) problems.push(`e2e/stories.md: the sketch "${e.id}" redraws "${target}": its row must say "redraw"`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  const markers = new Set([...marks.values()].flatMap((s) => [...s]));
  console.log(
    `ok: ${stories.size} stories (${sketches.length} sketches), each with one row in e2e/stories.md; ${marks.size} marked by tests in ${markers.size} spec files; every story id named in e2e/, src/ and the docs (.claude/ included) exists`,
  );
}
