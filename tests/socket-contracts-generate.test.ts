import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { discoverServerManifest, loadSocketChannels } from "../src/framework-server/discovery.ts";
import { generateSocketContracts } from "../src/framework/socket-contracts-generate.ts";

test("Socket contracts discover channels and generate only shared schema imports", async (context) => {
  const base = resolve(".meeko");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "socket-contract-test-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, "shared", "schemas"), { recursive: true });
  await mkdir(join(root, "server", "socket"), { recursive: true });
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" } }));
  await writeFile(join(root, "shared", "schemas", "chat.ts"), "export const chatInput = { '~standard': { version: 1, validate: (value: unknown) => ({ value }) } };\nexport const chatOutput = chatInput;\n");
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
  await assert.rejects(generateSocketContracts(root), /must come from shared\//);
});
