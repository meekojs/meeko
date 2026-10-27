import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
// TypeScript 7, the compiler that `meeko check` runs on applications.
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022", "DOM"], types: [],
    strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true,
  },
  include: ["*.ts"],
});

/** Type-checks `files` against the built declarations, as an application that imports the package. */
async function check(files: Record<string, string>): Promise<{ status: number | null; output: string }> {
  await mkdir(resolve(".meeko"), { recursive: true });
  // Inside the package, so `@meekojs/meeko/server` resolves to its own exports.
  const root = await mkdtemp(resolve(".meeko/session-types-"));
  try {
    await writeFile(join(root, "tsconfig.json"), tsconfig);
    for (const [name, source] of Object.entries(files)) await writeFile(join(root, name), source);
    const result = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json")], { encoding: "utf8", windowsHide: true });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const declared = `import { defineApiRoute, defineRpc, defineSocketChannel, SessionHandle } from "@meekojs/meeko/server";
import type { RequestContext, Schema, SessionData } from "@meekojs/meeko/server";
import { usePage } from "@meekojs/meeko/framework";

declare module "@meekojs/meeko/server" {
  interface MeekoSession { user: string; role: "owner" | "staff" }
}

declare const context: RequestContext;
declare const ok: Schema<{ ok: true }>;
declare const text: Schema<{ text: string }>;

// Reading the session.
const data = context.session.current?.data;
const user: string | undefined = data?.user;
const role: "owner" | "staff" | undefined = data?.role;
// @ts-expect-error role is a union of literals, not any string
const wrongRole: "admin" | undefined = data?.role;
// @ts-expect-error a field the declaration does not have
void data?.email;

// Creating it requires the declared shape.
void context.session.create({ user: "ada", role: "owner" }, { ttlMs: 60_000 });
// @ts-expect-error role is missing
void context.session.create({ user: "ada" });
// @ts-expect-error role is not one of the literals
void context.session.create({ user: "ada", role: "admin" });

// API: authorize, locals and the handler.
export const api = defineApiRoute({
  auth: "required",
  response: ok,
  authorize: ({ session }) => session.current?.data.role === "owner",
  locals: ({ session }) => ({ user: session.current!.data.user }),
  handler: ({ locals, context }) => {
    const name: string = locals.user;
    const again: string | undefined = context.session.current?.data.user;
    void name; void again;
    return { ok: true as const };
  },
});

// RPC.
export const rpc = defineRpc({
  input: text,
  output: ok,
  authorize: (context) => context.session.current?.data.role === "staff",
  handler: async ({ context }) => {
    await context.session.create({ user: "grace", role: "staff" });
    return { ok: true as const };
  },
});

// Socket.
export const socket = defineSocketChannel({
  auth: "required",
  clientToServer: { message: text },
  serverToClient: { message: text },
  authorize: ({ context }) => context.session.current?.data.role === "owner",
  handlers: { message: ({ payload, emit, context }) => emit("message", { text: payload.text + (context.session.current?.data.user ?? "") }) },
});

// Pages: the top level of <script server> reads usePage().context.
const page = usePage();
const pageUser: string | undefined = page.context.session.current?.data.user;

// SessionData names the declared shape, and SessionHandle defaults to it.
const shape: SessionData = { user: "ada", role: "owner" };
declare const handle: SessionHandle;
const handleUser: string | undefined = handle.current?.data.user;

void user; void role; void wrongRole; void pageUser; void shape; void handleUser;
`;

const undeclared = `import type { RequestContext } from "@meekojs/meeko/server";

declare const context: RequestContext;
const data = context.session.current?.data;
const unknownData: unknown = data;
// @ts-expect-error without a MeekoSession declaration the data is unknown
void data.user;
// Any value can be stored, as before 1.2.
void context.session.create({ userId: "u_1" });
void context.session.create("plain");
void unknownData;
`;

test("declaring MeekoSession types session data in API, RPC, Socket, pages, authorize and locals", async () => {
  const result = await check({ "app.ts": declared });
  assert.equal(result.status, 0, result.output);
});

test("without a MeekoSession declaration session data stays unknown", async () => {
  const result = await check({ "app.ts": undeclared });
  assert.equal(result.status, 0, result.output);
});
