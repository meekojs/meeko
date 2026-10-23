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

Para `0.0.2`, la publicación manual sigue siendo `npm publish --access public` desde el commit verificado. npm pide autenticación de dos factores: no guardes códigos ni tokens en el repositorio. Comprueba después la versión y el acceso público en el registro; crea y sube `v0.0.2` sólo cuando la publicación esté confirmada.

## Publicación confiable para versiones posteriores

El workflow [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) ejecuta las verificaciones, comprueba que `v<versión>` coincida con `package.json` y publica desde un runner de GitHub mediante OIDC. Antes de usarlo, un administrador del paquete debe registrar en npm un **Trusted Publisher** con organización `meekojs`, repositorio `meeko`, workflow `publish.yml` y permiso **Allow npm publish**. Esa configuración requiere autenticación del administrador; el archivo del workflow por sí solo no concede acceso. No añadas un token de publicación a GitHub.

Después de configurar y verificar esa relación, crea `v<versión>` sobre el commit aprobado y súbela. La etiqueta activa el workflow; comprueba que éste terminó correctamente y que la versión pública de npm corresponde a la etiqueta antes de crear la versión de GitHub. npm genera procedencia automáticamente cuando publica desde este flujo confiable. Si falla la publicación, conserva la etiqueta y corrige el flujo; no reutilices la misma versión después de una publicación exitosa.

La extensión de VS Code se empaqueta por separado. Su VSIX local no implica publicación en Marketplace. Las extensiones de VS Code y Chrome tienen su propio número de versión y requieren pruebas en sus anfitriones antes de publicarse en sus respectivas tiendas. Los artefactos locales pueden adjuntarse a una versión de GitHub indicando qué plataformas se probaron realmente.

## Versión 0.0.1

La primera versión pública salió del commit `b6324b0` y está disponible en [npm](https://www.npmjs.com/package/@meekojs/meeko/v/0.0.1). La [verificación de GitHub Actions](https://github.com/meekojs/meeko/actions/runs/39952217750) pasó las comprobaciones, las pruebas de navegador y la instalación del paquete en una aplicación externa. Después de publicar, se instaló `@meekojs/meeko@0.0.1` desde el registro y se comprobaron su reactividad y la CLI con un componente `.meeko`.
