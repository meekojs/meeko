import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createNavigator, createRouteManifest } from "../src/framework/router.ts";

/** A mock browser that records history and scrolling. */
function mockBrowser(start: string, ids: readonly string[] = []) {
  let address = new URL(start);
  let popstate: EventListener | undefined;
  const pushed: string[] = [];
  const scrolled: string[] = [];
  const elements = new Map(ids.map((id) => [id, {
    scrollIntoView(options?: ScrollIntoViewOptions) { scrolled.push(`#${id}${options?.behavior === "instant" ? "" : " (animated)"}`); },
  }]));
  const browser = {
    get location() { return address; },
    history: {
      pushState(_state: unknown, _title: string, url: URL | string) { address = new URL(url, address); pushed.push(address.href); },
      replaceState(_state: unknown, _title: string, url: URL | string) { address = new URL(url, address); },
    },
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
      getElementsByName: () => [],
    },
    scrollTo(options: ScrollToOptions) { scrolled.push(`${options.left},${options.top}${options.behavior === "instant" ? "" : " (animated)"}`); },
    addEventListener(_name: string, listener: EventListener) { popstate = listener; },
    removeEventListener() { popstate = undefined; },
  } as unknown as Window;
  return {
    browser, pushed, scrolled,
    pop(url: string) { address = new URL(url, address); popstate?.(new Event("popstate")); },
  };
}

const routes = createRouteManifest([
  { id: "/docs/[slug]", file: "doc.meeko", layouts: ["layout.meeko"] },
]);

test("a new navigation scrolls to the top, or to the element its fragment names", async () => {
  const mock = mockBrowser("https://example.test/docs/a", ["install"]);
  const rendered: string[] = [];
  const navigator = createNavigator(routes, ({ url }) => { rendered.push(url.pathname + url.hash); }, mock.browser);
  assert.equal(await navigator.navigate("/docs/b"), true);
  assert.deepEqual(mock.scrolled, ["0,0"]);
  assert.equal(await navigator.navigate("/docs/c#install"), true);
  assert.deepEqual(mock.scrolled, ["0,0", "#install"]);
  // A fragment that names nothing still starts the new page at the top.
  assert.equal(await navigator.navigate("/docs/d#missing"), true);
  assert.deepEqual(mock.scrolled, ["0,0", "#install", "0,0"]);
  // A replaced entry keeps the scroll unless its fragment names an element.
  assert.equal(await navigator.navigate("/docs/e", { replace: true }), true);
  assert.deepEqual(mock.scrolled, ["0,0", "#install", "0,0"]);
  assert.deepEqual(rendered, ["/docs/b", "/docs/c#install", "/docs/d#missing", "/docs/e"]);
  navigator.dispose();
});

test("a fragment of the current page neither renders nor reloads the page", async () => {
  const mock = mockBrowser("https://example.test/docs/a", ["usage"]);
  let renders = 0;
  const navigator = createNavigator(routes, () => { renders++; }, mock.browser);
  assert.equal(await navigator.navigate("#usage"), true);
  assert.equal(renders, 0);
  assert.equal(mock.browser.location.href, "https://example.test/docs/a#usage");
  assert.deepEqual(mock.scrolled, ["#usage"]);
  // Back to the entry without the fragment: same document, so no render either.
  mock.pop("https://example.test/docs/a");
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(renders, 0);
  // Another page still renders, and the navigator knows where it is after the fragment entries.
  mock.pop("https://example.test/docs/b");
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(renders, 1);
  assert.equal(await navigator.navigate("/docs/b#usage"), true);
  assert.equal(renders, 1, "a fragment of the page reached through history is the same document");
  navigator.dispose();
});

test("mountClientApp leaves same-page fragment links to the browser and navigates other links", async () => {
  const browser = new HappyWindow({ url: "https://example.test/docs/a" });
  const root = browser.document.createElement("div");
  browser.document.body.append(root);
  const page = (name: string): ClientComponent => ({
    renderWithState: () => ({ html: `<p>${name}</p><a class="local" href="#part">part</a><a class="other" href="/docs/b">b</a><a class="anchor" href="/docs/a#part">self</a>`, state: {} }),
    renderToString: () => `<p>${name}</p>`,
    hydrateScope: () => () => {},
  });
  root.innerHTML = page("a").renderWithState({}).html;
  let loads = 0;
  const app = await mountClientApp({
    routes,
    root: root as unknown as Element,
    payload: { v: 2, route: "/docs/[slug]", props: { params: { slug: "a" }, search: {} }, state: {} },
    loadPage: async () => { loads++; return page("page"); },
    serverData: true,
    browser: browser as unknown as Window,
    fetch: (async () => new Response(JSON.stringify({ v: 2, route: "/docs/[slug]", props: { params: { slug: "b" }, search: {} }, state: {} }), { headers: { "content-type": "application/meeko+json" } })) as typeof fetch,
    onNavigationError: () => {},
  });
  const click = (selector: string): boolean => {
    const event = new browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    root.querySelector(selector)!.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const before = loads;
  assert.equal(click("a.local"), false, "a #fragment link is not intercepted");
  assert.equal(click("a.anchor"), false, "a link to a fragment of the current page is not intercepted");
  assert.equal(loads, before);
  assert.equal(click("a.other"), true, "a link to another page is a client navigation");
  app.dispose();
  browser.happyDOM.abort();
});

test("a route data request answered with HTML loads the document instead of failing", async () => {
  const browser = new HappyWindow({ url: "https://example.test/docs/a" });
  const root = browser.document.createElement("div");
  browser.document.body.append(root);
  const component: ClientComponent = {
    renderWithState: () => ({ html: "<p>a</p>", state: {} }),
    renderToString: () => "<p>a</p>",
    hydrateScope: () => () => {},
  };
  root.innerHTML = "<p>a</p>";
  const loaded: string[] = [];
  const location = browser.location as unknown as { assign(url: string): void; replace(url: string): void };
  location.assign = (url: string) => { loaded.push(`assign ${url}`); };
  location.replace = (url: string) => { loaded.push(`replace ${url}`); };
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes,
    root: root as unknown as Element,
    payload: { v: 2, route: "/docs/[slug]", props: { params: { slug: "a" }, search: {} }, state: {} },
    loadPage: async () => component,
    serverData: true,
    // A static host serves the prerendered index.html whatever the accept header asks for.
    fetch: (async () => new Response("<!doctype html><p>b</p>", { headers: { "content-type": "text/html; charset=utf-8" } })) as typeof fetch,
    onNavigationError: (error) => { errors.push(error); },
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("/docs/b"), false);
  assert.deepEqual(loaded, ["assign https://example.test/docs/b"]);
  assert.deepEqual(errors, []);
  assert.equal(browser.location.pathname, "/docs/a", "the URL changes only with the document load");
  app.dispose();
  browser.happyDOM.abort();
});
