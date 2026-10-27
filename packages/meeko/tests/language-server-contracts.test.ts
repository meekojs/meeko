import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { checkFrameworkPageContracts } from "../src/framework/page-contracts-check.ts";
import { createEditorModel } from "../src/language-server/model.ts";

test("project contract errors point to defineProps in the source component", async () => {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "editor-contract-"));
  try {
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await mkdir(join(root, "app", "layouts"), { recursive: true });
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await writeFile(join(root, "app", "pages", "index.meeko"), "<script lang=\"ts\"></script><template><p>Home</p></template>\n");
    const file = join(root, "app", "layouts", "default.meeko");
    const source = '<script lang="ts">const props = defineProps<{ outlet: object; missing: string }>();</script><template><p>Shell</p></template>\n';
    await writeFile(file, source);
    const model = createEditorModel(source, file);
    try {
      assert.deepEqual(model.service.getSemanticDiagnostics(model.virtualFilename).map((item) => item.code), []);
    } finally { model.dispose(); }
    const errors = await checkFrameworkPageContracts(root);
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.equal(errors[0]!.filename, file);
    assert.equal(errors[0]!.code, "MEEK_LAYOUT_PROPS");
    assert.equal(errors[0]!.offset, source.indexOf("{ outlet:"));
    assert.match(errors[0]!.message, /Las props del layout app\/layouts\/default\.meeko no coinciden/);
    await writeFile(file, source.replace("; missing: string", ""));
    assert.deepEqual(await checkFrameworkPageContracts(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("page contract check follows a type imported by its route sidecar", async () => {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "editor-contract-dependency-"));
  try {
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await writeFile(join(root, "contract-data.ts"), "export type Data = string;\n");
    const page = join(root, "app", "pages", "index.meeko");
    const source = '<script lang="ts">const props = defineProps<{ data: string }>();</script><template>{props.data}</template>\n';
    await writeFile(page, source);
    await writeFile(join(root, "app", "pages", "index.route.ts"), `import { definePage } from "@meekojs/meeko/framework";
import type { Data } from "../../contract-data.js";
export const route = definePage({ load: (): Data => null as unknown as Data });
`);
    assert.deepEqual(await checkFrameworkPageContracts(root), []);
    await writeFile(join(root, "contract-data.ts"), "export type Data = number;\n");
    const errors = await checkFrameworkPageContracts(root);
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.equal(errors[0]!.code, "MEEK_PAGE_PROPS");
    assert.equal(errors[0]!.filename, page);
  } finally { await rm(root, { recursive: true, force: true }); }
});
