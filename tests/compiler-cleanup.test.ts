import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { meeko } from "../src/vite.ts";

test("compiled SSR keeps render errors when a cleanup also fails", async () => {
  const server = await createServer({ configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
  try {
    const component = await server.ssrLoadModule(resolve("tests/fixtures/CleanupErrors.meeko")) as {
      renderWithState(props: Record<string, never>): unknown;
      renderToString(props: Record<string, never>): string;
    };
    for (const render of [component.renderWithState, component.renderToString]) {
      assert.throws(() => render({}), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors.map((item: Error) => item.message), ["render failed", "cleanup failed"]);
        return true;
      });
    }
  } finally {
    await server.close();
  }
});
