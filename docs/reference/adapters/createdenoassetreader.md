---
title: createDenoAssetReader
group: adapters
since: 1.0.0
description: Sirve con Deno.open, en streaming, sólo los archivos del build listados en el manifiesto de assets, con ETag, HEAD, 304 y la política de caché de Meeko.
symbols:
  - "@meekojs/meeko/deno#createDenoAssetReader"
types:
  - "@meekojs/meeko/deno#DenoAssetReaderOptions"
  - "@meekojs/meeko/server#AssetReader"
related:
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/node#createNodeAssetReader"
  - "@meekojs/meeko/bun#createBunAssetReader"
  - docs/framework.md#deno
---

`createDenoAssetReader({ root, assets })` es el lector de archivos públicos de Deno: responde sólo a las rutas del manifiesto de assets del build, con el archivo abierto con `Deno.open` y enviado en streaming, y devuelve `null` para las demás, que nunca se buscan en el disco. Las cabeceras, `HEAD`, `304` y la política de caché son las de todos los adaptadores.

## Uso

<!-- no-check -->
```ts
import { createServerApp } from "@meekojs/meeko/server";
import { createDenoAssetReader, serveDeno } from "@meekojs/meeko/deno";

const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createDenoAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
});
await serveDeno(app, { handleSignals: true });
```

## Parámetros

| Opción | Tipo | Descripción |
| --- | --- | --- |
| `root` | `string \| URL` | Carpeta con los archivos del manifiesto, como ruta o URL `file:`. |
| `assets` | `AssetManifest` | Las rutas públicas con su `type`, `etag`, `size` e `immutable`. |

## Valor devuelto

Un `AssetReader` con `get(pathname, request)`: `null` para una ruta que no está en `assets` o un método distinto de `GET` y `HEAD`; `304` si `If-None-Match` coincide, sin abrir el archivo; `200` con el cuerpo del archivo, `content-type`, `ETag`, `content-length` y `cache-control` (`immutable` un año para los archivos con hash, `max-age=0, must-revalidate` para el resto).

## Ejemplos

### Permisos de lectura acotados

```sh
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

El lector sólo abre archivos bajo `root`, así que basta con permitir la lectura de la carpeta de salida.

### Un archivo grande en streaming

```text
GET /downloads/catalogo.pdf → 200, content-length: 18874368, el cuerpo es file.readable
```

Si el cliente se va, el stream se cancela y el archivo se cierra.

## Errores comunes

### Permisos de lectura de otra carpeta

```sh bad
deno run --allow-net --allow-env --allow-read=./public .meeko/output/deno/main.js
```

La primera petición a un archivo listado falla con el error de permisos de Deno al abrirlo, y la aplicación responde `500` y lo envía a `onError`.

```sh good
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

### Ejecutarlo en Node

```ts bad
await createDenoAssetReader({ root, assets }).get("/robots.txt", request); // en Node
```

`Error: The Meeko Deno adapter requires the Deno runtime`. En Node, use `createNodeAssetReader`.

<!-- no-check -->
```ts good
const assets = createNodeAssetReader({ root: fileURLToPath(new URL("./client/", import.meta.url)), assets: manifest.assets ?? {} });
```

## Notas

- **Seguridad.** Las rutas se buscan en el manifiesto sin decodificar: ningún traversal coincide, y la clave sale del build, nunca de la petición.
- **Sólo Deno.** Importar `@meekojs/meeko/deno` en otro runtime no falla; lo que falla es leer un archivo.
