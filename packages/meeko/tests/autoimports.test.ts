import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyAutoImports, compileWithAutoImports, discoverAutoImports } from "../src/autoimports.ts";
import { checkSource } from "../src/check.ts";

test("definePage and the server definitions are autoimported where they run", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-imports-"));
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    const registry = await discoverAutoImports(root);
    const page = applyAutoImports("export const route = definePage({ render: \"ssr\" });", join(root, "app", "pages", "index.meeko"), registry, "server");
    assert.match(page, /import \{ definePage as definePage \} from "@meekojs\/meeko\/framework"/);
    const endpoint = applyAutoImports("export default defineApiRoute({ handler: () => { throw new ApiError(\"NOPE\", 400); } });", join(root, "server", "api", "ping.get.ts"), registry, "server");
    assert.match(endpoint, /import \{ defineApiRoute as defineApiRoute \} from "@meekojs\/meeko\/server"/);
    assert.match(endpoint, /import \{ ApiError as ApiError \} from "@meekojs\/meeko\/server"/);
    // The server definitions never reach browser code.
    assert.throws(() => applyAutoImports("defineApiRoute({});", join(root, "app", "pages", "index.meeko"), registry, "client"), /defineApiRoute/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("app/types exports are autoimported as types in the app, not in shared/", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-imports-"));
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    await mkdir(join(root, "app", "types"), { recursive: true });
    await writeFile(join(root, "app", "types", "variants.ts"), "export type ThemeColor = 'gray' | 'accent';\nexport interface ThemeOptions { color: ThemeColor }\n");
    const registry = await discoverAutoImports(root);
    const page = join(root, "app", "pages", "index.meeko");
    for (const target of ["client", "server"] as const) {
      const code = applyAutoImports("const color: ThemeColor = 'gray'; const options: ThemeOptions = { color };", page, registry, target);
      assert.match(code, /import type \{ ThemeColor as ThemeColor \} from "\.\.\/types\/variants\.js"/);
      assert.match(code, /import type \{ ThemeOptions as ThemeOptions \}/);
    }
    assert.throws(() => applyAutoImports("type Color = ThemeColor;", join(root, "shared", "utils", "color.ts"), registry, "shared"), /ThemeColor/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("autoimports discover nested exports and enforce client/server scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-imports-"));
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await mkdir(join(root, "app", "utils"), { recursive: true });
    await mkdir(join(root, "app", "components", "users"), { recursive: true });
    await mkdir(join(root, "server", "utils"), { recursive: true });
    await writeFile(join(root, "app", "composables", "count.ts"), "export function useCount() { return 1 }\nexport type Count = number;");
    await writeFile(join(root, "app", "composables", "browser.client.ts"), "export const browserOnly = 1;");
    await writeFile(join(root, "app", "utils", "format.ts"), [
      "export function format(value: string): string;",
      "export function format(value: number): number;",
      "export function format(value: string | number): string | number { return value; }",
    ].join("\n"));
    await writeFile(join(root, "app", "components", "users", "Card.meeko"), "<script lang=\"ts\"></script><template><p>Card</p></template>");
    await writeFile(join(root, "server", "utils", "secret.ts"), "export const secret = 1;");
    const registry = await discoverAutoImports(root);
    assert.equal(registry.filter((entry) => entry.name === "format").length, 1);
    assert.ok(registry.some((entry) => entry.name === "UsersCard" && entry.component));
    const filename = join(root, "app", "pages", "index.meeko");
    const code = applyAutoImports("const value = useCount(); type Current = Count; const card = UsersCard;", filename, registry, "client");
    assert.match(code, /import \{ useCount as useCount \}/);
    assert.match(code, /import type \{ Count as Count \}/);
    assert.match(code, /import \* as UsersCard/);
    const ssrCode = applyAutoImports("const count = useCount(); const card = UsersCard;", filename, registry, "server");
    assert.match(ssrCode, /import \{ useCount as useCount \}/);
    assert.match(ssrCode, /import \* as UsersCard/);
    assert.throws(() => applyAutoImports("browserOnly;", filename, registry, "server"), /no está disponible en el ámbito server/);
    assert.doesNotMatch(applyAutoImports('import { useCount } from "../composables/count.js"; useCount();', filename, registry, "client"), /as useCount/);
    assert.doesNotMatch(applyAutoImports('const useCount = () => 2; useCount();', filename, registry, "client"), /as useCount/);
    assert.match(applyAutoImports('function inner() { const useCount = () => 2; return useCount(); } const outer = useCount();', filename, registry, "client"), /as useCount/);
    // Labels name no value, and the clauses of a `switch` share a scope of their own.
    assert.doesNotMatch(applyAutoImports("useCount: for (const n of [1]) { if (n) continue useCount; break useCount; }", filename, registry, "client"), /as useCount/);
    assert.doesNotMatch(applyAutoImports("switch (1) { case 1: const useCount = () => 2; useCount(); }", filename, registry, "client"), /as useCount/);
    assert.match(applyAutoImports("switch (1) { case 1: const useCount = () => 2; } const outer = useCount();", filename, registry, "client"), /as useCount/);
    assert.throws(() => applyAutoImports("secret;", filename, registry, "client"), /no está disponible en el ámbito client/);
    assert.match(applyAutoImports("secret;", filename, registry, "server"), /secret\.js/);
    assert.match(applyAutoImports("const state = signal(0);", filename, registry, "client"), /from "@meekojs\/meeko"/);
    assert.match(applyAutoImports("provideErrorHandler((error) => console.error(error));", filename, registry, "client"), /import \{ provideErrorHandler as provideErrorHandler \} from "@meekojs\/meeko"/);
    assert.match(applyAutoImports("const key = untrack(() => 1);", filename, registry, "client"), /import \{ untrack as untrack \} from "@meekojs\/meeko"/);
    // Without generated clients, `useSocket` resolves to `useSocketClient`, not to its deprecated alias.
    assert.equal(registry.filter((entry) => entry.name === "useSocket").length, 1);
    assert.match(applyAutoImports('const chat = useSocket("ws://example.test/chat", contract);', filename, registry, "client"), /import \{ useSocketClient as useSocket \} from "@meekojs\/meeko\/framework"/);
    assert.match(applyAutoImports('const value = format("value");', join(root, "app", "pages", "typed.ts"), registry, "client"), /import \{ format as format \}/);
    const component = '<script lang="ts">const count = useCount();</script><template><p>{count}</p></template>';
    const compiled = await compileWithAutoImports(component, filename);
    assert.match(compiled.code, /import \{ useCount as useCount \} from "\.\.\/composables\/count\.js"/);
    assert.ok(compiled.mappings.every((mapping) => mapping.generatedStart >= compiled.code.indexOf("// Generated by Meeko")));
    const overloadedComponent = '<script lang="ts">const value = format("value");</script><template><p>{value}</p></template>';
    const overloaded = await compileWithAutoImports(overloadedComponent, filename);
    assert.match(overloaded.code, /import \{ format as format \}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI type checking resolves built-in autoimports without globals", async () => {
  const source = '<script lang="ts">const count = signal(1);</script><template>{count.value}</template>';
  const diagnostics = await checkSource(source, join(process.cwd(), "examples", "counter", "AutoimportCheck.meeko"));
  assert.deepEqual(diagnostics, []);
});

test("component error observer autoimport keeps its error argument typed", async () => {
  const filename = join(process.cwd(), "examples", "counter", "ErrorObserverCheck.meeko");
  const valid = '<script lang="ts">provideErrorHandler((error) => { const value: unknown = error; void value; });</script><template><button>Run</button></template>';
  assert.deepEqual(await checkSource(valid, filename), []);
  const invalid = '<script lang="ts">provideErrorHandler((error: string) => { void error; });</script><template><button>Run</button></template>';
  const diagnostics = await checkSource(invalid, filename);
  assert.ok(diagnostics.some((diagnostic) => /ComponentErrorHandler|unknown/.test(diagnostic.message)), JSON.stringify(diagnostics));
});
