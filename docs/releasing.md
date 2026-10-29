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

`publish.yml` sólo se dispara con etiquetas que empiezan por `v` y un dígito (`v[0-9]*`): con `v*` también lo disparaba `vscode-v<versión>`. Cada workflow falla antes de publicar si la etiqueta no coincide exactamente con la versión de su archivo. Las extensiones conservan así un número de versión independiente del paquete npm: una corrección de la extensión no obliga a publicar Meeko, y una versión de Meeko no sube las extensiones a las tiendas.

### Paquete npm y prereleases

`publish.yml` publica una versión con guion, como `1.0.0-rc.1`, con `npm publish --tag next`; `latest` no se mueve. Una versión sin guion se publica en `latest`. Tras una prerelease, comprueba con `npm view @meekojs/meeko dist-tags` que `latest` sigue en la última versión estable.

### Release de GitHub

Cuando npm termina, el job `github-release` de `publish.yml` empaqueta en Windows los VSIX de `win32`, `linux` y `darwin` en x64 y arm64 y el ZIP de Chrome DevTools (con la carpeta `meeko-devtools/`), calcula `SHA256SUMS.txt` y los adjunta a la release de la etiqueta. Si la versión es prerelease, la release se crea como prerelease; si no, se marca como la más reciente. Si la release ya existía, por ejemplo creada a mano o por un intento anterior, sólo se reemplazan los adjuntos. Es el único job con `contents: write`; `id-token: write` queda limitado al job que ejecuta `npm publish`.

Los VSIX y el ZIP adjuntos corresponden a la versión propia de cada extensión en ese commit. Su presencia en la release no implica que esa versión esté en Marketplace, Open VSX o Chrome Web Store.

## Publicación en las tiendas de extensiones

Los workflows de tiendas están configurados pero inactivos: cada paso de publicación comprueba si existe su secreto y, si falta, se omite con un aviso en el resumen de la ejecución en lugar de fallar. Las pruebas previas se ejecutan siempre.

Los secretos se guardan en **Settings → Secrets and variables → Actions → Repository secrets** del repositorio `meekojs/meeko`, con los nombres exactos de las tablas siguientes. No se guardan en el repositorio, en `.env` versionados ni en la documentación.

### VS Code: Marketplace y Open VSX

`publish-vscode.yml` comprueba que `vscode-v<versión>` coincide con `packages/vscode/package.json` y que la versión es `major.minor.patch`; ninguna de las dos tiendas acepta sufijos de prerelease en la versión de la extensión. Después ejecuta en Windows, Ubuntu y macOS las pruebas unitarias de la extensión, el VSIX de la plataforma y la prueba en un host aislado de VS Code. Sólo si todo pasa, empaqueta los seis VSIX y los publica con `@vscode/vsce@4.0.0` y `ovsx@1.3.0`, ambas versiones fijadas. Para Marketplace, `vsce publish --azure-credential` toma el acceso de la sesión que abre `azure/login` con Entra ID; con el PAT transitorio y en Open VSX, cada herramienta lee su token de la variable de entorno. Ningún token aparece en la línea de órdenes. `--skip-duplicate` permite repetir la ejecución si una tienda falló después de que la otra publicara.

| Secreto | Uso |
| --- | --- |
| `AZURE_CLIENT_ID` | ID de aplicación (cliente) del registro de Microsoft Entra ID que publica en Marketplace. No es una contraseña. |
| `AZURE_TENANT_ID` | ID del directorio (tenant) de ese registro. No es una contraseña. |
| `VSCE_PAT` | Respaldo opcional para Marketplace si faltan los dos ID de Entra. El secreto anterior se eliminó y su PAT se revocó. |
| `OVSX_PAT` | Token de Open VSX limitado a publicar `meekojs.meeko-language`. |

Visual Studio Marketplace se publica con **Microsoft Entra ID** y OIDC: GitHub emite en cada ejecución un token de corta duración para el environment `vscode-marketplace`, Entra lo cambia por un acceso a Azure DevOps y no se guarda ningún token. Los PAT globales de Azure DevOps (los de **All accessible organizations**, el único ámbito que admite Marketplace) [se retiran el 1 de diciembre de 2026](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). El workflow conserva la ruta de respaldo con `VSCE_PAT` si faltan los dos ID de Entra, pero ese secreto ya no está configurado.

Alta en Visual Studio Marketplace:

1. En la [página de gestión del Marketplace](https://marketplace.visualstudio.com/manage), con la cuenta Microsoft del mantenedor, crea el publisher con ID `meekojs`, el mismo valor de `publisher` en `packages/vscode/package.json` (ya existe).
2. En el [portal de Azure](https://portal.azure.com/), **Microsoft Entra ID → App registrations → New registration**: nombre `meeko-marketplace-publisher`, cuentas de este directorio únicamente, sin URI de redirección. No hace falta una suscripción de Azure. Anota **Application (client) ID** y **Directory (tenant) ID**.
3. En el registro, **Certificates & secrets → Federated credentials → Add credential**, escenario **GitHub Actions deploying Azure resources**: organización `meekojs` (ID `346854110`), repositorio `meeko` (ID `1430909739`), tipo de entidad **Environment**, environment `vscode-marketplace`. Comprueba que el sujeto sea `repo:meekojs@346854110/meeko@1430909739:environment:vscode-marketplace` y la audiencia `api://AzureADTokenExchange`. GitHub emite el sujeto con ID inmutables en este repositorio; el formato que sólo usa nombres no coincide. No crees un client secret.
4. En GitHub, guarda los dos ID como secretos `AZURE_CLIENT_ID` y `AZURE_TENANT_ID` (Settings → Secrets and variables → Actions).
5. Ejecuta a mano el workflow **Identidad de Marketplace** (`marketplace-identity.yml`). Su resumen muestra el ID de perfil de Azure DevOps de la identidad.
6. En la página del publisher `meekojs`, **Members → Add**, pega ese ID y asígnale el rol **Contributor**.
7. Vuelve a ejecutar **Identidad de Marketplace**: debe indicar que la identidad ya puede publicar. Entonces borra el secreto `VSCE_PAT` y revoca el PAT en Azure DevOps.

Alta en Open VSX:

1. Inicia sesión en [open-vsx.org](https://open-vsx.org/) con la cuenta de GitHub del proyecto y acepta el acuerdo de publicación de Eclipse Foundation desde el perfil.
2. En **Settings → Access Tokens**, genera un token.
3. Crea el namespace `meekojs` una vez desde la cuenta de Open VSX (ya existe). Para que la extensión aparezca como verificada, solicita la propiedad del namespace siguiendo las instrucciones de Open VSX.
4. Limita el token al namespace `meekojs`, a la extensión `meeko-language` y a **Publishing only**. Guárdalo como `OVSX_PAT`.

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

## Versión 1.2.0

El paquete [npm `1.2.0`](https://www.npmjs.com/package/@meekojs/meeko/v/1.2.0) salió del commit `1580cd9` y coincide con la etiqueta [`v1.2.0`](https://github.com/meekojs/meeko/releases/tag/v1.2.0). Es un minor con las funciones y cambios recogidos en el [CHANGELOG](../packages/meeko/CHANGELOG.md) y la [guía de actualización](migration-1.2.md). Sus cambios aceptados como excepción (las props reactivas, el `Origin` que exige `session.create()` contra el *login CSRF* y los eventos tipados por elemento) están en [stability.md](stability.md#excepciones-aprobadas). La extensión de VS Code sube a `1.2.0`. Meeko DevTools sigue en `1.0.0`: desde `1.1.0` sólo cambió de carpeta (`packages/devtools`) y ganó descripciones en sus tipos generados, sin cambios en los archivos que empaqueta. Ninguna de las dos se ha publicado en las tiendas.

- **Validación previa.** `diegootayza` consumió el checkout mediante `link:` y adoptó la autenticación integrada, `MeekoOutlet`, `MeekoLink` y `@utilities`. Una revisión independiente del diff desde `1f412ba` no encontró P0 ni P1. Su P2 (un middleware que sustituía la `Request` perdía la IP del cliente y `rateLimit` caía en un contador común) y sus P3 (`href` estático no ASCII en `MeekoLink`, `X-Forwarded-For` con puerto, `MEEKO_TRUST_PROXY` validada al arrancar en cada adaptador, secuencias de escape en `meeko auth hash`, componentes propios llamados `MeekoLink` o `MeekoOutlet` con `MEEK106`, la excepción de los eventos tipados y la hoja de estilos con hash desconocido) se corrigieron antes de publicar.
- **Gates locales** sobre el árbol del commit de la versión (salvo esta sección): instalación congelada, `verify` (1004/1004 y 10/10 de DevTools), conformidad en Node 24.21.0, Bun 1.4.4, Deno 2.9.8 y workerd 1.20261019.1 (74/74), `e2e` (5/5), `pilot:e2e` en Chromium, Firefox y WebKit (8/8), `package:smoke`, el consumidor full-stack, el VSIX de VS Code (281 archivos), el host aislado, `npm pack --dry-run` (480 archivos, sólo `dist/`, `README.md`, `LICENSE` y `package.json`), `site:build` (420 páginas) y `git diff --check`. El host aislado falló primero porque su prueba seguía esperando sólo los dos comandos de valores en vivo, sin los tres de creación de archivos; se corrigió en el propio test (`53c97d7`).
- **CI.** Es la primera versión con el repositorio como workspace de pnpm. [La primera verificación](https://github.com/meekojs/meeko/actions/runs/40490890815) falló en el job `test` de Windows: en el runner, pnpm 12 crea symlinks relativos (en local, sin ese permiso, crea junctions), y los proyectos temporales de las pruebas llegaban a ellos a través de una junction a toda la carpeta `node_modules`, así que Node no resolvía `@typescript/typescript6` ni TypeScript 7 `@types/node`. Se corrigió en el helper de las pruebas (`2edfcd9`, con su prueba) y, de paso, la recarga de `meeko.config.ts` dos veces en el mismo instante de mtime (`1580cd9`). [La verificación de `1580cd9`](https://github.com/meekojs/meeko/actions/runs/40497494290) pasó en todos sus jobs.
- **Publicación.** [El workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40499230697) repitió los gates y publicó mediante OIDC con procedencia SLSA. `npm view` confirmó la versión, el `gitHead` `1580cd97873425b7d2e8591fa6a219a395d61b45` y `latest: 1.2.0`. La [release de GitHub](https://github.com/meekojs/meeko/releases/tag/v1.2.0) es la más reciente y contiene los seis VSIX de `meeko-language` 1.2.0, el ZIP de Chrome DevTools 1.0.0 y `SHA256SUMS.txt`.
- **Instalación desde npm.** En un proyecto vacío, `@meekojs/meeko@1.2.0` instaló la versión publicada; `meeko --version` dio `1.2.0`, y `meeko init-framework`, `meeko check` y `meeko build` pasaron.
- **Después de publicar.** El mantenedor movió el dist-tag `next` a `1.2.0`; `npm view` muestra `latest` y `next` en `1.2.0`. El sitio de `meeko.diegootayza.com` se redesplegó desde `v1.2.0`: el Dockerfile de Coolify pasó a `MEEKO_REF=v1.2.0`, construye con `pnpm run site:build:static` desde la raíz y copia `apps/site/deploy/nginx.conf` y `apps/site/dist-static`. Las rutas principales, `/docs/reference` y `/docs/migration-1.2` respondieron 200 y el changelog muestra `1.2.0`.
- **Extensión de VS Code en las tiendas.** `meeko-language` 1.2.0 es la primera versión publicada en [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=meekojs.meeko-language) y [Open VSX](https://open-vsx.org/extension/meekojs/meeko-language), con las seis plataformas en ambas (etiqueta `vscode-v1.2.0`). Marketplace verifica la primera variante de una extensión nueva antes de aceptar las demás, así que el workflow publica primero `darwin-arm64` y espera a que sea visible (`bc07e75`). El namespace `meekojs` de Open VSX está pendiente de verificación. Meeko DevTools sigue sin publicarse en Chrome Web Store.

## Versión 1.3.0

El paquete [npm `1.3.0`](https://www.npmjs.com/package/@meekojs/meeko/v/1.3.0) salió del commit `96503b1` y coincide con la etiqueta [`v1.3.0`](https://github.com/meekojs/meeko/releases/tag/v1.3.0). Es un minor con las funciones y cambios recogidos en el [CHANGELOG](../packages/meeko/CHANGELOG.md) y la [guía de actualización](migration-1.3.md): el adaptador `static` con `site`, `sitemap`, `robots`, `document.seo` y la CSP con hashes; `TrustedHtml` y `trustHtml` con el aviso `MEEK107`; `MEEK108` y `MEEK109` para las APIs escritas donde no existen; los fallos globales del navegador y `processErrors` en el servidor; los logs del servidor en la consola del navegador durante `meeko dev`; `imports.appDirs` e `imports.sharedDirs`; el completado de clases CSS en el editor, y la normalización y el orden de clases y `meekoPreserveArrayBreaks` en el plugin de Prettier. Su único cambio aceptado como excepción, las declaraciones de `@meekojs/meeko/postcss` tipadas con csstype (sólo de tipos), está en [stability.md](stability.md#excepciones-aprobadas). La extensión de VS Code sube a `1.3.0`, con el completado de clases, el formato y los diagnósticos nuevos, y un servidor incluido que deja Vite fuera del paquete. Meeko DevTools sigue en `1.0.0`: desde `1.2.0` no cambió ningún archivo de `packages/devtools`.

- **Validación previa.** Una revisión independiente del diff desde `1580cd9` no encontró P0 ni P1. Sus cuatro P2 (la entrada estática compartida con `meeko dev`, `MEEKO_PUBLIC_ORIGIN` con ruta, los logs de desarrollo detrás de un túnel y el printer `estree` con dos versiones de Prettier) y sus P3 se corrigieron antes de publicar.
- **Gates locales** sobre el árbol de la versión (salvo esta sección): `verify` (1097/1097 y 10/10 de DevTools), `e2e` (7/7), `pilot:e2e` en Chromium, Firefox y WebKit (8/8), conformidad en Node, Bun, Deno y workerd (81/81), `package:smoke`, `site:build:static` (441 páginas, con esta guía de actualización), las pruebas unitarias de la extensión de VS Code (`vscode:test`, 24/24), `npm pack --dry-run` (525 archivos, sólo `dist/`, `README.md`, `LICENSE` y `package.json`) y `git diff --check`.
- **Publicación.** `npm view` confirma la versión, el `gitHead` `96503b13a25b7062971435138674cf7d0baf37d0` y `latest: 1.3.0`. Los enlaces a la verificación de CI y al workflow de publicación, la release de GitHub y la instalación desde npm en un proyecto vacío no quedaron registrados aquí.
- **Extensión de VS Code en las tiendas.** `meeko-language` 1.3.0 (etiqueta `vscode-v1.3.0`) está publicada en Visual Studio Marketplace y en Open VSX con las seis plataformas en ambas, según sus API públicas. Es la primera publicación en Marketplace con Microsoft Entra ID (OIDC, sin PAT). El primer intento del workflow falló antes de subir nada: en PowerShell, `--azure-credential` llegaba a vsce carácter a carácter y vsce rechazaba la publicación; se corrigió construyendo el array de argumentos con `+=` (`b9faf89`). Con eso, Marketplace la aceptó con Entra ID, pero Open VSX no la recibió: el secreto `OVSX_PAT` llegaba con un carácter al final (probablemente un salto de línea al pegarlo) y ovsx rechazaba la cabecera `Authorization` con «Invalid character in header content». El workflow recorta ahora el token (`5b3820b`), y Open VSX se completó al reintentar tras un timeout.
- **Después de publicar.** El sitio de `meeko.diegootayza.com` se redesplegó desde `v1.3.0` (`MEEKO_REF=v1.3.0`, despliegue 1129 de Coolify); `/docs/migration-1.3` responde 200. El dist-tag `next` sigue en `1.2.0`.

## Versión 1.4.0

El paquete [npm `1.4.0`](https://www.npmjs.com/package/@meekojs/meeko/v/1.4.0) salió del commit `f2a1c35` y coincide con la etiqueta [`v1.4.0`](https://github.com/meekojs/meeko/releases/tag/v1.4.0). Es un minor con las funciones y cambios recogidos en el [CHANGELOG](../packages/meeko/CHANGELOG.md) y la [guía de actualización](migration-1.4.md): el tema claro/oscuro sin parpadeo (`theme`, `useTheme()`, `data-theme-choice` y la etiqueta `<MeekoThemeToggle>` con `MEEK111`); `if:when` en `<snippet>` con `MEEK110` y el objeto `snippets` reactivo en el hijo; los tipos con el nombre de cada componente, `defineSnippets` con `Snippet<Args>`, `MeekoLinkProps` y `RouteId`; los autoimports en los módulos de `@utilities`; la CSP con hashes de estilos; el completado filtrado y la comprobación del proyecto en el editor, y `meeko dev` con un Meeko enlazado (`MEEKO_LINK_WATCH`). Su único cambio aceptado como excepción, que un módulo no pueda usar como `meta.configKey` una clave propia de `MeekoConfig` (`theme` lo es desde esta versión), está en [stability.md](stability.md#excepciones-aprobadas). El repositorio añade ESLint (`pnpm lint`), que no afecta al paquete publicado. La extensión de VS Code sube a `1.4.0`. Meeko DevTools sigue en `1.0.0`: desde `1.3.0` no cambió ningún archivo de `packages/devtools`.

- **Validación previa.** Una revisión independiente del diff desde `5b3820b` encontró dos P1, dos P2 y varios P3, todos corregidos antes de publicar, cada uno con su prueba:
  - P1: un componente del proyecto llamado `MeekoLink`, `MeekoOutlet` o `MeekoThemeToggle` hacía ambiguo su tipo `…Props` y rompía la generación de tipos en `meeko check`, `meeko dev` y el editor; ahora el tipo de la etiqueta integrada cede ante el del componente.
  - P1: el módulo de tema del ejemplo de `1.3` (`configKey: "theme"`) chocaba con la opción `theme`; ahora una clave propia de `MeekoConfig` en `meta.configKey` falla con un mensaje que pide renombrarla, documentado como excepción y en la guía de actualización.
  - P2: con `theme.attribute: "class"`, el runtime borraba las clases de `<html>` que no venían de `useHead`; ahora cambia sólo la clase del tema con `classList`.
  - P2: `meekoUtilities()` ejecutaba `meeko.config.*` y los `setup` de los módulos aunque no hubiera rolldown, y un fallo ahí rompía la hoja; ahora comprueba antes rolldown y, si el registro falla, avisa y sigue sin autoimports.
  - P3: `MEEK111` falso en un layer con `package.json` propio; `createContext` de nivel superior del tema y del router en el bundle de una app sin framework (marcados `/*#__PURE__*/`); el script del tema, que ahora va antes de las hojas enlazadas; el valor por defecto de `storageKey` y la lectura de `theme` en `meeko dev` en la documentación, y entradas del CHANGELOG que corregían lo que `1.3` no tenía.
- **Gates locales** sobre el árbol de la versión (salvo esta sección): instalación congelada sin red, `pnpm lint` (0 errores, 54 avisos de deuda conocida), `verify` (1162/1162 y 10/10 de DevTools), `e2e` (10/10), `pilot:e2e` en Chromium, Firefox y WebKit (8/8), conformidad en Node, Bun, Deno y workerd (81/81), `package:smoke`, `site:build:static` (456 páginas, con esta guía de actualización), las pruebas unitarias de la extensión de VS Code (`vscode:test`, 27/27), el consumidor full-stack, `npm pack --dry-run` (543 archivos, sólo `dist/`, `README.md`, `LICENSE` y `package.json`) y `git diff --check`. El bundle de cliente minificado del ejemplo `counter`, sin framework, pasó de 12 361 a 12 115 bytes (4813 a 4714 con gzip) al dejar fuera el tema, el estado del router y `<MeekoThemeToggle>`.
- **CI.** La verificación del commit de la versión necesitó dos correcciones en `main` antes de pasar: el servidor de lenguaje escribía en una conexión ya cerrada al apagarse (`0415e00`), y la prueba del hint de tema de `e2e` no aceptaba el hint desfasado que deja la emulación de `prefers-color-scheme` por CDP (`f2a1c35`). Además, una prueba del CSS de `meeko dev` falló de forma intermitente y pasó al reintentar; era la regresión del snapshot de la hoja global que corrige `1.4.1`. La verificación de `f2a1c35` pasó en todos sus jobs.
- **Publicación.** El workflow de publicación repitió los gates y publicó mediante OIDC con procedencia SLSA. `npm view` confirmó la versión, el `gitHead` `f2a1c35214cff6c9863b0e74994896a085aca33a` y `latest: 1.4.0`. La [release de GitHub](https://github.com/meekojs/meeko/releases/tag/v1.4.0) contiene sus 8 assets: los seis VSIX de `meeko-language` 1.4.0, el ZIP de Chrome DevTools 1.0.0 y `SHA256SUMS.txt`. Al crear la etiqueta `vscode-v1.4.0` se disparó también este workflow, porque su filtro `v*` encajaba con ella; esa publicación se canceló sin publicar nada, y `1.4.1` restringe el filtro a `v[0-9]*`.
- **Instalación desde npm.** Se verificó la instalación de `@meekojs/meeko@1.4.0` desde npm.
- **Extensión de VS Code en las tiendas.** `meeko-language` 1.4.0 (etiqueta `vscode-v1.4.0`) está publicada en Visual Studio Marketplace y en Open VSX con las seis plataformas en ambas. Open VSX la aceptó al primer intento, ya con la publicación de cada VSIX por separado que da por publicada una versión que Open VSX aún no ha activado («isn't active»).
- **Después de publicar.** El sitio de `meeko.diegootayza.com` se redesplegó desde `v1.4.0` (`MEEKO_REF=v1.4.0`, despliegue `hoggm2xchov0l6ps2wk6abnz` de Coolify). El dist-tag `next` sigue en `1.2.0`. En producción, el selector de tema del sitio, que aún gestionaba el tema a mano, perdía la elección al navegar; se corrige en el sitio con `1.4.1`.

## Versión 1.4.1

El paquete [npm `1.4.1`](https://www.npmjs.com/package/@meekojs/meeko/v/1.4.1) salió del commit `dd05ce4` y coincide con la etiqueta [`v1.4.1`](https://github.com/meekojs/meeko/releases/tag/v1.4.1). Fue un patch sobre `1.4.0` con la corrección recogida en el [CHANGELOG](../packages/meeko/CHANGELOG.md): en `meeko dev`, el snapshot de la hoja global (`.meeko/styles/main.css`) espera al contenido del archivo cambiado con el `read()` de Vite antes de transformarla, así que editar un archivo que la hoja importa ya no la deja sin sus reglas. Es la regresión que hizo fallar de forma intermitente la prueba del CSS de `meeko dev` en el CI de `1.4.0`. No cambió la API. La extensión de VS Code siguió en `1.4.0` y Meeko DevTools en `1.0.0`.

Cambios del repositorio, fuera del paquete publicado:

- **Filtro de etiquetas de `publish.yml`.** El workflow de npm pasó a dispararse con `v[0-9]*` en lugar de `v*`, así que una etiqueta `vscode-v<versión>` ya no lanza una publicación de npm como ocurrió con `vscode-v1.4.0`.
- **Tema del sitio.** El layout del sitio gestionaba el tema a mano (una señal y un `effect` que escribían `localStorage` y `data-theme`), en paralelo con el tema de Meeko (`theme: true`). Al elegir un tema y navegar por un enlace interno, la cookie seguía con la elección anterior, `<html>` quedaba con `data-theme` y `data-theme-choice` distintos y la página siguiente volvía al tema de la cookie. Desde `1.4.1`, el layout usa `useTheme()` y pasa su `theme` al selector con `model="theme"`. En el build estático servido en local, al elegir Oscuro, Claro y Sistema y navegar entre `/docs/framework`, `/docs/changelog` y `/docs/api` sin recargar, y después al recargar, coincidieron siempre el radio marcado, `data-theme`, `data-theme-choice`, `color-scheme`, la cookie y `localStorage`, sin errores en la consola, violaciones de CSP ni avisos de hidratación.

- **Gates locales** sobre el árbol de la versión (salvo esta sección): `pnpm lint` (0 errores, 54 avisos de deuda conocida), `verify` (1164/1164 y 10/10 de DevTools), `e2e` (10/10), `site:build:static` (456 páginas), `package:smoke`, `npm pack --dry-run` (543 archivos, sólo `dist/`, `README.md`, `LICENSE` y `package.json`) y `git diff --check`. `pilot:e2e`, la conformidad en otros runtimes y `vscode:test` no se repitieron: el patch no toca el runtime del navegador, los adaptadores ni la extensión.
- **Publicación.** `npm view` confirma la versión `1.4.1`, el `gitHead` `dd05ce4b676847feacf966dc643158ae340159c3` y `latest: 1.4.1`; el dist-tag `next` sigue en `1.2.0`. Los enlaces a la verificación de CI y al workflow de publicación, la release de GitHub y la instalación desde npm no quedaron registrados aquí.
- **Después de publicar.** El sitio de `meeko.diegootayza.com` se redesplegó desde `v1.4.1` (`MEEKO_REF=v1.4.1`, despliegue `tweret5hsmpysppvkmui5bfg` de Coolify), y en producción se comprobó el arreglo del selector de tema: la elección se conserva al navegar.

## Versión 1.5.0

El paquete [npm `1.5.0`](https://www.npmjs.com/package/@meekojs/meeko/v/1.5.0) salió del commit `4295ad6` y coincide con la etiqueta [`v1.5.0`](https://github.com/meekojs/meeko/releases/tag/v1.5.0). Fue un minor con las funciones y cambios recogidos en el [CHANGELOG](../packages/meeko/CHANGELOG.md) y la [guía de actualización](migration-1.5.md): los layouts con nombre con `+group.ts`, `layoutProps` y `useLayout()`; `useForm` con `field`, `trySubmit`, `commit`, `onSuccess` y `focusInvalid`; `useId()` con `document.idPrefix`; `ApiError` con `issues`; las etiquetas HTML y `bind="obj"` en `<component is>`; `<MeekoTeleport>`, `<MeekoAwait>` con la reserva de altura, `<MeekoPopover>` y `<MeekoSelect>`, cada etiqueta propia en su módulo `@meekojs/meeko/builtins/*`; `match` en `<MeekoLink>` y `useRoute().isActive()`; `refreshing` y `keepPrevious` en `useApi` y `useRpcQuery`; los aliases de ruta `~/`, `@/`, `#shared/` y `#server/`, y los códigos `MEEK112` a `MEEK118`. Sus dos cambios aceptados como excepción, `bind="…"` sin nombre como directiva y `alias` como clave propia de `MeekoConfig`, están en [stability.md](stability.md#excepciones-aprobadas), que recoge además la regla de las interfaces que Meeko entrega y ganan miembros en un minor. La extensión de VS Code sube a `1.5.0`, con el resaltado de las etiquetas nuevas y de `bind="…"` y el servidor de lenguaje de `1.5`. Meeko DevTools sigue en `1.0.0`: desde `1.4.0` no cambió ningún archivo de `packages/devtools`.

- **Validación previa.**
  - **Adopción en diegootayza.** La aplicación adoptó `1.5` sin fallos: `meeko check`, Prettier, `meeko build` y `meeko start` pasan. Los 9 imports de los contratos de `server/api` y `server/rpc` usan `#shared/` y no queda ningún `../shared` en `server/` (sólo `./schema` sigue relativo, porque lo exige drizzle-kit); en la build, `POST /api/forms/signup` responde `409` con el issue en `email`, y un login vacío, `400` con dos issues. `AppField`, `AppSelect` y `AppCheckbox` declaran el modelo opcional sin nombre (`defineModel<T>({ default })`) y leen `computed(() => props.field?.value ?? model)`, sin `untrack` ni `MEEK101`; en Chrome funcionan en modo `field` y en modo `model`, con la consola limpia. Las fricciones que encontró se corrigieron antes de publicar: el modelo por defecto opcional quedó documentado (y explicado en el hover de `defineModel`), el ejemplo de `FormField` muestra un campo que sirve con `field` y con `model`, y los schemas de los contratos se importan con `#shared/`.
  - **Revisión independiente.** Una revisión independiente del diff desde `dd05ce4` no encontró P0 ni P1. Sus P2 y P3 se corrigieron antes de publicar, cada uno con su prueba:
    - P2: al cambiar `<component is>` entre una etiqueta y un componente en el navegador, el render y la hidratación nuevos perdían la posición de `useId`: la hidratación del componente daba `Hydration mismatch` y los IDs del contenido perdían `document.idPrefix`; ahora conservan la posición que les dio el SSR.
    - P2: una prop `undefined` en `layoutProps` o en `useLayout().set()` respondía `500` sin nombrar el componente; ahora deja la prop en el valor por defecto del layout, en el servidor y en el navegador, y un valor que JSON no representa falla nombrando la página, el layout y la prop.
    - P2: un prefijo que el proyecto redefine en los `paths` de su `tsconfig.json` o con un `resolve.alias` de un módulo seguía sujeto a las comprobaciones de ámbito de Meeko (`MEEK118`, `MEEK108`); ahora desactiva el alias de Meeko de ese prefijo en todas partes, con un aviso por proceso.
    - P3: miembros nuevos obligatorios en `RouteState`, `DataResource`, `LoadedResource` y `Form`; `stability.md` recoge que las interfaces que Meeko entrega pueden ganar miembros en un minor y no deben implementarse a mano.
    - P3: `normalizeServerError` reenviaba los `issues` de cualquier error con forma de `ApiError`; ahora sólo los de un `ApiError` de Meeko, reconocido entre copias por una marca.
    - P3: `bind="obj"` comparaba los nombres con mayúsculas: `Data-Meeko` pasaba y `ID` junto a `bind:id` duplicaba el atributo; ahora los compara sin distinguirlas, como HTML.
    - P3: `bind:reserve` de `<MeekoAwait>` se leía una sola vez; ahora el script, las reglas y la medición lo siguen.
    - P3: documentación desfasada de `bind="trigger"` en `<MeekoPopover>` y de las filas de `@meekojs/meeko` y `/build` en `stability.md`.
  - **Bundle.** El bundle de cliente minificado del ejemplo `counter`, sin framework, pasó de 12 115 bytes en `1.4.1` a 12 571 (4759 a 4956 con gzip): `useId` y los cambios de hidratación de `<component is>` y del estado. Los datos de atributos HTML de `<component is>` entraban en todas las apps (335 bytes) por un `Set` de nivel superior; ahora se construye al usarse y no entran. El cliente del starter de `meeko init-framework` pasó de 78 993 a 84 417 bytes (28 949 a 30 908 con gzip): el starter usa `app/layouts/default.meeko`, así que carga el runtime de los layouts con nombre, y `renderWithState` transfiere el estado con las señales `undefined`.
  - **`meeko dev`.** Cada etiqueta propia es una subruta de `@meekojs/meeko/builtins/*` que sólo importan las páginas que la usan, y las páginas se cargan con `import()`: con Meeko instalado desde npm, Vite habría descubierto el módulo en la primera visita a esa página y la habría recargado. `meeko dev` los añade ahora a `optimizeDeps.include` cuando Vite optimiza Meeko (no con un Meeko enlazado ni excluido, donde duplicaría el runtime).
- **Gates locales** sobre el árbol de la versión (salvo esta sección): instalación congelada sin red, `pnpm lint` (0 errores, 54 avisos de deuda conocida), `verify` (1286/1286 y 10/10 de DevTools), `e2e` (17/17), `pilot:e2e` en Chromium, Firefox y WebKit (8/8), conformidad en Node, Bun, Deno y workerd (81/81), `package:smoke`, `site:build:static` (506 páginas, con esta guía de actualización), las pruebas unitarias de la extensión de VS Code (`vscode:test`, 32/32), el consumidor full-stack, `npm pack --dry-run` (594 archivos, sólo `dist/`, `README.md`, `LICENSE` y `package.json`) y `git diff --check`.
- **CI.** La [verificación](https://github.com/meekojs/meeko/actions/runs/40708836771) del commit de la versión pasó en todos sus jobs al primer intento.
- **Publicación.** El [workflow de publicación](https://github.com/meekojs/meeko/actions/runs/40708836673) repitió los gates y publicó mediante OIDC con procedencia SLSA. Pasó en el segundo intento: en el primero, GitHub no consiguió un runner de macOS. `npm view` confirma la versión `1.5.0`, el `gitHead` `4295ad6ab7d11adacfb7369e9914cfc45147e018` y `latest: 1.5.0`. La [release de GitHub](https://github.com/meekojs/meeko/releases/tag/v1.5.0) contiene sus 8 assets: los seis VSIX de `meeko-language` 1.5.0, el ZIP de Chrome DevTools 1.0.0 y `SHA256SUMS.txt`.
- **Instalación desde npm.** No quedó registrada aquí.
- **Extensión de VS Code en las tiendas.** `meeko-language` 1.5.0 (etiqueta `vscode-v1.5.0`, [workflow](https://github.com/meekojs/meeko/actions/runs/40708836654)) está publicada en Visual Studio Marketplace y en Open VSX con las seis plataformas en ambas.
- **Después de publicar.** El sitio de `meeko.diegootayza.com` se redesplegó desde `v1.5.0` (`MEEKO_REF=v1.5.0`, despliegue `q8uhkebxswcc8dgeqqg8mzrd` de Coolify). El dist-tag `next` sigue en `1.2.0`.

## Versión 1.6.0

El paquete [npm `1.6.0`](https://www.npmjs.com/package/@meekojs/meeko/v/1.6.0) saldrá del commit `PENDIENTE: hash del commit publicado` y coincidirá con la etiqueta [`v1.6.0`](https://github.com/meekojs/meeko/releases/tag/v1.6.0). Es un minor con las funciones y cambios recogidos en el [CHANGELOG](../packages/meeko/CHANGELOG.md) y la [guía de actualización](migration-1.6.md): el middleware de ruta con nombre (`defineRouteMiddleware(fn, { global: false })`, que las rutas piden con `middleware` en `definePage` y en `+group.ts`); el middleware de ruta de servidor (`app/middleware/*.server.ts` con `defineServerRouteMiddleware`, con la sesión de la petición y fuera del bundle del navegador); la hidratación con la URL del render (`url` en el payload), que arregla `<MeekoThemeToggle>` en las páginas prerenderizadas servidas en otra URL, y el cierre de la redirección abierta de `POST /_meeko/theme`. Sus dos cambios aceptados como excepción, los `*.server.ts` de `app/middleware` como middleware de servidor y el `middleware` explícito tras un spread en las opciones de la página, están en [stability.md](stability.md#excepciones-aprobadas). La extensión de VS Code sube a `1.6.0`, con el servidor de lenguaje de `1.6` (completado, hover y definición de los nombres de middleware). Meeko DevTools sigue en `1.0.0`: desde `1.5.0` no cambió ningún archivo de `packages/devtools`.

- **Validación previa.**
  - **Adopción en diegootayza.** La aplicación protege su panel con el middleware de servidor `auth` (`app/middleware/auth.server.ts`, `{ global: false }`), que el `+group.ts` de `(dashboard)` pide y que comprueba la sesión con `isOwner` de `#server/auth`. Sin sesión, las páginas del grupo responden `302` a `/login`, en SSR y en la navegación del cliente; con sesión, las dos páginas cargan, y el bundle del cliente no contiene el middleware. Su uso encontró un fallo intermitente del primer `meeko check` (`TS7031` en `.meeko/generated/entry-client.ts` con la declaración del módulo virtual del middleware desfasada, por un `meeko dev` antiguo en paralelo); la entrada generada tipa ahora sus parámetros y no depende de esa declaración.
  - **Revisión independiente.** Una revisión independiente del diff desde `4295ad6` no encontró P0. Sus dos P1 y sus P2 y P3 se corrigieron antes de publicar, cada uno con su prueba:
    - P1: un `app/middleware/*.server.ts` con un export por defecto que no era `defineServerRouteMiddleware(...)` (un helper como `export default function parseCookies…`) se convertía sin aviso en middleware global de servidor y se ejecutaba en cada SSR; ahora detiene el descubrimiento con la pista de mover los helpers a `server/utils`.
    - P1: un `middleware` que llegaba por spread en `definePage` no llegaba al manifiesto y la página se servía sin él; ahora un spread que puede llevarlo exige declarar `middleware` después, y una página cuyo `middleware` no está en su manifiesto falla con `500` antes del loader.
    - P2: `stability.md` no recogía los `*.server.ts` de `app/middleware` como excepción; ahora tiene las dos filas de `1.6` con su migración.
    - P2: un host propio con el cargador de los middleware de servidor con nombre y sin el de los globales se saltaba los globales; ahora `RouteRecord.serverMiddleware` lleva la cadena completa de la ruta y una sola opción, `loadServerMiddleware(file)`, la carga, así que sin ella la ruta falla.
    - P3: la documentación del autoimport de `defineServerRouteMiddleware` (también en `server/`); `RouteMiddlewareName` vacío (`never`) en una aplicación sin middleware con nombre; el `middleware` de una página `render: "client"` sin los nombres de servidor, y pruebas del middleware de servidor con `render: "stream"`, `HEAD`, la navegación `ndjson` y un host propio sin cargador.
  - **Sitio.** El rediseño de `apps/site` pasó su revisión final con el veredicto «ship».
- **Gates locales** sobre el árbol de la versión (salvo esta sección): instalación congelada sin red, `pnpm lint` (0 errores, 54 avisos de deuda conocida), `verify` (1321/1321 y 10/10 de DevTools), `e2e` (17/17), `pilot:e2e` en Chromium, Firefox y WebKit (8/8), conformidad en Node, Bun, Deno y workerd (81/81), `package:smoke`, `site:build:static` (516 páginas, con esta guía de actualización), las pruebas unitarias de la extensión de VS Code (`vscode:test`, 32/32), el consumidor full-stack, `npm pack --dry-run` (597 archivos, sólo `dist/`, `README.md`, `LICENSE` y `package.json`) y `git diff --check`.
- **CI.** PENDIENTE: verificación del commit de la versión en todos sus jobs.
- **Publicación.** PENDIENTE: enlace al workflow de publicación; confirmación con `npm view` de la versión, el `gitHead` y `latest: 1.6.0`; la release de GitHub con los seis VSIX de `meeko-language` 1.6.0, el ZIP de Chrome DevTools 1.0.0 y `SHA256SUMS.txt`.
- **Extensión de VS Code en las tiendas.** PENDIENTE: `meeko-language` 1.6.0 con la etiqueta `vscode-v1.6.0` en Visual Studio Marketplace y Open VSX.
- **Después de publicar.** PENDIENTE: el redespliegue del sitio de `meeko.diegootayza.com` desde `v1.6.0` (`MEEKO_REF=v1.6.0`).
