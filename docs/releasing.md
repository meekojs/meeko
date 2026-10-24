# Publicación de Meeko

El repositorio público es `meekojs/meeko` y el paquete npm es `@meekojs/meeko`. La CLI conserva el nombre `meeko`. La primera versión `0.0.1` es experimental: las versiones `0.x` pueden cambiar la API; cada cambio incompatible se documentará antes de publicar una nueva versión.

## Verificación previa

En una copia limpia del commit que se publicará:

```powershell
pnpm install --frozen-lockfile
pnpm run verify
pnpm run e2e
node node_modules/playwright-core/cli.js install chromium firefox webkit
pnpm run pilot:e2e
pnpm run package:smoke
pnpm -C editors/vscode run package:vsix
pnpm -C editors/vscode run test:host:isolated
npm pack --dry-run --json
```

`pilot:e2e` comprueba SSR e hidratación en Chromium, Firefox y WebKit durante desarrollo y desde el build de producción. `package:smoke` instala el tarball en un proyecto temporal fuera del monorepo y comprueba CLI, SSR, declaraciones de TypeScript, Vite y un proyecto generado con `meeko init`. El paquete npm sólo incluye `dist`, `README.md`, `LICENSE` y `package.json`; no incluye ejemplos, pruebas, variantes del logo ni archivos locales. Antes de subir una versión, se revisa el resultado de `npm pack --dry-run --json` para confirmar esa lista.

## Publicar una actualización

Actualiza la versión de `package.json` y [CHANGELOG.md](../CHANGELOG.md), ejecuta las verificaciones y sube el commit a `main`. Tras comprobar que CI pasó y que el commit remoto coincide con el probado localmente, comprueba el tarball. Una versión publicada no se sobrescribe; las correcciones requieren un número nuevo.

`0.0.2` se publicó manualmente con `npm publish --access public` desde el commit verificado, tras completar la autenticación de npm. El registro confirmó la versión y el checksum antes de crear la etiqueta. No guardes códigos ni tokens en el repositorio.

## Publicación confiable para versiones posteriores

El workflow [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) ejecuta las verificaciones, comprueba que `v<versión>` coincida con `package.json` y publica desde un runner de GitHub mediante OIDC. El **Trusted Publisher** para `meekojs/meeko` y `publish.yml` se registró en npm con permiso de publicación. La CLI confirmó el alta y `npm trust list @meekojs/meeko` mostró el vínculo; la primera publicación OIDC sigue pendiente. No añadas un token de publicación a GitHub.

Antes de la siguiente versión, comprueba de nuevo `npm trust list @meekojs/meeko`: npm indica que un vínculo nuevo caduca si no completa su primera publicación en dos días. Crea `v<versión>` sobre el commit aprobado y súbela. La etiqueta activa el workflow; comprueba que éste terminó correctamente y que la versión pública de npm corresponde a la etiqueta antes de crear la versión de GitHub. npm genera procedencia automáticamente cuando publica desde este flujo confiable. Si falla la publicación, conserva la etiqueta y corrige el flujo; no reutilices la misma versión después de una publicación exitosa.

La extensión de VS Code se empaqueta por separado. Su VSIX local no implica publicación en Marketplace. Las extensiones de VS Code y Chrome tienen su propio número de versión y requieren pruebas en sus anfitriones antes de publicarse en sus respectivas tiendas. Los artefactos locales pueden adjuntarse a una versión de GitHub indicando qué plataformas se probaron realmente.

## Versión 0.0.1

La primera versión pública salió del commit `b6324b0` y está disponible en [npm](https://www.npmjs.com/package/@meekojs/meeko/v/0.0.1). La [verificación de GitHub Actions](https://github.com/meekojs/meeko/actions/runs/39952217750) pasó las comprobaciones, las pruebas de navegador y la instalación del paquete en una aplicación externa. Después de publicar, se instaló `@meekojs/meeko@0.0.1` desde el registro y se comprobaron su reactividad y la CLI con un componente `.meeko`.

## Versión 0.0.2

El paquete [npm `0.0.2`](https://www.npmjs.com/package/@meekojs/meeko/v/0.0.2) salió del commit `d587f29` y coincide con la etiqueta [`v0.0.2`](https://github.com/meekojs/meeko/releases/tag/v0.0.2). La [CI de ese commit](https://github.com/meekojs/meeko/actions/runs/39959569174) pasó antes de publicar. La versión de GitHub contiene el ZIP de Chrome DevTools y seis VSIX de VS Code para Windows, Linux y macOS en x64/arm64; son artefactos descargables, aún no versiones de las tiendas. El consumidor instalado desde npm se midió [por separado](benchmarks.md#consumidor-instalado-desde-npm).
