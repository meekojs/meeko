// Runs after `meeko build`. Everything here derives from the prerendered pages:
//
// 1. Pagefind indexes them; the bundle, sitemap.xml and robots.txt are written to public/.
//    `meeko start` only serves the files of the build manifest, so when those public files
//    change, `meeko build` runs once more to list them (a clean checkout always builds twice).
// 2. Each prerendered document gets what Meeko has no option for yet: `<html lang="es">`, the
//    favicon, its canonical URL and Open Graph tags. Its `headOffset` and `ETag` in
//    prerender/manifest.json follow the change.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pagefind from "pagefind";

const origin = "https://meeko.diegootayza.com";
const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(site, ".meeko", "output", "node");
const prerender = join(output, "prerender");
const publicDir = join(site, "public");

const escapeAttribute = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const decodeEntities = (value) => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
/** Same tag as Meeko's prerender: a quoted, truncated base64url SHA-256 of the document. */
const etagOf = (html) => `"${createHash("sha256").update(html).digest("base64url").slice(0, 27)}"`;

async function readManifest() {
  return JSON.parse(await readFile(join(prerender, "manifest.json"), "utf8"));
}

/** The document with the site's additions to `<html>` and `<head>`, and how much `<head>` moved. */
export function decorate(html, pathname) {
  if (html.includes('<html lang="es">')) return { html, shift: 0 };
  const opening = html.indexOf("<html>");
  if (opening < 0) throw new Error(`${pathname}: no <html> to mark as Spanish`);
  const lang = '<html lang="es">';
  let result = html.slice(0, opening) + lang + html.slice(opening + "<html>".length);
  const title = decodeEntities(/<title>([^<]*)<\/title>/.exec(result)?.[1] ?? "Meeko");
  const description = decodeEntities(/<meta name="description" content="([^"]*)">/.exec(result)?.[1] ?? "");
  const url = `${origin}${pathname === "/" ? "/" : pathname}`;
  const extras = [
    '<link rel="icon" type="image/png" sizes="64x64" href="/brand/favicon-64.png">',
    '<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">',
    '<meta name="theme-color" content="#fffaf3" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#16100e" media="(prefers-color-scheme: dark)">',
    // The 404 document is served for any missing URL, so it names no address of its own.
    ...(pathname === "/404" ? [] : [`<link rel="canonical" href="${escapeAttribute(url)}">`, `<meta property="og:url" content="${escapeAttribute(url)}">`]),
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Meeko">',
    '<meta property="og:locale" content="es_ES">',
    `<meta property="og:title" content="${escapeAttribute(title)}">`,
    ...(description ? [`<meta property="og:description" content="${escapeAttribute(description)}">`] : []),
    `<meta property="og:image" content="${origin}/brand/apple-touch-icon.png">`,
  ].join("");
  const close = result.indexOf("</head>");
  if (close < 0) throw new Error(`${pathname}: no </head>`);
  result = result.slice(0, close) + extras + result.slice(close);
  return { html: result, shift: lang.length - "<html>".length };
}

async function decoratePrerender() {
  const manifest = await readManifest();
  for (const [pathname, page] of Object.entries(manifest.pages)) {
    const file = join(prerender, ...page.file.split("/"));
    const before = await readFile(file, "utf8");
    const { html, shift } = decorate(before, pathname);
    if (html === before) continue;
    await writeFile(file, html, "utf8");
    // The CSRF meta tag goes after Meeko's head prefix, which `lang` moved.
    page.headOffset += shift;
    page.etag = etagOf(html);
  }
  await writeFile(join(prerender, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  return manifest;
}

async function listFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  try { await walk(root); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return files.sort();
}

/** Pagefind bundle of the prerendered pages, in a temporary folder. */
async function buildIndex() {
  const { index, errors } = await pagefind.createIndex({ forceLanguage: "es", includeCharacters: "-_$." });
  if (!index) throw new Error(`Pagefind: ${errors.join("; ")}`);
  const added = await index.addDirectory({ path: prerender, glob: "**/*.html" });
  if (added.errors.length) throw new Error(`Pagefind: ${added.errors.join("; ")}`);
  const directory = await mkdtemp(join(tmpdir(), "meeko-pagefind-"));
  const written = await index.writeFiles({ outputPath: directory });
  if (written.errors.length) throw new Error(`Pagefind: ${written.errors.join("; ")}`);
  await pagefind.close();
  return { directory, pages: added.page_count };
}

function sitemap(manifest) {
  const urls = Object.keys(manifest.pages).sort().map((pathname) => `  <url><loc>${origin}${pathname}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

const robots = `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;

/** Writes `files` (relative path → content) under public/, replacing `owned` folders; whether anything changed. */
async function syncPublic(files, owned) {
  let changed = false;
  for (const folder of owned) {
    const current = await listFiles(join(publicDir, folder));
    const next = Object.keys(files).filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1)).sort();
    if (current.join("\n") !== next.join("\n")) {
      changed = true;
      await rm(join(publicDir, folder), { recursive: true, force: true });
    }
  }
  for (const [path, content] of Object.entries(files)) {
    const target = join(publicDir, ...path.split("/"));
    let previous;
    try { previous = await readFile(target); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous && Buffer.compare(previous, Buffer.from(content)) === 0) continue;
    changed = true;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return changed;
}

function meekoBuild() {
  const cli = join(site, "node_modules", "@meekojs", "meeko", "dist", "cli.js");
  const result = spawnSync(process.execPath, [cli, "build", "."], { cwd: site, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`meeko build failed with exit code ${result.status}`);
}

async function main() {
  let manifest = await decoratePrerender();
  const index = await buildIndex();
  try {
    const files = { "sitemap.xml": sitemap(manifest), "robots.txt": robots };
    for (const path of await listFiles(index.directory)) files[`pagefind/${path}`] = await readFile(join(index.directory, ...path.split("/")));
    if (await syncPublic(files, ["pagefind"])) {
      console.log("postbuild: public/ changed (Pagefind, sitemap, robots); building again so the manifest lists them");
      meekoBuild();
      manifest = await decoratePrerender();
    }
    console.log(`postbuild: ${Object.keys(manifest.pages).length} pages decorated, ${index.pages} indexed by Pagefind`);
  } finally {
    await rm(index.directory, { recursive: true, force: true });
  }
  const client = await listFiles(join(output, "client"));
  for (const required of ["pagefind/pagefind.js", "sitemap.xml", "robots.txt", "brand/favicon-64.png"]) {
    if (!client.includes(required)) throw new Error(`postbuild: ${required} is missing from the client build`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
