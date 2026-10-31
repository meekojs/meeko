import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createI18n } from "../dist/index.js";
import { compileCatalog, messageParameters } from "../dist/messages.js";

test("runtime compiles placeholders and plurals", () => {
  const catalog = compileCatalog({ hello: "Hola {name}", items: { plural: "count", forms: { one: "{count} elemento", other: "{count} elementos" } } }, "es.json");
  const i18n = createI18n("es", catalog, ["es"], () => {}, () => "/es");
  assert.equal(i18n.t("hello", { name: "Meeko" }), "Hola Meeko");
  assert.equal(i18n.t("items", { count: 2 }), "2 elementos");
});

test("message contracts infer selectors, all branches and numeric plural arguments", () => {
  const catalog = compileCatalog({
    plain: "Ready", hello: "Hola {name}",
    items: { plural: "total", forms: { one: "{owner}: {count} item", other: "{owner}: {count} items" } },
    invite: { select: "gender", forms: { other: "Invite {name}", female: "Invite {name}" } },
  }, "es.json");
  assert.deepEqual(messageParameters(catalog.plain), {});
  assert.deepEqual(messageParameters(catalog.hello), { name: "value" });
  assert.deepEqual(messageParameters(catalog.items), { owner: "value", total: "number" });
  assert.deepEqual(messageParameters(catalog.invite), { gender: "value", name: "value" });
});

test("consumer types require the generated parameters and reject incorrect plural values", async () => {
  const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
  await promisify(execFile)(process.execPath, [tsc, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--module", "nodenext", "--target", "es2022", fileURLToPath(new URL("./types/consumer.ts", import.meta.url))], { windowsHide: true });
});

test("external module generates typed keys, builds SSR, and removes its types when disabled", async () => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const temporary = join(packageRoot, ".meeko", "tests");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(join(temporary, "consumer-"));
  const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("@meekojs/meeko")));
  async function put(path, contents) { const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, contents); }
  async function run(command) { return promisify(execFile)(process.execPath, [cli, command, root], { cwd: packageRoot, windowsHide: true }); }
  try {
    await put("package.json", '{"type":"module","private":true}');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(packageRoot, join(root, "node_modules", "@meekojs", "i18n"), "junction");
    await put("meeko.config.mjs", 'export default { modules: [["@meekojs/i18n/module", { defaultLocale: "es", catalogs: { es: "es.json" } }]] };');
    await put("es.json", '{"hello":"Hola {name}"}');
    await put("app/pages/index.meeko", '<script lang="ts">const { t } = useI18n();</script><template><h1>{t("hello", { name: "Meeko" })}</h1></template>');
    await run("check");
    for (const expression of ['t("hello")', 't("hello", {})', 't("hello", { name: null })']) {
      await put("app/pages/index.meeko", `<script lang="ts">const { t } = useI18n();</script><template><h1>{${expression}}</h1></template>`);
      await assert.rejects(run("check"), /TS\d+/);
    }
    await put("app/pages/index.meeko", '<script lang="ts">const { t } = useI18n();</script><template><h1>{t("unknown")}</h1></template>');
    await assert.rejects(run("check"), /unknown/);
    await put("app/pages/index.meeko", '<script lang="ts">const { t } = useI18n();</script><template><h1>{t("hello", { name: "Meeko" })}</h1></template>');
    await run("build");
    const types = join(root, ".meeko", "types", "modules", "%40meekojs%2Fi18n", "messages.d.ts");
    assert.match(await readFile(types, "utf8"), /hello/);
    assert.match(await readFile(types, "utf8"), /readonly "name"/);
    await put("en.json", '{"hello":"Hello {user}"}');
    await put("meeko.config.mjs", 'export default { modules: [["@meekojs/i18n/module", { defaultLocale: "es", catalogs: { es: "es.json", en: "en.json" } }]] };');
    await assert.rejects(run("check"), /different parameters/);
    await put("meeko.config.mjs", 'export default {};');
    await put("app/pages/index.meeko", '<template><h1>Ready</h1></template>');
    await run("check");
    await assert.rejects(readFile(types), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
