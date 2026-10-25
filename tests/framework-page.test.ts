import assert from "node:assert/strict";
import test from "node:test";
import { definePage } from "../src/framework/page.ts";
import type { PageSchema } from "../src/framework/page.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";

test("definePage rejects an unavailable client-only render mode", () => {
  // @ts-expect-error Client-only rendering is not part of the supported route contract.
  const unsupported = () => definePage({ render: "client" });
  assert.throws(unsupported, /render: "client" is not supported/);
});

const paramsSchema: PageSchema<unknown, { id: number }> = {
  "~standard": {
    version: 1,
    validate: (value) => {
      if (typeof value !== "object" || value === null || !("id" in value) || !/^\d+$/.test(String(value.id))) {
        return { issues: ["invalid id"] };
      }
      return { value: { id: Number(value.id) } };
    },
  },
};
const searchSchema: PageSchema<unknown, { tab: string }> = {
  "~standard": {
    version: 1,
    validate: (value) => {
      if (typeof value !== "object" || value === null || !("tab" in value) || value.tab !== "profile") {
        return { issues: ["invalid tab"] };
      }
      return { value: { tab: "profile" } };
    },
  },
};

if (false) {
  createFrameworkHandler({
    routes: [],
    loadPage: async () => ({ renderWithState: () => ({ html: "", state: {} }) }),
    // @ts-expect-error The handler cannot accept a non-route from loadRoute.
    loadRoute: async () => 42,
  });
}

test("definePage validates external params/search before loader and keeps typed output", async () => {
  let calls = 0;
  const page = definePage({
    params: paramsSchema,
    search: searchSchema,
    load: ({ params, search, state }) => {
      const id: number = params.id;
      const tab: string = search.tab;
      calls++;
      state.get("user", () => id);
      return { id, tab };
    },
    head: ({ data }) => ({ title: `User ${data.id}` }),
  });
  const routes = createRouteManifest([{ id: "/users/[id]", file: "user.meeko", layouts: [], sidecar: "user.route.ts" }]);
  const handler = createFrameworkHandler({
    routes,
    loadRoute: async () => page,
    loadPage: async () => ({ renderWithState: (props) => ({
      html: `<h1>${(props.data as { id: number }).id}</h1>`,
      state: {},
    }) }),
  });
  const good = await handler(new Request("https://example.test/users/42?tab=profile"));
  const html = await good.text();
  assert.equal(good.status, 200);
  assert.match(html, /<title>User 42<\/title>/);
  assert.match(html, /"sharedState":\{"user":42\}/);
  assert.equal(calls, 1);
  const navigation = await handler(new Request("https://example.test/users/42?tab=profile", { headers: { accept: "application/meeko+json" } }));
  assert.equal(navigation.headers.get("content-type"), "application/meeko+json; charset=utf-8");
  const payload = await navigation.json() as { route: string; props: { data: { id: number } }; sharedState: { user: number } };
  assert.equal(payload.route, "/users/[id]");
  assert.equal(payload.props.data.id, 42);
  assert.equal(payload.sharedState.user, 42);
  const badParams = await handler(new Request("https://example.test/users/nope?tab=profile"));
  assert.equal(badParams.status, 400);
  assert.equal(await badParams.text(), "INVALID_PARAMS");
  const badSearch = await handler(new Request("https://example.test/users/42?tab=wrong"));
  assert.equal(badSearch.status, 400);
  assert.equal(await badSearch.text(), "INVALID_SEARCH");
  assert.equal(calls, 2);
});
