# Construir y desplegar

Esta guía desarrolla [la visión general del framework](framework.md).

## Build, despliegue y verificación

```sh
npm run check   # manifiestos, tipos, componentes y proyectos TypeScript separados
npm run build   # cliente, servidor Node y prerender bajo .meeko/output/node/
npm start       # Node 24, con store persistente configurado
```

`meeko build [directorio] [--adapter <nombre>]` toma el adaptador de `--adapter` o de `server.adapter` en `meeko.config.ts`, con `node` por defecto. `MeekoConfig.server` es una unión discriminada; para Node acepta `{ adapter: "node", host?, port? }`. El build Node escribe `.meeko/output/node/` con `index.mjs`, `chunks/`, `client/` y `prerender/`. Esa carpeta contiene el manifiesto de rutas, endpoints y assets ya resuelto: no lee `app/`, `server/` ni `meeko.config.ts` y no carga TypeScript ni Vite. Sólo necesita las dependencias de `node_modules`, incluida `@meekojs/meeko`. `meeko start` y `meeko preview` ejecutan `index.mjs`; también puede ejecutarse con `node .meeko/output/node/index.mjs`. Para Bun y Deno, `meeko build --adapter bun` o `--adapter deno` (o `server: { adapter: "bun" }` / `{ adapter: "deno" }`) produce una salida autónoma descrita en [Bun](#bun) y [Deno](#deno), y `--adapter cloudflare` un Worker descrito en [Cloudflare Workers](#cloudflare-workers). Desde `1.3`, `--adapter static` (o `server: { adapter: "static" }`) genera un sitio de archivos para un hosting estático; véase [Sitio estático](#sitio-estático).

El servidor escucha en `127.0.0.1:4173` salvo que `server.host`/`server.port` o las variables `MEEKO_HOST` y `MEEKO_PORT` (o `PORT`) indiquen otra dirección; use `MEEKO_HOST=0.0.0.0` para aceptar tráfico remoto. `MEEKO_PUBLIC_ORIGIN` fija el origen público para las comprobaciones de Origin de HTTP y Socket cuando un proxy termina TLS. `SIGINT` y `SIGTERM` cierran Socket, HTTP, las tareas de `waitUntil` y el runtime, por ese orden. Las respuestas abiertas, como un stream, disponen de `shutdownTimeout` milisegundos (10 000 por defecto) para terminar; después se cortan sus conexiones y el cierre continúa. Si el cliente se desconecta antes o durante el envío, el cuerpo de la respuesta se cancela, lo que libera archivos abiertos y detiene productores de streams. Un request-target que empieza por `//` se interpreta siempre como ruta del origen propio (o de `MEEKO_PUBLIC_ORIGIN`), nunca como otro host.

`meeko start` no comprime las respuestas: en producción hace falta un proxy o una CDN que lo haga. La diferencia es grande: `/docs/framework` de este sitio, con todos sus recursos, pasa de 2.220 KB a 419 KB con Brotli, medido con un proxy local. Compruebe el resultado con `curl -s -o /dev/null -D - -H 'accept-encoding: br, gzip' <url>`, que debe devolver `content-encoding`. Las páginas `"stream"` piden no comprimirse (`no-transform`), porque la compresión con buffer retendría sus bloques; véase [Streaming SSR](framework-rendering.md#streaming-ssr-render-stream).

Los archivos públicos se sirven sólo si figuran en el manifiesto de assets generado con el build cliente (incluida la copia de `public/`); cualquier otra ruta pasa a la aplicación y nunca se lee del disco. Cada asset lleva `ETag`, `content-length` y soporte de `HEAD` y `304`; sólo los archivos emitidos por Vite y listados en su manifiesto (con hash de contenido) usan `cache-control: public, max-age=31536000, immutable`; el resto, incluidos los de `public/assets/`, usan `public, max-age=0, must-revalidate`. La clave de cada asset es su ruta tal como la serializa la URL WHATWG, la misma que pide el navegador: `public/logo@2x.png` se sirve en `/logo@2x.png`, `a b.txt` en `/a%20b.txt` y un nombre no ASCII en su forma codificada en UTF-8. El HTML enlaza la entrada cliente, su CSS y sus `modulepreload` desde el manifiesto de Vite; la lista de rutas del cliente se importa como módulo y ya no se inserta en el documento.

Para un servicio público, sitúelo tras un proxy HTTPS, configure `MEEKO_PUBLIC_ORIGIN`, sesiones persistentes y cierre ordenado. La exportación OpenAPI es opcional mediante `generateOpenApi`; un schema que no pueda representarse produce error explícito.

El starter independiente creado con `meeko init` coordina el cierre de HTTP y Vite ante `SIGINT` y `SIGTERM`. El cierre es idempotente; si fallan ambos recursos conserva las dos causas y fija un código de salida fallido, sin dejar rechazos de promesas sin observar. El host de framework conserva del mismo modo el error original de arranque y comunica por el observador central cada fallo adicional al cerrar Socket, sesiones o Vite.

El adaptador Node entrega por separado varias cabeceras `Set-Cookie` y deja de transmitir el cuerpo si el cliente cierra la conexión. Una respuesta ya iniciada no puede sustituirse por un JSON de error; el adaptador cierra esa conexión y comunica el fallo al observador del host.

### Sitio estático

```sh
npx meeko build --adapter static     # .meeko/output/static/
npx meeko preview --adapter static   # la sirve como un hosting estático
```

Desde `1.3`, el adaptador `static` escribe en `.meeko/output/static/` un sitio sin servidor, listo para subir tal cual a nginx, Netlify, Cloudflare Pages, GitHub Pages o un bucket:

- los assets del cliente y `public/`;
- cada página prerenderizada como `<ruta>/index.html` (`/docs/api` → `docs/api/index.html`, con los segmentos decodificados como los pide el hosting) y su payload de navegación `<ruta>/index.meeko.json`;
- `404.html`, la página de `app/error.meeko` con estado `404` dentro de sus layouts (sin `app/error.meeko` no se genera y el build lo avisa);
- `sitemap.xml` y `robots.txt` si están activados, y los archivos de cabeceras de `headerFiles`.

Un hosting estático no negocia `Accept`, así que el cliente de este build no pide la página con `Accept: application/meeko+json`: lee el archivo `index.meeko.json` de la carpeta de la página (`/docs/api/index.meeko.json`, sin la query string). La navegación cliente funciona, por tanto, con cualquier hosting que sirva los archivos; el de los demás adaptadores sigue negociando `Accept`. `404.html` hidrata en cualquier URL, también en una que coincide con una ruta dinámica cuya página no se prerenderizó (`/docs/[slug]` con `slug` desconocido), y navega en el cliente desde ella; una ruta cuyo payload no existe muestra la página de error sin recargar. Los hostings sirven `404.html` para las URL que no existen (en nginx, `error_page 404 /404.html;`).

Todas las páginas deben usar `render: "prerender"`, con `prerenderEntries` en las rutas dinámicas. Antes de compilar nada, el build falla con la lista de lo que necesita un servidor: las páginas `"ssr"`, `"stream"` o `"client"`, los endpoints de API, los procedimientos RPC, los canales Socket, el middleware de `server/middleware` y los handlers de servidor de los módulos. El middleware de ruta (`app/middleware`) se ejecuta al prerenderizar y al navegar en el cliente, pero no en la primera carga de una página; el build lo avisa. `server/runtime.ts` sólo se ejecuta mientras se prerenderiza. Un archivo de `public/` que choca con uno generado (`404.html`, `sitemap.xml`, `robots.txt`, `_headers`, `_meeko/headers.conf` o el `index.html` de una página) es un error.

`server` acepta, con `adapter: "static"`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	site: 'https://example.com',
	sitemap: true,
	robots: true,
	document: { seo: true },
	server: {
		adapter: 'static',
		headerFiles: ['_headers', 'nginx'],
		contentSecurityPolicy: {
			'default-src': ["'self'"],
			// data: para el <link rel="icon" href="data:,"> que Meeko pone si la aplicación no tiene icono.
			'img-src': ["'self'", 'data:'],
			'script-src': ["'self'"],
			'style-src': ["'self'", "'unsafe-inline'"],
			'object-src': ["'none'"],
			'base-uri': ["'none'"],
		},
		headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' },
	},
})
```

- `contentSecurityPolicy`: la `Content-Security-Policy` de todas las páginas, por directiva. El build le añade los hashes de los scripts en línea; véase [CSP con hashes](#csp-con-hashes).
- `headers`: otras cabeceras de todas las respuestas. `Content-Security-Policy` no se admite aquí, porque perdería los hashes.
- `headerFiles`: dónde se escriben esas cabeceras. Por defecto, en ningún sitio: un hosting estático no las lee de la configuración de Meeko, así que cada formato es opcional y explícito.
- `img-src` con `data:`: un documento sin icono propio lleva `<link rel="icon" href="data:,">`, para que el navegador no pida `/favicon.ico`. Con `default-src 'self'` y sin `data:` en `img-src`, el navegador bloquea ese icono y registra una violación de CSP en la consola de cada página; no rompe nada más. Basta con añadir `data:` a `img-src`, como en el ejemplo, o declarar un icono propio (`document.head.link: [{ rel: 'icon', href: '/favicon.svg' }]`), que sustituye al de Meeko.
  - `"_headers"` escribe `/_headers`, el formato de Netlify y Cloudflare Pages, con un bloque `/*` para todas las rutas. Esos hostings lo leen y no lo publican.
  - `"nginx"` escribe `/_meeko/headers.conf`, una línea `add_header … always;` por cabecera, para incluirlo en cada `location` (un `add_header` dentro de una `location` anula los del `server`). El archivo está dentro de la raíz web, así que la configuración debe ocultar `/_meeko/`:

```nginx
server {
  root /usr/share/nginx/html;   # el contenido de .meeko/output/static
  location / {
    include /usr/share/nginx/html/_meeko/headers.conf;
    try_files $uri $uri/index.html =404;
  }
  location ^~ /_meeko/ { internal; }
  error_page 404 /404.html;
}
```

Esas opciones sólo se leen cuando `server.adapter` es `"static"`; con `meeko build --adapter static` sobre otra configuración se construye sin ellas. `meeko preview` sirve la carpeta como lo haría un hosting (el archivo, el `index.html` de la carpeta o `404.html` con estado `404`, sin publicar `_headers` ni `_meeko/`) y aplica la CSP y `headers`, en `127.0.0.1:4173` salvo que `MEEKO_HOST` y `MEEKO_PORT` digan otra cosa. `meeko start` sirve sólo el build de Node. El build sigue usando Node y Vite, y el prerender, un servidor Node intermedio en `.meeko/build/node/`, como en Bun.

### `sitemap.xml` y `robots.txt`

```ts
export default defineMeekoConfig({
	site: 'https://example.com',
	sitemap: { exclude: ['/admin', '/admin/*'] }, // o sitemap: true
	robots: { disallow: ['/admin/'] }, // o robots: true
})
```

Desde `1.3`, `sitemap` escribe `sitemap.xml` (protocolo sitemaps.org 0.9) con la URL absoluta de cada página prerenderizada y de cada ruta sin parámetros, sea `"ssr"`, `"stream"` o `"client"`; las rutas dinámicas sin prerender no se conocen en el build salvo que declaren [`sitemapEntries`](#rutas-dinámicas-en-el-sitemap-sitemapentries) (desde `1.7`). Se omiten las páginas prerenderizadas que piden `<meta name="robots" content="noindex">` (o `none`) y las rutas de `exclude`, donde `*` sustituye a cualquier secuencia de caracteres, `/` incluida. `robots` escribe `robots.txt` con `User-agent: *`, sus `allow` y `disallow` (`Allow: /` sin ninguno) y, con `sitemap`, la línea `Sitemap:` con su URL absoluta.

Las URL necesitan el origen público: `site` o, sin él, `MEEKO_PUBLIC_ORIGIN` del build. Con `sitemap` y sin origen, el build falla antes de compilar; `robots` sin `sitemap` no lo necesita. Valen para todos los adaptadores. En Node, Bun, Deno y Workers se sirven como los demás archivos públicos, desde el manifiesto de assets del build: como el sitemap lista las páginas prerenderizadas, el adaptador Node las renderiza con un servidor intermedio y construye el suyo después, con el sitemap en su manifiesto (una compilación de servidor más, sólo con `sitemap`). Un `public/sitemap.xml` o `public/robots.txt` choca con la opción correspondiente y el build falla.

#### Rutas dinámicas en el sitemap: `sitemapEntries`

Desde `1.7`, una página con render en el servidor declara sus URL del sitemap con `sitemapEntries` en `definePage`: una lista de `{ params, lastmod?, changefreq?, priority? }` (tipo `SitemapEntry`) o una función, síncrona o asíncrona, que la devuelve. Es la vía para las rutas dinámicas con `"ssr"` o `"stream"`, cuyas URL el build no puede adivinar:

```ts
// app/pages/docs/[slug].route.ts (o el <script server> de la página)
import { definePage } from '@meekojs/meeko/framework'
import { docs } from '../../../server/content/bundle.js'

export const route = definePage({
	sitemapEntries: ({ env }) => docs.filter((doc) => env.DOCS_DRAFTS === '1' || !doc.draft).map((doc) => ({ params: { slug: doc.slug }, lastmod: doc.updatedAt, changefreq: 'weekly' })),
})
```

- **Cuándo y con qué.** `meeko build` la evalúa una vez, después de prerenderizar, en el servidor de Node intermedio con el que prerenderiza: el runtime de `server/runtime.ts` ya existe con `prerendering: true`, pero no hay petición, sesión ni `services` por petición. La función recibe `SitemapEntriesContext`: `env` (el `process.env` del build) y `prerendering` (siempre `true`). Lea los datos de lo que el build tiene a mano, como un bundle de contenido; si consulta una base de datos, debe estar accesible durante el build. Sólo se ejecuta con `sitemap` en `meeko.config.ts`, y Meeko sólo carga las opciones de las rutas que la nombran: escríbala en las opciones, no a través de un spread.
- **Qué devuelve cada entrada.** `params` construye la URL como `href`; una ruta sin parámetros los omite y la entrada sólo añade campos a su URL. `lastmod` es un `Date` (se escribe con `toISOString()`) o un texto W3C Datetime (`"2026-10-01"`, `"2026-10-01T12:00:00Z"`); `changefreq` es `always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly` o `never`, y `priority`, un número de `0` a `1`. Un valor fuera de esos, una URL repetida, unos `params` que no forman la URL o una URL que resuelve otra ruta detienen el build con la ruta.
- **Con `render: "prerender"`.** Las páginas prerenderizadas ya están en el sitemap; `sitemapEntries` sólo les añade `lastmod`, `changefreq` y `priority`. Una entrada sin página prerenderizada detiene el build: añádala a `prerenderEntries` o quítela. Así el sitemap nunca anuncia una URL que el adaptador `static` no tiene.
- **`exclude` y `noindex` ganan.** Una URL declarada que coincide con `sitemap.exclude`, o una página prerenderizada con `noindex`, no se lista.
- **`render: "client"`.** Sus opciones llegan al navegador, así que no admite `sitemapEntries`: es un error de tipos y detiene `meeko dev`, `meeko build` y `meeko check`. Una página `"client"` sin parámetros ya está en el sitemap.

Funciona igual con todos los adaptadores: el sitemap se escribe en los archivos públicos del build y en Node, Bun, Deno y Workers se sirve desde su manifiesto de assets. El adaptador `static` no admite rutas `"ssr"`, así que en él `sitemapEntries` sólo completa las páginas prerenderizadas.

#### Sitemap servido desde una base de datos

Desde `1.8`, `sitemapXml(origin, urls)` de `@meekojs/meeko/framework` es la función con la que `meeko build` escribe el archivo. Si las páginas cambian sin desplegar, desactive la opción (`sitemap: false`) y sirva el sitemap desde un middleware de servidor, sin escribir el XML a mano:

```ts
// server/middleware/sitemap.ts
import { sitemapXml } from '@meekojs/meeko/framework'
import { defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	if (new URL(request.url).pathname !== '/sitemap.xml') return next(request)
	const pages = await db.pages.list()
	const xml = sitemapXml(
		'https://example.com',
		pages.map((page) => ({
			pathname: page.path,
			lastmod: page.updatedAt,
			alternates: [
				{ hreflang: 'es', pathname: page.path },
				{ hreflang: 'en', pathname: `/en${page.path}` },
				{ hreflang: 'x-default', pathname: page.path },
			],
		})),
	)
	return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } })
})
```

Cada URL es una ruta o un `SitemapResolvedUrl` (`{ pathname, lastmod?, changefreq?, priority?, alternates? }`). La función escapa el XML, añade el espacio de nombres `xhtml` sólo si alguna URL tiene `alternates` y no ordena la lista. Un `hreflang` inválido o un `pathname` de `alternates` que no empieza por `/` lanzan un error. No usa APIs de Node, así que también funciona en Workers.

### CSP con hashes

Una `Content-Security-Policy` sin `'unsafe-inline'` bloquea los scripts en línea de un documento, como uno de `document.head.script` o el que añade [`theme`](framework-rendering.md#tema-clarooscuro-sin-parpadeo). Para las páginas que se generan en el build, Meeko permite cada uno por su hash SHA-256, sin nonce por petición:

- Desde `1.3`, el índice `prerender/manifest.json` guarda en `pages[ruta].scriptHashes` las fuentes `'sha256-…'` de los `<script>` en línea que ejecuta cada página prerenderizada: los de JavaScript, `module`, `importmap` y `speculationrules`. Los bloques de datos (`application/json`, como el payload de Meeko, y `application/ld+json`) y los scripts con `src` no cuentan. Desde `1.7`, sólo cuentan los que escribe Meeko fuera de la página (el `<head>`, el payload, la entrada y `document.bodyEnd`): un `<script>` o un `<style>` dentro de `#app` o de un teleport, que puede venir de contenido de usuario, no recibe hash.
- `inlineScriptHashes(html)` de `@meekojs/meeko/build` devuelve `{ hashes, unhashable }` para cualquier documento: los hashes y el JavaScript que un hash no puede permitir, los atributos `on*` y las URL `javascript:`. Lee el HTML como el navegador, así que el hash coincide con el que éste comprueba. Lee el documento entero, también lo que hay dentro de `#app`: para una página de Meeko, use los hashes del índice.
- `contentSecurityPolicy(policy, hashes)` de `@meekojs/meeko/server` construye el valor de la cabecera: añade los hashes a `script-src` (desde `1.7`, a `script-src-elem` si la política la tiene) sin repetir fuentes o, si la política no tiene `script-src`, a una copia de las fuentes de `default-src` (sin ninguna de las dos, los scripts ya están permitidos y no añade nada). Con hashes, el navegador ignora `'unsafe-inline'` de `script-src`.
- Desde `1.4`, lo mismo con los `<style>` en línea, como el de los iconos de [`<MeekoThemeToggle>`](framework-rendering.md#meekothemetoggle) y los de los componentes: `pages[ruta].styleHashes` en el índice, `inlineStyleHashes(html)` de `@meekojs/meeko/build` (los atributos `style="…"` no cuentan, porque un hash no los permite) y un tercer argumento, `contentSecurityPolicy(policy, scriptHashes, styleHashes)`, que los añade a `style-src-elem` si la política la tiene, si no a `style-src` o a una copia de `default-src`. A diferencia de los scripts, no los añade a una directiva que ya admite `'unsafe-inline'`: no hace falta, y el hash anularía `'unsafe-inline'` para los atributos `style="…"`.

El adaptador `static` hace todo eso con `server.contentSecurityPolicy`: calcula los hashes de los scripts y, desde `1.4`, de los `<style>` de todos los `.html` de su salida (`404.html` y los de `public/` incluidos; desde `1.7`, en los documentos de Meeko sólo los de fuera de `#app` y de los teleports, y un `.html` propio se lee entero), los añade a la política y escribe la cabecera en `headerFiles`. Si una página tiene un atributo `on*` o una URL `javascript:`, el build falla con la lista de archivos: use un script o `on:` del componente. Cambiar un script cambia su hash en el siguiente build, sin tocar la política.

```ts
// Un host propio que sirve el build de Node con CSP para sus páginas prerenderizadas.
import { readFile } from 'node:fs/promises'
import { contentSecurityPolicy } from '@meekojs/meeko/server'
import type { PrerenderIndex } from '@meekojs/meeko/build'

const index = JSON.parse(await readFile('.meeko/output/node/prerender/manifest.json', 'utf8')) as PrerenderIndex
const hashes = [...new Set(Object.values(index.pages).flatMap((page) => page.scriptHashes ?? []))]
const header = contentSecurityPolicy({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'object-src': ["'none'"] }, hashes)
```

Desde `1.7`, los adaptadores con servidor ponen la cabecera ellos mismos con `server.contentSecurityPolicy` (véase la sección siguiente). Sin esa opción, `meeko start` no añade ninguna CSP: un host propio usa el nonce de `DocumentOptions.nonce`, que Meeko pone en sus `<script>` y `<style>`, y entonces una página prerenderizada no se sirve desde el archivo, porque el nonce cambia en cada respuesta.

### CSP y cabeceras en los adaptadores con servidor

Desde `1.7`, `server.contentSecurityPolicy` y `server.headers` también existen con `adapter: "node"`, `"bun"`, `"deno"` y `"cloudflare"`. Se fijan en el build (en el manifiesto de la aplicación, `AppManifest.contentSecurityPolicy` y `AppManifest.headers`) y la aplicación los aplica a cada respuesta:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	server: {
		adapter: 'node',
		contentSecurityPolicy: {
			'default-src': ["'self'"],
			// data: para el <link rel="icon" href="data:,"> que Meeko pone si la aplicación no tiene icono.
			'img-src': ["'self'", 'data:'],
			'script-src': ["'self'"],
			// Shiki y otros resaltadores escriben atributos style="…": esta directiva se queda como está.
			'style-src': ["'self'", "'unsafe-inline'"],
			'object-src': ["'none'"],
			'base-uri': ["'none'"],
			'frame-ancestors': ["'none'"],
		},
		headers: {
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'strict-origin-when-cross-origin',
			'/admin/*': { 'X-Robots-Tag': 'noindex' },
		},
	},
})
```

**La CSP según la respuesta.** Meeko completa la política de cada respuesta con lo que su cuerpo necesita:

| Respuesta                                                                        | `Content-Security-Policy`                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Página prerenderizada                                                            | La política con los hashes de los scripts y `<style>` en línea que escribe Meeko (`scriptHashes` y `styleHashes` del índice de prerender, como el adaptador `static`). La página se sigue sirviendo desde su archivo, con su `ETag` y su `304`.                                |
| Página SSR, `"stream"`, página de error y 404                                    | La política con un nonce nuevo en cada respuesta en `script-src` (en `script-src-elem` si la política la tiene, o en una copia de `default-src`), que Meeko pone en sus `<script>`, sus `<style>`, la entrada del cliente, el script del tema y los de `useHead` y `document`. |
| Página SSR con [`cache`](framework-rendering.md#caché-de-páginas-ssr)                                  | La política con los hashes de los scripts y `<style>` en línea que escribe Meeko, sin nonce: el documento es el mismo para todos y en cada revalidación, y un nonce no sobrevive a un `304`.                                                                                   |
| JSON de API, RPC y payload de navegación                                         | `default-src 'none'; frame-ancestors 'none'`: el JSON no ejecuta ni carga nada. Se aplica a toda respuesta de `server/api` y del RPC, también a la de un endpoint con `contentType: "response"`.                                                                               |
| Cualquier otra (archivos públicos, handlers de módulos, 404 sin página de error) | La política tal cual.                                                                                                                                                                                                                                                          |

**Qué autorizan los hashes.** Sólo el código en línea que escribe Meeko fuera de la página: el `<head>` (el script y el estilo del tema, la reserva de `<MeekoAwait>`, `useHead`, `document.head` y los `<style>` de los componentes), el payload si no es un bloque de datos, la entrada del cliente y `document.bodyEnd`. Un `<script>` o un `<style>` dentro de `#app` o de un teleport (de `html="…"`, de contenido de usuario mal saneado o escrito en la plantilla) nunca recibe hash, así que el navegador lo bloquea, igual que con nonce. Un `<script>` o `<style>` en la plantilla de una página con `cache` o prerenderizada debe ir en `useHead` o en un archivo.

Meeko nunca añade un nonce ni un hash a una directiva con `'unsafe-inline'`: con uno, el navegador ignoraría `'unsafe-inline'` y bloquearía lo que esa directiva permitía a propósito, como los atributos `style="…"` que escriben Shiki y otros resaltadores. La excepción es `'strict-dynamic'` (desde `1.7`): con él, el navegador ya ignora `'unsafe-inline'` y las fuentes de host, que quedan sólo para navegadores antiguos, así que `script-src 'strict-dynamic' 'unsafe-inline' https:` recibe el nonce o los hashes. Con `'strict-dynamic'`, la entrada del cliente (`<script src>`) sólo carga con nonce: en una página con `cache` o prerenderizada, que usan hashes, el navegador la bloquea, así que esas páginas no hidratan; use `'strict-dynamic'` sólo si todas sus páginas son SSR sin `cache`. Si la política tiene `script-src-elem` o `style-src-elem`, el nonce y los hashes van a esa directiva, que es la que rige los elementos. Con `style-src 'self' 'unsafe-inline'`, los `<style>` de Meeko entran por `'unsafe-inline'`; con un `style-src` estricto, por el nonce o el hash, como los scripts. Una respuesta que ya trae `Content-Security-Policy` (de un handler o de un middleware) la conserva, y un `304` nunca lleva la política: el navegador actualiza con él las cabeceras de su copia, y una política sin los hashes de ese documento sustituiría a la suya. El nonce lo genera Meeko (128 bits aleatorios); si el host pasa `DocumentOptions.nonce`, se usa el suyo, y `document.bodyEnd` y `document.head` lo reciben como siempre.

Con un atributo `on*` o una URL `javascript:` en el HTML, el navegador los bloquea igual con nonce que con hashes; muévalos a un script o a `on:` del componente. Calcular los hashes de una página con `cache` lee su HTML con el mismo analizador que el build (`parse5`), una vez por render; con `cache.memory`, una vez por versión de la página. La CSP sólo se aplica en producción (`meeko start`, `meeko preview` y las salidas de cada adaptador): en `meeko dev`, Vite inyecta scripts y estilos sin nonce ni hash.

**Cabeceras.** Cada clave de `headers` con nombre de cabecera se aplica a todas las respuestas; una clave que empieza por `/` es un patrón de ruta (el `pathname`, sin query) con sus propias cabeceras, que se aplican después de las globales y en el orden escrito, de modo que la última gana. En el patrón, `*` sustituye a cualquier secuencia de caracteres, `/` incluida: `"/docs/*"` coincide con `/docs/api` pero no con `/docs`. Una cabecera que la respuesta ya trae (de Meeko, de un handler o de un middleware) no se sustituye: `Cache-Control` de una página o de un archivo, por ejemplo, gana a la de `headers`. `Content-Security-Policy` no se admite en `headers`, y con `adapter: "static"` las claves con patrón son un error, porque `headerFiles` escribe un único bloque para todas las rutas. A diferencia de la CSP, `headers` también se aplica en `meeko dev` a lo que atiende la aplicación (páginas, API y RPC); los archivos que sirve Vite no las llevan.

**Workers.** Cloudflare Workers aplica la CSP y las cabeceras igual que Node, Bun y Deno: los hashes y el nonce usan Web Crypto, y el índice de prerender de los assets lleva los hashes de cada página.

**Un endpoint que devuelve HTML.** La política de JSON (`default-src 'none'`) se aplica a todo `/api/` y al RPC. Un endpoint con `contentType: "response"` que devuelve HTML (una vista previa, una página de retorno de un pago) se pintaría sin estilos ni scripts: ponga su propia `Content-Security-Policy` en el `Response`, que Meeko conserva.

**Workers sin CSP.** El analizador HTML que calcula los hashes (`parse5`) sólo se carga cuando hay `server.contentSecurityPolicy`; sin ella, el build de Cloudflare lo deja fuera del Worker (unos 240 KB menos).

**Cookies y cachés compartidas.** Independientemente de estas opciones, una respuesta con `Set-Cookie` y un `Cache-Control` `public` o con `s-maxage` (de la respuesta o de `headers`) sale como `private, no-store` y sin `ETag`, para que ninguna caché compartida guarde la cookie con la página.

### Bun

```sh
npx meeko build --adapter bun
npx meeko preview --adapter bun      # ejecuta la salida con `bun`
bun .meeko/output/bun/index.js       # en producción
```

El build Bun escribe `.meeko/output/bun/` con `index.js`, `chunks/`, `client/` y `prerender/`. A diferencia del build Node, `index.js` incluye `@meekojs/meeko` y el resto de dependencias del servidor: la carpeta no necesita `node_modules`, ni las fuentes de la aplicación, ni TypeScript o Vite. Copie la carpeta completa al servidor. El build y el prerender siguen ejecutándose con Node; Meeko construye para ello un servidor Node intermedio en `.meeko/build/node/`, que no forma parte de la salida.

La salida escucha en `127.0.0.1:4173` salvo que `MEEKO_HOST` y `MEEKO_PORT` (o `PORT`) indiquen otra dirección; `MEEKO_PUBLIC_ORIGIN` cumple la misma función que en Node. `server.host` y `server.port` sólo se aplican a Node. `SIGINT` y `SIGTERM` detienen `Bun.serve`, cierran las conexiones activas y después la aplicación. Desde `1.3`, los rechazos sin manejar y las excepciones no capturadas siguen `processErrors` (véase [Fallos fuera de una petición](framework-server.md#fallos-fuera-de-una-petición)); un host propio con `createBunServer` lo consigue con `handleProcessErrors`. `meeko preview` lanza `bun` como proceso hijo, le reenvía las señales y adopta su código de salida; si `bun` no está en el `PATH`, falla con un mensaje explícito.

Para alojar la aplicación en un servidor propio, `createBunServer(app, options)` devuelve `{ fetch, websocket }` para `Bun.serve({ port, ...createBunServer(app) })`, y `createBunAssetReader({ root, assets })` sirve los archivos del manifiesto con `Bun.file`. Límites de Socket:

- `maxPayloadLength`: el frame entrante más grande. Por defecto, `socket.maxMessageBytes` de `server/runtime.ts` o 64 KiB. Bun cierra los frames mayores y el hub responde `1009` a un mensaje que supere el límite de la aplicación.
- `backpressureLimit`: bytes salientes pendientes por peer, 1 MiB por defecto. Un envío que lo supera cierra ese peer con `1011` sin bloquear al resto de la sala.
- `idleTimeout` (60 s) y `sendPings` (activo) mantienen vivas las conexiones sanas y cierran las inactivas. Los mensajes binarios se cierran con `1003`. La compresión por mensaje está desactivada.

### Deno

```sh
npx meeko build --adapter deno
npx meeko preview --adapter deno                 # ejecuta `deno run -A` sobre la salida
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

El build Deno escribe `.meeko/output/deno/` con `main.js`, `chunks/`, `client/` y `prerender/`. Como en Bun, `main.js` incluye todas las dependencias del servidor y no necesita `node_modules`, las fuentes, TypeScript ni Vite. `meeko preview` concede todos los permisos (`-A`). En producción bastan `--allow-net`, `--allow-env` (el runtime recibe `Deno.env.toObject()`) y lectura de la carpeta de salida. `MEEKO_HOST`, `MEEKO_PORT` (o `PORT`) y `MEEKO_PUBLIC_ORIGIN` funcionan como en Node.

`serveDeno(app, { host, port, publicOrigin, platform, onError, maxMessageBytes, idleTimeout, handleSignals })` sirve la aplicación con `Deno.serve` y devuelve `{ url, finished, close() }`. `close()` cierra los peers de Socket con `1001`, detiene HTTP, espera las tareas de `waitUntil` y cierra la aplicación, por ese orden. Con `handleSignals`, lo hace ante `SIGINT` y `SIGTERM` (en Windows, `SIGINT` y `SIGBREAK`) y, desde `1.3`, aplica `processErrors` a los rechazos sin manejar y las excepciones no capturadas (véase [Fallos fuera de una petición](framework-server.md#fallos-fuera-de-una-petición)). `createDenoAssetReader({ root, assets })` sirve los archivos del manifiesto. Límites de Socket:

- `Deno.upgradeWebSocket` no ofrece un límite de frame, así que el adaptador mide cada mensaje con `maxMessageBytes` (por defecto, el límite de Socket de la aplicación o 64 KiB) y cierra con `1009` los mayores. Deno reensambla el frame en memoria antes de esa comprobación; limite el tamaño de las peticiones en el proxy si necesita un tope anterior.
- El búfer saliente se controla con el límite de búfer del hub mediante `bufferedAmount`.
- `idleTimeout` (60 s) cierra un peer que no responde al ping. Los mensajes binarios se cierran con `1003`.

### Cloudflare Workers

```sh
npx meeko build --adapter cloudflare
npx meeko preview --adapter cloudflare   # wrangler dev sobre la salida
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

El build Cloudflare escribe `.meeko/output/cloudflare/` con:

- `worker.js`: un único módulo ES que incluye `@meekojs/meeko` y las dependencias del servidor. Sólo importa `cloudflare:workers` y `node:async_hooks`, que proporciona el runtime.
- `assets/`: el build cliente y `public/`, más las páginas prerenderizadas bajo `assets/_meeko/prerender/`. El Worker lee esas páginas mediante el binding de assets y nunca las sirve como archivos; `public/_meeko/` queda reservado y detiene el build.
- `wrangler.jsonc`: la configuración generada. No la edite; se regenera en cada build.

Wrangler no vuelve a empaquetar la salida (`no_bundle: true`), así que se despliega exactamente el código que se probó. Wrangler es una herramienta de despliegue, no una dependencia de ejecución: `meeko preview` usa el de la aplicación o, en su defecto, el de la instalación de Meeko, y si no encuentra ninguno falla con «Wrangler no está instalado; añádelo con pnpm add -D wrangler…». `MEEKO_PORT` (o `PORT`) y `MEEKO_HOST` se pasan a `wrangler dev` como `--port` e `--ip`. El build y el prerender siguen ejecutándose con Node; durante el prerender, la fábrica de `server/runtime.ts` se ejecuta en Node con `prerendering: true` y sin bindings.

La configuración se declara en `meeko.config.ts`:

```ts
export default defineMeekoConfig({
	server: {
		adapter: 'cloudflare',
		name: 'mi-app', // por defecto, el nombre del package.json
		socketClassName: 'MeekoSocketRoom', // clase Durable Object de las salas
		compatibilityDate: '2026-10-19', // por defecto, la fecha con la que Meeko se prueba
		wrangler: {
			// campos adicionales de wrangler.jsonc
			d1_databases: [{ binding: 'DB', database_name: 'mi-app', database_id: '<id>' }],
			vars: { MEEKO_PUBLIC_ORIGIN: 'https://mi-app.example' },
		},
	},
})
```

El `wrangler.jsonc` generado contiene:

- `main: "./worker.js"`, `no_bundle: true` y `find_additional_modules: false`, para que los archivos de `assets/` no se suban también como módulos del Worker.
- `compatibility_flags` con `nodejs_als`, que habilita `AsyncLocalStorage` de `node:async_hooks`, unido a los flags declarados en `server.wrangler.compatibility_flags`. `nodejs_compat` también es válido, porque incluye `AsyncLocalStorage`.
- `assets` con `directory: "./assets"`, binding `ASSETS`, `run_worker_first: true` y `html_handling`/`not_found_handling` en `"none"`. Todas las peticiones llegan al Worker, que sólo sirve los archivos listados en el manifiesto con el `ETag` y la política de caché de los demás adaptadores.
- El binding Durable Object `MEEKO_SOCKET` hacia la clase de salas, antepuesto a los bindings de `server.wrangler.durable_objects`.
- La declaración de la clase de salas (`MeekoSocketRoom`, o el nombre de `server.socketClassName`), sin reescribir nunca un historial existente. Cloudflare admite dos formas por Worker, el array `migrations` o el mapa declarativo `exports`:
  - Sin `server.wrangler.migrations` ni entradas Durable Object en `exports`, Meeko genera `migrations: [{ "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] }]`. No borre ni renombre esa migración después del primer despliegue.
  - Si declara `migrations`, el historial debe crear la clase él mismo (`new_sqlite_classes`, `new_classes` o el destino de `renamed_classes`/`transferred_classes`). Las migraciones se aplican en orden y se registran por `tag`, así que anteponer la de Meeko cambiaría un historial ya desplegado; el build se detiene con «server.wrangler.migrations does not create the Socket room class …; append { "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] } at the end of server.wrangler.migrations». Añada esa entrada al final de su historial; si `meeko-socket-v1` ya es el tag de otra migración, el mensaje propone `meeko-socket-v1-<n>`, con `<n>` igual al número de migraciones más uno.
  - Si declara Durable Objects en `exports`, Meeko añade `"MeekoSocketRoom": { "type": "durable-object", "storage": "sqlite" }` cuando falta y no genera `migrations`; una entrada propia de la clase debe estar viva (sin `state` o con `"created"`). `exports` con Durable Objects y `migrations` a la vez detienen el build, porque Cloudflare sólo acepta una de las dos formas.

`main`, `assets`, `no_bundle` y `find_additional_modules` pertenecen a Meeko y no se pueden sobrescribir, ni tampoco el binding `MEEKO_SOCKET`. El resto de campos de `server.wrangler` (`routes`, `vars`, `d1_databases`, `observability`…) se copian tal cual.

En Workers, `env` de `server/runtime.ts` es el objeto de bindings del Worker y `platform` vale `"cloudflare"`. La aplicación se crea una vez por aislado, en la primera petición, y `context.platform.waitUntil` usa `ctx.waitUntil`. La variable `MEEKO_PUBLIC_ORIGIN` fija el origen público; sin ella se usa el origen de la URL enrutada. Ejemplo con D1 para las sesiones:

```ts
// server/runtime.ts
import { D1SessionDriver, DurableObjectSocketPubSub } from '@meekojs/meeko/cloudflare'
import type { D1DatabaseLike, DurableObjectNamespaceLike } from '@meekojs/meeko/cloudflare'
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from '@meekojs/meeko/server'

interface Env {
	readonly DB?: D1DatabaseLike
	readonly MEEKO_SOCKET?: DurableObjectNamespaceLike
}

export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
	const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB))
	const pubsub = env.MEEKO_SOCKET ? new DurableObjectSocketPubSub(env.MEEKO_SOCKET) : undefined
	return {
		sessions: new SessionManager({ production: production && !prerendering, store }),
		services: { pubsub },
		// Sin pubsub, el Worker usa DurableObjectSocketPubSub(env.MEEKO_SOCKET) por defecto;
		// cualquier otro broker se rechaza al crear la aplicación.
		socket: { maxMessageBytes: 16 * 1024 },
	}
})
```

#### Sesiones en D1

`D1SessionDriver(db, { table? })` implementa `SqlSessionDriver` para `SqlSessionStore`. `replace` es un único `UPDATE … WHERE id = ? AND family_id = ? AND expires_at > ?` que comprueba que haya cambiado exactamente una fila; `revokeFamily` es un `DELETE … WHERE family_id = ?`. `UNIQUE(family_id)` impide un segundo ID activo en la misma familia. `D1SessionDriver.schema(table?)` devuelve el esquema de referencia (con la tabla por defecto `meeko_sessions`):

```sql
CREATE TABLE IF NOT EXISTS "meeko_sessions" (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "meeko_sessions_expires_at" ON "meeko_sessions" (expires_at);
```

Aplíquelo como migración D1 antes de desplegar: `npx wrangler d1 migrations create <base> meeko_sessions`, copie el SQL en el archivo creado y ejecute `npx wrangler d1 migrations apply <base> --remote` (o `--local` para `wrangler dev`). Las filas caducadas se borran al leerlas; para limpiar el resto, llame a `driver.deleteExpired()` desde un Cron Trigger. D1 no notifica revocaciones a otros aislados: una conexión abierta en otro aislado detecta la revocación al releer la sesión en su siguiente evento (véase [Revocación durante una petición](framework-auth.md#revocación-durante-una-petición)).

Desde `1.7`, `D1SessionDriver(db, { rateLimitTable: "meeko_rate_limits" })` implementa también `rateLimit`, de modo que los contadores de [`rateLimit`](framework-auth.md#límite-de-peticiones-ratelimit) se comparten entre aislados en lugar de vivir en la memoria de cada uno (véase [Rate limit en SQL](framework-auth.md#rate-limit-en-sql)). Es opcional, porque necesita otra tabla: sin la opción, el driver no cambia. `D1SessionDriver.rateLimitSchema(table?)` devuelve su esquema; aplíquelo en una migración, como el de las sesiones:

```sql
CREATE TABLE IF NOT EXISTS "meeko_rate_limits" (
  key TEXT PRIMARY KEY NOT NULL,
  window_ends_at INTEGER NOT NULL,
  count INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS "meeko_rate_limits_window_ends_at" ON "meeko_rate_limits" (window_ends_at);
```

La clave es el SHA-256 en base64url (43 caracteres), y cada petición limitada es un único `INSERT … ON CONFLICT(key) DO UPDATE … RETURNING`. Con `rateLimitTable`, `deleteExpired()` borra también los contadores cuya ventana terminó y devuelve el total de filas borradas.

#### Redis mediante la API REST de Upstash

Workers no abre conexiones TCP de Redis con el cliente `redis`. `RedisSessionStore` sólo necesita `get`, `set` con `PX`, `del` y `eval`, de modo que un adaptador sobre la API REST de Upstash basta. Guarde la URL y el token como secretos del Worker:

```ts
import { RedisSessionStore } from '@meekojs/meeko/server'
import type { RedisSessionClient } from '@meekojs/meeko/server'

/** Cliente mínimo de la API REST de Upstash para RedisSessionStore. */
function upstashClient(url: string, token: string): RedisSessionClient {
	const command = async (...args: Array<string | number>): Promise<unknown> => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(args),
		})
		const body = (await response.json()) as { result?: unknown; error?: string }
		if (!response.ok || body.error) throw new Error(`Upstash ${String(args[0])} failed: ${body.error ?? response.status}`)
		return body.result
	}
	return {
		get: async (key) => (await command('GET', key)) as string | null,
		set: (key, value, { PX }) => command('SET', key, value, 'PX', PX),
		del: (key) => command('DEL', key),
		eval: (script, { keys, arguments: args }) => command('EVAL', script, keys.length, ...keys, ...args),
	}
}

// En la fábrica de server/runtime.ts:
const store = new RedisSessionStore(upstashClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN), { prefix: 'mi-app:prod:' })
```

La API REST no mantiene una suscripción, así que no pase `subscriber`: las revocaciones se detectan al releer la sesión, como con D1.

Workers KV no sirve como store de sesiones: no ofrece operaciones atómicas de comparación ni de borrado por familia y su consistencia es eventual, por lo que no puede garantizar `replace` ni `revokeFamily`. `SessionManager({ production: true })` rechaza los stores que no implementan ambas operaciones.

#### Socket y Durable Objects

El Worker comprueba la ruta, el Origin y la autorización del canal antes del upgrade, con las mismas respuestas que el resto de adaptadores: `400`, `403` `INVALID_ORIGIN` y `404` por HTTP, y los rechazos de sesión o autorización con el cierre `4401` o `4403` (véase [WebSocket](framework-websocket.md#websocket)), que el propio Worker hace con un `WebSocketPair` sin despertar el Durable Object de la sala. Si los acepta, reenvía la conexión al Durable Object de su sala: `env.MEEKO_SOCKET.idFromName(canal + "\0" + sala)`. Cada par canal/sala es un objeto, que:

- acepta el WebSocket con la API de hibernación (`ctx.acceptWebSocket`), de modo que las conexiones inactivas no mantienen el objeto en memoria;
- guarda con `serializeAttachment` el canal, la sala, la URL, la cookie de sesión (sólo la cookie con el nombre de `SessionManager`, no el resto de la cabecera `Cookie`) y las cabeceras `origin` y `authorization`. Al despertar reconstruye cada conexión desde ese estado y el hub vuelve a autorizar. Los canales ven esas mismas cabeceras antes y después de hibernar. `keepHeaders` añade otras (en minúsculas; `"cookie"` conserva la cabecera completa). Cloudflare limita ese attachment a 16.384 bytes serializados: Meeko estima el tamaño antes de aceptar el WebSocket y, si no cabe, responde `431` y notifica el error a `onError` en lugar de abrir una conexión que se cerraría con `1011`;
- responde `pong` a un mensaje de texto `ping` sin despertar (configurable con `autoResponse`, o `false` para desactivarlo). Los pings de protocolo los responde siempre el runtime;
- cierra con `1009` los mensajes mayores que `maxMessageBytes` (por defecto, el límite de Socket de la aplicación o 64 KiB) y con `1003` los binarios.

`DurableObjectSocketPubSub(env.MEEKO_SOCKET)` es el broker por defecto en Workers: `publish` entrega el mensaje a la sala mediante RPC al Durable Object (o directamente si ya se ejecuta en él) y se resuelve cuando la sala lo acepta; la sala reparte el mensaje a sus peers en orden de publicación. Las suscripciones sólo existen dentro del Durable Object de la sala; por eso todo upgrade debe pasar por `createWorker`. Un broadcast desde una API o desde otra sala funciona igual. `runtime.socket.pubsub` sólo puede omitirse o ser un `DurableObjectSocketPubSub`: `LocalSocketPubSub`, `RedisSocketPubSub` u otro broker entregarían sólo a los suscriptores de un aislado, así que el Worker y la sala rechazan la aplicación al crearla con «Socket channels on Cloudflare Workers require DurableObjectSocketPubSub…».

Entrega en la sala:

- Cada publicación se entrega a los peers ya suscritos. Una conexión recién aceptada que todavía se está autorizando no retrasa a las demás; recibe las publicaciones posteriores a su autorización, como en el resto de adaptadores.
- Al despertar de la hibernación, la sala reconstruye las conexiones abiertas y las publicaciones esperan a que se vuelvan a autorizar, como máximo `rebuildTimeoutMs` (5000 ms por defecto) desde el inicio de cada reconstrucción; una conexión que no termina a tiempo recibe sólo las publicaciones siguientes.
- Una sala acepta como máximo `maxPendingPublications` publicaciones sin entregar (1024 por defecto). Por encima, `publish` (y por tanto `broadcast`) rechaza con `SOCKET_BACKLOG_EXCEEDED` (503) y el mensaje no se entrega.
- El nombre de la sala sale de `ctx.id.name`; cuando el runtime no lo da (nombres de más de 1.024 bytes), la sala lo toma de su primera conexión o publicación, y las publicaciones hacia ella misma siguen sin RPC.
- Los WebSockets de Workers no informan de `bufferedAmount`, así que `socket.maxBufferBytes` no se aplica en las salas; `maxMessageBytes` y `maxPendingDeliveries` siguen limitando cada peer.
- Si la aplicación no puede crearse al despertar, la sala notifica el error y cierra con `1011` el WebSocket que la despertó.

Rendimiento: un Durable Object ejecuta su código en un solo hilo, así que todos los mensajes y broadcasts de una sala se procesan en serie en un único lugar. Esto da orden y coherencia, pero limita el caudal de una sala muy concurrida; reparta el tráfico en varias salas (por ejemplo, por documento o por grupo) en lugar de una sala global. Consulte los límites vigentes de Durable Objects en la documentación de Cloudflare.

Para un Worker propio, `@meekojs/meeko/cloudflare` exporta las piezas que usa el build:

- `createWorker(app, { socketBinding?, publicOrigin?, onError? })` devuelve el handler `{ fetch }` del módulo. `app` es un `ServerApp` o una fábrica `({ env, platform }) => ServerApp | Promise<ServerApp>` que se ejecuta una vez por aislado; si falla, el siguiente evento la reintenta.
- `createSocketRoomClass(app, DurableObject, { maxMessageBytes?, autoResponse?, keepHeaders?, maxPendingPublications?, rebuildTimeoutMs?, onError? })` crea la clase de salas. `DurableObject` se importa de `cloudflare:workers` y se pasa como argumento para que el módulo se pueda cargar fuera de Workers. El Worker que genera `meeko build` usa los valores por defecto de estas opciones; para cambiar `keepHeaders`, `maxPendingPublications` o `rebuildTimeoutMs` hace falta un Worker propio.
- `DurableObjectSocketPubSub`, `socketRoomName(canal, sala)`, `D1SessionDriver`, `createCloudflareAssetReader({ binding, assets })` y `createCloudflarePrerenderSource({ binding, directory? })`.
- `ServerAppOptions.defaultSocketPubSub` fija el broker cuando `server/runtime.ts` no declara `socket.pubsub`, y `openSocketSession` de `@meekojs/meeko/server` conecta un peer ya aceptado al hub.

### Conformidad entre adaptadores

`packages/meeko/tests/conformance/` construye la misma aplicación de prueba (`tests/fixtures/conformance-app/`) con cada adaptador. Antes de arrancar la salida en su runtime real, retira las fuentes; para Bun, Deno y workerd retira también `node_modules`. La variante `workerd` construye con el adaptador `cloudflare` y ejecuta la salida con el mismo runtime local que `wrangler dev` (workerd tras el proxy de Wrangler, mediante `createTestHarness`), con D1 y Durable Objects en memoria. Las mismas aserciones cubren:

- SSR con loader y plataforma, API, RPC, CSRF y Origin, también el `Origin` por defecto de las mutaciones anónimas (desde `1.8`) y `origin: "none"`;
- `404`, `405` con `Allow`, y `HEAD`, incluida la `404` de una página sin ruta con `app/error.meeko` dentro de los layouts;
- assets con `ETag`/`304` y política de caché, e intentos de traversal (`..`, `%2e%2e`, `%2f`, `%5c`) y de leer archivos del build;
- páginas prerenderizadas con la meta CSRF de la sesión;
- orden del middleware;
- Socket: ruta, Origin, autenticación, límites de tamaño, validación y binario, orden de mensajes de un peer y broadcast entre dos conexiones de una sala;
- fallos del proceso: un rechazo sin manejar llega al `onError` del runtime y la salida sigue atendiendo, y una excepción no capturada llega a `onError` y la salida termina con código 1 (salvo en workerd).

La variante `workerd` añade sesiones en D1 (también leídas desde el Durable Object de un canal privado), la hibernación forzada de una sala (`evictDurableObject` con `webSockets: "hibernate"`) seguida de mensajes en ambos sentidos, el auto-response `ping`/`pong` y un broadcast desde la API, la publicación de una sala a otra por RPC sin fugas a terceras salas, una conexión con una cabecera `Cookie` mayor que el límite del attachment, una sala cuyo nombre supera 1.024 bytes y que la salida sea un único módulo `worker.js`. La prueba de streaming pide `accept-encoding: identity`: el runtime local de Wrangler (Miniflare) emula la compresión de Cloudflare para `text/html` sin respetar `no-transform`, y su codificador gzip sólo escribe al cerrar el cuerpo, de modo que con `wrangler dev` o `meeko preview --adapter cloudflare` un navegador que acepta gzip recibe las páginas `"stream"` completas al final. Es una limitación del entorno local: en producción, la compresión de Cloudflare respeta `no-transform`.

```sh
pnpm run conformance          # node, bun, deno y workerd
pnpm run conformance:bun      # o :node / :deno / :workerd
```

Node se ejecuta siempre. Bun y Deno se buscan en `MEEKO_BUN`/`MEEKO_DENO`, después en el `PATH` y por último en una versión instalada con `mise` (`mise where bun`). Si no se encuentran, la suite se omite con un mensaje explícito. workerd llega con la devDependency `wrangler`; sin ella, su suite también se omite. `MEEKO_CONFORMANCE_REQUIRE=bun,deno,workerd` convierte esa omisión en un fallo; la CI lo usa en sus jobs de Bun, Deno y workerd.

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1` instala un tarball local en un proyecto independiente, genera tipos, construye producción, retira las fuentes de la aplicación, arranca el build Node y prueba HTTP, assets, páginas prerenderizadas con CSRF, dos sesiones, RPC/CSRF, WebSocket real y Chrome. También crea `meeko init-framework` desde ese paquete e instala, comprueba tipos y construye el starter generado. El fixture contiene páginas `/`, `/users`, `/users/[id]`, `/dashboard`, `/chat` y `/layer-demo`; sus aserciones TypeScript comprueban entradas y salidas válidas e inválidas de API, RPC, Socket, rutas y `ComponentProps` importado desde una página `.meeko` del paquete instalado.

Antes de preparar una publicación, ejecute `pnpm install --frozen-lockfile`, `pnpm run verify`, `pnpm run e2e`, `pnpm run pilot:e2e`, `pnpm run package:smoke`, `pnpm run conformance` (con Bun y Deno instalados; workerd llega con `pnpm install`), la prueba Redis anterior, `pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1`, `pnpm pack` (en `packages/meeko`) y `git diff --check`. La CI ejecuta estas familias de comprobaciones, incluida la conformidad Node, en Windows; Redis y la conformidad de Bun, Deno y workerd se ejecutan en Ubuntu. La existencia del workflow no sustituye una ejecución verde de CI. El workflow de publicación repite los gates y sólo responde a una etiqueta de versión; la decisión de crearla corresponde al mantenedor.

### Resolución de problemas de pnpm y Redis

Si pnpm 12 muestra `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, compruebe el usuario efectivo y el ACL del archivo. En un sandbox Windows restringido, `codexsandboxonline` puede carecer de escritura sobre `all-stores.lock`; `--store-dir` y `LOCALAPPDATA` por sí solos no cambian esa ubicación. No elimine el almacén ni cambie ACL globales para superar este caso. En una terminal Windows normal con acceso al perfil, `pnpm install --frozen-lockfile` funciona sin ese ajuste.

Una instalación congelada con pnpm 12.14.0 pasó en una copia limpia al aislar el perfil sólo dentro del proceso PowerShell que lanzó pnpm, con el comando exacto `pnpm install --frozen-lockfile`, sin enlaces de dependencias:

```powershell
$isolatedProfile = Join-Path (Get-Location).Path '.meeko/pnpm-profile'
$env:USERPROFILE = $isolatedProfile
$env:LOCALAPPDATA = Join-Path $isolatedProfile 'AppData/Local'
$env:APPDATA = Join-Path $isolatedProfile 'AppData/Roaming'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:APPDATA -Force | Out-Null
pnpm install --frozen-lockfile
```

Ejecute el bloque sólo en un proceso PowerShell nuevo y restringido para que las variables recuperen sus valores al salir. Una versión anterior del sandbox también produjo `uv_os_get_passwd returned ENOMEM` en `node:os.userInfo()` antes de cargar `tsx`; ese error corresponde al entorno. La verificación en Windows normal no requiere preload ni cambios en Meeko.

La prueba Redis requiere que `MEEKO_REDIS_URL` apunte a un servidor de pruebas accesible. Un error de conexión o `WRONGTYPE` debe fallar; el adaptador no concede acceso a una sesión cuando Redis no está disponible. Use un prefijo distinto por proyecto y entorno; no ejecute `FLUSHALL` ni `FLUSHDB` en un Redis compartido.

`pnpm run pilot:e2e` registra cada motor y entorno y limita sus lanzamientos. Chromium, Firefox y WebKit pasaron en desarrollo y producción en Windows normal sin cambiar las protecciones del navegador. Un sandbox restringido puede impedir que Firefox cree una página; diagnostique ese entorno con `DEBUG=pw:browser*` antes de atribuir el fallo al framework.

## Rendimiento y baseline

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1 -Benchmark` reproduce el consumidor externo, construye la aplicación mínima y escribe `packages/meeko/.meeko/benchmarks/stability-baseline.json`. El baseline conservado está en `packages/meeko/benchmarks/baseline-2026-10-24.json`. Cada tiempo usa siete muestras y dos calentamientos; el JSON contiene mediana, percentiles 10/90 y extremos. La compilación fría usa un worker nuevo por muestra; HMR mide una edición visible en Chrome con un servidor Vite nuevo por muestra. SSR y dispatchers se miden en proceso con `app.fetch` sobre el build Node de producción, incluido el middleware de servidor; SSR usa `/?benchmark=ssr` para no medir la copia prerenderizada de `/`. Las mediciones de tamaño incluyen JS y CSS comprimidos con gzip. Son medidas de esta máquina, no umbrales de CI.

La entrada cliente generada registra `meeko-hydration` en el navegador. El benchmark actual mide navegación desde el clic de un enlace hasta que aparece la nueva ruta; el baseline histórico medía una llamada directa a `mountClientApp.navigate`. Por ese cambio de método, no compare las cifras de navegación entre ambas ejecuciones como si fueran una regresión del runtime. El JSON histórico permanece intacto.

| Métrica                  |        Mediana o tamaño |        p10–p90 |
| ------------------------ | ----------------------: | -------------: |
| Compilación fría         |                 9.40 ms |   9.08–9.45 ms |
| Compilación tras edición |                 0.87 ms |   0.53–1.14 ms |
| HMR visible              |                28.63 ms | 27.19–29.11 ms |
| SSR por petición         |                0.040 ms | 0.032–0.060 ms |
| Hidratación              |                11.10 ms | 10.70–11.20 ms |
| Navegación cliente       |                 1.90 ms |   1.80–2.10 ms |
| Dispatcher API           |                0.019 ms | 0.017–0.019 ms |
| Dispatcher RPC           |                0.049 ms | 0.044–0.054 ms |
| Bundle motor             |  19,134 B; gzip 7,222 B |              — |
| Bundle mínimo            |  21,314 B; gzip 6,438 B |              — |
| Bundle full-stack        | 36,063 B; gzip 14,897 B |              — |

Tras 500 renders SSR, el heap pasó de 87,276,056 a 87,012,304 bytes después de GC; RSS máximo observado: 224,952,320 bytes. Esta muestra no prueba ausencia de fugas y debe compararse sólo bajo condiciones equivalentes.
