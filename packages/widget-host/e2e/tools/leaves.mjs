// Checks that the design leaves and everything that names them agree. Run after adding, renaming or removing a leaf:
//   node e2e/tools/leaves.mjs
// Reports, and exits with 1 if there is any:
// - a leaf of design/src/leaves.mjs without a row in e2e/leaves.md,
// - a leaf id in e2e/leaves.md, in a `host.leaf("…")` call, or after the word "leaf"/"leaves" in a comment or doc
//   (src/, e2e/, implementation_findings.md) that is no leaf; `*` is a wildcard (`devtools/*`),
// - a page in design/leaves/ that is no leaf any more (the design build does not delete pages).
// It only reads files.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { LEAVES } = await import(pathToFileURL(join(root, "design/src/leaves.mjs")).href);
const leaves = new Set(LEAVES.map((l) => l.id));

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const read = (file) => readFileSync(file, "utf8");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const known = (id) => (id.includes("*") ? LEAVES.some((l) => new RegExp(`^${id.replaceAll("*", ".*")}$`).test(l.id)) : leaves.has(id));

const problems = [];
/** Every id in `ids` (with its position in `text`) that is no leaf is a problem of `file`. */
function check(file, text, ids) {
  for (const { id, index } of ids) if (!known(id)) problems.push(`${relative(root, file)}:${lineOf(text, index)}: "${id}" is no leaf`);
}

// e2e/leaves.md: every leaf has a row, every id in it is a leaf.
const tablePath = join(root, "e2e/leaves.md");
const table = read(tablePath);
const tableIds = [...table.matchAll(/`([a-z0-9-]+\/[a-z0-9*-]+)`/g)].map((m) => ({ id: m[1], index: m.index }));
check(tablePath, table, tableIds);
for (const id of leaves) if (!tableIds.some((t) => t.id === id)) problems.push(`e2e/leaves.md: leaf "${id}" has no row`);

// host.leaf("…") calls and "leaf <id>" / "Leaves: <id>, <id>" mentions.
const ID = /[a-z0-9-]+\/[a-z0-9*-]+/g;
const MENTION = /\b(?:[Ll]eaf|[Ll]eaves):?\s+((?:`?[a-z0-9-]+\/[a-z0-9*-]+`?(?:\s*,\s*|\s+and\s+)?)+)/g;
const sources = [...walk(join(root, "src")), ...walk(join(root, "e2e")), join(root, "implementation_findings.md")].filter(
  (f) => /\.(ts|tsx|mjs|md)$/.test(f) && f !== tablePath,
);
for (const file of sources) {
  const text = read(file);
  const ids = [...text.matchAll(/\bleaf\((["'`])([a-z0-9-]+\/[a-z0-9*-]+)\1\)/g)].map((m) => ({ id: m[2], index: m.index }));
  for (const m of text.matchAll(MENTION)) for (const i of m[1].matchAll(ID)) ids.push({ id: i[0], index: m.index });
  check(file, text, ids);
}

// Pages of leaves that no longer exist.
for (const file of walk(join(root, "design/leaves")).filter((f) => f.endsWith(".html"))) {
  const id = relative(join(root, "design/leaves"), file).replace(/\.html$/, "");
  if (!leaves.has(id)) problems.push(`design/leaves/${id}.html: no such leaf; delete it: rm ${file}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`ok: ${leaves.size} leaves, all in e2e/leaves.md; every leaf id named in e2e/, src/ and implementation_findings.md exists`);
}
