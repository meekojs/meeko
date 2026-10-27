import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { buildProject } from "../src/framework/project.ts";
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

const schema = "export const echoMessage = { '~standard': { version: 1 as const, vendor: 'test', types: undefined as unknown as { input: { text: string }; output: { text: string } }, validate(value: unknown) { return value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string' ? { value: value as { text: string } } : { issues: [{ message: 'text' }] }; } } };\n";

const files: Record<string, string> = {
  "shared/schemas/echo.ts": schema,
  "server/socket/echo.ts": "import { defineSocketChannel } from '@meekojs/meeko/server';\nimport { echoMessage } from '../../shared/schemas/echo.js';\nexport default defineSocketChannel({ clientToServer: { message: echoMessage }, serverToClient: { message: echoMessage }, handlers: { message: ({ payload, emit }) => emit('message', payload) } });\n",
  "server/api/greeting.get.ts": "import { defineApiRoute } from '@meekojs/meeko/server';\nimport { echoMessage } from '../../shared/schemas/echo.js';\nexport default defineApiRoute({ response: echoMessage, handler: () => ({ text: 'hola' }) });\n",
  // A shared composable: it runs in the SSR graph and in the browser, like a component.
  "app/composables/useEcho.ts": [
    "export function useEcho(onMessage: (text: string) => void) {",
    "  const channel = typeof window === 'undefined' ? undefined : useSocket('echo');",
    "  const open = computed(() => channel?.state.value === 'open');",
    "  channel?.on('message', (payload) => onMessage(payload.text));",
    "  const greet = async (): Promise<string> => (await api.greeting.get()).text;",
    "  return { open, greet };",
    "}",
    "",
  ].join("\n"),
  "app/pages/echo.meeko": [
    '<script lang="ts">',
    "export interface Props {",
    "  params: Record<string, string>;",
    "  search: Record<string, string | string[]>;",
    "  data?: unknown;",
    "}",
    'const last = signal("");',
    "const echo = useEcho((text) => { last.value = text; });",
    "</script>",
    '<template><p id="echo">{echo.open.value ? "open" : "closed"}:{last.value}</p></template>',
    "",
  ].join("\n"),
  // Since 1.1 a component or page does not need <script lang="ts">.
  "app/components/AppNote.meeko": '<template><em class="note">nota</em></template>\n',
  "app/components/AppBadge.meeko": [
    '<script lang="ts">',
    'const props = defineProps<{ variant: "primary" | "secondary"; disabled?: boolean; label?: string }>();',
    "</script>",
    '<template><span class="badge" bind:data-variant="props.variant">{props.label ?? ""}:{String(props.disabled ?? false)}</span></template>',
    "",
  ].join("\n"),
  "app/pages/plain.meeko": "<template><h1>Plain</h1><AppNote /></template>\n",
  "app/pages/data.meeko": '<script server lang="ts">\nexport const title = "Datos del servidor";\n</script>\n<template><h1 id="title">{title}</h1></template>\n',
  // Static attributes are string props, checked against the child's props.
  "app/pages/badge.meeko": '<template><AppBadge variant="primary" disabled label="Hola" /><component is="AppBadge" variant="secondary"></component></template>\n',
};

test("composables with framework autoimports, pages without a script and static props pass check, render in dev SSR and build", { timeout: 120_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "framework-dx", () => stopChild(child));
  await initFrameworkProject(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repositoryRoot, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repositoryRoot, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");

  await checkFrameworkProject(root);

  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const running = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "dev", root], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_PUBLIC_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await new Promise<void>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (logs.includes(origin)) { clearInterval(timer); done(); }
      else if (running.exitCode !== null) { clearInterval(timer); fail(new Error(`Dev server exited before listening: ${logs}`)); }
      else if (Date.now() - start > 30_000) { clearInterval(timer); fail(new Error(`Dev server did not listen: ${logs}`)); }
    }, 25);
  });
  const response = await fetch(`${origin}/echo`);
  const html = await response.text();
  assert.equal(response.status, 200, `${html}\n${logs}`);
  assert.match(html, /<p id="echo">(?:<!--[^>]*-->)*closed(?:<!--[^>]*-->)*:/);
  // The browser graph still gets the browser client.
  const composable = await (await fetch(`${origin}/app/composables/useEcho.ts`)).text();
  assert.match(composable, /clients\.client\.(?:js|ts)/);
  assert.doesNotMatch(composable, /clients\.server/);
  const page = async (path: string): Promise<string> => {
    const result = await fetch(`${origin}${path}`);
    const body = await result.text();
    assert.equal(result.status, 200, `${path}\n${body}\n${logs}`);
    return body.replace(/<!--[^>]*-->/g, "");
  };
  assert.match(await page("/plain"), /<h1[^>]*>Plain<\/h1><em class="note"[^>]*>nota<\/em>/);
  assert.match(await page("/data"), /<h1 id="title"[^>]*>Datos del servidor<\/h1>/);
  const badges = await page("/badge");
  assert.match(badges, /<span class="badge"[^>]* data-variant="primary"[^>]*>Hola:true<\/span>/);
  assert.match(badges, /<span class="badge"[^>]* data-variant="secondary"[^>]*>:false<\/span>/);
  await stopChild(child);
  child = undefined;

  await buildProject(root);
});
