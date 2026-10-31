import { defineServerMiddleware } from "@meekojs/meeko/server";

import { listPages, readPage, searchPages } from "../content/db";

const origin = "https://meeko.diegootayza.com";
const xmlText = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Public text endpoints backed by the same snapshot as the documentation pages. */
export default defineServerMiddleware(async (request, next) => {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method !== "GET" && request.method !== "HEAD") return next(request);

  if (path === "/llms.txt" || path === "/llms-full.txt") {
    const document = await readPage<{ text: string }>(path);
    if (!document) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : document.text, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }

  if (path === "/sitemap.xml") {
    const pages = await listPages();
    if (pages.length === 0) return new Response("Documentation unavailable", { status: 503 });
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages
      .filter((page) => page.path === "/" || page.path === "/docs" || page.path.startsWith("/docs/"))
      .map((page) => `<url><loc>${xmlText(origin + page.path)}</loc></url>`).join("")}</urlset>`;
    return new Response(request.method === "HEAD" ? null : xml, {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }

  if (path === "/robots.txt") {
    return new Response(request.method === "HEAD" ? null : `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (path === "/api/docs/search") {
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length > 120) return new Response("Query too long", { status: 400 });
    const results = query ? await searchPages(query, 8) : [];
    return Response.json(results, { headers: { "cache-control": "no-store" } });
  }

  return next(request);
});
