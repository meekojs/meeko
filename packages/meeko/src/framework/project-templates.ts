/** Vite entry modules generated for a framework application. */
export const clientEntrySource = `import { mountClientApp, readHydrationDocument, type ClientComponent, type ClientRoute, type RouteMiddleware } from "@meekojs/meeko/framework";
import { reportHydrationError } from "@meekojs/meeko/internal";
import { modules as pages } from "virtual:meeko-client-pages";
import { modules as clientRoutes } from "virtual:meeko-client-routes";
import { documentConfig, errorPage, routes, viewTransitions } from "virtual:meeko-manifest/client";
import { plugins } from "virtual:meeko-plugins/client";
import { middleware as middlewareModules, namedMiddleware } from "virtual:meeko-middleware/client";

const routeMiddleware = (file: string, module: unknown): RouteMiddleware => {
  const middleware = (module as { default?: unknown }).default;
  if (typeof middleware !== "function") throw new Error(file + ": route middleware requires a default function export");
  return middleware as RouteMiddleware;
};
// Global middleware runs on every navigation, in the server's order.
// The parameters are typed here so that the entry does not depend on the virtual module's declaration.
const loadMiddleware = async (): Promise<RouteMiddleware[]> => middlewareModules.map(([file, module]: readonly [string, unknown]) => routeMiddleware(file, module));
// Named middleware loads with the first navigation to a route that declares it.
const loadNamedMiddleware = async (file: string): Promise<RouteMiddleware> => {
  const load = namedMiddleware[file];
  if (!load) throw new Error("Route middleware module missing: " + file);
  return routeMiddleware(file, await load());
};

// Module stylesheets followed by the optional application stylesheet, processed by Vite/PostCSS.
import "virtual:meeko-global-styles";

// The server's root and payload, not an element of the page content with the same id.
const { root, payload } = readHydrationDocument(document);

const hydrationStart = performance.now();
// In meeko dev, a page that does not hydrate says so in the browser: console.error and Vite's overlay.
const mounted = mountClientApp({
  root, payload, routes, errorPage, viewTransitions, serverData: true, loadMiddleware, loadNamedMiddleware, plugins,
  // The head that the server renders from meeko.config.ts and the modules; useHead and navigation update it.
  ...(documentConfig ? { document: documentConfig } : {}),
  async loadPage(file) {
    const load = pages[file];
    if (!load) throw new Error("Page module missing: " + file);
    return await load() as ClientComponent;
  },
  // Only render: "client" sidecars are bundled; other routes fetch their data from the server.
  async loadClientRoute(file) {
    const load = clientRoutes[file];
    if (!load) throw new Error("Client route module missing: " + file);
    const module = await load() as { route?: ClientRoute; default?: ClientRoute };
    return module.route ?? module.default ?? (module as ClientRoute);
  },
});
try {
  await mounted;
} catch (error) {
  // The error still reaches the terminal of meeko dev; production builds drop this branch.
  if (import.meta.env.DEV) reportHydrationError(error);
  throw error;
}
performance.measure("meeko-hydration", { start: hydrationStart, end: performance.now() });
`

/**
 * The client entry of the static adapter: navigation reads each page's payload file,
 * `<path>/index.meeko.json`, because a static host does not negotiate `Accept`.
 */
export const staticClientEntrySource = clientEntrySource.replace('serverData: true,', 'serverData: "static",')
if (staticClientEntrySource === clientEntrySource) throw new Error('The static client entry template lost its serverData option')

/** Adapter-neutral application entry: the baked manifest plus its module map. */
export const serverEntrySource = `import { createServerApp, type ServerApp, type ServerAppOptions } from "@meekojs/meeko/server";
import { appName, load, loadRedis, manifest, plugins, runtime } from "virtual:meeko-server-app";

export { load, manifest };

export type AppHostOptions = Omit<ServerAppOptions, "manifest" | "load" | "runtime" | "plugins" | "appName" | "loadRedis">;

export function createApp(options: AppHostOptions): Promise<ServerApp> {
  return createServerApp({ ...options, manifest, load, runtime, plugins, appName, loadRedis });
}
`

/** Node adapter entry; \`meeko build\` bundles it to .meeko/output/node/index.mjs. */
export const nodeEntrySource = `import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listeningMessage, meekoEnv } from "@meekojs/meeko/internal";
import { createNodeAssetReader, serveNode } from "@meekojs/meeko/node";
import type { PrerenderSource, PrerenderedPage } from "@meekojs/meeko/server";
import { nodeServer } from "virtual:meeko-server-app";
import { createApp, load, manifest } from "./entry-server.ts";

export { load, manifest };

const output = dirname(fileURLToPath(import.meta.url));

// The project root: MEEKO_ROOT for an output deployed elsewhere, or the folder three levels up (.meeko/output/node).
const projectRoot = process.env.MEEKO_ROOT ? resolve(process.env.MEEKO_ROOT) : resolve(output, "../../..");

interface PrerenderIndex { readonly pages?: Record<string, { file: string; headOffset: number; etag: string; payload?: string; scriptHashes?: string[]; styleHashes?: string[] }> }

async function prerenderSource(): Promise<PrerenderSource | undefined> {
  let index: PrerenderIndex;
  try { index = JSON.parse(await readFile(join(output, "prerender", "manifest.json"), "utf8")) as PrerenderIndex; }
  catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return undefined;
    throw error;
  }
  const pages = index.pages ?? {};
  const cache = new Map<string, Promise<PrerenderedPage>>();
  const read = (file: string) => readFile(join(output, "prerender", ...file.split("/")), "utf8");
  return {
    get(pathname) {
      if (!Object.hasOwn(pages, pathname)) return Promise.resolve(undefined);
      const cached = cache.get(pathname);
      if (cached) return cached;
      const entry = pages[pathname]!;
      const page = (async () => {
        const html = await read(entry.file);
        const payload = entry.payload ? await read(entry.payload) : undefined;
        return { html, headOffset: entry.headOffset, etag: entry.etag, ...(payload === undefined ? {} : { payload }), ...(entry.scriptHashes ? { scriptHashes: entry.scriptHashes } : {}), ...(entry.styleHashes ? { styleHashes: entry.styleHashes } : {}) };
      })();
      cache.set(pathname, page);
      // A failed read is retried by the next request instead of being cached.
      page.catch(() => { if (cache.get(pathname) === page) cache.delete(pathname); });
      return page;
    },
  };
}

/** Creates the built application; \`prerendering\` is used by \`meeko build\`. */
export async function createNodeApp(options: { readonly prerendering?: boolean } = {}) {
  const prerender = options.prerendering ? undefined : await prerenderSource();
  const publicOrigin = meekoEnv(process.env, "PUBLIC_ORIGIN");
  return createApp({
    production: true,
    prerendering: options.prerendering === true,
    root: projectRoot,
    platform: {
      name: "node",
      env: process.env,
      // createServerApp tracks these tasks for close() and reports their failures.
      waitUntil() {},
    },
    assets: createNodeAssetReader({ root: join(output, "client"), assets: manifest.assets ?? {} }),
    ...(prerender ? { prerender } : {}),
    ...(publicOrigin ? { publicOrigin } : {}),
  });
}

/** Serves the built application; MEEKO_HOST, MEEKO_PORT (or PORT) and MEEKO_PUBLIC_ORIGIN override the build configuration. */
export async function start() {
  const app = await createNodeApp();
  const port = meekoEnv(process.env, "PORT");
  const host = meekoEnv(process.env, "HOST") || nodeServer.host;
  const server = await serveNode(app, {
    host,
    port: port ? Number(port) : nodeServer.port,
    handleSignals: true,
  });
  // Shows localhost for loopback and the network addresses with 0.0.0.0 or ::; server.url keeps the listening address.
  process.stdout.write(listeningMessage(host, Number(new URL(server.url).port) || 80, networkInterfaces));
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await start();
`

/** Standalone fallback shared by SSR and browser navigation. */
export const defaultErrorPageSource = `<script lang="ts">
	import logo from "./meeko-logo.webp?no-inline"

	const props = defineProps<{ status: number; message: string }>()
</script>

<template>
	<main class="error" lang="en">
		<div class="panel">
			<div class="visual">
				<img class="logo" bind:src="logo" alt="Meeko" width="96" height="96" />
				<p class="status">{props.status}</p>
			</div>
			<h1>{props.status === 404 ? 'Page not found' : props.status >= 500 ? 'Something went wrong' : 'Request failed'}</h1>
			<p class="detail">{props.status === 404 ? 'The page may have moved or the address may be incorrect.' : 'This page couldn’t load. You can return to the home page.'}</p>
			<a href="/">Back to home</a>
		</div>
	</main>
</template>

<style scoped>
	.error {
		box-sizing: border-box;
		display: grid;
		min-height: 95vh;
		place-items: center;
		padding: 2rem 1rem;
		font: 1rem/1.5 system-ui, sans-serif;
		color: #fafafa;
		background: #000;
	}
	.panel {
		box-sizing: border-box;
		width: min(100%, 34rem);
		padding: clamp(1.75rem, 6vw, 3.5rem);
		border: 1px solid #303030;
		border-radius: 1.5rem;
		background: #101010;
		box-shadow: 0 1rem 3rem #ffffff08;
	}
	.visual {
		display: flex;
		align-items: center;
		gap: clamp(.75rem, 4vw, 2rem);
		margin-bottom: 1.5rem;
	}
	.logo {
		display: block;
		width: clamp(3.5rem, 15vw, 6rem);
		height: auto;
	}
	@media (prefers-reduced-motion: no-preference) {
		.logo {
			animation: meeko-logo-float 2.4s ease-in-out 2;
		}
	}
	@keyframes meeko-logo-float {
		0%, 100% { transform: translateY(0) rotate(-4deg); }
		50% { transform: translateY(-8px) rotate(4deg); }
	}
	.status {
		margin: 0;
		font-size: clamp(4rem, 12vw, 7rem);
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		line-height: .9;
		letter-spacing: -.08em;
		color: #f3eee7;
	}
	h1 {
		margin: 0;
		font-size: clamp(1.6rem, 5vw, 2.25rem);
		line-height: 1.15;
		letter-spacing: -.04em;
	}
	.detail {
		margin: .75rem 0 1.5rem;
		color: #b7b7b7;
	}
	a {
		display: inline-block;
		padding: .65rem 1rem;
		border-radius: .6rem;
		color: #111;
		background: #f3eee7;
		font-weight: 600;
		text-decoration: none;
	}
	a:hover {
		background: #ddd2c2;
	}
	a:focus-visible {
		outline: 2px solid #f3eee7;
		outline-offset: 4px;
	}
</style>
`
