// Builds dist-static/, the site as plain files for a static host, from the output of
// `pnpm run build`: the client assets and public files, every prerendered page with its
// navigation payload (index.html and index.meeko.json), and 404.html rendered by the built app.
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decorate } from "./postbuild.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(site, ".meeko", "output", "node");
const target = join(site, "dist-static");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
// Vite's own manifest is build metadata, not a public file.
await cp(join(output, "client"), target, { recursive: true, filter: (source) => !/[\\/]\.vite(?:[\\/]|$)/.test(source) });
await cp(join(output, "prerender"), target, { recursive: true, filter: (source) => !source.endsWith(`${join("prerender", "manifest.json")}`) });

// The 404 document of app/error.meeko, as `meeko start` answers a URL without a route.
const { createNodeApp } = await import(pathToFileURL(join(output, "index.mjs")).href);
const app = await createNodeApp();
try {
  const response = await app.fetch(new Request("http://localhost/__meeko-static-404", { headers: { accept: "text/html" } }));
  if (response.status !== 404) throw new Error(`The error page answered ${response.status}`);
  await writeFile(join(target, "404.html"), decorate(await response.text(), "/404").html, "utf8");
} finally {
  await app.close();
}

const count = async (directory) => (await readdir(directory, { recursive: true })).length;
console.log(`build:static: ${await count(target)} files in ${target}`);
