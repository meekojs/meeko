---
title: server
group: config
since: 1.0.0
description: El adaptador de meeko build (node, bun, deno, cloudflare o static) con sus opciones y, desde 1.7, la CSP y las cabeceras de las respuestas en los adaptadores con servidor.
symbols:
  - "config:server"
types:
  - "@meekojs/meeko/framework#ServerResponseConfig"
  - "@meekojs/meeko/framework#ServerHeaders"
  - "@meekojs/meeko/framework#StaticHeaderFile"
related:
  - "@meekojs/meeko/server#contentSecurityPolicy"
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/bun#createBunServer"
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/cloudflare#createWorker"
  - "cli:build"
  - docs/framework.md#build-despliegue-y-verificación
  - docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
  - docs/framework.md#sitio-estático
  - docs/framework.md#cloudflare-workers
---

`server` elige dónde se ejecuta la aplicación construida: una unión discriminada por `adapter`. `meeko build` escribe la salida en `.meeko/output/<adapter>/`; `--adapter` de la CLI tiene prioridad sobre la configuración. Sin `server`, el adaptador es `node`.

Desde `1.7`, los adaptadores con servidor (`node`, `bun`, `deno` y `cloudflare`) aceptan también `contentSecurityPolicy` y `headers`: se fijan en el build y la aplicación los aplica a cada respuesta, con la CSP completada por respuesta (hashes en las páginas prerenderizadas, un nonce en las SSR, hashes en las SSR con `cache` y una política cerrada en el JSON).

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "node",
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "frame-ancestors": ["'none'"],
    },
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "/admin/*": { "X-Robots-Tag": "noindex" },
    },
  },
});
```

## Opciones

### Comunes a `node`, `bun`, `deno` y `cloudflare` (desde 1.7)

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `contentSecurityPolicy` | `Record<string, readonly string[]>` | ninguna | La política por directiva. Meeko le añade, según la respuesta, hashes o un nonce (en `script-src-elem` y `style-src-elem` si existen), y nunca a una directiva con `'unsafe-inline'` salvo que tenga `'strict-dynamic'`. Sólo en producción. |
| `headers` | `Record<string, string \| Record<string, string>>` | ninguna | Una clave con nombre de cabecera se aplica a todas las respuestas; una clave que empieza por `/` es un patrón de `pathname` con sus propias cabeceras, aplicadas después de las globales y en el orden escrito. `*` sustituye a cualquier secuencia, `/` incluida. También en `meeko dev`. |

### Por adaptador

| Adaptador | Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- | --- |
| `node` | `host` | `string` | `"127.0.0.1"` | Interfaz de `meeko start`; `MEEKO_HOST` (o `HOST`) la sustituye. |
| `node` | `port` | `number` | `4173` | Puerto de `meeko start`, de `0` a `65535`; `MEEKO_PORT` (o `PORT`) lo sustituye. |
| `cloudflare` | `name` | `string` | el `name` de `package.json` | Nombre del Worker: minúsculas, dígitos y guiones. |
| `cloudflare` | `socketClassName` | `string` | `"MeekoSocketRoom"` | Clase Durable Object de las salas de Socket. |
| `cloudflare` | `compatibilityDate` | `string` (`YYYY-MM-DD`) | la fecha con la que se prueba Meeko | Fecha de compatibilidad de Workers. |
| `cloudflare` | `wrangler` | `Record<string, unknown>` | `{}` | Más campos de `wrangler.jsonc` (`d1_databases`, `vars`, `routes`…). `compatibility_flags` y `durable_objects.bindings` se combinan con los de Meeko; `main`, `assets`, `no_bundle` y `find_additional_modules` son de Meeko. |
| `static` | `contentSecurityPolicy` | `Record<string, readonly string[]>` | ninguna | Desde `1.3`. La política de todas las páginas, con los hashes de todos los `.html` de la salida. |
| `static` | `headers` | `Record<string, string>` | ninguna | Desde `1.3`. Cabeceras de todas las respuestas; sin patrones de ruta. |
| `static` | `headerFiles` | `("_headers" \| "nginx")[]` | `[]` | Desde `1.3`. Dónde se escriben: `/_headers` (Netlify, Cloudflare Pages) o `/_meeko/headers.conf` (nginx). |

## Resultado

| Adaptador | Salida | Cómo se ejecuta |
| --- | --- | --- |
| `node` | `.meeko/output/node/`: `index.mjs`, `chunks/`, `client/`, `prerender/` | `meeko start` o `node index.mjs`; necesita `node_modules`. |
| `bun` | `.meeko/output/bun/`: `index.js` con las dependencias incluidas | `bun index.js`, sin `node_modules`. |
| `deno` | `.meeko/output/deno/`: `main.js` con las dependencias incluidas | `deno run --allow-net --allow-env --allow-read=… main.js`. |
| `cloudflare` | `.meeko/output/cloudflare/`: `worker.js`, `assets/`, `wrangler.jsonc` | `wrangler deploy --config …/wrangler.jsonc`. |
| `static` | `.meeko/output/static/`: HTML, payloads, `404.html`, assets | Cualquier hosting de archivos; sólo páginas `render: "prerender"`. |

La CSP de cada respuesta en los adaptadores con servidor:

| Respuesta | `Content-Security-Policy` |
| --- | --- |
| Página prerenderizada | La política con los hashes de los scripts y `<style>` en línea que escribe Meeko (nunca los de dentro de `#app` o de un teleport); se sigue sirviendo desde su archivo, con `ETag` y `304`. |
| Página SSR, `"stream"`, de error y 404 | La política con un nonce nuevo en cada respuesta, que Meeko pone en sus `<script>` y `<style>`. |
| Página SSR con `cache` | La política con los hashes del código en línea que escribe Meeko, sin nonce. |
| JSON de API, RPC y navegación | `default-src 'none'; frame-ancestors 'none'`. |
| Archivos públicos y lo demás | La política tal cual. |

Una cabecera que la respuesta ya trae (de Meeko, de un handler o de un middleware) no se sustituye, y un `304` nunca lleva la CSP.

## Ejemplos

### Cloudflare Workers con D1

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "cloudflare",
    name: "mi-app",
    compatibilityDate: "2026-10-19",
    wrangler: {
      d1_databases: [{ binding: "DB", database_name: "mi-app", database_id: "<id>" }],
      vars: { MEEKO_PUBLIC_ORIGIN: "https://mi-app.example" },
    },
    headers: { "X-Content-Type-Options": "nosniff" },
  },
});
```

### Un sitio estático para Netlify y nginx

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  server: {
    adapter: "static",
    headerFiles: ["_headers", "nginx"],
    contentSecurityPolicy: { "default-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "object-src": ["'none'"] },
    headers: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" },
  },
});
```

### El mismo proyecto en varios destinos

```sh
npx meeko build                     # server.adapter, o node
npx meeko build --adapter bun       # sin tocar la configuración
npx meeko build --adapter static    # falla si hay páginas SSR, API, RPC, Socket o middleware de servidor
```

Con `--adapter`, las opciones de `server` de otro adaptador no se aplican: `static` sobre una configuración `node` construye sin `headerFiles`.

## Errores comunes

### Un adaptador que no existe

```ts bad
export default defineMeekoConfig({ server: { adapter: "vercel" } as never });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: server.adapter debe ser "node", "cloudflare", "deno", "bun" o "static"`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ server: { adapter: "node" } });
```

### La CSP en `headers`

```ts bad
server: { adapter: "node", headers: { "Content-Security-Policy": "default-src 'self'" } }
```

`…/meeko.config.ts: server.headers no puede fijar Content-Security-Policy; use server.contentSecurityPolicy, que añade los hashes de los scripts`. Escrita a mano, la política no llevaría el nonce ni los hashes y bloquearía los scripts de Meeko.

<!-- no-check -->
```ts good
server: { adapter: "node", contentSecurityPolicy: { "default-src": ["'self'"] } }
```

### Patrones de ruta con `static`

```ts bad
server: { adapter: "static", headers: { "/admin/*": { "X-Robots-Tag": "noindex" } } }
```

`…/meeko.config.ts: server.headers "/admin/*": el adaptador static aplica sus cabeceras a todas las rutas; los patrones de ruta necesitan un adaptador con servidor`. `headerFiles` escribe un único bloque para todas las rutas.

<!-- no-check -->
```ts good
server: { adapter: "static", headers: { "X-Robots-Tag": "noindex" } }
```

### Un patrón con un texto en lugar de cabeceras

```ts bad
server: { adapter: "node", headers: { "/docs/*": "max-age=60" } }
```

`…/meeko.config.ts: server.headers "/docs/*" must be an object of header values`.

<!-- no-check -->
```ts good
server: { adapter: "node", headers: { "/docs/*": { "Cache-Control": "public, max-age=60" } } }
```

### Fuentes de la CSP sin comillas

```ts bad
server: { adapter: "bun", contentSecurityPolicy: { "script-src": ["self ok"] } }
```

`…/meeko.config.ts: server.contentSecurityPolicy: invalid source "self ok" in script-src`.

<!-- no-check -->
```ts good
server: { adapter: "bun", contentSecurityPolicy: { "script-src": ["'self'"] } }
```

### Opciones de otro adaptador

```ts bad
server: { adapter: "static", port: 3000 } as never
```

`…/meeko.config.ts: server (static): campo desconocido port`. Con `cloudflare`, un nombre no válido da `server.name debe ser un nombre de Worker (minúsculas, dígitos y guiones)`, y con `node`, un puerto fuera de rango, `server.port debe ser un entero entre 0 y 65535`.

<!-- no-check -->
```ts good
server: { adapter: "node", port: 3000 }
```

## Notas

- **Seguridad.** Empiece por `default-src 'self'`, `object-src 'none'`, `base-uri 'none'` y `frame-ancestors 'none'`. Reserve `'unsafe-inline'` para `style-src` si un resaltador escribe atributos `style="…"`: Meeko no añade nonce ni hash a esa directiva para no anularlo. La política de JSON (`default-src 'none'`) cubre todo `/api/` y el RPC: un endpoint con `contentType: "response"` que devuelve HTML debe poner su propia `Content-Security-Policy`.
- **Desarrollo.** La CSP sólo se aplica en producción (`meeko start`, `meeko preview` y las salidas); en `meeko dev`, Vite inyecta scripts sin nonce. `headers` sí se aplica en `meeko dev` a lo que atiende la aplicación.
- **Cookies y cachés.** Una respuesta con `Set-Cookie` y un `Cache-Control` `public` sale como `private, no-store` y sin `ETag`, con o sin estas opciones.
- **Variables de entorno.** `MEEKO_HOST`, `MEEKO_PORT` y `MEEKO_PUBLIC_ORIGIN` se leen al ejecutarse, no en el build; `server.host` y `server.port` sólo se aplican a Node.
- **Host propio.** Las opciones viajan en el manifiesto (`AppManifest.contentSecurityPolicy` y `AppManifest.headers`); un host que crea su `AppManifest` a mano las pasa allí.
