import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { meeko } from "../src/vite.ts";

test("Vite carga el mismo componente .meeko en el entorno SSR", async () => {
  const server = await createServer({
    configFile: false,
    plugins: [meeko()],
    server: { middlewareMode: true },
  });
  try {
    const filename = resolve("examples/counter/Counter.meeko");
    const module = await server.ssrLoadModule(filename) as { renderToString: (props: { initial: number }) => string; css: string };
    assert.match(module.renderToString({ initial: 4 }), /meeko:text:0-->4/);
    assert.match(module.css, /data-meeko-s-/);
  } finally {
    await server.close();
  }
});
