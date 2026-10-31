import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverAutoImports } from "../src/autoimports/registry.ts";
import { applyAutoImports, compileWithAutoImports } from "../src/autoimports/transform.ts";
import { generateAutoImportTypes, transformTypeScriptAutoImports } from "../src/autoimports/typescript.ts";

test("useForm and its public types belong to component scripts and app modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-form-autoimports-"));
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    const registry = await discoverAutoImports(root);
    const page = join(root, "app", "pages", "contact.meeko");
    const source = '<script lang="ts">const form = useForm({ initial: { name: "" }, submit: async () => {} }); type Field = FormField<string>; type State = Form<{ name: string }, void>; type Result = FormSubmission<void>;</script><template><p>{form.fields.name}</p></template>';
    for (const target of ["client", "server"] as const) {
      const compiled = await compileWithAutoImports(source, page, {}, target, registry);
      assert.match(compiled.code, /import \{ useForm as useForm \} from "@meekojs\/meeko\/framework"/);
      for (const name of ["Form", "FormField", "FormSubmission"]) {
        assert.match(compiled.code, new RegExp(`import type \\{ ${name} as ${name} \\} from "@meekojs/meeko/framework"`));
      }
    }

    const appModule = join(root, "app", "composables", "contact.ts");
    const moduleSource = "const form = useForm({ initial: { name: '' }, submit: async () => {} }); type Field = FormField<string>;";
    assert.match(transformTypeScriptAutoImports(moduleSource, appModule, root, registry) ?? "", /import \{ useForm as useForm \}/);
    assert.match(transformTypeScriptAutoImports(moduleSource, appModule, root, registry, undefined, undefined, true) ?? "", /import \{ useForm as useForm \}/);

    const serverBlock = join(root, "app", "pages", "contact.route.ts");
    const serverModule = join(root, "server", "api", "contact.post.ts");
    for (const file of [serverBlock, serverModule]) {
      assert.throws(() => transformTypeScriptAutoImports("useForm({});", file, root, registry), /useForm no está disponible en el ámbito server/);
      assert.throws(() => transformTypeScriptAutoImports("type Field = FormField<string>;", file, root, registry), /FormField no está disponible en el ámbito server/);
      assert.throws(() => applyAutoImports("useForm({});", file, registry, "server"), /useForm no está disponible en el ámbito server/);
    }
    assert.throws(() => applyAutoImports("useForm({});", join(root, "shared", "utils", "contact.ts"), registry, "shared"), /useForm no está disponible en el ámbito shared/);

    const declarations = await generateAutoImportTypes(root);
    const client = await readFile(declarations.client, "utf8");
    const server = await readFile(declarations.server, "utf8");
    const shared = await readFile(declarations.shared, "utf8");
    assert.match(client, /const useForm: typeof import\("@meekojs\/meeko\/framework"\)\["useForm"\]/);
    for (const name of ["Form", "FormField", "FormSubmission"]) {
      assert.match(client, new RegExp(`type ${name}<[^>]+> = import\\("@meekojs/meeko/framework"\\)\\.${name}<[^>]+>;`));
      assert.doesNotMatch(server, new RegExp(`\\b${name}\\b`));
      assert.doesNotMatch(shared, new RegExp(`\\b${name}\\b`));
    }
    assert.doesNotMatch(server, /\buseForm\b/);
    assert.doesNotMatch(shared, /\buseForm\b/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
