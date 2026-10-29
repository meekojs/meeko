---
title: contentSecurityPolicy
group: server
since: 1.3.0
description: Construye la cabecera Content-Security-Policy de una política por directivas y añade los hashes de los scripts y estilos en línea de una página.
symbols:
  - "@meekojs/meeko/server#contentSecurityPolicy"
types:
  - "@meekojs/meeko/server#ContentSecurityPolicy"
related:
  - "config:server"
  - "@meekojs/meeko/build#inlineScriptHashes"
  - "@meekojs/meeko/build#inlineStyleHashes"
  - docs/framework.md#csp-con-hashes
  - docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
  - docs/framework.md#sitio-estático
---

`contentSecurityPolicy(policy, scriptHashes?, styleHashes?)` escribe el valor de la cabecera `Content-Security-Policy` a partir de un objeto de directivas, y añade a la directiva correcta los hashes SHA-256 de los `<script>` y, desde `1.4`, de los `<style>` en línea que ejecuta una página. Valida cada nombre de directiva, cada fuente y cada hash, así que una política mal escrita falla al construirla, no en el navegador.

Desde `1.7` casi nunca hace falta llamarla: con `server.contentSecurityPolicy` en `meeko.config.ts`, los adaptadores `node`, `bun`, `deno` y `cloudflare` ponen ellos mismos la cabecera en cada respuesta, con hashes o un nonce según el tipo de respuesta (véase [Notas](#notas)). Es la pieza para un host propio, un CDN o un script de despliegue.

## Uso

```ts
import { contentSecurityPolicy } from "@meekojs/meeko/server";

const header = contentSecurityPolicy(
  { "default-src": ["'self'"], "object-src": ["'none'"] },
  ["'sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8='"],
);
// "default-src 'self'; object-src 'none'; script-src 'self' 'sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8='"
```

Sin `script-src`, los hashes van a una copia de `default-src`, para que la política no restrinja más de lo que ya restringía.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `policy` | `ContentSecurityPolicy` (`Record<string, readonly string[]>`) | obligatorio | Cada clave es una directiva en minúsculas (`"script-src"`) y su valor, la lista de fuentes tal como se escriben (`"'self'"`, `"https://cdn.example"`). Una lista vacía escribe la directiva sola, como `upgrade-insecure-requests`. |
| `scriptHashes` | `readonly string[]` | `[]` | Fuentes `'sha256-…'`, `'sha384-…'` o `'sha512-…'`, con las comillas. Van a `script-src-elem` si existe (desde `1.7`), si no a `script-src` o a una copia de `default-src`; sin ninguna no se añaden. |
| `styleHashes` | `readonly string[]` | `[]` | Desde `1.4`. Igual para los `<style>`: van a `style-src-elem` si existe, si no a `style-src` o a una copia de `default-src`. Nunca a una directiva con `'unsafe-inline'`. |

## Valor devuelto

El texto de la cabecera, con las directivas en el orden de `policy` (las creadas a partir de `default-src`, al final) y sin fuentes repetidas.

Lanza `TypeError` si una directiva, una fuente o un hash no son válidos (véase [Errores comunes](#errores-comunes)).

## Ejemplos

### La CSP en los adaptadores con servidor (desde 1.7)

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "node",
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // atributos style="…" de un resaltador
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "frame-ancestors": ["'none'"],
    },
  },
});
```

`meeko build` valida la política con esta misma función y la fija en el manifiesto; `meeko start` y las salidas de Bun, Deno y Workers la completan en cada respuesta.

### Un host propio con las páginas prerenderizadas

```ts
import { readFile } from "node:fs/promises";
import { contentSecurityPolicy } from "@meekojs/meeko/server";
import type { PrerenderIndex } from "@meekojs/meeko/build";

const index = JSON.parse(await readFile(".meeko/output/node/prerender/manifest.json", "utf8")) as PrerenderIndex;
const pages = Object.values(index.pages);
const scripts = [...new Set(pages.flatMap((page) => page.scriptHashes ?? []))];
const styles = [...new Set(pages.flatMap((page) => page.styleHashes ?? []))];
export const header = contentSecurityPolicy(
  { "default-src": ["'self'"], "style-src": ["'self'"], "object-src": ["'none'"] },
  scripts,
  styles,
);
```

### Los hashes de cualquier documento

<!-- no-check -->
```ts
import { inlineScriptHashes, inlineStyleHashes } from "@meekojs/meeko/build";
import { contentSecurityPolicy } from "@meekojs/meeko/server";

const html = await (await fetch("http://127.0.0.1:4173/docs")).text();
const { hashes, unhashable } = inlineScriptHashes(html);
if (unhashable.length) throw new Error(`JavaScript que un hash no permite: ${unhashable.join(", ")}`);
const header = contentSecurityPolicy({ "default-src": ["'self'"] }, hashes, inlineStyleHashes(html));
```

`unhashable` lista los atributos `on*` y las URL `javascript:`: ninguna CSP sin `'unsafe-inline'` los permite.

`inlineScriptHashes` lee el documento entero, también lo que hay dentro de `#app`. Si la página pinta contenido de usuario, un `<script>` inyectado recibiría su hash: para las páginas de Meeko usa `scriptHashes` y `styleHashes` del índice de prerender, que desde `1.7` sólo cubren lo que Meeko escribe fuera de la página.

## Errores comunes

### Fuentes sin comillas o separadas por espacios

```ts bad
contentSecurityPolicy({ "script-src": ["self https://cdn.example"] });
```

`TypeError: contentSecurityPolicy: invalid source "self https://cdn.example" in script-src`. Cada fuente es un elemento, y las palabras clave llevan comillas simples. En `meeko.config.ts`, `meeko dev`, `meeko build` y `meeko check` se detienen con `meeko.config.ts: server.contentSecurityPolicy: invalid source "…" in script-src`.

```ts good
import { contentSecurityPolicy } from "@meekojs/meeko/server";
contentSecurityPolicy({ "script-src": ["'self'", "https://cdn.example"] });
```

### Un hash sin comillas

```ts bad
contentSecurityPolicy({ "default-src": ["'self'"] }, ["sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8="]);
```

`TypeError: contentSecurityPolicy: invalid script hash "sha256-B2yP…"`.

```ts good
import { contentSecurityPolicy } from "@meekojs/meeko/server";
contentSecurityPolicy({ "default-src": ["'self'"] }, ["'sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8='"]);
```

### Un texto en lugar de una lista, o directivas en mayúsculas

```ts bad
contentSecurityPolicy({ "Script-Src": "'self'" });
```

`TypeError: contentSecurityPolicy: invalid directive name "Script-Src"`; con el nombre bien escrito y un texto, `contentSecurityPolicy: script-src must be an array of sources`.

```ts good
import { contentSecurityPolicy } from "@meekojs/meeko/server";
contentSecurityPolicy({ "script-src": ["'self'"] });
```

### La CSP en `server.headers`

```ts bad
server: { adapter: "node", headers: { "Content-Security-Policy": "default-src 'self'" } }
```

`meeko.config.ts: server.headers no puede fijar Content-Security-Policy; use server.contentSecurityPolicy, que añade los hashes de los scripts`: escrita a mano, la política no llevaría los hashes ni el nonce y bloquearía los scripts de Meeko.

<!-- no-check -->
```ts good
server: { adapter: "node", contentSecurityPolicy: { "default-src": ["'self'"] } }
```

## Notas

- **CSP por respuesta (desde 1.7).** Con `server.contentSecurityPolicy` en `node`, `bun`, `deno` o `cloudflare`, Meeko completa la política según lo que lleva cada respuesta:

  | Respuesta | Qué se añade |
  | --- | --- |
  | Página prerenderizada | Los hashes de sus scripts y `<style>` (del índice de prerender). Se sigue sirviendo desde su archivo, con `ETag` y `304`. |
  | Página SSR, `"stream"`, error y 404 | Un nonce nuevo por respuesta (128 bits), que Meeko pone en sus `<script>`, `<style>`, la entrada del cliente, el script del tema y los de `useHead` y `document`. |
  | Página SSR con `cache` | Los hashes de su HTML, sin nonce: el documento es el mismo para todos y un nonce no sobrevive a un `304`. |
  | JSON de API, RPC y navegación | La política se sustituye por `default-src 'none'; frame-ancestors 'none'`. |
  | Archivos públicos y lo demás | La política tal cual. |

- **`'unsafe-inline'`.** Con un hash o un nonce, el navegador ignora `'unsafe-inline'` de esa directiva. Por eso Meeko nunca añade un nonce ni un hash a una directiva que lo tiene; la función pública sí añade los hashes de scripts (no los de estilos) a un `script-src` con `'unsafe-inline'`.
- **Cuándo se aplica.** Sólo en producción: en `meeko dev`, Vite inyecta scripts sin nonce ni hash. Una respuesta que ya trae `Content-Security-Policy` (de un handler o un middleware) la conserva, y un `304` nunca la lleva.
- **Workers.** Los hashes y el nonce usan Web Crypto: Cloudflare Workers aplica la CSP igual que Node, Bun y Deno.
- **`static`.** El adaptador estático escribe la política, con los hashes de todos sus `.html`, en los archivos de `headerFiles`; un atributo `on*` o una URL `javascript:` detienen el build con la lista de archivos.
