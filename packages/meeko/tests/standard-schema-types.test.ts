import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "@typescript/typescript6";
import { standardSchemaTypes } from "../src/framework/standard-schema-types.ts";

test("Standard Schema types reject nested erasure and accept recursive contracts", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/standard-schema-types-"));
  const file = join(root, "schemas.ts");
  try {
    await writeFile(file, `const schema = <I, O = I>() => ({ "~standard": { version: 1 as const, types: undefined as unknown as { input: I; output: O }, validate: (value: unknown) => ({ value: value as O }) } });
type Phantom<T> = { ok: string };
interface Recursive { value: string; children?: readonly Recursive[] }
const nestedAny = schema<{ nested: { value: any } }>();
const unionUnknown = schema<{ variant: { ok: string } | { bad: unknown } }>();
const intersectionNever = schema<{ payload: { ok: string } & { bad: never } }>();
const indexedAny = schema<{ lookup: Record<string, any> }>();
const tupleUnknown = schema<readonly [string, unknown]>();
const genericAny = schema<{ map: Map<string, any> }>();
const phantomAny = schema<Phantom<any>>();
const unsafeOutput = schema<string, { meta: unknown }>();
const recursive = schema<Recursive>();
`);
    const program = ts.createProgram({ rootNames: [file], options: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true,
    } });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(file);
    assert.ok(source);
    const declarations = new Map<string, ts.Identifier>();
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration.name);
      }
    }
    for (const name of ["nestedAny", "unionUnknown", "intersectionNever", "indexedAny", "tupleUnknown", "genericAny", "phantomAny", "unsafeOutput"]) {
      const expression = declarations.get(name);
      assert.ok(expression, name);
      assert.throws(() => standardSchemaTypes(expression, checker, () => new Error(`unsafe ${name}`)), new RegExp(`unsafe ${name}`));
    }
    const recursive = declarations.get("recursive");
    assert.ok(recursive);
    assert.doesNotThrow(() => standardSchemaTypes(recursive, checker, () => new Error("recursive rejected")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
