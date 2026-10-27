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
pnpm run build                       # .meeko/output/node, todo prerenderizado, con Pagefind
pnpm run preview                     # build y meeko start
pnpm run build:static                # dist-static/, para un hosting estático
```

- `pnpm run build` ejecuta `meeko build` y `scripts/postbuild.mjs`, que indexa las páginas con
  Pagefind, genera `sitemap.xml` y `robots.txt` y añade a cada documento `lang`, favicon, URL canónica
  y Open Graph. `meeko start` sólo sirve los archivos del manifiesto del build, así que si cambian esos
  archivos públicos el script vuelve a ejecutar `meeko build` una vez.
- `pnpm run build:static` copia el prerender y el cliente a `dist-static/` y genera `404.html`.
  `deploy/nginx.conf` sirve esa carpeta con la navegación cliente completa; sin la negociación de
  `Accept` que configura, cada navegación carga el documento entero.
- La búsqueda usa el índice de Pagefind del build: en `meeko dev` no existe.
- Desde la raíz, `pnpm run site:build` y `pnpm run site:build:static` compilan primero el paquete y
  después el sitio. Un despliegue desde el repositorio ejecuta `pnpm install --frozen-lockfile` y
  `pnpm run site:build:static` en la raíz y publica `apps/site/dist-static/`.
