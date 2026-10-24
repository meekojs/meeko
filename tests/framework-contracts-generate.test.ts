import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { generateServerContracts } from "../src/framework/contracts-generate.ts";

const execFileAsync = promisify(execFile);

async function fixture(): Promise<string> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/contracts-test-"));
  const files = {
    "shared/schemas/user.ts": `const schema = <I, O = I>() => ({ "~standard": { version: 1 as const, types: undefined as unknown as { input: I; output: O }, validate: (value: unknown) => ({ value: value as O }) } });
export const userIdParams = schema<{ id: string }>();
export const userSchema = schema<undefined, { id: string; name: string }>();
export const createUserBody = schema<{ name: string }>();
export const getUserInput = schema<{ id: string }>();`,
    "server/api/users/[id].get.ts": `import { defineApiRoute } from "@meekojs/meeko/server";
import { userIdParams, userSchema } from "../../../shared/schemas/user.js";
export default defineApiRoute({ params: userIdParams, response: userSchema, handler: async () => ({ id: "1", name: "Ada" }) });`,
    "server/api/users/index.post.ts": `import { defineApiRoute } from "@meekojs/meeko/server";
import { createUserBody, userSchema } from "../../../shared/schemas/user.js";
export default defineApiRoute({ body: createUserBody, response: userSchema, handler: async ({ body }) => ({ id: "1", name: body.name }) });`,
    "server/api/users/index.get.ts": `import { defineApiRoute } from "@meekojs/meeko/server";
import { userSchema } from "../../../shared/schemas/user.js";
export default defineApiRoute({ response: userSchema, handler: async () => ({ id: "1", name: "Ada" }) });`,
    "server/rpc/users/get.ts": `import { defineRpc } from "@meekojs/meeko/server";
import { getUserInput, userSchema } from "../../../shared/schemas/user.js";
export default defineRpc({ input: getUserInput, output: userSchema, handler: async () => ({ id: "1", name: "Ada" }) });`,
    "app/pages/index.meeko": `<script lang="ts">const label = "ok";</script><template><p>{label}</p></template>`,
  };
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true,
    skipLibCheck: true, noEmit: true, resolveJsonModule: true,
  } }));
  return root;
}

test("server contract generator emits shared-only API/RPC client types", async () => {
  const root = await fixture();
  try {
    const generated = await generateServerContracts(root);
    assert.equal(generated.apiCount, 3);
    assert.equal(generated.rpcCount, 1);
    const declaration = await readFile(generated.types, "utf8");
    assert.match(declaration, /"users\.byId": \{ get: import\("@meekojs\/meeko\/framework"\)\.ApiOperation/);
    assert.match(declaration, /"users": \{ get: [^\n]+; post: [^\n]+ \};/);
    assert.match(declaration, /"users\.get": import\("@meekojs\/meeko\/framework"\)\.RpcOperation/);
    assert.doesNotMatch(declaration, /server[\\/]api|server[\\/]rpc|server[\\/]services/);
    const publicManifest = JSON.parse(await readFile(generated.manifest, "utf8")) as { api: Array<{ clientKey: string }>; rpc: Array<{ id: string }> };
    assert.equal(publicManifest.api.length, 3);
    assert.equal(publicManifest.rpc[0]?.id, "users.get");
    assert.doesNotMatch(JSON.stringify(publicManifest), /"file"/);
    const consumer = join(root, "consumer.ts");
    await writeFile(consumer, `import { createApiClient, createRpcClient } from "@meekojs/meeko/framework";
import type { ApiContract, RpcContract } from "./.meeko/types/server-contracts.js";
declare const manifest: { api: readonly [{ clientKey: "users.byId"; pathname: "/api/users/[id]"; method: "GET" }]; rpc: readonly [{ id: "users.get"; pathname: "/_meeko/rpc/users/get" }] };
const api = createApiClient<ApiContract>(manifest);
const rpc = createRpcClient<RpcContract>(manifest);
const user: Promise<{ id: string; name: string }> = api.users.byId.get({ params: { id: "1" } });
const listing: Promise<{ id: string; name: string }> = api.users.get();
const result: Promise<{ id: string; name: string }> = rpc.users.get({ id: "1" });
void user; void listing; void result;
// @ts-expect-error path ID must be a string
api.users.byId.get({ params: { id: 2 } });
// @ts-expect-error body must contain name
api.users.post({ body: { wrong: true } });
// @ts-expect-error RPC input must contain id
rpc.users.get({ wrong: true });
`);
    await execFileAsync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.json")]);
    const cli = await execFileAsync(process.execPath, [resolve("dist/cli.js"), "routes", root]);
    assert.match(cli.stdout, /server-contracts\.d\.ts/);
    assert.match(cli.stdout, /server\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server contract generator rejects private schema types", async () => {
  const root = await fixture();
  try {
    const privatePath = join(root, "server", "private.ts");
    await writeFile(privatePath, `export const privateSchema = { "~standard": { version: 1, types: undefined as unknown as { input: string; output: string } } };`);
    const handler = join(root, "server", "api", "users", "[id].get.ts");
    await writeFile(handler, `import { defineApiRoute } from "@meekojs/meeko/server";
import { privateSchema } from "../../private.js";
export default defineApiRoute({ params: privateSchema, response: privateSchema, handler: async () => "private" });`);
    await assert.rejects(generateServerContracts(root), /must come from shared/);
    await writeFile(handler, `import { defineApiRoute } from "@meekojs/meeko/server";
import { userIdParams, userSchema } from "../../../shared/schemas/user.js";
export default defineApiRoute({ params: userIdParams, response: userSchema, handler: async () => ({ id: "1", name: "Ada" }) });`);
    const shared = join(root, "shared", "schemas", "user.ts");
    await writeFile(shared, `${await readFile(shared, "utf8")}\nexport type Hidden = import("../../server/private.js").Secret;\n`);
    await assert.rejects(generateServerContracts(root), /dependency escapes shared/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
