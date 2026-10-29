// Runs after `meeko build`, whose static adapter writes the whole site to .meeko/output/static/
// (pages, 404.html, sitemap.xml, robots.txt and _meeko/headers.conf with the CSP; see
// meeko.config.ts). What stays here is the site's own: the Pagefind index of the pages, written
// to the output's pagefind/, /llms.txt and /llms-full.txt for language models, and the copy of the
// output to dist-static/, the folder that deploy/nginx.conf serves.
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pagefind from "pagefind";
import { createServer } from "vite";

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

/**
 * `/llms.txt` (the llms.txt convention: the site and a link with one line per page) and
 * `/llms-full.txt` (every guide and every symbol of the reference in plain Markdown). The site's
 * content modules are TypeScript, so Vite loads them, as `meeko build` does, without a server.
 */
async function writeLlms() {
  const vite = await createServer({
    root: site, configFile: false, logLevel: "error", appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { catalog } = await vite.ssrLoadModule("/server/content/catalog.ts");
    const { renderSource } = await vite.ssrLoadModule("/server/content/markdown.ts");
    const { readRepositoryFile, siteOrigin } = await vite.ssrLoadModule("/server/content/repository.ts");
    const { llmsFull, llmsIndex } = await vite.ssrLoadModule("/server/content/reference.ts");
    const guides = await Promise.all(catalog.map(async (entry) => {
      const markdown = (entry.transform ?? ((text) => text))(readRepositoryFile(entry.source));
      const doc = await renderSource(entry.source, entry.transform);
      return { title: doc.title, href: entry.href, description: doc.description, markdown };
    }));
    await writeFile(join(output, "llms.txt"), await llmsIndex(siteOrigin, guides));
    await writeFile(join(output, "llms-full.txt"), await llmsFull(siteOrigin, guides));
  } finally {
    await vite.close();
  }
}

const pages = await buildIndex();
await writeLlms();
await rm(target, { recursive: true, force: true });
await cp(output, target, { recursive: true });
const files = await readdir(target, { recursive: true });
for (const required of ["index.html", "404.html", "sitemap.xml", "robots.txt", "_meeko/headers.conf", "pagefind/pagefind.js", "brand/favicon-64.png", "llms.txt", "llms-full.txt"]) {
  if (!files.some((file) => file.replaceAll("\\", "/") === required)) throw new Error(`postbuild: ${required} is missing from ${target}`);
}
console.log(`postbuild: ${pages} pages indexed by Pagefind; ${files.length} files in ${target}`);
