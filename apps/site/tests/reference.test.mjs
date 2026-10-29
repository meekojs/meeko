// The written pages of the API reference (docs/reference) against the package and the taxonomy.
// The site's content modules are TypeScript: Vite loads them as `meeko build` does, without a
// server. See docs/reference/README.md for the rules this checks.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(site, "package.json"));

let vite;
/** @type {import("../server/content/reference.ts")} */
let reference;
/** @type {import("../server/content/reference-taxonomy.ts")} */
let taxonomyModule;
/** @type {import("../server/content/api.ts")} */
let api;
/** @type {import("../server/content/catalog.ts")} */
let catalog;
/** @type {import("../server/content/markdown.ts")} */
let markdown;

before(async () => {
  vite = await createServer({
    root: site, configFile: false, logLevel: "error", appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  reference = await vite.ssrLoadModule("/server/content/reference.ts");
  taxonomyModule = await vite.ssrLoadModule("/server/content/reference-taxonomy.ts");
  api = await vite.ssrLoadModule("/server/content/api.ts");
  catalog = await vite.ssrLoadModule("/server/content/catalog.ts");
  markdown = await vite.ssrLoadModule("/server/content/markdown.ts");
});

after(async () => {
  await vite?.close();
});

/** The `##` and `###` headings of a body and the fences of each `###`, outside code blocks. */
function outline(body) {
  const sections = [];
  let fence = null;
  let current = null;
  let subsection = null;
  let intro = "";
  for (const line of body.split("\n")) {
    const marker = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker && !fence) {
      fence = marker[1];
      const info = marker[2].trim();
      subsection?.fences.push(info);
      current?.fences.push(info);
      continue;
    }
    if (fence) {
      if (line.startsWith(fence) && !line.slice(fence.length).trim()) fence = null;
      continue;
    }
    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      current = { title: h2[1].trim(), subsections: [], fences: [] };
      subsection = null;
      sections.push(current);
      continue;
    }
    const h3 = /^### (.+)$/.exec(line);
    if (h3 && current) {
      subsection = { title: h3[1].trim(), fences: [] };
      current.subsections.push(subsection);
      continue;
    }
    if (!current) intro += line;
  }
  return { intro, sections };
}

/** Each written page with the entry of the taxonomy that owns it. */
async function pagesWithEntries() {
  const { entries } = await reference.resolvedTaxonomy();
  return reference.writtenPages().map((page) => ({ page, entry: entries.find((candidate) => candidate.page === page) }));
}

test("every symbol of the taxonomy exists in the package", async () => {
  const missing = [];
  const seen = new Map();
  for (const group of taxonomyModule.taxonomy()) {
    for (const entry of group.entries) {
      for (const id of entry.symbols) if (!(await reference.referenceSymbol(id))) missing.push(`${group.id}/${entry.name}: ${id}`);
      const first = entry.symbols[0];
      assert.ok(!seen.has(first), `${first} is the symbol of two entries: ${seen.get(first)} and ${entry.name}`);
      seen.set(first, entry.name);
    }
  }
  assert.deepEqual(missing, [], "symbols of docs/reference/taxonomy.json that the package does not have");
});

test("an entry declares a slug exactly when its first symbol has no generated page", async () => {
  for (const group of taxonomyModule.taxonomy()) {
    for (const entry of group.entries) {
      const symbol = await reference.referenceSymbol(entry.symbols[0]);
      if (symbol?.info) assert.equal(entry.slug, undefined, `${entry.name}: its page takes the slug of /docs/reference/${symbol.info.slug}; remove "slug"`);
      else {
        assert.ok(entry.slug, `${entry.name}: ${entry.symbols[0]} has no generated page; give the entry a "slug"`);
        assert.ok(entry.fallback || !entry.pending || symbol?.kind === "config", `${entry.name}: a pending entry without a generated page needs a "fallback"`);
      }
    }
  }
  const generated = await api.apiSlugSet();
  for (const group of taxonomyModule.taxonomy()) {
    for (const entry of group.entries) if (entry.slug) assert.ok(!generated.has(entry.slug), `${entry.name}: slug ${entry.slug} is already a generated page`);
  }
});

test("written pages and pending entries agree: the list of pending symbols only shrinks", async () => {
  const { entries } = await reference.resolvedTaxonomy();
  for (const resolved of entries) {
    const where = `${resolved.group.id}/${resolved.entry.name}`;
    if (resolved.entry.pending) assert.equal(resolved.page, undefined, `${where} has the page ${resolved.page?.file}: remove "pending": true from docs/reference/taxonomy.json`);
    else assert.ok(resolved.page, `${where} is not pending, but docs/reference/${resolved.group.id}/${resolved.slug}.md does not exist`);
  }
  for (const { page, entry } of await pagesWithEntries()) {
    assert.ok(entry, `${page.file} belongs to no entry of docs/reference/taxonomy.json: its folder and slug must be those of the entry of its first symbol`);
    assert.equal(page.group, entry.group.id, `${page.file}: group must be its folder`);
    assert.deepEqual(page.symbols[0], entry.entry.symbols[0], `${page.file}: the first symbol must be the one of its entry`);
  }
});

test("the frontmatter of every page names real symbols and versions", async () => {
  const { data } = reference.parseFrontmatter("---\ntitle: x\nsymbols:\n  - \"a#b\"\nrelated: [c, 'd']\n---\nBody", "test.md");
  assert.deepEqual([data.get("title"), data.get("symbols"), data.get("related")], ["x", ["a#b"], ["c", "d"]]);
  for (const { page } of await pagesWithEntries()) {
    assert.match(page.since, /^\d+\.\d+\.\d+$/, `${page.file}: since must be a version such as 1.2.0`);
    assert.ok(!/\]\(|\n/.test(page.description), `${page.file}: description is one line without links`);
    for (const id of [...page.symbols, ...page.types]) assert.ok(await reference.referenceSymbol(id), `${page.file}: ${id} is not a symbol of the package`);
    for (const id of page.related) {
      if (/\.md(?:#|$)/.test(id)) continue;
      assert.ok(await reference.referenceSymbol(id), `${page.file}: related ${id} is not a symbol of the package`);
    }
    const info = (await reference.referenceSymbol(page.symbols[0]))?.info;
    if (info?.since) assert.equal(page.since, info.since, `${page.file}: since must be the @since of ${info.name}`);
    // Renders: the generated types, the related links and the guide sections it names.
    const rendered = await reference.referencePage(page.slug);
    assert.ok(rendered?.body.includes('class="type-block"'), `${page.file}: the "Tipo" section is empty`);
    for (const [, href] of rendered.body.matchAll(/href="([^"]+)"/g)) {
      // A guide resolved from the page's folder instead of the repository root.
      assert.doesNotMatch(href, /docs\/reference\/[\w-]+\/docs\//, `${page.file}: the link ${href} should be a page of the site`);
    }
  }
});

test("every page has the sections of the template, in order", async () => {
  const written = reference.pageSections.filter((section) => !("generated" in section && section.generated));
  for (const { page } of await pagesWithEntries()) {
    const { intro, sections } = outline(page.body);
    assert.ok(intro.trim(), `${page.file}: the page starts with its description, before "## Uso"`);
    const titles = sections.map((section) => section.title);
    assert.equal(titles.length, written.length, `${page.file}: the sections must be ${written.map((section) => section.titles.join(" | ")).join(", ")}; found ${titles.join(", ")}`);
    titles.forEach((title, index) => assert.ok(written[index].titles.includes(title), `${page.file}: section ${index + 1} must be ${written[index].titles.join(" or ")}, not "${title}"`));
    const mistakes = sections.find((section) => section.title === "Errores comunes");
    assert.ok(mistakes.subsections.length, `${page.file}: "Errores comunes" needs at least one ### mistake`);
    for (const mistake of mistakes.subsections) {
      const verdicts = mistake.fences.map((info) => info.split(/\s+/).slice(1));
      assert.ok(verdicts.some((words) => words.includes("bad")), `${page.file}: "${mistake.title}" needs a \`\`\` bad block with the incorrect code`);
      assert.ok(verdicts.some((words) => words.includes("good")), `${page.file}: "${mistake.title}" needs a \`\`\` good block with the correct code`);
    }
    const examples = sections.find((section) => section.title === "Ejemplos");
    assert.ok(examples.fences.length, `${page.file}: "Ejemplos" needs code`);
  }
});

test("fallback links and related guide sections exist", async () => {
  const anchors = async (href) => {
    const [path, anchor] = href.split("#");
    const entry = catalog.catalog.find((candidate) => candidate.href === path);
    assert.ok(entry, `${href} is not a page of the guides`);
    return !anchor || (await markdown.documentHeadings(entry.source)).has(decodeURIComponent(anchor));
  };
  for (const group of taxonomyModule.taxonomy()) {
    for (const entry of group.entries) if (entry.fallback) assert.ok(await anchors(entry.fallback), `${entry.name}: fallback ${entry.fallback} is not a heading of its guide`);
  }
  for (const { page } of await pagesWithEntries()) {
    for (const item of page.related) {
      const guide = /^([\w./-]+\.md)(?:#(.+))?$/.exec(item);
      if (guide?.[2]) assert.ok((await markdown.documentHeadings(guide[1])).has(guide[2]), `${page.file}: related ${item} is not a heading`);
    }
  }
});

test("the ts examples of the pages compile against @meekojs/meeko", async () => {
  const ts = require("@typescript/typescript6");
  const files = new Map();
  for (const { page } of await pagesWithEntries()) {
    const lines = page.body.split("\n");
    let fence = null;
    let code = [];
    let start = 0;
    for (const [index, line] of lines.entries()) {
      if (!fence) {
        const marker = /^(`{3,})(\S*)(.*)$/.exec(line);
        if (marker) {
          const words = marker[3].trim().split(/\s+/);
          const previous = lines.slice(0, index).reverse().find((candidate) => candidate.trim());
          fence = { marker: marker[1], check: /^(?:ts|typescript)$/.test(marker[2]) && !words.includes("bad") && previous?.trim() !== "<!-- no-check -->" };
          code = [];
          start = index + 1;
        }
        continue;
      }
      if (line.startsWith(fence.marker) && !line.slice(fence.marker.length).trim()) {
        if (fence.check) files.set(join(site, ".reference-examples", `${page.slug}-${start + 1}.ts`).replaceAll("\\", "/"), `${code.join("\n")}\nexport {};\n`);
        fence = null;
        continue;
      }
      code.push(line);
    }
  }
  if (!files.size) return;
  const options = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: ["node"], strict: true, noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true, skipLibCheck: true, noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const known = (file) => files.has(file.replaceAll("\\", "/"));
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => known(file) || fileExists.call(host, file);
  host.readFile = (file) => files.get(file.replaceAll("\\", "/")) ?? readFile.call(host, file);
  host.getSourceFile = (file, language, ...rest) => known(file) ? ts.createSourceFile(file, files.get(file.replaceAll("\\", "/")), language, true) : getSourceFile.call(host, file, language, ...rest);
  const program = ts.createProgram([...files.keys()], options, host);
  const problems = ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file && known(diagnostic.file.fileName))
    .map((diagnostic) => {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const [slug, at] = diagnostic.file.fileName.split("/").pop().replace(/\.ts$/, "").split(/-(?=\d+$)/);
      return `${slug}.md, block at line ${Number(at)} + ${line}: TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
    });
  assert.deepEqual(problems, [], "ts examples that do not compile: fix them or mark them <!-- no-check -->");
});
