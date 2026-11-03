---
title: loadMeekoConfig
group: advanced
since: 1.0.0
description: Loads and validates a project's meeko.config.ts (or .mts, .js, .mjs) with Node 24 and returns its configuration, or {} if absent.
symbols:
  - "@meekojs/meeko/build#loadMeekoConfig"
types:
  - "@meekojs/meeko/build#MeekoConfig"
related:
  - "@meekojs/meeko/framework#defineMeekoConfig"
  - "@meekojs/meeko/build#buildProject"
  - "config:server"
  - "config:layers"
  - docs/framework.md#configuración
source-hash: 59dca33dee089452ac0982009f272f055bebe6fd5a6f5fdf072fbb6f6200bfc1
---

`loadMeekoConfig` imports a project's configuration like `meeko dev`, `meeko check` and `meeko build`: it looks for `meeko.config.ts`, `.mts`, `.js` or `.mjs` in the folder, imports it using Node 24's TypeScript support (without compiling or bundling) and validates fields Meeko knows. It returns the default export, or `{}` if the project has no configuration.

Use it for tools that need to read project configuration: a deployment script checking `server.adapter`, a generator reading `site`, a test.

## Usage

```ts
import { loadMeekoConfig } from "@meekojs/meeko/build";

const config = await loadMeekoConfig(process.cwd());
const adapter = config.server?.adapter ?? "node";
console.log(`adapter: ${adapter}, site: ${config.site ?? "(no site)"}`);
```

## Parameters

| Parameter     | Type | Default  | Description                                 |
| ------------- | ---- | -------- | ------------------------------------------- |
| `projectRoot` | path | required | Project folder containing `meeko.config.*`. |

## Return value

A promise of `MeekoConfig`: the default-exported object unchanged (with or without `defineMeekoConfig`). It does not resolve modules or layers, apply defaults or execute module `setup` functions: it returns what you wrote.

| Case                                                   | Result                                                                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No configuration file                                  | `{}`                                                                                                                                                                  |
| One valid file                                         | The default export.                                                                                                                                                   |
| Multiple files (`meeko.config.ts` and `.mjs`)          | Rejects with `Error: Hay varios archivos de configuración de Meeko: …`                                                                                                |
| A field with an invalid value                          | Rejects with `TypeError: <archivo>: server.adapter debe ser "node", "cloudflare", "deno", "bun" o "static"` and similar errors.                                       |
| The file cannot be imported                            | Rejects with `Error: No se puede cargar <archivo>: <error de Node>`, with the original in `cause`.                                                                    |
| A key read by neither Meeko nor a module (since `1.7`) | Warns on standard error and returns it unchanged: `[meeko] Aviso: meeko.config.ts tiene la clave desconocida "sitmap", que Meeko ignora. ¿Quisiste decir "sitemap"?`. |
| The default export is not an object                    | Rejects with `TypeError: <archivo> debe exportar por defecto un objeto de configuración de Meeko`.                                                                    |

## Examples

### A deployment script that chooses the target

```ts
import { loadMeekoConfig } from "@meekojs/meeko/build";

const config = await loadMeekoConfig(process.cwd());
switch (config.server?.adapter ?? "node") {
  case "cloudflare": console.log("npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc"); break;
  case "static": console.log("rsync -a .meeko/output/static/ servidor:/srv/www/"); break;
  default: console.log("docker build -t tienda .");
}
```

### Check configuration in a test

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMeekoConfig } from "@meekojs/meeko/build";

test("production declares the public site", async () => {
  const config = await loadMeekoConfig(process.cwd());
  assert.match(String(config.site), /^https:\/\//);
});
```

## Common mistakes

### An invalid value

```ts bad
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ server: { adapter: "node", port: "8080" } });
```

`TypeError: C:\proyectos\tienda\meeko.config.ts: server.port debe ser un entero entre 0 y 65535`. In `meeko check` and `meeko build`, the error also starts with the file's `TS2322`, including its line and column.

```ts good
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ server: { adapter: "node", port: 8080 } });
```

### Two configuration files

```text bad
meeko.config.ts
meeko.config.mjs
```

`Error: Hay varios archivos de configuración de Meeko: C:\proyectos\tienda\meeko.config.ts, C:\proyectos\tienda\meeko.config.mjs`. Keep just one.

```text good
meeko.config.ts
```

### Expect a misspelled key to be rejected

```ts bad
export default defineMeekoConfig({ sitemapp: true });
```

`loadMeekoConfig` validates values of known keys and returns others unchanged: `{ sitemapp: true }` loads and the option does nothing. Since `1.7` it warns once per configuration on standard error: `[meeko] Aviso: meeko.config.ts tiene la clave desconocida "sitemapp", que Meeko ignora. ¿Quisiste decir "sitemap"?`. With `modules`, the warning comes when loading modules (`meeko dev`, `meeko build`, `meeko check`), because their `meta.configKey` values are also valid keys. It is a warning rather than an error because that configuration loaded in `1.6`; `tsc` does not detect it because `defineMeekoConfig`'s type accepts module keys that do not augment `MeekoConfig`. Through `1.6`, there was no warning.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ site: "https://example.com", sitemap: true });
```

## Notes

- **Executes code.** Importing configuration executes `meeko.config.ts` and its imports with Node: use it only with trusted projects.
- **TypeScript.** Node 24 strips types on import: non-erasable TypeScript syntax (`enum`, `namespace` with values) does not work in configuration.
- **Messages.** Since `1.7`, `meeko.config.ts` and theme validation errors are in Spanish (`server.port debe ser un entero entre 0 y 65535`); `document.head`, `document.seo` and `server.contentSecurityPolicy` errors, which share validation with `useHead` and the CSP header, remain in English.
- **Environment variables.** Does not read `.env`; if configuration uses `process.env`, load it first (the CLI does so in `dev`, `build`, `start`, `preview` and `check`).
- **Cache.** File content is part of the import URL: if unchanged, Node reuses the loaded module without executing it again; if changed, it loads the new version. Modules imported by configuration do remain in Node's cache throughout the process.
