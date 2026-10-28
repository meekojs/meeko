import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "@typescript/typescript6";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

const compilerOptions = {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022", "DOM"], types: [],
  strict: true, noEmit: true, skipLibCheck: true,
};

async function application(files: Record<string, string>, exactOptionalPropertyTypes: boolean): Promise<{ root: string; remove(): Promise<void> }> {
  const project = await createTempProject("named-layouts-types-");
  await linkRepositoryPackages(project.root);
  await writeFile(join(project.root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(project.root, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...compilerOptions, exactOptionalPropertyTypes }, include: ["*.ts"] }));
  for (const [name, source] of Object.entries(files)) await writeFile(join(project.root, name), source);
  return project;
}

// What `.meeko/types/routes.d.ts` declares for a project with three layouts.
const generated = `import "@meekojs/meeko/framework";
declare module "@meekojs/meeko/framework" {
  interface GeneratedLayouts {
    "default": { outlet: unknown; title?: string };
    "dashboard": { outlet: unknown; title?: string; showAlert?: boolean };
    "auth": { outlet: unknown };
  }
  interface GeneratedPageLayouts {
    "/connections": "dashboard";
    "/login": "auth";
    "/print": false;
  }
}
export {};
`;

const typed = `import { defineGroup, definePage, useLayout } from "@meekojs/meeko/framework";
import type { LayoutHandle, LayoutName, LayoutProps, PageLayout } from "@meekojs/meeko/framework";

type Equals<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
declare function expect<T extends true>(): void;

expect<Equals<LayoutName, "default" | "dashboard" | "auth">>();
expect<Equals<LayoutProps<"dashboard">, { title?: string; showAlert?: boolean }>>();
expect<Equals<PageLayout<"/connections">, "dashboard">>();
expect<Equals<PageLayout<"/print">, false>>();

// layoutProps is typed against the layout that the same options choose, as an object or from the data.
export const fixed = definePage({ layout: "dashboard", layoutProps: { title: "Conexiones", showAlert: true } });
export const fromData = definePage({ layout: "dashboard", load: () => ({ name: "Ada" }), layoutProps: ({ data }) => ({ title: data.name }) });
export const streamed = definePage({ render: "stream", layout: "dashboard", load: ({ request }) => ({ url: request.url }), head: ({ data }) => ({ title: data.url }), layoutProps: ({ data }) => ({ title: data.url }) });
export const browser = definePage({ render: "client", layout: "dashboard", load: async ({ url }) => ({ path: url.pathname }), layoutProps: ({ data }) => ({ title: data.path }) });
export const none = definePage({ layout: false });
export const inherited = definePage({ layoutProps: { title: "Sin layout propio" } });
// The written layout stays in the result, for meeko check.
expect<Equals<typeof fixed.layout, "dashboard">>();
// @ts-expect-error showAlert is a boolean.
definePage({ layout: "dashboard", layoutProps: { showAlert: "sí" } });
// @ts-expect-error auth declares no title.
definePage({ layout: "auth", layoutProps: { title: "Entrar" } });
// @ts-expect-error There is no layout called nowhere.
definePage({ layout: "nowhere" });
// @ts-expect-error Without a named layout there are no layout props.
definePage({ layout: false, layoutProps: { title: "x" } });
// @ts-expect-error The function returns the props of the chosen layout.
definePage({ layout: "dashboard", load: () => ({ n: 1 }), layoutProps: ({ data }) => ({ title: data.n }) });

export const group = defineGroup({ layout: "dashboard", layoutProps: { showAlert: false } });
// @ts-expect-error Not a prop of dashboard.
defineGroup({ layout: "dashboard", layoutProps: { color: "red" } });
// @ts-expect-error There is no layout called nowhere.
defineGroup({ layout: "nowhere" });

// In a page, Meeko writes the type argument; elsewhere it is explicit.
const layout = useLayout<"dashboard">();
expect<Equals<typeof layout, LayoutHandle<{ title?: string; showAlert?: boolean }>>>();
layout.set({ showAlert: true });
// @ts-expect-error showAlert is a boolean.
layout.set({ showAlert: 1 });
const title: string | undefined = layout.props.title;
const page = useLayout<PageLayout<"/print">>();
// @ts-expect-error A page without a named layout has no layout props.
page.set({ title: "x" });
export { title };
`;

for (const exact of [true, false]) {
  test(`layout and layoutProps are typed against the chosen layout (exactOptionalPropertyTypes: ${exact})`, { timeout: 120_000 }, async () => {
    const project = await application({ "routes.d.ts": generated, "page.ts": typed }, exact);
    try {
      const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(project.root, "tsconfig.json")], { encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    } finally {
      await project.remove();
    }
  });
}

test("the editor completes layout names and the props of the chosen layout", { timeout: 120_000 }, async () => {
  const sources = {
    "routes.d.ts": generated,
    "name.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ layout: "" });\n',
    "props.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ layout: "dashboard", layoutProps: {  } });\n',
    "render.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ layout: "auth", render: "" });\n',
    "group.ts": 'import { defineGroup } from "@meekojs/meeko/framework";\nexport default defineGroup({ layout: "dashboard", layoutProps: {  } });\n',
  };
  const project = await application(sources, true);
  try {
    const files = Object.keys(sources).map((name) => join(project.root, name));
    const options = ts.parseJsonConfigFileContent({ compilerOptions: { ...compilerOptions, exactOptionalPropertyTypes: true } }, ts.sys, project.root).options;
    const service = ts.createLanguageService({
      getCompilationSettings: () => options,
      getScriptFileNames: () => files,
      getScriptVersion: () => "1",
      getScriptSnapshot: (file) => { const text = ts.sys.readFile(file); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
      getCurrentDirectory: () => project.root,
      getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: (path) => ts.sys.realpath?.(path) ?? path,
    });
    const complete = (name: string, marker: string): string[] => {
      const source = sources[name as keyof typeof sources];
      const offset = source.indexOf(marker) + marker.length;
      const result = service.getCompletionsAtPosition(join(project.root, name), offset, { quotePreference: "double" });
      return (result?.entries.map((entry) => entry.name) ?? []).sort();
    };
    assert.deepEqual(complete("name.route.ts", 'layout: "'), ["auth", "dashboard", "default"]);
    assert.deepEqual(complete("props.route.ts", "layoutProps: { "), ["showAlert", "title"]);
    assert.deepEqual(complete("render.route.ts", 'render: "'), ["client", "prerender", "ssr", "stream"]);
    assert.deepEqual(complete("group.ts", "layoutProps: { "), ["showAlert", "title"]);
  } finally {
    await project.remove();
  }
});
