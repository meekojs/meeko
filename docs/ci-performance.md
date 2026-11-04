# Tiempos de CI y publicación

La verificación se reparte entre tipos/lint, pruebas y consumidores, tres shards del núcleo y tres shards de navegador de UI. El check `test` espera todos los grupos y falla si alguno falla o se cancela. Cada shard tiene un runner propio; dentro de él los archivos siguen ejecutándose en serie para evitar conflictos entre fixtures.

`MEEKO_TEST_SHARD=1/3` selecciona un tercio de los archivos del núcleo mediante `--test-shard` de Node. Sin esa variable, `pnpm test` ejecuta la suite completa. Todos los grupos de `verify` ejecutan también sus comprobaciones de ejemplos, tipos y DevTools.

CI se ejecuta en los pull requests y en los pushes a `main`. Un nuevo commit cancela la verificación anterior del mismo PR o rama. Las etiquetas ejecutan sus workflows de publicación; no disparan otra copia de CI. Las publicaciones nunca se cancelan automáticamente y npm sigue esperando sus gates de runtimes, Redis, VS Code, tarballs y todos los shards de `verify`.

## Cachés

- **Dependencias pnpm:** `actions/setup-node`, con `pnpm-lock.yaml` como clave; la instalación siempre usa `--frozen-lockfile`.
- **Build del workspace:** `.github/actions/build-workspace` utiliza `actions/cache/restore` y `save`. La clave incluye el árbol Git completo, la versión exacta de Node, sistema y arquitectura. No hay coincidencias parciales. Se guardan `dist` y declaraciones generadas inmediatamente después de compilar, antes de que las pruebas puedan modificarlos. Main y una etiqueta con el mismo árbol pueden reutilizar ese build, sujeto al alcance de cachés de GitHub.
- **ESLint:** caché de resultados con comparación por contenido; el cambio de lockfile o configuración invalida su familia de claves.
- **Descargas npm:** `.github/actions/cache-npm` exporta `NPM_CONFIG_CACHE` a un directorio propio de `RUNNER_TEMP` y conserva únicamente su `_cacache`, usado por el empaquetado aislado de VSIX. Así los comandos ejecutados desde carpetas temporales usan la misma ruta que restaura y guarda la acción. No guarda `.npmrc`, tokens ni `node_modules`.

Los resultados de las pruebas, las comprobaciones de consumidores y los bundles de aplicaciones no se reutilizan desde caché. La caché de compilación prepara los paquetes que consumen las fases `:prepared`; los comandos autónomos y los hooks `prepack` conservan sus builds. Los navegadores se instalan con Playwright, cuya documentación desaconseja su caché por el coste de restaurarla.

Los seis VSIX comparten una comprobación de tipos y un build por job. Cada variante conserva su instalación aislada de dependencias, la comprobación del binario nativo y sus permisos. `-SkipBuild` se usa únicamente tras ese build común; la invocación normal del script sigue comprobando y compilando.

## Preparación y builds compartidos

Después de `actions/checkout`, los jobs que usan el workspace invocan `.github/actions/setup-workspace`. Esta acción configura Node y pnpm, instala con lockfile congelado y activa la caché de dependencias. `build: 'true'` añade el build con caché exacta y `npm-cache: 'true'` añade las descargas npm de los VSIX. La publicación npm con OIDC conserva su preparación mínima, sin ejecutar esta acción.

Los comandos terminados en `:prepared` son fases internas que requieren el build previo. `pnpm verify` prepara el workspace y después ejecuta `verify:prepared`; CI utiliza directamente la fase preparada tras `setup-workspace` con `build: 'true'`. Esto evita reconstruir el núcleo cuando la caché ya restauró un build válido. Los comandos autónomos conservan la preparación necesaria para ejecutarlos desde un clon limpio.

`site:build`, `ui:build`, `i18n:build` y `tooling:build` seleccionan el paquete destino y sus dependencias con los filtros `...` de pnpm. Los atajos de sitios excluyen `meeko-docs` del recorrido porque cada app ya lo construye en su propio script `build`. Los filtros de los scripts no llevan comillas simples: en Windows se pasarían como parte del nombre del paquete. Los hooks `prepack` siguen construyendo antes de empaquetar.

## Medición

Después de integrar, comparar una ejecución inicial y otra con caché del mismo árbol. Revisar los hits de `Build workspace with exact cache`, los tiempos de cada shard, las colas de runners y la duración total. El paralelismo reduce la espera y puede aumentar los minutos facturados. El reparto de Node es por archivos, por lo que un archivo especialmente lento puede dominar un shard.

Referencia previa: el job `test` del run `41764885365` tardó 80,4 minutos, incluyendo 25,2 de `verify`, 24 de UI E2E y 10 de tipos. Estas cifras describen el flujo anterior; el nuevo tiempo debe medirse en GitHub Actions. El plazo de verificación y visibilidad de Microsoft Marketplace permanece fuera del control de las cachés locales.

Fuentes: [cachés de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching), [sharding de Node](https://nodejs.org/docs/latest-v24.x/api/cli.html#--test-shard), [Playwright en CI](https://playwright.dev/docs/ci#caching-browsers).
