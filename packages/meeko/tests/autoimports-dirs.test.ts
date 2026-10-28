import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { applyAutoImports, autoImportDirectories, discoverAutoImports, discoverAutoImportsSync } from "../src/autoimports.ts";
import type { AutoImport } from "../src/autoimports.ts";
import { generateAutoImportTypes } from "../src/autoimports-ts.ts";
import { loadMeekoConfig, readMeekoConfigSync } from "../src/framework/config.ts";
import { configErrorRange } from "../src/language-server/diagnostics.ts";
import { meeko } from "../src/vite.ts";

async function put(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
}

async function temporary(prefix: string, files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await put(root, { "package.json": '{"private":true,"type":"module"}\n', ...files });
  return root;
}

const configured = `export default {
  extends: ["./layers/base"],
  imports: {
    appDirs: ["app/services", "app/services/", "app\\\\features\\\\cart", "app/composables", "app/services/nested"],
    sharedDirs: ["shared/validators"],
    serverDirs: ["server/services"],
  },
};
`;

const projectFiles: Record<string, string> = {
  "meeko.config.ts": configured,
  "app/services/price.ts": "export function formatPrice(value: number): string { return `$${value}`; }\nexport type Currency = \"USD\" | \"EUR\";\nexport interface PriceOptions { currency: Currency }\nexport enum Rounding { Up, Down }\n",
  "app/services/nested/deep/tax.ts": "export const taxRate = 0.21;\n",
  "app/services/browser.client.ts": "export const onlyBrowser = true;\n",
  "app/services/secret.server.ts": "export const serviceSecret = \"s\";\n",
  "app/services/both.shared.ts": "export const fromAppShared = 1;\n",
  "app/services/route.ts": "export function useRoute(): string { return \"own\"; }\n",
  "app/services/price.test.ts": "export const fromTest = 1;\n",
  "app/services/price.spec.ts": "export const fromSpec = 1;\n",
  "app/services/ambient.d.ts": "export declare const fromDeclaration: number;\n",
  "app/services/Widget.meeko": '<script lang="ts"></script><template><p>Widget</p></template>\n',
  "app/features/cart/cart.ts": "export function useCart(): string[] { return []; }\n",
  "app/composables/count.ts": "export function useCount(): number { return 1; }\n",
  "shared/validators/email.ts": "export function isEmail(value: string): boolean { return value.includes(\"@\"); }\n",
  "shared/validators/browser.client.ts": "export const sharedBrowser = 1;\n",
  "server/services/users.ts": "export const findUsers = () => [];\n",
  "layers/base/app/pages/layer.meeko": '<script lang="ts"></script><template><p>Layer</p></template>\n',
  "layers/base/app/services/layer.ts": "export const layerService = 1;\n",
  "layers/base/shared/validators/layer.ts": "export const layerValidator = 1;\n",
};

function summary(registry: readonly AutoImport[], root: string): Map<string, string> {
  return new Map(registry.filter((entry) => !entry.specifier && !entry.file.includes(".meeko"))
    .map((entry) => [entry.name, `${entry.scope}:${entry.typeOnly ? "type" : "value"}:${entry.file.slice(root.length + 1).replaceAll("\\", "/")}`]));
}

test("imports.appDirs and sharedDirs autoimport their exports with the scope of app/ and shared/", async () => {
  const root = await temporary("meeko-import-dirs-", projectFiles);
  try {
    const registry = await discoverAutoImports(root);
    const found = summary(registry, root);
    assert.equal(found.get("formatPrice"), "app:value:app/services/price.ts");
    assert.equal(found.get("Currency"), "app:type:app/services/price.ts");
    assert.equal(found.get("PriceOptions"), "app:type:app/services/price.ts");
    assert.equal(found.get("Rounding"), "app:value:app/services/price.ts");
    assert.equal(found.get("taxRate"), "app:value:app/services/nested/deep/tax.ts");
    assert.equal(found.get("onlyBrowser"), "client:value:app/services/browser.client.ts");
    assert.equal(found.get("serviceSecret"), "server:value:app/services/secret.server.ts");
    assert.equal(found.get("fromAppShared"), "shared:value:app/services/both.shared.ts");
    assert.equal(found.get("useCart"), "app:value:app/features/cart/cart.ts");
    assert.equal(found.get("isEmail"), "shared:value:shared/validators/email.ts");
    assert.equal(found.get("sharedBrowser"), "client:value:shared/validators/browser.client.ts");
    assert.equal(found.get("findUsers"), "server:value:server/services/users.ts");
    // The folders apply inside each layer too.
    assert.equal(found.get("layerService"), "app:value:layers/base/app/services/layer.ts");
    assert.equal(found.get("layerValidator"), "shared:value:layers/base/shared/validators/layer.ts");
    for (const name of ["fromTest", "fromSpec", "fromDeclaration", "Widget", "ServicesWidget"]) assert.equal(found.has(name), false, name);
    assert.equal(registry.some((entry) => entry.component && entry.file.endsWith("Widget.meeko")), false);
    // A folder repeated, nested in another one or equal to a default one reads its files once.
    for (const name of ["formatPrice", "taxRate", "useCount"]) assert.equal(registry.filter((entry) => entry.name === name).length, 1, name);
    // The project's export wins over the framework's.
    assert.deepEqual(registry.filter((entry) => entry.name === "useRoute").map((entry) => entry.specifier ?? "own"), ["own"]);

    // The editor's static registry reads the same folders.
    assert.deepEqual(summary(discoverAutoImportsSync(root), root), found);

    const page = join(root, "app", "pages", "index.meeko");
    for (const target of ["client", "server"] as const) {
      const code = applyAutoImports("const price: Currency = \"USD\"; formatPrice(1); isEmail(\"a\"); taxRate;", page, registry, target);
      assert.match(code, /import \{ formatPrice as formatPrice \} from "\.\.\/services\/price\.js"/);
      assert.match(code, /import type \{ Currency as Currency \} from "\.\.\/services\/price\.js"/);
      assert.match(code, /import \{ isEmail as isEmail \} from "\.\.\/\.\.\/shared\/validators\/email\.js"/);
      assert.match(code, /from "\.\.\/services\/nested\/deep\/tax\.js"/);
    }
    const endpoint = join(root, "server", "api", "signup.post.ts");
    assert.match(applyAutoImports("isEmail(\"a\"); findUsers();", endpoint, registry, "server"), /shared\/validators\/email\.js/);
    assert.match(applyAutoImports("isEmail(\"a\");", join(root, "shared", "utils", "check.ts"), registry, "shared"), /\.\.\/validators\/email\.js/);
    // app/ folders are not available to shared/; suffixes keep their environment.
    assert.throws(() => applyAutoImports("formatPrice(1);", join(root, "shared", "utils", "check.ts"), registry, "shared"), /formatPrice no está disponible en el ámbito shared/);
    assert.throws(() => applyAutoImports("serviceSecret;", page, registry, "client"), /serviceSecret no está disponible en el ámbito client/);
    assert.throws(() => applyAutoImports("onlyBrowser;", page, registry, "server"), /onlyBrowser no está disponible en el ámbito server/);
    assert.throws(() => applyAutoImports("findUsers();", page, registry, "client"), /findUsers no está disponible en el ámbito client/);

    // Two folders exporting one name collide as with the default folders.
    await put(root, { "shared/validators/price.ts": "export const formatPrice = (value: number) => String(value);\n" });
    const colliding = await discoverAutoImports(root);
    assert.throws(() => applyAutoImports("formatPrice(1);", page, colliding, "client"), /Autoimport ambiguo formatPrice: .*price\.ts, .*price\.ts/);
    await assert.rejects(generateAutoImportTypes(root), /Autoimport ambiguo formatPrice en el ámbito client/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("imports folders only accept relative paths inside their own source folder", async () => {
  assert.deepEqual(autoImportDirectories({ appDirs: ["app\\services\\", "app/components", "app/components/ui"], sharedDirs: ["shared/validators"] }).slice(-2), ["app/services", "shared/validators"]);
  const invalid: Array<[string, string, string]> = [
    ["appDirs", "shared/validators", "app/"], ["appDirs", "app", "app/"], ["appDirs", "../app/services", "app/"],
    ["appDirs", "app/../server/db", "app/"], ["appDirs", "/app/services", "app/"], ["appDirs", "app/./services", "app/"],
    ["sharedDirs", "app/services", "shared/"], ["sharedDirs", "shared//x", "shared/"], ["serverDirs", "shared/x", "server/"],
  ];
  for (const [option, path, inside] of invalid) {
    assert.throws(() => autoImportDirectories({ [option]: [path] }), new RegExp(`imports\\.${option} de autoimports debe ser una ruta relativa dentro de ${inside}`), path);
    const root = await temporary("meeko-import-dirs-invalid-", {
      "meeko.config.ts": `export default { imports: { ${option}: ["app/ok", ${JSON.stringify(path)}].slice(${option === "appDirs" ? 0 : 1}) } };\n`,
    });
    try {
      const index = option === "appDirs" ? 1 : 0;
      const message = `imports.${option}[${index}] must be a relative path inside ${inside}: ${path}`;
      await assert.rejects(loadMeekoConfig(root), (error: Error) => error instanceof TypeError && error.message.endsWith(`meeko.config.ts: ${message}`));
      await assert.rejects(discoverAutoImports(root), /must be a relative path inside/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const root = await temporary("meeko-import-dirs-range-", {
    "meeko.config.ts": 'export default {\n  imports: { appDirs: ["app/ok", "shared/wrong"], sharedDirs: "shared/x" },\n};\n',
  });
  try {
    await assert.rejects(loadMeekoConfig(root), /imports\.sharedDirs must be an array of nonempty paths/);
    const text = 'export default {\n  imports: { appDirs: ["app/ok", "shared/wrong"] },\n};\n';
    await writeFile(join(root, "meeko.config.ts"), text);
    // The editor marks the entry itself, as MEEK_CONFIG.
    const failure = await loadMeekoConfig(root).then(() => undefined, (error: Error) => error.message);
    const detail = failure!.slice(failure!.indexOf("meeko.config.ts: ") + "meeko.config.ts: ".length);
    const [start, end] = configErrorRange(text, join(root, "meeko.config.ts"), detail);
    assert.equal(text.slice(start, end), '"shared/wrong"');
    await writeFile(join(root, "meeko.config.ts"), "export default { imports: [] };\n");
    await assert.rejects(loadMeekoConfig(root), /imports must be an object/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the static config reader returns appDirs and sharedDirs for the editor", async () => {
  const root = await temporary("meeko-import-dirs-static-", {
    "meeko.config.ts": 'import { defineMeekoConfig } from "@meekojs/meeko/framework";\nexport default defineMeekoConfig({ imports: { appDirs: ["app/services"], sharedDirs: ["shared/validators"] } });\n',
  });
  try {
    assert.deepEqual(readMeekoConfigSync(root).imports, { appDirs: ["app/services"], sharedDirs: ["shared/validators"] });
    await writeFile(join(root, "meeko.config.ts"), "const dirs = [\"app/services\"];\nexport default { imports: { appDirs: dirs } };\n");
    assert.throws(() => readMeekoConfigSync(root), /appDirs must be a static string array/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("meeko dev reloads when a file of an imports folder changes, is added or is removed", async () => {
  const root = await temporary("meeko-import-dirs-dev-", {
    "meeko.config.ts": 'export default { imports: { appDirs: ["app/services"], sharedDirs: ["shared/validators"] } };\n',
    "app/pages/index.meeko": '<script lang="ts"></script><template><p>Home</p></template>\n',
  });
  try {
    const plugin = meeko();
    (plugin.configResolved as (config: unknown) => void)({ command: "serve", build: {}, root });
    const sent: unknown[] = [];
    let invalidated = 0;
    const listeners = new Map<string, (file: string) => void>();
    const server = {
      moduleGraph: { invalidateAll: () => { invalidated++; } },
      ws: { send: (message: unknown) => { sent.push(message); } },
      watcher: { on: (event: string, listener: (file: string) => void) => { listeners.set(event, listener); } },
      config: { logger: { error: (message: string) => { throw new Error(message); } } },
    };
    const hotUpdate = plugin.handleHotUpdate as unknown as (context: { file: string; server: typeof server }) => Promise<unknown>;
    for (const file of ["app/services/price.ts", "app/services/nested/tax.ts", "shared/validators/email.ts"]) {
      assert.deepEqual(await hotUpdate({ file: join(root, file), server }), [], file);
    }
    assert.equal(await hotUpdate({ file: join(root, "app", "other", "price.ts"), server }), undefined);
    assert.equal(invalidated, 3);
    (plugin.configureServer as (server: unknown) => void)(server);
    listeners.get("add")!(join(root, "app", "services", "fresh.ts"));
    listeners.get("unlink")!(join(root, "shared", "validators", "gone.ts"));
    const deadline = Date.now() + 10_000;
    while (invalidated < 5 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
    assert.equal(invalidated, 5);
    assert.deepEqual(sent.at(-1), { type: "full-reload" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
