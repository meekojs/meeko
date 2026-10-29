import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "@typescript/typescript6";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

const compilerOptions = {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022", "DOM"], types: [],
  strict: true, noEmit: true, skipLibCheck: true, exactOptionalPropertyTypes: true,
};

async function application(files: Record<string, string>): Promise<{ root: string; remove(): Promise<void> }> {
  const project = await createTempProject("named-middleware-types-");
  await linkRepositoryPackages(project.root);
  await writeFile(join(project.root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(project.root, "tsconfig.json"), JSON.stringify({ compilerOptions, include: ["*.ts"] }));
  for (const [name, source] of Object.entries(files)) await writeFile(join(project.root, name), source);
  return project;
}

// What `.meeko/types/routes.d.ts` declares for a project with two named middleware.
const generated = `import "@meekojs/meeko/framework";
declare module "@meekojs/meeko/framework" {
  interface GeneratedRouteMiddleware {
    "admin": "app/middleware/admin.ts";
    "auth": "app/middleware/10-auth.ts";
  }
}
export {};
`;

const typed = `import { defineGroup, definePage, defineRouteMiddleware } from "@meekojs/meeko/framework";
import type { RouteMiddlewareName, RouteMiddlewareOptions } from "@meekojs/meeko/framework";

type Equals<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
declare function expect<T extends true>(): void;

expect<Equals<RouteMiddlewareName, "admin" | "auth">>();

export const guard = defineRouteMiddleware(({ url }) => url.searchParams.has("deny") ? new Response(null, { status: 403 }) : undefined, { global: false });
export const everywhere = defineRouteMiddleware(() => undefined);
const options: RouteMiddlewareOptions = { global: true };
export { options };
// @ts-expect-error global is a boolean.
defineRouteMiddleware(() => undefined, { global: "no" });

export const page = definePage({ middleware: ["auth", "admin"], load: () => ({ n: 1 }), head: ({ data }) => ({ title: String(data.n) }) });
export const client = definePage({ render: "client", middleware: ["auth"] });
export const none = definePage({ layout: false, middleware: false });
// @ts-expect-error There is no middleware called nowhere.
definePage({ middleware: ["nowhere"] });
// @ts-expect-error middleware lists names.
definePage({ middleware: "auth" });

export const group = defineGroup({ middleware: ["auth"] });
export const open = defineGroup({ middleware: false });
// @ts-expect-error There is no middleware called nowhere.
defineGroup({ middleware: ["nowhere"] });
`;

test("middleware of definePage and defineGroup is typed with the named middleware of the application", { timeout: 120_000 }, async () => {
  const project = await application({ "routes.d.ts": generated, "page.ts": typed });
  try {
    const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(project.root, "tsconfig.json")], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    await project.remove();
  }
});

test("the editor completes the names of the named middleware", { timeout: 120_000 }, async () => {
  const sources = {
    "routes.d.ts": generated,
    "page.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ middleware: [""] });\n',
    "group.ts": 'import { defineGroup } from "@meekojs/meeko/framework";\nexport default defineGroup({ middleware: ["auth", ""] });\n',
  };
  const project = await application(sources);
  try {
    const files = Object.keys(sources).map((name) => join(project.root, name));
    const options = ts.parseJsonConfigFileContent({ compilerOptions }, ts.sys, project.root).options;
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
    const complete = (name: keyof typeof sources, marker: string): string[] => {
      const offset = sources[name].indexOf(marker) + marker.length;
      const result = service.getCompletionsAtPosition(join(project.root, name), offset, { quotePreference: "double" });
      return (result?.entries.map((entry) => entry.name) ?? []).sort();
    };
    assert.deepEqual(complete("page.route.ts", 'middleware: ["'), ["admin", "auth"]);
    assert.deepEqual(complete("group.ts", '"auth", "'), ["admin", "auth"]);
  } finally {
    await project.remove();
  }
});

// A project with an isomorphic and a server named middleware, and its session type.
const serverGenerated = `import "@meekojs/meeko/framework";
declare module "@meekojs/meeko/framework" {
  interface GeneratedRouteMiddleware {
    "admin": "app/middleware/admin.ts";
    "auth": "app/middleware/auth.server.ts";
  }
}
declare module "@meekojs/meeko/server" {
  interface MeekoSession { user: string }
}
export {};
`;

const serverTyped = `import { defineGroup, definePage, defineServerRouteMiddleware, redirect } from "@meekojs/meeko/framework";
import type { RouteMiddlewareName, ServerRouteMiddleware, ServerRouteMiddlewareContext } from "@meekojs/meeko/framework";
import type { RequestContext, ServerPlatform } from "@meekojs/meeko/server";

type Equals<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
declare function expect<T extends true>(): void;

// A server middleware is one more name of middleware.
expect<Equals<RouteMiddlewareName, "admin" | "auth">>();

export const auth = defineServerRouteMiddleware(({ session, url, params, search, request, signal, requestId, platform, context }) => {
  const user: string | undefined = session.current?.data.user;
  const id: string = params.id ?? "";
  const tab: string | string[] | undefined = search.tab;
  const host: string = request.headers.get("host") ?? url.host;
  const aborted: boolean = signal.aborted;
  const runtime: ServerPlatform<unknown> = platform;
  const same: RequestContext = context;
  void [id, tab, host, aborted, runtime, same, requestId];
  if (!user) redirect("/login");
}, { global: false });

interface Services { readonly db: { readonly ready: boolean } }
export const ready = defineServerRouteMiddleware<Services>(({ services }) => services.db.ready ? undefined : new Response(null, { status: 503 }));
export const plain: ServerRouteMiddleware = async (context: ServerRouteMiddlewareContext) => { void context.match.route.id; };
// @ts-expect-error A server route middleware returns a Response or nothing.
defineServerRouteMiddleware(() => "denied");
// @ts-expect-error global is a boolean.
defineServerRouteMiddleware(() => undefined, { global: "no" });

export const group = defineGroup({ middleware: ["auth", "admin"] });
export const page = definePage({ middleware: ["auth"] });
// @ts-expect-error There is no middleware called nowhere.
defineGroup({ middleware: ["nowhere"] });
// A render: "client" page asks for the isomorphic ones only: it does not ask the server for its data.
export const clientPage = definePage({ render: "client", middleware: ["admin"] });
// @ts-expect-error auth is a server route middleware.
definePage({ render: "client", middleware: ["auth"] });
`;

test("defineServerRouteMiddleware gets the request context with the session type, and its names type middleware", { timeout: 120_000 }, async () => {
  const project = await application({ "routes.d.ts": serverGenerated, "auth.server.ts": serverTyped });
  try {
    const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(project.root, "tsconfig.json")], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    await project.remove();
  }
});

// What `.meeko/types/routes.d.ts` declares for a project whose middleware is all global.
const globalOnlyGenerated = `import "@meekojs/meeko/framework";
declare module "@meekojs/meeko/framework" {
  interface GeneratedRouteMiddleware {
    "#none": never;
  }
}
export {};
`;

const globalOnlyTyped = `import { defineGroup, definePage } from "@meekojs/meeko/framework";
import type { RouteMiddlewareName } from "@meekojs/meeko/framework";

type Equals<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
declare function expect<T extends true>(): void;

expect<Equals<RouteMiddlewareName, never>>();
export const none = definePage({ middleware: [] });
export const off = defineGroup({ middleware: false });
// @ts-expect-error The application has no named middleware.
definePage({ middleware: ["typo"] });
// @ts-expect-error The application has no named middleware.
defineGroup({ middleware: ["typo"] });
// @ts-expect-error "#none" only marks the generated declarations.
definePage({ middleware: ["#none"] });
`;

test("without named middleware, the generated declarations make any middleware name a type error", { timeout: 120_000 }, async () => {
  const project = await application({ "routes.d.ts": globalOnlyGenerated, "page.ts": globalOnlyTyped });
  try {
    const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(project.root, "tsconfig.json")], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    await project.remove();
  }
});
