# Publicación de Meeko

El repositorio público es `meekojs/meeko` y el paquete npm es `@meekojs/meeko`. La CLI conserva el nombre `meeko`. Desde `1.0.0` las versiones siguen la [política de estabilidad](stability.md):

- un patch sólo corrige;
- un minor añade API o depreca con un reemplazo documentado;
- sólo una major rompe compatibilidad o retira lo deprecado.

Cada cambio se anota en el [CHANGELOG](../packages/meeko/CHANGELOG.md) antes de publicar. Las versiones `0.x` anteriores podían cambiar la API en un minor.

## Verificación previa

En una copia limpia del commit que se publicará:

```powershell
pnpm install --frozen-lockfile
pnpm run verify
pnpm run e2e
node packages/meeko/node_modules/playwright-core/cli.js install chromium firefox webkit
pnpm run pilot:e2e
pnpm run package:smoke
pnpm -F meeko-language run package:vsix
pnpm -F meeko-language run test:host:isolated
npm pack ./packages/meeko --dry-run --json
```

Las órdenes `pnpm run …` de la raíz reenvían al paquete `packages/meeko` (`pnpm -F @meekojs/meeko run …`); `verify` además comprueba la extensión de Chrome (`pnpm -F meeko-devtools-extension run check`).

`pilot:e2e` comprueba SSR e hidratación en Chromium, Firefox y WebKit durante desarrollo y desde el build de producción. `package:smoke` instala el tarball en un proyecto temporal fuera del monorepo y comprueba CLI, SSR, declaraciones de TypeScript, Vite y un proyecto generado con `meeko init`. El paquete npm sólo incluye `dist`, `README.md`, `LICENSE` y `package.json`; no incluye ejemplos, pruebas, variantes del logo ni archivos locales. Antes de subir una versión, se revisa el resultado de `npm pack --dry-run --json` para confirmar esa lista.

## Publicar una actualización

Actualiza la versión de `packages/meeko/package.json` y [CHANGELOG.md](../packages/meeko/CHANGELOG.md), ejecuta las verificaciones y sube el commit a `main`. Tras comprobar que CI pasó y que el commit remoto coincide con el probado localmente, comprueba el tarball. Una versión publicada no se sobrescribe; las correcciones requieren un número nuevo.

`0.0.2` se publicó manualmente con `npm publish --access public` desde el commit verificado, tras completar la autenticación de npm. El registro confirmó la versión y el checksum antes de crear la etiqueta. No guardes códigos ni tokens en el repositorio.

## Publicación confiable para versiones posteriores

El workflow [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) ejecuta las verificaciones, comprueba que `v<versión>` coincida con `packages/meeko/package.json` y publica desde un runner de GitHub mediante OIDC, con `npm publish --provenance` dentro de `packages/meeko`. npm asocia el Trusted Publisher al repositorio y al nombre del workflow (`publish.yml`), no a la carpeta del paquete, así que el paso a workspace no lo cambia; `repository.directory` del manifiesto indica la carpeta. El **Trusted Publisher** para `meekojs/meeko` y `publish.yml` se registró en npm con permiso de publicación. Su primera ejecución publicó `0.0.3` con procedencia firmada. No añadas un token de publicación a GitHub.

Antes de cada versión, comprueba `npm trust list @meekojs/meeko`. Crea `v<versión>` sobre el commit aprobado y súbela. La etiqueta activa el workflow; comprueba que éste terminó correctamente y que la versión pública de npm corresponde a la etiqueta. npm genera procedencia automáticamente cuando publica desde este flujo confiable. Si falla la publicación, conserva la etiqueta y corrige el flujo; no reutilices la misma versión después de una publicación exitosa.

Nada se publica por un push a `main` ni por un pull request: npm, la release de GitHub y las tiendas sólo reciben una versión cuando el mantenedor sube la etiqueta correspondiente.

## Etiquetas y destinos

| Etiqueta | Workflow | Comprueba | Publica |
| --- | --- | --- | --- |
| `v<versión>` | `publish.yml` | `packages/meeko/package.json` | npm (`@meekojs/meeko`) y la release de GitHub con los seis VSIX y el ZIP de Chrome |
| `vscode-v<versión>` | `publish-vscode.yml` | `packages/vscode/package.json` | Visual Studio Marketplace y Open VSX |
| `devtools-v<versión>` | `publish-devtools.yml` | `packages/devtools/manifest.json` | Chrome Web Store |

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

`publish-vscode.yml` comprueba que `vscode-v<versión>` coincide con `packages/vscode/package.json` y que la versión es `major.minor.patch`; ninguna de las dos tiendas acepta sufijos de prerelease en la versión de la extensión. Después ejecuta en Windows, Ubuntu y macOS las pruebas unitarias de la extensión, el VSIX de la plataforma y la prueba en un host aislado de VS Code. Sólo si todo pasa, empaqueta los seis VSIX y los publica con `@vscode/vsce@4.0.0` y `ovsx@1.3.0`, ambas versiones fijadas. Las dos herramientas leen el token de la variable de entorno; nunca aparece en la línea de órdenes. `--skip-duplicate` permite repetir la ejecución si una tienda falló después de que la otra publicara.

| Secreto | Uso |
| --- | --- |
| `VSCE_PAT` | Token de Azure DevOps para Visual Studio Marketplace. |
| `OVSX_PAT` | Token de acceso de Open VSX. |

Alta en Visual Studio Marketplace:

1. Con la cuenta Microsoft del proyecto, crea una organización en [Azure DevOps](https://dev.azure.com/).
2. En **User settings → Personal access tokens**, crea un token con **Organization: All accessible organizations** y el ámbito **Marketplace → Manage**. Anota su caducidad; al renovarlo hay que actualizar el secreto.
3. En la [página de gestión del Marketplace](https://marketplace.visualstudio.com/manage), crea el publisher con ID `meekojs`, el mismo valor de `publisher` en `packages/vscode/package.json`.
4. Opcionalmente, comprueba el token en local con `pnpm dlx @vscode/vsce@4.0.0 verify-pat meekojs` y guárdalo como `VSCE_PAT`.

Alta en Open VSX:

1. Inicia sesión en [open-vsx.org](https://open-vsx.org/) con la cuenta de GitHub del proyecto y acepta el acuerdo de publicación de Eclipse Foundation desde el perfil.
2. En **Settings → Access Tokens**, genera un token.
3. Crea el namespace `meekojs` una vez: `pnpm dlx ovsx@1.3.0 create-namespace meekojs` con `OVSX_PAT` en el entorno. Para que la extensión aparezca como verificada, solicita la propiedad del namespace siguiendo las instrucciones de Open VSX.
4. Guarda el token como `OVSX_PAT`.

### Chrome Web Store

`publish-devtools.yml` comprueba que `devtools-v<versión>` coincide con `packages/devtools/manifest.json`. En Windows ejecuta `pnpm run devtools:check` y la prueba de la extensión instalada en Chrome for Testing. Después empaqueta un ZIP con `manifest.json` en la raíz, como exige la tienda (`package-zip.ps1 -RootLayout`), lo sube y lo envía a revisión mediante la [API v2 de Chrome Web Store](https://developer.chrome.com/docs/webstore/using-api). La versión 1.1 de la API está obsoleta; la v2 identifica cada elemento por publisher, por lo que hace falta `CHROME_PUBLISHER_ID`. La publicación sólo ocurre si existen los cinco secretos; con una configuración incompleta el job avisa qué nombres faltan y no publica.

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

1. Sube la versión en `packages/vscode/package.json` y su `CHANGELOG.md`, o en `packages/devtools/manifest.json` y `package.json`.
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

El paquete [npm `0.1.0`](https://www.npmjs.com/package/@meekojs/meeko/v/0.1.0) salió del commit `b492cf1` y coincide con la etiqueta [`v0.1.0`](https://github.com/meekojs/meeko/releases/tag/v0.1.0). Contiene cambios incompatibles respecto de `0.0.4`, documentados con su migración en el [CHANGELOG](../packages/meeko/CHANGELOG.md). La [CI de `main`](https://github.com/meekojs/meeko/actions/runs/40168927109) pasó antes de etiquetar. El [workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40169193614) repitió los gates y publicó mediante OIDC con procedencia SLSA firmada. Se instaló después desde npm en un proyecto vacío, donde la reactividad, las subrutas `framework` y `server` y los comandos `dev`, `check`, `build` y `start` de la CLI respondieron.

## Versión 1.0.0-rc.1


El paquete [npm `1.0.0-rc.1`](https://www.npmjs.com/package/@meekojs/meeko/v/1.0.0-rc.1) salió del commit `d8d7910` y coincide con la etiqueta [`v1.0.0-rc.1`](https://github.com/meekojs/meeko/releases/tag/v1.0.0-rc.1). Se publicó en el dist-tag `next`; `latest` sigue en `0.1.0`.

- **Versión.** `d001132` cambió `package.json` y el fixture del consumidor; `d8d7910` fechó el CHANGELOG y añadió [SECURITY.md](../SECURITY.md), con el informe privado de vulnerabilidades de GitHub activado en el repositorio.
- **Gates locales** sobre `d001132`: instalación congelada, `verify` (458/458 y 10/10 de DevTools), conformidad en Node, Bun 1.4.4, Deno 2.9.8 y workerd 1.20261019.1 (66/66), `e2e`, `pilot:e2e`, `package:smoke`, el consumidor full-stack, Redis real 8.10.2 (7/7), `npm pack --dry-run` (285 archivos, sólo `dist/`, `README.md`, `LICENSE` y `package.json`) y `git diff --check`.
- **CI.** [La verificación de `d8d7910`](https://github.com/meekojs/meeko/actions/runs/40193004578) pasó en Windows, Redis, Bun, Deno, workerd y la extensión de VS Code en Windows, Ubuntu y macOS.
- **Validación en `diegootayza`.** La aplicación enlaza el checkout local (`link:`), así que se validó contra el código de esta versión, no contra el tarball. Se migró `server/session.ts` a `server/runtime.ts` y el outlet a `Component`. `meeko check` y `meeko build` pasaron. Con `meeko dev`, Chrome hidrató sin errores, la navegación cliente funcionó y el formulario de login interceptó el envío con la respuesta de error de la aplicación. `meeko start` en producción no se probó, porque exige el origen HTTPS y el Redis de producción. La página de login conserva su parche provisional; la corrección del motor ya estaba verificada por separado. La validación encontró que una navegación cliente redirigida por el servidor fallaba con «route data mismatch»; se corrigió en `925ebd6` antes de la rc.
- **Publicación.** [El workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40193558287) repitió los gates y publicó mediante OIDC con procedencia SLSA. `npm view` confirmó la versión, el `gitHead` y la procedencia. La [prerelease de GitHub](https://github.com/meekojs/meeko/releases/tag/v1.0.0-rc.1) contiene los seis VSIX, el ZIP de Chrome DevTools y `SHA256SUMS.txt`.
- **Instalación desde npm.** En un proyecto vacío, `@meekojs/meeko@next` instaló la `1.0.0-rc.1`, `meeko init-framework` creó la aplicación con esa versión fijada y `meeko check` y `meeko build` pasaron. `meeko start` se detuvo con el aviso esperado de configurar un store de sesiones persistente.

Durante el periodo de prueba de la rc sólo se admiten correcciones que no cambien la API. Si alguna la cambiara, se publicaría `1.0.0-rc.2` siguiendo los mismos pasos.

## Versión 1.0.0

El paquete [npm `1.0.0`](https://www.npmjs.com/package/@meekojs/meeko/v/1.0.0) salió del commit `3e39f21` y coincide con la etiqueta [`v1.0.0`](https://github.com/meekojs/meeko/releases/tag/v1.0.0). Es la primera versión estable y se publicó en el dist-tag `latest`. El código es el de `1.0.0-rc.1`; entre ambas sólo cambiaron la documentación de esta página, la versión y el CHANGELOG. El mantenedor decidió publicarla sin agotar el periodo de prueba de la rc.

- **Gates locales** sobre `3e39f21`: `verify` (458/458 y 10/10 de DevTools), conformidad en Node, Bun, Deno y workerd (66/66), `e2e`, `pilot:e2e`, `package:smoke`, el consumidor full-stack, `npm pack --dry-run` (285 archivos) y `git diff --check`.
- **CI.** [La verificación de `3e39f21`](https://github.com/meekojs/meeko/actions/runs/40198651720) pasó en todos sus jobs.
- **Publicación.** [El workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40199343334) repitió los gates y publicó mediante OIDC con procedencia SLSA. `npm view` confirmó la versión, el `gitHead` y `latest: 1.0.0`. La [release de GitHub](https://github.com/meekojs/meeko/releases/tag/v1.0.0) es la más reciente y contiene los seis VSIX, el ZIP de Chrome DevTools y `SHA256SUMS.txt`.
- **Instalación desde npm.** En un proyecto vacío, `@meekojs/meeko` instaló la `1.0.0`; `meeko init-framework`, `meeko check` y `meeko build` pasaron.
- **Pendiente.** El dist-tag `next` sigue en `1.0.0-rc.1` porque moverlo requiere una sesión de npm del mantenedor (`npm dist-tag add @meekojs/meeko@1.0.0 next`). Las extensiones no se han publicado en sus tiendas: sus workflows esperan los secretos descritos arriba.

## Versión 1.0.1

El paquete [npm `1.0.1`](https://www.npmjs.com/package/@meekojs/meeko/v/1.0.1) salió del commit `2c5b89c` y coincide con la etiqueta [`v1.0.1`](https://github.com/meekojs/meeko/releases/tag/v1.0.1). Es un patch con dos correcciones que encontró `diegootayza` al pasar a `1.0.0`: `bind:value`, `bind:checked` y `bind:selected` sincronizan la propiedad viva de los controles de formulario, y el handshake de Socket acepta los alias de loopback del mismo puerto. Una revisión independiente del diff no encontró problemas P0 ni P1; sus observaciones P2 y P3 se corrigieron o se documentaron en el CHANGELOG antes de publicar.

- **Gates locales** sobre `2c5b89c`: instalación congelada, `verify` (463/463 y 10/10 de DevTools), conformidad en Node, Bun, Deno y workerd (66/66), `e2e`, `pilot:e2e`, `package:smoke`, el consumidor full-stack, `npm pack --dry-run` (285 archivos) y `git diff --check`.
- **CI.** [La verificación de `2c5b89c`](https://github.com/meekojs/meeko/actions/runs/40264782818) pasó en todos sus jobs.
- **Publicación.** [El workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40265423930) repitió los gates y publicó mediante OIDC con procedencia SLSA. `npm view` confirmó la versión, el `gitHead` y `latest: 1.0.1`. La [release de GitHub](https://github.com/meekojs/meeko/releases/tag/v1.0.1) es la más reciente y contiene los seis VSIX, el ZIP de Chrome DevTools y `SHA256SUMS.txt`.

## Versión 1.1.0

El paquete [npm `1.1.0`](https://www.npmjs.com/package/@meekojs/meeko/v/1.1.0) salió del commit `686dad3` y coincide con la etiqueta [`v1.1.0`](https://github.com/meekojs/meeko/releases/tag/v1.1.0). Es un minor con las funciones y cambios recogidos en el [CHANGELOG](../packages/meeko/CHANGELOG.md) y la [guía de actualización](migration-1.1.md). Los cambios de comportamiento aceptados como excepción están en [stability.md](stability.md). La extensión de VS Code sube también a `1.1.0`; sigue sin publicarse en las tiendas.

- **Validación previa.** `diegootayza` consumió el checkout mediante una copia fija (`link:` a un worktree de preview) durante el desarrollo y validó cada función en su aplicación. Una revisión independiente del diff completo encontró un P1 (`model` con un valor restaurado rompía la hidratación) y dos P2 (`html=` con HTML desbalanceado y `html`/`model` en elementos personalizados), corregidos antes de publicar.
- **Gates locales** sobre los commits de la versión: instalación congelada, `verify` (755/755 y 10/10 de DevTools), conformidad en Node, Bun 1.4.4, Deno 2.9.8 y workerd (70/70), `e2e`, `pilot:e2e`, `package:smoke`, el consumidor full-stack, el host aislado de VS Code, `npm pack --dry-run` (399 archivos, sólo `dist/`, `README.md`, `LICENSE` y `package.json`) y `git diff --check`.
- **CI.** Tres pruebas fallaron de forma intermitente en el runner de Windows y se corrigieron en el propio test: el listado del watcher justo después de `ready`, una edición de `.meeko/generated` escrita antes de que chokidar vigilara el directorio, y el cierre de Firefox en el piloto (hasta 9,8 s en CI), que ahora queda fuera del presupuesto de cada motor. [La verificación de `686dad3`](https://github.com/meekojs/meeko/actions/runs/40368171511) pasó en todos sus jobs.
- **Publicación.** [El workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40370108568) repitió los gates y publicó mediante OIDC con procedencia SLSA. `npm view` confirmó la versión, el `gitHead` y `latest: 1.1.0`. La [release de GitHub](https://github.com/meekojs/meeko/releases/tag/v1.1.0) es la más reciente y contiene los seis VSIX, el ZIP de Chrome DevTools y `SHA256SUMS.txt`.
- **Instalación desde npm.** En un proyecto vacío, `@meekojs/meeko@1.1.0` instaló la versión publicada; `meeko --version` dio `1.1.0`, y `meeko init-framework`, `meeko check` y `meeko build` pasaron.
- **Pendiente.** El dist-tag `next` sigue en `1.0.0-rc.1` (moverlo requiere una sesión de npm del mantenedor). Las extensiones siguen sin publicarse en sus tiendas. El sitio de documentación (`site/`) se desplegará en `meeko.diegootayza.com`.