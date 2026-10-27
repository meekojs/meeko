import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadSocketChannels } from "../src/framework-server/discovery.ts";
import { discoverServerManifest } from "../src/framework-server/manifest-discovery.ts";
import { generateSocketContracts } from "../src/framework/socket-contracts-generate.ts";

test("Socket contracts discover channels and generate only shared schema imports", async (context) => {
  const base = resolve(".meeko");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "socket-contract-test-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, "shared", "schemas"), { recursive: true });
  await mkdir(join(root, "server", "socket"), { recursive: true });
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" } }));
  const sharedFile = join(root, "shared", "schemas", "chat.ts");
  await writeFile(sharedFile, "const schema = <I, O = I>() => ({ '~standard': { version: 1 as const, types: undefined as unknown as { input: I; output: O }, validate: (value: unknown) => ({ value: value as O }) } });\nexport const chatInput = schema<{ text: string }>();\nexport const chatOutput = schema<undefined, { text: string }>();\n");
  const channelFile = join(root, "server", "socket", "chat.ts");
  await writeFile(channelFile, "import { chatInput, chatOutput } from '../../shared/schemas/chat.js';\nexport default defineSocketChannel({ clientToServer: { message: chatInput }, serverToClient: { message: chatOutput } });\n");
  const manifest = await discoverServerManifest(root);
  assert.deepEqual(manifest.socket?.map((entry) => entry.name), ["chat"]);
  assert.deepEqual((await loadSocketChannels(manifest, async () => ({ default: { channel: "chat" } }))).chat, { channel: "chat" });
  const generated = await generateSocketContracts(root);
  assert.equal(generated.count, 1);
  const code = await readFile(generated.file, "utf8");
  assert.match(code, /import \* as __schema0 from "\.\.\/\.\.\/shared\/schemas\/chat\.js"/);
  assert.match(code, /"message": __schema0\["chatInput"\]/);
  assert.match(code, /"message": __schema0\["chatOutput"\]/);
  assert.doesNotMatch(code, /server\/socket/);
  const unchanged = await generateSocketContracts(root);
  assert.equal(unchanged.file, generated.file);

  await writeFile(channelFile, "import { privateSchema } from '../private.js';\nexport default defineSocketChannel({ clientToServer: { message: privateSchema }, serverToClient: {} });\n");
  await writeFile(join(root, "server", "private.ts"), "export const privateSchema = {};\n");
  await assert.rejects(generateSocketContracts(root), /debe venir de shared\//);

  await writeFile(sharedFile, "const schema = <I, O = I>() => ({ '~standard': { version: 1 as const, types: undefined as unknown as { input: I; output: O }, validate: (value: unknown) => ({ value: value as O }) } });\nexport const safeInput = schema<{ text: string }>();\nexport const unsafeInput = schema<any>();\nexport const unsafeOutput = schema<string, unknown>();\nexport const unsafeNestedInput = schema<{ message: { data: any } }>();\nexport const unsafeNestedOutput = schema<string, readonly { data: never }[]>();\n");
  await writeFile(channelFile, "import { unsafeInput, unsafeOutput } from '../../shared/schemas/chat.js';\nexport default defineSocketChannel({ clientToServer: { message: unsafeInput }, serverToClient: { message: unsafeOutput } });\n");
  await assert.rejects(generateSocketContracts(root), /clientToServer\.message debe exponer tipos de entrada y salida de Standard Schema concretos/);

  await writeFile(channelFile, "import { unsafeOutput } from '../../shared/schemas/chat.js';\nexport default defineSocketChannel({ clientToServer: {}, serverToClient: { message: unsafeOutput } });\n");
  await assert.rejects(generateSocketContracts(root), /serverToClient\.message debe exponer tipos de entrada y salida de Standard Schema concretos/);

  await writeFile(channelFile, "import { unsafeNestedInput, unsafeNestedOutput } from '../../shared/schemas/chat.js';\nexport default defineSocketChannel({ clientToServer: { message: unsafeNestedInput }, serverToClient: { message: unsafeNestedOutput } });\n");
  await assert.rejects(generateSocketContracts(root), /clientToServer\.message debe exponer tipos de entrada y salida de Standard Schema concretos/);

  await writeFile(channelFile, "import { safeInput, unsafeNestedOutput } from '../../shared/schemas/chat.js';\nexport default defineSocketChannel({ clientToServer: { message: safeInput }, serverToClient: { message: unsafeNestedOutput } });\n");
  await assert.rejects(generateSocketContracts(root), /serverToClient\.message debe exponer tipos de entrada y salida de Standard Schema concretos/);
});

test("Socket contracts accept shorthand properties that reference imported shared schemas", async (context) => {
  const base = resolve(".meeko");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "socket-contract-test-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, "shared", "schemas"), { recursive: true });
  await mkdir(join(root, "server", "socket"), { recursive: true });
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" } }));
  await writeFile(join(root, "shared", "schemas", "kitchen.ts"), "const schema = <I, O = I>() => ({ '~standard': { version: 1 as const, types: undefined as unknown as { input: I; output: O }, validate: (value: unknown) => ({ value: value as O }) } });\nexport const kitchenChanged = schema<{ orderId: string; status: string }>();\nexport const subscribe = schema<{ storeId: string }>();\nexport const ping = schema<{ at: number }>();\n");
  const channelFile = join(root, "server", "socket", "operations.ts");
  await writeFile(channelFile, "import { kitchenChanged, ping, subscribe } from '../../shared/schemas/kitchen.js';\nexport default defineSocketChannel({ clientToServer: { subscribe, ping: ping }, serverToClient: { kitchenChanged } });\n");
  const code = await readFile((await generateSocketContracts(root)).file, "utf8");
  assert.match(code, /"subscribe": __schema0\["subscribe"\]/);
  assert.match(code, /"ping": __schema0\["ping"\]/);
  assert.match(code, /"kitchenChanged": __schema0\["kitchenChanged"\]/);

  await writeFile(join(root, "server", "local.ts"), "export const local = { '~standard': { version: 1, validate: (value: unknown) => ({ value }) } };\n");
  await writeFile(channelFile, "import { kitchenChanged } from '../../shared/schemas/kitchen.js';\nimport { local } from '../local.js';\nexport default defineSocketChannel({ clientToServer: { local }, serverToClient: { kitchenChanged } });\n");
  await assert.rejects(generateSocketContracts(root), /clientToServer\.local debe venir de shared\//);

  await writeFile(channelFile, "import { kitchenChanged } from '../../shared/schemas/kitchen.js';\nconst events = { kitchenChanged };\nexport default defineSocketChannel({ clientToServer: {}, serverToClient: { ...events } });\n");
  await assert.rejects(generateSocketContracts(root), /serverToClient sólo admite propiedades con nombre/);
});
