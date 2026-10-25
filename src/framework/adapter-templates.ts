/** Reads the prerender index next to a bundled entry through the runtime's `readText(file)`. */
const prerenderSource = `interface PrerenderIndex { readonly pages?: Record<string, { file: string; headOffset: number; etag: string; payload?: string }> }

function missingFile(error: unknown): boolean {
  const failure = error as { code?: unknown; name?: unknown } | undefined;
  return failure?.code === "ENOENT" || failure?.name === "NotFound";
}

// Index paths are plain file names; encode them before resolving against the output URL.
const outputFile = (file: string) => new URL(file.split("/").map(encodeURIComponent).join("/"), output);

async function prerenderSource(): Promise<PrerenderSource | undefined> {
  let index: PrerenderIndex;
  try { index = JSON.parse(await readText(outputFile("prerender/manifest.json"))) as PrerenderIndex; }
  catch (error) {
    if (missingFile(error)) return undefined;
    throw error;
  }
  const pages = index.pages ?? {};
  const cache = new Map<string, Promise<PrerenderedPage>>();
  const read = (file: string) => readText(outputFile(\`prerender/\${file}\`));
  return {
    get(pathname) {
      if (!Object.hasOwn(pages, pathname)) return Promise.resolve(undefined);
      let page = cache.get(pathname);
      if (!page) {
        const entry = pages[pathname]!;
        page = (async () => {
          const html = await read(entry.file);
          const payload = entry.payload ? await read(entry.payload) : undefined;
          return { html, headOffset: entry.headOffset, etag: entry.etag, ...(payload === undefined ? {} : { payload }) };
        })();
        cache.set(pathname, page);
      }
      return page;
    },
  };
}
`;

/** Bun adapter entry; \`meeko build --adapter bun\` bundles it to .meeko/output/bun/index.js. */
export const bunEntrySource = `import { createBunAssetReader, createBunServer } from "@meekojs/meeko/bun";
import type { PrerenderSource, PrerenderedPage } from "@meekojs/meeko/server";
import { createApp, load, manifest } from "./entry-server.ts";

export { load, manifest };

interface BunRuntime {
  readonly env: Record<string, string | undefined>;
  file(path: URL): { text(): Promise<string> };
  serve(options: object): { readonly port: number; stop(closeActiveConnections?: boolean): void | Promise<void> };
}

const bun = (globalThis as unknown as { Bun: BunRuntime }).Bun;
const output = new URL("./", import.meta.url);
const readText = (file: URL) => bun.file(file).text();

${prerenderSource}
/** Creates the built application. */
export async function createBunApp() {
  const prerender = await prerenderSource();
  return createApp({
    production: true,
    platform: {
      name: "bun",
      env: bun.env,
      waitUntil(promise) {
        void Promise.resolve(promise).catch((error: unknown) => console.error("[meeko] background task failed", error));
      },
    },
    assets: createBunAssetReader({ root: new URL("client/", output), assets: manifest.assets ?? {} }),
    ...(prerender ? { prerender } : {}),
    ...(bun.env.PUBLIC_ORIGIN ? { publicOrigin: bun.env.PUBLIC_ORIGIN } : {}),
  });
}

/** Serves the built application; HOST, PORT and PUBLIC_ORIGIN override the defaults. */
export async function start() {
  const app = await createBunApp();
  const host = bun.env.HOST || "127.0.0.1";
  const server = bun.serve({ hostname: host, port: bun.env.PORT ? Number(bun.env.PORT) : 4173, ...createBunServer(app) });
  const visible = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  process.stdout.write(\`http://\${visible.includes(":") ? \`[\${visible}]\` : visible}:\${server.port}\\n\`);
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      try { await server.stop(true); }
      finally { await app.close(); }
    })().then(() => process.exit(0), (error: unknown) => {
      console.error("[meeko] shutdown failed", error);
      process.exit(1);
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return server;
}

if (import.meta.main) await start();
`;

/** Deno adapter entry; \`meeko build --adapter deno\` bundles it to .meeko/output/deno/main.js. */
export const denoEntrySource = `import { createDenoAssetReader, serveDeno } from "@meekojs/meeko/deno";
import type { PrerenderSource, PrerenderedPage } from "@meekojs/meeko/server";
import { createApp, load, manifest } from "./entry-server.ts";

export { load, manifest };

interface DenoRuntime {
  readonly env: { get(name: string): string | undefined; toObject(): Record<string, string> };
  readTextFile(path: URL): Promise<string>;
}

const deno = (globalThis as unknown as { Deno: DenoRuntime }).Deno;
const output = new URL("./", import.meta.url);
const readText = (file: URL) => deno.readTextFile(file);

${prerenderSource}
/** Creates the built application. */
export async function createDenoApp() {
  const prerender = await prerenderSource();
  const publicOrigin = deno.env.get("PUBLIC_ORIGIN");
  return createApp({
    production: true,
    platform: {
      name: "deno",
      env: deno.env.toObject(),
      waitUntil(promise) {
        void Promise.resolve(promise).catch((error: unknown) => console.error("[meeko] background task failed", error));
      },
    },
    assets: createDenoAssetReader({ root: new URL("client/", output), assets: manifest.assets ?? {} }),
    ...(prerender ? { prerender } : {}),
    ...(publicOrigin ? { publicOrigin } : {}),
  });
}

/** Serves the built application; HOST, PORT and PUBLIC_ORIGIN override the defaults. */
export async function start() {
  const app = await createDenoApp();
  const port = deno.env.get("PORT");
  const server = await serveDeno(app, {
    host: deno.env.get("HOST") || "127.0.0.1",
    port: port ? Number(port) : 4173,
    handleSignals: true,
  });
  console.log(server.url);
  return server;
}

if (import.meta.main) await start();
`;
