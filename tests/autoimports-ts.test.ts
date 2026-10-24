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
    "shared/types/labels.ts": "export type Label = string; export type Box<T> = { value: T };",
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
    assert.match(client, /type Label = import/);
    assert.match(client, /type Box<T> = import\([^\n]+\)\.Box<T>/);
    assert.doesNotMatch(client, /getSecret/);
    assert.match(server, /const getSecret: typeof import/);
    assert.doesNotMatch(server, /useCount/);
    assert.doesNotMatch(shared, /useCount|getSecret/);
    const registry = await discoverAutoImports(root);
    const page = join(root, "app", "pages", "index.ts");
    const code = transformTypeScriptAutoImports("const count = useCount(); type Name = Label;", page, root, registry);
    assert.match(code ?? "", /import \{ useCount as useCount \}/);
    assert.match(code ?? "", /import type \{ Label as Label \}/);
    assert.equal(typeScriptAutoImportMap("const count = useCount(); type Name = Label;", code!, page).sources[0], page);
    const explicit = transformTypeScriptAutoImports('import { useCount } from "../composables/count.js"; useCount();', page, root, registry);
    assert.equal(explicit, undefined);
    assert.throws(() => transformTypeScriptAutoImports("getSecret();", page, root, registry), /unavailable in client scope/);
    assert.throws(() => transformTypeScriptAutoImports("useCount();", join(root, "shared", "utils", "worker.ts"), root, registry), /unavailable in server scope/);
    assert.equal(typeScriptScope(root, join(root, "app", "pages", "page.test.ts")), undefined);
    assert.equal(typeScriptScope(root, join(root, "app", "pages", "page.server.ts")), "server");
    const sidecar = join(root, "app", "pages", "users", "index.route.ts");
    assert.equal(typeScriptScope(root, sidecar), "server");
    assert.match(transformTypeScriptAutoImports("getSecret();", sidecar, root, registry) ?? "", /import \{ getSecret as getSecret \}/);
    assert.equal(typeScriptScope(root, join(root, "app", "pages", "page.shared.ts")), "shared");
    const consumer = join(root, "consumer.ts");
    await writeFile(consumer, `const count: number = useCount();\nconst label: Label = "ok";\nconst box: Box<number> = { value: 1 };\nvoid count; void label; void box;\n`);
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, skipLibCheck: true, noEmit: true,
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
    await assert.rejects(generateAutoImportTypes(root), /Ambiguous autoimport duplicate in client scope/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
