# Extensión de VS Code para Meeko

La extensión reconoce archivos `.meeko`, resalta las secciones TypeScript, HTML y CSS y conecta VS Code con el **servidor de lenguaje de Meeko** (`meeko-language-server`). Toda la lógica del lenguaje vive en ese servidor, que es el mismo que usan Neovim, Zed, Helix, JetBrains o Sublime Text ([guía de editores](https://github.com/meekojs/meeko/blob/main/docs/editors.md)); la extensión sólo lo arranca y le pasa el estado de confianza del workspace.

El servidor publica los mismos diagnósticos de compilación y tipos que `meeko check`, con el rango completo del token afectado. El análisis semántico usa un archivo TypeScript virtual por componente dentro de un único servicio por proyecto, configurado con el `tsconfig.json` de la raíz del paquete: las referencias del `<script>` y las expresiones del `<template>` comparten completado, hover, ir a definición, referencias, renombrado, ayuda de firma y color semántico, también entre archivos `.meeko` y `.ts`. Además ofrece símbolos del documento, plegado, formato de las tres secciones y acciones rápidas (añadir imports, resolver autoimports ambiguos, quitar `params` sobrantes de un `href` estático, añadir `each:key` y mover un sidecar a `<script server>`).

Las páginas pueden declarar su código de servidor y sus opciones de ruta en un bloque `<script server lang="ts">` en lugar de un sidecar `.route.ts`. El editor lo trata como un módulo TypeScript propio, con los autoimports de servidor (o los de cliente si su `render` estático es `"client"`): diagnósticos de tipos en su posición del `.meeko`, completado, hover, ir a definición, referencias, símbolos y formato. Un bloque fuera de `app/pages`, o en un `+layout` o `+error`, se marca con `MEEK044` sobre su etiqueta de apertura; `<script server="...">` se marca con `MEEK043`.

`defineProps<Props>({ count: 0 })` ofrece defaults tipados en el editor: la prop puede omitirse al usar el componente y se reconoce como definida dentro de su script y plantilla. El compilador y el modelo semántico del editor comparten el análisis AST de esas claves.

## Fragmentos de código

Escribe un prefijo y elige el fragmento en el completado. `Tab` recorre los campos editables y mantiene sincronizados los nombres repetidos. Los esqueletos usan el nombre del archivo como título inicial.

| Prefijo          | Dónde                                | Contenido                                                                  |
| ---------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `meeko`, `mcomp` | Raíz de un `.meeko`                  | Componente con `<script lang="ts">` y `<template>`                         |
| `mpage`          | Raíz de una página `.meeko`          | `definePage` en `<script server>` y plantilla                              |
| `mlayout`        | Raíz de un layout `.meeko`           | Layout con `<MeekoOutlet />`                                               |
| `mprops`         | `<script>`                           | Interfaz `Props` y `defineProps<Props>()`                                  |
| `mpropsd`        | `<script>`                           | Props desestructuradas con defaults reactivos, desde Meeko 1.8             |
| `memits`         | `<script>`                           | `defineEmits` con argumentos tipados                                       |
| `mmodel`         | `<script>`                           | `defineModel` con valor por defecto                                        |
| `msnippets`      | `<script>`                           | Contrato `defineSnippets`                                                  |
| `mexpose`        | `<script>`                           | `defineExpose` de un valor del setup                                       |
| `msignal`        | `<script>`                           | Señal con `signal`                                                         |
| `mcomputed`      | `<script>`                           | Valor derivado con `computed`                                              |
| `meffect`        | `<script>`                           | Efecto reactivo con `effect`                                               |
| `mmounted`       | `<script>`                           | Temporizador de navegador con `onCleanup` dentro de `onMounted`            |
| `mref`           | `<script>`                           | `useElementRef` y comentario con el `ref:` que debes añadir a la plantilla |
| `mif`            | `<template>`                         | Elemento con `if:when`                                                     |
| `meach`          | `<template>`                         | Lista con `each:of`, `each:as` y `each:key`                                |
| `mrender`        | `<template>`                         | `<render>` con `snippet` y `args`                                          |
| `msnippet`       | Dentro de una etiqueta de componente | `<snippet>` con `name` y `params`                                          |
| `mis`            | `<template>`                         | `<component is>` dinámico                                                  |
| `mform`          | Raíz de un `.meeko`                  | Componente con `useForm` y formulario enlazado                             |
| `mapi`           | `server/api/*.get.ts`                | `defineApiRoute` con una respuesta JSON                                    |
| `mrpc`           | `server/rpc/*.ts`                    | `defineRpc` con imports de schemas de `shared/`                            |
| `mmiddleware`    | `app/middleware/*.server.ts`         | `defineServerRouteMiddleware` con nombre                                   |
| `mcomposable`    | Composable `.ts`                     | `AbortController` con liberación mediante `onCleanup`                      |

Los fragmentos de script y plantilla se insertan en el bloque indicado: ajusta los nombres a los valores del componente y reúne los imports si ya existen. `mmounted` registra la limpieza dentro del callback para respetar `MEEK128`. Llama al composable de `mcomposable` durante el setup de un componente. En `mrpc`, crea o reutiliza los schemas reales en `shared/`, ajusta la ruta relativa a la profundidad del archivo y adapta el handler al schema de salida. `mmiddleware` crea middleware con nombre (`global: false`): decláralo en `middleware` de la página o del grupo para ejecutarlo.

VS Code elige los fragmentos declarados en [`contributes.snippets`](https://code.visualstudio.com/api/references/contribution-points#contributes.snippets) por el lenguaje en la posición del cursor, y dentro de un bloque ese lenguaje es `typescript` o `html`, no `meeko`. Por eso la extensión sólo declara los esqueletos. Los de script y plantilla los ofrece su proveedor de completado en `<script>`, en `<script server>` y en el contenido de `<template>`, y no en `<style>`, en comentarios, en cadenas, en valores de atributo ni en expresiones `{…}`. De ahí salen tres límites:

- **Insert Snippet** lista lo declarado para el lenguaje del cursor: los esqueletos en la raíz y lo declarado para `typescript` en `<script>`. Los fragmentos de script y plantilla no aparecen ahí: se eligen en el completado.
- Con `"editor.tabCompletion": "on"`, `Tab` también los expande. Con `"onlySnippets"`, sólo expande los declarados, así que dentro de un bloque no los expande.
- Un fragmento tuyo declarado para `meeko` sale en la raíz. Para usarlo en `<script>`, decláralo para `typescript`.

La declaración sólo selecciona el lenguaje y el archivo de fragmentos; no admite una condición por proyecto ni por archivo. Por eso los cuatro fragmentos TypeScript aparecen también fuera de proyectos Meeko mientras la extensión está habilitada, y dentro de los bloques TypeScript de un `.meeko`, comentarios y cadenas incluidos. Sus prefijos específicos (`mapi`, `mrpc`, `mmiddleware`, `mcomposable`) reducen las coincidencias accidentales.

## Funciones de Meeko

El servidor de lenguaje entiende la reactividad, los componentes y la estructura de la aplicación (detalles en la [guía de editores](https://github.com/meekojs/meeko/blob/main/docs/editors.md#funciones-propias-de-meeko)):

- **Color de la reactividad.** Las señales, los `computed` y los recursos de datos (`useApi`, `useRpcQuery`, `useRpcMutation`) tienen colores propios en el script y la plantilla, las escrituras de `.value` se distinguen de las lecturas y las expresiones de la plantilla que leen un valor reactivo se marcan. Lo decide el tipo, no el nombre: `props.value` o `input.value` no son señales y no se marcan. Un tema puede cambiar esos colores con `editor.semanticTokenColorCustomizations` sobre los modificadores `signal`, `computed`, `resource`, `reactive` y `modification`.
- **Hovers.** Sobre una señal, un `computed` o un recurso: su tipo, dónde se lee y se escribe y cómo llega su valor al navegador. Sobre un componente: sus props, eventos, modelos, snippets y valor expuesto; en un componente genérico, con los parámetros de tipo que infiere la etiqueta (`T = User`). Sobre el ID de `href(...)`, un endpoint de `useApi`/`api.*` o un procedimiento de `useRpcQuery`/`useRpcMutation`/`rpc.*`: la página o el handler y su contrato.
- **Ir a definición** desde `href`, `useApi`, `api.*`, `useRpcQuery` y `rpc.*` hasta la página o el handler, y desde un export de `<script server>` usado en la página hasta su `export`.
- **CodeLens.** Sobre cada señal, `computed` o recurso, el número de lecturas y escrituras y si la plantilla lo usa; al pulsarlo se listan. En la primera línea de una página, su ruta, modo de render y layouts, y el tipo de los datos que envía su loader, con un aviso si no se pueden serializar.
- **Zonas de ejecución.** Una barra en el margen y un color de línea tenue indican qué líneas se ejecutan sólo en el servidor (`<script server>`), en el servidor y el navegador (el setup) o sólo en el navegador: tras el primer `await` de navegador, dentro de `onMounted`, en las funciones del setup que sólo se usan desde `on:*`, `onMounted` u otro código de navegador, y en las flechas de varias líneas de un `on:*` de la plantilla. Una función que también se usa en el setup, en `effect` o `computed`, en una expresión de la plantilla o en `defineExpose` sigue en la zona compartida. El hover sobre la primera línea de una zona explica el motivo, por ejemplo «Sólo se usa como manejador de `on:click`».
- **Clases CSS.** En `class="…"` y en las cadenas de `bind:class` se completan las clases del `<style>` del componente, de los `<style>` sin `scoped` de los demás componentes y de `app/styles/main.css` con sus `@import` locales, más las que genera `meeko dev` en `.meeko/styles/main.css` (los plugins de PostCSS y de Vite, como Tailwind). Cada sugerencia indica su origen y muestra la regla; el hover y la definición también funcionan sobre las clases. Sólo lee CSS, así que funciona también en modo restringido. No hace falta la extensión HTML CSS Support.
- **Variables CSS.** Completa propiedades `--nombre` y referencias `var(--nombre)` en `<style>`, `style="…"` y cadenas de `bind:style`, con el valor declarado y su origen. El hover muestra sus declaraciones, incluidos temas y registros `@property`; ir a definición abre el CSS original cuando está disponible y usa la hoja procesada como respaldo. Comparte las fuentes y la caché de las clases, respeta los estilos `scoped` de otros componentes y sigue cambios sin guardar y CSS importado. No deduce el valor efectivo de la cascada ni marca una variable desconocida como error. Funciona sin ejecutar configuración ni plugins de CSS en workspaces restringidos.
- **Diagnósticos de dónde se usa cada API.** `MEEK108` marca una API de servidor en el `<script>` o la plantilla (o una macro del componente en `<script server>`), `MEEK109` avisa de `definePage` o de un import de servidor que ahí no tiene efecto, y `MEEK107` avisa de un `html="..."` sin `trustHtml`. El completado del `<script>` y de la plantilla no ofrece APIs de servidor.
- **Componentes genéricos.** La gramática resalta el atributo `generic` del `<script>` como una lista de parámetros de tipo de TypeScript.
- **Acciones rápidas.** Añadir `each:key` a una lista y mover el sidecar `x.route.ts` de una página a un bloque `<script server>`.
- **Valores en vivo** de las señales mientras corre `meeko dev` (véase la sección siguiente).

## Valores en vivo

Con `meeko dev` en marcha y la página abierta en el navegador, la extensión muestra el valor actual de cada señal al final de la línea donde se declara (`count = 3`), lo resalta un instante cuando cambia y añade al hover el valor completo de cada instancia montada. Si el componente está montado varias veces, la línea indica cuántas instancias hay.

- **Editar.** El enlace de edición del hover, o el comando de edición del valor (`meeko.live.editSignal`) con el cursor sobre la señal, pide un nuevo valor en JSON y lo asigna en el navegador, como el editor de señales de DevTools. Con varias instancias, se elige cuál. Un valor recortado por su tamaño se muestra marcado y el cuadro de edición empieza vacío.
- **Barra de estado.** Un indicador **Meeko live** muestra si hay conexión con `meeko dev`; al pulsarlo, o con el comando de reconexión (`meeko.live.reconnect`), se vuelve a conectar. Sólo aparece cuando hay un servidor de desarrollo o un `.meeko` activo.
- **Modelos compartidos.** Una señal que es la misma que otra, como el modelo que un hijo recibe con `defineModel`, se muestra con su señal principal (`open = true (= dialogOpen)`), su hover dice «alias de `dialogOpen`» con su archivo y línea, y editarla edita la principal.
- **Conexión.** Cada `meeko dev` escribe su descriptor `.meeko/dev/editor-bridge-<puerto>.json`; la extensión se conecta a todos los que encuentra, con el token de cada sesión, así que funcionan varios `meeko dev` a la vez. Sólo acepta direcciones de loopback y se reconecta sola cuando `meeko dev` se reinicia. Al conectarse espera un instante el estado de las pestañas abiertas, de modo que los valores aparecen sin recargar la página.
- **Varias carpetas.** Al añadir o quitar carpetas del workspace, la extensión descubre los servidores nuevos y cierra las conexiones de las carpetas retiradas.
- **Confianza.** Sólo funciona en workspaces de confianza.

`meeko dev` no publica valores si se arranca con `MEEKO_EDITOR_BRIDGE=0` o si escucha en una dirección que no es de loopback. Con Meeko 1.7.1 o posterior, mientras ese `meeko dev` sigue en marcha, el indicador muestra **Meeko live: desactivado en meeko dev**, con el motivo y cómo activarlo en el tooltip (por ejemplo, quitar `MEEKO_EDITOR_BRIDGE=0` del `.env` y reiniciar `meeko dev`). El protocolo y sus reglas de seguridad se describen en [docs/devtools.md](https://github.com/meekojs/meeko/blob/main/docs/devtools.md#puente-del-editor).

## Primeros pasos

1. Instala **Meeko Language** en Visual Studio Code 1.144.0 o posterior.
2. Abre tu proyecto Meeko y un archivo con extensión `.meeko`.
3. Usa completado, hover, ir a definición, referencias, renombrado y **Format Document** desde el editor.

Los comandos, los ajustes, los avisos y los indicadores de la extensión están en inglés y en español: VS Code usa el español cuando es su idioma de presentación (**Configure Display Language**) y el inglés en los demás. Los diagnósticos, los hovers y las zonas que publica el servidor de lenguaje, y las descripciones de los fragmentos, están sólo en español.

Consulta el panel **Problemas** para ver los diagnósticos de compilación y TypeScript. En un workspace de confianza, al abrir o guardar una página, un layout o su sidecar, el servidor comprueba los contratos de props del proyecto y señala los errores `MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS` y `MEEK_ERROR_PROPS` sobre el tipo de `defineProps` en el `.meeko`. Esta comprobación usa los archivos guardados y no se ejecuta por cada pulsación.

Al guardar un módulo TypeScript del mismo proyecto, el servidor vuelve a comprobar los componentes `.meeko` abiertos, actualiza sus tokens semánticos y recalcula los contratos de páginas y layouts abiertos.

## Qué servidor se usa

- Si el workspace es de confianza y el proyecto tiene `@meekojs/meeko` con el bin `meeko-language-server` en `node_modules` (se busca desde cada carpeta del workspace hacia arriba), la extensión arranca **ese** servidor. Así el editor usa la misma versión que el compilador del proyecto.
- Si no existe, es una versión anterior sin servidor de lenguaje, el ajuste `meeko.languageServer.preferWorkspace` está desactivado o el workspace no es de confianza, usa el **servidor incluido** en la extensión.
- En un workspace con varias carpetas, cada una elige su propio servidor; al cambiar carpetas, confianza o `meeko.languageServer.preferWorkspace`, la extensión vuelve a seleccionar y arrancar los servidores.

El canal de salida **Meeko** indica al arrancar qué servidor se eligió, su versión y el motivo de la elección, y registra los fallos internos del servidor.

## Workspaces virtuales

En documentos `.meeko` de un proveedor virtual, el servidor incluido analiza el archivo abierto y ofrece completado, hover, símbolos y diagnósticos mientras se edita. Cada documento se analiza de forma aislada: la navegación, las referencias y la comprobación de contratos entre archivos requieren un proyecto en disco y no están disponibles allí. Meeko live también requiere un proyecto local.

## Modo restringido

En un workspace no confiable la extensión nunca ejecuta código del proyecto: usa el servidor incluido, lee `meeko.config.*` de forma estática (sólo listas literales) y no comprueba contratos de páginas. Al conceder la confianza, el servidor se reinicia y pasa a ejecutar la configuración del proyecto, de modo que las listas de `layers`, `extends`, `modules`, `imports.appDirs`, `imports.sharedDirs` e `imports.serverDirs` pueden construirse dinámicamente.

## Ajustes

| Ajuste                                 | Por defecto | Descripción                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meeko.languageServer.preferWorkspace` | `true`      | Usa el servidor de `@meekojs/meeko` del proyecto cuando existe. Se ignora en modo restringido.                                                                                                                                                                                            |
| `meeko.languageServer.warmup`          | `true`      | Prepara al iniciar el programa TypeScript de los proyectos de las pestañas `.meeko` abiertas, para que el primer componente tenga colores y hover sin esperar. Desactívalo para ahorrar memoria.                                                                                          |
| `meeko.format.indentSections`          | `false`     | Al formatear, indenta un nivel el contenido de cada sección (`<script>`, `<script server>`, `<template>` y `<style>`), como `vueIndentScriptAndStyle` de Prettier más la plantilla. El contenido de `<pre>` y `<textarea>` no cambia. Con `false`, el formato quita esa indentación base. |
| `meeko.editor.executionZones`          | `true`      | Muestra las zonas de ejecución: una barra en el margen y un color de línea tenue para el código que se ejecuta sólo en el servidor, en ambos lados o sólo en el navegador.                                                                                                                |
| `meeko.live.enabled`                   | `true`      | Conecta con `meeko dev` para mostrar y editar los valores en vivo de las señales. Sólo en workspaces de confianza y con un servidor de desarrollo en loopback.                                                                                                                            |
| `meeko.live.inlineValues`              | `true`      | Muestra el valor en vivo al final de la línea de cada señal. Con `false`, el valor sigue en el hover.                                                                                                                                                                                     |
| `meeko.trace.server`                   | `off`       | Activa el trace de cada servidor (`messages` o `verbose`). Para ver los mensajes, cambia el nivel del canal **Meeko** a **Trace**.                                                                                                                                                        |

Si usas Fira Code y has activado `editor.bracketPairColorization.enabled: true` explícitamente, VS Code puede colorear por separado el `>` de `=>` dentro del TypeScript de un `.meeko` y romper la ligadura. La preferencia global prevalece sobre el valor predeterminado de la extensión. Añade esta excepción a tus ajustes de VS Code:

```json
"[meeko]": {
  "editor.bracketPairColorization.enabled": false
}
```

Esto quita los colores de pares de corchetes sólo en `.meeko`; el emparejamiento y la edición vinculada de etiquetas siguen disponibles.

Cambiar un ajuste `meeko.languageServer.*` reinicia el servidor. Los ajustes `meeko.format.*` se leen en cada formateo y no requieren reinicio.

Los colores de las zonas se pueden cambiar en `workbench.colorCustomizations`:

| Color                                   | Por defecto                                      |
| --------------------------------------- | ------------------------------------------------ |
| `meeko.executionZone.serverBackground`  | Violeta tenue en los temas claros y oscuros.     |
| `meeko.executionZone.sharedBackground`  | Transparente: el setup compartido no se colorea. |
| `meeko.executionZone.browserBackground` | Turquesa tenue en los temas claros y oscuros.    |

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

Para compilar, empaquetar e instalar la extensión en el VS Code local, desde la raíz del repositorio:

```powershell
pnpm run vscode:install
```

También puedes ejecutar `pnpm run install:local` desde `packages/vscode`, o `node packages/vscode/install-local.mjs` desde la raíz. El script detecta la plataforma y versión, comprueba tipos, construye el VSIX y lo instala con `code --install-extension --force`, también si ya está instalada esa versión. Si `code` no está en el `PATH`, como en una terminal de WSL fuera de VS Code, usa el `code-server` más reciente de `~/.vscode-server`, que instala en el servidor remoto. Después ejecuta **Developer: Reload Window** en VS Code.

Para reinstalar el último VSIX sin compilar: `pnpm run install:local -- --use-existing-vsix` desde `packages/vscode`. Esta opción reutiliza el artefacto existente; no incorpora nuevos cambios de fuente. Si el CLI tiene otro nombre o ruta, usa `--code`, por ejemplo `node install-local.mjs --code code-insiders`; `--target` instala el VSIX de otra plataforma.

El empaquetado usa VSCE `4.1.0`. El instalador suprime exclusivamente el aviso `DEP0169` durante la ejecución del CLI de VS Code. Es una solución temporal al uso de `url.parse()` dentro de VS Code ([incidencia abierta](https://github.com/microsoft/vscode/issues/319867)), no un cambio en esa API. Para ver también ese aviso durante una investigación, ejecuta el script con `--show-cli-deprecations`.

```sh
pnpm run package:vsix
node package-vsix.mjs --target linux-x64
node package-vsix.mjs --target darwin-arm64
pnpm run test:host:isolated
```

`package:vsix` genera un VSIX para el sistema y arquitectura del equipo. `--target` también admite `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64` y `darwin-arm64`, de modo que se pueden preparar paquetes para otros equipos desde cualquier sistema. Cada archivo se guarda en `artifacts/meeko-language-<versión>-<target>.vsix`; el script local no publica ni instala nada. La publicación en Marketplace y Open VSX sólo ocurre al subir una etiqueta `vscode-v<versión>`, como explica [docs/releasing.md](https://github.com/meekojs/meeko/blob/main/docs/releasing.md). El script sólo requiere Node; `package-vsix.ps1` e `install-local.ps1` se mantienen como envoltorios con los parámetros anteriores. Resuelve las versiones `catalog:` de pnpm, aísla la instalación de TypeScript 6/7 y verifica que el VSIX contenga exactamente el ejecutable nativo de TypeScript 7 para su destino. [VS Code distribuye extensiones con binarios nativos por plataforma](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions).

`test:host:isolated` prueba el VSIX de la **plataforma anfitriona** en un VS Code real: extrae el paquete, instala Meeko en un proyecto consumidor temporal y comprueba que se usa el servidor de lenguaje del proyecto, diagnósticos con rango completo, contratos, navegación, hover, referencias, renombrado, completado, ayuda de firma, símbolos, plegado, tokens semánticos y formato al guardar. En Windows busca la instalación habitual de VS Code; en macOS y Linux intenta encontrar `code` en `PATH`. Si no lo encuentra, `@vscode/test-electron` descarga la versión estable en una carpeta temporal. Puedes indicar otra instalación con `pwsh -NoProfile -File tests/prepare-host.ps1 -VSCodeExecutable <ruta>`. La matriz de CI ejecuta esta prueba en Windows, Linux y macOS (con `xvfb-run` en Linux). No se generan VSIX para Alpine ni para web, que necesitarían soporte adicional del ejecutable TypeScript 7 y del host de extensión.

## Alcance actual

- El renombrado se inicia desde un `.meeko` y reescribe la declaración y todos sus usos e imports en archivos `.meeko` y `.ts` del proyecto. Las referencias pedidas desde un `.ts` las resuelve el servicio TypeScript de VS Code, que no conoce los `.meeko`.
- Se usa el `tsconfig.json` de la raíz del paquete (la carpeta con `package.json`); los tsconfig anidados no se tienen en cuenta.
- El modelo virtual requiere que las secciones estén sintácticamente cerradas. Mientras se escribe un archivo incompleto, los diagnósticos siguen disponibles, pero las funciones semánticas pueden pausarse hasta que vuelva a ser válido.
- El formato usa Prettier con el plugin de Meeko, en memoria: el del proyecto con su configuración si existe y el workspace es de confianza, o el incluido en la extensión. Normaliza los `class="…"` estáticos, mantiene expandidos los arrays con un salto tras `[` (`meekoPreserveArrayBreaks`) y, si la configuración de Prettier del proyecto lo pide, ordena las clases (`meekoSortClasses`); el orden por la hoja global usa el Vite del proyecto, porque la extensión no lo incluye, y no se aplica en modo restringido. Sólo formatea el documento completo y no formatea un archivo que no compila (véase [docs/editors.md](../../docs/editors.md#formato-con-prettier)).
- Generar un VSIX cruzado confirma su contenido, pero no sustituye la prueba del host de destino. La matriz de CI comprueba la extensión en Windows, Linux y macOS.

## Variables CSS y controles independientes

Meeko ofrece completado, hover, «Ir a definición», búsqueda de referencias y renombrado de variables CSS en `<style>` y estilos inline de `.meeko`, y en archivos `.css` de paquetes con `meeko.config.*`. Atiende las hojas con el lenguaje `css` y con los que declaran los [proveedores de clases](#proveedores-de-clases) del proyecto, como `tailwindcss` con `@meekojs/ui`. Abrir sólo una hoja CSS activa la extensión en un workspace Meeko; el soporte CSS registra únicamente esas funciones de variables, sin hacerse cargo del formato ni de los diagnósticos de CSS.

Las fuentes son la hoja abierta, `app/styles/main.css`, sus imports locales y la hoja procesada `.meeko/styles/main.css` cuando existe. Los cambios sin guardar en hojas importadas se reflejan entre documentos y al cerrarlas vuelve a contar la versión guardada. El hover muestra el valor y su archivo; la definición prioriza las fuentes escritas frente al CSS generado. Las hojas CSS se leen sin ejecutar la configuración ni plugins del proyecto, también en workspaces no confiables. No se escanea todo el disco: los imports quedan dentro del paquete y tienen un límite de 64 archivos. Los componentes `.meeko` conservan además sus fuentes de estilos globales y las reglas de visibilidad de `scoped`.

| Ajuste                          | Predeterminado | Controla únicamente                   |
| ------------------------------- | -------------- | ------------------------------------- |
| `meeko.cssVariables.completion` | `true`         | Sugerencias de variables CSS          |
| `meeko.cssVariables.hover`      | `true`         | Hover de variables CSS                |
| `meeko.cssVariables.definition` | `true`         | Ir a definición de variables CSS      |
| `meeko.cssVariables.references` | `true`         | Buscar referencias de variables CSS   |
| `meeko.cssVariables.rename`     | `true`         | Renombrar variables CSS               |
| `meeko.classes.completion`      | `"auto"`       | Sugerencias de clases en `.meeko`     |
| `meeko.classes.hover`           | `"auto"`       | Hover de clases en `.meeko`           |
| `meeko.classes.definition`      | `true`         | Ir a definición de clases en `.meeko` |

Todos tienen ámbito de recurso y se actualizan sin reiniciar el servidor. Por ejemplo, `"meeko.classes.completion": "off"` conserva las variables y el hover de clases. Para mantener el comportamiento anterior, donde ese ajuste apagaba también el hover de clases, añade `"meeko.classes.hover": "off"`. Cada ajuste de variables afecta sólo a las sugerencias o información aportadas por Meeko: otros proveedores de VS Code o Tailwind pueden seguir aportando las suyas.

Otros clientes LSP pueden comunicar `meeko.cssVariables` mediante `workspace/configuration`, `initializationOptions.cssVariables` o una notificación de configuración con `settings.meeko.cssVariables`. Para hojas CSS necesitan sincronizar los documentos; el servidor registra dinámicamente los proveedores que el cliente admite. Las referencias y el renombrado leen las fuentes actuales de `app/`, los componentes raíz y los imports locales indexados del mismo paquete. Los buffers abiertos tienen prioridad. Se excluyen los artefactos generados, dependencias, carpetas ocultas y paquetes anidados; el recorrido se limita a 2000 archivos/directorios y 16 MiB. Si la cobertura es incompleta o no se puede analizar el CSS, las operaciones sobre variables compartidas informan de la limitación en lugar de devolver una edición parcial.

Las referencias incluyen declaraciones (cuando se solicitan), `@property`, `var(...)`, `--theme(...)`, consultas de estilo y nombres de propiedades personalizadas en `transition`, `transition-property` y `will-change`. También participan los estilos inline estáticos y las partes literales de `bind:style`. Se excluyen comentarios, contenido de cadenas y código JavaScript/TypeScript. Un nombre declarado de forma privada en `<style scoped>` o en estilos inline pertenece a ese componente para estas operaciones; `:global(...)`, `@property` y las declaraciones sin `scoped` son compartidas. Esto agrupa nombres por componente, sin intentar resolver la herencia del DOM entre elementos.

El renombrado exige un nombre completo como `--color-brand` y una declaración editable. Rechaza colisiones e identificadores escapados. VS Code recibe una edición del workspace, con versiones de los documentos abiertos, para aplicarla o deshacerla entre archivos; el servidor no escribe archivos. Un renombrado local de componente sigue disponible si otra hoja no relacionada está incompleta. No cambia las clases de utilidades derivadas de Tailwind, valores generados dinámicamente en scripts ni identificadores CSS fuera de los contextos soportados. Revisa esos usos de la aplicación cuando renombres un token de tema público.

## Tailwind CSS

Instala la extensión oficial **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`) y configura Tailwind en el proyecto. Esta extensión aporta las utilidades, variantes, valores y documentación de Tailwind; Meeko aporta el análisis de componentes y las clases CSS escritas en sus `<style>` y en `app/styles/main.css`, incluidos sus imports locales.

Meeko Language registra automáticamente `tailwindCSS.includeLanguages: { "meeko": "html" }` y activa `editor.quickSuggestions.strings` para `[meeko]`. Son valores predeterminados de VS Code: respetan tus ajustes explícitos y no escriben en `settings.json`. [VS Code documenta `configurationDefaults` para otras configuraciones registradas](https://code.visualstudio.com/api/references/contribution-points#contributes.configurationDefaults).

`meeko.classes.completion` y `meeko.classes.hover` controlan por separado sus funciones de clases de Meeko:

- `auto` (predeterminado): si el proyecto declara un [proveedor de clases](#proveedores-de-clases) y la extensión que lo atiende (como Tailwind CSS IntelliSense) está activa, le deja las clases que sólo tiene la hoja procesada `.meeko/styles/main.css`. Conserva las clases escritas en componentes y hojas fuente. Sin proveedor declarado, o con su extensión inactiva, Meeko las ofrece todas.
- `on`: incluye también las clases de la hoja procesada.
- `off`: desactiva sólo la función elegida. La definición se controla con `meeko.classes.definition`; las variables tienen sus propios ajustes.

Las cadenas de `bind:class="active.value ? 'bg-blue-500' : 'bg-gray-500'"` reciben sugerencias de clases; no hace falta añadir `bind:class` a `tailwindCSS.classAttributes`, porque el atributo `class` predeterminado reconoce el prefijo `:`. Meeko conserva además el análisis TypeScript de la expresión.

Para funciones como `clsx` y `cn` dentro del `<script>`, configura las funciones que realmente usa tu proyecto:

```json
{
	"tailwindCSS.classFunctions": ["clsx", "cn"]
}
```

### Proveedores de clases

Meeko no sabe de Tailwind ni de otra herramienta de CSS: quien la trae declara que genera clases y qué extensión de editor las atiende. `@meekojs/ui` declara Tailwind CSS (extensión `bradlc.vscode-tailwindcss`, lenguaje de hojas `tailwindcss`) con `meeko.addClassProvider`. Un proyecto que usa Tailwind sin `@meekojs/ui` lo declara en su configuración:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	css: { classProviders: [{ name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss'], languages: ['tailwindcss'] }] },
})
```

Hasta que lo declare, Meeko ofrece también las clases generadas, junto a las de Tailwind IntelliSense: el servidor ya no busca `tailwindcss` en el `package.json` ni en los `@import` de las hojas. En un workspace de confianza el servidor ejecuta la configuración y sus módulos, así que conoce la declaración sin `meeko dev`. En uno no confiable no ejecuta nada: lee `css.classProviders` cuando es un array literal y el manifiesto `.meeko/manifests/class-providers.json`, que `meeko dev` y `meeko check` escriben con lo que declaran los módulos. Las clases que se dejan al proveedor son las de `.meeko/styles/main.css`, que también escribe `meeko dev`. Meeko no clasifica individualmente esa hoja: en `auto`, con el proveedor activo, también deja sus clases de terceros que no tienen una definición fuente indexada.

La extensión pide al servidor los proveedores del proyecto de cada componente (`meeko/classProviders`) y le comunica cuáles de sus extensiones están activas. En otros clientes LSP, envía `meeko.classes` mediante `workspace/configuration` (o `initializationOptions.classes`) con `activeExtensions`, los ids de las extensiones activas entre las que nombran los proveedores; la petición `meeko/classProviders`, con `{ textDocument: { uri } }`, devuelve `{ providers: [{ name, vscode, languages }] }`. Un cliente que sólo envía `tailwindActive: true`, como los anteriores a 1.12, cuenta como si `bradlc.vscode-tailwindcss` estuviera activa; si el proyecto no declara ningún proveedor, el servidor respeta esa señal y deja igualmente las clases generadas.
