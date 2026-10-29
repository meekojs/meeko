---
title: createNodeAssetReader
group: adapters
since: 1.0.0
description: Sirve desde el disco, en Node, sólo los archivos del build listados en el manifiesto de assets, en streaming y con ETag, HEAD, 304 y la política de caché de Meeko.
symbols:
  - "@meekojs/meeko/node#createNodeAssetReader"
types:
  - "@meekojs/meeko/node#NodeAssetReaderOptions"
  - "@meekojs/meeko/server#AssetReader"
  - "@meekojs/meeko/server#AssetManifest"
related:
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/bun#createBunAssetReader"
  - "@meekojs/meeko/deno#createDenoAssetReader"
  - "@meekojs/meeko/cloudflare#createCloudflareAssetReader"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#build-despliegue-y-verificación
---

`createNodeAssetReader({ root, assets })` es el lector de archivos públicos del adaptador Node: la aplicación le pregunta por cada `pathname` y, si figura en `assets` (el manifiesto que escribe `meeko build`), responde con el archivo de `root` en streaming. Cualquier otra ruta devuelve `null` y **nunca se lee del disco**: no hay forma de pedir `../package.json`, `%2e%2e/…` ni los archivos del build que no son públicos.

Cada respuesta lleva `content-type`, `ETag`, `content-length` y la política de caché de todos los adaptadores; `HEAD` y un `If-None-Match` que coincide (`304`) no abren el archivo.

## Uso

<!-- no-check -->
```ts
// .meeko/output/node/index.mjs (lo que genera meeko build, simplificado)
import { fileURLToPath } from "node:url";
import { createServerApp } from "@meekojs/meeko/server";
import { createNodeAssetReader } from "@meekojs/meeko/node";

const root = fileURLToPath(new URL("./client/", import.meta.url));
const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createNodeAssetReader({ root, assets: manifest.assets ?? {} }),
});
```

## Parámetros

| Opción | Tipo | Descripción |
| --- | --- | --- |
| `root` | `string` | Carpeta con los archivos del manifiesto: la salida del build cliente, `client/`. |
| `assets` | `AssetManifest` | Las rutas de URL públicas con su `type`, `etag`, `size` e `immutable`. |

Las claves de `assets` son rutas tal como las serializa la URL WHATWG: `public/logo@2x.png` es `/logo@2x.png`, `a b.txt` es `/a%20b.txt`.

## Valor devuelto

Un `AssetReader` con `get(pathname, request)`:

| Petición | Respuesta |
| --- | --- |
| Ruta que no está en `assets`, o método distinto de `GET` y `HEAD` | `null`: la petición sigue a la aplicación. |
| `HEAD` | `200` sin cuerpo, con las cabeceras. |
| `If-None-Match` igual al `ETag` | `304` sin cuerpo. |
| Archivo con hash de Vite (`immutable`) | `200` con `cache-control: public, max-age=31536000, immutable`. |
| El resto (`public/`, también `public/assets/`) | `200` con `cache-control: public, max-age=0, must-revalidate`. |

## Ejemplos

### Comprobarlo con `curl`

```sh
curl -sI http://127.0.0.1:4173/robots.txt
# HTTP/1.1 200 OK
# content-type: text/plain; charset=utf-8
# etag: "…"
# cache-control: public, max-age=0, must-revalidate

curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4173/../package.json   # 404
```

### Un lector propio para un archivo calculado

`createServerApp` acepta cualquier `AssetReader`. Para servir un archivo que no está en el build, componga uno:

<!-- no-check -->
```ts
import type { AssetReader } from "@meekojs/meeko/server";

const files = createNodeAssetReader({ root, assets: manifest.assets ?? {} });
const assets: AssetReader = {
  async get(pathname, request) {
    if (pathname === "/version.txt") return new Response(process.env.GIT_SHA ?? "dev", { headers: { "content-type": "text/plain" } });
    return files.get(pathname, request);
  },
};
```

### Archivos detrás de un CDN

```text
/assets/*   → cache-control: public, max-age=31536000, immutable  (hash en el nombre: el CDN los guarda un año)
/favicon.svg → cache-control: public, max-age=0, must-revalidate   (el CDN revalida con ETag)
```

## Errores comunes

### Copiar archivos a `client/` después del build

```text bad
cp extra/terms.pdf .meeko/output/node/client/terms.pdf
```

No está en el manifiesto: `/terms.pdf` nunca se sirve y la petición llega a la aplicación (un `404`). Póngalo en `public/` y vuelva a construir.

```text good
public/terms.pdf  →  npm run build  →  /terms.pdf
```

### Leer archivos del disco a mano en una ruta

```ts bad
// server/api/files/[name].get.ts
handler: async ({ params }) => new Response(await readFile(`./uploads/${params.name}`)),
```

`params.name` puede ser `..%2f.env`: un traversal. El lector de assets sólo sirve claves del manifiesto; para archivos de usuarios, valide el nombre con un schema y resuelva la ruta dentro de su carpeta.

<!-- no-check -->
```ts good
params: v.object({ name: v.pipe(v.string(), v.regex(/^[\w-]+\.pdf$/)) }),
handler: async ({ params }) => new Response(await readFile(join(uploads, params.name))),
```

## Notas

- **Seguridad.** La ruta se busca en el manifiesto sin decodificar, así que ninguna forma de traversal (`..`, `%2e%2e`, `%2f`, `%5c`) coincide; la suite de conformidad lo prueba en Node, Bun, Deno y Workers.
- **Antes del middleware.** Los archivos públicos se sirven antes de `server/middleware`; `server.headers` (desde `1.7`) sí se les aplica, salvo las cabeceras que ya traen, como `Cache-Control`.
- **Streaming.** El archivo se abre sólo para un `200` con cuerpo y se envía con `createReadStream`; si el cliente se va, el stream se cancela.
- **Otros runtimes.** Bun, Deno y Workers tienen su lector con el mismo comportamiento: `createBunAssetReader`, `createDenoAssetReader` y `createCloudflareAssetReader`.
