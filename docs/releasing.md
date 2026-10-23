# Publicación de Meeko

El repositorio público es `meekojs/meeko` y el paquete npm es `@meekojs/meeko`. La CLI conserva el nombre `meeko`. La primera versión `0.0.1` es experimental: las versiones `0.x` pueden cambiar la API; cada cambio incompatible se documentará antes de publicar una nueva versión.

## Verificación previa

En una copia limpia del commit que se publicará:

```powershell
pnpm install --frozen-lockfile
pnpm run verify
pnpm run e2e
pnpm run package:smoke
pnpm -C editors/vscode run package:vsix
pnpm -C editors/vscode run test:host:isolated
npm pack --dry-run --json
```

`package:smoke` instala el tarball en un proyecto temporal fuera del monorepo y comprueba CLI, SSR, declaraciones de TypeScript y Vite. El paquete npm sólo incluye `dist`, `README.md`, `LICENSE` y `package.json`; no incluye ejemplos, pruebas, variantes del logo ni archivos locales. Antes de subir una versión, se revisa el resultado de `npm pack --dry-run --json` para confirmar esa lista.

## Primera publicación

El primer push crea `main` en GitHub. Tras comprobar la ejecución de CI y verificar que el commit remoto coincide con el probado localmente, publica la versión con `npm publish --access public`. npm puede pedir autenticación de dos factores; no guardes códigos ni tokens en el repositorio. Comprueba después la versión y el acceso público en el registro. Una versión publicada no se sobrescribe; las correcciones requieren un número nuevo.

La extensión de VS Code se empaqueta por separado. Su VSIX local no implica publicación en Marketplace. Antes de publicarla, prepara artefactos y pruebas para otras plataformas y revisa las condiciones de Marketplace.

## Versión 0.0.1

La primera versión pública salió del commit `b6324b0` y está disponible en [npm](https://www.npmjs.com/package/@meekojs/meeko/v/0.0.1). La [verificación de GitHub Actions](https://github.com/meekojs/meeko/actions/runs/39952217750) pasó las comprobaciones, las pruebas de navegador y la instalación del paquete en una aplicación externa. Después de publicar, se instaló `@meekojs/meeko@0.0.1` desde el registro y se comprobaron su reactividad y la CLI con un componente `.meeko`.
