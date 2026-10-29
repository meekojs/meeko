---
title: createBunAssetReader
group: adapters
since: 1.0.0
description: Sirve con Bun.file sólo los archivos del build listados en el manifiesto de assets, con ETag, HEAD, 304 y la política de caché de Meeko.
symbols:
  - "@meekojs/meeko/bun#createBunAssetReader"
types:
  - "@meekojs/meeko/bun#BunAssetReaderOptions"
  - "@meekojs/meeko/server#AssetReader"
related:
  - "@meekojs/meeko/bun#createBunServer"
  - "@meekojs/meeko/node#createNodeAssetReader"
  - "@meekojs/meeko/deno#createDenoAssetReader"
  - docs/framework.md#bun
---

`createBunAssetReader({ root, assets })` es el lector de archivos públicos de Bun. Igual que el de Node, sólo responde a las rutas del manifiesto de assets del build y devuelve `null` para las demás, que nunca se buscan en el disco; la diferencia es que lee con `Bun.file`, que Bun envía sin pasar por JavaScript.

## Uso

<!-- no-check -->
```ts
import { createServerApp } from "@meekojs/meeko/server";
import { createBunAssetReader } from "@meekojs/meeko/bun";

const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createBunAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
});
```

## Parámetros

| Opción | Tipo | Descripción |
| --- | --- | --- |
| `root` | `string \| URL` | Carpeta con los archivos del manifiesto, como ruta o URL `file:`. En la salida de Bun, `new URL("client/", import.meta.url)`. |
| `assets` | `AssetManifest` | Las rutas públicas con su `type`, `etag`, `size` e `immutable`. |

## Valor devuelto

Un `AssetReader` con `get(pathname, request)`: `null` para una ruta que no está en `assets` o un método distinto de `GET` y `HEAD`; `304` si `If-None-Match` coincide; `200` con `content-type`, `ETag`, `content-length` y `cache-control` (`public, max-age=31536000, immutable` para los archivos con hash de Vite, `public, max-age=0, must-revalidate` para el resto).

## Ejemplos

### Probar el lector en Bun

<!-- no-check -->
```ts
// bun test assets.test.ts
import { expect, test } from "bun:test";
import { createBunAssetReader } from "@meekojs/meeko/bun";

test("sólo sirve lo que está en el manifiesto", async () => {
  const assets = createBunAssetReader({ root: new URL("./fixtures/client/", import.meta.url), assets: { "/robots.txt": { type: "text/plain", etag: '"r1"', size: 25 } } });
  expect((await assets.get("/robots.txt", new Request("http://x/robots.txt")))?.status).toBe(200);
  expect(await assets.get("/../package.json", new Request("http://x/../package.json"))).toBeNull();
});
```

### Una caché delante de Bun

```text
GET /assets/entry-4f2a.js  → 200, cache-control: public, max-age=31536000, immutable
GET /assets/entry-4f2a.js  If-None-Match: "…" → 304 sin leer el archivo
```

## Errores comunes

### Ejecutarlo en Node

```ts bad
// node server.mjs
await createBunAssetReader({ root, assets }).get("/robots.txt", request);
```

La primera lectura lanza `Error: The Meeko Bun adapter requires the Bun runtime`. En Node, use `createNodeAssetReader`.

<!-- no-check -->
```ts good
import { createNodeAssetReader } from "@meekojs/meeko/node";
const assets = createNodeAssetReader({ root: fileURLToPath(new URL("./client/", import.meta.url)), assets: manifest.assets ?? {} });
```

### Un archivo del manifiesto que falta en la carpeta

```text bad
.meeko/output/bun/ copiada sin client/assets/
```

Una petición a un archivo listado rechaza con `Error: Missing build asset /assets/entry-4f2a.js`, que la aplicación convierte en `500` y envía a `onError`. Copie la carpeta de salida completa.

```text good
.meeko/output/bun/ completa: index.js, chunks/, client/ y prerender/
```

## Notas

- **Seguridad.** Las rutas se buscan en el manifiesto sin decodificar: ningún traversal coincide.
- **`HEAD` y `304`.** No abren el archivo.
- **Sólo Bun.** Importar `@meekojs/meeko/bun` en Node no falla; lo que falla es leer un archivo.
