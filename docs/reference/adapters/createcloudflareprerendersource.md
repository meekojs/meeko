---
title: createCloudflarePrerenderSource
group: adapters
since: 1.0.0
description: Las páginas prerenderizadas de un Worker, leídas del binding de Static Assets una vez por aislado, con su payload de navegación y los hashes de su CSP.
symbols:
  - "@meekojs/meeko/cloudflare#createCloudflarePrerenderSource"
types:
  - "@meekojs/meeko/cloudflare#CloudflarePrerenderSourceOptions"
  - "@meekojs/meeko/server#PrerenderSource"
related:
  - "@meekojs/meeko/cloudflare#createWorker"
  - "@meekojs/meeko/cloudflare#createCloudflareAssetReader"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#cloudflare-workers
  - docs/framework.md#modos-de-render
---

`createCloudflarePrerenderSource({ binding, directory })` es la `PrerenderSource` de Workers: cuando una petición pide una página con `render: "prerender"`, la aplicación le pregunta por su `pathname` y la fuente lee del binding de assets el HTML, la posición donde se inserta la meta CSRF, el `ETag`, el payload de navegación y, desde `1.3` y `1.4`, los hashes de sus scripts y estilos. El índice (`manifest.json`) y cada página se leen una vez por aislado.

Las páginas viven en `assets/_meeko/prerender/` pero nunca se sirven como archivos: la aplicación las devuelve como documentos, con la meta CSRF de la sesión, la CSP y las cabeceras de una página.

## Uso

<!-- no-check -->
```ts
import { createCloudflareAssetReader, createCloudflarePrerenderSource, createWorker } from "@meekojs/meeko/cloudflare";

export default createWorker(({ env, platform }) => createApp({
  production: true,
  platform,
  assets: createCloudflareAssetReader({ binding: env.ASSETS, assets: manifest.assets ?? {} }),
  prerender: createCloudflarePrerenderSource({ binding: env.ASSETS }),
}));
```

## Parámetros

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `binding` | `CloudflareAssetsBinding` | obligatorio | El binding de Static Assets. |
| `directory` | `string` | `"/_meeko/prerender/"` | Carpeta de los assets con `manifest.json` y las páginas; empieza y termina en `/`. |

## Valor devuelto

Una `PrerenderSource` con `get(pathname)`, que resuelve:

- `undefined` si el índice no lista la ruta (o no hay índice: una aplicación sin páginas prerenderizadas);
- `{ html, headOffset, etag, payload?, scriptHashes?, styleHashes? }` si la lista.

Una lectura fallida no se guarda: la petición siguiente la reintenta.

## Ejemplos

### Una página prerenderizada en Workers

```ts
// app/pages/precios.route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender", head: () => ({ title: "Precios" }) });
```

`meeko build --adapter cloudflare` la renderiza en Node y la escribe en `assets/_meeko/prerender/`. En producción:

```text
GET /precios (sin sesión) → el HTML del build, ETag, cache-control: public, max-age=0, must-revalidate
GET /precios (con sesión) → el mismo HTML con <meta name="meeko-csrf-token">, cache-control: private, no-store
```

### CSP con hashes (desde 1.7)

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: { adapter: "cloudflare", contentSecurityPolicy: { "default-src": ["'self'"], "script-src": ["'self'"], "object-src": ["'none'"] } },
});
```

La respuesta de `/precios` lleva la política con los `scriptHashes` y `styleHashes` del índice, sin nonce, y sigue respondiendo `304` a un `If-None-Match`.

## Errores comunes

### Una carpeta sin `/` final

```ts bad
createCloudflarePrerenderSource({ binding: env.ASSETS, directory: "/_meeko/prerender" });
```

`TypeError: Prerender directory must start and end with /`, al crear la aplicación.

<!-- no-check -->
```ts good
createCloudflarePrerenderSource({ binding: env.ASSETS, directory: "/_meeko/prerender/" });
```

### Un índice que lista una página que no se subió

```text bad
assets/_meeko/prerender/manifest.json desplegado sin assets/_meeko/prerender/precios/index.html
```

La petición a `/precios` responde `500` y `onError` recibe `Error: Missing prerendered file /_meeko/prerender/…`. Despliegue la salida completa.

```sh good
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

## Notas

- **Una vez por aislado.** El índice y cada página se guardan en la memoria del aislado tras la primera lectura; un despliegue nuevo crea aislados nuevos.
- **Sin TCP ni disco.** Todo se lee por el binding `ASSETS`.
- **Seguridad.** Las rutas sólo se buscan en el índice; el nombre del archivo sale del índice, nunca de la petición.
- **Sesión.** El HTML prerenderizado es el mismo para todos: Meeko inserta la meta CSRF de cada sesión en `headOffset` y marca la respuesta como `private, no-store`.
