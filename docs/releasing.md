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
