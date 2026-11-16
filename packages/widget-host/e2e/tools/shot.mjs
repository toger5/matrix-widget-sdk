// Screenshots for comparing a view with its mockup.
//   node e2e/tools/shot.mjs leaf  <leaf id, e.g. leftbar/expanded>  <out.png> [light]
//   node e2e/tools/shot.mjs story <story id, e.g. app-leftbar--expanded> <out.png> [width] [height] [light]
//   node e2e/tools/shot.mjs url   <url> <out.png> [width] [height]
// A leaf is rendered at its own size (design/leaves/<id>.html). Stories need `npm run storybook` (port 6006).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const [kind, id, out, ...rest] = process.argv.slice(2);
if (!kind || !id || !out) throw new Error("usage: shot.mjs leaf|story|url <id> <out.png> [width] [height] [light]");
const light = rest.includes("light");
const [w, h] = rest.filter((a) => a !== "light").map(Number);

let url = id;
let size = { width: w || 1280, height: h || 800 };
if (kind === "leaf") {
  const { LEAVES } = await import(pathToFileURL(join(root, "design/src/leaves.mjs")).href);
  const leaf = LEAVES.find((l) => l.id === id);
  if (!leaf) throw new Error(`unknown leaf ${id}; known: ${LEAVES.map((l) => l.id).join(" ")}`);
  size = { width: leaf.w, height: leaf.h };
  url = `${pathToFileURL(join(root, "design/leaves", `${id}.html`)).href}${light ? "#theme=light" : ""}`;
  void readFileSync(join(root, "design/leaves", `${id}.html`));
} else if (kind === "story") {
  url = `http://localhost:6006/iframe.html?id=${id}&viewMode=story&globals=theme:${light ? "light" : "dark"}`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: size });
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console error:", m.text()));
await page.goto(url, { waitUntil: "load" });
if (kind === "story") await page.waitForSelector("#storybook-root > *", { timeout: 15000 }).catch(() => console.error("the story rendered nothing"));
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log(`${out} ${size.width}x${size.height}`);
