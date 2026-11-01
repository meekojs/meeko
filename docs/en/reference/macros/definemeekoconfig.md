---
title: defineMeekoConfig
group: macros
since: 1.0.0
description: Declares typed meeko.config.ts configuration (layers, modules, auto-imports, aliases, server, CSS, document, sitemap and theme) without changing it.
symbols:
  - "@meekojs/meeko/framework#defineMeekoConfig"
types:
  - "@meekojs/meeko/framework#MeekoConfig"
related:
  - "@meekojs/meeko/framework#defineMeekoModule"
  - "config:server"
  - "config:layers"
  - "config:modules"
  - "config:imports"
  - "config:theme"
  - "config:devtools"
  - docs/framework.md#configuración
  - docs/framework.md#layers
source-hash: 7e21fb3923c215c7eda057e7d59fa428892da76145da32da568aef4cf646538b
---

`defineMeekoConfig(config)` declares project configuration in `meeko.config.ts`. At runtime it returns the same object; its role is to provide types, completion and documentation for each key and preserve literals (`const T`), so `server.adapter` stays discriminated and each adapter's options are checked. Since `1.8`, it also types and documents each module key in `modules` without importing anything (see [`modules`](../config/config-modules.md)).

`meeko dev`, `meeko build`, `meeko check`, the Vite plugin and the language server read the default export of `meeko.config.ts`. Each key has its own page in this reference's “Configuration” group.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: { adapter: "node", port: 4173 },
  site: "https://example.com",
  sitemap: true,
  theme: true,
});
```

## Parameters

| Key                  | Type                                      | Default               | Description                                                                                                                                                                                 |
| -------------------- | ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layers`             | `string[]`                                | `[]`                  | Folders or packages contributing pages, components, layouts and auto-imports.                                                                                                               |
| `extends`            | `string[]`                                | `[]`                  | Deprecated alias for `layers`.                                                                                                                                                              |
| `modules`            | package names or paths                    | `[]`                  | Meeko modules (`defineMeekoModule`), by name; their options go in their key.                                                                                                                |
| `imports`            | `{ appDirs?, sharedDirs?, serverDirs? }`  | standard folders      | Extra auto-import folders per scope.                                                                                                                                                        |
| `alias`              | `Record<string, string \| false>`         | none                  | Custom path aliases, in addition to `~/`, `@/`, `#shared/` and `#server/`.                                                                                                                  |
| `server`             | `{ adapter, … }`                          | `{ adapter: "node" }` | Adapter (`"node"`, `"bun"`, `"deno"`, `"cloudflare"` or `"static"`) and its options: `host`, `port`, `contentSecurityPolicy`, `headers`… **`adapter` is required if you declare `server`.** |
| `css`                | `{ scopeAttribute?: "all" \| "matched" }` | `"all"`               | Which elements receive the `<style scoped>` attribute.                                                                                                                                      |
| `document`           | `DocumentConfig`                          | none                  | Application-wide `<head>`, `lang` and document attributes.                                                                                                                                  |
| `dev`                | `{ serverLogs? }`                         | none                  | `meeko dev` options.                                                                                                                                                                        |
| `devtools`           | `boolean` or `{ panel?, position? }`      | `false`               | Since `1.8`, `meeko dev` mounts the Meeko DevTools panel on the page.                                                                                                                       |
| `site`               | URL                                       | `MEEKO_PUBLIC_ORIGIN` | Public origin, for the sitemap and absolute URLs.                                                                                                                                           |
| `sitemap` / `robots` | `boolean` or options                      | `false`               | Write `sitemap.xml` and `robots.txt` during the build.                                                                                                                                      |
| `theme`              | `boolean` or options                      | `false`               | Flicker-free light/dark theme and `<MeekoThemeToggle>`.                                                                                                                                     |

Each module in `modules` adds its own key (its `meta.configKey`) with its options: `i18n` for `@meekojs/i18n`, `ui` for `@meekojs/ui`. Meeko types it through `.meeko/types/config.d.ts`, generated by `meeko dev`, `meeko check` and the editor in a trusted workspace; `meeko check` checks `meeko.config.ts` with these types since `1.8`.

## Return value

The same object with its literal type. Changing `meeko.config.ts` requires restarting `meeko dev`.

## Examples

### Layers, modules and auto-imports

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  layers: ["./layers/base"],
  modules: ["@acme/seo", "./modules/accent"],
  accent: { initial: "teal" },
  imports: {
    appDirs: ["app/services"],
    sharedDirs: ["shared/validators"],
    serverDirs: ["server/services", "server/repositories"],
  },
  alias: { "#emails": "./server/emails" },
});
```

### A static site with CSP

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "static",
    contentSecurityPolicy: { "default-src": ["'self'"], "img-src": ["'self'", "data:"] },
  },
  site: "https://docs.example.com",
  sitemap: { exclude: ["/borradores/*"] },
  robots: { disallow: ["/borradores/"] },
});
```

### Cloudflare Workers

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: { adapter: "cloudflare" },
  css: { scopeAttribute: "matched" },
  document: { lang: "es" },
});
```

## Common mistakes

### `server` without `adapter`

```ts bad
export default defineMeekoConfig({ server: { port: 3000 } });
```

`meeko check` reports `TS2322: Type '{ port: number; }' is not assignable to type 'MeekoServerConfig | undefined'.` with `Property 'adapter' is missing`, and configuration loading fails with `meeko.config.ts: server.adapter debe ser "node", "cloudflare", "deno", "bun" o "static"`.

<!-- no-check -->

```ts good
export default defineMeekoConfig({ server: { adapter: "node", port: 3000 } });
```

### An adapter that does not exist

```ts bad
export default defineMeekoConfig({ server: { adapter: "vercel" } });
```

`meeko check` reports `TS2322: Type '"vercel"' is not assignable to type '"bun" | "cloudflare" | "deno" | "node" | "static"'.` and the same failure when loading configuration.

<!-- no-check -->

```ts good
export default defineMeekoConfig({ server: { adapter: "node" } });
```

### A misspelled key

`defineMeekoConfig` accepts unknown keys because modules add their own (`meta.configKey`), even without augmenting `MeekoConfig`: rejecting them in types would break valid `1.x` configurations. The misspelled option is ignored, and since `1.7`, module loading (`meeko dev`, `meeko build`, `meeko check`) warns with the most similar key; since `1.8`, a key for an installed module missing from `modules` produces warning `MEEK127`, naming the missing entry: `[meeko] Aviso: meeko.config.ts tiene la clave desconocida "sitmap", que Meeko ignora. ¿Quisiste decir "sitemap"?`. Through `1.6`, there was no warning.

```ts bad
export default defineMeekoConfig({ sitmap: true });
```

<!-- no-check -->

```ts good
export default defineMeekoConfig({ site: "https://example.com", sitemap: true });
```

## Notes

- **Where it runs.** In Node, when loading configuration: never in the browser or production server, which receives only what the build writes in the manifest. Do not import application code in `meeko.config.ts`.
- **Environment variables.** `meeko dev`, `build`, `start`, `preview` and `check` read the project's `.env` before loading configuration; `MEEKO_PORT` and `MEEKO_HOST` override `server.port` and `server.host`.
- **Secrets.** Configuration ends up in the build: read secrets on the server, in `server/runtime.ts`, not here.
- **Sitemap.** `sitemap.xml` URLs are absolute: with `sitemap` and without `site` or `MEEKO_PUBLIC_ORIGIN`, `meeko build` stops before compiling. `meeko check` does not check this.
- **Without `defineMeekoConfig`.** An object exported without it also loads, but without types or completion.
