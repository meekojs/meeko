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

El workflow [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) ejecuta las verificaciones, comprueba que `v<versión>` coincida con `package.json` y publica desde un runner de GitHub mediante OIDC. El **Trusted Publisher** para `meekojs/meeko` y `publish.yml` se registró en npm con permiso de publicación. Su primera ejecución publicó `0.0.3` con procedencia firmada. No añadas un token de publicación a GitHub.

Antes de cada versión, comprueba `npm trust list @meekojs/meeko`. Crea `v<versión>` sobre el commit aprobado y súbela. La etiqueta activa el workflow; comprueba que éste terminó correctamente y que la versión pública de npm corresponde a la etiqueta. npm genera procedencia automáticamente cuando publica desde este flujo confiable. Si falla la publicación, conserva la etiqueta y corrige el flujo; no reutilices la misma versión después de una publicación exitosa.

Nada se publica por un push a `main` ni por un pull request: npm, la release de GitHub y las tiendas sólo reciben una versión cuando el mantenedor sube la etiqueta correspondiente.

## Etiquetas y destinos

| Etiqueta | Workflow | Comprueba | Publica |
| --- | --- | --- | --- |
| `v<versión>` | `publish.yml` | `package.json` | npm (`@meekojs/meeko`) y la release de GitHub con los seis VSIX y el ZIP de Chrome |
| `vscode-v<versión>` | `publish-vscode.yml` | `editors/vscode/package.json` | Visual Studio Marketplace y Open VSX |
| `devtools-v<versión>` | `publish-devtools.yml` | `tools/devtools-extension/manifest.json` | Chrome Web Store |

Cada workflow falla antes de publicar si la etiqueta no coincide exactamente con la versión de su archivo. Las extensiones conservan así un número de versión independiente del paquete npm: una corrección de la extensión no obliga a publicar Meeko, y una versión de Meeko no sube las extensiones a las tiendas.

### Paquete npm y prereleases

`publish.yml` publica una versión con guion, como `1.0.0-rc.1`, con `npm publish --tag next`; `latest` no se mueve. Una versión sin guion se publica en `latest`. Tras una prerelease, comprueba con `npm view @meekojs/meeko dist-tags` que `latest` sigue en la última versión estable.

### Release de GitHub

Cuando npm termina, el job `github-release` de `publish.yml` empaqueta en Windows los VSIX de `win32`, `linux` y `darwin` en x64 y arm64 y el ZIP de Chrome DevTools (con la carpeta `meeko-devtools/`), calcula `SHA256SUMS.txt` y los adjunta a la release de la etiqueta. Si la versión es prerelease, la release se crea como prerelease; si no, se marca como la más reciente. Si la release ya existía, por ejemplo creada a mano o por un intento anterior, sólo se reemplazan los adjuntos. Es el único job con `contents: write`; `id-token: write` queda limitado al job que ejecuta `npm publish`.

Los VSIX y el ZIP adjuntos corresponden a la versión propia de cada extensión en ese commit. Su presencia en la release no implica que esa versión esté en Marketplace, Open VSX o Chrome Web Store.

## Publicación en las tiendas de extensiones

Los workflows de tiendas están configurados pero inactivos: cada paso de publicación comprueba si existe su secreto y, si falta, se omite con un aviso en el resumen de la ejecución en lugar de fallar. Las pruebas previas se ejecutan siempre.

Los secretos se guardan en **Settings → Secrets and variables → Actions → Repository secrets** del repositorio `meekojs/meeko`, con los nombres exactos de las tablas siguientes. No se guardan en el repositorio, en `.env` versionados ni en la documentación.

### VS Code: Marketplace y Open VSX

`publish-vscode.yml` comprueba que `vscode-v<versión>` coincide con `editors/vscode/package.json` y que la versión es `major.minor.patch`; ninguna de las dos tiendas acepta sufijos de prerelease en la versión de la extensión. Después ejecuta en Windows, Ubuntu y macOS las pruebas unitarias de la extensión, el VSIX de la plataforma y la prueba en un host aislado de VS Code. Sólo si todo pasa, empaqueta los seis VSIX y los publica con `@vscode/vsce@4.0.0` y `ovsx@1.3.0`, ambas versiones fijadas. Las dos herramientas leen el token de la variable de entorno; nunca aparece en la línea de órdenes. `--skip-duplicate` permite repetir la ejecución si una tienda falló después de que la otra publicara.

| Secreto | Uso |
| --- | --- |
| `VSCE_PAT` | Token de Azure DevOps para Visual Studio Marketplace. |
| `OVSX_PAT` | Token de acceso de Open VSX. |

Alta en Visual Studio Marketplace:

1. Con la cuenta Microsoft del proyecto, crea una organización en [Azure DevOps](https://dev.azure.com/).
2. En **User settings → Personal access tokens**, crea un token con **Organization: All accessible organizations** y el ámbito **Marketplace → Manage**. Anota su caducidad; al renovarlo hay que actualizar el secreto.
3. En la [página de gestión del Marketplace](https://marketplace.visualstudio.com/manage), crea el publisher con ID `meekojs`, el mismo valor de `publisher` en `editors/vscode/package.json`.
4. Opcionalmente, comprueba el token en local con `pnpm dlx @vscode/vsce@4.0.0 verify-pat meekojs` y guárdalo como `VSCE_PAT`.

Alta en Open VSX:

1. Inicia sesión en [open-vsx.org](https://open-vsx.org/) con la cuenta de GitHub del proyecto y acepta el acuerdo de publicación de Eclipse Foundation desde el perfil.
2. En **Settings → Access Tokens**, genera un token.
3. Crea el namespace `meekojs` una vez: `pnpm dlx ovsx@1.3.0 create-namespace meekojs` con `OVSX_PAT` en el entorno. Para que la extensión aparezca como verificada, solicita la propiedad del namespace siguiendo las instrucciones de Open VSX.
4. Guarda el token como `OVSX_PAT`.

### Chrome Web Store

`publish-devtools.yml` comprueba que `devtools-v<versión>` coincide con `tools/devtools-extension/manifest.json`. En Windows ejecuta `pnpm run devtools:check` y la prueba de la extensión instalada en Chrome for Testing. Después empaqueta un ZIP con `manifest.json` en la raíz, como exige la tienda (`package-zip.ps1 -RootLayout`), lo sube y lo envía a revisión mediante la [API v2 de Chrome Web Store](https://developer.chrome.com/docs/webstore/using-api). La versión 1.1 de la API está obsoleta; la v2 identifica cada elemento por publisher, por lo que hace falta `CHROME_PUBLISHER_ID`. La publicación sólo ocurre si existen los cinco secretos; con una configuración incompleta el job avisa qué nombres faltan y no publica.

| Secreto | Uso |
| --- | --- |
| `CHROME_EXTENSION_ID` | ID del elemento Meeko DevTools en la tienda. |
| `CHROME_PUBLISHER_ID` | ID del publisher, visible en **Publisher → Settings** del panel de desarrollador. |
| `CHROME_CLIENT_ID` | ID del cliente OAuth de Google Cloud. |
| `CHROME_CLIENT_SECRET` | Secreto de ese cliente OAuth. |
| `CHROME_REFRESH_TOKEN` | Refresh token de la cuenta propietaria con el ámbito `https://www.googleapis.com/auth/chromewebstore`. |

Alta:

1. Registra la cuenta de desarrollador en el [panel de Chrome Web Store](https://chrome.google.com/webstore/devconsole) y paga la cuota única de registro.
2. La API sólo actualiza elementos existentes: la primera versión se sube a mano desde el panel con el ZIP de `package-zip.ps1 -RootLayout`, completando la ficha, la política de privacidad y las justificaciones de permisos. El ID que asigna la tienda es `CHROME_EXTENSION_ID`.
3. En [Google Cloud Console](https://console.cloud.google.com/), crea un proyecto y habilita **Chrome Web Store API**.
4. Configura la pantalla de consentimiento OAuth como **External** y publícala en producción. Si queda en modo de prueba, Google caduca el refresh token a los siete días.
5. En **Credentials → Create credentials → OAuth client ID**, crea un cliente **Web application** con `https://developers.google.com/oauthplayground` como URI de redirección autorizada. Obtendrás `CHROME_CLIENT_ID` y `CHROME_CLIENT_SECRET`.
6. En [OAuth Playground](https://developers.google.com/oauthplayground), marca **Use your own OAuth credentials** con ese cliente, autoriza el ámbito `https://www.googleapis.com/auth/chromewebstore` con la cuenta propietaria de la extensión y pulsa **Exchange authorization code for tokens**. El valor `refresh_token` es `CHROME_REFRESH_TOKEN`.
7. Copia el ID de publisher desde **Publisher → Settings** como `CHROME_PUBLISHER_ID`.

La tienda revisa cada envío; el workflow termina cuando la subida se acepta y el envío queda en revisión, no cuando la versión es pública. Si se cambió la visibilidad en el panel, publica una vez a mano antes de volver a usar la API.

### Publicar una versión de una extensión

1. Sube la versión en `editors/vscode/package.json` y su `CHANGELOG.md`, o en `tools/devtools-extension/manifest.json` y `package.json`.
2. Tras comprobar que CI pasó en `main`, crea la etiqueta `vscode-v<versión>` o `devtools-v<versión>` sobre ese commit y súbela.
3. Revisa la ejecución: los pasos omitidos por falta de secretos aparecen como avisos. Comprueba después la versión en cada tienda.

## Versión 0.0.1

La primera versión pública salió del commit `b6324b0` y está disponible en [npm](https://www.npmjs.com/package/@meekojs/meeko/v/0.0.1). La [verificación de GitHub Actions](https://github.com/meekojs/meeko/actions/runs/39952217750) pasó las comprobaciones, las pruebas de navegador y la instalación del paquete en una aplicación externa. Después de publicar, se instaló `@meekojs/meeko@0.0.1` desde el registro y se comprobaron su reactividad y la CLI con un componente `.meeko`.

## Versión 0.0.2

El paquete [npm `0.0.2`](https://www.npmjs.com/package/@meekojs/meeko/v/0.0.2) salió del commit `d587f29` y coincide con la etiqueta [`v0.0.2`](https://github.com/meekojs/meeko/releases/tag/v0.0.2). La [CI de ese commit](https://github.com/meekojs/meeko/actions/runs/39959569174) pasó antes de publicar. La versión de GitHub contiene el ZIP de Chrome DevTools y seis VSIX de VS Code para Windows, Linux y macOS en x64/arm64; son artefactos descargables, aún no versiones de las tiendas. El consumidor instalado desde npm se midió [por separado](benchmarks.md#consumidor-instalado-desde-npm).

## Versión 0.0.3

El paquete [npm `0.0.3`](https://www.npmjs.com/package/@meekojs/meeko/v/0.0.3) salió del commit `2b71e9c` y coincide con la etiqueta [`v0.0.3`](https://github.com/meekojs/meeko/releases/tag/v0.0.3). La [CI de `main`](https://github.com/meekojs/meeko/actions/runs/40059687018) pasó en cuatro trabajos antes de etiquetar. El [workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40059931166) pasó y publicó mediante OIDC con procedencia firmada. Se instaló después desde npm en un proyecto pnpm preexistente, donde `meeko init .`, el chequeo de tipos, la compilación de cliente y servidor y la respuesta SSR de producción funcionaron.

## Versión 0.0.4

El paquete [npm `0.0.4`](https://www.npmjs.com/package/@meekojs/meeko/v/0.0.4) salió del commit `fd99fac` y coincide con la etiqueta `v0.0.4`. La [CI de `main`](https://github.com/meekojs/meeko/actions/runs/40078268533) pasó antes de etiquetar. El [workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40078864386) pasó y publicó mediante OIDC con procedencia firmada. Es la primera versión con el framework full-stack.

## Versión 0.1.0

El paquete [npm `0.1.0`](https://www.npmjs.com/package/@meekojs/meeko/v/0.1.0) salió del commit `b492cf1` y coincide con la etiqueta [`v0.1.0`](https://github.com/meekojs/meeko/releases/tag/v0.1.0). Contiene cambios incompatibles respecto de `0.0.4`, documentados con su migración en el [CHANGELOG](../CHANGELOG.md). La [CI de `main`](https://github.com/meekojs/meeko/actions/runs/40168927109) pasó antes de etiquetar. El [workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40169193614) repitió los gates y publicó mediante OIDC con procedencia SLSA firmada. Se instaló después desde npm en un proyecto vacío, donde la reactividad, las subrutas `framework` y `server` y los comandos `dev`, `check`, `build` y `start` de la CLI respondieron.
