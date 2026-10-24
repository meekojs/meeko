import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const transformed = await server.transformRequest(filename, { ssr: true });
    assert.ok(transformed?.map && "sources" in transformed.map && transformed.map.sources.some((source) => source.endsWith("Counter.meeko")));
    const marker = transformed?.code.indexOf("doubled.value") ?? -1;
    assert.ok(marker >= 0);
    const prior = transformed!.code.slice(0, marker).split("\n");
    assert.equal(mappedLine(transformed!.map!.mappings, prior.length, prior.at(-1)!.length), 16);
    const module = await server.ssrLoadModule(filename) as { renderToString: (props: { initial: number }) => string; css: string };
    assert.match(module.renderToString({ initial: 4 }), /meeko:text:0-->4/);
    assert.match(module.css, /data-meeko-s-/);
  } finally {
    await server.close();
  }
});

function mappedLine(mappings: string, line: number, column: number): number | undefined {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let sourceLine = 0;
  for (const [index, row] of mappings.split(";").entries()) {
    let generatedColumn = 0;
    let result: number | undefined;
    for (const segment of row.split(",")) {
      if (!segment) continue;
      const values: number[] = [];
      let bits = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = alphabet.indexOf(char);
        bits |= (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else { values.push(bits & 1 ? -(bits >> 1) : bits >> 1); bits = 0; shift = 0; }
      }
      generatedColumn += values[0] ?? 0;
      if (values.length > 1) sourceLine += values[2] ?? 0;
      if (index + 1 === line && generatedColumn <= column) result = values.length > 1 ? sourceLine + 1 : undefined;
    }
    if (index + 1 === line) return result;
  }
  return undefined;
}

test("Vite rejects a transitive server import in the client graph", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-vite-boundary-"));
  await mkdir(join(root, "app"));
  await mkdir(join(root, "app", "composables"));
  await mkdir(join(root, "server"));
  await writeFile(join(root, "app", "entry.ts"), 'import { secret } from "../server/secret.js"; export const value = secret;');
  await writeFile(join(root, "app", "dynamic.ts"), 'export const load = () => import("../server/secret.js");');
  await writeFile(join(root, "app", "composables", "count.ts"), 'export const useCount = () => 1;');
  await writeFile(join(root, "app", "auto.ts"), 'export const count = useCount();');
  await writeFile(join(root, "app", "browser.client.ts"), 'export const browserOnly = true;');
  await writeFile(join(root, "server", "secret.ts"), 'export const secret = "private";');
  const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true } });
  try {
    await assert.rejects(server.transformRequest("/app/entry.ts"), /server-only module/);
    await assert.rejects(server.transformRequest("/app/dynamic.ts"), /server-only module/);
    const auto = await server.transformRequest("/app/auto.ts");
    assert.match(auto?.code ?? "", /import.*useCount/);
    await assert.rejects(server.transformRequest("/app/browser.client.ts", { ssr: true }), /Client-only module/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
