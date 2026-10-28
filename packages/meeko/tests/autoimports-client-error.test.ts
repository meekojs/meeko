import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyAutoImports, discoverAutoImports, transformAutoImports } from "../src/autoimports.ts";
import { generateAutoImportTypes, transformTypeScriptAutoImports } from "../src/autoimports-ts.ts";
import { compile } from "../src/compiler.ts";
import { createTempProject } from "./helpers/temp-project.ts";

test("ClientError and isClientError are autoimported in components and app/ modules, not in server code", { timeout: 60_000 }, async () => {
  const project = await createTempProject("client-error-autoimport");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const registry = await discoverAutoImports(root);
    const source = "if (isClientError(failure, \"EMAIL_TAKEN\") || failure instanceof ClientError) {}\nlet failure: ClientError | undefined;";
    const imports = /import \{ ClientError as ClientError \} from "@meekojs\/meeko\/framework";\nimport \{ isClientError as isClientError \} from "@meekojs\/meeko\/framework";/;

    // A component, in the browser graph and in the SSR graph.
    const component = join(root, "app", "pages", "index.meeko");
    const sfc = `<script lang="ts">\n${source}\n</script>\n<template><p>x</p></template>`;
    const compiled = compile(sfc, component).code;
    assert.match(transformAutoImports(sfc, component, compiled, registry, "client"), imports);
    assert.match(transformAutoImports(sfc, component, compiled, registry, "server"), imports);

    // A plain module of app/, also in the SSR graph.
    const composable = join(root, "app", "composables", "signup.ts");
    assert.match(transformTypeScriptAutoImports(source, composable, root, registry) ?? "", imports);
    assert.match(transformTypeScriptAutoImports(source, composable, root, registry, undefined, undefined, true) ?? "", imports);

    // Server code throws ApiError instead: neither name exists there.
    assert.throws(() => transformTypeScriptAutoImports("isClientError(x);", join(root, "server", "api", "signup.post.ts"), root, registry), /isClientError no está disponible en el ámbito server/);
    assert.throws(() => transformTypeScriptAutoImports("new ClientError('X', 409);", join(root, "app", "pages", "page.server.ts"), root, registry), /ClientError no está disponible en el ámbito server/);
    assert.throws(() => applyAutoImports("isClientError(x);", join(root, "shared", "utils", "x.ts"), registry, "shared"), /no está disponible en el ámbito shared/);
    const types = await generateAutoImportTypes(root);
    assert.match(await readFile(types.client, "utf8"), /export import ClientError = __meeko_type_\d+\.ClientError;/);
    assert.match(await readFile(types.client, "utf8"), /const isClientError: typeof import\("@meekojs\/meeko\/framework"\)\["isClientError"\];/);
    assert.doesNotMatch(await readFile(types.server, "utf8"), /ClientError/);

    // A project's own export of the same name wins, as with useForm.
    await mkdir(join(root, "app", "utils"), { recursive: true });
    await writeFile(join(root, "app", "utils", "errors.ts"), "export function isClientError(): boolean { return false; }\n");
    const own = await discoverAutoImports(root);
    assert.match(applyAutoImports("isClientError();", composable, own, "client"), /utils\/errors\.js/);
  } finally {
    await project.remove();
  }
});

test("useId is a core autoimport that a project composable of the same name replaces", { timeout: 60_000 }, async () => {
  const project = await createTempProject("use-id-autoimport");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const page = join(root, "app", "pages", "index.meeko");
    assert.match(applyAutoImports("const id = useId();", page, await discoverAutoImports(root), "client"), /import \{ useId as useId \} from "@meekojs\/meeko";/);
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await writeFile(join(root, "app", "composables", "ids.ts"), "export function useId(): string { return 'x'; }\n");
    assert.match(applyAutoImports("const id = useId();", page, await discoverAutoImports(root), "client"), /composables\/ids\.js/);
  } finally {
    await project.remove();
  }
});
