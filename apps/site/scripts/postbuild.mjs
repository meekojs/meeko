// Runs after `meeko build`, whose static adapter writes the whole site to .meeko/output/static/
// (pages, 404.html, sitemap.xml, robots.txt and _meeko/headers.conf with the CSP; see
// meeko.config.ts). What stays here is the site's own: the Pagefind index of the pages, written
// to the output's pagefind/, and the copy of the output to dist-static/, the folder that
// deploy/nginx.conf serves.
import { cp, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pagefind from "pagefind";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(site, ".meeko", "output", "static");
const target = join(site, "dist-static");

/** Pagefind bundle of the prerendered pages (every page is a folder's index.html; 404.html is not). */
async function buildIndex() {
  await rm(join(output, "pagefind"), { recursive: true, force: true });
  const { index, errors } = await pagefind.createIndex({ forceLanguage: "es", includeCharacters: "-_$." });
  if (!index) throw new Error(`Pagefind: ${errors.join("; ")}`);
  try {
    const added = await index.addDirectory({ path: output, glob: "**/index.html" });
    if (added.errors.length) throw new Error(`Pagefind: ${added.errors.join("; ")}`);
    const written = await index.writeFiles({ outputPath: join(output, "pagefind") });
    if (written.errors.length) throw new Error(`Pagefind: ${written.errors.join("; ")}`);
    return added.page_count;
  } finally {
    await pagefind.close();
  }
}

const pages = await buildIndex();
await rm(target, { recursive: true, force: true });
await cp(output, target, { recursive: true });
const files = await readdir(target, { recursive: true });
for (const required of ["index.html", "404.html", "sitemap.xml", "robots.txt", "_meeko/headers.conf", "pagefind/pagefind.js", "brand/favicon-64.png"]) {
  if (!files.some((file) => file.replaceAll("\\", "/") === required)) throw new Error(`postbuild: ${required} is missing from ${target}`);
}
console.log(`postbuild: ${pages} pages indexed by Pagefind; ${files.length} files in ${target}`);
