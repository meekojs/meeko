# Extensión de VS Code para Meeko

La extensión reconoce archivos `.meeko`, resalta las secciones TypeScript, HTML y CSS y conecta VS Code con el **servidor de lenguaje de Meeko** (`meeko-language-server`). Toda la lógica del lenguaje vive en ese servidor, que es el mismo que usan Neovim, Zed, Helix, JetBrains o Sublime Text ([guía de editores](https://github.com/meekojs/meeko/blob/main/docs/editors.md)); la extensión sólo lo arranca y le pasa el estado de confianza del workspace.

El servidor publica los mismos diagnósticos de compilación y tipos que `meeko check`, con el rango completo del token afectado. El análisis semántico usa un archivo TypeScript virtual por componente dentro de un único servicio por proyecto, configurado con el `tsconfig.json` de la raíz del paquete: las referencias del `<script>` y las expresiones del `<template>` comparten completado, hover, ir a definición, referencias, renombrado, ayuda de firma y color semántico, también entre archivos `.meeko` y `.ts`. Además ofrece símbolos del documento, plegado, formato de las tres secciones y acciones rápidas (añadir imports, resolver autoimports ambiguos, quitar `params` sobrantes de un `href` estático, añadir `each:key` y mover un sidecar a `<script server>`).

Las páginas pueden declarar su código de servidor y sus opciones de ruta en un bloque `<script server lang="ts">` en lugar de un sidecar `.route.ts`. El editor lo trata como un módulo TypeScript propio, con los autoimports de servidor (o los de cliente si su `render` estático es `"client"`): diagnósticos de tipos en su posición del `.meeko`, completado, hover, ir a definición, referencias, símbolos y formato. Un bloque fuera de `app/pages`, o en un `+layout` o `+error`, se marca con `MEEK044` sobre su etiqueta de apertura; `<script server="...">` se marca con `MEEK043`.

`defineProps<Props>({ count: 0 })` ofrece defaults tipados en el editor: la prop puede omitirse al usar el componente y se reconoce como definida dentro de su script y plantilla. El compilador y el modelo semántico del editor comparten el análisis AST de esas claves.

## Funciones de Meeko

El servidor de lenguaje entiende la reactividad, los componentes y la estructura de la aplicación (detalles en la [guía de editores](https://github.com/meekojs/meeko/blob/main/docs/editors.md#funciones-propias-de-meeko)):

- **Color de la reactividad.** Las señales, los `computed` y los recursos de datos (`useApi`, `useRpcQuery`, `useRpcMutation`) tienen colores propios en el script y la plantilla, las escrituras de `.value` se distinguen de las lecturas y las expresiones de la plantilla que leen un valor reactivo se marcan. Lo decide el tipo, no el nombre: `props.value` o `input.value` no son señales y no se marcan. Un tema puede cambiar esos colores con `editor.semanticTokenColorCustomizations` sobre los modificadores `signal`, `computed`, `resource`, `reactive` y `modification`.
- **Hovers.** Sobre una señal, un `computed` o un recurso: su tipo, dónde se lee y se escribe y cómo llega su valor al navegador. Sobre un componente: sus props, eventos, modelos, snippets y valor expuesto; en un componente genérico, con los parámetros de tipo que infiere la etiqueta (`T = User`). Sobre el ID de `href(...)`, un endpoint de `useApi`/`api.*` o un procedimiento de `useRpcQuery`/`useRpcMutation`/`rpc.*`: la página o el handler y su contrato.
- **Ir a definición** desde `href`, `useApi`, `api.*`, `useRpcQuery` y `rpc.*` hasta la página o el handler, y desde un export de `<script server>` usado en la página hasta su `export`.
- **CodeLens.** Sobre cada señal, `computed` o recurso, el número de lecturas y escrituras y si la plantilla lo usa; al pulsarlo se listan. En la primera línea de una página, su ruta, modo de render y layouts, y el tipo de los datos que envía su loader, con un aviso si no se pueden serializar.
- **Zonas de ejecución.** Una barra en el margen y un color de línea tenue indican qué líneas se ejecutan sólo en el servidor (`<script server>`), en el servidor y el navegador (el setup) o sólo en el navegador: tras el primer `await` de navegador, dentro de `onMounted`, en las funciones del setup que sólo se usan desde `on:*`, `onMounted` u otro código de navegador, y en las flechas de varias líneas de un `on:*` de la plantilla. Una función que también se usa en el setup, en `effect` o `computed`, en una expresión de la plantilla o en `defineExpose` sigue en la zona compartida. El hover sobre la primera línea de una zona explica el motivo, por ejemplo «Sólo se usa como manejador de `on:click`».
- **Componentes genéricos.** La gramática resalta el atributo `generic` del `<script>` como una lista de parámetros de tipo de TypeScript.
- **Acciones rápidas.** Añadir `each:key` a una lista y mover el sidecar `x.route.ts` de una página a un bloque `<script server>`.
- **Valores en vivo** de las señales mientras corre `meeko dev` (véase la sección siguiente).

## Valores en vivo

Con `meeko dev` en marcha y la página abierta en el navegador, la extensión muestra el valor actual de cada señal al final de la línea donde se declara (`count = 3`), lo resalta un instante cuando cambia y añade al hover el valor completo de cada instancia montada. Si el componente está montado varias veces, la línea indica cuántas instancias hay.

- **Editar.** El enlace de edición del hover, o el comando de edición del valor (`meeko.live.editSignal`) con el cursor sobre la señal, pide un nuevo valor en JSON y lo asigna en el navegador, como el editor de señales de DevTools. Con varias instancias, se elige cuál. Un valor recortado por su tamaño se muestra marcado y el cuadro de edición empieza vacío.
- **Barra de estado.** Un indicador **Meeko live** muestra si hay conexión con `meeko dev`; al pulsarlo, o con el comando de reconexión (`meeko.live.reconnect`), se vuelve a conectar. Sólo aparece cuando hay un servidor de desarrollo o un `.meeko` activo.
- **Modelos compartidos.** Una señal que es la misma que otra, como el modelo que un hijo recibe con `defineModel`, se muestra con su señal principal (`open = true (= dialogOpen)`), su hover dice «alias de `dialogOpen`» con su archivo y línea, y editarla edita la principal.
- **Conexión.** Cada `meeko dev` escribe su descriptor `.meeko/dev/editor-bridge-<puerto>.json`; la extensión se conecta a todos los que encuentra, con el token de cada sesión, así que funcionan varios `meeko dev` a la vez. Sólo acepta direcciones de loopback y se reconecta sola cuando `meeko dev` se reinicia. Al conectarse espera un instante el estado de las pestañas abiertas, de modo que los valores aparecen sin recargar la página.
- **Confianza.** Sólo funciona en workspaces de confianza.

`meeko dev` no publica valores si se arranca con `MEEKO_EDITOR_BRIDGE=0` o si escucha en una dirección que no es de loopback. El protocolo y sus reglas de seguridad se describen en [docs/devtools.md](https://github.com/meekojs/meeko/blob/main/docs/devtools.md#puente-del-editor).

## Primeros pasos

1. Instala **Meeko Language** en Visual Studio Code 1.140.0 o posterior.
2. Abre tu proyecto Meeko y un archivo con extensión `.meeko`.
3. Usa completado, hover, ir a definición, referencias, renombrado y **Format Document** desde el editor.

Consulta el panel **Problemas** para ver los diagnósticos de compilación y TypeScript. En un workspace de confianza, al abrir o guardar una página, un layout o su sidecar, el servidor comprueba los contratos de props del proyecto y señala los errores `MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS` y `MEEK_ERROR_PROPS` sobre el tipo de `defineProps` en el `.meeko`. Esta comprobación usa los archivos guardados y no se ejecuta por cada pulsación.

Al guardar un módulo TypeScript del mismo proyecto, el servidor vuelve a comprobar los componentes `.meeko` abiertos, actualiza sus tokens semánticos y recalcula los contratos de páginas y layouts abiertos.

## Qué servidor se usa

- Si el workspace es de confianza y el proyecto tiene `@meekojs/meeko` con el bin `meeko-language-server` en `node_modules` (se busca desde cada carpeta del workspace hacia arriba), la extensión arranca **ese** servidor. Así el editor usa la misma versión que el compilador del proyecto.
- Si no existe, es una versión anterior sin servidor de lenguaje, el ajuste `meeko.languageServer.preferWorkspace` está desactivado o el workspace no es de confianza, usa el **servidor incluido** en la extensión.

El canal de salida **Meeko** indica al arrancar qué servidor se eligió, su versión y el motivo de la elección, y registra los fallos internos del servidor.

## Modo restringido

En un workspace no confiable la extensión nunca ejecuta código del proyecto: usa el servidor incluido, lee `meeko.config.*` de forma estática (sólo listas literales) y no comprueba contratos de páginas. Al conceder la confianza, el servidor se reinicia y pasa a ejecutar la configuración del proyecto, de modo que las listas de `extends`, `modules` e `imports.serverDirs` pueden construirse dinámicamente.

## Ajustes

| Ajuste | Por defecto | Descripción |
| --- | --- | --- |
| `meeko.languageServer.preferWorkspace` | `true` | Usa el servidor de `@meekojs/meeko` del proyecto cuando existe. Se ignora en modo restringido. |
| `meeko.format.indentSections` | `false` | Al formatear, indenta un nivel el contenido de cada sección (`<script>`, `<script server>`, `<template>` y `<style>`), como `vueIndentScriptAndStyle` de Prettier más la plantilla. El contenido de `<pre>` y `<textarea>` no cambia. Con `false`, el formato quita esa indentación base. |
| `meeko.editor.executionZones` | `true` | Muestra las zonas de ejecución: una barra en el margen y un color de línea tenue para el código que se ejecuta sólo en el servidor, en ambos lados o sólo en el navegador. |
| `meeko.live.enabled` | `true` | Conecta con `meeko dev` para mostrar y editar los valores en vivo de las señales. Sólo en workspaces de confianza y con un servidor de desarrollo en loopback. |
| `meeko.live.inlineValues` | `true` | Muestra el valor en vivo al final de la línea de cada señal. Con `false`, el valor sigue en el hover. |
| `meeko.trace.server` | `off` | Registra la comunicación con el servidor (`messages` o `verbose`) en el canal **Meeko**. |

Cambiar un ajuste `meeko.languageServer.*` reinicia el servidor. Los ajustes `meeko.format.*` se leen en cada formateo y no requieren reinicio.

Los colores de las zonas se pueden cambiar en `workbench.colorCustomizations`:

| Color | Por defecto |
| --- | --- |
| `meeko.executionZone.serverBackground` | Violeta tenue en los temas claros y oscuros. |
| `meeko.executionZone.sharedBackground` | Transparente: el setup compartido no se colorea. |
| `meeko.executionZone.browserBackground` | Turquesa tenue en los temas claros y oscuros. |

En los temas de alto contraste los tres son transparentes y sólo queda la barra del margen.

La extensión incluye TypeScript 6 (servicio de lenguaje) y el ejecutable nativo de TypeScript 7 (diagnósticos) para su plataforma. Para crear y ejecutar una aplicación, consulta el [repositorio de Meeko](https://github.com/meekojs/meeko). Puedes reportar problemas en [GitHub Issues](https://github.com/meekojs/meeko/issues).

Se distribuyen paquetes para Windows, Linux y macOS, en arquitecturas x64 y ARM64. No se admite VS Code para web ni Alpine Linux.

El icono del lenguaje `.meeko` aparece cuando el tema de iconos activo admite ese mecanismo y no define otro icono para `.meeko`; algunos temas pueden reemplazarlo.

## Probar en desarrollo

Desde `packages/vscode` en el repositorio (`pnpm install` instala todo el workspace):

```powershell
pnpm install
pnpm run check
pnpm run test
pnpm run build
code --new-window --extensionDevelopmentPath="$(Get-Location)" "$(Resolve-Path ../..)"
```

`pnpm run build` genera el cliente (`dist/extension.js`) y el servidor incluido (`dist/server.js`, compilado desde `packages/meeko/src/language-server/` del repositorio). Abre un `.meeko` y consulta el panel **Problemas** para errores `MEEK` o `TS`. El servidor analiza los cambios después de una pausa de 300 ms. La salida **Meeko** registra qué servidor se usa y sus fallos internos. `meeko check <archivo.meeko> --json` permite contrastar los diagnósticos desde una terminal.

## Desarrollo: paquetes por plataforma

```powershell
pnpm run package:vsix
pwsh -NoProfile -File package-vsix.ps1 -Target linux-x64
pwsh -NoProfile -File package-vsix.ps1 -Target darwin-arm64
pnpm run test:host:isolated
```

`package:vsix` genera un VSIX para el sistema y arquitectura del equipo. `-Target` también admite `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64` y `darwin-arm64`, de modo que se pueden preparar paquetes para otros equipos desde Windows. Cada archivo se guarda en `artifacts/meeko-language-<versión>-<target>.vsix`; el script local no publica ni instala nada. La publicación en Marketplace y Open VSX sólo ocurre al subir una etiqueta `vscode-v<versión>`, como explica [docs/releasing.md](https://github.com/meekojs/meeko/blob/main/docs/releasing.md). El script requiere PowerShell 7, aísla la instalación de TypeScript 6/7 y verifica que el VSIX contenga exactamente el ejecutable nativo de TypeScript 7 para su destino. [VS Code distribuye extensiones con binarios nativos por plataforma](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions).

`test:host:isolated` prueba el VSIX de la **plataforma anfitriona** en un VS Code real: extrae el paquete, instala Meeko en un proyecto consumidor temporal y comprueba que se usa el servidor de lenguaje del proyecto, diagnósticos con rango completo, contratos, navegación, hover, referencias, renombrado, completado, ayuda de firma, símbolos, plegado, tokens semánticos y formato al guardar. En Windows busca la instalación habitual de VS Code; en macOS y Linux intenta encontrar `code` en `PATH`. Si no lo encuentra, `@vscode/test-electron` descarga la versión estable en una carpeta temporal. Puedes indicar otra instalación con `pwsh -NoProfile -File tests/prepare-host.ps1 -VSCodeExecutable <ruta>`. La matriz de CI ejecuta esta prueba en Windows, Linux y macOS (con `xvfb-run` en Linux). No se generan VSIX para Alpine ni para web, que necesitarían soporte adicional del ejecutable TypeScript 7 y del host de extensión.

## Alcance actual

- El renombrado se inicia desde un `.meeko` y reescribe la declaración y todos sus usos e imports en archivos `.meeko` y `.ts` del proyecto. Las referencias pedidas desde un `.ts` las resuelve el servicio TypeScript de VS Code, que no conoce los `.meeko`.
- Se usa el `tsconfig.json` de la raíz del paquete (la carpeta con `package.json`); los tsconfig anidados no se tienen en cuenta.
- El modelo virtual requiere que las secciones estén sintácticamente cerradas. Mientras se escribe un archivo incompleto, los diagnósticos siguen disponibles, pero las funciones semánticas pueden pausarse hasta que vuelva a ser válido.
- El formato usa Prettier con el plugin de Meeko, en memoria: el del proyecto con su configuración si existe y el workspace es de confianza, o el incluido en la extensión. Sólo formatea el documento completo y no formatea un archivo que no compila (véase [docs/editors.md](../../docs/editors.md#formato-con-prettier)).
- Generar un VSIX cruzado confirma su contenido, pero no sustituye la prueba del host de destino. La matriz de CI comprueba la extensión en Windows, Linux y macOS.
