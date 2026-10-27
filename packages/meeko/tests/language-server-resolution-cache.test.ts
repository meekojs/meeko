import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { MeekoProject } from "../src/language-server/project.ts";
import { createTempProject } from "./helpers/temp-project.ts";
import type { TempProject } from "./helpers/temp-project.ts";

const helper = `export function greet(name: string): string { return \`Hola, \${name}\`; }\n`;

describe("language server: module resolution cache", () => {
  let temp: TempProject;
  let project: MeekoProject;

  before(async () => {
    temp = await createTempProject("lsp-resolution-");
    await writeFile(join(temp.root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: {
      strict: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", types: [], noEmit: true,
    }, include: ["src"] })}\n`);
    await mkdir(join(temp.root, "src"), { recursive: true });
    await writeFile(join(temp.root, "src", "main.ts"), `import { greet } from "./helper.js";\nexport const message = greet("Meeko");\n`);
    project = new MeekoProject(temp.root, { trusted: false });
    await project.ready();
  });

  after(async () => {
    project?.dispose();
    await temp?.remove();
  });

  const codes = (): number[] => project.service.getSemanticDiagnostics(join(temp.root, "src", "main.ts")).map((item) => item.code);

  test("an import that did not resolve resolves once its file appears", async () => {
    // The first program caches the failed resolution of ./helper.js.
    assert.deepEqual(codes(), [2307]);
    await writeFile(join(temp.root, "src", "helper.ts"), helper);
    project.filesChanged([join(temp.root, "src", "helper.ts")]);
    await project.ready();
    assert.deepEqual(codes(), []);
  });

  test("a dependency installed after the first resolution is found after its manifest changes", async () => {
    const main = join(temp.root, "src", "main.ts");
    await writeFile(main, `import { greet } from "fake-greeter";\nexport const message = greet("Meeko");\n`);
    project.filesChanged([main]);
    await project.ready();
    assert.deepEqual(codes(), [2307]);
    // An install writes node_modules, which is not watched, and the project's manifest, which is.
    const pkg = join(temp.root, "node_modules", "fake-greeter");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "package.json"), `${JSON.stringify({ name: "fake-greeter", type: "module", exports: { ".": { types: "./index.d.ts" } } })}\n`);
    await writeFile(join(pkg, "index.d.ts"), "export declare function greet(name: string): string;\n");
    await writeFile(join(temp.root, "package.json"), `${JSON.stringify({ private: true, type: "module", dependencies: { "fake-greeter": "1.0.0" } })}\n`);
    project.filesChanged([join(temp.root, "package.json")]);
    await project.ready();
    assert.deepEqual(codes(), []);
  });
});
