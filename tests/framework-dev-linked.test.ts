import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { initFrameworkProject } from "../src/framework/init.ts";
import { repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

const page = (version: string) => `<script lang="ts">
export interface Props {
  params: Record<string, string>;
  search: Record<string, string | string[]>;
  data?: unknown;
}

const visits = useState("visits", () => 41);
const store = useCounterStore();
</script>

<template><p id="state">{visits.value + 1}:{store.label.value}:${version}</p></template>
`;

// A package linked outside node_modules (pnpm link:, a workspace) is not
// externalized by Vite. Editing a page invalidates Vite's whole SSR graph; an
// inlined Meeko was then evaluated again beside the instance that owns the
// running app, and useState lost its framework context.
test("useState keeps one Meeko instance in development with a linked package", { timeout: 40_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "dev-linked", () => stopChild(child));
  const repository = repositoryRoot;
  await initFrameworkProject(root);
  await mkdir(join(root, "app", "stores"), { recursive: true });
  await writeFile(join(root, "app", "stores", "counter.ts"),
    "import { useState } from '@meekojs/meeko/framework';\nexport function useCounterStore() { return { label: useState('label', () => 'stored') }; }\n");
  const pageFile = join(root, "app", "pages", "state.meeko");
  await writeFile(pageFile, page("v1"));
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const running = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await new Promise<void>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (logs.includes(origin)) { clearInterval(timer); done(); }
      else if (running.exitCode !== null) { clearInterval(timer); fail(new Error(logs)); }
      else if (Date.now() - start > 20_000) { clearInterval(timer); fail(new Error(`Starter did not listen: ${logs}`)); }
    }, 25);
  });
  const first = await fetch(`${origin}/state`, { headers: { accept: "text/html" } });
  const firstHtml = await first.text();
  assert.equal(first.status, 200, logs);
  assert.match(firstHtml, /<p id="state">(?:<!--[^>]*-->)?42(?:<!--[^>]*-->)?:(?:<!--[^>]*-->)?stored(?:<!--[^>]*-->)?:v1<\/p>/);
  await writeFile(pageFile, page("v2"));
  const start = Date.now();
  let status = 0;
  let html = "";
  while (Date.now() - start < 15_000) {
    const response = await fetch(`${origin}/state`, { headers: { accept: "text/html" } });
    status = response.status;
    html = await response.text();
    if (status !== 200 || html.includes(":v2</p>")) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(status, 200, logs);
  assert.match(html, /:v2<\/p>/);
  assert.doesNotMatch(logs, /Missing Meeko context/);
});
