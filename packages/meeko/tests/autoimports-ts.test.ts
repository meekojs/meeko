import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { discoverAutoImports } from "../src/autoimports.ts";
import { generateAutoImportTypes, transformTypeScriptAutoImports, typeScriptAutoImportMap, typeScriptScope } from "../src/autoimports-ts.ts";

test("TS autoimports generate isolated client/server/shared declarations and transform real imports", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/autoimports-ts-test-"));
  const files = {
    "app/composables/count.ts": "export function useCount(): number { return 1; }",
    "app/composables/browser.client.ts": "export const browserOnly = 1;",
    "app/composables/loader.server.ts": "export const serverOnly = 1;",
    "shared/types/labels.ts": "export type Label = string;",
    "shared/internal/box.ts": 'interface Hidden { id: string }\ntype HiddenDefault = Hidden & { kind: "default" };\nexport type Box<T extends Hidden = HiddenDefault> = { value: T };',
    "shared/types/box.ts": 'export type { Box } from "../internal/box.js";',
    "server/utils/secret.ts": "export function getSecret(): string { return 'private'; }",
  };
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }
  try {
    const output = await generateAutoImportTypes(root);
    const client = await readFile(output.client, "utf8");
    const server = await readFile(output.server, "utf8");
    const shared = await readFile(output.shared, "utf8");
    assert.match(client, /const useCount: typeof import/);
    assert.match(client, /const browserOnly: typeof import/);
    assert.doesNotMatch(client, /serverOnly/);
    assert.match(client, /export import Label = __meeko_type_\d+\.Label/);
    assert.match(client, /export import Box = __meeko_type_\d+\.Box/);
    assert.doesNotMatch(client, /T extends Hidden|HiddenDefault/);
    assert.doesNotMatch(client, /getSecret/);
    assert.match(server, /const getSecret: typeof import/);
    assert.match(server, /const useCount: typeof import/);
    assert.match(server, /const serverOnly: typeof import/);
    assert.doesNotMatch(server, /browserOnly/);
    assert.doesNotMatch(shared, /useCount|getSecret|browserOnly|serverOnly/);
    const registry = await discoverAutoImports(root);
    const page = join(root, "app", "pages", "index.ts");
    const code = transformTypeScriptAutoImports("const count = useCount(); type Name = Label;", page, root, registry);
    assert.match(code ?? "", /import \{ useCount as useCount \}/);
    assert.match(code ?? "", /import type \{ Label as Label \}/);
    assert.equal(typeScriptAutoImportMap("const count = useCount(); type Name = Label;", code!, page).sources[0], page);
    const explicit = transformTypeScriptAutoImports('import { useCount } from "../composables/count.js"; useCount();', page, root, registry);
    assert.equal(explicit, undefined);
    assert.throws(() => transformTypeScriptAutoImports("getSecret();", page, root, registry), /no está disponible en el ámbito client/);
    assert.throws(() => transformTypeScriptAutoImports("useCount();", join(root, "shared", "utils", "worker.ts"), root, registry), /no está disponible en el ámbito shared/);
    assert.match(transformTypeScriptAutoImports("useCount();", join(root, "app", "pages", "page.server.ts"), root, registry) ?? "", /import \{ useCount as useCount \}/);
    assert.throws(() => transformTypeScriptAutoImports("browserOnly();", join(root, "app", "pages", "page.server.ts"), root, registry), /no está disponible en el ámbito server/);
    assert.equal(typeScriptScope(root, join(root, "app", "pages", "page.test.ts")), undefined);
    assert.equal(typeScriptScope(root, join(root, "app", "pages", "page.server.ts")), "server");
    const sidecar = join(root, "app", "pages", "users", "index.route.ts");
    assert.equal(typeScriptScope(root, sidecar), "server");
    assert.match(transformTypeScriptAutoImports("getSecret();", sidecar, root, registry) ?? "", /import \{ getSecret as getSecret \}/);
    assert.equal(typeScriptScope(root, join(root, "app", "pages", "page.shared.ts")), "shared");
    const consumer = join(root, "consumer.ts");
    await writeFile(consumer, `const count: number = useCount();\nconst label: Label = "ok";\nconst box: Box<{ id: string; extra: number }> = { value: { id: "ok", extra: 1 } };\nconst defaultBox: Box = { value: { id: "ok", kind: "default" } };\n// @ts-expect-error the private re-exported generic constraint must remain intact\nconst invalidBox: Box<number> = { value: 1 };\nvoid count; void label; void box; void defaultBox; void invalidBox;\n`);
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, skipLibCheck: false, noEmit: true,
    }, files: [consumer, output.client] }));
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.json")]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TS autoimport declarations reject name collisions in the same scope", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/autoimports-collision-test-"));
  try {
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await mkdir(join(root, "shared", "utils"), { recursive: true });
    await writeFile(join(root, "app", "composables", "first.ts"), "export const duplicate = 1;");
    await writeFile(join(root, "shared", "utils", "second.ts"), "export const duplicate = 2;");
    await assert.rejects(generateAutoImportTypes(root), /Autoimport ambiguo duplicate en el ámbito client/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configured layers and modules transform TypeScript in their own scopes", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/autoimports-sources-test-"));
  try {
    await writeFile(join(root, "meeko.config.ts"), 'export default { extends: ["./layers/base"], modules: ["./modules/auth"] };\n');
    for (const source of ["layers/base", "modules/auth"]) {
      await mkdir(join(root, source, "app", "pages"), { recursive: true });
    }
    const layerUtility = join(root, "layers", "base", "app", "composables", "counter.ts");
    const moduleUtility = join(root, "modules", "auth", "server", "utils", "secret.ts");
    await mkdir(dirname(layerUtility), { recursive: true });
    await mkdir(dirname(moduleUtility), { recursive: true });
    await writeFile(layerUtility, "export function layerCount(): number { return 1; }\n");
    await writeFile(moduleUtility, "export function moduleSecret(): string { return 'private'; }\n");
    const registry = await discoverAutoImports(root);
    const layerPage = join(root, "layers", "base", "app", "pages", "example.ts");
    const moduleServer = join(root, "modules", "auth", "server", "utils", "worker.ts");
    assert.equal(typeScriptScope(root, layerPage), "client");
    assert.equal(typeScriptScope(root, moduleServer), "server");
    assert.equal(typeScriptScope(root, join(root, "layers", "base", "app", "pages", "example.server.ts")), "server");
    assert.equal(typeScriptScope(root, join(root, "unconfigured", "app", "page.ts")), undefined);
    assert.match(transformTypeScriptAutoImports("layerCount();", layerPage, root, registry) ?? "", /import \{ layerCount as layerCount \}/);
    assert.match(transformTypeScriptAutoImports("moduleSecret();", moduleServer, root, registry) ?? "", /import \{ moduleSecret as moduleSecret \}/);
    assert.throws(() => transformTypeScriptAutoImports("moduleSecret();", layerPage, root, registry), /no está disponible en el ámbito client/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plain app/ TypeScript resolves framework clients per graph; .client.ts stays in the browser", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/autoimports-ssr-test-"));
  try {
    const generated = join(root, ".meeko", "generated");
    await mkdir(generated, { recursive: true });
    for (const scope of ["client", "server"]) {
      await writeFile(join(generated, `clients.${scope}.ts`), "export const api = {}; export const rpc = {}; export const socket = {};\nexport const useSocket = () => undefined; export const useApi = () => undefined;\nexport const useRpcQuery = () => undefined; export const useRpcMutation = () => undefined;\n");
    }
    await mkdir(join(root, "server", "utils"), { recursive: true });
    await writeFile(join(root, "server", "utils", "secret.ts"), "export function getSecret(): string { return 'private'; }\n");
    const registry = await discoverAutoImports(root);
    const source = "export function useEcho() { const channel = useSocket('echo'); return { channel, load: () => api.greeting.get() }; }\n";
    for (const folder of ["composables", "utils", "stores", "components"]) {
      const file = join(root, "app", folder, "useEcho.ts");
      assert.equal(typeScriptScope(root, file), "client");
      const browser = transformTypeScriptAutoImports(source, file, root, registry) ?? "";
      assert.match(browser, /import \{ useSocket as useSocket \} from "\.\.\/\.\.\/\.meeko\/generated\/clients\.client\.js";/);
      assert.match(browser, /import \{ api as api \} from "\.\.\/\.\.\/\.meeko\/generated\/clients\.client\.js";/);
      const ssr = transformTypeScriptAutoImports(source, file, root, registry, undefined, undefined, true) ?? "";
      assert.match(ssr, /import \{ useSocket as useSocket \} from "\.\.\/\.\.\/\.meeko\/generated\/clients\.server\.js";/);
      assert.match(ssr, /import \{ api as api \} from "\.\.\/\.\.\/\.meeko\/generated\/clients\.server\.js";/);
      // Server-only autoimports stay unavailable in the SSR graph, as in the browser.
      assert.throws(() => transformTypeScriptAutoImports("getSecret();", file, root, registry, undefined, undefined, true), /no está disponible en el ámbito client/);
    }
    // A .client.ts module only ever uses the browser client; Vite keeps it out of the SSR graph.
    const browserOnly = join(root, "app", "composables", "socket.client.ts");
    assert.match(transformTypeScriptAutoImports(source, browserOnly, root, registry, undefined, undefined, true) ?? "", /clients\.client\.js/);
    // .server.ts and route sidecars keep the server client in either graph.
    const serverOnly = join(root, "app", "composables", "loader.server.ts");
    assert.match(transformTypeScriptAutoImports(source, serverOnly, root, registry) ?? "", /clients\.server\.js/);
    // An explicit scope (a render: "client" sidecar) wins over the graph.
    assert.match(transformTypeScriptAutoImports(source, join(root, "app", "pages", "index.route.ts"), root, registry, undefined, "client", true) ?? "", /clients\.client\.js/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
