---
title: buildProject
group: advanced
since: 1.0.0
description: Construye el proyecto como meeko build, sin la comprobación previa, y devuelve el adaptador y la carpeta de salida; para scripts de build y herramientas.
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
---

`buildProject` es el build de [`meeko build`](/docs/reference/meeko-build) como función: compila el cliente con Vite, el servidor del adaptador y las páginas prerenderizadas, escribe `sitemap.xml` y `robots.txt` si están activados y devuelve `{ adapter, output }`. El adaptador sale de `options.adapter`, de `server.adapter` en `meeko.config.ts` o, por defecto, `node`.

A diferencia del comando, **no comprueba** el proyecto antes (ni los componentes ni TypeScript) y no lee el `.env`. Desde `1.7`, en un proyecto limpio (tras `meeko clean` o en un checkout nuevo de CI, sin `meeko check` ni `meeko dev` previos) genera antes las declaraciones y los `tsconfig.*.json` de `.meeko/`, como `meeko check`; si ya existen, no los vuelve a escribir. Hasta `1.6` fallaba con `Tsconfig not found …/.meeko/tsconfig.app.json`. Sirve para scripts de build propios, para construir varios adaptadores en un mismo proceso y para pruebas de integración.

## Uso

```ts
// scripts/build.ts
import { buildProject } from "@meekojs/meeko/build";

const { adapter, output } = await buildProject(process.cwd());
console.log(`build ${adapter} en ${output}`);
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `projectRoot` | ruta | obligatorio | Carpeta del proyecto. |
| `options.adapter` | `"node"` \| `"bun"` \| `"deno"` \| `"cloudflare"` \| `"static"` | `server.adapter`, o `"node"` | Sustituye al adaptador de la configuración. |

## Valor devuelto

Una promesa de `{ adapter, output }`: el adaptador usado y la ruta absoluta de `.meeko/output/<adaptador>/`. La carpeta contiene lo mismo que con `meeko build` (véase su página).

Rechaza con el error del paso que falla: `Adaptador desconocido: …; usa node, cloudflare, deno, bun o static`, el de un proyecto que conserva `server/session.ts`, el de un `sitemap` sin origen público, el de una aplicación que el adaptador `static` no admite, `Dynamic prerender route … requires prerenderEntries`, o el de Vite.

## Ejemplos

### Dos adaptadores en un mismo script

```ts
import { buildProject } from "@meekojs/meeko/build";

for (const adapter of ["node", "cloudflare"] as const) {
  const result = await buildProject(process.cwd(), { adapter });
  console.log(result.adapter, result.output);
}
```

Cada build escribe su propia carpeta; el segundo no borra el primero.

### Comprobar y construir, como la CLI

<!-- no-check -->
```ts
import { execFileSync } from "node:child_process";
import { buildProject } from "@meekojs/meeko/build";

execFileSync("npx", ["meeko", "check", "."], { stdio: "inherit", shell: process.platform === "win32" });
await buildProject(process.cwd());
```

`buildProject` no ejecuta TypeScript: sin la comprobación previa, un error de tipos llega a producción si el código compila con Vite.

### Una prueba de integración

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

## Errores comunes

### Esperar la comprobación de `meeko build`

```ts bad
await buildProject(process.cwd()); // el proyecto tiene un error TS2322 en server/api
```

Vite elimina los tipos sin comprobarlos: el build termina y el error llega a producción. `meeko build` ejecuta antes `meeko check`; `buildProject`, no.

<!-- no-check -->
```ts good
await checkProjectWithCli();
await buildProject(process.cwd());
```

### Un adaptador que no existe

```ts bad
await buildProject(process.cwd(), { adapter: "vercel" as never });
```

Rechaza con `Adaptador desconocido: vercel; usa node, cloudflare, deno, bun o static`, antes de compilar nada.

```ts good
import { buildProject } from "@meekojs/meeko/build";

await buildProject(process.cwd(), { adapter: "node" });
```

### Variables del `.env` que el build necesita

```ts bad
// .env: MEEKO_PUBLIC_ORIGIN=https://example.com, y sitemap: true sin site
await buildProject(process.cwd());
```

`buildProject` no lee el `.env` (lo lee la CLI): `sitemap necesita la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`.

<!-- no-check -->
```ts good
process.env.MEEKO_PUBLIC_ORIGIN ??= "https://example.com";
await buildProject(process.cwd());
```

## Notas

- **Sólo Node.** Necesita `vite` instalado en el proyecto; el build y el prerender se ejecutan en Node aunque el adaptador sea otro.
- **Módulos.** Ejecuta `meeko.config.ts` y los `setup` de sus módulos, y llama a sus hooks `build:before`, `routes:resolved` y `build:done`.
- **Desde `1.7`.** El build de Node y los demás adaptadores con servidor llevan `contentSecurityPolicy`, `headers` y un `buildId` nuevo en el manifiesto, y el prerender evalúa `sitemapEntries`.
- **Concurrencia.** Dos builds del mismo proyecto a la vez comparten `.meeko/build/` y `.meeko/output/client/`: ejecútalos en serie, como en el ejemplo.
- **Rendimiento.** Son al menos dos pasadas de Vite (cliente y servidor), más una por adaptador autónomo y otra del servidor de Node si hay `sitemap`.
