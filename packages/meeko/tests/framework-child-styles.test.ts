import assert from "node:assert/strict";
import test from "node:test";
import { renderComponent } from "../src/dom.ts";
import type { Component } from "../src/dom.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";

/** A compiled child component: its CSS is only reachable through the parent that renders it. */
const child = (name: string, css: string): Component<Record<string, never>> & { css: string } => ({
  css,
  renderWithState: () => ({ html: `<p class="${name}">${name}</p>`, state: {} }),
  renderToString: () => `<p class="${name}">${name}</p>`,
  hydrateScope: () => () => {},
});

const badge = child("badge", ".badge[data-meeko-s-1] { color: red; }");
const nested = child("nested", ".nested[data-meeko-s-2] { color: blue; }");
const card: Component<Record<string, never>> & { css: string } = {
  css: ".card[data-meeko-s-3] { padding: 1rem; }",
  renderWithState: () => ({ html: `<section class="card">${renderComponent(0, nested, {}, true)}</section>`, state: {} }),
  renderToString: () => `<section class="card">${renderComponent(0, nested, {}, false)}</section>`,
  hydrateScope: () => () => {},
};

const page: ClientComponent & { css: string } = {
  css: ".page[data-meeko-s-4] { margin: 0; }",
  renderWithState: () => ({ html: `<main class="page">${renderComponent(0, badge, {}, true)}${renderComponent(1, card, {}, true)}${renderComponent(2, badge, {}, true)}</main>`, state: {} }),
  renderToString: () => "<main></main>",
  hydrateScope: () => () => {},
};

test("the SSR document links the CSS of every child component it renders, once", async () => {
  const handler = createFrameworkHandler({
    routes: createRouteManifest([{ id: "/", file: "page.meeko", layouts: [] }]),
    loadPage: async () => page,
  });
  const html = await (await handler(new Request("https://example.test/", { headers: { accept: "text/html" } }))).text();
  const head = html.slice(0, html.indexOf("</head>"));
  for (const css of [page.css, badge.css, card.css, nested.css]) {
    assert.equal(head.split(css).length - 1, 1, `${css} is in <head> once`);
  }
  assert.ok(head.indexOf(page.css) < head.indexOf(badge.css), "the page's own CSS comes first");
});
