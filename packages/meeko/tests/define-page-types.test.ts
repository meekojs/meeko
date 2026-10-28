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

/** A temporary application that imports the built package, with `files` beside its tsconfig. */
async function application(files: Record<string, string>, exactOptionalPropertyTypes: boolean): Promise<{ root: string; remove(): Promise<void> }> {
  const project = await createTempProject("define-page-types-");
  await linkRepositoryPackages(project.root);
  await writeFile(join(project.root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(project.root, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...compilerOptions, exactOptionalPropertyTypes }, include: ["*.ts"] }));
  for (const [name, source] of Object.entries(files)) await writeFile(join(project.root, name), source);
  return project;
}

const typed = `import { definePage } from "@meekojs/meeko/framework";
import type { ClientPageDefinition, PageDefinition, PageLoadContext, PageSchema } from "@meekojs/meeko/framework";

type Equals<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
declare function expect<T extends true>(): void;
type Data<R> = R extends { readonly load: (...args: never[]) => infer D } ? Awaited<D> : "no load";
declare const id: PageSchema<{ id: string }>;
declare const slug: PageSchema<{ slug: string }>;

// Each mode infers its loader context, its data and keeps a declared load required.
export const client = definePage({ render: "client", load: async ({ url, params }) => ({ path: url.pathname, params }) });
expect<Equals<Data<typeof client>, { path: string; params: Readonly<Record<string, string>> }>>();
const clientMode: "client" = client.render;
export const server = definePage({ load: async ({ request }) => ({ method: request.method }) });
expect<Equals<Data<typeof server>, { method: string }>>();
expect<Equals<Parameters<typeof server.load>[0], PageLoadContext<undefined, undefined, unknown>>>();
export const stream = definePage({ render: "stream", params: id, load: ({ params, search }) => ({ id: params.id, tab: search.tab }), head: ({ data }) => ({ title: data.id }) });
expect<Equals<Data<typeof stream>, { id: string; tab: string | string[] }>>();
export const prerender = definePage({ render: "prerender", params: slug, prerenderEntries: [{ slug: "a" }], load: ({ params }) => params.slug });
expect<Equals<Data<typeof prerender>, string>>();
export const clientHead = definePage({ render: "client", params: id, load: ({ params, url }) => ({ n: params.id + url.href }), head: ({ data }) => ({ title: data.n }) });
expect<Equals<Data<typeof clientHead>, { n: string }>>();
// Only context-sensitive functions besides render: nothing else infers T before load and head are typed.
export const streamed = definePage({ render: "stream", load: ({ request }) => ({ url: request.url }), head: ({ data }) => ({ title: data.url }) });
expect<Equals<Data<typeof streamed>, { url: string }>>();
export const browserHead = definePage({ render: "client", load: ({ url, signal }) => ({ path: url.pathname, aborted: signal.aborted }), head: ({ data }) => ({ title: data.path }) });
expect<Equals<Data<typeof browserHead>, { path: string; aborted: boolean }>>();
export const method = definePage({ load() { return { method: true }; } });
expect<Equals<Data<typeof method>, { method: boolean }>>();
const options = { load: () => ({ fromOptions: true }) };
export const fromOptions = definePage(options);
expect<Equals<Data<typeof fromOptions>, { fromOptions: boolean }>>();
// Without load there are no data, and the result is the plain definition of its mode.
export const ssr = definePage({ render: "ssr" });
expect<Equals<typeof ssr, PageDefinition<undefined, undefined, unknown, unknown>>>();
export const browser = definePage({ render: "client" });
expect<Equals<typeof browser, ClientPageDefinition<undefined, undefined, unknown>>>();
expect<Equals<Data<typeof browser>, "no load">>();

// Written type arguments (the only way to type the context C) infer nothing: the mode and a
// declared load still come from the options.
interface Ctx { readonly user: string }
type Named = { name: string };
export const explicitServer = definePage<undefined, undefined, Named, Ctx>({ load: ({ context }) => ({ name: context?.user ?? "" }) });
expect<Equals<typeof explicitServer, PageDefinition<undefined, undefined, Named, Ctx> & { readonly load: NonNullable<PageDefinition<undefined, undefined, Named, Ctx>["load"]> }>>();
expect<Equals<Data<typeof explicitServer>, Named>>();
export const explicitClient = definePage<undefined, undefined, string>({ render: "client", load: ({ url }) => url.href });
expect<Equals<typeof explicitClient, ClientPageDefinition<undefined, undefined, string> & { readonly load: NonNullable<ClientPageDefinition<undefined, undefined, string>["load"]> }>>();
const explicitClientMode: "client" = explicitClient.render;
export const explicitSsr = definePage<undefined, undefined, unknown>({ render: "stream" });
expect<Equals<typeof explicitSsr, PageDefinition<undefined, undefined, unknown, unknown>>>();
export const explicitBrowser = definePage<undefined, undefined, unknown>({ render: "client" });
expect<Equals<typeof explicitBrowser, ClientPageDefinition<undefined, undefined, unknown>>>();
// @ts-expect-error Written type arguments still check the options: a client loader has no Request.
definePage<undefined, undefined, string>({ render: "client", load: ({ request }) => request.url });
// @ts-expect-error The data must match the written type.
definePage<undefined, undefined, Named>({ load: () => ({ name: 1 }) });

// @ts-expect-error A client loader runs in the browser: it has no Request.
definePage({ render: "client", load: ({ request }) => request.url });
// @ts-expect-error A server loader has no url; it reads request.url.
definePage({ load: ({ url }) => url });
// @ts-expect-error A client page cannot be prerendered.
definePage({ render: "client", prerenderEntries: [{ slug: "a" }], load: () => 1 });
// @ts-expect-error Not a render mode.
definePage({ render: "static" });
export { clientMode, explicitClientMode };
`;

for (const exact of [true, false]) {
  test(`definePage infers each render mode with TypeScript 7 (exactOptionalPropertyTypes: ${exact})`, { timeout: 120_000 }, async () => {
    const project = await application({ "page.ts": typed }, exact);
    try {
      const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(project.root, "tsconfig.json")], { encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    } finally {
      await project.remove();
    }
  });
}

test("the editor completes the four render modes in definePage, before and after load", { timeout: 120_000 }, async () => {
  const sources = {
    "empty.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ render: "" });\n',
    "loaded.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ load: () => 1, render: "s" });\n',
    "client.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ render: "c", load: async ({ url }) => url.href });\n',
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
    for (const [name, source] of Object.entries(sources)) {
      const offset = source.indexOf('render: "') + 'render: "'.length;
      const result = service.getCompletionsAtPosition(join(project.root, name), offset, { quotePreference: "double" });
      assert.deepEqual(result?.entries.map((entry) => entry.name).sort(), ["client", "prerender", "ssr", "stream"], name);
    }
  } finally {
    await project.remove();
  }
});
