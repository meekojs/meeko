---
title: buildProject
group: advanced
since: 1.0.0
description: Builds the project like meeko build, without the preliminary check, and returns the adapter and output folder; for build scripts and tools.
symbols:
  - "@meekojs/meeko/build#buildProject"
types:
  - "@meekojs/meeko/build#BuildProjectOptions"
  - "@meekojs/meeko/build#BuildProjectResult"
related:
  - "cli:build"
  - "@meekojs/meeko/build#loadMeekoConfig"
  - "@meekojs/meeko/build#prerenderRoutes"
  - "@meekojs/meeko/framework#defineMeekoModule"
  - docs/framework.md#build-despliegue-y-verificación
  - docs/framework.md#hooks
source-hash: 36c6ebdcac534d462c1d7a575f88acbe3e0e12348a2b18890e87292134c7b730
---

`buildProject` is [`meeko build`](/en/docs/reference/meeko-build) as a function: it compiles the client with Vite, the adapter's server and prerendered pages, writes `sitemap.xml` and `robots.txt` if enabled and returns `{ adapter, output }`. The adapter comes from `options.adapter`, `server.adapter` in `meeko.config.ts` or, by default, `node`.

Unlike the command, it **does not check** the project first (neither components nor TypeScript) and does not read `.env`. Since `1.7`, in a clean project (after `meeko clean` or in a fresh CI checkout, without prior `meeko check` or `meeko dev`) it first generates declarations and `.meeko/`'s `tsconfig.*.json` files, like `meeko check`; if they already exist, it does not rewrite them. Through `1.6`, it failed with `Tsconfig not found …/.meeko/tsconfig.app.json`. Use it for custom build scripts, building multiple adapters in one process and integration tests.

## Usage

```ts
// scripts/build.ts
import { buildProject } from "@meekojs/meeko/build";

const { adapter, output } = await buildProject(process.cwd());
console.log(`build ${adapter} en ${output}`);
```

## Parameters

| Parameter         | Type                                                            | Default                       | Description                       |
| ----------------- | --------------------------------------------------------------- | ----------------------------- | --------------------------------- |
| `projectRoot`     | path                                                            | required                      | Project folder.                   |
| `options.adapter` | `"node"` \| `"bun"` \| `"deno"` \| `"cloudflare"` \| `"static"` | `server.adapter`, or `"node"` | Overrides the configured adapter. |

## Return value

A promise of `{ adapter, output }`: the adapter used and the absolute path of `.meeko/output/<adaptador>/`. The folder contains the same output as `meeko build` (see its page).

Rejects with the error from the failing step: `Adaptador desconocido: …; usa node, cloudflare, deno, bun o static`, the error for a project retaining `server/session.ts`, for a `sitemap` without a public origin, for an application unsupported by the `static` adapter, `Dynamic prerender route … requires prerenderEntries`, or Vite's error.

## Examples

### Two adapters in one script

```ts
import { buildProject } from "@meekojs/meeko/build";

for (const adapter of ["node", "cloudflare"] as const) {
  const result = await buildProject(process.cwd(), { adapter });
  console.log(result.adapter, result.output);
}
```

Each build writes its own folder; the second does not delete the first.

### Check and build, like the CLI

<!-- no-check -->

```ts
import { execFileSync } from "node:child_process";
import { buildProject } from "@meekojs/meeko/build";

execFileSync("npx", ["meeko", "check", "."], { stdio: "inherit", shell: process.platform === "win32" });
await buildProject(process.cwd());
```

`buildProject` does not run TypeScript: without the preliminary check, a type error reaches production if the code compiles with Vite.

### An integration test

<!-- no-check -->

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProject } from "@meekojs/meeko/build";

test("el build de Node sirve la portada", async () => {
  const { output } = await buildProject("tests/fixtures/app", { adapter: "node" });
  const { createNodeApp } = await import(`${output}/index.mjs`);
  const app = await createNodeApp();
  assert.equal((await app.fetch(new Request("http://localhost/"))).status, 200);
  await app.close();
});
```

## Common mistakes

### Expect the `meeko build` check

```ts bad
await buildProject(process.cwd()); // el proyecto tiene un error TS2322 en server/api
```

Vite strips types without checking them: the build completes and the error reaches production. `meeko build` runs `meeko check` first; `buildProject` does not.

<!-- no-check -->

```ts good
await checkProjectWithCli();
await buildProject(process.cwd());
```

### An adapter that does not exist

```ts bad
await buildProject(process.cwd(), { adapter: "vercel" as never });
```

Rejects with `Adaptador desconocido: vercel; usa node, cloudflare, deno, bun o static`, before compiling anything.

```ts good
import { buildProject } from "@meekojs/meeko/build";

await buildProject(process.cwd(), { adapter: "node" });
```

### Environment variables the build needs from `.env`

```ts bad
// .env: MEEKO_PUBLIC_ORIGIN=https://example.com, y sitemap: true sin site
await buildProject(process.cwd());
```

`buildProject` does not read `.env` (the CLI does): `sitemap necesita la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`.

<!-- no-check -->

```ts good
process.env.MEEKO_PUBLIC_ORIGIN ??= "https://example.com";
await buildProject(process.cwd());
```

## Notes

- **Node only.** Requires `vite` installed in the project; building and prerendering run in Node even with another adapter.
- **Modules.** Executes `meeko.config.ts` and module `setup` functions, and calls their `build:before`, `routes:resolved` and `build:done` hooks.
- **Since `1.7`.** The Node build and other server adapters include `contentSecurityPolicy`, `headers` and a new `buildId` in the manifest, and prerendering evaluates `sitemapEntries`.
- **Concurrency.** Two simultaneous builds of the same project share `.meeko/build/` and `.meeko/output/client/`: run them sequentially, as in the example.
- **Performance.** At least two Vite passes (client and server), plus one per standalone adapter and another for the Node server if `sitemap` is enabled.
