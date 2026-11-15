// Renders the mockups: one static HTML page per leaf in ./leaves, and ./index.html, the gallery
// that includes all of them at their real size. Run: node design/build.mjs
//
// The pages are plain HTML + mock.css, without scripts (except the two lines that pick the theme),
// so they can be opened from the file system and inspected with the browser devtools.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { esc } from "./src/lib.mjs";
import { LEAVES, SECTIONS } from "./src/leaves.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const ids = new Set();
for (const leaf of LEAVES) {
  if (ids.has(leaf.id)) throw new Error(`duplicate leaf id: ${leaf.id}`);
  ids.add(leaf.id);
  if (!SECTIONS.some(([name]) => name === leaf.section)) throw new Error(`unknown section: ${leaf.section}`);
}

function leafPage(leaf) {
  const up = "../".repeat(leaf.id.split("/").length);
  return `<!doctype html>
<html lang="en" data-theme="${leaf.theme ?? "dark"}">
<head>
<meta charset="utf-8">
<title>${esc(leaf.title)} · Widget host mockup</title>
<meta name="viewport" content="width=${leaf.w}">
<link rel="stylesheet" href="${up}mock.css">
<script>
  // The gallery picks the theme through the URL hash (#theme=light). A leaf with a fixed theme ignores it.
  (function () { var fixed = ${JSON.stringify(leaf.theme ?? "")}; function apply() { document.documentElement.dataset.theme = fixed || (location.hash.match(/theme=(light|dark)/) || [])[1] || "dark"; } apply(); addEventListener("hashchange", apply); })();
</script>
</head>
<body style="width:${leaf.w}px;height:${leaf.h}px">
${leaf.html}
</body>
</html>
`;
}

for (const leaf of LEAVES) {
  const file = join(root, "leaves", `${leaf.id}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, leafPage(leaf));
}

// ---- gallery ---------------------------------------------------------------------------------

const figure = (leaf) => `<figure class="leaf" id="${slug(leaf.id)}">
  <figcaption><b>${esc(leaf.title)}</b><span class="meta">${leaf.w} × ${leaf.h}${leaf.theme ? ` · always ${leaf.theme}` : ""}</span><a href="leaves/${leaf.id}.html" target="_blank" rel="noopener">open ↗</a>${leaf.note ? `<p>${esc(leaf.note)}</p>` : ""}</figcaption>
  <div class="frame" data-w="${leaf.w}" data-h="${leaf.h}"><iframe loading="lazy" title="${esc(leaf.title)}" data-leaf="leaves/${leaf.id}.html" ${leaf.theme ? "data-fixed" : ""} src="leaves/${leaf.id}.html#theme=${leaf.theme ?? "dark"}" width="${leaf.w}" height="${leaf.h}"></iframe></div>
</figure>`;

let nav = "";
let main = "";
for (const [section, intro] of SECTIONS) {
  const leaves = LEAVES.filter((l) => l.section === section);
  const groups = [...new Set(leaves.map((l) => l.group))];
  nav += `<a class="n1" href="#${slug(section)}">${esc(section)} <i>${leaves.length}</i></a>`;
  main += `<section id="${slug(section)}"><h2>${esc(section)}</h2><p class="intro">${esc(intro)}</p>`;
  for (const group of groups) {
    const gid = slug(`${section}-${group}`);
    if (group) {
      const depth = group.split(" › ").length;
      nav += `<a class="n${Math.min(depth + 1, 4)}" href="#${gid}">${esc(group.split(" › ").at(-1))}</a>`;
      main += `<h3 id="${gid}">${esc(group)}</h3>`;
    }
    main += `<div class="leaves">${leaves.filter((l) => l.group === group).map(figure).join("\n")}</div>`;
  }
  main += `</section>`;
}

const index = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<title>Widget host mockups</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg: #050506; --panel: #101012; --line: #2a2a2f; --text: #ededf0; --muted: #a3a3ad; --accent: #6fdc8c; }
  :root[data-theme="light"] { --bg: #f6f6f3; --panel: #ffffff; --line: #d9d9d4; --text: #17171a; --muted: #55555c; --accent: #18794e; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 72px; }
  body { margin: 0; font: 14px/1.5 Inter, system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); }
  header.top { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 16px; height: 56px; padding: 0 24px; background: var(--panel); border-bottom: 1px solid var(--line); }
  header.top h1 { font-size: 16px; margin: 0; }
  header.top span { color: var(--muted); font-size: 13px; }
  .grow { flex: 1; }
  .switch { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: 9px; }
  .switch button { font: inherit; font-size: 13px; color: var(--muted); background: none; border: 0; padding: 4px 12px; border-radius: 7px; cursor: pointer; }
  .switch button[aria-pressed="true"] { background: var(--line); color: var(--text); font-weight: 600; }
  .layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); }
  nav { position: sticky; top: 56px; align-self: start; height: calc(100vh - 56px); overflow: auto; padding: 16px 12px 40px; border-right: 1px solid var(--line); display: grid; align-content: start; gap: 1px; }
  nav a { color: var(--muted); text-decoration: none; padding: 3px 8px; border-radius: 6px; font-size: 13px; }
  nav a:hover { background: var(--line); color: var(--text); }
  nav a.n1 { color: var(--text); font-weight: 600; margin-top: 12px; display: flex; justify-content: space-between; }
  nav a.n1 i { font-style: normal; font-weight: 400; color: var(--muted); }
  nav a.n2 { padding-left: 18px; } nav a.n3 { padding-left: 30px; } nav a.n4 { padding-left: 42px; }
  main { padding: 8px 32px 120px; min-width: 0; }
  h2 { font-size: 26px; margin: 48px 0 0; }
  .intro { color: var(--muted); margin: 4px 0 0; }
  h3 { font-size: 14px; font-weight: 600; color: var(--accent); margin: 40px 0 0; padding-top: 12px; border-top: 1px solid var(--line); }
  .leaves { display: flex; flex-wrap: wrap; gap: 32px 28px; align-items: flex-start; margin-top: 20px; }
  figure { margin: 0; max-width: 100%; }
  figcaption { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: 8px; max-width: 100%; }
  figcaption b { font-weight: 600; }
  figcaption .meta { color: var(--muted); font-size: 12px; }
  figcaption a { color: var(--muted); font-size: 12px; }
  figcaption p { flex-basis: 100%; margin: 0; color: var(--muted); font-size: 13px; }
  .frame { position: relative; overflow: hidden; border-radius: 10px; outline: 1px solid var(--line); background: #0a0a0b; }
  iframe { display: block; border: 0; transform-origin: 0 0; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } nav { display: none; } main { padding: 8px 16px 80px; } }
</style>
</head>
<body>
<header class="top"><h1>Widget host mockups</h1><span>${LEAVES.length} views from “Required visualisations” in appDesign.md, each at its real size</span><span class="grow"></span>
  <div class="switch" role="group" aria-label="Theme of the mockups"><button data-theme="dark" aria-pressed="true">Dark</button><button data-theme="light" aria-pressed="false">Light</button></div>
</header>
<div class="layout">
<nav aria-label="Views">${nav}</nav>
<main>${main}</main>
</div>
<script>
  // Show every leaf at its real size, scaled down only when the column is narrower than the leaf.
  // A narrow leaf's caption may not make its figure wider than the leaf, so the caption wraps.
  function fit() {
    var avail = document.querySelector("main").clientWidth - 64;
    document.querySelectorAll(".frame").forEach(function (frame) {
      var w = +frame.dataset.w, h = +frame.dataset.h, s = Math.min(1, avail / w);
      frame.style.width = w * s + "px"; frame.style.height = h * s + "px";
      frame.firstElementChild.style.transform = "scale(" + s + ")";
      frame.parentElement.style.width = Math.max(w * s, 220) + "px";
    });
  }
  addEventListener("resize", fit); fit();
  document.querySelectorAll(".switch button").forEach(function (button) {
    button.addEventListener("click", function () {
      var theme = button.dataset.theme;
      document.documentElement.dataset.theme = theme;
      document.querySelectorAll(".switch button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === button)); });
      document.querySelectorAll("iframe:not([data-fixed])").forEach(function (f) { f.src = f.dataset.leaf + "#theme=" + theme; });
    });
  });
</script>
</body>
</html>
`;
writeFileSync(join(root, "index.html"), index);
console.log(`wrote ${LEAVES.length} leaves and index.html`);
