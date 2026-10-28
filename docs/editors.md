# Editores

Meeko incluye un servidor de lenguaje ([Language Server Protocol](https://microsoft.github.io/language-server-protocol/)) que da a cualquier editor compatible las mismas funciones que la [extensión de VS Code](../packages/vscode/README.md): diagnósticos de `meeko check`, completado (también de HTML en la plantilla y de CSS en `<style>`), hover, ir a definición, referencias, renombrado entre archivos `.meeko` y `.ts`, ayuda de firma, símbolos del documento, plegado, formato, tokens semánticos, CodeLens, edición vinculada de etiquetas, colores de `<style>` y acciones rápidas (añadir imports, resolver un autoimport ambiguo con un import explícito, quitar `params` de un `href` estático, añadir `each:key` y mover un sidecar a `<script server>`).

El bloque `<script server lang="ts">` de una página se analiza como un módulo TypeScript propio, con los autoimports de servidor (o de cliente si su `render` estático es `"client"`) y posiciones del `.meeko`: diagnósticos de tipos, completado, hover, navegación, referencias, símbolos y formato. Un bloque fuera de `app/pages` de alguna raíz configurada, o en un `+layout` o `+error`, produce `MEEK044` sobre su etiqueta de apertura. Los `export const` de un bloque con código de nivel superior tienen su tipo en el `<script>` y en la plantilla de la página, y «ir a definición» sobre uno de ellos lleva a su `export`.

## Funciones propias de Meeko

Además de las funciones de TypeScript, el servidor entiende la reactividad, los componentes (también los [genéricos](#componentes-genéricos)) y la estructura de la aplicación. Todas se calculan de forma estática, sin la aplicación en marcha; los textos que muestran no forman parte del contrato. La petición `meeko/executionZones` y los modificadores de token propios (`signal`, `computed`, `resource` y `reactive`) son internos de la extensión de VS Code y pueden cambiar en un minor (véase [stability.md](stability.md#fuera-del-contrato)).

### Tokens semánticos de reactividad

Los tipos de token son los de TypeScript. Sobre ellos, el servidor añade modificadores:

| Modificador | Marca |
| --- | --- |
| `signal` | Una señal (`signal`, `useState`, `defineModel`, `useElementRef`) declarada en el nivel superior del `<script>`, y cada uso. |
| `computed` | Un valor `computed` o una señal de sólo lectura, y cada uso. |
| `resource` | Un recurso de datos (`useApi`, `useRpcQuery`, `useRpcMutation`), y cada uso. |
| `reactive` | Los tokens de una expresión de la plantilla que lee un valor reactivo. |
| `modification` | Una escritura de `.value`, o una llamada que vuelve a cargar un recurso (`refresh`, `mutate`). Es el modificador estándar de LSP. |

Lo que decide si un `.value` es reactivo es el tipo, no el nombre: sólo cuenta el `value` de una `Signal` o `ReadonlySignal` de Meeko (incluidas las que devuelven `useElementRef` y los composables). `props.value`, `input.value` o `event.currentTarget.value` son lecturas normales y no se marcan.

Un tema o un cliente puede colorearlos con reglas de token semántico (por ejemplo, `variable.signal` o `*.modification`). La extensión de VS Code trae colores por defecto mediante ámbitos TextMate. Desde la `1.2` de la extensión, `reactive` no cambia el estilo por defecto (antes ponía en cursiva lo que leía un valor reactivo); para marcarlo, añada `"*.reactive": { "italic": true }` en `rules` de `editor.semanticTokenColorCustomizations`.

### Hover

Además del tipo de TypeScript, el hover añade:

- **Señales, `computed` y recursos.** Su tipo, la lista de lecturas y escrituras en el script y la plantilla, con enlaces a cada una, y cómo llega su valor al navegador: si se serializa en el estado del componente, si viaja en el payload, si se recalcula en el navegador o si sólo existe en el navegador.
- **Componentes.** Desde la `1.4`, la ficha es la firma de la etiqueta en un bloque TypeScript, con una línea por prop y su tipo declarado (`variant?: CardVariant`), por evento (`on:save(id: number)`) y por modelo (`model:open?: boolean`), y los snippets como contenido (`header?()`, `default()`); le siguen un enlace que abre el `.meeko` y el JSDoc de cada prop, evento, modelo y snippet que lo tenga. Las secciones vacías se omiten. Sobre una etiqueta de componente o el identificador que lo importa: el archivo `.meeko` y sus props, eventos, modelos, snippets y valor expuesto. En la etiqueta de un [componente genérico](api.md#componentes-genéricos-generic), el hover muestra los parámetros de tipo que infieren sus props (`T = User`) y las props, eventos, modelos, snippets y valor expuesto ya resueltos con ellos.
- **Snippets.** Sobre el `name` de un `<snippet>`: la firma del snippet del hijo, con los tipos de sus parámetros y si es opcional, y desde la `1.4` su JSDoc.
- **Etiquetas propias de Meeko.** Desde la `1.4`, `<MeekoLink>`, `<MeekoOutlet />` y `<MeekoThemeToggle>` tienen la misma ficha que un componente: sus props con los tipos de `MeekoLinkProps`, `MeekoOutletProps` y `MeekoThemeToggleProps` de `@meekojs/meeko/framework` (en `<MeekoLink to="/users/[id]">`, `to` es esa ruta y `bind:params` sus parámetros), su contenido (`default`), el elemento que renderizan, su documentación y un enlace a la guía. «Ir a definición» sobre la etiqueta abre ese tipo, y sobre el valor de `to`, la página. El hover y el completado de `to`, `bind:params` y `bind:search` usan los tipos y el JSDoc de `MeekoLinkProps`; `on:click` y los demás atributos son los de un `<a>`, y el completado ofrece los atributos de `<a>` salvo `href`. Con un `@meekojs/meeko` anterior a `1.4`, que no declara esos tipos, la ficha usa la descripción incluida en el servidor. Un componente del proyecto con uno de esos nombres conserva su propia ficha (`MEEK106`). Desde la `1.5`, `<MeekoAwait>` tiene la misma ficha (`MeekoAwaitProps`, con sus snippets `default(refreshing)`, `pending` y `error(error, retry)`), su `for` es una expresión con hover y definición, y dentro de su contenido los datos de `for` se leen como cargados, sin `!`. También desde la `1.5`, `<MeekoTeleport>` (`MeekoTeleportProps`, con `to` y `disabled`; el completado de `to="…"` ofrece `body` y los `#id` del componente, de `app/app.meeko` y de los layouts), `<MeekoPopover>` (`MeekoPopoverProps`) y `<MeekoSelect>` (`MeekoSelectProps`, con el tipo de sus opciones) tienen hover, completado y la comprobación de sus props, y la gramática las colorea como etiquetas propias.
- **Rutas, API y RPC.** Sobre el ID de `href("/users/[id]")`: la página, sus `params`, su modo de render y sus layouts. Sobre `useApi("/api/notes")` o `api.notes.get`: el método, la ruta y el handler, con los schemas de su contrato. Sobre `useRpcQuery("users.get")`, `useRpcMutation(...)` o `rpc.users.get`: el procedimiento, su URL y su handler con sus schemas.

### Ir a definición en rutas, API y RPC

«Ir a definición» sobre el ID de ruta de `href` abre la página, y sobre un endpoint o procedimiento abre su handler en la línea del contrato (`defineApiRoute` o `defineRpc`). Una etiqueta de componente lleva a su `.meeko`. El servidor descubre rutas, endpoints y procedimientos sin ejecutar sus módulos, igual que `meeko routes`; si el descubrimiento falla, usa `.meeko/manifests/routes.json`.

Desde `1.2`, las cadenas de `href("…")`, `useApi("…")`, `useApiMutation("…")`, `useRpcQuery("…")` y `useRpcMutation("…")` son además enlaces (Ctrl+clic) a su página o handler, y una ruta que no existe no tiene enlace. La búsqueda de símbolos del workspace (Ctrl+T en VS Code) encuentra componentes, páginas (por su ruta, como `/users/[id]`), endpoints (`GET /api/users`) y procedimientos (`rpc.users.get`); acepta las letras salteadas (`usid` encuentra `/users/[id]`).

### Pistas de tipo

La plantilla no escribe los tipos de lo que declara: el servidor los muestra como pistas en línea después de `each:as` (`each:as="user: User"`) y de cada parámetro de `<snippet params>`, también en los componentes genéricos. Las pistas largas se acortan a 60 caracteres.

### Comandos «Meeko: nuevo…» (VS Code)

- **Nuevo componente:** `AppCard` crea `app/components/App/Card.meeko` si existe la carpeta `App` (si no, `AppCard.meeko`); `App/Card` es una ruta explícita.
- **Nueva página:** `/users` crea `app/pages/users/index.meeko` y `/users/[id]`, `app/pages/users/[id].meeko`, con su `useHead`.
- **Nuevo endpoint de API:** pide el método y la ruta (`/users/[id]`, con o sin `/api`) y crea `server/api/users/[id].get.ts` con sus schemas públicos (`params`, `body` en `POST`/`PUT`/`PATCH` y `response`) en `shared/schemas/users.ts`, que añade al archivo si ya existe. Usa valibot, el validador por defecto, o zod si es el que declara el `package.json` del proyecto.

Usan el proyecto del archivo activo y la indentación de los `.meeko`, y nunca sobrescriben un archivo.

### CodeLens

- **Valores reactivos.** Sobre cada señal, `computed` o recurso declarado en el nivel superior del `<script>`: cuántas lecturas y escrituras tiene y si la plantilla lo usa. Al pulsarlo se listan esas posiciones.
- **Páginas.** En la primera línea de una página: su ruta, su modo de render y sus layouts. Si su `<script server>` exporta datos desde el código de nivel superior o declara `load`, otra lente muestra el tipo de los datos que envía al navegador (con código de nivel superior, un campo por cada `export const` o `export let`, sin `head`), y avisa si contiene valores que la serialización JSON rechaza (funciones, `bigint`, `Date`, `Map`…) o si el tipo es muy grande. En una página `render: "client"` indica que el loader se ejecuta en el navegador.

La lente se pide con `textDocument/codeLens`. Las lentes de valores reactivos usan el comando `editor.action.showReferences` con los argumentos `[uri, posición, ubicaciones]` en formato LSP; un cliente que no tenga ese comando puede ignorarlo o asociarlo a su propia lista de referencias. Las lentes de página no tienen comando.

### Zonas de ejecución

El servidor indica, por líneas completas, dónde se ejecuta el código de un `.meeko`:

| Zona (`kind`) | Motivo (`reason`) | Líneas |
| --- | --- | --- |
| `server` | `server-block` | `<script server>` de una página. |
| `browser` | `client-route-block` | `<script server>` de una página `render: "client"`, que se ejecuta en el navegador. |
| `shared` | `setup` | El setup del `<script>`, que se ejecuta en SSR y al hidratar. |
| `browser` | `client-page` | El setup de una página `render: "client"`. |
| `browser` | `continuation` | El setup a partir del primer `await` de navegador. |
| `browser` | `onMounted` | El cuerpo de cada callback de `onMounted`. |
| `browser` | `browser-function` | Una función del setup que sólo se usa desde código de navegador. |
| `browser` | `inline-handler` | Una función escrita en un `on:*` de la plantilla que ocupa sus propias líneas. |

**Funciones de navegador.** Una función declarada en el nivel superior del setup (`function guardar() {}` o `const guardar = () => {}`) sale como «Sólo navegador» cuando todos sus usos se ejecutan en el navegador: como manejador `on:*` de la plantilla (también en un componente), dentro de `onMounted`, en la continuación tras el primer `await` de navegador o desde otra función de navegador. El hover de la zona dice por qué (por ejemplo, «Sólo se usa como manejador de `on:click` y en `onMounted`»). La función sigue compartida si también se llama en el nivel superior del setup, dentro de `effect` o `computed`, desde una expresión de la plantilla que se renderiza, se pasa como prop o modelo de un hijo, se publica con `defineExpose` o tiene un uso que el análisis no clasifica. Un manejador que se llama al enlazarse (`on:click="crear(guardar)"`) cuenta como uso compartido, porque en un componente se evalúa durante el SSR.

**Manejadores en la plantilla.** Una función escrita en un `on:*` cuyo atributo ocupa sus propias líneas, como una flecha de varias líneas que empieza en `on:click="() => {` y termina en `}"` (con `>` o `/>` como mucho detrás), también forma una zona de navegador con el nombre del evento en su hover. Una función que comparte línea con otros atributos o con contenido de la plantilla no se marca.

La plantilla (salvo esos manejadores) y los estilos no forman zonas, y las zonas no se solapan: una zona más concreta (una función de navegador, `onMounted`, un manejador) sustituye a la del setup en sus líneas. El análisis es sintáctico y por líneas completas; si no puede clasificar el setup, las funciones se quedan en la zona compartida. Otros clientes las piden con la petición propia `meeko/executionZones`:

```json
// Petición
{ "textDocument": { "uri": "file:///app/pages/index.meeko" } }
// Respuesta
{ "zones": [{ "kind": "server", "reason": "server-block", "label": "…", "detail": "…",
  "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 6, "character": 9 } } }] }
```

`label` es un título corto y `detail` una explicación de un párrafo para un hover. La respuesta es `null` para un documento que el servidor no modela.

### Acciones rápidas

Además de las de imports y `href`:

- **Props leídas una sola vez (`MEEK101`).** «Convertir en computed» cambia `const upper = props.label.toUpperCase()` por `computed(() => props.label.toUpperCase())` y añade `.value` a cada uso, en el script y en la plantilla (una propiedad abreviada conserva su clave: `{ upper }` pasa a `{ upper: upper.value }`). Una desestructuración `const { label, title: heading } = props` se convierte en un `computed` por nombre. Si sólo interesa el primer valor, «Leer … sólo una vez con untrack» lo declara con `untrack(() => props.x)`.
- **Añadir `each:as` (`MEEK022`).** En una lista sin `each:as`, lo añade con el singular de la lista (`variants.value` → `variant`) o `item`. Funciona aunque el componente no compile, que es lo que provoca ese error.
- **Crear un componente.** En una etiqueta como `<AppNuevo bind:title="name.value" />` cuyo componente no existe, crea `app/components/App/Nuevo.meeko` (dentro de la carpeta más larga de `app/components` con la que empieza el nombre, como los nombra el autoimport) con una prop por cada `bind:`, del tipo del valor que pasa la etiqueta. Sólo se ofrece si el cliente admite crear archivos en una edición de workspace (`resourceOperations` con `create`).
- **Añadir `each:key`.** En una lista sin clave, propone `each:key="item.id"` (u otra propiedad identificadora del elemento) o el propio elemento si es una cadena o un número.
- **Mover el sidecar a `<script server>`.** En las primeras líneas de una página con un `x.route.ts` junto a ella, mueve su contenido a un bloque `<script server lang="ts">` y borra el sidecar en una sola edición. Los imports relativos siguen funcionando porque ambos archivos comparten carpeta. Sólo se ofrece si el cliente admite borrar archivos en una edición de workspace (`workspace.workspaceEdit.documentChanges` y `resourceOperations` con `delete`).

### Completado de directivas, modelos y snippets

En el nombre de un atributo de la plantilla, el completado ofrece las directivas de Meeko que admite la etiqueta: `if:when`, `each:of`, `each:as`, `each:key`, `each:index`, `bind:`, `on:` y `ref:` en cualquier etiqueta, también en las de componente; `html` en los elementos, `model` en `input`, `textarea` y `select`, y `model:` en los componentes. No repite las que la etiqueta ya tiene, y tras un prefijo (`on:`, `model:`) vuelve a abrir el completado con los nombres del hijo.

El hover de `html` advierte que inserta HTML sin escapar. Desde `1.3`, cuando su valor es un `string` (o `any`) sin la marca `TrustedHtml`, el editor subraya toda la expresión con el aviso `MEEK107`, el mismo de `meeko check`; desaparece al marcar el HTML con `trustHtml(…)` donde se produce (véase [HTML de confianza](api.md#html-de-confianza-trustedhtml-y-trusthtml)).

El completado ofrece los modelos del hijo tras `model:` en una etiqueta de componente, los nombres de los snippets del hijo en `<snippet name="…">` y sus parámetros en `params`.

### HTML y CSS en la plantilla y en `<style>`

Desde `1.2`, el servidor también entiende el marcado y los estilos. Lee el texto, sin compilar el componente, así que funciona mientras una etiqueta o una regla están a medio escribir:

- **Plantilla:** completado de etiquetas, de atributos HTML (después de las directivas de Meeko y sin los manejadores `onclick`…, que en Meeko se escriben `on:click`) y de sus valores (`type="checkbox"`), con la documentación de MDN en el hover. Tras `on:` en un elemento, los eventos del DOM con su descripción. Las etiquetas de componente y los valores que son expresiones (`bind:`, `on:`, `if:when`, `each:`…, `{…}`) siguen en manos de TypeScript.
- **Etiquetas:** la de apertura y la de cierre se renombran juntas (edición vinculada, que la extensión de VS Code activa con `editor.linkedEditing` en los `.meeko`), y la extensión cierra la etiqueta al escribir `>` o `</` (ajuste `meeko.autoClosingTags`). Otros clientes la piden con `meeko/tagComplete`, que devuelve un snippet como `$0</div>`.
- **`<style>`:** completado y hover de propiedades y valores, diagnósticos de CSS (`:global(…)` y las at-rules desconocidas no son errores) y el selector de color.
- **Clases:** en `class="…"` se completan las clases del proyecto (véase [Completado de clases CSS](#completado-de-clases-css)), e ir a definición lleva de una clase a sus selectores. En `<style scoped>`, una clase que no nombran ni la plantilla ni el script se marca como sin uso (atenuada, con el código `MEEK_UNUSED_CLASS`). Cuenta cualquier aparición del nombre, también en un `computed` o en `classList.add("open")`, y un prefijo antes de una interpolación (`` `badge--${tone}` ``) cubre todas las clases que empiezan por él. Las de `:global(…)` nunca se marcan, porque pueden alcanzar a otros componentes.

### Completado de clases CSS

El servidor completa los nombres de clase sin depender de otra extensión (como «HTML CSS Support»). Se ofrecen en `class="…"`, palabra a palabra, y dentro de los literales de cadena de `bind:class` (`bind:class="open.value ? 'is-open' : ''"` o el texto de un template literal, fuera de sus `${…}`); el resto de la expresión sigue en manos de TypeScript. Cada clase aparece una vez, sin repetir las que ya tiene el valor, con su origen como detalle (`este componente`, `Card.meeko`, `main.css (global)`) y, al seleccionarla, la regla que la define como documentación. Las fuentes, por orden de prioridad:

1. **El `<style>` del componente**, con o sin `scoped`, con el texto del editor aunque no esté guardado. Mientras su CSS no se puede leer se conservan las últimas clases.
2. **Los `<style>` sin `scoped` de los demás `.meeko` del proyecto**, que son globales. De un `<style scoped>` ajeno sólo cuentan las clases dentro de `:global(…)`, que también son globales; las demás no se sugieren.
3. **La hoja global.** Mientras se ejecuta, `meeko dev` escribe en `.meeko/styles/main.css` la hoja `app/styles/main.css` ya procesada por Vite y PostCSS: con los `@import` resueltos, los `@utilities` expandidos y lo que generen los plugins, como Tailwind. Si ese archivo existe, sus clases se ofrecen como `main.css (global, procesada)`. Además se lee siempre `app/styles/main.css` tal cual, con los `@import` de archivos locales (`./tokens.css`, `url(./base.css)`; los paquetes como `"tailwindcss"` se ignoran) y las `@utility nombre` de Tailwind 4, sin ejecutar PostCSS. Sin la hoja procesada, las clases que sólo generan `@utilities` o Tailwind no aparecen hasta la próxima vez que se ejecute `meeko dev`, y una hoja procesada antigua puede ofrecer clases que ya no existen hasta que `meeko dev` la reescriba.

Se leen las clases de las reglas anidadas (`&.open`, `.a .b`), de `@media` y `@layer` y de los argumentos de `:is()`, `:where()`, `:not()` y `:global()`. El hover sobre una clase muestra su origen y su regla, e ir a definición lleva a sus selectores en el componente, en los `<style>` de otros componentes y en las hojas del proyecto. Una clase que sólo existe en la hoja procesada lleva a su regla en `.meeko/styles/main.css`: no hay forma barata de saber qué `@utilities` la generó, y esa regla es la que llega al navegador.

El índice se guarda por archivo: un componente se vuelve a leer cuando cambia su texto y una hoja cuando cambian su fecha o su tamaño, o cuando el observador de archivos (`**/*.css`, también bajo `.meeko/`) avisa de un cambio. Al escribir sólo se vuelve a leer el `<style>` del componente editado; con 300 componentes y 3000 clases generadas, el completado responde en pocos milisegundos. Como sólo se lee CSS y nunca se ejecuta código del proyecto, funciona igual en un workspace sin confianza.

### Componentes genéricos

En el padre, cada etiqueta de un componente con `generic` se comprueba como en `meeko check`: los parámetros de tipo se infieren de sus props, y el hover, el completado y los diagnósticos de sus manejadores `on:`, modelos, snippets y refs usan ese tipo (`T = User`). Dentro del script del componente genérico, el hover y el completado tratan cada parámetro como su restricción, e «ir a definición» sobre `T` lleva al atributo `generic`; los diagnósticos son los de `meeko check`, que compila el componente con los parámetros reales. La gramática de VS Code resalta el valor de `generic` como una lista de parámetros de tipo de TypeScript, también con `>` dentro de una restricción.

### Valores en vivo

Los valores en vivo de las señales no pasan por el servidor de lenguaje: los publica `meeko dev` mediante el [puente del editor](devtools.md#puente-del-editor), que la extensión de VS Code consume (véase su [README](../packages/vscode/README.md#valores-en-vivo)). Cada `meeko dev` escribe su propio descriptor, `.meeko/dev/editor-bridge-<puerto>.json`, y la extensión se conecta a todos los que encuentra, así que funcionan varios servidores de desarrollo a la vez. Una señal que es la misma que otra, como el modelo que un hijo recibe con `defineModel`, lleva el campo `alias` con la señal principal: la extensión la muestra como `open = true (= dialogOpen)`, su hover dice «alias de `dialogOpen`» y editarla edita la principal. Otro editor puede leer el mismo puente, teniendo en cuenta que su protocolo es sólo de desarrollo y no forma parte del contrato público.

## Arrancar el servidor

El servidor viene en el paquete `@meekojs/meeko`. Instálalo como dependencia del proyecto para que el editor use la misma versión que el compilador:

```powershell
pnpm add -D @meekojs/meeko
```

Hay dos formas equivalentes de arrancarlo; ambas hablan JSON-RPC por la entrada y salida estándar:

```powershell
meeko lsp --stdio
meeko-language-server --stdio
```

Desde la raíz del proyecto, `npx meeko-language-server --stdio` (o `pnpm exec meeko-language-server --stdio`) usa el binario de `node_modules/.bin`. Además de `--stdio`, el servidor acepta `--node-ipc`, `--socket=<puerto>` y `--pipe=<nombre>`. Sin transporte termina con código 1 y muestra el uso. Requiere Node.js 24 o posterior.

El servidor reconoce los componentes por la extensión `.meeko` de su ruta; el `languageId` que envíe el editor no importa. Basta con asociar los archivos `.meeko` a un tipo de archivo propio (o a HTML) y lanzar el servidor para ese tipo.

### Opciones de inicialización

Se envían en `initializationOptions` de la petición `initialize`. Todas son opcionales.

| Opción | Por defecto | Efecto |
| --- | --- | --- |
| `trusted` | `true` | Con `true`, el servidor ejecuta `meeko.config.*` del proyecto con Node, también el `setup` de sus [módulos](framework.md#módulos), para conocer sus autoimports, componentes y layers, y comprueba los contratos de páginas y layouts al guardar. Con `false` no ejecuta código del proyecto: lee la configuración de forma estática (sólo listas literales; de `modules`, sólo las carpetas de layer), así que los autoimports y componentes de los módulos no existen para el editor, y omite los contratos. |
| `projectContracts` | `true` | `false` desactiva la comprobación de contratos de páginas (`MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS`) al guardar. |
| `diagnosticsDelay` | `300` | Milisegundos de espera tras una edición antes de comprobar el componente. |
| `format` | `{}` | Ajustes de formato para clientes sin `workspace/configuration`, por ejemplo `{ "indentSections": true }`. Si el cliente admite esa petición, prevalece su sección `meeko.format`. |

Fuera de VS Code `trusted` vale `true` porque es el usuario quien configura el servidor para su proyecto, del mismo modo que `meeko check` ejecuta la configuración. Usa `trusted: false` al abrir código de terceros. La extensión de VS Code envía el estado de confianza del workspace.

### Formato con Prettier

El servidor formatea los `.meeko` con [Prettier](https://prettier.io) y el plugin de Meeko (`@meekojs/meeko/prettier`), así que el editor, la CLI de Prettier y la CI dan el mismo resultado:

- **Script, estilo y plantilla.** `<script>` y `<script server>` se formatean como TypeScript y `<style>` como CSS (o SCSS/Less según `lang`). La plantilla se formatea como HTML: los atributos largos van uno por línea, se respetan las etiquetas PascalCase y el autocierre, y los valores de `bind:`, `bind` (desde 1.5), `on:`, `if:when`, `each:of`, `each:key`, `model`, `<component is>` y `<render>` y el texto `{expr}` se formatean como expresiones TypeScript. Una expresión que Prettier no entiende se deja tal cual. `<!-- prettier-ignore -->` excluye el nodo siguiente.
- **Arrays como los objetos.** Con la opción `meekoPreserveArrayBreaks` (por defecto `true`), un array, un patrón de desestructuración (`const [a, b] = …`) o una tupla de TypeScript que en el código tiene un salto de línea entre `[` y su primer elemento se imprime expandido, un elemento por línea (los arrays de números se reparten por líneas, como hace Prettier al romperlos). Si no hay salto ahí, decide Prettier, que lo deja en una línea si cabe en `printWidth`. Es la regla de `objectWrap: "preserve"` para los objetos: para colapsar un array basta con unir `[` y el primer elemento y volver a formatear. Los comentarios y huecos (`[, a]`) entre `[` y el primer elemento cuentan para el salto, y un array vacío no se fuerza. Con `"meekoPreserveArrayBreaks": false` la salida es exactamente la de Prettier.
- **Atributo `class` normalizado.** Desde 1.3, el valor de cada `class="…"` estático de un elemento se normaliza siempre, sin opción, como hace Prettier con el HTML suelto: se quitan los espacios del principio y del final, cualquier secuencia de espacios, tabuladores o saltos de línea queda en un espacio y una clase repetida se elimina (se conserva la primera). Sólo cuentan como separadores los espacios ASCII que separan clases en HTML; un espacio no separable forma parte de la clase. `class="  "` queda como `class=""` y `<p class>` no cambia. No se tocan `bind:class` ni otras directivas, otros atributos, el `class` de una etiqueta de componente (`<Card class="…">` o `<component is>`, donde es una [prop estática](api.md#props-estáticas)) ni un valor con referencias de carácter (`&amp;`). Los atributos estáticos de Meeko no interpolan `{expr}`: su valor es texto literal, así que el cambio no altera las clases del elemento.
- **Orden de las clases.** La opción `meekoSortClasses` ordena esas mismas clases: `"off"` (por defecto) conserva su orden, `"alphabetical"` las ordena por código de carácter (`B` antes que `a`, sin depender del idioma) y `"stylesheet"` sigue la hoja global del proyecto, como `prettier-plugin-tailwindcss` sigue la de Tailwind. Véase [Orden por la hoja global](#orden-por-la-hoja-global).
- **Qué Prettier se usa.** En un workspace de confianza, si el proyecto tiene `prettier`, se usa ese Prettier con su configuración (`.prettierrc`, `.editorconfig`, plugins). Si no, se usa el que incluye Meeko, con las opciones del editor (`tabSize`, `insertSpaces`) y `meeko.format.indentSections`; la configuración del proyecto prevalece sobre ambas. En un workspace no confiable se usa siempre el incluido, sin leer la configuración del proyecto, porque cargarla ejecuta código.
- **Límites.** Sólo se formatea el documento completo, no un rango. Un archivo que no compila no se formatea.

Para formatear desde la CLI o en CI, añada el plugin a la configuración de Prettier del proyecto:

```json
{ "plugins": ["@meekojs/meeko/prettier"], "meekoIndentSections": false }
```

```sh
npx prettier --check "app/**/*.meeko"
```

`meekoPreserveArrayBreaks` no se limita a los `.meeko`: el plugin sustituye el printer `estree` de Prettier, así que con el plugin en la configuración del proyecto la regla se aplica a todo el JavaScript y TypeScript que formatee Prettier (`.ts`, `.js`, `.tsx`, `.mjs`…), al script de los `.meeko` y a las expresiones de la plantilla (`bind:`, `each:of`, `{expr}`…), con los parsers `typescript`, `babel` y `babel-ts`. Ese printer delega todo, al formatear, en el printer `estree` del Prettier que lo ejecuta (la CLI y la extensión de Prettier del proyecto, o el Prettier que incluye la extensión de Meeko si el proyecto no tiene uno): el resto del formato es el de esa versión aunque no coincida con la que instala `@meekojs/meeko`, y con `false` la salida es exactamente la de ese Prettier. Si otro plugin de la configuración también sustituye `estree`, Prettier usa sólo el del último de la lista `plugins`: si es el otro, `meekoPreserveArrayBreaks` no tiene efecto; si es el de Meeko, éste envuelve el printer del otro plugin, que sigue imprimiendo todo lo demás. El servidor de lenguaje no tiene un ajuste propio para esta opción: se desactiva en la configuración de Prettier del proyecto, que también lee la extensión de Prettier para los `.ts`.

#### Orden por la hoja global

Con `"meekoSortClasses": "stylesheet"` (en la CLI, `--plugin @meekojs/meeko/prettier --meeko-sort-classes stylesheet`; la CLI sólo reconoce la opción si el plugin se pasa con `--plugin`), cada clase toma la posición de su primera aparición en un selector de la hoja global, y después en el `<style>` del componente (con o sin `scoped`), en su orden: las del componente cuentan como definidas después de las globales. Las clases que no aparecen en ninguna de las dos van primero, en el orden en que estaban; después, las conocidas por su posición. Con `.stack` antes que `.card` en la hoja, `class="extra card stack"` queda `class="extra stack card"`.

- **Qué hoja.** `app/styles/main.css` de la raíz del proyecto: la primera carpeta, subiendo desde el archivo, con `meeko.config.*` o con un `package.json` que tiene `@meekojs/meeko` en `dependencies` o `devDependencies` (el mismo criterio que `meeko clean`). Se procesa con la API de Vite (`resolveConfig` y `preprocessCSS`, con el Vite que resuelve el proyecto) igual que en `meeko dev`: con el `postcss.config.*` del proyecto, resolviendo los `@import` y expandiendo los `@utilities` de `meekoUtilities()`. La configuración de Vite que añaden los módulos de `meeko.config.ts` no se aplica.
- **Determinismo.** El resultado no depende de que `meeko dev` esté en marcha: el plugin procesa la hoja él mismo, así que el editor, la CLI y la CI ordenan igual con los mismos archivos.
- **Caché.** La hoja procesada se reutiliza durante todo el proceso (una ejecución de la CLI, el servidor de lenguaje) mientras no cambien la fecha de modificación ni el tamaño de `main.css`, de los archivos que importa, de los módulos de `@utilities` y los que estos importan, ni de los archivos de configuración de PostCSS de la raíz. Al cambiar cualquiera de ellos, el siguiente formateo vuelve a procesarla. La caché propia de Prettier (`prettier --cache`, desactivada por defecto) no conoce la hoja: tras cambiarla, ejecute la CLI sin `--cache` o borre esa caché.
- **Si no hay hoja.** Si no se encuentra el proyecto, no existe `app/styles/main.css` o falla al procesarse, las clases no se ordenan (sólo se normalizan) y el formateo sigue. Se avisa una vez por proyecto en la salida de errores (`[meeko] Aviso: meekoSortClasses "stylesheet" no ordena las clases: …`), nunca en la salida estándar donde la CLI escribe el código. Una hoja que falló se reintenta cuando cambia uno de sus archivos o, como mucho, dos segundos después.
- **Workspaces no confiables.** Procesar la hoja ejecuta código del proyecto (la configuración de PostCSS y los módulos de `@utilities`). La CLI de Prettier ya ejecuta código del proyecto al cargar su configuración; en VS Code, en un workspace no confiable el servidor no lee esa configuración y fuerza `"off"`: sólo se normaliza.
- **Rendimiento.** En un proyecto real con dos módulos `@utilities` y ocho `@import`, la primera vez que se procesa la hoja tarda unos 220-260 ms (cargar Vite y los módulos incluidos); cada formateo siguiente sólo comprueba las fechas de los archivos, en torno a 1,5-2 ms.

### Ajustes del editor

El servidor pide la sección `meeko.format` con `workspace/configuration` en cada formateo, así que un cambio se aplica sin reiniciarlo. Los clientes sin esa petición pueden enviar `format` en las opciones de inicialización o `{ "meeko": { "format": { ... } } }` con `workspace/didChangeConfiguration`.

| Ajuste | Por defecto | Efecto |
| --- | --- | --- |
| `meeko.format.indentSections` | `false` | Indenta un nivel el contenido de cada sección (`<script>`, `<script server>`, `<template>` y `<style>`), como `vueIndentScriptAndStyle` de Prettier más la plantilla. Con `false`, el formato quita esa indentación base. El nivel usa `tabSize` o un tabulador según `insertSpaces`. Equivale a la opción `meekoIndentSections` del plugin; si el proyecto la fija en su configuración de Prettier, prevalece. |

En cada editor, el ajuste va en el objeto de ajustes del servidor como `settings.meeko.format.indentSections`; los ejemplos de cada sección lo muestran.

### Qué lee el servidor

- El `tsconfig.json` de la raíz del paquete (la carpeta con `package.json` más cercana) define las opciones de hover, completado y navegación, por ejemplo los alias `paths`. `meeko check`, y por tanto los diagnósticos del editor, usan las mismas opciones de resolución (`paths`, `baseUrl`, `types`, `typeRoots`, `customConditions`, `resolveJsonModule`, `allowImportingTsExtensions`) y conservan sus banderas estrictas de tipos.
- Un import de un `.meeko` del proyecto se resuelve al componente tal como está en el editor, con sus cambios sin guardar, aunque exista su declaración generada `.d.meeko.ts` (junto a él o en `.meeko/types`), que con resolución `NodeNext` TypeScript elegiría primero.
- Los usos de un símbolo marcado `@deprecated` en su JSDoc, como el alias `useSocket` de `@meekojs/meeko/framework`, se publican como pistas tachadas (`DiagnosticTag.Deprecated`, códigos `TS6385` y `TS6387`) con el motivo de la etiqueta. Los hovers muestran `{@link X}` como el nombre en código, su texto o un enlace.
- Para detectar cambios guardados en archivos `.ts`, `.css`, `tsconfig*.json` y `meeko.config.*`, el servidor registra observadores con `workspace/didChangeWatchedFiles` cuando el cliente admite el registro dinámico. Si tu editor no lo admite, vuelve a abrir el componente o reinicia el servidor tras cambiar un módulo importado. Desde la `1.4` observa también la creación y el borrado de carpetas bajo `app/`, `server/` y `shared/`, porque al crear, mover o renombrar una carpeta el editor puede notificar sólo la carpeta y no cada `.meeko` de dentro.
- El completado del `<script>` no ofrece los tipos auxiliares del código virtual (`__MeekoEmit`, `__MeekoDeclaredProps`…), que tampoco aparecen en el hover ni en «Ir a definición». De `@meekojs/meeko` sólo sugiere las entradas públicas de su `exports` (salvo `internal`): un nombre que exporta una entrada se importa desde ella (`import { MeekoModule } from "@meekojs/meeko/framework"`), también con el paquete enlazado con `link:`, que TypeScript resuelve fuera de `node_modules` y por el que sugeriría rutas relativas a sus archivos, y un nombre que no exporta ninguna entrada no se sugiere. Los exports de los paquetes se ordenan después de los nombres locales y de los autoimports del proyecto.

### Comprobación del proyecto

En un workspace de confianza, y salvo con `projectContracts: false`, el servidor genera las declaraciones de los componentes y comprueba los contratos de las páginas, los layouts y la página de error (`MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS`), como `meeko check`. Desde la `1.4`:

- **Cuándo.** Se repite, con una espera de 450 ms, al abrir una página o un layout y al guardar, crear, borrar o renombrar cualquier `.meeko`, módulo TypeScript, configuración o carpeta de la aplicación (también una carpeta nueva como `app/components/Layout`), y al cerrar sin guardar un componente editado. Los cambios de `.meeko/` y de `node_modules` no la lanzan.
- **Con qué texto.** Los componentes abiertos cuentan con su texto sin guardar, como sus diagnósticos propios; los demás, con el guardado.
- **Componentes a medio escribir.** Un componente que no compila no detiene la comprobación del resto: conserva su última declaración y su error sale en ese archivo (si está abierto, en sus diagnósticos propios, sin repetirlo). Un `.meeko` vacío, como el que crea el editor al añadir un archivo, se trata como «en edición» y no produce error en la comprobación.
- **Fallos.** Si la comprobación falla por otra causa, `MEEK_PROJECT_CHECK` sale en un solo archivo: el que no compila, el que la lanzó o, si no, un componente abierto del proyecto. Cada comprobación sustituye todos los diagnósticos de la anterior, también ese fallo, así que un error corregido desaparece en la siguiente.

## Neovim

Con Neovim 0.11 o posterior y [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig), declara el tipo de archivo y el servidor en tu `init.lua`:

```lua
vim.filetype.add({ extension = { meeko = "meeko" } })

vim.lsp.config("meeko", {
  cmd = { "npx", "meeko-language-server", "--stdio" },
  filetypes = { "meeko" },
  root_markers = { "package.json", "tsconfig.json" },
  init_options = { trusted = true },
  settings = { meeko = { format = { indentSections = true } } },
})
vim.lsp.enable("meeko")
```

`npx` resuelve el binario del proyecto cuando Neovim se abre dentro de él. Para resaltado sintáctico sin una gramática tree-sitter propia puedes reutilizar la de HTML con `vim.treesitter.language.register("html", "meeko")`; los tokens semánticos del servidor colorean las expresiones TypeScript del script y la plantilla.

## Helix

En `languages.toml` (global o `.helix/languages.toml` del proyecto):

```toml
[language-server.meeko]
command = "npx"
args = ["meeko-language-server", "--stdio"]
config = { trusted = true }

[[language]]
name = "meeko"
scope = "source.meeko"
file-types = ["meeko"]
roots = ["package.json", "tsconfig.json"]
grammar = "html"
block-comment-tokens = { start = "<!--", end = "-->" }
language-servers = ["meeko"]
```

Helix envía la tabla `config` como `initializationOptions` y responde con ella a `workspace/configuration`. Para los ajustes del editor, añade la tabla `meeko` en `config`:

```toml
[language-server.meeko]
command = "npx"
args = ["meeko-language-server", "--stdio"]
config = { trusted = true, meeko = { format = { indentSections = true } } }
```

`hx --health meeko` confirma que encuentra el servidor.

## Zed

Zed sólo asocia servidores de lenguaje a lenguajes que declara una extensión, y todavía no hay una extensión publicada de Meeko. Puedes instalar una extensión local con **zed: install dev extension** que contenga:

- `extension.toml` con `[language_servers.meeko-language-server]`, `name = "Meeko Language Server"` y `languages = ["Meeko"]`, además de la gramática `html` en `[grammars.html]`;
- `languages/meeko/config.toml` con `name = "Meeko"`, `grammar = "html"`, `path_suffixes = ["meeko"]` y `block_comment = ["<!-- ", " -->"]`, junto con las consultas `highlights.scm` copiadas del lenguaje HTML;
- `src/lib.rs` que devuelva el comando del servidor:

```rust
use zed_extension_api as zed;

struct Meeko;

impl zed::Extension for Meeko {
    fn new() -> Self {
        Meeko
    }

    fn language_server_command(&mut self, _id: &zed::LanguageServerId, worktree: &zed::Worktree) -> zed::Result<zed::Command> {
        let command = worktree
            .which("meeko-language-server")
            .ok_or("meeko-language-server is not on PATH; install @meekojs/meeko")?;
        Ok(zed::Command { command, args: vec!["--stdio".into()], env: Default::default() })
    }
}

zed::register_extension!(Meeko);
```

Las opciones de inicialización se pueden fijar sin recompilar en `settings.json`:

```json
{
  "lsp": {
    "meeko-language-server": {
      "initialization_options": { "trusted": true },
      "settings": { "meeko": { "format": { "indentSections": true } } }
    }
  }
}
```

Zed sólo responde `workspace/configuration` con `settings` si la extensión implementa `language_server_workspace_configuration` (por ejemplo, devolviendo `LspSettings::for_worktree("meeko-language-server", worktree)?.settings`). Sin ese método, usa `"initialization_options": { "trusted": true, "format": { "indentSections": true } }`.

## JetBrains (LSP4IJ)

Los IDE de JetBrains se conectan mediante el plugin [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij):

1. Instala LSP4IJ y abre **Settings → Languages & Frameworks → Language Servers**; pulsa **+** para crear un servidor.
2. En **Server**, nombre `Meeko` y comando `npx meeko-language-server --stdio` (en Windows, `npx.cmd meeko-language-server --stdio`).
3. En **Mappings → File name patterns**, añade `*.meeko` con el identificador de lenguaje `meeko`.
4. En **Configuration → Initialization Options**, escribe `{ "trusted": true }`, y en **Configuration → Server / Configuration** los ajustes del editor, por ejemplo `{ "meeko": { "format": { "indentSections": true } } }`.

Para el resaltado sintáctico, registra la gramática TextMate de la extensión de VS Code en **Settings → Editor → TextMate Bundles** apuntando a la carpeta `packages/vscode` del repositorio o a una extensión VSIX descomprimida.

## Sublime Text

Con el paquete [LSP](https://lsp.sublimetext.io/) y Sublime Text 4, crea primero una sintaxis que herede de HTML en `Packages/User/Meeko.sublime-syntax`:

```yaml
%YAML 1.2
---
name: Meeko
scope: text.html.meeko
version: 2
extends: Packages/HTML/HTML.sublime-syntax
file_extensions:
  - meeko
contexts: {}
```

Después añade el cliente en **Preferences → Package Settings → LSP → Settings**:

```json
{
  "clients": {
    "meeko": {
      "enabled": true,
      "command": ["npx", "meeko-language-server", "--stdio"],
      "selector": "text.html.meeko",
      "initializationOptions": { "trusted": true },
      "settings": { "meeko.format.indentSections": true }
    }
  }
}
```

## Limitaciones

- Sólo se tiene en cuenta el `tsconfig.json` de la raíz del paquete; los tsconfig anidados o referenciados por `references` no cambian el análisis.
- El renombrado y las referencias que abarcan archivos `.meeko` se inician desde un `.meeko`. Desde un `.ts` responde el servidor TypeScript del editor, que no conoce los componentes.
- El modelo semántico necesita secciones sintácticamente cerradas. Mientras se escribe un archivo incompleto los diagnósticos siguen llegando, pero completado y navegación pueden pausarse hasta que vuelva a ser válido.
- Un proyecto con más de 2000 componentes `.meeko` sólo carga los primeros 2000 para referencias y renombrado entre archivos.
