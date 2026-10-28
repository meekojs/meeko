# Sitio de documentación de Meeko

El sitio público de Meeko (`https://meeko.diegootayza.com`), hecho con Meeko. Sus páginas salen de los
Markdown del repositorio (`packages/meeko/README.md`, `packages/meeko/CHANGELOG.md` y `docs/*.md`,
salvo `docs/releasing.md`): no copie aquí su contenido. `server/content/repository.ts` resuelve las
rutas del paquete (`README.md`, `CHANGELOG.md`, `package.json`, `examples/…`) bajo `packages/meeko/`.
Depende del Meeko de este repositorio con `workspace:*`, así que usa su `dist/`.

```powershell
pnpm install                         # en la raíz del repositorio: instala todo el workspace
pnpm run build                       # en la raíz: compila packages/meeko/dist/
cd apps/site
pnpm run dev                         # http://127.0.0.1:4173
pnpm run check                       # meeko check
pnpm run build                       # sitio estático en .meeko/output/static y dist-static/
pnpm run preview                     # build y meeko preview (sirve la salida como un hosting estático)
pnpm run build:static                # lo mismo que build; lo usan la raíz y el despliegue
```

- `meeko.config.ts` usa el adaptador `static` de Meeko: todas las páginas se prerenderizan y
  `meeko build` escribe el sitio completo en `.meeko/output/static/`, con `<ruta>/index.html` y
  `<ruta>/index.meeko.json` (el payload que lee la navegación cliente) por página, `404.html` de
  `app/error.meeko`, `sitemap.xml` y `robots.txt` (`site`, `sitemap` y `robots`), la URL canónica y
  Open Graph de cada página (`document.seo`) y `_meeko/headers.conf` (`server.headerFiles`).
- `_meeko/headers.conf` lleva la Content-Security-Policy de `server.contentSecurityPolicy` y las
  demás cabeceras de seguridad de `server.headers` (`X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`). El build permite cada `<script>` inline de las páginas (como el del tema de
  `meeko.config.ts`) por su hash SHA-256, calculado en cada build, así que cambiar un script no exige
  tocar la política; un atributo `on*` o una URL `javascript:` hacen fallar el build.
  `deploy/nginx.conf` incluye ese archivo desde la raíz web en cada `location` y responde 404 a
  `/_meeko/`.
- `scripts/` sólo tiene lo propio del sitio: `assets.mjs` deriva las imágenes de `public/brand/` del
  logo del repositorio, y `postbuild.mjs` indexa las páginas con Pagefind en `pagefind/` de la salida
  y la copia a `dist-static/`, la carpeta que sirve `deploy/nginx.conf`.
- La búsqueda usa el índice de Pagefind del build: en `meeko dev` no existe.
- Una copia de trabajo anterior puede conservar `public/sitemap.xml`, `public/robots.txt` y
  `public/pagefind/`, que generaba el `postbuild.mjs` anterior: bórrelos. Los dos primeros chocan con
  los que genera Meeko y el build lo indica.
- La referencia de la API (`/docs/reference` y `/docs/reference/<símbolo>`) se genera en el build:
  `server/content/api.ts` lee con TypeScript cada export de las subrutas públicas de
  `packages/meeko/package.json` y su JSDoc, así que un export nuevo tiene su página sin tocar el
  sitio. La sintaxis de `.meeko` que no es un export (bloques, macros, etiquetas y directivas) está
  en `server/content/api-builtins.ts`, completada con la documentación del servidor de lenguaje.
- Desde la raíz, `pnpm run site:build` y `pnpm run site:build:static` compilan primero el paquete y
  después el sitio. Un despliegue desde el repositorio ejecuta `pnpm install --frozen-lockfile` y
  `pnpm run site:build:static` en la raíz y publica `apps/site/dist-static/`.
