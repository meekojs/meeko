import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { contentSecurityPolicy } from "../src/framework-server/csp.ts";
import { inlineScriptHashes } from "../src/framework/script-hashes.ts";
import { robotsTxt, siteFilesOptions, sitemapPathnames, sitemapXml } from "../src/framework/site-files.ts";
import { BrowserHead, normalizeDocumentConfig, resolveHead, resolveSeo } from "../src/framework/head.ts";
import { loadMeekoConfig } from "../src/framework/config.ts";
import { resolvedDocument, resolveSiteOrigin } from "../src/framework/module-loader.ts";
import type { ResolvedModules } from "../src/framework/module-loader.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import { tempProject } from "./helpers/temp-project.ts";

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

test("contentSecurityPolicy adds the script hashes to script-src, or to a copy of default-src, and validates the policy", () => {
  const hash = sha256("a");
  assert.equal(
    contentSecurityPolicy({ "default-src": ["'self'"], "script-src": ["'self'", "'wasm-unsafe-eval'"], "object-src": ["'none'"] }, [hash, hash]),
    `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hash}; object-src 'none'`,
  );
  // Without script-src, the hashes join the sources of default-src, so they restrict nothing more.
  assert.equal(contentSecurityPolicy({ "default-src": ["'self'", "https://cdn.example"] }, [hash]), `default-src 'self' https://cdn.example; script-src 'self' https://cdn.example ${hash}`);
  // Without either directive scripts are already allowed: a script-src of hashes alone would block the rest.
  assert.equal(contentSecurityPolicy({ "img-src": ["'self'"] }, [hash]), "img-src 'self'");
  assert.equal(contentSecurityPolicy({ "upgrade-insecure-requests": [], "default-src": ["'none'"] }), "upgrade-insecure-requests; default-src 'none'");
  assert.throws(() => contentSecurityPolicy({ "script src": ["'self'"] }), /invalid directive name/);
  assert.throws(() => contentSecurityPolicy({ "script-src": ["'self'; object-src *"] }), /invalid source/);
  assert.throws(() => contentSecurityPolicy({ "script-src": "'self'" as never }), /must be an array/);
  assert.throws(() => contentSecurityPolicy({ "script-src": ["'self'"] }, ["'sha256-x y'"]), /invalid script hash/);
});

test("inlineScriptHashes hashes the inline scripts that script-src governs, as the browser reads them", () => {
  const html = [
    "<!doctype html><html><head>",
    // The empty script: the SHA-256 of nothing, a value that does not depend on this implementation.
    "<script></script>",
    "<script type=\"module\">import './a.js'</script>",
    "<script type=\" Text/JavaScript; charset=utf-8 \">one()</script>",
    "<script type=\"importmap\">{\"imports\":{}}</script>",
    "<script src=\"/x.js\">ignored()</script>",
    "<script type=\"application/json\" id=\"meeko-payload\">{\"v\":2}</script>",
    "<script type=\"application/ld+json\">{}</script>",
    "<script>one()</script>",
    "</head><body><template><script>inTemplate()</script></template>",
    // The parser turns CR LF into LF before the script runs, and the browser hashes that text.
    "<script>a()\r\nb()</script></body></html>",
  ].join("");
  const report = inlineScriptHashes(html);
  assert.deepEqual(report.unhashable, []);
  assert.deepEqual(report.hashes, [
    "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
    sha256("import './a.js'"), sha256("one()"), sha256("{\"imports\":{}}"), sha256("inTemplate()"), sha256("a()\nb()"),
  ].sort());
  const unsafe = inlineScriptHashes('<button onclick="x()">x</button><a href=" JavaScript:alert(1)">y</a><a href="/javascript:ok">z</a><p title="onload=x">t</p>');
  assert.deepEqual(unsafe.unhashable, ["<button onclick>", '<a href=" JavaScript:alert(1)">']);
  assert.deepEqual(unsafe.hashes, []);
});

test("sitemap.xml lists absolute URLs of prerendered and parameterless routes, less noindex pages and exclusions; robots.txt names it", async (context) => {
  const root = await tempProject(context, "site-files");
  const write = async (file: string, html: string): Promise<void> => {
    await mkdir(join(root, ...file.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...file.split("/")), html);
  };
  await write("index.html", "<html><head><title>Home</title></head></html>");
  await write("docs/a/index.html", "<html><head></head></html>");
  await write("docs/b/index.html", '<html><head><meta name="robots" content="noindex, follow"></head></html>');
  await write("caf%C3%A9/index.html", "<html><head></head></html>");
  await write("admin/x/index.html", "<html><head></head></html>");
  const index = {
    version: 1 as const,
    pages: Object.fromEntries(["/", "/docs/a", "/docs/b", "/caf%C3%A9", "/admin/x"].map((pathname) => [pathname, {
      file: `${pathname === "/" ? "" : `${pathname.slice(1)}/`}index.html`, headOffset: 0, etag: '"x"',
    }])),
  };
  const routes = createRouteManifest([
    { id: "/", file: "index.meeko", layouts: [], render: "prerender" },
    { id: "/docs/[slug]", file: "doc.meeko", layouts: [], render: "prerender" },
    { id: "/café", file: "cafe.meeko", layouts: [], render: "prerender" },
    { id: "/admin/x", file: "x.meeko", layouts: [], render: "prerender" },
    { id: "/pricing", file: "pricing.meeko", layouts: [] },
    { id: "/app", file: "app.meeko", layouts: [], render: "client" },
    { id: "/users/[id]", file: "user.meeko", layouts: [] },
  ]);
  const pathnames = await sitemapPathnames({ index, prerenderDirectory: root, routes, exclude: ["/admin/*", "/app"] });
  assert.deepEqual(pathnames, ["/", "/caf%C3%A9", "/docs/a", "/pricing"]);
  assert.equal(sitemapXml("https://example.com", ["/", "/a&b"]), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url><loc>https://example.com/</loc></url>",
    "  <url><loc>https://example.com/a&amp;b</loc></url>",
    "</urlset>",
    "",
  ].join("\n"));
  assert.equal(robotsTxt({}, "https://example.com/sitemap.xml"), "User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n");
  assert.equal(robotsTxt({ disallow: ["/admin/"] }, undefined), "User-agent: *\nDisallow: /admin/\n");
  assert.deepEqual(siteFilesOptions({ sitemap: true, robots: false }), { sitemap: {} });
  assert.deepEqual(siteFilesOptions({}), {});
});

test("meeko.config.ts validates site, sitemap, robots, document.seo and the static adapter", async (context) => {
  const root = await tempProject(context, "static-config");
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  const config = async (source: string) => {
    await writeFile(join(root, "meeko.config.mjs"), `export default ${source};\n`);
    return loadMeekoConfig(root);
  };
  const valid = await config(`{ site: "https://example.com/", sitemap: { exclude: ["/admin/*"] }, robots: { disallow: ["/x"] }, document: { seo: { ogDescription: false } },
    server: { adapter: "static", headerFiles: ["_headers", "nginx"], contentSecurityPolicy: { "default-src": ["'self'"] }, headers: { "Referrer-Policy": "no-referrer" } } }`);
  assert.equal(valid.server?.adapter, "static");
  assert.equal(resolveSiteOrigin(valid, {}), "https://example.com");
  assert.equal(resolveSiteOrigin({}, { MEEKO_PUBLIC_ORIGIN: "https://env.example" }), "https://env.example");
  assert.equal(resolveSiteOrigin({ site: "https://config.example" }, { MEEKO_PUBLIC_ORIGIN: "https://env.example" }), "https://config.example");
  assert.equal(resolveSiteOrigin({}, {}), undefined);
  // MEEKO_PUBLIC_ORIGIN keeps only its origin, as the server reads it since 1.2; `site` stays strict.
  assert.equal(resolveSiteOrigin({}, { MEEKO_PUBLIC_ORIGIN: "https://user:secret@env.example/app?x=1#y" }), "https://env.example");
  assert.throws(() => resolveSiteOrigin({}, { MEEKO_PUBLIC_ORIGIN: "ftp://env.example" }), /MEEKO_PUBLIC_ORIGIN must use http: or https:/);
  assert.throws(() => resolveSiteOrigin({ site: "https://example.com/app" }, {}), /site must be an origin without path/);
  await assert.rejects(config('{ site: "https://example.com/docs" }'), /site must be an origin without path/);
  await assert.rejects(config('{ site: "ftp://example.com" }'), /site must use http: or https:/);
  await assert.rejects(config('{ sitemap: { exclude: ["admin"] } }'), /sitemap\.exclude must be an array of nonempty strings that start with \//);
  await assert.rejects(config('{ sitemap: { include: [] } }'), /sitemap: unknown field include/);
  await assert.rejects(config('{ robots: "yes" }'), /robots must be a boolean or an object/);
  await assert.rejects(config('{ document: { seo: { canonical: "yes" } } }'), /document\.seo: canonical must be a boolean/);
  await assert.rejects(config('{ server: { adapter: "static", port: 3000 } }'), /server \(static\): unknown field port/);
  await assert.rejects(config('{ server: { adapter: "static", headerFiles: ["apache"] } }'), /headerFiles must be an array of "_headers" and "nginx"/);
  await assert.rejects(config('{ server: { adapter: "static", contentSecurityPolicy: { "script-src": ["a;b"] } } }'), /server\.contentSecurityPolicy: invalid source/);
  await assert.rejects(config('{ server: { adapter: "static", headers: { "Content-Security-Policy": "x" } } }'), /use server\.contentSecurityPolicy/);
  await assert.rejects(config('{ server: { adapter: "static", headers: { "X-A": "a\\nb" } } }'), /without line breaks/);
  await assert.rejects(config('{ server: { adapter: "edge" } }'), /"bun" or "static"/);
});

test("the document reads MEEKO_PUBLIC_ORIGIN only when document.seo writes an absolute URL, and keeps its origin", () => {
  const modules = { head: undefined } as unknown as ResolvedModules;
  const originOf = (config: Parameters<typeof resolvedDocument>[0]): string | undefined => {
    const seo = resolvedDocument(config, modules)?.seo;
    return typeof seo === "object" ? seo.origin : undefined;
  };
  const previous = process.env.MEEKO_PUBLIC_ORIGIN;
  try {
    // A deployment origin with a path (or any value) does not break an app that writes no absolute URL.
    process.env.MEEKO_PUBLIC_ORIGIN = "not a url";
    assert.deepEqual(resolvedDocument({ document: { lang: "es" } }, modules), { lang: "es" });
    assert.deepEqual(resolvedDocument({ document: { seo: { canonical: false, ogUrl: false } } }, modules)?.seo, { canonical: false, ogUrl: false, ogTitle: true, ogDescription: true });
    assert.equal(originOf({ document: { seo: { origin: "https://own.example" } } }), "https://own.example");
    process.env.MEEKO_PUBLIC_ORIGIN = "https://example.com/app?x=1";
    assert.equal(originOf({ document: { seo: true } }), "https://example.com");
  } finally {
    if (previous === undefined) delete process.env.MEEKO_PUBLIC_ORIGIN; else process.env.MEEKO_PUBLIC_ORIGIN = previous;
  }
});

test("document.seo derives the canonical URL, og:url, og:title and og:description that the page does not declare", () => {
  const seo = resolveSeo(true, "document.seo", "https://example.com")!;
  assert.deepEqual(seo, { canonical: true, ogUrl: true, ogTitle: true, ogDescription: true, origin: "https://example.com" });
  assert.deepEqual(normalizeDocumentConfig({ seo: { ogTitle: false, origin: "https://a.example/" } }, "document"), {
    seo: { canonical: true, ogUrl: true, ogTitle: false, ogDescription: true, origin: "https://a.example" },
  });
  const entry = (input: Parameters<typeof resolveHead>[0][number]["input"]) => [{ level: 0, order: 0, input }];
  const tags = (head: ReturnType<typeof resolveHead>) => head.tags.filter((tag) => !tag.fallback).map((tag) => `${tag.tag} ${tag.attributes.map(([name, value]) => `${name}=${String(value)}`).join(" ")}`);
  const page = resolveHead(entry({ title: "Docs", meta: [{ name: "description", content: "Guide" }] }), { seo, pathname: "/docs/a%20b" });
  assert.deepEqual(tags(page), [
    "meta name=description content=Guide",
    "meta property=og:url content=https://example.com/docs/a%20b",
    "meta property=og:title content=Docs",
    "meta property=og:description content=Guide",
    "link rel=canonical href=https://example.com/docs/a%20b",
  ]);
  // What the page declares wins, under any key.
  const declared = resolveHead(entry({
    title: "Docs", meta: [{ property: "og:title", content: "Own" }, { property: "og:url", content: "https://other.example/x", key: "url" }],
    link: [{ rel: "Canonical", href: "https://other.example/x", key: "canonical" }],
  }), { seo, pathname: "/docs" });
  assert.deepEqual(tags(declared), [
    "meta property=og:title content=Own", "meta property=og:url content=https://other.example/x", "link rel=Canonical href=https://other.example/x",
  ]);
  // An error page has no address of its own; without an origin there is no URL either.
  assert.deepEqual(tags(resolveHead(entry({ title: "Error" }), { seo, pathname: undefined })), ["meta property=og:title content=Error"]);
  assert.deepEqual(tags(resolveHead(entry({ title: "X" }), { seo: resolveSeo(true, "seo"), pathname: "/x" })), ["meta property=og:title content=X"]);
  assert.deepEqual(tags(resolveHead(entry({ title: "X" }), { seo: resolveSeo({ ogTitle: false, ogUrl: false }, "seo", "https://e.x"), pathname: "/x" })), ["link rel=canonical href=https://e.x/x"]);
  assert.equal(resolveSeo(false, "seo"), undefined);
  assert.throws(() => resolveSeo({ og: true }, "document.seo"), /unknown field og/);
  assert.throws(() => resolveSeo({ origin: "example.com" }, "document.seo"), /origin must be an absolute URL/);
});

test("SSR documents carry the derived tags, and client navigation moves the canonical URL with the page", async () => {
  const page = (render: (props: Record<string, unknown>) => string): ClientComponent => ({
    renderWithState: (props) => ({ html: render(props), state: {} }),
    renderToString: render,
    hydrateScope: () => () => {},
  });
  const modules: Record<string, ClientComponent> = {
    "home.meeko": page(() => "<p>home</p>"),
    "doc.meeko": page((props) => `<p>${String((props.params as Record<string, string>).slug)}</p>`),
    "error.meeko": page((props) => `<p>${String(props.status)}</p>`),
  };
  const routes = createRouteManifest([
    { id: "/", file: "home.meeko", layouts: [], sidecar: "home.route.ts" },
    { id: "/docs/[slug]", file: "doc.meeko", layouts: [], sidecar: "doc.route.ts" },
  ]);
  const document = { head: { titleTemplate: "%s · Site", meta: [{ name: "description", content: "Site" }] }, seo: { origin: "https://example.com" } };
  const handler = createFrameworkHandler({
    routes, errorPage: { file: "error.meeko", layouts: [] },
    loadPage: async (file) => modules[file]!,
    loadRoute: async (file) => (file === "home.route.ts" ? { head: () => ({ title: "Home" }) } : {
      head: ({ params }: { params: Record<string, string> }) => ({ title: params.slug!, description: `About ${params.slug}`, link: params.slug === "own" ? [{ rel: "canonical", href: "https://example.com/" }] : [] }),
    }) as never,
    clientEntry: "/entry.js",
    document: { config: document },
  });
  const html = async (url: string): Promise<string> => (await handler(new Request(url, { headers: { accept: "text/html" } }))).text();
  const doc = await html("https://internal.test/docs/intro?ref=1");
  assert.match(doc, /<meta property="og:url" content="https:\/\/example\.com\/docs\/intro">/);
  assert.match(doc, /<meta property="og:title" content="intro · Site">/);
  assert.match(doc, /<meta property="og:description" content="About intro">/);
  assert.match(doc, /<link rel="canonical" href="https:\/\/example\.com\/docs\/intro">/);
  assert.equal((await html("https://internal.test/docs/own")).match(/rel="canonical"/g)?.length, 1);
  const missing = await html("https://internal.test/nowhere");
  assert.doesNotMatch(missing, /canonical|og:url/);
  assert.match(missing, /<meta property="og:title" content="Error · Site">/);
  // The browser head follows the committed page.
  const browser = new HappyWindow({ url: "https://example.com/docs/intro" });
  try {
    browser.document.write(doc);
    const head = new BrowserHead(browser.document as unknown as Document, normalizeDocumentConfig(document, "document"));
    head.setRoute({ title: "intro", meta: [{ name: "description", content: "About intro" }] }, "/docs/intro");
    const canonical = () => browser.document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");
    assert.equal(browser.document.head.querySelectorAll('link[rel="canonical"]').length, 1);
    head.setRoute({ title: "next", meta: [{ name: "description", content: "About next" }] }, "/docs/next");
    assert.equal(canonical(), "https://example.com/docs/next");
    assert.equal(browser.document.head.querySelector('meta[property="og:description"]')?.getAttribute("content"), "About next");
    head.setRoute({ title: "Error" }, undefined);
    assert.equal(canonical(), undefined);
    assert.equal(browser.document.head.querySelector('meta[property="og:url"]'), null);
    head.dispose();
  } finally {
    await browser.happyDOM.abort();
  }
});
