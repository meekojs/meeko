---
title: meeko build
group: commands
since: 1.0.0
description: Comprueba el proyecto y escribe en .meeko/output/<adaptador>/ la salida de producción, con el cliente, el servidor y las páginas prerenderizadas.
symbols:
  - "cli:build"
related:
  - "cli:check"
  - "cli:start"
  - "cli:preview"
  - "cli:prerender"
  - "config:server"
  - "@meekojs/meeko/build#buildProject"
  - docs/framework.md#build-despliegue-y-verificación
  - docs/framework.md#sitio-estático
  - docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
---

`meeko build` construye la aplicación para producción. Primero hace todo lo que hace [`meeko check`](/docs/reference/meeko-check) (y se detiene con sus mismos errores); después compila el cliente con Vite, el servidor de su adaptador y las páginas `render: "prerender"`, y escribe una carpeta que se ejecuta sin las fuentes de la aplicación: `.meeko/output/node/`, `bun/`, `deno/`, `cloudflare/` o `static/`.

El adaptador sale de `--adapter`, de `server.adapter` en `meeko.config.ts` o, por defecto, `node`.

## Uso

```sh
meeko build
```

```text
C:\proyectos\tienda\.meeko\output\node
```

La única línea de la salida estándar es la carpeta generada, así que un script puede usarla (`out=$(meeko build)`). Los avisos van a la salida de errores.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `[directorio]` | ruta | `.` | Raíz del proyecto. |
| `--adapter <nombre>` o `--adapter=<nombre>` | `node` \| `bun` \| `deno` \| `cloudflare` \| `static` | `server.adapter`, o `node` | Adaptador de esta ejecución. Puede ir en cualquier posición después de `build`. No cambia qué opciones de `server` se leen: `host` y `port` sólo con `server.adapter: "node"`, `headerFiles` sólo con `"static"`, y `contentSecurityPolicy` y `headers` de un `server` que no es `"static"` se aplican con cualquier adaptador con servidor. |
| `MEEKO_PUBLIC_ORIGIN` | origen | ninguno | Origen de las URL absolutas (`sitemap.xml`, `robots.txt`, `document.seo`) si `meeko.config.ts` no declara `site`. |
| `.env` del proyecto | | | Se lee antes de la configuración, como en `meeko check`. |

## Resultado

| Adaptador | Carpeta | Contenido | Se ejecuta con |
| --- | --- | --- | --- |
| `node` | `.meeko/output/node/` | `index.mjs`, `chunks/`, `client/`, `prerender/` | `meeko start`, `meeko preview` o `node .meeko/output/node/index.mjs`; necesita `node_modules` con `@meekojs/meeko` |
| `bun` | `.meeko/output/bun/` | `index.js` con todas las dependencias, `chunks/`, `client/`, `prerender/` | `bun .meeko/output/bun/index.js` |
| `deno` | `.meeko/output/deno/` | `main.js` con todas las dependencias, `chunks/`, `client/`, `prerender/` | `deno run --allow-net --allow-env --allow-read=.meeko/output/deno …/main.js` |
| `cloudflare` | `.meeko/output/cloudflare/` | `worker.js`, `wrangler.jsonc`, los assets y las páginas prerenderizadas | `wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc` |
| `static` | `.meeko/output/static/` | El HTML y el payload de cada página, los assets, `404.html` y los archivos de cabeceras | Cualquier hosting estático |

Además:

- **El build de Node** fija en el bundle `server.host` y `server.port` (si `server.adapter` es `"node"`), el manifiesto de rutas, endpoints y assets, y un `buildId` nuevo en cada ejecución, que desde `1.7` forma parte del `ETag` de la [caché de páginas](/docs/framework#caché-de-páginas-ssr).
- **Desde `1.7`**, con `adapter: "node"`, `"bun"`, `"deno"` o `"cloudflare"`, `server.contentSecurityPolicy` y `server.headers` quedan en el manifiesto de la aplicación, que los aplica a cada respuesta: la política con los hashes de cada página prerenderizada, un nonce por respuesta en SSR y `default-src 'none'` en el JSON.
- **El prerender** usa un servidor de Node: el del propio build con `node`, o uno intermedio en `.meeko/build/node/` con los demás adaptadores (y con `node` cuando hay `sitemap`). Desde `1.7`, ese mismo servidor evalúa `sitemapEntries`.
- **`sitemap.xml` y `robots.txt`** se escriben en el cliente si están activados.
- **Los módulos** reciben los hooks `build:before`, `routes:resolved` y `build:done`.

## Ejemplos

### Node, con su CSP y sus cabeceras

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "node",
    port: 8080,
    contentSecurityPolicy: { "default-src": ["'self'"], "object-src": ["'none'"], "base-uri": ["'none'"] },
    headers: { "X-Content-Type-Options": "nosniff", "/admin/*": { "X-Robots-Tag": "noindex" } },
  },
});
```

```sh
meeko build && meeko start
```

Una página prerenderizada responde entonces con `content-security-policy: default-src 'self'; object-src 'none'; base-uri 'none'; style-src 'self' 'sha256-…'` y `x-content-type-options: nosniff`. Antes de `1.7`, estas dos opciones sólo existían con `adapter: "static"`.

### Otro adaptador sin tocar la configuración

```sh
meeko build --adapter deno
meeko preview --adapter deno
```

`preview` necesita el mismo `--adapter`: sin él, busca el build del adaptador de la configuración.

### Un sitio estático con sitemap

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com meeko build --adapter static
```

```text
[meeko] Sin app/error.meeko, el adaptador static no genera 404.html; el hosting mostrará su propia página 404.
C:\proyectos\blog\.meeko\output\static
```

Todas las páginas deben ser `render: "prerender"` y la aplicación no puede tener API, RPC, Socket ni middleware de servidor.

### En CI, con la salida en una variable

```sh
set -e
out=$(npx meeko build)
tar -czf app.tgz -C "$out" .
```

En PowerShell: `$out = npx meeko build`.

## Errores comunes

### Un adaptador que no existe, o sin nombre

```sh bad
meeko build --adapter vercel
meeko build --adapter
```

`Adaptador desconocido: vercel; usa node, cloudflare, deno, bun o static` y `Falta el nombre del adaptador en --adapter de build`, ambos con código `1`. Repetir la opción da `--adapter aparece más de una vez en build`.

```sh good
meeko build --adapter node
```

### Un sitemap sin origen público

```ts bad
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ sitemap: true });
```

`meeko build` se detiene antes de compilar nada: `sitemap necesita la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`. `document.seo` con `canonical` u `ogUrl` da el mismo error.

```ts good
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ site: "https://example.com", sitemap: true });
```

### El adaptador `static` con partes de servidor

```sh bad
# la aplicación tiene server/api/health.get.ts
meeko build --adapter static
```

```text
El adaptador static genera un sitio sin servidor, pero la aplicación necesita uno:
- endpoints de API: GET /api/health (server/api/health.get.ts)
Usa render: "prerender" (con prerenderEntries en las rutas dinámicas) y quita lo que se ejecuta en el servidor, o elige otro adaptador.
```

```sh good
meeko build --adapter node
```

### Una ruta dinámica prerenderizada sin `prerenderEntries`

```ts bad
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender" });
```

`meeko check` no lo detecta; `meeko build` falla al prerenderizar con `Dynamic prerender route /blog/[slug] requires prerenderEntries`.

```ts good
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "hola-meeko" }] });
```

### Un archivo de `public/` que choca con uno generado

```text bad
public/sitemap.xml      ← y sitemap: true en meeko.config.ts
```

`El archivo público sitemap.xml (de public/ o de un módulo) choca con el que genera la opción sitemap de meeko.config.ts; quita uno de los dos`. Lo mismo vale para `robots.txt`, y con Cloudflare, `public/_meeko` está reservado.

```text good
public/favicon.svg      ← sitemap.xml lo genera el build
```

## Notas

- **Comprueba antes de construir.** `meeko build` ejecuta la comprobación completa de `meeko check` (TypeScript incluido), así que en CI basta con `meeko build` si no necesitas separar las fases. Un error de tipos detiene el build sin escribir la salida.
- **La salida es autónoma.** Los builds no leen `app/`, `server/` ni `meeko.config.ts` al ejecutarse, ni cargan TypeScript o Vite. El de Node necesita `node_modules` (con `@meekojs/meeko`); los de Bun y Deno no.
- **Variables de entorno.** `MEEKO_HOST`, `MEEKO_PORT` (o `PORT`) y `MEEKO_PUBLIC_ORIGIN` se leen al arrancar la salida, no al construir; el build sólo fija los valores por defecto de `server.host` y `server.port`. Lo que lee `process.env` durante el build es lo que usan el prerender y `sitemapEntries`.
- **Sesiones.** Construir no exige sesiones persistentes, pero arrancar la salida en producción sí: define `MEEKO_REDIS_URL` o declara `sessions` en `server/runtime.ts` (véase [`meeko start`](/docs/reference/meeko-start)).
- **Rendimiento.** El build de cliente y el de servidor son dos pasadas de Vite; con `sitemap` y `adapter: "node"` el servidor se construye dos veces. La comprobación con TypeScript suele ser la parte más larga.
- **Windows y POSIX.** La ruta impresa usa el separador del sistema. `.meeko/output/<adaptador>/` se vacía en cada build: no guardes nada ahí.
