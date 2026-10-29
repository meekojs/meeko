import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { generateServicesTypes } from "../src/framework/services-types.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

const compilerOptions = {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022", "DOM"], types: [],
  strict: true, noEmit: true, skipLibCheck: true, exactOptionalPropertyTypes: true,
};

async function application(files: Record<string, string>): Promise<{ root: string; remove(): Promise<void> }> {
  const project = await createTempProject("services-types-");
  await linkRepositoryPackages(project.root);
  await writeFile(join(project.root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(project.root, "tsconfig.json"), JSON.stringify({ compilerOptions, include: ["*.ts", ".meeko/types/services.d.ts"] }));
  for (const [name, source] of Object.entries(files)) {
    await mkdir(join(project.root, ...name.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(project.root, ...name.split("/")), source);
  }
  return project;
}

function tsc(root: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.json")], { encoding: "utf8", windowsHide: true });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// `defineServerRuntime` is an autoimport of server/: the copy that the declaration reads imports it.
const runtime = `import { Database } from "./utils/database.js";

export default defineServerRuntime(async ({ prerendering }) => ({
  services: (_request, { platform }) => ({ db: new Database(prerendering), region: platform.name }),
}));
`;

const database = `export class Database {
  constructor(readonly connected: boolean) {}
  readonly users = { count: async (): Promise<number> => 1 };
}
`;

const usage = `import { createRequestContext, defineApiRoute, defineRpc, defineSocketChannel } from "@meekojs/meeko/server";
import type { AppServices, PlatformName, RequestContext, Schema, SessionHandle } from "@meekojs/meeko/server";
import { defineServerRouteMiddleware, usePage } from "@meekojs/meeko/framework";
import type { Database } from "./server/utils/database.js";

type Equals<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
declare function expect<T extends true>(): void;
declare const id: Schema<{ id: string }>;
declare const count: Schema<number>;

// The services of server/runtime.ts, without a cast: what its per-request factory returns.
expect<Equals<AppServices, { db: Database; region: PlatformName }>>();
expect<Equals<RequestContext["services"], AppServices>>();

export const api = defineApiRoute({ handler: async ({ context }) => Response.json({ users: await context.services.db.users.count(), ready: context.services.db.connected }) });
export const guarded = defineApiRoute({ authorize: (context) => context.services.db.connected, locals: (context) => context.services.region, handler: ({ locals }) => Response.json({ region: locals }) });
export const rpc = defineRpc({ input: id, output: count, handler: ({ context }) => context.services.db.users.count() });
export const channel = defineSocketChannel({
  clientToServer: { ping: id }, serverToClient: {},
  authorize: ({ context }) => context.services.db.connected,
  handlers: { ping: ({ context }) => { void context.services.region; } },
});
export const middleware = defineServerRouteMiddleware(({ services, context }) => services.db.connected && context.services.region !== "deno" ? undefined : new Response(null, { status: 503 }));
export function page(): Promise<number> {
  return usePage().context.services.db.users.count();
}

// A written services type still wins, and so does any.
interface Other { readonly cache: Map<string, string> }
declare const session: SessionHandle;
expect<Equals<RequestContext<Other>["services"], Other>>();
expect<Equals<ReturnType<typeof createRequestContext<Other>>["services"], Other>>();
const loose: RequestContext<any> = createRequestContext(new Request("http://localhost/"), { cache: new Map() }, session);
void loose.services.anything;

// A test written for 1.6 passes its own fake services to a route without a services type (S =
// unknown) or to a function that takes a RequestContext: it still compiles.
declare const fakeDb: { readonly users: { count(): Promise<number> } };
const testContext = createRequestContext(new Request("http://localhost/"), { db: fakeDb }, session);
void api.handler({ context: testContext, params: undefined, query: undefined, body: undefined, locals: undefined });
void rpc.handler({ context: testContext, input: { id: "1" }, locals: undefined });
const asDefault: RequestContext = createRequestContext(new Request("http://localhost/"), { db: fakeDb }, session);
function takesContext(context: RequestContext): void { void context; }
takesContext(testContext);
void asDefault;
// Code that receives the context of such a route types it as RequestContext: its services are AppServices.
function takesAppContext(context: RequestContext): Promise<number> { return context.services.db.users.count(); }
defineApiRoute({ handler: async ({ context }) => Response.json(await takesAppContext(context)) });

// @ts-expect-error The runtime has no cache service.
defineApiRoute({ handler: ({ context }) => context.services.cache });
// @ts-expect-error Nor does a server route middleware see one.
defineServerRouteMiddleware(({ services }) => { void services.cache; });
`;

test("RequestContext.services takes the type of server/runtime.ts everywhere, without casts", { timeout: 120_000 }, async () => {
  const project = await application({ "server/runtime.ts": runtime, "server/utils/database.ts": database, "usage.ts": usage });
  try {
    await generateServicesTypes(project.root);
    const copy = await readFile(join(project.root, ".meeko", "types", "server-runtime.ts"), "utf8");
    assert.match(copy, /^\/\/ @ts-nocheck\n/);
    assert.match(copy, /import \{ defineServerRuntime(?: as defineServerRuntime)? \} from "@meekojs\/meeko\/server"/);
    assert.match(copy, /from "\.\.\/\.\.\/server\/utils\/database\.js"/);
    const result = tsc(project.root);
    assert.equal(result.status, 0, result.output);
  } finally {
    await project.remove();
  }
});

test("meeko check types context.services in a page's <script server> and in server code from server/runtime.ts", { timeout: 180_000 }, async () => {
  const project = await createTempProject("services-check-");
  const root = project.root;
  try {
    await linkRepositoryPackages(root);
    const page = (member: string) => [
      '<script server lang="ts">',
      "const { context } = usePage();",
      `export const users: number = await context.services.db.${member}();`,
      "</script>",
      "<template><p>{users}</p></template>",
      "",
    ].join("\n");
    const files: Record<string, string> = {
      "package.json": '{"private":true,"type":"module"}\n',
      "server/runtime.ts": "export default defineServerRuntime(() => ({ services: { db: { countUsers: async (): Promise<number> => 1 } } }));\n",
      "server/utils/users.ts": 'import type { RequestContext } from "@meekojs/meeko/server";\nexport const countUsers = (context: RequestContext): Promise<number> => context.services.db.countUsers();\n',
      "app/pages/index.meeko": page("countUsers"),
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(join(root, ...file.split("/").slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...file.split("/")), contents);
    }
    await checkFrameworkProject(root);
    assert.match(await readFile(join(root, ".meeko", "tsconfig.server.json"), "utf8"), /"types\/services\.d\.ts"/);
    await writeFile(join(root, "app", "pages", "index.meeko"), page("countPosts"));
    await assert.rejects(checkFrameworkProject(root), /Property 'countPosts' does not exist/);
  } finally {
    await project.remove();
  }
});

test("without server/runtime.ts, services stay unknown and a member access is an error", { timeout: 120_000 }, async () => {
  const project = await application({
    "usage.ts": `import { defineApiRoute } from "@meekojs/meeko/server";
import type { AppServices } from "@meekojs/meeko/server";
type Equals<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
declare function expect<T extends true>(): void;
expect<Equals<AppServices, unknown>>();
// @ts-expect-error Services are unknown without a runtime.
defineApiRoute({ handler: ({ context }) => context.services.db });
`,
  });
  try {
    await generateServicesTypes(project.root);
    assert.equal(await readFile(join(project.root, ".meeko", "types", "services.d.ts"), "utf8"), "// Generated by Meeko: without server/runtime.ts in TypeScript, RequestContext.services is unknown.\nexport {};\n");
    const result = tsc(project.root);
    assert.equal(result.status, 0, result.output);
  } finally {
    await project.remove();
  }
});
