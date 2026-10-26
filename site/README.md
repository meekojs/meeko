# Sitio de documentación de Meeko

El sitio público de Meeko (`https://meeko.diegootayza.com`), hecho con Meeko. Sus páginas salen de los
Markdown del repositorio (`README.md`, `CHANGELOG.md` y `docs/*.md`, salvo `docs/releasing.md`): no
copie aquí su contenido. Depende del Meeko de este repositorio con `link:..`.

```powershell
pnpm install; pnpm run build        # en la raíz del repositorio: compila dist/
cd site
pnpm install
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
