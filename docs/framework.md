# Meeko como framework full-stack

Meeko conserva el motor independiente en `@meekojs/meeko`. El modo de aplicación usa `@meekojs/meeko/framework` y Vite usa `@meekojs/meeko/vite`. El servidor se reparte en estas subrutas:

- `@meekojs/meeko/server`: núcleo portable de la aplicación (`createServerApp`, `defineServerRuntime`, contratos API/RPC, sesiones, middleware, Socket, `createSocketUpgradeHandler`, OpenAPI y, desde `1.3`, `contentSecurityPolicy`). Sólo usa Web APIs y `node:async_hooks`; no carga TypeScript, Vite, `ws` ni el sistema de archivos.
- `@meekojs/meeko/node`: adaptador Node (`serveNode`, `toNodeListener`, `createNodeAssetReader`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler`).
- `@meekojs/meeko/password` (desde `1.2`): `hashPassword`, `verifyPassword` y `needsRehash` con scrypt; necesita `node:crypto`, así que sirve en Node, Bun y Deno, no en Workers (véase [Contraseñas](#contraseñas)).
- `@meekojs/meeko/bun`: adaptador Bun (`createBunServer` y `createBunAssetReader`).
- `@meekojs/meeko/deno`: adaptador Deno (`serveDeno` y `createDenoAssetReader`).
- `@meekojs/meeko/cloudflare`: adaptador Cloudflare Workers (`createWorker`, `createSocketRoomClass`, `DurableObjectSocketPubSub`, `D1SessionDriver`, `createCloudflareAssetReader` y `createCloudflarePrerenderSource`).
- `@meekojs/meeko/build`: herramientas de build que leen el sistema de archivos y cargan TypeScript (`discoverRoutes`, `discoverErrorPage`, `discoverConfiguredRoutes`, `composeFrameworkRoutes`, `loadMeekoConfig`, `readMeekoConfigSync`, `resolveConfigSources`, `discoverServerManifest`, `prerenderRoutes`, `prerenderProject`, `buildProject` y, desde `1.3`, `inlineScriptHashes`). El servidor de producción no la importa.

Todas las subrutas pertenecen al mismo paquete y versión. Los destinos de servidor publicados son Node 24, Bun, Deno y Cloudflare Workers, y la misma suite de conformidad los comprueba (véase [Build, despliegue y verificación](#build-despliegue-y-verificación)). Desde `1.3`, el adaptador `static` genera además un sitio de archivos, sin servidor, para un hosting estático (véase [Sitio estático](#sitio-estático)). El build y las herramientas de desarrollo siguen ejecutándose con Node. SSR está activo por defecto.

La aplicación generada necesita Node 24 o posterior y TypeScript 7 para comprobar sus declaraciones; el compilador de `.meeko` utiliza internamente TypeScript 6 sólo durante el desarrollo y el build. El paquete es ESM. `vite` es un peer opcional: una aplicación que sólo usa el motor puede importar `@meekojs/meeko` sin iniciar el framework, el servidor, sesiones o Socket. El adaptador Node carga `ws` al activar `attachNodeWebSocketServer`, no al importar el motor.

## Crear una aplicación

```sh
meeko init-framework my-app
cd my-app
npm install
npm run dev
```

El starter crea `meeko.config.ts`, `app/app.meeko`, `app/pages`, `app/styles/main.css`, un layout con outlet y un `.env.example` con las variables de Meeko; no necesita `server/runtime.ts`, porque las sesiones funcionan sin configuración (véase [Autenticación](#autenticación)). Meeko genera las entradas cliente/servidor y sus configuraciones de build bajo `.meeko/`; el consumidor ejecuta `meeko dev`, `meeko check`, `meeko build` y `meeko start` mediante los scripts de `package.json`; `meeko preview` ejecuta también el build. La aplicación puede organizarse así:

```text
app/{pages,layouts,middleware,components,composables,utils,stores,styles}/
server/{api,rpc,socket,middleware,utils}/
shared/{types,schemas,utils,constants,enums}/
layers/base/app/pages/
modules/auth/app/pages/
public/
meeko.config.ts
tsconfig.json
.meeko/{types,manifests,generated,output}/
```

Meeko genera entradas Vite y configuraciones TypeScript por ámbito sólo bajo `.meeko/`. El único `tsconfig.json` raíz conecta VS Code con esos proyectos generados para conservar diagnósticos y autocompletado en archivos `.ts`. `server/runtime.ts`, opcional, es código de la aplicación: declara servicios, política de Socket y, si no bastan las de Meeko, sus propias sesiones. El starter del motor aislado continúa disponible con `meeko init <directory>`.

### Migrar un starter full-stack anterior

Una aplicación generada con `0.0.4` puede adoptar el host de proyecto actual sin mantener entradas manuales. Cambie sus scripts a `meeko dev`, `meeko check`, `meeko build` y `meeko start`; ejecute primero el nuevo build y compare cualquier personalización propia. Después puede retirar `server.mjs`, las entradas cliente/servidor, las configuraciones Vite y los `tsconfig.*` por ámbito que Meeko genera ahora bajo `.meeko/`. El `tsconfig.json` raíz sí permanece como enlace para el editor.

Si desea la convención actual de layouts, mueva el layout raíz a `app/layouts/default.meeko`. No conserve simultáneamente ese archivo y `app/pages/+layout.meeko`, porque ambos representarían el mismo nivel del árbol. Traslade las personalizaciones representables a middleware, handlers y convenciones públicas soportadas. Si una personalización del host o de Vite no tiene todavía una API pública equivalente, conserve el host manual; la migración no debe borrar ni atribuir a `meeko.config.ts` capacidades que no ofrece.

### Migrar `server/session.ts` a `server/runtime.ts`

Meeko ya no carga `server/session.ts`. Si el archivo existe, `meeko check`, `meeko dev` y `meeko build` se detienen con las instrucciones de migración en lugar de ignorarlo. Traslade el `SessionManager` que devolvía `createSessionManager(production)` al export por defecto de `server/runtime.ts` y elimine `server/session.ts`:

```ts
// Antes: server/session.ts
export function createSessionManager(production: boolean) {
  return new SessionManager({ store: createStore(production), production });
}

// Después: server/runtime.ts
import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production, prerendering }) => ({
  sessions: new SessionManager({ store: createStore(production && !prerendering), production: production && !prerendering }),
  services: (request) => ({ /* servicios por petición */ }),
}));
```

`meeko build` crea el runtime con `prerendering: true` para renderizar las rutas `render: "prerender"`; durante esa fase no se sirve tráfico de clientes, por lo que la aplicación puede usar un store en memoria en lugar de abrir la base de producción. Las aplicaciones que importaban herramientas de build desde `@meekojs/meeko/server` deben importarlas desde `@meekojs/meeko/build` (`discoverRoutes`, `discoverServerManifest`, `loadMeekoConfig`, `prerenderProject`…), y `toNodeListener`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler` desde `@meekojs/meeko/node`. `createServerDispatcher`, `createLocalCalls`, `generateOpenApi` y `loadSocketChannels` exigen ahora un cargador explícito, por ejemplo `(file) => import(pathToFileURL(file).href)` en Node.

`app/styles/main.css` es opcional y se carga automáticamente como hoja global en desarrollo y en el build. Vite la incluye en el asset CSS de producción; Meeko enlaza ese asset en el HTML SSR y prerenderizado. Los bloques `<style>` de `.meeko` siguen disponibles para estilos locales.

**PostCSS y Tailwind.** Vite procesa con PostCSS tanto `app/styles/main.css` como los `<style>` de los componentes, con el `postcss.config.*` de la raíz del proyecto. Para Tailwind 4, instale `tailwindcss` y `@tailwindcss/postcss`, declare el plugin y cargue Tailwind en la hoja global; Tailwind lee las clases de los `.meeko`:

```js
// postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```

```css
/* app/styles/main.css */
@import "tailwindcss";
```

En un `<style scoped>`, `@apply` necesita `@reference "tailwindcss";` (o la ruta de la hoja con su tema) al principio del bloque. Desde `1.2`, el CSS de cada componente es el módulo `Componente.meeko?meeko-style=…&lang.css`, junto a su archivo, así que los plugins de PostCSS resuelven `@reference` y los `@import` relativos desde la carpeta del componente.

<a id="utilidades-generadas-con-typescript"></a>**Utilidades generadas con TypeScript.** Desde `1.2`, el plugin de PostCSS `meekoUtilities()` de `@meekojs/meeko/postcss` genera reglas con una función de TypeScript en lugar de repetirlas a mano. La at-rule `@utilities "<ruta>" [layer(<nombre>)];` se sustituye por las reglas que devuelve el export por defecto del módulo:

```ts
// postcss.config.ts
import { meekoUtilities } from "@meekojs/meeko/postcss";

export default { plugins: [meekoUtilities()] };
// O, con la forma de objeto: { plugins: { "@meekojs/meeko/postcss": {} } }
```

```css
/* app/styles/main.css */
@layer tokens, utilities;
@import "./tokens/colors.css" layer(tokens);
@utilities "./utilities/color.ts" layer(utilities);
```

```ts
// app/styles/utilities/palette.ts
export const colors = ["gray", "blue", "red"] as const;
export const steps = Array.from({ length: 12 }, (_, i) => i + 1);
```

```ts
// app/styles/utilities/color.ts
import { defineUtilities } from "@meekojs/meeko/postcss";
import { colors, steps } from "./palette";

export default defineUtilities(({ rule, atRule }) => [
  colors.map((name) =>
    rule(`.color[data-color='${name}']`, Object.fromEntries(steps.map((step) => [`--color-${step}`, `var(--${name}-${step})`])))),
  rule(".color", { color: "var(--color-11)" },
    rule("&:hover", { backgroundColor: "var(--color-3)" }),
    atRule("media", "(prefers-contrast: more)", { color: "var(--color-12)" })),
]);
```

Genera `@layer utilities { .color[data-color='gray'] { --color-1: var(--gray-1); … } … .color { color: var(--color-11); &:hover { … } @media (prefers-contrast: more) { … } } }`. Un bucle de preprocesador, como `@each $size in sm, md, lg` de `postcss-each` (que no forma parte de PostCSS: sin ese plugin, la regla llega al navegador tal cual y no hace nada), se escribe como un `map` de TypeScript:

```ts
// app/styles/utilities/button-sizes.ts
import { defineUtilities } from "@meekojs/meeko/postcss";

const sizes = { sm: "0.25rem 0.5rem", md: "0.5rem 1rem", lg: "0.75rem 1.5rem" };

export default defineUtilities(({ rule }) =>
  Object.entries(sizes).map(([size, padding]) => rule(`.button[data-size='${size}']`, { padding })));
```

La at-rule:

- **Ruta.** Entre comillas y relativa a la hoja que contiene la at-rule: la hoja global, un archivo que esta importa con `@import` o el `<style>` de un `.meeko`, que resuelve desde la carpeta del componente. Admite `.ts`, `.mts`, `.js` y `.mjs`. Sin archivo de origen (CSS procesado sin la opción `from` de PostCSS), la ruta es relativa a `meekoUtilities({ root })`, por defecto `process.cwd()`.
- **`layer(x)`** envuelve el resultado en `@layer x { … }`; `layer` sin nombre crea una capa anónima. Sin `layer`, las reglas quedan en el lugar de la at-rule.
- **No lleva bloque** `{ … }`. Puede aparecer varias veces y dentro de otras reglas o at-rules.
- **Va después de los `@import`.** Para CSS es una regla más, y los `@import` deben preceder a cualquier regla: Vite avisa (`@import statements must precede all other statements`) y no incluye un `@import` que sigue a un `@utilities`.
- **No colisiona con Tailwind.** El nombre es `@utilities`; `@utility`, de Tailwind 4, no se toca.

El módulo exporta por defecto `defineUtilities(fn)` o una función sin envolver. `fn` recibe los helpers, puede ser `async` y devuelve un nodo, un array de salidas (anidado a cualquier profundidad, se aplana en orden) o `null`, `false` y `undefined`, que se omiten, para escribir `condición && rule(…)`.

| Helper | Genera |
| --- | --- |
| `rule(selector, declaraciones?, ...hijas)` | Una regla. Las hijas (otras `rule` con `&`, `atRule`, `css` o arrays) se anidan dentro con anidamiento CSS nativo, como si las escribiera a mano. Si el segundo argumento no es un objeto de declaraciones, es la primera hija. |
| `atRule(nombre, params, declaraciones?, ...hijas)` | Una at-rule, sin `@` en el nombre: `atRule("media", "(min-width: 48rem)", …)`, `atRule("supports", "(display: grid)", …)`, `atRule("property", "--angle", { syntax: "'<angle>'", inherits: "false", initialValue: "0deg" })`. Con sólo `nombre` y `params` es una sentencia: `atRule("layer", "a, b")` da `@layer a, b;`. |
| `` css`…` `` o `css("…")` | CSS literal, que se analiza con PostCSS, para lo que no cabe en los helpers (`@keyframes`, varias reglas copiadas). Conserva las barras invertidas (`content: "\201C"`). |

Las declaraciones son un objeto: las claves en camelCase pasan a kebab-case (`borderRadius` → `border-radius`, `WebkitAppearance` → `-webkit-appearance`, `msFlex` → `-ms-flex`); las claves en kebab-case (`"border-radius"`) y las propiedades personalizadas `--*` se escriben tal cual. Un valor es una cadena, que puede terminar en `!important`, o un número, que se escribe sin unidades (`opacity: 0.5`, `zIndex: 10`). `undefined` omite la declaración y un array escribe una declaración por valor, para los valores de respaldo (`display: ["-webkit-box", "flex"]`, también un array `as const`).

Desde `1.3`, las declaraciones están tipadas con [csstype](https://github.com/frenic/csstype): el editor autocompleta las propiedades estándar y con prefijo de proveedor, y las palabras clave de su valor (`position: "sticky"`), y una propiedad mal escrita (`backgroundColr`) o una palabra clave que no existe es un error de tipos en el editor y al comprobar el módulo con TypeScript. Las longitudes y los tiempos son cadenas con unidad (`padding: "4px"`, `transitionDuration: "200ms"`), salvo el `0`: `padding: 4` es un error, porque se escribiría `padding: 4`, que el navegador descarta. Los números valen donde CSS los admite sin unidad (`opacity`, `zIndex`, `flexGrow`, `lineHeight`, `fontWeight`…). En `atRule`, el objeto admite además los descriptores de `@font-face` (`src`, `fontDisplay`, `unicodeRange`…), `@property` (`syntax`, `inherits`, `initialValue`), `@page`, `@counter-style`, `@font-palette-values` y `@view-transition` (tipo `UtilityAtRuleDeclarations`). Un objeto que se construye fuera de la llamada pierde las palabras clave (`const base = { position: "absolute" }` es `{ position: string }`): anótelo con `UtilityDeclarations` o use `as const`. Un objeto con claves dinámicas, como el `{ [k: string]: string }` de `Object.fromEntries` en el ejemplo de la paleta o un `Record<string, string>`, se acepta sin comprobar sus claves. A la inversa, `UtilityDeclarations` ya no tiene firma de índice: leerlo con una clave `string` (`decls[key]`) es el error `TS7053` con `noImplicitAny`; use `Object.entries(decls)` o una clave `keyof UtilityDeclarations`. Para una propiedad o una at-rule que csstype todavía no conoce, escriba el CSS con `` css`…` ``.

Los tipos `UtilityHelpers`, `UtilityDeclarations`, `UtilityAtRuleDeclarations` (desde `1.3`), `UtilityValue`, `UtilityOutput`, `UtilityNode`, `UtilityRule`, `UtilityAtRule`, `UtilityCss`, `UtilityFunction` y `MeekoUtilitiesOptions` se exportan desde el mismo subpath.

Los errores detienen la hoja con el archivo CSS y la línea del `@utilities`, que Vite muestra en su overlay: un módulo que no existe o con otra extensión, un módulo que no compila, un export por defecto que no es una función, una excepción de la función (con su mensaje), un selector, un nombre de propiedad, un valor o unos parámetros de at-rule no válidos (un `;` o una llave en un valor, un número `NaN`) y un valor de la salida que no es un nodo de los helpers, por ejemplo una cadena de CSS sin `css`. Tras corregir el módulo, la siguiente edición regenera la hoja.

**Carga del módulo y actualización en caliente.** `import()` nativo guarda en caché cada módulo del grafo durante toda la vida del proceso: una query en el módulo de entrada lo recarga a él, pero no a los archivos locales que importa. Por eso el plugin empaqueta el módulo con rolldown, el bundler que Vite 8 ya incluye (no añade dependencias): los archivos locales, también los que llegan por un alias de `tsconfig` o por `#imports` del mismo paquete, forman un único módulo ES que se importa desde una URL `data:`, y los paquetes de `node_modules` quedan externos y se cargan una vez con Node, como en cualquier programa. Así se admite todo TypeScript, imports sin extensión incluidos, e `import.meta.url`, `import.meta.dirname` e `import.meta.filename` siguen describiendo el archivo original. El resultado se reutiliza mientras ningún archivo del grafo cambie de fecha de modificación o de tamaño, de modo que una hoja que se transforma muchas veces no vuelve a empaquetar nada. El plugin publica cada archivo del grafo como dependencia de la hoja (mensajes `dependency` de PostCSS), así que en `meeko dev` editar `color.ts` o `palette.ts` regenera la hoja y Vite actualiza el CSS en caliente, sin recargar la página ni reiniciar el servidor. Guarde estos módulos fuera de las carpetas que Meeko vigila por sus autoimports y sus rutas (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/pages`, `app/layouts`, `shared/…`, `server/utils`, las de `imports`…): un cambio en ellas recarga la página entera, como cualquier otro archivo de esas carpetas; `app/styles/` es el lugar natural. Fuera de Vite 8 (por ejemplo, `postcss-cli`), si no encuentra rolldown, el plugin importa el módulo con la eliminación de tipos nativa de Node, que exige imports con extensión y sintaxis de TypeScript borrable, recarga sólo el módulo de entrada y lo advierte una vez.

**Autoimports.** Desde `1.4`, el módulo de `@utilities` y los módulos locales en TypeScript que importa reciben los mismos autoimports de valores que el resto del proyecto: el plugin aplica, dentro del bundle de rolldown, el registro y la transformación del plugin de Vite, así que un `app/styles/utilities/color.ts` puede usar sin import la constante `THEME_COLORS` de `app/theme/constants.ts` si `meeko.config.ts` declara `imports: { appDirs: ["app/theme"] }`, igual que un componente. Como en el editor y en `meeko check`, cada módulo recibe los de su ámbito según su carpeta (`app/`, `shared/` o `server/` de la aplicación o de un layer); un módulo fuera de esas carpetas no recibe ninguno. Los módulos de `@utilities` se ejecutan en Node mientras se genera el CSS, así que el registro se limita a lo que tiene sentido ahí:

| Llegan | No llegan |
| --- | --- |
| Los exports de valores de `app/composables`, `app/utils`, `app/stores`, `app/types` e `imports.appDirs`; los de `shared/*` e `imports.sharedDirs` (también los `.shared.ts`); los de las mismas carpetas de los layers, y los que añaden los módulos con `addAutoImportsDir` y `addAutoImports` con ámbito `app` o `shared`. | Los de `server/utils`, `imports.serverDirs` y los `.server.ts`; los `.client.ts`; los componentes `.meeko`; los clientes generados (`api`, `rpc`, `socket`, `useApi`…), y las API del framework para componentes y la aplicación en marcha (`signal`, `computed`, `useState`, `href`, `useRoute`, `defineApiRoute`…). |

Usar uno de la segunda columna no da un `ReferenceError` opaco: el nombre se sustituye por un valor que, al usarse (leerlo, llamarlo, convertirlo en texto), lanza un error con el autoimport, su origen y el motivo, que el plugin muestra en la línea del `@utilities`: `"./utilities/color.ts" lanzó un error al generar las utilidades: app/styles/utilities/color.ts usa el autoimport SECRET, que no está disponible al generar el CSS de @utilities: viene de server/utils/secret.ts, que sólo existe en el servidor. …`. Como el error sólo aparece si el valor se usa, un archivo de autoimports que el módulo importa y que además exporta, por ejemplo, un composable con `signal` sigue sirviendo para leer sus constantes. `defineUtilities` no es un autoimport: impórtelo de `@meekojs/meeko/postcss`, porque declararlo global lo ofrecería también a los componentes y llevaría PostCSS al bundle del navegador. Los tipos son los de `app/` (`.meeko/tsconfig.app.json`), así que `meeko check` y el editor dan `TS2304` al usar en `app/styles/` un export de `server/utils`, como en el resto de `app/`; en cambio aceptan los nombres del navegador y del framework de la tabla, que fallan al generar la hoja con el error anterior.

El proyecto es la carpeta más cercana al módulo con un `meeko.config.*`, sin pasar de su `package.json`, o la de ese `package.json` si depende de `@meekojs/meeko`; su configuración se ejecuta como en `meeko dev`, con los `setup` de sus módulos, una vez por hoja y sólo si el módulo se va a empaquetar con rolldown. Si leerla falla (una configuración o un `setup` que lanza), la hoja se genera igual, sin autoimports, con un aviso de PostCSS que da el motivo. Los archivos de autoimports que el módulo usa forman parte de su grafo: son dependencias de la hoja, y cambiarlos la regenera. Añadir o quitar un export en una carpeta de autoimports también vuelve a empaquetar el módulo en la siguiente transformación, aunque ningún archivo de su grafo haya cambiado; en `meeko dev`, esos cambios recargan la página entera, como en cualquier otra carpeta de autoimports. `meekoUtilities({ autoImports: false })` desactiva los autoimports y empaqueta los módulos como en `1.3`. Fuera de un proyecto Meeko (un `postcss-cli` o un bundler en otro proyecto) no hay registro y nada cambia. Sin rolldown, con el `import()` nativo, Node no permite añadir imports: el módulo no recibe autoimports, la configuración no se ejecuta y el aviso de carga nativa lo indica; escriba los imports.

Las reglas generadas en un `<style scoped>` no reciben el atributo de ámbito: Meeko aplica el ámbito al compilar el bloque y PostCSS genera las reglas después, así que son globales, como las de `app/styles/main.css`. El plugin sólo se ejecuta en Node, durante `meeko dev` y el build; `@meekojs/meeko/postcss` no forma parte del runtime del navegador ni del servidor.

**Con Tailwind.** Declare `meekoUtilities()` antes de `@tailwindcss/postcss`:

```ts
// postcss.config.ts
import tailwindcss from "@tailwindcss/postcss";
import { meekoUtilities } from "@meekojs/meeko/postcss";

export default { plugins: [meekoUtilities(), tailwindcss()] };
```

En ese orden, Tailwind recibe las reglas generadas como el resto de la hoja y procesa, por ejemplo, el `@apply` de un `` css`…` ``; con `layer(utilities)` quedan en la misma capa `utilities` que las de Tailwind. En el orden inverso, Tailwind compila primero cada hoja que importa `tailwindcss` y elimina las at-rules que no conoce, `@utilities` incluida, sin error; el plugin lo advierte una vez por proceso. En una hoja sin `@import "tailwindcss"`, como el `<style>` de un componente, el orden no importa.

<a id="hoja-global-procesada-para-el-editor"></a>**Hoja global procesada para el editor.** Las clases que generan las `@utilities`, y las de los archivos que la hoja importa, no están escritas en ningún archivo CSS del proyecto. Por eso `meeko dev` escribe `app/styles/main.css` ya procesada en `.meeko/styles/main.css`: la misma hoja que sirve en `/app/styles/main.css?direct`, con los `@import` resueltos, las `@utilities` expandidas y el resto de plugins de PostCSS aplicados, sin minificar y con un comentario inicial que indica que es generada. La escribe en segundo plano en cuanto el servidor escucha, sin retrasar el arranque, y la reescribe cada vez que cambian la hoja o algo de lo que depende: un archivo importado, un módulo de `@utilities` o un archivo que ese módulo importa. También tras un reinicio de Vite (por ejemplo, al cambiar `.env`).

- Sólo sustituye el archivo cuando cambia su contenido, y de forma atómica (escribe un temporal y lo renombra), así que un lector nunca ve media hoja. Vite no vigila `.meeko/`: escribirla no recarga la página ni provoca otra regeneración.
- Si la hoja no compila (un error de PostCSS o de un módulo de `@utilities`), el archivo conserva la última versión buena, el servidor sigue funcionando y la consola lo indica una vez: `[meeko] .meeko/styles/main.css conserva la versión anterior: app/styles/main.css no compila (…)`. El siguiente cambio que la arregla la regenera.
- Sin `app/styles/main.css` no hay archivo; si la hoja se borra con `meeko dev` en marcha, también se borra el archivo.
- `meeko build` no lo escribe: el CSS del build está minificado y mezcla la hoja global con los `<style>` de los componentes. El archivo se conserva al detener `meeko dev`, así que basta con haberlo ejecutado una vez; `meeko clean` lo elimina con el resto de `.meeko/`.
- Nada lo carga en ejecución y no debe editarse a mano. Las `url()` aparecen como las reescribe Vite en desarrollo.

Sirve a las extensiones del editor que completan clases a partir de hojas CSS en disco. Con [HTML CSS Support](https://marketplace.visualstudio.com/items?itemName=ecmel.vscode-html-css) (`ecmel.vscode-html-css`) en VS Code:

```json
// .vscode/settings.json
{ "css.styleSheets": [".meeko/styles/main.css"] }
```

La ruta es relativa a la carpeta del workspace. La extensión busca los archivos locales con la búsqueda de VS Code, que aplica `files.exclude` pero no `.gitignore` ni `search.exclude`: encuentra el archivo aunque `.meeko/` esté en `.gitignore`, como en el starter. Si su `files.exclude` oculta `.meeko`, la extensión tampoco lo verá; oculte en su lugar sólo las carpetas que no quiera ver, por ejemplo `".meeko/output": true`. La extensión guarda cada hoja local en caché y sólo la vuelve a leer cuando se guarda desde el propio editor: tras un cambio que regenera el archivo, ejecute **CSS: Clear style sheets cache** desde la paleta de comandos para ver las clases nuevas. Por defecto sólo completa en HTML; para los `.meeko`, añada `"css.enabledLanguages": ["html", "meeko"]` en la configuración de usuario (la extensión no lo admite por workspace) y reinicie VS Code.

En desarrollo, Vite abre un WebSocket HMR en un puerto derivado del puerto HTTP para que dos aplicaciones Meeko no compitan por el puerto predeterminado de Vite. `MEEKO_HMR_PORT` permite fijarlo explícitamente cuando el entorno lo exige; el navegador debe poder acceder a ese puerto además del HTTP de la aplicación.

<a id="variables-de-entorno-y-env"></a>**Variables de entorno y `.env`.** Desde `1.2`, `meeko dev`, `build`, `start`, `preview` y `check` cargan el `.env` de la raíz del proyecto en `process.env`, como Vite y Nuxt en desarrollo. Una variable que el entorno ya define tiene prioridad, así que el entorno real de un despliegue nunca se sustituye. La salida de `meeko build` ejecutada directamente (`node .meeko/output/node/index.mjs`, un contenedor) no lee `.env`: en producción las variables llegan del entorno. Cambiar `.env` exige reiniciar `meeko dev`. Meeko lee estas variables:

| Variable | Comandos | Efecto |
| --- | --- | --- |
| `MEEKO_PORT`, `MEEKO_HOST` | `dev`, `start`, `preview` y la salida de Node, Bun y Deno | Puerto y dirección; sustituyen a `server.port` y `server.host`. Por defecto, `127.0.0.1:4173`. Sin `MEEKO_PORT` se lee `PORT`, que inyectan plataformas como Coolify, Railway o Cloud Run. |
| `MEEKO_PUBLIC_ORIGIN` | `dev`, `start`, `preview` y la salida de Node, Bun, Deno y Workers; desde `1.3`, también `build` | Origen público tras un proxy HTTPS, para las comprobaciones de `Origin` de HTTP y Socket. En `build`, y sólo si falta `site` en `meeko.config.ts`, el origen de las URL absolutas de `sitemap.xml`, `robots.txt` y `document.seo`; el build sólo la lee cuando escribe alguna. Como en el servidor, cuenta sólo el origen de la URL: `https://example.com/app` vale `https://example.com`. |
| `MEEKO_REDIS_URL` | La salida de Node, Bun y Deno | Redis de las sesiones en producción cuando `server/runtime.ts` no declara `sessions`; véase [Sesiones sin configuración](#sesiones-sin-configuración). |
| `MEEKO_REDIS_PREFIX` | Ídem | Prefijo de sus claves; por defecto, `meeko:<name de package.json>:prod:`. |
| `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` | `dev` y producción | Duración (`12h`, `7d`…; 7 días por defecto) y `SameSite` (`Lax` por defecto, o `Strict`) de esas sesiones. |
| `MEEKO_TRUST_PROXY` | `dev` y producción | Proxies de confianza delante del servidor (un número, o `true` para todos), cuyas entradas de `X-Forwarded-For` dan la IP del cliente de `context.clientAddress`, `clientAddress(request)` y `rateLimit`; véase [IP del cliente tras un proxy](#ip-del-cliente-tras-un-proxy). Sin ella, `X-Forwarded-For` nunca se lee. |
| `MEEKO_HMR_PORT` | `dev` | Puerto del WebSocket de HMR; sin él, se deriva del puerto HTTP. |
| `MEEKO_EDITOR_BRIDGE=0` | `dev` | Desactiva el puente con el editor (valores en vivo). |
| `MEEKO_LINK_WATCH=0` | `dev` | No reinicia `meeko dev` al reconstruir un `@meekojs/meeko` enlazado; avisa en la terminal de que hay que reiniciarlo. |

Desde `1.2`, todas las variables que lee Meeko empiezan por `MEEKO_`; el prefijo queda reservado para Meeko, así que las variables propias de la aplicación deben usar otro nombre. `HOST` y `PUBLIC_ORIGIN`, los nombres anteriores, siguen funcionando durante 1.x cuando falta la variable nueva, con un aviso por proceso que nombra su reemplazo, y dejarán de leerse en `2.0`. `PORT` no está obsoleta: es el respaldo permanente de `MEEKO_PORT`.

Si ni `MEEKO_PORT` (o `PORT`) ni `server.port` fijan el puerto, `meeko dev` usa el primero libre a partir de `4173` (hasta `4192`), como Vite: con otro `meeko dev` ya en `4173`, el segundo escribe `[meeko] El puerto 4173 está en uso; meeko dev usa el 4174` y la URL real, y deriva de ese puerto el del WebSocket HMR y el descriptor del puente con el editor (`.meeko/dev/editor-bridge-4174.json`). Un puerto fijado con `MEEKO_PORT`, `PORT` o `server.port` no cambia: si está ocupado, `meeko dev` termina con `El puerto 4173 de 127.0.0.1 ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev`.

El SSR de desarrollo carga `@meekojs/meeko` desde Node, fuera del module runner de Vite, como el build; así una aplicación que consume Meeko con `link:` mantiene una sola instancia del runtime aunque Vite recargue sus módulos. Por eso, cuando `@meekojs/meeko` está enlazado (`link:` de pnpm, `npm link` o un workspace: el paquete se resuelve fuera de todo `node_modules`), `meeko dev` ejecuta el servidor en un proceso hijo y vigila `dist/` y `package.json` del paquete enlazado. Al reconstruirlo, espera a que la compilación termine (400 ms sin cambios), escribe `[meeko] Meeko enlazado cambió; reiniciando meeko dev…`, cierra el servidor anterior (Socket, HTTP, Vite y el descriptor del puente con el editor) y arranca otro proceso en el mismo puerto, con el mismo entorno. Si el nuevo proceso no arranca, por ejemplo porque la compilación quedó a medias, lo informa y vuelve a intentarlo con el siguiente cambio. Sólo cuentan las escrituras: leer el build no lo reinicia, aunque Windows notifique como cambio la actualización de la fecha de último acceso. `Ctrl+C` detiene ambos procesos. Con una instalación normal desde el registro no se vigila nada más.

`MEEKO_LINK_WATCH=0` (también desde el `.env` del proyecto) desactiva el reinicio con un paquete enlazado: un solo proceso sirve hasta que se detiene. Ese proceso conserva el código de servidor de Meeko que cargó, mientras Vite sirve al navegador los archivos nuevos de `dist/`, así que tras una reconstrucción el HTML del servidor (cabeceras, `<head>`, SSR) sale del build anterior y la hidratación usa el nuevo. Por eso, en cada reconstrucción, cuando termina, escribe `[meeko] Meeko enlazado cambió (…/dist), pero este meeko dev no se reinicia solo (MEEKO_LINK_WATCH=0): el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.` Reinícielo antes de comprobar el resultado.

## Configuración

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";
import seo from "@acme/meeko-seo";

export default defineMeekoConfig({
  layers: ["./layers/base"],
  modules: [[seo, { siteUrl: "https://example.com" }], "./modules/hello"],
  imports: {
    appDirs: ["app/services"],
    sharedDirs: ["shared/validators"],
    serverDirs: ["server/services", "server/repositories"],
  },
  document: { lang: "es", head: { meta: [{ name: "theme-color", content: "#0f172a" }] } },
});
```

`meeko.config.ts` (o `.mts`, `.js`, `.mjs`) se carga con Node y exporta un objeto creado con `defineMeekoConfig`:

- `layers` (desde `1.2`): carpetas que aportan páginas, componentes, autoimports y plugins; véase [Layers](#layers). `extends`, el nombre anterior, sigue funcionando como alias.
- `modules`: módulos creados con `defineMeekoModule`, que configuran el proyecto desde código; véase [Módulos](#módulos).
- `imports`: carpetas de autoimports además de las de por defecto, con el ámbito de la carpeta que las contiene; véase [Autoimports y TypeScript](#carpetas-de-autoimports).
  - `imports.appDirs` (desde `1.3`): carpetas dentro de `app/` (`"app/services"`), con el ámbito de `app/`: navegador y SSR, no `shared/` ni `server/`.
  - `imports.sharedDirs` (desde `1.3`): carpetas dentro de `shared/` (`"shared/validators"`), con el ámbito de `shared/`: aplicación y servidor.
  - `imports.serverDirs`: carpetas dentro de `server/`, exclusivas del servidor.
- `server`: el adaptador de `meeko build`; véase [Build, despliegue y verificación](#build-despliegue-y-verificación).
- `document` (desde `1.2`): `lang` y las entradas de `<head>` de todos los documentos. Los módulos añaden las suyas con `meeko.addHead`; las de `document.head` se aplican después, así que el `title` del proyecto gana. Desde `1.3`, `document.seo` añade la URL canónica y Open Graph de cada página; véase [Canónica y Open Graph por página](#canónica-y-open-graph-por-página). Desde `1.5`, `document.idPrefix` es el prefijo de los IDs de [`useId`](api.md#ids-estables-useid) y de `form.field` (`m` por defecto).
- `dev` (desde `1.3`): opciones de `meeko dev`. `serverLogs: false` desactiva los [logs del servidor en la consola del navegador](#logs-del-servidor-en-la-consola-del-navegador).
- `site` (desde `1.3`): la URL pública del sitio (`"https://example.com"`, sólo el origen). Es el origen de las URL absolutas que escribe Meeko: `sitemap.xml`, `robots.txt` y `document.seo`. Sin `site`, el build usa `MEEKO_PUBLIC_ORIGIN`. No cambia las comprobaciones de `Origin`, que siguen leyendo `MEEKO_PUBLIC_ORIGIN` o `publicOrigin` de `server/runtime.ts` al ejecutarse.
- `sitemap` y `robots` (desde `1.3`): `sitemap.xml` y `robots.txt` generados en el build; véase [`sitemap.xml` y `robots.txt`](#sitemapxml-y-robotstxt).
- `theme` (desde `1.4`): el tema claro/oscuro, y temas propios, sin parpadeo, con `useTheme()`; véase [Tema claro/oscuro sin parpadeo](#tema-clarooscuro-sin-parpadeo).
- `alias` (desde `1.5`): aliases de ruta propios, o cambios de `~/`, `@/`, `#shared/` y `#server/`, los que Meeko define por defecto; véase [Aliases de ruta](#aliases-de-ruta).

Desde `1.2`, `css: { scopeAttribute: "matched" }` limita el atributo de `<style scoped>` a los elementos que algún selector con ámbito puede seleccionar; con `"all"`, el valor por defecto en `1.x`, va en todos los elementos de la plantilla. `"matched"` pasará a ser el valor por defecto en `2.0`. Véase [Estilos con ámbito](api.md#qué-elementos-reciben-el-atributo), con el caso de las clases que el script añade con la API del DOM.

La configuración se ejecuta en `meeko dev`, `meeko build` y `meeko check`. En un workspace de confianza el servidor de lenguaje también la ejecuta, con sus módulos, por lo que las listas pueden construirse dinámicamente; en un workspace no confiable (o con `trusted: false`, ver [editores](editors.md)) el editor no ejecuta código del proyecto: lee `layers`, `extends`, `imports.appDirs`, `imports.sharedDirs` e `imports.serverDirs` como arrays literales de cadenas y, de `modules`, sólo las cadenas literales que son carpetas de layer. Desde `1.5` lee también `alias` cuando es un objeto literal de cadenas y `false`. Los autoimports y componentes de los módulos no existen para ese editor hasta que se confía en el workspace.

El descubrimiento de servidor también rechaza árboles de cliente imposibles. Por ejemplo, no permite que `api.users.get()` sea a la vez una función y el padre de `api.users.get.post()`, ni que un procedimiento `rpc.users()` sea el padre de `rpc.users.get()`. El error se produce al generar el manifiesto e identifica ambos archivos, antes de inicializar el cliente o emitir tipos contradictorios.

`meeko routes .` descubre todas las fuentes, emite `.meeko/manifests/routes.json` y declaraciones de rutas, contratos y autoimports; desde `1.7` prepara `.meeko/` igual que `meeko check` (también las entradas de Vite, `services.d.ts` y los `tsconfig.*.json`), sin ejecutar TypeScript. Vite genera módulos virtuales a partir del mismo descubrimiento para SSR, hidratación y navegación. En desarrollo, editar una página o layout existente actualiza el módulo SSR y recarga el navegador; el servidor conserva el almacén de sesiones. Los sidecars y handlers API/RPC existentes se cargan desde Vite al llamarlos.

Al crear o eliminar una página, un layout, `app/app.meeko`, `app/error.meeko`, un middleware de `app/middleware` o `server/middleware`, un plugin de `app/plugins`, o un módulo de `server/api`, `server/rpc` o `server/socket`, en el proyecto o en sus layers, `meeko dev` vuelve a descubrir las rutas y crea de nuevo la aplicación sin reiniciar el proceso:

- Las peticiones que llegan mientras tanto esperan a la aplicación nueva, y el navegador se recarga.
- El servidor Socket se vuelve a enganchar a la aplicación nueva; las conexiones abiertas se cierran.
- La aplicación nueva llama otra vez a `server/runtime.ts`, así que un almacén de sesiones en memoria empieza vacío y las sesiones abiertas se pierden.
- Si la aplicación nueva no se puede crear (por ejemplo, con dos layouts raíz), Meeko registra el error y sigue sirviendo la anterior hasta que se corrija.

Cuando Vite se reinicia (al cambiar un `.env` o una dependencia de su configuración), `meeko dev` también crea de nuevo la aplicación, con las mismas consecuencias, una vez que el servidor de Vite nuevo está listo. Si coincide con la creación o eliminación de una ruta, crea una sola aplicación.

Crear, editar o eliminar un `.ts` de una carpeta de autoimports (las de por defecto y, desde `1.3`, las de `imports.appDirs`, `sharedDirs` y `serverDirs`) vuelve a leer el registro de autoimports e invalida los módulos, y el navegador se recarga; no hace falta reiniciar. Editar un canal Socket existente, cambiar `meeko.config.ts` (también las listas de `imports`) o editar el código de `setup` de un módulo sigue exigiendo reiniciar `npm run dev` (los archivos de runtime de un módulo, como sus plugins o componentes, se recargan como los del proyecto). Los tipos y manifiestos de `.meeko/` no se regeneran en `meeko dev`: ejecute `npm run check` para actualizarlos.

El observador de archivos de Vite ignora todo `.meeko/` salvo `.meeko/generated`, las entradas que sirve. Así, `meeko check`, el servidor de lenguaje o un build que escriben en `.meeko/check`, `routes`, `types`, `manifests`, `output`, `build` o en los `tsconfig.*` generados mientras corre `meeko dev` no recargan el navegador, y el escaneo de dependencias de Vite tampoco entra en `.meeko/`.

### Logs del servidor en la consola del navegador

Desde `1.3`, en `meeko dev`, lo que el código de servidor escribe con `console.log`, `info`, `warn`, `error` o `debug` mientras atiende una petición aparece también en la consola del navegador, como `features.devLogs` de Nuxt. La terminal lo sigue mostrando igual: los logs se copian, no se desvían.

- **Qué se reenvía.** Cada llamada se asocia a su petición por el contexto asíncrono de esa petición, así que dos peticiones simultáneas no mezclan sus logs. Cuenta todo lo que se ejecuta para ella: middleware de servidor y de ruta, loaders, `<script server>`, plugins `*.server.ts`, el render, los clientes `api.*` y `rpc.*` del SSR, handlers de API y RPC y el trabajo asíncrono que inician, también el de `waitUntil`. Lo que se escribe fuera de una petición (el arranque, la fábrica de `server/runtime.ts`, Vite, los callbacks de Socket) sólo va a la terminal.
- **Cómo llega.**
  - El documento HTML lleva los logs de su render en `<head>`, y el navegador los imprime al cargar, antes de hidratar en la práctica. Los dos scripts que Meeko añade allí llevan el nonce del documento (el `'nonce-…'` de su cabecera `Content-Security-Policy` o, sin él, el atributo `nonce` de sus scripts, que escribe `DocumentOptions.nonce`), así que funcionan con una CSP con nonce o con `'strict-dynamic'`.
  - Con `render: "stream"`, los que se escriben mientras llegan los valores diferidos van en el stream, detrás del bloque al que pertenecen y siempre fuera de `#app`, que el navegador hidrata.
  - Una navegación cliente recibe los logs de su petición de datos en el payload.
  - Las peticiones de API y RPC, y lo que se escribe después de completar una respuesta, llegan por el WebSocket de HMR de Vite. Como no se sabe qué pestaña hizo la petición, se imprimen en todas las pestañas abiertas de la aplicación, con el método, la ruta y el `requestId`.
- **Cómo se ve.** Cada petición es un grupo de la consola con la insignia `server`, el método, la ruta y el principio del `requestId` (el de la cabecera `x-request-id`), y cada log lleva la misma insignia y su nivel (`console.warn` es un aviso, `console.error` un error). Los objetos se pueden desplegar como en el servidor: `Map`, `Set`, fechas, `bigint`, referencias circulares y nombres de clase. Un `Error` muestra la traza del servidor, con sus archivos y líneas, y su `cause`. Las funciones, los símbolos y los datos binarios se muestran por su nombre o su descripción. Los getters no se ejecutan y los proxies no se atraviesan. Un valor más profundo de 8 niveles, una colección de más de 100 elementos o un texto de más de 10 000 caracteres se recortan; una petición con más de 500 logs, o con más de 1 MB de ellos, avisa de cuántos quedaron sólo en la terminal.
- **Sin duplicados.** Cada log llega una sola vez al navegador, por un único camino. El informe de un error de petición que Meeko ya escribe (`[meeko] request error <id>` y el error con su traza) llega también por este camino y una sola vez. Con `server.forwardConsole` de Vite, que copia la consola del navegador en la terminal, los logs del servidor no vuelven a la terminal.
- **Sólo en desarrollo.** Ni la captura de `console` ni el código del navegador existen en `meeko build`, `meeko start` o `meeko preview`: el HTML, los payloads y los bundles de producción no los incluyen.
- **Sólo para el navegador del desarrollador.** Las respuestas sólo llevan los logs si la petición llega desde loopback (`127.0.0.0/8` o `::1`), con una cabecera `Host` de loopback (`localhost`, un subdominio de `.localhost`, `127.x.x.x` o `[::1]`) y sin cabeceras de proxy (`Forwarded`, `Via`, `X-Forwarded-*`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP` y similares). El host de `MEEKO_PUBLIC_ORIGIN` no cuenta como propio: un túnel o un proxy local (ngrok, cloudflared, los *dev tunnels* de VS Code, Tailscale) conecta desde loopback y publica justamente ese nombre, así que sus visitantes no reciben los logs aunque el túnel reescriba `Host` a `localhost`, porque añade cabeceras de reenvío. Con `MEEKO_HOST=0.0.0.0` (para probar desde un móvil, por ejemplo), o tras un túnel, un navegador de otra máquina no recibe logs en sus respuestas: los de sus peticiones se imprimen en las pestañas del propio equipo, porque el WebSocket de HMR de Meeko sólo escucha en `127.0.0.1`. Ese puerto (`MEEKO_HMR_PORT`) no debe publicarse por un túnel: quien se conecte a él recibe los logs de todas las peticiones, como una pestaña local.

Para desactivarlo:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ dev: { serverLogs: false } });
```

El `href` tipado no admite `params` en rutas sin parámetros. Para rutas dinámicas exige las claves declaradas en el manifiesto; el runtime comprueba además sus valores y rechaza claves extra.

`href` tiene dos formas con los mismos tipos. `href(id, options)` usa el manifiesto de la aplicación en ejecución: en el servidor, el de la petición en curso (SSR, loaders, `head`, prerender, API, RPC y middleware de servidor); en el navegador, el que recibió `mountClientApp`, desde la hidratación hasta `dispose()`. Es la forma habitual en páginas y layouts:

```ts
const link = href("/users/[id]", { params: { id: user.id }, search: { tab: "profile" } });
```

Fuera de una aplicación (por ejemplo, en una prueba unitaria sin app) la forma corta lanza un error; ahí se pasa el manifiesto con `href(routes, id, options)`, que se mantiene igual.

## Layers

Un layer es una carpeta del proyecto con la misma estructura que la aplicación: su `app/pages`, sus componentes y autoimports (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`, `shared/` y `server/utils`) y, desde `1.2`, sus plugins de `app/plugins`. Las carpetas de `imports.appDirs`, `sharedDirs` y `serverDirs` del proyecto se buscan también dentro de cada layer, con la misma ruta relativa (`app/services` es `layers/base/app/services` en el layer `./layers/base`). Use layers para una base compartida (diseño, páginas comunes) o para dividir una aplicación grande por áreas.

```ts
export default defineMeekoConfig({
  layers: ["./layers/base", "./layers/admin"],
});
```

El orden de las fuentes es: la aplicación, `extends`, `layers`, las carpetas de layer que quedan en `modules` (véase más abajo) y los layers que añaden los módulos con `meeko.addLayer`. Cada layer necesita su carpeta `app/pages` y un nombre de carpeta en minúsculas, dígitos y guiones que no se repita; aparece con ese nombre en los diagnósticos. Las rutas de `layers` y `extends` deben vivir dentro del proyecto, también después de resolver los enlaces.

Las páginas de un layer se muestran dentro del shell del proyecto: `app/app.meeko` y el layout raíz de la aplicación (`app/layouts/default.meeko` o `app/pages/+layout.meeko`) envuelven también a las páginas de los layers, y los `+layout.meeko` propios del layer se anidan dentro. Desde `1.5`, los [layouts con nombre](#layouts-con-nombre) de un layer (`layers/base/app/layouts/docs.meeko`) también sirven a las páginas del proyecto y de los demás layers; véase [Layouts de layers y módulos](#layouts-de-layers-y-módulos). Si el proyecto tiene `app.meeko` o layout raíz, sustituyen a los equivalentes del layer; si no, se usan los del layer. Una página de layer que falla usa el `+error.meeko` más cercano de su propio árbol, después el `app/error.meeko` del layer y, por último, la página de error raíz del proyecto. La `404` de una URL sin ruta siempre usa la del proyecto. Los módulos de rutas programáticos (`RouteModule.routes()` de `composeFrameworkRoutes`) siguen declarando sus propios layouts. El manifiesto rechaza colisiones de URL y el registro rechaza nombres de autoimport repetidos; el diagnóstico incluye los archivos en conflicto.

`extends` es el nombre que tenía `layers` hasta `1.1` y sigue funcionando en `1.x`, sin aviso; sus carpetas van antes que las de `layers`.

Desde `1.5`, los [aliases de ruta](#aliases-de-ruta) `~/`, `@/`, `#shared/` y `#server/` se buscan en el proyecto y después en cada layer, en este mismo orden; véase [Aliases en los layers](#aliases-en-los-layers).

### Carpetas en `modules` (deprecado)

Hasta `1.1`, `modules` también listaba carpetas con `app/pages`, que se comportaban como layers. Desde `1.2`, `modules` es para [módulos](#módulos). Una cadena de `modules` que apunta a una carpeta con `app/pages` y sin módulo (sin `package.json` ni `index.ts`) sigue funcionando como layer durante toda la serie `1.x`, en la misma posición que antes. `meeko dev`, `meeko build` y `meeko check` escriben una vez por proceso:

```text
[meeko] Aviso: "./modules/auth" en modules de meeko.config.ts es una carpeta de layer (tiene app/pages y no es un módulo). Muévela a layers: ["./modules/auth"]; las carpetas en modules dejarán de funcionar en Meeko 2.0.
```

Para migrar, mueva la cadena de `modules` a `layers`. Una carpeta de layer no admite opciones: `["./modules/auth", { … }]` es un error.

## Módulos

Un módulo configura el proyecto desde código, como los módulos de Nuxt: añade componentes, autoimports, plugins, middleware y handlers de servidor, entradas de `<head>`, archivos públicos y plugins de Vite, y reacciona a los hooks del build. Se crea con `defineMeekoModule` y se lista en `modules`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";
import hello from "./modules/hello/index.ts";

export default defineMeekoConfig({
  modules: [
    hello,                                  // un módulo importado
    "@acme/meeko-seo",                      // un paquete, resuelto desde el proyecto
    ["./modules/accent", { initial: "teal" }], // una ruta y opciones en línea
  ],
  hello: { greeting: "Hola" },              // opciones en la clave del módulo (meta.configKey)
});
```

Una cadena es un nombre de paquete (con o sin subruta) o una ruta relativa al proyecto: un archivo, o una carpeta con `package.json` (su export `import`/`default`) o con `index.ts`, `index.mts`, `index.js` o `index.mjs`. El export por defecto debe ser el resultado de `defineMeekoModule`. Las opciones se combinan así: `defaults` del módulo, después `config[meta.configKey]` y por último las de `[módulo, opciones]`; los objetos planos se combinan en profundidad y los arrays se sustituyen. Dos módulos con el mismo `meta.name` son un error. Con `meta.compatibility.meeko` (un rango de npm, como `">=1.2"` o `"^1.2.0"`), la carga falla si la versión de Meeko queda fuera.

### Escribir un módulo

El `setup` se ejecuta en Node, una vez por configuración y proceso, al cargar la configuración: en `meeko dev`, `meeko build`, `meeko check` y en el servidor de lenguaje de un workspace de confianza. Nunca llega al navegador. Recibe las opciones combinadas y el objeto `meeko`. Las rutas que recibe `meeko` pueden ser absolutas, URL `file:` (`new URL("./x", import.meta.url)`, lo habitual en un paquete) o relativas a la raíz del proyecto.

Un módulo de color de acento, que el usuario elige y que se aplica antes de pintar (para el tema claro/oscuro no hace falta un módulo: Meeko lo trae desde `1.4`, véase [Tema claro/oscuro sin parpadeo](#tema-clarooscuro-sin-parpadeo)):

```ts
// modules/accent/index.ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export type Accent = "teal" | "violet" | "amber";

export interface AccentOptions {
  initial: Accent;
  storageKey: string;
}

// Tipa la clave `accent` de meeko.config.ts.
declare module "@meekojs/meeko/framework" {
  interface MeekoConfig {
    readonly accent?: Partial<AccentOptions>;
  }
}

export default defineMeekoModule<AccentOptions>({
  meta: { name: "@acme/meeko-accent", configKey: "accent", compatibility: { meeko: ">=1.2" } },
  defaults: { initial: "teal", storageKey: "accent" },
  setup(options, meeko) {
    const here = (path: string) => new URL(path, import.meta.url);
    // <AccentPicker /> en cualquier componente, sin import.
    meeko.addComponentsDir(here("./components"), { prefix: "Accent" });
    // useAccent() sin import, en componentes y en app/.
    meeko.addAutoImports({ name: "useAccent", from: here("./runtime/use-accent.ts") });
    // Publica la señal del acento antes de hidratar; las opciones llegan al plugin.
    meeko.addPlugin({ src: here("./runtime/accent.plugin.ts"), options: { initial: options.initial, storageKey: options.storageKey } });
    // Aplica el acento guardado antes de pintar, sin parpadeo.
    meeko.addHead({
      script: [{ key: "accent", children: `document.documentElement.dataset.accent = localStorage.getItem(${JSON.stringify(options.storageKey)}) ?? ${JSON.stringify(options.initial)};` }],
    });
  },
});
```

```ts
// modules/accent/runtime/use-accent.ts
import { createContext, inject } from "@meekojs/meeko";
import type { Signal } from "@meekojs/meeko";
import type { Accent } from "../index.ts";

export const accentKey = createContext<Signal<Accent>>("accent");

export function useAccent(): Signal<Accent> {
  return inject(accentKey);
}
```

```ts
// modules/accent/runtime/accent.plugin.ts
import { effect, signal } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";
import type { Accent } from "../index.ts";
import { accentKey } from "./use-accent.ts";

export default definePlugin<{ initial: Accent; storageKey: string }>((app, options) => {
  // El mismo valor inicial en el servidor y en el navegador, para que la hidratación coincida.
  const accent = signal(options.initial);
  app.provide(accentKey, accent);
  if (app.side === "client") {
    let first = true;
    effect(() => {
      const value = accent.value;
      // El script de <head> ya aplicó el acento guardado; después, cada cambio se aplica y se guarda.
      if (first) { first = false; return; }
      document.documentElement.dataset.accent = value;
      localStorage.setItem(options.storageKey, value);
    });
  }
});
```

Un módulo de SEO genera `sitemap.xml` a partir de las rutas y `robots.txt`:

```ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export default defineMeekoModule<{ siteUrl: string }>({
  meta: { name: "@acme/meeko-seo", configKey: "seo" },
  setup(options, meeko) {
    let routes: readonly { id: string }[] = [];
    meeko.hooks.hook("routes:resolved", (context) => { routes = context.routes; });
    meeko.addPublicFile("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${options.siteUrl}/sitemap.xml\n`);
    // Una función se evalúa al escribir el build (y en cada petición en dev), con las rutas ya descubiertas.
    meeko.addPublicFile("sitemap.xml", () => [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...routes.filter((route) => !route.id.includes("[")).map((route) => `<url><loc>${options.siteUrl}${route.id}</loc></url>`),
      "</urlset>",
    ].join("\n"));
  },
});
```

Los archivos de runtime de un módulo (plugins, componentes, autoimports, middleware y handlers) los procesa Vite como los del proyecto, pero fuera de las carpetas de la aplicación no reciben autoimports: impórtelos de forma explícita. Los componentes `.meeko` de `addComponentsDir` sí reciben los autoimports del proyecto.

### El objeto `meeko`

| Miembro | Qué hace |
| --- | --- |
| `rootDir`, `dev`, `config` | Carpeta del proyecto, `true` en `meeko dev` y la configuración cargada. |
| `addLayer(dir)` | Añade un layer, después de los de `layers`. Debe tener `app/pages` y estar dentro del proyecto; un paquete instalado en `node_modules` lo está, también con pnpm. |
| `addComponentsDir(dir, { prefix })` | Autoimporta los `.meeko` de la carpeta y sus subcarpetas, con el nombre en PascalCase tras el prefijo (`components/picker.meeko` con `prefix: "Accent"` es `AccentPicker`). |
| `addLayout(name, file)` | Desde `1.5`, añade un [layout con nombre](#layouts-con-nombre), como un archivo de `app/layouts`: `meeko.addLayout("docs", here("./docs-layout.meeko"))`. El archivo debe estar dentro del proyecto. Un layout del proyecto o de un layer con el mismo nombre gana; dos módulos con el mismo nombre son un error. |
| `addAutoImports(entries)` | Autoimporta exports de un paquete o archivo: `{ name, as?, from, type?, scope? }`; `scope` es `"app"` por defecto (componentes y `app/`, en el navegador y en SSR), `"client"`, `"server"` o `"shared"`. |
| `addAutoImportsDir(dir, { scope })` | Autoimporta los exports de los `.ts` de una carpeta, con ámbito `"app"`, `"server"` o `"shared"`; los sufijos `.client.ts`, `.server.ts` y `.shared.ts` mandan. |
| `addPlugin({ src, mode?, options? })` | Añade un [plugin de aplicación](#plugins-de-aplicación). `mode` sale del sufijo del archivo o es `"universal"`. `options` debe ser JSON y llega al navegador si el plugin se ejecuta allí. |
| `addServerMiddleware(file)` | Añade un middleware como los de `server/middleware`; los de los módulos van antes que los del proyecto. |
| `addServerHandler({ route, handler })` | Atiende una ruta exacta con el export por defecto de `handler`, `(request) => Response`, después del middleware de servidor. |
| `addPublicFile(path, contents)` | Añade un archivo público. `meeko build` lo escribe en la salida del cliente, antes de calcular el manifiesto de assets; `meeko dev` lo sirve. Choca con un archivo de `public/` del mismo nombre. |
| `addHead(input)` | Añade entradas a `document.head`: `meta`, `link`, `script` y `style` se concatenan en el orden de los módulos; `title`, `titleTemplate`, `htmlAttrs` y `bodyAttrs` se quedan con el último valor; `document.head` del proyecto se aplica al final. Recibe un `DocumentHead`: `titleTemplate` es una cadena y `title` es el título del sitio, sin plantilla. |
| `addVitePlugin(plugin)` | Añade un plugin de Vite a `meeko dev` y a cada build de `meeko build`, después del de Meeko. |
| `extendViteConfig(fn)` | Modifica la configuración inline de Vite de cada paso; `fn(config, { command, ssr })` cambia el objeto o devuelve otro. |
| `hooks.hook(name, fn)` | Registra un [hook](#hooks). |
| `warn(message)` | Escribe un aviso con el nombre del módulo. |

Un host de Vite propio que sólo usa el plugin `meeko()` recibe los autoimports, componentes, layers y plugins de aplicación de los módulos, pero no sus `addVitePlugin`, `extendViteConfig`, archivos públicos ni hooks: esos los aplican `meeko dev` y `meeko build`.

Meeko no tiene un `runtimeConfig` aparte: un módulo pasa valores a su runtime con las `options` de `addPlugin` (públicas si el plugin llega al navegador), y los secretos se leen en el servidor de las variables de entorno o de `server/runtime.ts`.

### Hooks

| Hook | Cuándo | Contexto |
| --- | --- | --- |
| `ready` | Todos los módulos terminaron su `setup`. | — |
| `routes:resolved` | Antes del build del cliente en `meeko build`; al arrancar y en cada redescubrimiento en `meeko dev`. | `{ routes }`, el manifiesto con rutas de archivo absolutas. |
| `build:before` | Al empezar `meeko build`. | `{ adapter, output }`, la carpeta absoluta del adaptador. |
| `prerender:routes` | Antes de prerenderizar, en `meeko build` y `meeko prerender`. | `{ urls }`: los `pathname` que se van a prerenderizar; el hook puede añadir o quitar entradas, que deben corresponder a una ruta. |
| `build:done` | Al terminar `meeko build`, prerender incluido. | `{ adapter, output }`; el módulo puede escribir más archivos en `output`. |

Los hooks se ejecutan en el orden en que se registraron y Meeko espera a cada uno. `hook()` devuelve una función que lo quita.

### Plugins de aplicación

Los archivos de `app/plugins` (de la aplicación y de sus layers) y los que añaden los módulos se ejecutan al arrancar la aplicación. Cada uno exporta por defecto `definePlugin`:

```ts
// app/plugins/analytics.client.ts
import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin((app) => {
  effect(() => navigator.sendBeacon("/api/visits", app.route.path.value));
  app.onError((error, info) => console.error("[app]", info.side, error));
});
```

- **Dónde.** `*.client.ts` sólo en el navegador, una vez, antes de la hidratación. `*.server.ts` sólo en el servidor, una vez por petición de página, antes del render (también al prerenderizar; no en las páginas ya prerenderizadas, ni en API, RPC o handlers). Un `.ts` sin sufijo, en los dos. Sólo cuentan los archivos que están directamente en `app/plugins`; las subcarpetas pueden guardar sus auxiliares. Se excluyen `*.test.ts`, `*.spec.ts` y `*.d.ts`.
- **Orden.** Los de los módulos, en el orden en que los añaden; después los de cada layer y los de la aplicación, por nombre de archivo. Meeko espera a cada `setup`, que puede ser asíncrono.
- **`app.provide(key, value)`.** Publica un valor para todos los componentes de la aplicación, que lo leen con `inject(key)` (y el composable que lo envuelva): las páginas, layouts, `app.meeko`, la página de error y las páginas a las que se navega en el navegador. En el servidor el valor es de esa petición: no comparta estado mutable entre peticiones. Un componente que se hidrata debe recibir el mismo valor en el servidor y en el navegador; por eso los valores que se renderizan suelen venir de un plugin universal.
- **`app.onError(handler)`.** En el navegador, el observador recibe lo mismo que `mountClientApp({ onError })` (navegación, Socket y eventos, efectos y limpiezas sin un `provideErrorHandler` más cercano y, desde `1.3`, las excepciones y los rechazos globales de la página; véase [Errores](#errores)), con `{ side: "client", source }`. En el servidor recibe los fallos del render de esa petición, con `{ side: "server", requestId }`, además del `onError` de `server/runtime.ts`.
- **`app.route`.** La ruta, como `useRoute()`. En el servidor es la de la petición; en el navegador sigue a la ruta confirmada, así que un `effect` que la lee se repite al navegar. `app.request` es la petición en el servidor y `undefined` en el navegador; `app.side` dice dónde se ejecuta.
- **Fallos.** Un plugin que lanza en el servidor hace fallar la petición, que muestra la página de error sin los valores de los plugins. En el navegador, la hidratación no llega a empezar y la página se queda con el HTML del servidor.

Un host propio pasa los plugins a `mountClientApp({ plugins })` y a `createServerApp({ plugins })` o `createFrameworkHandler({ plugins })`, como `PluginRegistration`s (`{ plugin, options?, name? }`).

### Límites entre servidor y cliente

El `setup` de un módulo y su entrada nunca llegan al bundle del navegador, y tampoco sus plugins `"server"`, su middleware, sus handlers, sus carpetas de autoimports con `scope: "server"` ni los `*.server.ts` de las carpetas del módulo. El plugin de Vite de Meeko rechaza el build si el grafo del cliente los alcanza (`Server-only module reached the client bundle`), y si un archivo que el navegador carga importa `defineMeekoModule` (`Meeko module setup reached the client bundle`): sólo `meeko.config.ts` debe importar los módulos. Las opciones de un plugin que se ejecuta en el navegador sí viajan en el bundle del cliente.

## Middleware de rutas y servidor

Coloque middleware de rutas en `app/middleware/*.ts` (también en subcarpetas). Cada archivo exporta por defecto una función creada con `defineRouteMiddleware` desde `@meekojs/meeko/framework` (se autoimporta). Se ejecuta antes del sidecar y el loader, tanto para una petición SSR de página como para una navegación cliente. El contexto ofrece `url`, `match`, `signal` y `phase`; `request` sólo existe durante SSR. Devolver `undefined` continúa; devolver un `Response` detiene la ruta. Una redirección HTTP durante navegación cliente usa `location.assign`, con nueva petición de página. Una respuesta distinta de redirección cancela la navegación y comunica el error al callback `onNavigationError` del host. Sin callback, los fallos de navegación por clic o historial se muestran en la consola; si el callback falla, Meeko registra ese fallo sin crear un rechazo no observado. Al bloquear o fallar una navegación de historial, Meeko restaura la URL de la página que sigue visible. Una llamada directa a `app.navigate()` devuelve su rechazo al código que la invocó.

Hay dos clases de middleware de ruta:

- **Global** (la de siempre, sin opciones): se ejecuta en todas las rutas, por nombre de archivo. `match.route.id` permite limitarlo a rutas concretas.
- **Con nombre** (desde `1.6`): `defineRouteMiddleware(fn, { global: false })`. Sólo se ejecuta en las rutas que lo piden con `middleware` en `definePage` o en un [`+group.ts`](#opciones-por-carpeta-groupts).

Las dos existen también sólo de servidor, en `app/middleware/*.server.ts` con `defineServerRouteMiddleware` (desde `1.6`): véase [Middleware de ruta de servidor](#middleware-de-ruta-de-servidor).

```ts
// app/middleware/10-locale.ts: global, en todas las rutas
export default defineRouteMiddleware(({ url, match }) => {
  if (match.route.id !== "/dashboard") return;
  if (!url.searchParams.has("locale")) {
    const target = new URL(url);
    target.searchParams.set("locale", "es");
    return Response.redirect(target);
  }
});
```

### Middleware con nombre

Un guard que sólo afecta a una parte de la aplicación se declara con nombre y lo piden las rutas que lo necesitan, sin comparar `match.route.id` ni rutas de archivo:

```ts
// app/middleware/auth.ts
export default defineRouteMiddleware(({ url, phase, request }) => {
  // Una cookie pública que indica la sesión: la cookie de sesión de Meeko es HttpOnly.
  const cookies = phase === "server" ? request?.headers.get("cookie") ?? "" : document.cookie;
  if (!cookies.includes("signed-in=1")) {
    const login = new URL("/login", url);
    login.searchParams.set("next", url.pathname);
    return Response.redirect(login);
  }
}, { global: false });
```

```ts
// app/pages/(dashboard)/+group.ts: todas las páginas del grupo
export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

```html
<!-- app/pages/(dashboard)/admin/users.meeko: la página añade el suyo -->
<script server lang="ts">
export const route = definePage({ middleware: ["admin"] });
</script>
<template><h1>Usuarios</h1></template>
```

- **Nombre.** Es la ruta del archivo dentro de `app/middleware`, sin `.ts` ni el prefijo numérico de orden de cada parte: `auth.ts` y `10-auth.ts` son `"auth"`, y `admin/20-role.ts` es `"admin/role"`. Letras, dígitos, `-` y `_`, y `/` entre carpetas. Dos archivos que dan el mismo nombre, si uno de ellos es con nombre, detienen el descubrimiento.
- **Herencia.** `middleware` se acumula de fuera hacia dentro: los `+group.ts` exteriores, los interiores y la página, sin repetir (cuenta la primera aparición). `middleware: false` en un grupo o en una página quita los heredados; los grupos interiores y la página pueden volver a añadir. `middleware: []` no cambia nada.
- **Orden.** Primero todos los globales, en su orden de siempre; después los de la ruta, en el orden declarado. El primero que devuelve un `Response` detiene la ruta y los siguientes no se ejecutan. Es el mismo contrato en SSR, en la navegación del navegador, en `render: "client"`, en el prerender y en el adaptador `static`.
- **Literales.** Como `render` y `layout`, Meeko lo lee sin ejecutar el archivo: `{ global: false }` debe ser un objeto literal con el literal `true` o `false`, y `middleware`, un array literal de textos o `false`. Un valor calculado da `las opciones de defineRouteMiddleware deben ser un objeto literal…` o `middleware debe ser un array literal…` con el archivo. Un spread en las opciones de la página que puede llevar `middleware` (un objeto importado, o una constante del archivo que lo tiene) exige declarar `middleware` después del último spread: `definePage({ ...protegida, render: "ssr", middleware: ["auth"] })`, o `middleware: []` si no añade ninguno. Si no, el descubrimiento se detiene con `el spread protegida puede llevar middleware…`, porque la ruta se serviría sin él. Si una página declara un middleware que su manifiesto no lista (un build antiguo), la petición falla con `500` antes del loader, como con `layout`.
- **Errores.** Detienen `meeko dev`, `meeko build` y `meeko check`, con el archivo que declara el nombre: `el middleware "nowhere" no existe; crea app/middleware/nowhere.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: "admin", "auth"), o app/middleware/nowhere.server.ts…` y, para un global, `el middleware "locale" (…/10-locale.ts) es global y ya se ejecuta en todas las rutas`.
- **Tipos y editor.** `middleware` se tipa con la unión de los middleware con nombre (`RouteMiddlewareName`, que declara `.meeko/types/routes.d.ts`), con completado en el editor. En una aplicación sin middleware con nombre la unión está vacía (`never`), así que `middleware: ["typo"]` ya es un error de tipos. El hover de un nombre en `definePage` muestra su archivo y sus páginas, y Ctrl+clic lo abre.
- **Bundle.** Los globales viajan con la entrada del navegador. Cada middleware con nombre que usa alguna ruta es un chunk aparte, que el navegador carga la primera vez que navega a una de sus rutas; uno que ninguna ruta usa no llega al navegador. La hidratación no los ejecuta: el servidor ya lo hizo.
- **Manifiesto.** Cada ruta guarda sus middleware con nombre resueltos en `RouteRecord.middleware` (archivos, en orden de ejecución); `AppManifest.routeMiddleware` sigue listando sólo los globales. Un host propio que use `createFrameworkHandler` o `mountClientApp` con rutas que los declaran pasa `loadNamedMiddleware(file)`; sin él, esas rutas fallan en lugar de saltarse sus guards. `discoverRouteMiddleware` de `@meekojs/meeko/build` separa los globales de los con nombre.
- **Desarrollo.** Crear, borrar o renombrar un middleware, cambiar su `{ global }` o el `middleware` de una página o un `+group.ts` hace que `meeko dev` vuelva a descubrir las rutas y cree de nuevo la aplicación.
- **Layers y módulos.** Como hasta ahora, sólo cuenta `app/middleware` del proyecto: las páginas de los layers eligen entre los middleware con nombre del proyecto, y los módulos no añaden middleware de ruta.

`app/middleware/*.ts` se empaqueta también para el navegador, el middleware con nombre incluido: no importe allí `server/`, secretos ni lógica de autorización que deba ser obligatoria en servidor. Un guard de ruta isomórfico, global o con nombre, mejora la navegación, pero nunca sustituye la validación de sesión y autorización del loader, API o RPC; para proteger la página con la sesión, use un [middleware de ruta de servidor](#middleware-de-ruta-de-servidor). Los archivos `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts` se excluyen del descubrimiento de middleware de rutas; desde `1.6`, los `*.server.ts` son middleware de ruta de servidor.

### Middleware de ruta de servidor

Desde `1.6`, un archivo `app/middleware/*.server.ts` es middleware de ruta **sólo de servidor**: se declara con `defineServerRouteMiddleware` (de `@meekojs/meeko/framework`; se autoimporta en los `*.server.ts` y en todo `server/`, como las demás definiciones de servidor), recibe la sesión de la petición y nunca llega al bundle del navegador. Es la forma de expresar «este grupo exige sesión» sin repetir la comprobación en el `<script server>` de cada página:

```ts
// app/middleware/auth.server.ts
import { redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session, url }) => {
  if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
}, { global: false });
```

```ts
// app/pages/(dashboard)/+group.ts: todas las páginas del grupo exigen sesión
export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

- **Global o con nombre.** La misma regla que el isomórfico: sin opciones es global y se ejecuta en todas las rutas; con `{ global: false }` (leído sin ejecutar el archivo) es un middleware con nombre, y `auth.server.ts` (o `10-auth.server.ts`) es `"auth"`. `middleware: ["auth"]` en `definePage` o en un `+group.ts` resuelve a `auth.ts` o a `auth.server.ts`, con la misma herencia y `middleware: false`; si los dos existen y alguno es con nombre, el nombre está duplicado y el descubrimiento se detiene. El export por defecto de un `*.server.ts` debe ser una llamada a `defineServerRouteMiddleware(...)`, directa o a través de una constante del archivo (`as const` incluido), de un import con alias o de `export { auth as default }`. Hasta `1.5` esos archivos se ignoraban, así que un helper que viviera allí, sin export por defecto o con otro (`export default function parseCookies…`), detiene el descubrimiento con `un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...)… mueve los helpers a server/utils` en lugar de ejecutarse en cada petición como middleware global. Cada clase de archivo usa su definición: `defineRouteMiddleware` en un `*.server.ts`, o `defineServerRouteMiddleware` en un `*.ts`, es un error con el archivo.
- **Contexto.** El de `usePage()` en el `<script server>`: `url`, `params`, `search`, `request`, `signal` y `context` (el `RequestContext`), con `session`, `services`, `platform` y `requestId` a mano, además de `match`. La IP del cliente, tras el proxy si `MEEKO_TRUST_PROXY` lo permite, es `context.clientAddress`. `params` y `search` son los de la URL, sin validar todavía con los schemas de la página, porque el middleware se ejecuta antes que su `<script server>` o su `load`. `defineServerRouteMiddleware<Services>` tipa `services`, y `session` sigue a `MeekoSession`. Con `createFrameworkHandler` sin `createContext`, leer `context` o `session` lanza un error.
- **Cómo corta.** Igual que el `<script server>`: `redirect()`, `notFound()` o un error, y también devolviendo un `Response`. Devolver `undefined` continúa.
- **Cuándo se ejecuta.** En la petición del documento (SSR), y al navegar en el navegador dentro de la petición de los datos de la página, la misma que ejecuta el `<script server>`: una redirección o un error llegan al navegador igual que los de un `redirect()` del `<script server>`, y la navegación los sigue. En `render: "stream"`, antes del primer byte, como el loader crítico.
- **Orden.** Siempre el mismo: primero el middleware isomórfico (los globales y después los con nombre, en el orden declarado) y después el de servidor (los globales y después los con nombre, en el orden declarado). Al navegar, el navegador ejecuta el isomórfico y la petición de datos vuelve a ejecutarlo en el servidor antes del de servidor, como hasta ahora. El primero que corta detiene la ruta.
- **`render: "client"` y `render: "prerender"`.** Una página `render: "client"` no pide sus datos al servidor al navegar, y una prerenderizada se renderiza en el build, sin la petición ni la sesión de cada visitante. Pedir un middleware de servidor con nombre en una de ellas (también heredado de un `+group.ts`) detiene el descubrimiento: `el middleware de servidor "auth" (…) necesita una página con datos del servidor, pero … usa render: "client"…`; quítelo de esa página con `middleware: false` o use `render: "ssr"` o `"stream"`. Los globales de servidor no se ejecutan en esas páginas, tampoco en su primera carga, para que su comportamiento no dependa de cómo se llegó a ellas. El adaptador `static`, que sólo admite páginas prerenderizadas, avisa de que no los ejecuta.
- **Límite de seguridad.** El plugin de Vite rechaza cualquier `*.server.*` que alcance el grafo del navegador, y el módulo virtual del middleware del cliente nunca los incluye; el manifiesto del navegador tampoco lleva sus rutas. Pueden importar `server/` y `#server/…` sin `MEEK108`, y `meeko check` los comprueba con los tipos del servidor.
- **Tipos y editor.** `RouteMiddlewareName` incluye sus nombres, salvo en el `middleware` de una página `render: "client"`, que sólo admite los isomórficos; el hover de un nombre en `definePage` o `defineGroup` muestra el archivo, que es «sólo servidor», y sus páginas. Un nombre inexistente o global da los mismos errores en `meeko dev`, `meeko build` y `meeko check`.
- **Manifiesto y host propio.** Cada ruta guarda en `RouteRecord.serverMiddleware` su cadena completa de servidor, en orden de ejecución: los globales y después los con nombre (las rutas `render: "client"` y `"prerender"` no la llevan). Un host propio que use `createFrameworkHandler` pasa `loadServerMiddleware(file)`, que carga cada archivo de esa lista; sin él, una ruta que lista alguno, aunque sea sólo un global, falla en lugar de saltárselo. Las rutas de un módulo programático de `composeFrameworkRoutes` reciben también los globales del proyecto.
- **Desarrollo.** Crear o borrar uno, o cambiar su `{ global }`, hace que `meeko dev` vuelva a descubrir las rutas.

Cuándo usar cada uno:

- **El isomórfico (`*.ts`) mejora la navegación**: decide en el navegador, sin una petición, y redirige antes de pedir nada. No puede leer la sesión (su cookie es HttpOnly) ni importar código de servidor.
- **El de servidor (`*.server.ts`) protege la página**: comprueba la sesión antes de que el servidor renderice o envíe sus datos.
- **Ninguno protege `server/api` ni el RPC.** El middleware de ruta sólo se ejecuta para las páginas: los endpoints de API y los procedimientos RPC necesitan sus propias guardas (`auth: "required"`, comprobaciones en el handler o middleware de servidor), aunque sólo los llamen páginas protegidas.

### Middleware de servidor

Para interceptar HTTP en el servidor antes del handler de página o API/RPC, coloque middleware en `server/middleware/*.ts` y use `defineServerMiddleware` desde `@meekojs/meeko/server`. Recibe `Request` y `next(request?)`; debe devolver un `Response`. Puede continuar, modificar una respuesta o cortocircuitar. Meeko ejecuta los archivos por nombre, de fuera hacia dentro; `next()` sólo se puede llamar una vez. El middleware se ejecuta antes de crear el contexto de sesión de la petición, también para las páginas prerenderizadas; los archivos públicos del build se sirven antes del middleware. Los controles integrados de autenticación, autorización, contratos y CSRF de API/RPC siguen ejecutándose dentro del handler.

```ts
// server/middleware/10-request-header.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
```

El middleware de servidor no tiene `RequestContext`: para la IP del cliente use `clientAddress(request)` (desde `1.7`), que aplica `MEEKO_TRUST_PROXY` como `context.clientAddress` y `rateLimit`; nunca lea `X-Forwarded-For` a mano (véase [IP del cliente tras un proxy](#ip-del-cliente-tras-un-proxy)).

Este pipeline envuelve páginas SSR y `/api` y `/_meeko/rpc`; los assets estáticos, el servidor de desarrollo Vite y los upgrades WebSocket tienen sus propios handlers. Los archivos `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts` se excluyen. El descubrimiento automático de middleware se limita por ahora al proyecto raíz: los layers aportan rutas, autoimports y plugins, pero sus carpetas `app/middleware` y `server/middleware` no participan. Un módulo añade middleware de servidor con `meeko.addServerMiddleware`, que se ejecuta antes que el del proyecto (véase [Módulos](#módulos)). Editar un archivo de middleware existente invalida módulos y recarga el navegador en desarrollo; al añadir o quitar uno, `meeko dev` recrea la aplicación sin reiniciar (véase [Configuración](#configuración)). `npm run check` comprueba los tipos en sus ámbitos respectivos.

Los callbacks `onNavigationError` pueden devolver una promesa: si el observador falla, Meeko registra tanto el fallo del observador como el error de navegación original sin generar un rechazo sin manejar. Los observadores `onError` del servidor tampoco modifican la respuesta cuando lanzan o rechazan; el registro de respaldo incluye el `requestId` disponible y categorías de error, sin mensajes privados.

Los eventos de componentes pueden observarse por raíz con `provideErrorHandler` en el `<script>` de `app/app.meeko` o de un layout; se autoimporta y el callback recibe `unknown` y su `ErrorSource`. Los hijos heredan el observador más cercano, también después de un reemplazo HMR. `mountClientApp({ onError })` define el observador de toda la aplicación: recibe la navegación, los canales Socket, los eventos, efectos y limpiezas que no tienen un `provideErrorHandler` más cercano y, desde `1.3`, las excepciones no capturadas y las promesas rechazadas sin manejar de la página ([Fallos globales del navegador](#fallos-globales-del-navegador)). Sin `onError`, navegación, Socket y esos fallos globales consultan el primer proveedor activo de esa aplicación cuando no existe un `onNavigationError` u `onError` explícito del canal. Ese proveedor se desregistra al liberar su raíz; un fallo del observador se registra con el error original. Las llamadas directas a `app.navigate()` y `socket.emit()` mantienen sus rechazos para el código que las espera. En SSR no hay eventos de navegador ni conexiones Socket.

Si un middleware servidor llama a `next()`, Meeko espera también ese trabajo aunque el middleware olvide esperar la promesa. Un fallo del tramo siguiente se propaga al handler HTTP; si fallan ambos, se conserva cada error en un `AggregateError`. El middleware debe devolver una respuesta del pipeline o una respuesta propia.

## Routing, layouts y SSR

`app/pages` admite `index.meeko`, `[id].meeko`, `[...slug].meeko`, grupos `(group)`, `+error.meeko` y, para las opciones de ruta, un bloque `<script server>` en la página o un sidecar `*.route.ts`. El layout compartido vive en `app/layouts/default.meeko` y recibe `props.outlet`; el navegador lo conserva entre rutas y libera las páginas salientes. Desde `1.5`, cualquier `app/layouts/<nombre>.meeko` es un [layout con nombre](#layouts-con-nombre) que la página elige con `definePage({ layout })` o un `+group.ts`. Los `+layout.meeko` junto a páginas siguen admitidos para proyectos anteriores y layouts anidados; no se puede combinar uno en la raíz de `app/pages` con `app/layouts/default.meeko`. Un layer usa las mismas convenciones. `href` comprueba IDs y parámetros a partir del manifiesto generado.

El tipo del outlet en `app/app.meeko` y en cada layout es `Component<Record<string, unknown>>` importado desde `@meekojs/meeko`. Incluye `renderWithState`, requerido por `<component is="props.outlet">` para transferir el estado SSR.

### `<MeekoOutlet />` y `<MeekoLink>`

Desde `1.2`, dos etiquetas propias de Meeko sustituyen a esos patrones. No se importan: el compilador las reconoce.

- **`<MeekoOutlet />`** pinta, en `app/app.meeko` y en los layouts (`app/layouts/*.meeko` o `+layout.meeko`), el layout o la página que van dentro. Lee el `outlet` que Meeko pasa, así que el layout no necesita declarar `defineProps<{ outlet }>()`. Hasta `1.4`, si declaraba sus props, `outlet` debía estar entre ellas; desde `1.5`, un layout con `<MeekoOutlet />` declara sólo las suyas (`defineProps<{ title?: string }>()`) y Meeko añade `outlet` a su `ComponentProps`. Equivale a `<component is="props.outlet">`: el navegador conserva el layout entre rutas y sólo cambia lo que hay dentro. En otro componente, o con atributos o contenido, da `MEEK104`.
- **`<MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'perfil' }">`** renderiza un `<a>` cuyo `href` construye `href()`: `to` sólo admite rutas que existen, las rutas dinámicas exigen `bind:params` con sus claves y `bind:search` añade la query string. `meeko check` y el editor marcan el error en el atributo (`Argument of type '"/nowhere"' is not assignable…`). En la ruta activa (la misma ruta sin query ni fragmento) añade `aria-current="page"`, que la navegación actualiza; con `match="prefix"`, también marca su sección (véase más abajo). El resto de atributos y los hijos pasan al `<a>` tal cual: `class`, `target`, `rel`, `aria-*`, `data-*` y `on:click`. `href` y `bind:href` no se admiten, porque el enlace lo construye `to` (`MEEK105`).
- **`match`: la página o la sección.** Desde `1.5`, `match="exact"` (por defecto) marca el enlace sólo en su ruta, y `match="prefix"`, también en las rutas que están por debajo. En su propia ruta el enlace lleva `aria-current="page"`, y en una ruta por debajo, `aria-current="true"`, que significa «el elemento actual de un conjunto»: la sección en la que está la página. La comparación es por segmentos completos, sobre las rutas codificadas como `href()` y sin query ni fragmento: `/dashboard` cubre `/dashboard/stats` y `/dashboard/r%201`, pero no `/dashboards`; `/dash` no cubre `/dashboard`. `to="/"` sólo coincide exacta, también con `match="prefix"`, porque si no marcaría todas las páginas. En una ruta dinámica, la sección es la de sus `params`: `<MeekoLink to="/users/[id]" bind:params="{ id: '7' }" match="prefix">` cubre `/users/7/posts`, no `/users/8/posts`. `match` admite `bind:match` con una expresión de tipo `"exact" | "prefix"`; otro valor estático es `MEEK105`. El valor sale en el HTML del servidor, la hidratación no lo cambia y la navegación lo actualiza, también en un layout que el navegador conserva.
- **Tipos de sus props.** Desde `1.4`, `@meekojs/meeko/framework` exporta `MeekoLinkProps<K>` (`to`, `params` y `search` de la ruta `K`; desde `1.5`, también `match`), `MeekoOutletProps` (sin props) y `MeekoThemeToggleProps` (las de [`<MeekoThemeToggle>`](#meekothemetoggle)), y `RouteId`, el ID de cualquier ruta de la aplicación (el tipo de `to`). Todos se autoimportan: los tipos de las props donde se usan los componentes, como los [tipos de cada componente](#tipos-de-cada-componente), y `RouteId` en todo el proyecto, como `href`. El editor muestra las props en el hover de las etiquetas y abre su tipo con «Ir a definición». Sirven para tipar un componente que recibe una ruta, sin import:

```html
<!-- app/components/NavLink.meeko -->
<script lang="ts">
const props = defineProps<{ href: MeekoLinkProps["to"]; label: string }>();
</script>
<template><a bind:href="href(props.href)">{props.label}</a></template>
```

  `MeekoLinkProps["to"]` y `RouteId` son el mismo tipo: la unión de las rutas que declara `.meeko/types/routes.d.ts` (`meeko check`, `meeko dev`), o `string` sin esas declaraciones. `<NavLink href="/nowhere">` es un error de tipos en el padre. Un tipo del proyecto con uno de esos nombres (por ejemplo, en `app/types`) tiene prioridad.

```html
<!-- app/layouts/default.meeko -->
<template>
  <header>
    <MeekoLink to="/" class="brand">Inicio</MeekoLink>
    <MeekoLink to="/users/[id]" bind:params="{ id: session.userId }">Mi perfil</MeekoLink>
  </header>
  <main><MeekoOutlet /></main>
</template>

<style scoped>
a[aria-current="page"] { font-weight: 700; }
</style>
```

Un menú de secciones marca la sección en todas sus páginas y, de forma distinta, la página exacta. El CSS distingue los dos valores de `aria-current`, los mismos que leen los lectores de pantalla:

```html
<!-- app/layouts/default.meeko -->
<template>
  <nav aria-label="Secciones">
    <MeekoLink to="/" match="prefix">Inicio</MeekoLink>
    <MeekoLink to="/dashboard" match="prefix">Panel</MeekoLink>
    <MeekoLink to="/users" match="prefix">Usuarios</MeekoLink>
    <MeekoLink to="/settings" match="prefix">Ajustes</MeekoLink>
  </nav>
  <main><MeekoOutlet /></main>
</template>

<style scoped>
/* La sección de la página actual: /dashboard/stats marca «Panel». */
nav a[aria-current="true"] { border-bottom: 2px solid currentColor; }
/* La página exacta: /dashboard marca «Panel» con más peso. */
nav a[aria-current="page"] { border-bottom: 2px solid currentColor; font-weight: 700; }
</style>
```

En `/dashboard/stats`, «Panel» lleva `aria-current="true"`; en `/dashboard`, `aria-current="page"`; en `/dashboards`, ninguno de los dos, y «Inicio» sólo se marca en `/`. Para un enlace o un componente propio, `useRoute().isActive()` aplica la misma regla (véase [Ruta actual](#ruta-actual)).

En el editor, `to="` sugiere las rutas del proyecto y lleva a su página con Ctrl+clic. `meeko init-framework` genera el shell y el layout con estas etiquetas.

Un proyecto anterior a `1.2` con un componente propio llamado `MeekoLink` o `MeekoOutlet` (en `app/components`, de un módulo o importado o declarado en el `<script>`) lo conserva: la etiqueta es ese componente, con sus props, y no la de Meeko. `meeko check`, `meeko build` y el editor lo avisan con `MEEK106`; renombre el componente para usar la etiqueta propia.

### `<MeekoTeleport>`

Desde `1.5`, `<MeekoTeleport to="…">` pinta su contenido en otro lugar del documento sin sacarlo del componente que lo declara. Tampoco se importa. El caso típico es que una página ponga sus acciones en la barra de su layout:

```html
<!-- app/layouts/default.meeko -->
<template>
  <header class="bar">
    <MeekoLink to="/">Inicio</MeekoLink>
    <div id="toolbar"></div>
  </header>
  <main><MeekoOutlet /></main>
</template>

<!-- app/pages/notes/[id].meeko -->
<script lang="ts">
const isMobile = signal(false);
async function save(): Promise<void> { /* … */ }
</script>
<template>
  <MeekoTeleport to="#toolbar" bind:disabled="isMobile.value">
    <AppButton on:click="save">Guardar</AppButton>
  </MeekoTeleport>
  <article>…</article>
</template>
```

- **Destino.** `to="body"` añade el contenido al final de `<body>` y `to="#id"`, dentro del elemento con ese `id`, después de lo que ya tiene. Sólo se admiten esas dos formas: `body`, o `#` seguido de una letra y de letras ASCII, dígitos, `-` o `_`. Meeko busca el `id` con `getElementById` y nunca interpreta `to` como selector CSS ni como HTML. Un `to` estático que no cumple esa forma da `MEEK114`; `bind:to` acepta una expresión de tipo ``"body" | `#${string}` `` (`MeekoTeleportTarget`) que se valida al renderizar. `<MeekoTeleport>` admite `to`, `bind:to`, `disabled`, `bind:disabled`, `if:when` y `each:of`; cualquier otro atributo da `MEEK114`.
- **Ámbito del autor.** El contenido se compila en la plantilla del componente que lo declara, como el de un `if:when`: lee sus señales, sus eventos llaman a sus funciones, recibe su `provide`/`inject` y sus manejadores de errores, puede usar sus snippets y conserva el atributo de su `<style scoped>`. Se libera con el componente: al desmontarlo, al cambiar de página o cuando su `if:when` o su fila de `each:of` desaparecen, y sus nodos salen del destino con él.
- **Primer HTML.** En SSR, `"stream"` y `"prerender"` (también con el adaptador `static`), el HTML ya trae el contenido en su destino, sin saltos al hidratar: el de `to="body"` va tras la aplicación y antes de los scripts de Meeko, y el de `to="#id"` dentro de ese elemento, se renderice éste antes o después que el teleport. Varios teleports al mismo destino conservan el orden en que aparecen en la página. La hidratación encuentra el contenido por sus marcadores (`<!--meeko:portal:…-->`) y no cambia el DOM.
- **Destino inexistente.** Si la página no renderiza el elemento del `#id` (o es un elemento sin contenido, como `<input>`), el render falla con un error claro en desarrollo. En producción el contenido se pinta en su sitio, donde se hidrata, y el servidor avisa una vez con `console.warn`. En el navegador, un destino que no existe deja el contenido en su sitio con un aviso; el siguiente cambio de `to` o `disabled` vuelve a buscarlo.
- **`disabled`.** Con `disabled` (o mientras `bind:disabled` es verdadero) el contenido se pinta en su sitio. Cambiarlo mueve los mismos nodos entre el destino y su sitio, sin volver a renderizarlos, así que conservan su estado; el elemento que tenía el foco lo pierde, como en cualquier movimiento del DOM.
- **Navegador.** Lo que el navegador renderiza (una navegación, un `if:when` que aparece, una fila nueva o un hijo diferido) se pinta primero en su sitio y pasa a su destino al terminar ese montaje, antes del siguiente pintado, y se añade al final del destino. El destino debe vivir al menos tanto como el teleport: un elemento del layout o de `app/app.meeko` para una página, o del propio componente.

Para modales, menús y tooltips no hace falta teleport: `<dialog>` con `showModal()` y el atributo `popover` ya los muestran en la *top layer* del navegador, por encima de todo y sin problemas de `z-index` u `overflow`, con el foco y `Escape` resueltos. Use `<MeekoTeleport>` cuando el contenido deba vivir en otro sitio del layout, como una barra de acciones, unas migas de pan o un aviso al final de `<body>`.

Las páginas, los layouts, `app/app.meeko` y `app/error.meeko` no pueden ser [componentes genéricos](api.md#componentes-genéricos-generic): Meeko les pasa sus props y no puede elegir sus parámetros de tipo, así que `generic` en su `<script>` da `MEEK100`. Lleve el contenido genérico a un componente de `app/components` y úselo desde la página.

Si una página falla y existe `+error.meeko`, Meeko la carga y renderiza con el mismo contexto de petición y estado SSR. El observador del servidor recibe el fallo original con su `requestId`; el HTML muestra un mensaje público y no incluye detalles privados. Si también falla la página de error, el servidor registra ese segundo fallo y entrega una respuesta segura.

### Layouts con nombre

Desde `1.5`, cada `app/layouts/<nombre>.meeko` es un layout con nombre: `default`, `dashboard`, `auth`, `blank`… Una subcarpeta forma parte del nombre: `app/layouts/admin/panel.meeko` es `"admin/panel"`. El nombre son letras, dígitos, `-` y `_` (y `/` entre carpetas), y empieza por una letra o un dígito; un archivo con otro nombre (`_partes.meeko`) no es un layout y puede guardar otros componentes. Un layout con nombre es un layout normal: pinta la página con `<MeekoOutlet />` y declara sus props con `defineProps`.

La página elige su layout en sus opciones de ruta, en `<script server>` o en el sidecar `*.route.ts`:

```html
<!-- app/pages/connections.meeko -->
<script server lang="ts">
export const route = definePage({ layout: "dashboard" });
</script>
<template><h1>Conexiones</h1></template>
```

- **Sin `layout`**, la página usa el que heredan sus carpetas de sus [`+group.ts`](#opciones-por-carpeta-groupts) o, si no hay, `default`, como hasta `1.4`.
- **`layout: false`** quita el layout con nombre: quedan `app/app.meeko` y los `+layout.meeko` de sus carpetas.
- **Un literal.** Como `render`, `meeko build` lee `layout` sin ejecutar el archivo: debe ser un texto literal o `false` dentro de `definePage({ ... })`. Un valor calculado da `layout debe ser un literal de texto…` con el archivo. Un nombre que no existe detiene `meeko dev`, `meeko build` y `meeko check`: `el layout "nowhere" no existe; crea app/layouts/nowhere.meeko (layouts disponibles: …)`. En los tipos, `layout` es la unión de los layouts de la aplicación, con completado en el editor; el hover del nombre muestra su archivo y sus páginas, y Ctrl+clic lo abre.
- **Orden de anidamiento.** `app/app.meeko` → el layout con nombre → los `+layout.meeko` de las carpetas y grupos, de fuera hacia dentro → la página. Los grupos `(group)` y los `+layout.meeko` funcionan igual que antes, dentro del layout con nombre. Sigue siendo un error tener a la vez `app/pages/+layout.meeko` y `app/layouts/default.meeko`; un `app/pages/+layout.meeko` sin `default` se anida dentro del layout con nombre que elija la página.

```text
app/app.meeko
└─ app/layouts/dashboard.meeko        (layout: "dashboard")
   └─ app/pages/(dashboard)/+layout.meeko
      └─ app/pages/(dashboard)/connections.meeko
```

**Navegación.** El navegador conserva los layouts que comparten la página saliente y la nueva, como siempre: si las dos usan el mismo layout con nombre, sigue montado con su estado (el DOM, el foco, el scroll de la barra lateral, lo escrito en un campo) y sólo cambia lo de dentro; si usan otro, el layout se libera y se monta el nuevo. Vale igual para páginas SSR, `render: "stream"`, `render: "client"`, prerenderizadas y las del adaptador `static`.

**Página de error.** Una página que falla en el navegador (su loader, `notFound()` o un dato) muestra su `+error.meeko` o `app/error.meeko` dentro de sus propios layouts, el layout con nombre incluido, con las props de sus `+group.ts` y sin las de la página. La `404` de una URL sin ruta usa el layout `default` (si existe), con sus valores por defecto. El documento de error que el servidor responde a una página que falla no tiene layouts, como hasta ahora.

#### Opciones por carpeta: `+group.ts`

Para no repetir `layout` en cada página, un `+group.ts` en cualquier carpeta de `app/pages` (un grupo `(dashboard)` o una carpeta normal) declara las opciones de su carpeta y sus subcarpetas. `defineGroup` se autoimporta:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false } });
```

- **Herencia en cascada.** Los `+group.ts` se aplican del exterior al interior y después la página. `layout` de la página, o del grupo más interior que lo declara, gana.
- **`layoutProps` se combinan por clave** entre los grupos y la página, y la página gana. Un grupo o una página que elige un layout distinto del heredado empieza sin las props heredadas, que eran para otro layout.
- **`layout: false`** en una página (o un grupo) dentro de un grupo quita el layout con nombre y deja sus `+layout.meeko`.
- **Literales.** Meeko lee el archivo sin ejecutarlo, como `render`: `layout` es un literal o `false`, `layoutProps` un objeto literal de textos, números, booleanos, `null`, arrays y objetos, y `middleware` un array literal de textos o `false`. Un valor calculado, un spread o una opción desconocida detienen el descubrimiento con el archivo. Por eso funciona igual en el prerender y en el sitio estático.
- **`middleware`** (desde `1.6`). Los middleware con nombre de las páginas del grupo, que se suman a los de los grupos exteriores; `middleware: false` quita los heredados. Véase [Middleware con nombre](#middleware-con-nombre).
- **Tipos.** `defineGroup({ layout: "dashboard", layoutProps: { … } })` tipa `layoutProps` contra ese layout en el propio archivo. Un grupo que hereda el layout, y una página que no lo elige en su `definePage`, se comprueban en `meeko check` contra el heredado (`MEEK_PAGE_LAYOUT_PROPS`: `Las layoutProps de app/pages/(dashboard)/reports/+group.ts no coinciden con las props del layout dashboard`). Un `+group.ts` fuera de `app/pages` no configura nada: `meeko check` avisa con `MEEK115`.

Para migrar un grupo con su propio layout, como `app/pages/(dashboard)/+layout.meeko`, mueva el archivo a `app/layouts/dashboard.meeko` y añada `app/pages/(dashboard)/+group.ts` con `export default defineGroup({ layout: "dashboard" })`. El layout ya no se anida dentro de `default`, sino que lo sustituye, y cualquier página de otra carpeta puede elegirlo; los `+layout.meeko` que queden en subcarpetas siguen anidándose dentro.

#### Layouts de layers y módulos

Un layer aporta sus `app/layouts/*.meeko` a toda la aplicación, y un módulo los suyos con `meeko.addLayout(name, file)` (véase [El objeto `meeko`](#el-objeto-meeko)). Ante dos layouts con el mismo nombre gana el del proyecto, después el del propio layer de la página, después los demás layers en su orden y por último los módulos; dos módulos con el mismo nombre son un error. `default` mantiene la regla de `1.4`: el del proyecto envuelve también a las páginas de los layers, el `default` de un layer sólo envuelve sus propias páginas cuando el proyecto no tiene uno (ni `app/pages/+layout.meeko`), y el de un módulo sirve cuando ni el proyecto ni el layer lo tienen.

### Props del layout desde la página

El layout declara props normales. La página se las pasa tipadas contra las `Props` del layout que elige, sin el `outlet`:

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
export interface Props { title?: string; showAlert?: boolean }
const props = defineProps<Props>({ showAlert: false });
</script>
<template>
  <header>{props.title}</header>
  <AppAlert if:when="props.showAlert" />
  <main><MeekoOutlet /></main>
</template>
```

Como Meeko renderiza el layout sin las props que una página no le pasa, las de un layout con nombre deben ser opcionales o tener valor por defecto; `meeko check` lo comprueba (`MEEK_LAYOUT_PROPS`).

**1. Con las opciones de ruta (`layoutProps`).** Estáticas o calculadas con los datos del servidor, como `head`: llegan en el HTML del SSR desde el primer byte.

```ts
// app/pages/connections.route.ts (o export const route en <script server>)
export const route = definePage({ layout: "dashboard", layoutProps: { title: "Conexiones", showAlert: true } });
```

```ts
export const route = definePage({
  layout: "dashboard",
  load: async ({ context }) => ({ user: await users.current(context) }),
  layoutProps: ({ data }) => ({ title: data.user.name }),
});
```

La función recibe el mismo contexto que `head` (`params`, `search`, `request`, `context`, `signal`, `state` y `data`); con código de nivel superior en `<script server>`, `data` son sus exports. Se combinan con las de los `+group.ts`, y ganan. Viajan en el payload (`layoutProps`), así que deben poder serializarse en JSON: una prop con `undefined` (`{ title: data.user?.name }` sin usuario, o `layout.set({ title: undefined })`) deja la prop sin valor, así que el layout usa su valor por defecto, en el servidor y en el navegador; un valor que JSON no representa (una fecha, un `Map`, una instancia) hace fallar la página con un error que nombra la página, el layout y la prop. En una página `render: "client"`, el objeto ya llega al HTML del servidor y la función se ejecuta en el navegador después de `load`. `export const layoutProps` en `<script server>` no es una opción: sería un dato más de la página.

**2. Desde el `<script>` de la página: `useLayout()`.** Se autoimporta y, en una página, su tipo sigue al layout que eligen su `definePage` o sus `+group.ts` (en otro componente, `useLayout<"dashboard">()`):

```html
<!-- app/pages/connections.meeko -->
<script lang="ts">
const layout = useLayout();                 // LayoutHandle de "dashboard"
const failing = signal(false);
effect(() => layout.set({ showAlert: failing.value }));
</script>
<template>
  <p>Título actual: {layout.props.title}</p>
  <button on:click="() => failing.value = !failing.value">Probar conexión</button>
</template>
```

- `layout.set(patch)` cambia las props que nombra y conserva las demás; `layout.props` lee las que recibe el layout (reactivas); `layout.name` es el nombre del layout. Una prop que el layout no declara, o con otro tipo, es un error de tipos.
- El layout no se vuelve a montar: con las props reactivas de `1.2`, sólo cambia lo que lee esas props.
- **Nada queda pegado.** Al navegar a otra página, el layout recibe las props de la nueva (sus `layoutProps`, las de sus `+group.ts` y, para el resto, los valores por defecto del layout), también si el layout se conserva. Una página que ya se fue no puede escribir.
- **SSR sin mismatch.** El layout se renderiza antes que la página, así que lo que el setup de la página escribe con `set` durante el render llega al HTML con un segundo render de la página en el servidor (con el mismo estado de la petición y los mismos datos, como un pase de `await`), y el payload lleva esas props: el navegador hidrata exactamente ese HTML. Un render que escribe valores distintos cada vez se detiene en el tercero. En el navegador, lo que la página escribe mientras se renderiza y se hidrata se aplica al terminar de montarla; después, cada `set` se aplica al momento.
- Una página sin layout con nombre (`layout: false`) recibe un `useLayout()` que no hace nada. Fuera de una página que renderiza Meeko (una prueba unitaria), `useLayout()` lanza un error.

**Markup en zonas del layout.** Las props son para datos. Para poner contenido de la página en una zona del layout (botones de la cabecera, migas de pan) use `<MeekoTeleport>`, que mueve markup de la página a un destino del layout.

**Tipos.** `.meeko/types/routes.d.ts` declara `GeneratedLayouts` (las props de cada layout) y `GeneratedPageLayouts` (el layout de cada ruta). `LayoutProps<"dashboard">` (autoimportado) es el tipo de las props que una página puede pasar a `dashboard`; `LayoutName` es la unión de los nombres y `PageLayout<"/connections">`, el layout de una ruta.

**Comparación con Nuxt.** En Nuxt, `definePageMeta({ layout: "dashboard" })` elige el layout, pero no hay una forma tipada de pasarle props: se recurre a `useState`, a `provide`/`inject` o a `route.meta` (como un `showAlert` en `meta`), sin tipos contra el layout y con estado que puede quedar de la página anterior. En Meeko, `layout` y `layoutProps` se comprueban contra las `Props` del layout, llegan en el HTML del servidor, `useLayout()` las cambia de forma reactiva y cada navegación vuelve a las de la página nueva.

### Página de error de la aplicación (`app/error.meeko`)

`app/error.meeko`, junto a `app/app.meeko`, es la página de error de toda la aplicación. Recibe las mismas props que `+error.meeko`, `{ status: number; message: string }`, y `meeko check` las comprueba igual. Se usa en dos casos:

- **URL sin ruta.** Una petición de página (GET o HEAD con `accept: text/html`, o la navegación con `accept: application/meeko+json`) responde `404` con `app/error.meeko` dentro de los layouts raíz: `app/app.meeko` y `app/layouts/default.meeko` (o `app/pages/+layout.meeko`). Las props son `{ status: 404, message: "NOT_FOUND" }`. Como la página de error de una ruta, el documento se titula `Error` (`<title>` en SSR y `document.title` al navegar a una URL sin ruta). El documento lleva el payload de hidratación, así que el navegador lo hidrata y la navegación posterior funciona. En el navegador, un enlace o `navigate()` a una URL sin ruta carga el documento: esa URL puede pertenecer a middleware de servidor, a un archivo o a una redirección, y consultarla antes con `fetch` ejecutaría dos veces un `GET` con efectos. Si nada más la atiende, el servidor responde con `app/error.meeko`. Por la misma razón, volver con el historial a una entrada sin ruta recarga el documento; la navegación desde la página `404` hacia rutas de la aplicación sí es del cliente.
- **Página que falla.** El `+error.meeko` más cercano sigue ganando; si no hay ninguno, se usa `app/error.meeko`. Lo mismo vale para el loader de una ruta `render: "client"` en el navegador.

`/api/...`, `/_meeko/...`, los assets y las peticiones que no son de página mantienen sus respuestas `404` (JSON o texto). Sin `app/error.meeko` nada cambia: una URL sin ruta responde `404` en texto plano y el navegador recarga el documento. `app/error.meeko` y `app/pages/+error.meeko` definirían el mismo nivel, por eso tenerlos a la vez es un error de descubrimiento. En un layer o módulo, `app/error.meeko` respalda sus propias páginas; la `404` usa la del proyecto. Un host propio pasa la página con `errorPage` a `createFrameworkHandler` y a `mountClientApp` (`AppManifest.errorPage` en `createServerApp`).

### Código de servidor de la página

Una página declara su código de servidor en un bloque `<script server lang="ts">` dentro del propio `.meeko`, de modo que `app/pages` sólo contiene archivos `.meeko`. El bloque admite dos formas. Pueden convivir en el mismo bloque, salvo `load`, que no se combina con código de nivel superior:

- **Código de nivel superior** (desde `1.1`). El bloque es código de servidor normal: lee la petición, consulta la base de datos, redirige o responde `404`, y cada `export const` es un dato de la página que llega tipado al `<script>` y a la plantilla.
- **Opciones de ruta.** `export const route = definePage({ params, search, render, prerenderEntries, load, head })`, la forma de `1.0`, que sigue funcionando sin cambios; desde `1.5`, también `layout` y `layoutProps` (véase [Layouts con nombre](#layouts-con-nombre)), y desde `1.7`, `sitemapEntries` (véase [Rutas dinámicas en el sitemap](#rutas-dinámicas-en-el-sitemap-sitemapentries)).

#### Código de nivel superior y datos exportados

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
import * as v from "valibot";

export const route = definePage({ params: v.object({ id: v.string() }) });

const { params, context } = usePage();                 // la petición en curso, tipada por route.params
if (!context.session.current) redirect("/login");
const row = await db.users.findById(params.id);        // db: un autoimport de server/utils; row no sale del servidor
if (!row) notFound();
export const user = { id: row.id, name: row.name };    // se envía a la página
export const head = { title: `Perfil de ${user.name}` };
</script>

<script lang="ts">
const name = signal(user.name);                        // `user` está en ámbito y tipado
</script>

<template><h1>{user.name}</h1><input model="name"></template>
```

- **Cuándo se ejecuta.** Las sentencias del bloque que no son imports, tipos ni `export const route` se ejecutan en cada petición: en SSR y en la petición de datos de cada navegación cliente, después del middleware y de validar `params` y `search` con `route`, igual que `load`. Admiten `await` de nivel superior. Los imports, los tipos y las opciones de ruta se evalúan una vez por módulo.
- **Exports.** Cada `export const` o `export let` (también desestructurado, `export const { a, b } = ...`) salvo `route` y `head` es un campo de datos de la página. Sólo cruzan los nombres exportados: el resto del bloque, sus imports y sus variables privadas no llegan al bundle cliente ni al payload. Un export que es una promesa se espera antes de renderizar.
- **En la página.** El `<script>` y la plantilla ven cada export como un valor normal, de sólo lectura en profundidad, con el tipo del export ya esperado. No es una señal: llega en el payload y se sustituye en cada navegación, cuando el bloque vuelve a ejecutarse. Para estado editable, cree una señal a partir de él (`signal(user.name)`). Declarar en el `<script>` un nombre que ya exporta el bloque da `MEEK075`. La página no necesita declarar `data` en `defineProps`; si lo declara, `meeko check` comprueba que sea compatible con los exports.
- **`export const head`.** Fija el `<head>` de la página como `route.head`: un objeto `{ title, description }` o una función sin argumentos que lo devuelve, calculada en el servidor con los valores del bloque. No forma parte de los datos. Declarar a la vez `export const head` y `route.head` da `MEEK072`. Desde `1.2`, `useHead` y `useSeoMeta` en el nivel superior del bloque son una alternativa, y `export const head` gana sobre ellas (véase [Head del documento](#head-del-documento-document-usehead-y-useseometa)).
- **API de la petición.** `usePage()` devuelve `{ url, params, search, request, context, signal }`: `params` y `search` salen de los schemas de `route` o, sin schema, de los segmentos del ID de ruta; `context` es el contexto de la petición (sesión, servicios, plataforma) y `signal` se aborta si el cliente se desconecta, se revoca la sesión o se cancela la respuesta. `redirect(url, status?)` detiene el bloque y responde con una redirección (`302` por defecto; admite `301`, `302`, `303`, `307` y `308`), que una navegación cliente sigue como la de un loader. `notFound()` detiene el bloque y responde `404` con la página de error más cercana (`+error.meeko` o `app/error.meeko`). Las tres se importan de `@meekojs/meeko/framework` o se usan sin import dentro del bloque. Valen mientras se ejecuta el código de nivel superior: también dentro de un helper del bloque al que ese código llama (`function requireAdmin() { … redirect("/login") }`), aunque sea `async`. Donde no hay página en curso dan `MEEK073`, y en ejecución lanzan un error con ese código: en las opciones de ruta, en un bloque sin código de nivel superior, en el `<script>` del componente (desde `1.3`, también sin import en el `<script>` y en la plantilla) y, desde `1.7`, en una función que Meeko llama al calcular el head, cuando el código de nivel superior ya terminó (`export const head = () => …` y la función de `useHead(() => …)` o `useSeoMeta(() => …)`); lea allí los valores que obtuvo el nivel superior. `meeko check` no puede saber si una función del bloque se llama más tarde (desde un temporizador, por ejemplo): en ese caso el error sólo aparece en ejecución.
- **Serialización.** Los exports viajan en JSON, como los datos de `load`. `meeko check` da un error de tipos en un export que no se puede serializar: funciones, `undefined`, `bigint`, símbolos e instancias de clase como `Date` o `Map`. En ejecución, un valor que `serializeJson` rechaza hace fallar la respuesta con `500`, como un loader.
- **Estado entre peticiones.** Como el bloque se ejecuta en cada petición, una variable de nivel superior (`const cache = new Map()`) es nueva cada vez. Un valor que deba compartirse entre peticiones vive en un módulo importado.

Meeko considera que un bloque tiene código de nivel superior si exporta con `export const` o `export let` un nombre distinto de `route` (incluido `head`), o si usa `usePage`, `redirect` o `notFound` (desde `1.2`, también `useHead` o `useSeoMeta`) fuera de cualquier función y fuera de las opciones de ruta. Un bloque sin ninguna de las dos cosas mantiene el comportamiento de `1.0`: se evalúa una vez como módulo y admite `export default`, `export function` o una constante privada usada por `load`. Con código de nivel superior se aplican estas reglas:

| Código | Causa |
| --- | --- |
| `MEEK070` | Código de nivel superior y `route.load` a la vez: los exports son los datos de la página. Elija uno. |
| `MEEK071` | `export function`, `export class`, `export enum`, `export default`, `export { ... }` o `export const route` junto a otras declaraciones en la misma sentencia. |
| `MEEK072` | `export const head` y `route.head` a la vez. |
| `MEEK073` | `usePage`, `redirect` o `notFound` donde no hay página en curso: en las opciones de ruta, en un bloque sin código de nivel superior, en el `<script>` y la plantilla del componente y, desde `1.7`, en `export const head = () => …` o en la función de `useHead` y `useSeoMeta`. |
| `MEEK074` | Código de nivel superior en una página `render: "client"`, cuyo bloque se ejecuta en el navegador. Use `useApi` o `useRpcQuery`, o renderice en el servidor. |
| `MEEK075` | Un nombre exportado por el bloque se declara también en el `<script>`. |
| `MEEK076` | Las opciones de ruta leen un nombre declarado por el código de nivel superior, que se ejecuta después y en cada petición. Mueva el valor compartido a un módulo importado. |

El editor da a los exports su tipo en el `<script>` y en la plantilla, y «ir a definición» sobre `user` lleva al `export` del bloque.

#### Opciones de ruta con `definePage`

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.string() }),
  load: async ({ params, signal }) => ({ id: params.id, signalAborted: signal.aborted }),
  head: ({ data }) => ({ title: data.id }),
});
</script>

<script lang="ts">
export interface Props { params: { id: string }; search: Record<string, string | string[]>; data: { id: string; signalAborted: boolean } }
const props = defineProps<Props>();
</script>

<template><h1>{props.data.id}</h1></template>
```

#### Reglas comunes

El bloque es un módulo TypeScript independiente del componente:

- **Sólo servidor.** El componente compilado nunca lo incluye. Se ejecuta en el servidor con los autoimports de `server/utils` y puede importar `server/` y módulos `*.server.*`; sus imports relativos se resuelven desde la carpeta de la página. Sólo una ruta `render: "client"` lo envía al navegador (véase «Modos de render»).
- **Opciones de ruta.** Igual que un sidecar: `export const route = definePage({ ... })` o, sin código de nivel superior, `export default`. `render` y, desde `1.5`, `layout` deben ser literales que `meeko build` pueda leer sin ejecutarlo.
- **Sólo en páginas.** Un `<script server>` en un componente, un layout, `+layout.meeko` o `+error.meeko` es un error (`MEEK044`). Un segundo bloque da `MEEK004`, sin `lang="ts"` da `MEEK006` y con un valor (`server="..."`) da `MEEK043`.
- **Comprobación.** `meeko check` comprueba el bloque con TypeScript en el ámbito del servidor y compara su loader, o sus exports, con las props de la página; los errores señalan la línea y columna del `.meeko`.

`head({ data })`, o `export const head`, devuelve el `title` de la página y, desde `1.1`, su `description`. En SSR, `title` va en `<title>` y `description` en `<meta name="description">`, antes del `<head>` del host; en una navegación se aplican a `document.title` y a esa meta. Una página sin `title` o sin `description` deja los que aporta el host en `document.head`, o ninguno, igual en SSR que al navegar. Desde `1.2`, el `head` de la ruta admite también las etiquetas y atributos de `useHead` (`meta`, `link`, `script`, `style`, `htmlAttrs`, `bodyAttrs` y `titleTemplate` como cadena) y tiene la máxima prioridad frente a `useHead` y a `document` de la configuración; el título y la descripción del host quedan detrás del head que gestiona Meeko (véase [Head del documento](#head-del-documento-document-usehead-y-useseometa)).

Como alternativa, las opciones de ruta pueden vivir en un sidecar `*.route.ts` junto a la página (`app/pages/users/[id].route.ts`), la forma disponible desde `1.0`. Un sidecar no admite código de nivel superior. Una página no puede declarar ambos: Meeko detiene el descubrimiento de rutas con un error que nombra los dos.

Las opciones de ruta validan params y search antes del loader y del código de nivel superior. El loader puede devolver un `Response` para redirigir; el código de nivel superior usa `redirect()`. En una navegación cliente, si la petición de datos responde `404` (por `notFound()` o por un `ApiError` con estado `404` del loader), el navegador muestra el `+error.meeko` más cercano, o `app/error.meeko`, con `{ status: 404, message }`, donde `message` es el código público del error (`NOT_FOUND`), igual que el documento SSR. `meeko check .` compara el `ComponentProps` de cada página con los `params`, `search` y datos que entrega su sidecar; un error de contrato identifica ambos archivos. También comprueba que `app/app.meeko` y los layouts acepten el `outlet` suministrado por Meeko, y que `+error.meeko` y `app/error.meeko` acepten `status` y `message`. Estos contratos rechazan props declaradas como `any`, `never` o `unknown`. Los datos del loader son obligatorios para la página cuando el sidecar declara `load`; una query repetida sin schema puede producir `string[]`, además de `string`. El handler SSR crea el estado de `useState` y el contexto de sesión por petición; transfiere sólo props, estado público y datos de ruta serializables. El navegador hidrata ese payload y pide datos al servidor durante la navegación, por lo que un sidecar privado no entra al bundle cliente; sólo los sidecars `render: "client"` son públicos (véase «Modos de render»). `mountClientApp` gestiona historial, cancelación y limpieza. Si un host usa `loadRoute` directamente en cliente, su loader recibe un estado provisional: Meeko aplica sus cambios al confirmar la ruta y los descarta al cancelar o fallar. Las señales de ese estado deben usarse durante `load`, sin conservar referencias después de retornar. Se puede usar `render: "prerender"` con `prerenderEntries` para rutas dinámicas; sin ellas, `meeko build` falla (`Dynamic prerender route /posts/[id] requires prerenderEntries`) y, desde `1.7`, también `meeko check` y `meeko dev` al descubrir las rutas, salvo que un spread de las opciones pueda traerlas, que se deja al build. `meeko build` lee `render` del sidecar sin ejecutarlo: debe ser un literal de texto dentro de `definePage({ ... })`, de un objeto exportado o de una constante local del mismo archivo; un valor calculado, una clave computada (`["render"]` o `[clave]`) que no vaya seguida de un `render` literal, un spread sin `render` explícito posterior o una reexportación detienen el build con el archivo afectado. El build escribe el HTML y el payload de navegación bajo `.meeko/output/node/prerender/` (`meeko prerender .` repite ese paso sobre un build existente). El servidor sirve esas páginas pasando por el middleware de servidor, el contexto de sesión y el middleware de ruta; inserta la meta CSRF de la sesión en `<head>` sin reescribir el documento. Sin sesión responde con `ETag`, `Vary: cookie` y `cache-control: public, max-age=0, must-revalidate`, y devuelve `304` ante `If-None-Match`; con sesión responde `private, no-store`. Una CDN o caché compartida delante del servidor debe respetar `Vary: cookie` o no almacenar respuestas de peticiones con cookie; si ignora `Vary`, configúrela para omitir la caché cuando la petición traiga la cookie de sesión, porque de lo contrario podría entregar la versión anónima a un usuario con sesión y dejarlo sin meta CSRF. `PrerenderedPage.headOffset` del índice `prerender/manifest.json` se mide en unidades de código UTF-16 del HTML almacenado leído como texto (índices de cadena de JavaScript), no en bytes: un adaptador debe leer el archivo como texto UTF-8 y usar el valor tal cual, sin calcularlo a partir de bytes. Una URL con query string, una entrada dinámica no generada o un host con nonce CSP propio (sin `server.contentSecurityPolicy`, que desde `1.7` sirve el archivo con sus hashes) se renderizan con SSR.
La comprobación del loader cubre tanto `definePage({ load() { /* ... */ } })` como `definePage(options)` cuando el tipo de `options` conserva un `load` obligatorio.

#### Dónde se usa cada API

El `<script>` y la plantilla de un componente se ejecutan en SSR y también en el navegador; `<script server>` y los sidecars `*.route.ts` se ejecutan en el servidor, fuera del componente. Desde `1.3`, `meeko check`, `meeko build` y el editor señalan cada API en el lugar donde no existe, con un mensaje que dice dónde se usa, y el autocompletado del `<script>` y de la plantilla deja de ofrecer las de servidor:

| API | `<script server>` | `<script>` y plantilla | Sidecar `*.route.ts` | `server/` |
| --- | --- | --- | --- | --- |
| `definePage` | Sí: `export const route` | No tiene efecto: aviso `MEEK109`, error en `2.0` | Sí | No tiene efecto |
| `usePage`, `redirect`, `notFound` | Sí, en el nivel superior; fuera de él, `MEEK073` | No: `MEEK073` | No: lanzan `MEEK073` | No: lanzan `MEEK073` |
| `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime`, `ApiError` | Sí, sin import | No: `MEEK108`. En el navegador, un error de API llega como `ClientError` | Sí | Sí, cada una en su carpeta |
| Autoimports de `server/utils`, de `imports.serverDirs` y de los `*.server.ts` de cualquier carpeta de autoimports (también las de `imports.appDirs`) | Sí | No: `MEEK108`. Pida los datos con `useApi` o `useRpcQuery` | Sí | Sí |
| Imports de `server/` y de módulos `*.server.*` | Sí | No: `MEEK108`; `import type` sí | Sí | Sí |
| Imports de valores de `@meekojs/meeko/server` y `/cloudflare` | Sí | No: `MEEK108`; `import type` sí | Sí | Sí |
| Imports de valores de `@meekojs/meeko/node`, `/bun`, `/deno`, `/password` y `/build` | Sí | Aviso `MEEK109`, error en `2.0`; `import type` sí | Sí | Sí |
| `defineProps`, `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets`, `useElementRef`, `onMounted` | No: `MEEK108` | Sí | No | No |

Desde `1.6`, un [middleware de ruta de servidor](#middleware-de-ruta-de-servidor) (`app/middleware/*.server.ts`) es código de servidor como `server/`: usa `redirect()` y `notFound()` mientras se ejecuta, como el nivel superior de `<script server>`, y `defineServerRouteMiddleware` se autoimporta allí; en el `<script>` o la plantilla de un componente es `MEEK108`.

Con `render: "client"`, el bloque o el sidecar se ejecutan en el navegador (véase [Modos de render](#modos-de-render)) y no pueden usar las APIs de servidor de la tabla: un autoimport de servidor, un import de `server/` o uno de `*.server.*` detienen el build, y el editor marca el autoimport con `MEEK_AUTOIMPORT`. Un componente dentro de `server/` (una plantilla de correo, por ejemplo) sólo se renderiza en el servidor, así que puede usar las APIs de servidor. El build y `meeko dev` sólo aplican `MEEK108` al bundle del navegador: un componente fuera de `server/` que sólo importa código de servidor (una plantilla en `app/emails/` que renderiza una ruta de API) sigue compilando, como en `1.2`. `meeko check` y el editor, que no conocen el grafo de imports, comprueban todo componente fuera de `server/` como código del navegador, igual que en `1.2`; para que lo acepten, ponga esos componentes en `server/`.

`MEEK108` señala código que ya fallaba antes de `1.3`: el autoimport de servidor no se resolvía en el bundle del navegador, `@meekojs/meeko/server` y `/cloudflare` no se pueden cargar allí, un import de `server/` detenía `meeko build`, y las macros y `onMounted` no existen fuera del `<script>`. `MEEK109` es un aviso porque ese código compila y se carga: `definePage` en el componente no configura la ruta, y las funciones de `/node`, `/bun`, `/deno`, `/password` y `/build` sólo fallan al llamarlas en el navegador (véase [Política de estabilidad](stability.md#apis-deprecadas)).

### Modos de render

`render` del sidecar elige cómo llega cada página al navegador:

| Modo | HTML del servidor | Loader y `head` | Uso |
| --- | --- | --- | --- |
| `"ssr"` (por defecto) | Página completa en cada petición | Servidor | Contenido indexable o personalizado |
| `"stream"` | Página sin los valores `defer`, que llegan después por la misma respuesta | Servidor | Páginas con datos lentos y secundarios |
| `"prerender"` | Página completa generada en `meeko build` | Servidor, durante el build | Contenido estático |
| `"client"` | Sólo los layouts, con el outlet vacío | Navegador | Paneles y vistas interactivas sin requisitos de SEO |

El código de nivel superior de `<script server>` sigue el modo como un loader: con `"ssr"` y `"stream"` se ejecuta en cada petición y con `"prerender"` una vez por entrada durante `meeko build`. En `"stream"`, un export creado con `defer(...)` llega después de la página, como un valor diferido del loader (véase [Streaming SSR](#streaming-ssr-render-stream)). Con `"client"` no se admite (`MEEK074`), porque el bloque se ejecuta en el navegador.

```html
<!-- app/pages/notes/index.meeko: el bloque se ejecuta en el navegador -->
<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "client",
  load: async ({ url, params, search, signal, state }) => api.notes.list({ signal }),
  head: ({ data }) => ({ title: `${data.length} notas` }),
});
</script>
```

Con `render: "client"` el bloque `<script server>` (o el sidecar) es público: entra en el bundle del navegador con los autoimports de cliente, aunque su etiqueta diga `server`.

Con `render: "client"` el servidor ejecuta el middleware de servidor y de ruta, crea el contexto de sesión y valida `params` y `search` con los schemas del sidecar (una entrada inválida responde `400`). Después renderiza `app/app.meeko` y los layouts con un outlet vacío, sin llamar a `load` ni a `head`, y envía un payload con `render: "client"` y sólo `params` y `search`. Sin layouts, `#app` queda vacío. En el navegador, Meeko hidrata los layouts, ejecuta `load` con `ClientPageLoadContext` (`url`, `params`, `search`, `signal` y `state`, sin `request` ni `context`) y confirma la página por la misma vía transaccional que una navegación; `head` se ejecuta después de `load` y su `title` se aplica a `document.title`. Un fallo del loader muestra el `+error.meeko` más cercano dentro de los layouts, con el mismo mensaje público que el servidor (`500` informa al observador de errores de navegación; un `ClientError` 4xx conserva su estado y código).

La navegación funciona en ambos sentidos entre páginas SSR y de cliente y conserva los layouts comunes: cada ruta elige su origen de datos. Las páginas `"client"` usan su sidecar en el navegador y las demás piden su payload al servidor. Sólo los sidecars `"client"` entran al bundle cliente, mediante el módulo virtual `virtual:meeko-client-routes`; la entrada generada los carga con `mountClientApp({ loadClientRoute })`. Por eso el build aplica la misma frontera que al resto del código cliente: importar `server/` o un módulo `*.server.*` desde ese sidecar detiene `meeko build`, y en el navegador sólo hay autoimports de cliente, por lo que usar un util de `server/utils` falla con un error que nombra el autoimport.

Compromisos de `"client"`:

- **SEO.** El HTML inicial no contiene los datos ni el `<title>` de la página. Los buscadores que no ejecutan JavaScript sólo ven los layouts. Use `"ssr"` o `"prerender"` para contenido indexable.
- **Seguridad de los datos.** El sidecar es público: no puede contener secretos ni comprobar permisos. Los datos llegan por API o RPC, y cada endpoint debe aplicar sus propias guardas (sesión, CSRF, autorización y validación). El middleware de ruta protege la navegación, pero no los datos.
- **Prerender.** Una página `"client"` no se puede prerenderizar: declarar `prerenderEntries` junto a `render: "client"` detiene `meeko check`/`meeko build` con un error explícito.
- **Build coherente.** El servidor compara el `render` del sidecar con el del manifiesto del build y responde con error si difieren; vuelva a ejecutar `meeko build` (o reinicie `meeko dev`) al cambiar el modo de una ruta.

### Streaming SSR (`render: "stream"`)

Un loader marca con `defer` los datos que pueden llegar después de la página. `defer(promise, { timeoutMs })` o `defer((signal) => promise, { timeoutMs })` devuelve un `Deferred<T>` con `status` (`"pending"`, `"resolved"` o `"rejected"`), `value` y `error` (`{ code, status }`). Leer esos campos en una plantilla o un `effect` se suscribe al resultado, porque están respaldados por señales.

Con una fábrica, Meeko la invoca cuando el loader devuelve y le pasa un `AbortSignal` que se aborta cuando el valor deja de esperarse: al agotar `timeoutMs`, si el cliente se desconecta, si se revoca la sesión, si el stream se cancela, en una petición `HEAD` o, en el navegador, al salir de la ruta. Pásela a `fetch` o a su cliente de base de datos para cancelar de verdad el trabajo. Una promesa ya iniciada no se puede cancelar: Meeko sólo deja de esperarla, salvo que el propio trabajo use `context.signal` del loader, que también se aborta en esos casos (salvo el timeout, que es propio de cada valor).

```ts
// app/pages/posts/[id].route.ts
import { defer, definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "stream",
  load: async ({ params }) => ({
    post: await api.posts.get({ params }),          // crítico: entra en el HTML inicial
    comments: defer((signal) => api.comments.list({ params, signal }), { timeoutMs: 5_000 }),
  }),
  head: ({ data }) => ({ title: data.post.title }),
});
```

```html
<p if:when="props.data.comments.status === 'pending'">Cargando comentarios…</p>
<ul if:when="props.data.comments.status === 'resolved'">…</ul>
<p if:when="props.data.comments.status === 'rejected'">No se pudieron cargar ({props.data.comments.error?.code}).</p>
```

**Fase 0, antes del primer byte.** El servidor resuelve la ruta, crea el contexto y la sesión, ejecuta el middleware, valida `params` y `search`, espera el loader crítico (todo lo que no está en `defer`), renderiza de forma síncrona la página y todos sus layouts con los diferidos en `pending` y calcula `head`, que ve el estado escrito durante el render. Después sella el estado (`StateStore.seal()`: una escritura posterior lanza `STATE_SEALED` y el valor diferido que la provocó se rechaza con `500`), espera los cambios de sesión que sigan en curso (`create`, `rotate` o `revoke` iniciados por el loader) y llama a `context.session.verify()`; una sesión revocada mientras corría el loader responde `401` en lugar de un `200` parcial. Estado, cabeceras, cookies, token CSRF y `<title>` quedan fijados ahí: no se puede redirigir ni cambiar la sesión desde trabajo diferido. Desde ese momento `create`, `rotate` y `revoke` fallan con `SESSION_LOCKED`/`500` antes de tocar el almacén, de modo que la sesión del navegador sigue siendo válida: sólo se rechaza el valor diferido que lo intentó, el fallo llega a `onError` y los demás valores siguen llegando.

El sellado se aplica a todos los modos de render, no sólo a `"stream"`. Una escritura de estado desde una promesa que nadie espera (ni el loader con `await` ni un `defer`) lanza `STATE_SEALED` dentro de esa promesa; si no la captura, es un rechazo no manejado y Node termina el proceso con su configuración por defecto. Espere ese trabajo en el loader o devuélvalo con `defer`.

**Fase 1, el stream.** La respuesta lleva `cache-control: no-store, no-transform` y `x-accel-buffering: no`. Primero se envía el documento hasta `#app`, el payload `#meeko-payload` (con `deferred: [{ id, path, status: "pending" }]` y `null` en cada `path`) y la entrada cliente con `<script type="module" async>`, que respeta el nonce CSP del host. Por cada valor que se resuelve, en el orden en que se resuelve, sigue un `<script type="application/json" data-meeko-deferred="N">{"deferred":N,"value":…}</script>` (o `"error":{"code","status"}`), y al final `</body></html>`. Son bloques de datos, no scripts ejecutables, así que una CSP estricta sin `'unsafe-inline'` no necesita excepciones.

**Errores y cancelación.** Un rechazo se serializa sólo como `{ code, status }` con las mismas reglas que la API: un `ApiError` conserva su código y estado; cualquier otro error se convierte en `INTERNAL_ERROR`/`500` y su causa privada se envía a `onError` con el `requestId` de la respuesta. Un valor que no termina en `timeoutMs` (10 s por defecto) se rechaza con `DEFERRED_TIMEOUT`/`504`. Los diferidos siguen `RequestContext.signal`: si el cliente se desconecta o falla una escritura del adaptador, el stream se cancela, Meeko deja de esperar los diferidos pendientes y aborta la señal de sus fábricas y la `signal` del loader, sin informar a `onError`; si se revoca la sesión, los que quedan se envían como `SESSION_REVOKED`/`401`. Una petición `HEAD` recibe las cabeceras finales sin cuerpo y aborta igualmente esas señales. Una promesa pasada directamente a `defer` sigue ejecutándose hasta terminar por su cuenta.

**Navegador.** El cliente hidrata con todos los diferidos en `pending`, como los renderizó el servidor, y aplica los valores ya llegados sólo cuando termina la hidratación. Encuentra los bloques que ya estaban en el documento y los que añade el parser después mediante un `MutationObserver` sobre `<body>`. Sólo acepta los bloques que son hijos directos de `<body>` y están después de `#meeko-payload`, donde los escribe el servidor; un bloque con el mismo aspecto dentro de `#app` (por ejemplo, HTML de usuario) se ignora. Si el documento termina sin el bloque de algún valor (por ejemplo, porque falló una escritura), ese valor se rechaza con `DEFERRED_INCOMPLETE`/`502`. En una navegación cliente a una ruta `"stream"`, Meeko pide `accept: application/meeko+json` y el servidor responde `application/meeko+ndjson`: la primera línea es el payload, con el que se confirma la ruta, y cada línea siguiente es `{ "deferred": id, "value" | "error" }`. Una línea mal formada se informa a `onError` y no detiene la lectura; si la conexión falla a mitad, el fallo se informa y los valores que no llegaron se rechazan con `DEFERRED_INCOMPLETE`/`502`. Navegar a otra ruta cancela la lectura pendiente. Las demás rutas siguen respondiendo `application/meeko+json`.

**`stream` frente a `ssr`.** Con `render: "ssr"` o `"prerender"`, un `defer` se espera dentro del servidor antes de renderizar: el HTML siempre contiene el valor resuelto (o su error) y es seguro para SEO, así que una página puede pasar de un modo a otro sin cambiar la plantilla. Con `"prerender"`, un valor rechazado no se guarda: la petición responde `500` y `meeko build` se detiene indicando la ruta y el `path` del valor. El HTML prerenderizado y su `index.meeko.json` salen de la misma ejecución del loader. Use `"stream"` cuando una parte secundaria de la página (comentarios, recomendaciones, métricas) es lenta y no debe retrasar el primer pintado ni la interactividad. Compromisos:

- **SEO.** El contenido diferido no está en el HTML inicial del SSR, sino en bloques de datos posteriores que sólo se muestran al ejecutar JavaScript. Lo que deba indexarse tiene que ir en el loader crítico o en una página `"ssr"`.
- **Proxies y CDN.** Un proxy, balanceador o CDN que almacena la respuesta completa antes de reenviarla anula el streaming: el usuario espera igual que con `"ssr"`. Meeko envía `x-accel-buffering: no` (respetado por nginx) y `cache-control: no-store, no-transform`: `no-transform` pide a los intermediarios que no compriman ni reescriban el cuerpo, porque una compresión o reescritura con buffer retendría los bloques. En Cloudflare, `no-transform` desactiva la compresión hacia el visitante y las funciones que modifican el HTML, pero no la inspección de sólo lectura: si una zona la tiene activa, cree una Configuration Rule con «Response Body Buffering» en «None» para esas rutas. En local, `wrangler dev` y `meeko preview --adapter cloudflare` (Miniflare) comprimen con gzip las respuestas `text/html` aunque lleven `no-transform` y sólo escriben el cuerpo comprimido al terminar, así que una página `"stream"` parece llegar entera al final salvo que el cliente envíe `accept-encoding: identity`. En producción, la compresión de Cloudflare sí respeta `no-transform`. Otros intermediarios o funciones serverless sin respuestas en streaming deben configurarse aparte. Los adaptadores Node, Bun y Deno escriben cada bloque en cuanto se produce; la suite de conformidad comprueba que el primer byte llega antes que el valor diferido.
- **Cabeceras finales.** Redirecciones, cookies, CSRF y `<title>` dependen sólo de los datos críticos. Mover algo a `defer` lo saca de esas decisiones.
- **Loaders en el navegador.** Un sidecar `"client"` (o un host que usa `loadRoute`) también puede devolver `defer`: el navegador aplica el mismo `timeoutMs`, el valor se actualiza cuando su promesa termina y la señal de una fábrica se aborta al agotar el plazo o al salir de la ruta.
- **Claves.** Un valor diferido puede estar bajo cualquier clave propia, incluidas `constructor` y `prototype`, salvo `__proto__`: el servidor responde `500` al renderizar.

### Caché de páginas SSR

Desde `1.7`, `cache` de `definePage` permite revalidar y cachear una página `"ssr"` o `"stream"` sin ejecutar su loader ni su render en cada petición:

```html
<!-- app/pages/docs/[...slug].meeko -->
<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  cache: {
    // Barato: una consulta de la fecha de modificación, no del documento.
    etag: async ({ params }) => (await docs.updatedAt(params.slug))?.toISOString(),
    maxAge: 60,
    staleWhileRevalidate: 600,
    memory: { maxEntries: 500 },
  },
  load: ({ params }) => docs.get(params.slug),
});
</script>
```

- **`etag(ctx)`** devuelve la versión del contenido (una cadena o un número) y se llama antes del loader y del render, con `url`, `params` y `search` ya validados, `request`, `signal` y `context`. Meeko la combina con el tema de la petición (cookie y client hint), el build y el tipo de respuesta (documento o payload de navegación) en un `ETag` débil, `W/"…"`. Si coincide con `If-None-Match`, responde `304` sin loader, sin plugins y sin render. Debe cambiar con todo lo que cambia el HTML salvo el tema: si la página lee una cabecera o un parámetro de búsqueda que no está en `params`, inclúyalo. `undefined` deja esa respuesta sin `ETag`.
- **`maxAge`** y **`staleWhileRevalidate`** (segundos) escriben `Cache-Control: public, max-age=N, stale-while-revalidate=M`. Sin `maxAge`, `public, max-age=0, must-revalidate`: el navegador revalida cada vez, y el `ETag` le ahorra el cuerpo.
- **`memory`** (`true` o `{ maxEntries, maxBytes }`, por defecto 1000 entradas y 32 MiB por ruta y proceso) guarda el HTML y el payload renderizados en una LRU, con la clave URL, tema y tipo de respuesta, y el `ETag` con el que se renderizaron. Desde `1.7`, en una ruta con schema `search`, la parte de la URL tras `?` es el `search` validado: un parámetro que la ruta no declara (`?utm_source=…`, un número aleatorio para saltarse la caché) comparte la copia en lugar de llenar la LRU; sin schema, cuenta la query tal como llega, porque la página la recibe entera. Mientras `etag` devuelva lo mismo, mientras `etag` devuelva lo mismo, Meeko sirve la copia sin loader ni render; cuando cambia, la copia se descarta y la página se renderiza otra vez. Necesita `etag`. Dos peticiones simultáneas que no encuentran copia renderizan las dos.

La respuesta lleva `Vary: Accept, Cookie` (y `Sec-CH-Prefers-Color-Scheme` con el tema en `"system"`), porque el documento y el payload comparten URL y el HTML depende del tema y de la sesión. Con `server.contentSecurityPolicy`, el documento de una página con `cache` no lleva nonce y su CSP lleva los hashes del código en línea que escribe Meeko, nunca los de un `<script>` o un `<style>` que llegue dentro de la página (véase [CSP y cabeceras en los adaptadores con servidor](#csp-y-cabeceras-en-los-adaptadores-con-servidor)); el `304` no lleva CSP, así que el navegador conserva la de su copia.

**Qué nunca se cachea.** La caché sólo se aplica en producción (en `meeko dev` cada petición renderiza lo que acaba de compilar) y a peticiones `GET` y `HEAD` sin sesión:

- una petición con la cookie de sesión, aunque haya caducado, o con `session.current`, sale como siempre, con `no-store` y sin `ETag`: su HTML lleva el token CSRF de esa sesión;
- una respuesta que pone una cookie (un loader que crea la sesión, por ejemplo) sale con `no-store`, sin `ETag` y sin copia en memoria; en desarrollo, Meeko lo avisa una vez por ruta en la consola;
- desde `1.7`, una petición con la cabecera `Authorization` sale con `no-store` y sin `ETag`, sin leer ni escribir la copia: se responde para esas credenciales;
- un host con su propio nonce (`DocumentOptions.nonce` sin `server.contentSecurityPolicy`) no cachea: la copia llevaría el nonce de otra respuesta;
- una petición con la cookie de un solo uso del resultado de un formulario sin JavaScript (`__Host-meeko-form`, o `meeko-form` sin HTTPS) no recibe `304` ni la copia en memoria, no se guarda y, en una página prerenderizada, se renderiza en lugar de servir el archivo;
- y, en cualquier respuesta de la aplicación, `Set-Cookie` con un `Cache-Control` `public` o, desde `1.7`, con `s-maxage` (también si lo añade `server.headers`) se convierte en `private, no-store` sin `ETag`.

**Personalizar con cookies propias.** Meeko sólo reconoce su cookie de sesión. Una página con `cache` que personaliza el HTML con otra cookie (idioma, moneda, un carrito anónimo, un test A/B) lo comparte: `etag` no la ve si no la lee, y `memory` sirve la misma copia a todos. `Vary: Cookie` sólo evita que una caché compartida mezcle respuestas con cookies distintas. Si el HTML depende de una cookie propia, incluya su valor en lo que devuelve `etag` y no use `memory`, o no use `cache` en esa página.

**Middleware.** El middleware de ruta (isomórfico y de servidor) se ejecuta siempre, antes del `304` y de la copia en memoria: una guarda nunca se salta por la caché. Con `memory`, los plugins de aplicación no se ejecutan en una petición servida desde la copia.

**`render: "stream"`.** Sólo usa el `ETag` y el `304`: su cuerpo sale mientras se resuelven los valores `defer`, así que guardarlo obligaría a esperar a todos (lo contrario de un stream) y fijaría valores que pueden cambiar en cada petición. Su `Cache-Control` añade `no-transform`, como siempre, y su CSP lleva los hashes del documento sin los valores diferidos, que son bloques de datos JSON. Con `"prerender"`, `cache` sólo afecta al SSR de las URL que no se prerenderizaron; una página `"client"` no admite `cache` (error de tipos y `TypeError` al definirla).

`cache` se lee al ejecutar la ruta, como `load`: `meeko build` no la lee del archivo. `definePage` la valida al cargar el módulo (un campo desconocido, un número negativo o `memory` sin `etag` lanzan `TypeError`).

### Enlaces, anclas y scroll

`mountClientApp` convierte en navegación cliente los clics en enlaces del mismo origen hacia una ruta de la aplicación, también los del HTML insertado con `html`. Un enlace a un fragmento de la página actual (`#seccion`, o `/docs#seccion` estando en `/docs`) no se intercepta: el navegador desplaza la página y añade la entrada al historial sin volver a pedir ni renderizar la página, y volver atrás o adelante entre esos fragmentos tampoco la renderiza. `app.navigate("#seccion")` hace lo mismo.

Una navegación nueva empieza arriba de la página o, si su URL tiene un fragmento que nombra un elemento (`id` o `name`), en ese elemento, de forma inmediata aunque la página use `scroll-behavior: smooth`. Una navegación por el historial o con `replace` sólo se desplaza al fragmento, si lo hay. Si la petición de datos de una navegación recibe HTML en lugar de un payload (un hosting estático que sirve el `index.html` prerenderizado, un proxy o una CDN), Meeko carga ese documento en vez de fallar.

### Estado de navegación

`useNavigation()` devuelve `{ pending }`, una señal de sólo lectura que vale `true` desde que empieza una navegación hasta que su página se confirma, falla o se cancela, incluida la primera carga de una página `"client"` y la carga de los `await useApi`/`await useRpcQuery` de la página nueva (véase [Navegación y `render: "client"`](#navegación-y-render-client)). En SSR y fuera de `mountClientApp` vale siempre `false`. Desde `1.7` se autoimporta, como `useRoute` (un export propio con ese nombre tiene prioridad).

```ts
import { useNavigation } from "@meekojs/meeko/framework";

const nav = useNavigation();
// <p if:when="nav.pending.value">Cargando…</p>
```

### Ruta actual

Desde `1.2`, `useRoute()` devuelve la ruta confirmada que renderiza el componente, con una señal de sólo lectura por valor (tipo `RouteState`):

| Campo | Valor |
| --- | --- |
| `url` | URL relativa al origen, como cadena: `pathname`, `search` y, en el navegador, el fragmento (`/users/42?tab=a#bio`). No lleva el origen, así que coincide en un HTML prerenderizado en otro dominio. |
| `path` | `pathname`, codificado como en `location.pathname` (`/users/42`). |
| `id` | ID de la ruta en el manifiesto (`"/users/[id]"`), o `null` en la página `404` de `app/error.meeko` para una URL sin ruta. |
| `params` | Parámetros de la ruta, con la misma forma que recibe la página (validados por su schema). |
| `search` | Parámetros de búsqueda, con la misma forma que recibe la página; en la página `404`, la query string con las claves repetidas en arrays. |
| `isActive(to, { params?, prefix? })` | Desde `1.5`, una función, no una señal: si la ruta `to` está activa, con la regla de `<MeekoLink match>`. Devuelve `"page"` en la ruta exacta y, con `prefix: true`, `"true"` en una ruta por debajo; si no, `false`. |

Se autoimporta en las aplicaciones (un export propio llamado `useRoute` en `app/composables` u otra carpeta de autoimports tiene prioridad sobre el del framework) y, como `useNavigation`, puede llamarse también desde código anidado que se ejecuta con el componente (un composable, un `computed`, un `effect` u `onMounted`), pero no desde un manejador de eventos, un temporizador ni el callback de una promesa, donde no hay raíz activa: ahí lanza (`useNavigation` devuelve un estado fijo con `pending` en `false`); pídela en el script y úsala en el manejador. Funciona en páginas, layouts, `app/app.meeko`, `app/error.meeko` y sus componentes:

- **SSR.** Los valores son los de la petición, también en las rutas `"prerender"` y `"stream"` y en los layouts de una ruta `"client"`. El servidor no recibe el fragmento, así que en SSR `url` nunca lo lleva.
- **Hidratación.** El navegador hidrata con los mismos valores que el SSR, sin desajustes, también cuando el HTML se renderizó para otra URL: el `404.html` del adaptador `static`, que el hosting sirve en cualquier URL inexistente, o una página prerenderizada que un hosting estático sirve con cualquier query string. El payload lleva la URL del render (campo opcional `url`, desde `1.6`). Justo después de la hidratación, `url` y `path` pasan a ser los de la dirección del navegador, con su `#fragmento`; en la página `404` también `search`, y en una página, `params` y `search` siguen siendo los que validó el servidor.
- **Navegación.** Los valores cambian sólo cuando una navegación se confirma, a la vez que el outlet, nunca mientras `useNavigation().pending` vale `true`; la página anterior se libera antes de que se actualicen los efectos que leen la ruta. También cambian al volver atrás o adelante en el historial y en una navegación sólo de fragmento, donde `path` se mantiene y cambia `url`. El render previo que carga los `await` de datos de la página nueva ya ve la ruta de destino.
- **Fuera de una aplicación.** Fuera de un render del framework o de `mountClientApp` (por ejemplo, en una prueba unitaria con `renderToString`), `useRoute()` lanza un error que lo explica, en lugar de inventar una ruta; pase la ruta al componente como prop en esas pruebas.

**`isActive`.** Desde `1.5`, `route.isActive(to, { params, prefix })` dice si una ruta está activa con la misma regla que [`<MeekoLink match>`](#meekooutlet--y-meekolink), para los enlaces y componentes propios. `to` es un `RouteId` y `params`, los de esa ruta, con el tipo de `href()`: obligatorios en una ruta dinámica, no admitidos en las demás, y una ruta que no existe es un error de tipos. Devuelve `"page"` cuando la ruta confirmada es la de `to`, `"true"` con `prefix: true` cuando está por debajo de ella por segmentos completos, y `false` en otro caso; `"/"` sólo coincide exacta. Ignora la query string y el fragmento y compara las rutas codificadas. El resultado sirve tal cual para `bind:aria-current`, porque `bind:` elimina el atributo cuando el valor es `false`, y como condición, porque `"page"` y `"true"` son verdaderos. Lee `path`, así que la plantilla, un `computed` o un `effect` que lo usan se actualizan al navegar; en SSR y al hidratar devuelve lo mismo, sin desajustes.

Un layout con barra lateral marca así la sección activa, igual en el HTML del servidor y después de cada navegación:

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
const route = useRoute();
const links = [
  { to: "/", label: "Inicio" },
  { to: "/users", label: "Usuarios" },
  { to: "/settings", label: "Ajustes" },
] as const;
const inSettings = computed(() => route.isActive("/settings", { prefix: true }) !== false);
</script>

<template>
  <aside>
    <nav>
      <a each:of="links" each:as="link" each:key="link.to" bind:href="href(link.to)" bind:aria-current="route.isActive(link.to, { prefix: true })">{link.label}</a>
    </nav>
    <p if:when="inSettings.value">Los cambios se guardan al salir.</p>
  </aside>
  <main><MeekoOutlet /></main>
</template>
```

Los componentes recibidos como props mantienen la dirección del contrato: un componente que exige `label` no satisface un outlet que puede renderizarlo sin `label`. `meeko check` diagnostica la expresión que pasa el componente. Al guardar un módulo TypeScript importado por un `.meeko` abierto, la extensión de VS Code vuelve a comprobar sus diagnósticos y tokens semánticos.

### Head del documento: `document`, `useHead` y `useSeoMeta`

Desde `1.2`, Meeko gestiona el `<head>` de cada documento y los atributos de `<html>` y `<body>` a partir de tres fuentes, que se combinan con una sola regla de prioridad:

- **`document` en `meeko.config.ts`.** El documento común de la aplicación: `lang` y un `head` con etiquetas y atributos. Se renderiza en todos los documentos HTML: SSR, `"stream"`, `"prerender"`, la página `404` de `app/error.meeko`, el documento de error de una ruta que falla y el shell de una ruta `"client"`. Se fija en el build (y también llega al bundle del navegador, porque termina en el HTML), así que debe ser serializable: `titleTemplate` sólo puede ser una cadena (su tipo, `DocumentHead`, no admite una función, así que el editor y `meeko check` la marcan como error de tipos en `meeko.config.ts`) y `meeko build` rechaza una función. Su `title` es el título del sitio: lo muestran, tal cual y sin plantilla, las páginas sin título propio (véase **Título** más abajo). Los módulos de Meeko añaden su head antes del de la aplicación, que gana.
- **`useHead(input)`.** En páginas, layouts, `app/app.meeko`, `app/error.meeko`, componentes y composables, en el nivel superior del script o en un composable que éste llama. También en el código de nivel superior de `<script server>`, como alternativa a `export const head` (véase más abajo). `input` puede ser un objeto, un getter o una señal; con un getter o una señal, el navegador actualiza el documento cuando cambian los valores que lee.
- **`useSeoMeta(input)`.** Atajo tipado sobre `useHead`: `description`, `robots`, `themeColor`, `colorScheme`, `author`, `keywords`, `applicationName`, `referrer` y los campos `twitter*` producen `<meta name>`; los `og*` (`ogTitle`, `ogDescription`, `ogImage`, `ogImageAlt`, `ogImageWidth`, `ogImageHeight`, `ogUrl`, `ogType`, `ogSiteName`, `ogLocale`) producen `<meta property>`; `title` es el título y `canonical`, `<link rel="canonical">`. Un campo `undefined` o `null` no produce nada.

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  document: {
    lang: "es",
    head: {
      // «Zapatillas · Mi tienda» en una página titulada; «Mi tienda» en una sin título.
      title: "Mi tienda",
      titleTemplate: "%s · Mi tienda",
      link: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
      // Se ejecuta mientras el navegador lee <head>, antes de pintar; la hidratación no lo repite.
      // (Para un tema claro/oscuro, use theme: Meeko trae el script, la cookie y useTheme().)
      script: [{ children: 'document.documentElement.dataset.theme = localStorage.getItem("theme") ?? "light"' }],
    },
  },
});
```

```html
<!-- app/pages/products/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
export const product = await findProduct(params.id);
</script>

<script lang="ts">
const quantity = signal(1);
useSeoMeta({
  title: product.name,
  description: product.summary,
  ogImage: product.image,
  twitterCard: "summary_large_image",
  canonical: `https://tienda.example/products/${product.id}`,
});
useHead(() => ({ title: `${product.name} (${quantity.value})` }));
</script>
```

`HeadInput` admite `title`, `titleTemplate` (`"%s · Sitio"` o `(title) => string`; en `document.head`, `meeko.addHead` y el `head` de la ruta, sólo la cadena), `meta`, `link`, `script` (externo con `src` o en línea con `children`; `async`, `defer`, `module` y `type`), `style` (con `children` y `media`), `htmlAttrs` y `bodyAttrs` (`lang`, `dir`, `class`, `data-*`; un valor `undefined` no aporta nada y los atributos `on*` se rechazan).

**Prioridad.** De menor a mayor: `document` de la configuración, `app/app.meeko`, cada layout (el más interno gana), la página con sus componentes y, por último, el `head` de la ruta (`export const head`, `route.head` o `useHead` en `<script server>`). Dentro de un mismo nivel gana la llamada posterior, de modo que un componente de la página que se monta después (por ejemplo, tras un `if:`) sustituye a lo que fijó la página. Los atributos de `<html>` y `<body>` se combinan por nombre con la misma prioridad.

**Título.** `titleTemplate` es el de la entrada de más prioridad que lo declara, y se aplica al título de más prioridad de `app/app.meeko`, los layouts, la página y el `head` de la ruta, también al de las páginas de error (`"Error"`). El `title` de `document.head` (o el que añade un módulo con `meeko.addHead`) es distinto: es el título del sitio y nunca pasa por la plantilla. Una página sin título propio muestra ese título tal cual, y lo mismo una cuyo título ganador es una cadena vacía, en lugar de una plantilla alrededor de nada. Sin título del sitio, una página sin título no tiene `<title>` gestionado (queda el del host, si lo hay) y un título vacío se escribe vacío. La regla es la misma en el SSR, al hidratar y al navegar en el cliente. Con la configuración del ejemplo:

| Título de la página | `<title>` |
| --- | --- |
| `"Zapatillas"` | `Zapatillas · Mi tienda` |
| ninguno | `Mi tienda` |
| `""` | `Mi tienda` |

**Deduplicación.** Cada etiqueta tiene una clave: `key` si la declara o, si no, su clave natural. En `meta`, `name` (sin distinguir mayúsculas), `property` o `httpEquiv`, junto con su `media` si lo tiene (dos `theme-color` para claro y oscuro conviven); en `link`, `rel` y `href`, salvo `rel: "canonical"` y `rel: "icon"`, que son únicos aunque cambie `href`; en `script`, `src` o el código; en `style`, el CSS. Con la misma clave sólo queda la etiqueta de más prioridad, en el lugar donde apareció la primera. Así, un `icon` de `document` sustituye al `<link rel="icon" href="data:,">` que Meeko escribe por defecto, y un `meta name="viewport"` sustituye al viewport por defecto.

**SSR y CSP.** El servidor escribe `<html lang="…">` y los atributos como atributos reales, escapados. Dentro de `<head>`, tras la meta CSRF y los estilos de los componentes, el título y las etiquetas gestionadas van entre los comentarios `<!--meeko:head-->` y `<!--/meeko:head-->`, antes del HTML de confianza del host (`DocumentOptions.head`, que conserva su propio `<title>` como título por defecto). Los valores de los atributos se escapan; el contenido de `script` y `style` en línea no se escapa, pero no puede cerrar su etiqueta: `</` se escribe `<\/` (y `<!--`, `<\!--` en un script), y en los scripts JSON (`application/ld+json`, `application/json`, `importmap`, `speculationrules`) cada `<` se escribe `<`. El nonce CSP de la petición (`DocumentOptions.nonce`) se añade a los `<script>` y `<style>` gestionados. Una página prerenderizada conserva el head y recibe la meta CSRF justo después de `<meta charset>` y de las etiquetas por defecto que la aplicación no sustituyó.

**Navegador.** Al hidratar, Meeko adopta las etiquetas del SSR sin duplicarlas ni volver a ejecutar los scripts. Cuando cambia un getter o una señal de `useHead`, actualiza el título, los atributos y las etiquetas. Al navegar, las entradas de los componentes que se desmontan desaparecen y vuelve lo que habían sustituido (por ejemplo, el `canonical` del layout o la `description` de `app/app.meeko`); al volver atrás, la página restaura las suyas. Las etiquetas nuevas se insertan antes de `<!--/meeko:head-->` con el nonce CSP del documento; un script que cambia es un elemento nuevo, que el navegador ejecuta. El `head` de la ruta viaja en el payload de navegación, igual que `title` y `description` en `1.1`. Fuera de una aplicación de Meeko (por ejemplo, en una prueba unitaria con `renderToString`), `useHead` no hace nada. Un host propio que pasa `DocumentOptions.config` a `createFrameworkHandler` debe pasar el mismo valor a `mountClientApp({ document })`; la entrada que genera Meeko ya lo hace.

**`<script server>`.** `useHead` y `useSeoMeta` en el código de nivel superior hacen que el bloque tenga código de nivel superior, como `usePage`. Sus entradas forman el `head` de la ruta junto con `export const head` (o `route.head`), que gana sobre ellas. Como viajan en el payload, su `titleTemplate` debe ser una cadena.

#### Canónica y Open Graph por página

Desde `1.3`, `document.seo` añade a cada documento las etiquetas que dependen de la página y que, sin él, cada página tendría que repetir con `useSeoMeta`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  document: { seo: true, head: { titleTemplate: "%s · Mi sitio" } },
});
```

| Opción | Etiqueta | Valor |
| --- | --- | --- |
| `canonical` | `<link rel="canonical">` | El origen y la ruta de la página, sin la query string: `https://example.com/docs/api`. |
| `ogUrl` | `<meta property="og:url">` | La misma URL. |
| `ogTitle` | `<meta property="og:title">` | El título final, con `titleTemplate` aplicado. |
| `ogDescription` | `<meta property="og:description">` | La `description` de la página (la del `head` de la ruta, `useSeoMeta` o `document.head`). |

`seo: true` las activa todas; un objeto desactiva las que valen `false` (`seo: { ogDescription: false }`). El origen es `site` o, sin él, `MEEKO_PUBLIC_ORIGIN` del entorno del build; con `canonical` u `ogUrl` activos y sin ninguno de los dos, `meeko build` falla con un mensaje que lo pide. Se fija en el build (`seo.origin` del manifiesto), así que una página renderizada con SSR usa el mismo origen que una prerenderizada. En `meeko dev` sin origen esas dos etiquetas no se escriben.

Son las etiquetas de menor prioridad: una página o un layout que declara la misma etiqueta (con `useSeoMeta`, `useHead` o el `head` de la ruta, con cualquier `key`) la sustituye, igual que a las de `document.head`. Las páginas de error (`app/error.meeko`, `+error.meeko` y el `404.html` del adaptador `static`) no reciben `canonical` ni `og:url`, porque se sirven en cualquier URL. Al navegar en el cliente, las etiquetas siguen a la página confirmada. Un host propio que pasa `DocumentOptions.config` con `seo` debe incluir `seo.origin`.

### Tema claro/oscuro sin parpadeo

Desde `1.4`, Meeko trae el tema claro/oscuro (y temas propios): la elección se guarda en una cookie, el servidor escribe el tema en `<html>` desde el primer byte y los componentes pintan en el HTML del servidor los iconos correctos, sin esperar a JavaScript. Cuando el servidor no puede saberlo (una página prerenderizada, el adaptador `static` o el modo `"system"` sin client hint), un script mínimo y bloqueante de `<head>` lo aplica antes del primer pintado.

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  theme: true, // light y dark, "system" por defecto, data-theme y la cookie meeko-theme
});
```

```css
/* app/styles/main.css: los colores de cada tema, con color-scheme también sin JavaScript. */
:root { color-scheme: light; --bg: #fff; --ink: #111; }
:root[data-theme="dark"] { color-scheme: dark; --bg: #111; --ink: #eee; }
/* Sin atributo (modo "system" que el servidor no pudo resolver y sin JavaScript), manda el sistema. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { color-scheme: dark; --bg: #111; --ink: #eee; }
}
```

Sin `theme`, nada cambia: no hay script ni estilo en `<head>`, ni cookie, ni cabeceras, ni `POST /_meeko/theme`. `theme` acepta `true` o un objeto:

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `themes` | `["light", "dark"]` | Los temas. Cada nombre usa letras, dígitos, `-` o `_` y no puede ser `"system"`. |
| `default` | `"system"` | La elección de quien no eligió: `"system"` o un tema (el primero si `system: false`). |
| `system` | `true` | El modo `"system"`, que sigue a `prefers-color-scheme`. `true` usa `light` y `dark`; `{ light: "day", dark: "night" }` elige otros temas; `false` lo desactiva. |
| `darkThemes` | el oscuro de `system` (o `dark`) | Los temas que reciben `color-scheme: dark`. |
| `attribute` | `"data-theme"` | Dónde va el tema en `<html>`: un atributo `data-*` o `"class"` (añade el nombre del tema a las clases y quita el de otro tema). |
| `colorScheme` | `true` | Aplica `color-scheme` a `<html>` por CSSOM (`style.colorScheme`). |
| `cookie` | `"meeko-theme"` | La cookie de la elección. |
| `storageKey` | el valor de `cookie` | La clave de `localStorage`, que avisa a las otras pestañas: por defecto, el nombre de la cookie (`"meeko-theme"` si no cambia `cookie`); `false` usa sólo la cookie. |
| `clientHints` | `true` | Pide y lee `Sec-CH-Prefers-Color-Scheme` para resolver `"system"` en el servidor. |

Las cookies son por host, no por puerto: en desarrollo, todas las aplicaciones Meeko de `localhost` (o `127.0.0.1`), en cualquier puerto, comparten la cookie `meeko-theme`, así que elegir tema en una lo cambia en las demás al recargar (`localStorage` sí es por puerto). Para separarlas, dé a cada aplicación su propio nombre con `cookie`, por ejemplo `theme: { cookie: "mi-app-theme" }`.

#### `useTheme()`

`useTheme()` se autoimporta en los `.meeko` (un export propio con ese nombre tiene prioridad) y se llama mientras se ejecuta el script de un componente. Devuelve:

- `theme`: la elección, `"system"` incluido. Es una señal editable: asignarla equivale a `set`, y sirve para `model="theme"`.
- `resolved`: el tema efectivo, de sólo lectura; en `"system"`, el de `prefers-color-scheme`.
- `themes`: la lista de temas, sin `"system"`.
- `set(theme)`: cambia la elección. Actualiza el atributo (o la clase) de `<html>`, `color-scheme`, la cookie y `localStorage`. Un nombre que no es un tema ni `"system"` lanza `TypeError`.

En `"system"`, `resolved` sigue a los cambios de `prefers-color-scheme` mientras la página está abierta, y un cambio en otra pestaña llega por el evento `storage` de `localStorage`. La navegación en el cliente conserva el tema, porque no recarga `<html>`. En el servidor, `theme` y `resolved` son los de la petición y no se pueden cambiar (`set` lanza un error). Sin `theme` en la configuración, `useTheme()` lanza un error que lo pide.

`meeko check` tipa los temas con la configuración: con `themes: ["light", "dark", "sepia"]`, `resolved` es `"light" | "dark" | "sepia"` y `set("purple")` es un error de tipos. Las declaraciones se generan en `.meeko/types/routes.d.ts` (`GeneratedTheme`); sin ellas, los temas son `string`. El editor no las necesita: declara `GeneratedTheme` a partir de `theme` leído sin ejecutar `meeko.config.ts`, también antes del primer `meeko check`, cuando su valor es un literal (`true` o un objeto con valores literales).

#### Iconos que no saltan

La forma más corta es [`<MeekoThemeToggle>`](#meekothemetoggle), que ya hace lo que sigue. A mano hay dos formas de pintar los iconos, y las dos salen bien en el HTML del servidor cuando éste conoce el tema (la cookie, o el client hint en `"system"`):

- **Desde el CSS (recomendada).** El componente pinta los dos iconos y el CSS muestra uno según el atributo de `<html>`. Nunca salta, ni siquiera cuando el servidor no conoce el tema (una página prerenderizada, el adaptador `static` o `"system"` sin client hint), porque el script de `<head>` pone el atributo antes de pintar y el CSS lo lee desde el primer frame.
- **Desde `resolved`.** `{resolved.value === "dark" ? "luna" : "sol"}` o un `if:` sobre `resolved`. Sale bien siempre que el servidor conoce el tema; cuando no lo conoce, el HTML del servidor y la hidratación pintan el tema claro de `system` y el icono cambia al terminar la hidratación.

```html
<!-- app/components/ThemeToggle.meeko -->
<script lang="ts">
const { resolved, set } = useTheme();
const toggle = (): void => set(resolved.value === "dark" ? "light" : "dark");
</script>

<template>
  <button type="button" class="theme-toggle" aria-label="Tema oscuro" bind:aria-pressed="String(resolved.value === 'dark')" on:click="toggle">
    <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" /></svg>
    <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
  </button>
</template>

<style>
.theme-toggle .moon { display: none; }
:root[data-theme="dark"] .theme-toggle .sun { display: none; }
:root[data-theme="dark"] .theme-toggle .moon { display: inline; }
</style>
```

`aria-pressed` depende de `resolved`, así que en el caso desconocido cambia al hidratar; no se ve, y un lector de pantalla lo anuncia ya con la página interactiva. Un selector de tres opciones (sistema, claro, oscuro) usa `theme` con `model`:

```html
<script lang="ts">
const { theme } = useTheme();
</script>
<template>
  <select aria-label="Tema" model="theme">
    <option value="system">Sistema</option>
    <option value="light">Claro</option>
    <option value="dark">Oscuro</option>
  </select>
</template>
```

<a id="data-theme-choice"></a>**`data-theme-choice`.** Desde `1.4`, `<html>` lleva además la elección, `"system"` incluido: `data-theme-choice="system"` mientras `data-theme` dice el tema efectivo (`dark`). La escribe siempre el script de `<head>`, antes del primer pintado, y el servidor cuando la conoce por la cookie; el runtime la actualiza con cada cambio. Sirve para el CSS propio, use o no `<MeekoThemeToggle>`: un icono de «sistema» que no salta, o el radio marcado de un selector.

```css
.theme-toggle .icon { display: none; }
:root[data-theme-choice="light"] .theme-toggle .sun,
:root[data-theme-choice="dark"] .theme-toggle .moon,
:root[data-theme-choice="system"] .theme-toggle .monitor { display: inline; }
```

Sin cookie, el HTML del servidor no la lleva (no sabe si `localStorage` guarda otra elección, y una página prerenderizada es la misma para todos); el script la escribe antes de pintar. Sin JavaScript, un selector `:root:not([data-theme-choice])` corresponde a `default`.

#### `<MeekoThemeToggle>`

Desde `1.4`, con `theme` en `meeko.config.ts`, Meeko trae su propio selector de tema: una etiqueta integrada, como `<MeekoLink>`, sin import.

```html
<MeekoThemeToggle>
  <snippet name="light"><IconSun /></snippet>
  <snippet name="dark"><IconMoon /></snippet>
  <snippet name="system"><IconMonitor /></snippet>
</MeekoThemeToggle>
<MeekoThemeToggle mode="select" />
<MeekoThemeToggle bind:themes="['light', 'dark']" bind:labels="{ light: 'Claro', dark: 'Oscuro', system: 'Sistema' }" class="toggle" />
```

| Prop | Por defecto | Qué hace |
| --- | --- | --- |
| `mode` | `"cycle"` | `"cycle"`: un botón que pasa a la elección siguiente de la lista. `"select"`: un grupo de radios. |
| `themes` | los temas y `"system"` | Las elecciones y su orden (`bind:themes="['light', 'dark']"`). |
| `labels` | «Claro», «Oscuro», «Sistema» | El nombre de cada elección; un tema propio, sin etiqueta, se llama como el tema. |
| `messages` | en español | Los textos accesibles: `cycle(current, next)` (el `aria-label` del botón), `unknown` («Cambiar tema») y `group` («Tema»), para traducirlos. Tipo `ThemeToggleMessages`. |
| `class`, `id` | — | Del `<form>` raíz. Otros atributos no pasan: envuelva la etiqueta si los necesita. |

Cada snippet (`light`, `dark`, `system` o el nombre de un tema propio) es el icono de esa elección; sin snippet se pinta su etiqueta. `meeko check` y el editor tipan los snippets, `themes` y `labels` con los temas de `meeko.config.ts` (`system` sólo si está activo) y `mode` como `"cycle" | "select"`; el editor completa la etiqueta, sus props y sus snippets, y su hover muestra la ficha de la etiqueta. El tipo de sus props es `MeekoThemeToggleProps`, autoimportado como `MeekoLinkProps`. No tiene estilos visuales propios: el botón y los radios son elementos nativos que estiliza la aplicación (`.toggle button`, `[role="radio"][aria-checked="true"]`, `[data-meeko-theme-option="dark"]`). Para marcar el radio elegido también antes de hidratar, cuando la elección no se conoce y no hay `aria-checked`, use `data-theme-choice`, como los iconos: `[data-theme-choice="dark"] [data-meeko-theme-option="dark"]`.

**Iconos que nunca saltan.** El componente pinta todos los iconos, cada uno en `<span data-meeko-theme-icon="light|dark|system|…">`, y no elige ninguno: con `theme` activo, Meeko añade a `<head>` una regla CSS mínima, sólo `display: none`, que oculta todos salvo el de `data-theme-choice`. Como el script de `<head>` escribe ese atributo antes del primer pintado, el icono sale bien desde el primer frame en todos los casos (con cookie, en `"system"` sin cookie ni client hint, en una página prerenderizada o en `static`), sin JavaScript en el componente, y hidratar no cambia ningún nodo del componente. Una lista sin `system` (`bind:themes="['light', 'dark']"`) muestra en modo sistema el icono del tema efectivo, según `prefers-color-scheme`, como el script. En `mode="select"` cada radio lleva su icono y todos se ven.

**Accesibilidad.** En `mode="cycle"` es un `<button>` cuyo `aria-label` dice la elección y la siguiente, «Tema: oscuro. Cambiar a sistema», y se actualiza con cada cambio. Cuando el HTML se genera sin conocer la elección (sin la cookie, una página prerenderizada), el `aria-label` es neutro, «Cambiar tema», hasta que termina la hidratación: así no anuncia algo falso ni provoca un desajuste de hidratación, porque la hidratación pinta lo mismo que el servidor. En `mode="select"` es un `role="radiogroup"` con un `aria-label` («Tema») y un botón `role="radio"` por elección con `aria-checked` y el nombre de la elección. Cuando el HTML no conoce la elección, ningún radio lleva `aria-checked`, ni `"true"` ni `"false"`: un grupo con todos en `"false"` diría que no hay ninguno marcado, y marcar el de `default` diría algo falso a quien eligió otro tema, porque la página prerenderizada es la misma para todos. Al terminar la hidratación cada radio recibe su `aria-checked` una sola vez, y el estado visual lo da antes el CSS con `data-theme-choice`; con JavaScript, las flechas, `Inicio` y `Fin` mueven el foco y la elección, con un `tabindex` itinerante, como un grupo de radios nativo. Sin JavaScript cada radio es un botón que se alcanza con el tabulador.

**Sin JavaScript (mejora progresiva).** El componente es un `<form method="post" action="/_meeko/theme">`: el botón de `"cycle"` envía la elección siguiente y cada radio, la suya, junto con la URL de la página (`return`). Con JavaScript, el envío se intercepta y el cambio es inmediato, con `useTheme().set()`, sin navegar. Sin él, el servidor atiende el formulario:

- `POST /_meeko/theme` existe sólo con `theme` activo (en los demás métodos responde `405`).
- Acepta sólo `application/x-www-form-urlencoded` de hasta 2 KB; `theme` debe ser un tema de `themes` o `"system"` (con el modo sistema activo); si no, `400 INVALID_THEME`, sin escribir nada.
- Escribe la cookie como el runtime del navegador (`Path=/`, un año, `SameSite=Lax`, `Secure` en HTTPS) y responde `303` a `return`, que debe ser una ruta de este origen (`/docs?tab=a`). Una URL absoluta, `//otro.sitio`, una barra invertida o caracteres de control vuelven a `/`: nunca hay una redirección abierta. El siguiente documento SSR ya trae el tema nuevo.
- **CSRF.** No usa la sesión ni el token CSRF (`x-meeko-csrf`, que sólo existe con JavaScript): sólo cambia la cookie del tema. Como `origin: "required"` de una ruta de API, exige un `Origin` igual al de la petición, que tras `createServerApp` es el `publicOrigin` configurado; un `Origin` ausente, `null` o de otro sitio responde `403 INVALID_ORIGIN` antes de leer el cuerpo. Los navegadores envían `Origin` en todo `POST`; una página con `Referrer-Policy: no-referrer` lo envía como `null`, así que ahí el formulario sin JavaScript no funciona (con JavaScript sí). Detrás de un proxy, configure el origen público, como para las mutaciones con sesión.
- **Prerender con Node.** El endpoint existe también en el servidor de una aplicación cuyas páginas son prerenderizadas, y escribe la cookie; pero el HTML prerenderizado es el mismo para todos y, sin JavaScript, no aplica la cookie (lo hace el script de `<head>`), así que la página sigue mostrando el tema por defecto. Sin JavaScript, el cambio sólo se ve en las páginas SSR.
- **Adaptador `static`.** No hay servidor: el formulario se renderiza igual (el HTML es el que generó el prerender, común a todos los adaptadores) y con JavaScript funciona, pero sin él el `POST` llega al hosting, que lo rechaza. Es una limitación documentada; en un sitio estático, el selector necesita JavaScript.

Usar `<MeekoThemeToggle>` sin `theme` es el error `MEEK111`. `meeko dev` y `meeko build` lo saben por la configuración, que ejecutan; `meeko check` y el editor leen `theme` de `meeko.config.*` sin ejecutarlo. Cuando así no se sabe (`theme: variable`, una configuración que no es un literal, o una carpeta sin `meeko.config.*`, como un layer con su propio `package.json`), no avisan, y el componente da el mismo error al renderizarse. Un componente del proyecto llamado `MeekoThemeToggle` tiene prioridad sobre la etiqueta de Meeko, con el aviso `MEEK106`, como con `MeekoLink`.

#### Cómo se evita el parpadeo en cada caso

| Caso | Quién pone el tema en `<html>` | `useTheme()` en el HTML del servidor |
| --- | --- | --- |
| SSR con la cookie (`light`, `dark`, un tema propio) | El servidor, desde el primer byte. | El tema de la cookie. Hidratar no cambia nada. |
| SSR en `"system"` con `Sec-CH-Prefers-Color-Scheme` | El servidor, con el client hint. | El tema del sistema. Hidratar no cambia nada. |
| SSR en `"system"` sin el client hint (Firefox, Safari) | El script de `<head>`, antes del primer pintado; el HTML no lleva atributo, así que el CSS de `prefers-color-scheme` también acierta sin JavaScript. | `resolved` vale el tema claro de `system`; cambia al hidratar si el sistema es oscuro. |
| Página prerenderizada o adaptador `static` | El script de `<head>`, con la cookie o `localStorage`. | El valor por defecto del build; cambia al hidratar si el usuario eligió otro. |

El script lee la cookie, después `localStorage` (así una elección guardada sólo allí, como la de un sitio que antes usaba `localStorage`, sigue valiendo y vuelve a la cookie) y por último `default`; en `"system"` consulta `prefers-color-scheme`. Escribe el tema y [`data-theme-choice`](#data-theme-choice). Una cookie que escribió el servidor (el formulario de `<MeekoThemeToggle>` sin JavaScript) pasa a `localStorage` y a las otras pestañas en la siguiente carga con JavaScript. Se ejecuta siempre y es idempotente: donde el servidor ya escribió el tema, escribe el mismo. Va entre las etiquetas gestionadas de `<head>`, justo después de las `meta` (así también le aplica una CSP en `<meta http-equiv>`) y antes de todas las hojas de estilo enlazadas, las de `document.head` y `useHead` y las del build, así que no espera a ninguna.

**Client Hints.** Una respuesta SSR lleva `Accept-CH: Sec-CH-Prefers-Color-Scheme` y, cuando la elección es `"system"`, `Critical-CH: Sec-CH-Prefers-Color-Scheme`. Chromium recuerda `Accept-CH` para el origen y, la primera vez, ante `Critical-CH`, repite la petición con el hint antes de mostrar nada: una sola vez por origen, con un viaje de ida y vuelta más en esa primera visita. Firefox y Safari no envían el hint y usan el script. Con `clientHints: false`, Meeko no pide ni lee el hint.

**Hidratación.** El navegador hidrata con los valores que renderizó el servidor (viajan en el estado de la página, `sharedState["meeko:theme"]`) y recibe los suyos al terminar la hidratación, antes de `onMounted`, como `useStorage`. Por eso nunca hay un desajuste de hidratación, y sólo cambia lo que dependía de un tema que el servidor no conocía.

**Seguridad.** El servidor sólo acepta en la cookie un tema de `themes` (o `"system"`); cualquier otro valor se ignora y nunca se escribe en el HTML. El navegador escribe la cookie con `Path=/`, `SameSite=Lax`, un año de duración y `Secure` en HTTPS; no es `HttpOnly`, porque la escribe el cliente, y no contiene nada privado.

#### CSP

- **SSR.** El script y el `<style>` de los iconos de `<MeekoThemeToggle>` llevan el nonce de `DocumentOptions.nonce` o, desde `1.7`, el que genera Meeko con `server.contentSecurityPolicy`, como cualquier script o estilo de `useHead`. Una página con [`cache`](#caché-de-páginas-ssr) no lleva nonce: sus hashes entran en la CSP de esa respuesta ([CSP y cabeceras en los adaptadores con servidor](#csp-y-cabeceras-en-los-adaptadores-con-servidor)).
- **Prerender y `static`.** El script y el estilo están en el HTML de cada página, así que sus hashes entran en `scriptHashes` y `styleHashes` del índice de prerender y en la CSP que escribe el adaptador `static` ([CSP con hashes](#csp-con-hashes)). Sus textos sólo dependen de `theme`: son los mismos en todas las páginas y cambian de hash sólo si cambia la configuración.
- **Por qué un `<style>` con hash.** La regla de los iconos tiene que estar antes del primer pintado y funcionar sin JavaScript (el formulario de `<MeekoThemeToggle>`), así que no puede aplicarla el script por CSSOM. Un `<style>` en línea con nonce (SSR) o con hash (prerender y `static`) lo permite una CSP sin `'unsafe-inline'`, sin un archivo más que pedir. El hash sólo se añade a una directiva sin `'unsafe-inline'`: con un hash, el navegador ignoraría `'unsafe-inline'` y bloquearía los atributos `style="…"` que la política permitía.
- **`color-scheme`.** No es un atributo `style` del HTML, que una CSP sin `'unsafe-inline'` en `style-src` bloquearía: el script y el runtime lo aplican por CSSOM (`style.colorScheme`), que la CSP permite. Para que la página tenga el esquema correcto también sin JavaScript, declárelo en su CSS por tema, como en el ejemplo de arriba.

#### Caché

Un documento SSR depende de la cookie y del client hint, así que lleva `Vary: Cookie, Sec-CH-Prefers-Color-Scheme` (sin `clientHints`, `Vary: Cookie`). Las respuestas SSR son `cache-control: no-store` salvo las de una página con [`cache`](#caché-de-páginas-ssr), cuyo `ETag` ya incluye el tema; si un proxy o una CDN cachea sus páginas, debe incluir la cookie del tema en la clave o no cachearlas, o servirá a un usuario el tema de otro. Muchas CDN no varían por `Cookie` y no cachean una respuesta con `Vary: Cookie`. Las páginas prerenderizadas y el adaptador `static` no varían por el tema: el mismo archivo sirve a todos y el script aplica el tema de cada visitante, así que se cachean igual que antes. Una página prerenderizada servida por `meeko start` sí varía por la sesión, como sin tema: sin sesión responde con `Vary: cookie` y `cache-control: public, max-age=0, must-revalidate`, y con sesión, `private, no-store`, porque inserta la meta CSRF de la sesión (véase [Reglas comunes](#reglas-comunes)).

Un host propio que pasa `DocumentOptions.config` a `createFrameworkHandler` pone el tema en `config.theme` (lo mismo que `mountClientApp({ document })`); el build lo copia allí desde `theme` de `meeko.config.ts`, donde `document.theme` no se admite.

## Autoimports y TypeScript

**Imports sin extensión.** Desde `1.2`, Meeko comprueba los tipos con `"module": "ESNext"` y `"moduleResolution": "Bundler"`, como Vite y Nuxt: un import relativo no necesita extensión (`import { format } from "../utils/format"`), porque Vite resuelve y empaqueta todo el código en `meeko dev` y en `meeko build`, y Node nunca ejecuta un `.ts` directamente. Los imports con `.js` siguen funcionando. `meeko init-framework` genera el `tsconfig.json` con esos valores; un proyecto anterior puede cambiar sus dos líneas `"module": "NodeNext"` y `"moduleResolution": "NodeNext"` para que el editor también acepte los imports sin extensión en sus `.ts`.

Meeko analiza exports AST de `app/{components,composables,utils,stores,types}` (`app/types` desde `1.2`), `shared/{types,schemas,utils,constants,enums}` y `server/utils`. Los tipos que sólo usa la aplicación van en `app/types`; los que comparten la aplicación y el servidor, en `shared/types`. Un `type` o una `interface` autoimportados llegan con `import type`. Los símbolos de `app/` están disponibles en cliente y SSR, pero no desde `shared/`; los sufijos `.client.ts` y `.server.ts` restringen un módulo a su entorno. `imports.serverDirs` añade directorios privados exclusivos del servidor y, desde `1.3`, `imports.appDirs` e `imports.sharedDirs` añaden carpetas de `app/` y de `shared/` (véase [Carpetas de autoimports](#carpetas-de-autoimports)). Los símbolos del framework `api`, `rpc`, `socket`, `useSocket`, `useApi`, `useRpcQuery`, `useRpcMutation`, `useState`, `href` y `useRoute`, desde `1.2` `useForm`, `useStorage`, `useApiMutation`, `useHead`, `useSeoMeta`, `definePage`, `defineRouteMiddleware` y `definePlugin`, desde `1.4` `useTheme` (`definePage` sólo tiene efecto en `<script server>` y en los sidecars: en el `<script>` de un componente da el aviso `MEEK109`), y en el código de servidor (`server/` y `<script server>`) `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime` y `ApiError` (y, desde `1.6`, `defineServerRouteMiddleware`, que también se autoimporta en los `*.server.ts`; desde `1.7`, `defer`, también en los sidecars `*.route.ts` y dentro de las opciones de ruta), y de la raíz `signal`, `computed`, `effect`, `batch`, `untrack` (desde `1.2`), `onCleanup`, `onMounted`, `provide`, `inject`, `createContext` y `provideErrorHandler`, también figuran en el registro, con `useNavigation` y `createRoot` desde `1.7`; un export propio llamado `useRoute`, `useForm`, `useStorage`, `useApiMutation`, `useHead`, `useSeoMeta`, `useTheme` o, desde `1.6`, `defineServerRouteMiddleware` y, desde `1.7`, `useNavigation`, `createRoot` o `defer` tiene prioridad sobre el del framework. `redirect` y `notFound` no se autoimportan fuera de `<script server>`, tampoco en `app/middleware/*.server.ts`: sus tipos serían globales en todo el proyecto `server`, incluidas las API, donde fallarían en ejecución con `MEEK073`. Los imports explícitos prevalecen. Una colisión produce error; nunca se elige por orden de archivos. Un `enum` o una clase autoimportados sirven también como tipo, con sus miembros (`Scope.App`); si un archivo sólo los usa como tipo, Meeko inserta `import type`. Los schemas de `shared/schemas` pueden llegar por autoimport a los contratos de API, RPC y Socket. `meeko check` comprueba los `.ts` que importa un `.meeko` con los autoimports de su ámbito y con las rutas generadas, igual que los proyectos `tsconfig.*`.

<a id="carpetas-de-autoimports"></a>**Carpetas de autoimports.** Cada carpeta se lee de forma recursiva, en el proyecto y en cada layer; sólo sus `.ts` aportan exports (sin `*.test.ts`, `*.spec.ts` ni `*.d.ts`), y los `.meeko` sólo son componentes en `app/components` y en las carpetas de componentes de los módulos. Un archivo sin sufijo toma el ámbito de la carpeta raíz que lo contiene; `.client.ts`, `.server.ts` y `.shared.ts` mandan sobre él:

| Carpeta | Ámbito | Disponible en |
| --- | --- | --- |
| `app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types` | `app/` | Componentes y `.ts` de `app/`, en el navegador y en SSR; también en `server/` y `<script server>`. No en `shared/` |
| `imports.appDirs` (desde `1.3`), p. ej. `"app/services"` | `app/` | Igual que las carpetas de `app/` anteriores |
| `shared/types`, `shared/schemas`, `shared/utils`, `shared/constants`, `shared/enums` | `shared/` | Todo el proyecto |
| `imports.sharedDirs` (desde `1.3`), p. ej. `"shared/validators"` | `shared/` | Todo el proyecto |
| `server/utils` e `imports.serverDirs`, p. ej. `"server/services"` | `server/` | `server/`, `<script server>` y sidecars; en un componente, `MEEK108` |

Cada opción sólo admite rutas relativas dentro de su carpeta (`appDirs` dentro de `app/`, `sharedDirs` dentro de `shared/`, `serverDirs` dentro de `server/`), con `/` o `\` y sin `.` ni `..`: otra ruta detiene `meeko dev`, `meeko build` y `meeko check` con un error de `meeko.config.ts` que nombra la entrada (`imports.appDirs[1] debe ser una ruta relativa dentro de app/: …`) y que el editor, en un workspace de confianza, marca en ella (`MEEK_CONFIG`). Una carpeta que ya es de autoimports (`"app/composables"`) o que está dentro de otra de la lista no se lee dos veces. Los exports de estas carpetas siguen las mismas reglas que los de las carpetas por defecto: `import type` para `type` e `interface`, prioridad sobre los autoimports del framework y error si dos archivos exportan el mismo nombre en un ámbito. Un `*.server.ts` de una carpeta de `appDirs` es de servidor, y un componente que lo usa da `MEEK108`.

<a id="tipos-de-cada-componente"></a>**Tipos de cada componente.** Desde `1.4`, cada componente autoimportado (los `.meeko` de `app/components` del proyecto y de sus layers, y los de las carpetas de componentes de los módulos) aporta además cuatro tipos con el nombre de su etiqueta, sin import: el nombre del componente, con la misma regla que la etiqueta y el prefijo del módulo incluido, seguido de `Props`, `Snippets`, `Models` o `Exposed`.

| Componente | Etiqueta | Tipos |
| --- | --- | --- |
| `app/components/App/Card.meeko` | `<AppCard>` | `AppCardProps`, `AppCardSnippets`, `AppCardModels`, `AppCardExposed` |
| `app/components/user-menu.meeko` | `<UserMenu>` | `UserMenuProps`, `UserMenuSnippets`, `UserMenuModels`, `UserMenuExposed` |
| `components/picker.meeko` de un módulo con `prefix: "Accent"` | `<AccentPicker>` | `AccentPickerProps`, `AccentPickerSnippets`, … |

- **Qué son.** Exactamente el `ComponentProps`, `ComponentSnippets`, `ComponentModels` y `ComponentExposed` del módulo del componente (véase [Módulo generado](api.md#módulo-generado)), con sus parámetros de tipo en un componente genérico (`DataTableProps<User>`). Un componente sin `defineSnippets`, `defineModel` o `defineExpose` da `null` en el tipo correspondiente, como su módulo: el alias no se convierte en `{}` para que el nombre con etiqueta y el genérico nunca difieran y `null` siga distinguiendo un componente que no declara el canal. Con `null`, `Omit<PlainSnippets, "x">` es `{}`, pero `PlainSnippets & { … }` es `never`: reutilice los snippets de un componente que los declara.
- **Dónde.** Con el mismo ámbito que el componente: en el `<script>` y la plantilla de los `.meeko` y en los `.ts` de `app/` (y, como los componentes, en `server/` y `<script server>`), nunca en `shared/`, donde son `TS2304` como cualquier símbolo de `app/`. Llegan como `import type` desde el `.meeko`, así que no añaden código al bundle.
- **Prioridad.** Un autoimport del proyecto con el mismo nombre gana sin aviso, como un export propio llamado `useRoute` frente al del framework: si `app/types` exporta `AppCardProps`, ése es el `AppCardProps` de todo el proyecto. Un import o una declaración del archivo prevalecen, como siempre.
- **Etiquetas propias.** Las etiquetas de Meeko aportan igual el tipo de sus props, con el mismo ámbito y la misma prioridad, desde los exports públicos de `@meekojs/meeko/framework`: `MeekoLinkProps` para `<MeekoLink>`, `MeekoOutletProps` para `<MeekoOutlet />` y `MeekoThemeToggleProps` para `<MeekoThemeToggle>` (véase [`<MeekoOutlet />` y `<MeekoLink>`](#meekooutlet--y-meekolink)). Llegan como `import type { MeekoLinkProps } from "@meekojs/meeko/framework"`. Un componente del proyecto que sustituye la etiqueta (`app/components/MeekoLink.meeko`, con el aviso `MEEK106`) aporta sus propios tipos con ese nombre, como cualquier componente: su `MeekoLinkProps` son sus props, no las de la etiqueta de Meeko.
- **Editor y `meeko check`.** Usan el mismo registro: se declaran en `.meeko/types/autoimports/client.d.ts` (y `server.d.ts`) junto al componente; el servidor de lenguaje los completa donde se escribe un tipo, y el hover y la navegación a definición llevan al componente, a la macro que declara cada tipo (`defineSnippets` para `AppCardSnippets`).

Con ellos, un componente reutiliza los snippets de otro sin import: `defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>()` (véase [Snippets con `defineSnippets`](api.md#snippets-con-definesnippets)).

Los `.ts` normales de `app/` (composables, utils, stores) se ejecutan en SSR y en el navegador, como los `.meeko` que los usan, y sus autoimports del framework (`api`, `rpc`, `socket`, `useSocket`, `useApi`…) se resuelven por entorno: el cliente de servidor en SSR y el del navegador en el navegador. Antes de `1.1` usaban siempre el del navegador, y `meeko dev` o `meeko build` fallaban con «Client-only module reached the server bundle». Un `.client.ts` sigue siendo sólo de navegador.

**Módulos `.client.ts` en `app/`.** Un `.meeko` se compila dos veces, para SSR y para el navegador, así que no puede usar un símbolo de un `.client.ts` ni importarlo de forma estática: `meeko check` y el build lo rechazan («unavailable in server scope», «Client-only module reached the server bundle»). Cárguelo con `import()` dentro de un código que sólo se ejecute en el navegador (un manejador de evento o un `effect`) y protéjalo con `import.meta.env.SSR`, que el build de servidor sustituye por `true` y con el que elimina ese import:

```ts
async function exportCsv(): Promise<void> {
  if (import.meta.env.SSR) return;
  const { downloadCsv } = await import("../utils/download.client.js");
  downloadCsv(rows.value);
}
```

Un `.client.ts` sí puede importarse normalmente desde otros `.client.ts`.

**Stores (`app/stores`).** Es una carpeta de autoimports como `app/composables`; Meeko no define una API de store. Un `signal` creado a nivel de módulo vive mientras vive el proceso, así que en el servidor lo comparten todas las peticiones y usuarios. Para estado de la aplicación use `useState(key, init)` dentro de la función del store: es por petición en SSR, se transfiere al navegador en el payload y en el navegador se comparte entre componentes:

```ts
// app/stores/cart.ts
export function useCart() {
  const items = useState("cart:items", (): string[] => []);
  const add = (id: string): void => { items.value = [...items.value, id]; };
  return { items, add };
}
```

El compilador `.meeko` y la transformación `.ts` insertan imports ESM reales. Las declaraciones por ámbito se regeneran bajo `.meeko/types/autoimports/` sólo cuando cambia el contenido, para autocompletado y navegación a definición. Los tipos genéricos reexportados conservan parámetros, restricciones y defaults; las firmas overload del mismo símbolo se registran una sola vez, mientras una colisión entre orígenes distintos sigue fallando. El servidor de lenguaje usa el mismo registro y las posiciones AST del compilador. Los proyectos app, server y shared generados por `meeko check` aplican también `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` y `verbatimModuleSyntax`. `shared/` no puede depender de símbolos app o servidor; el bundle cliente rechaza módulos `server/`, incluidos imports transitivos. Los `*.route.ts` pertenecen al ámbito servidor.

Al migrar código que no usaba esas opciones estrictas, cambie imports usados sólo como tipos a `import type`, compruebe el resultado de accesos por índice antes de usarlo y añada `| undefined` únicamente cuando la ausencia sea parte real del contrato. No silencie los diagnósticos ensanchando props o contratos públicos a `any`: Meeko usa esos tipos para generar el cliente, validar el servidor y mantener iguales CLI y editor.

## Aliases de ruta

Desde `1.5`, Meeko define cuatro aliases de ruta, sin configuración. Funcionan igual en Vite (`meeko dev` y `meeko build`, en el navegador y en SSR, con todos los adaptadores: `node`, `bun`, `deno`, `cloudflare` y `static`), en los `tsconfig` que genera Meeko (`.meeko/tsconfig.app.json`, `server` y `shared`, que usan `meeko check` y el editor) y en los módulos de [`@utilities`](#utilidades-generadas-con-typescript) y lo que importan (salvo con `meekoUtilities({ autoImports: false })`, que no lee la configuración):

| Alias | Apunta a | Dónde se puede usar |
| --- | --- | --- |
| `~/` | La raíz del proyecto | Todo el proyecto |
| `@/` | `app/` | `app/` (componentes, páginas y `.ts`, que se ejecutan en el navegador y en SSR) y el código de servidor; no en `shared/` |
| `#shared/` | `shared/` | Todo el proyecto |
| `#server/` | `server/` | Sólo el código de servidor: `server/`, los `*.server.ts`, los sidecars `*.route.ts` y `<script server>` |

`~/` es la raíz y `@/` es `app/`: al revés que en Nuxt, a propósito. `~/app/utils/price` y `@/utils/price` son el mismo módulo.

```ts
// app/pages/products/[id].route.ts
import { findProduct } from "#server/products";
import { productSchema } from "#shared/schemas/product";

export const route = definePage({ load: ({ params }) => productSchema.parse(findProduct(params.id)) });
```

```html
<!-- app/pages/products/[id].meeko -->
<script lang="ts">
import { formatPrice } from "@/utils/price";
import * as ProductCard from "@/components/catalog/ProductCard.meeko";
</script>
```

Un componente también se puede importar con un alias (`@/components/Card.meeko`); `MEEK033` sigue señalando un import de `.meeko` que no es relativo ni un alias.

Los schemas de los contratos de [API y RPC](#api-y-rpc) y de [WebSocket](#websocket) también se importan con un alias: `import { loginInput } from "#shared/schemas/auth"` en `server/api/auth/login.post.ts`, o con un alias propio que apunte a una carpeta de `shared/`. El generador de contratos resuelve el alias como `meeko check` y Vite, y los clientes generados (`api`, `rpc`, `socket`) nombran el archivo de `shared/` por su ruta, sin el alias. La regla es la misma que con una ruta relativa: el archivo debe estar en el `shared/` del proyecto, así que un alias que apunta a otra carpeta sigue dando `body debe venir de shared/`.

### Ámbitos de los aliases

Cada alias tiene el ámbito de la carpeta a la que apunta, como los [autoimports](#carpetas-de-autoimports): `#server/` sólo existe en el `tsconfig.server.json` generado, `@/` no existe en `tsconfig.shared.json` (porque `shared/` no ve `app/`) y `~/` y `#shared/` existen en los tres. Usar uno fuera de su ámbito es un error claro, antes de que TypeScript diga que el módulo no existe:

- `#server/` en un componente (su `<script>` o su plantilla), en un `.ts` de `app/` o en `shared/` da `MEEK108` en `meeko check`, en el editor y en el build del navegador, también con `import type`. Para leer un tipo del servidor use `~/server/…`, que existe en todos los ámbitos; un import de valores de `server/` con `~/` (o con una ruta relativa) sigue dando `MEEK108`, como desde `1.3`.
- `@/` en `shared/` (o en un `*.shared.ts`) da el nuevo error `MEEK118` en `meeko check`, en `meeko dev` y en el build. Mueva ese código a `shared/` o use el alias desde `app/` o el servidor.

En el grafo de SSR, `meeko dev` y `meeko build` siguen cargando un `#server/` de `app/` que sólo usa el servidor (una plantilla de correo de `app/emails/` que renderiza una ruta de API), igual que un import relativo de `server/`; `meeko check` lo marca igualmente.

En el editor, los aliases completan las carpetas y archivos tras `~/`, `@/`, `#shared/` y `#server/` (este último en `<script server>`), e «Ir a la definición» lleva al módulo. En los `.ts`, el servidor de TypeScript del editor usa los `tsconfig` generados: un `#server/` en `app/` aparece allí como un módulo que no existe, y `meeko check` le da su `MEEK108`.

### Aliases propios: `alias`

`alias` en `meeko.config.ts` añade aliases o cambia los de Meeko. Cada clave es un prefijo que termina en `/` y cada valor, una carpeta del proyecto relativa a su raíz (también la de un layer) o `false` para quitar el alias:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  alias: {
    "ui/": "app/components/ui/",
    "db/": "server/db/",
    "#server/": false,
  },
});
```

- **Ámbito.** El de la carpeta a la que apunta, con la misma regla que los aliases de Meeko: dentro de `server/`, sólo en el código de servidor (`db/` en un componente da `MEEK108`); dentro de `app/`, en `app/` y en el servidor, no en `shared/` (`MEEK118`); en cualquier otra carpeta (`shared/`, la raíz, `lib/`), en todo el proyecto.
- **Una sola carpeta.** Un alias propio apunta exactamente a su carpeta; no se busca en los layers como los de Meeko. Cambiar uno de Meeko (`"@/": "src/"`) lo convierte en un alias propio, con el ámbito de su carpeta nueva.
- **Validación.** Una clave sin `/` final, con espacios, `*` o `\`, o que empieza por `.` o `/`, y un valor que no es una ruta relativa dentro del proyecto ni `false`, detienen `meeko dev`, `meeko build` y `meeko check` con un error de `meeko.config.ts` (`alias "lib" debe ser un prefijo que termine en / …`), que el editor, en un workspace de confianza, marca en `alias` (`MEEK_CONFIG`). Una carpeta que no existe no es un error: el import falla al resolverse.
- **Dónde se aplica.** En Vite, en los `tsconfig` generados, en el editor y en `@utilities`, igual que los de Meeko. En un workspace no confiable, el editor lee `alias` sin ejecutar la configuración sólo si es un objeto literal de cadenas y `false`; si no lo es, usa los aliases por defecto.

Node carga `meeko.config.ts` directamente, sin Vite: la configuración y los módulos que importa no pueden usar los aliases.

### Aliases en los layers

Los aliases de Meeko se buscan en el proyecto y después en cada layer, en el orden de las fuentes (véase [Layers](#layers)); gana el primer archivo que existe. Así, en un archivo de `layers/base`, `@/lib/format` es `layers/base/app/lib/format.ts` mientras el proyecto no tenga `app/lib/format.ts`; si lo tiene, gana el del proyecto, como sus `app.meeko` y layout raíz sustituyen a los del layer. Para fijar el archivo del propio layer, use una ruta relativa.

No se resuelven contra el `app/` del layer que importa porque los `paths` de TypeScript valen para todo un proyecto, no para cada archivo: con esta regla, Vite, `meeko check`, el editor y `@utilities` eligen siempre el mismo archivo. Los `tsconfig` generados lo declaran con una lista de carpetas por alias (`"@/*": ["../app/*", "./types/app/*", "../layers/base/app/*", …]`, donde `./types/…` son las declaraciones de los componentes).

### Prioridad y conflictos de los aliases

- **`paths` del `tsconfig.json` del proyecto.** Un patrón propio con el prefijo de un alias de Meeko que apunta a otra carpeta (`"@/*": ["./src/*"]`) gana y desactiva ese alias de Meeko en todo el proyecto: en el editor, en `meeko check`, en los `tsconfig` generados (que desde `1.5` copian también los `paths` del proyecto), en `meeko dev` y `meeko build` y en las comprobaciones de ámbito (`MEEK108` y `MEEK118`), así que importar `@/utils` desde `shared/` ya no es un error. `meeko dev`, `meeko build` y `meeko check` lo avisan una vez por proceso. Un patrón con las mismas carpetas que el de Meeko no lo desactiva. Vite no lee esos `paths`: para que el build resuelva ese prefijo, defínalo también con `alias` (`alias: { "@/": "src/" }`, que con la misma carpeta no cuenta como redefinición) o con un `resolve.alias`.
- **`resolve.alias` de Vite.** El `resolve.alias` de un módulo de Meeko (`meeko.extendViteConfig`) o de un host de Vite propio se aplica antes que los aliases de Meeko. Si cubre todo un prefijo de Meeko (`{ find: "@", replacement: … }` o una expresión regular como `/^@\//`), desactiva también el alias de Meeko de ese prefijo y sus comprobaciones de ámbito, con el mismo aviso; uno que sólo cubre algunos especificadores (`/^@\/lib\/label$/`) gana para ellos y deja el de Meeko para los demás. El editor, que no ejecuta los módulos, no ve el `resolve.alias` de un módulo: para que coincida, desactive el alias con `alias: { "@/": false }`.
- **`imports` de `package.json`.** Los aliases de Meeko que empiezan por `#` no chocan con los [*subpath imports*](https://nodejs.org/api/packages.html#subpath-imports) de Node mientras el proyecto no los declare. Si su `package.json` tiene en `"imports"` una entrada que empieza por `#shared/` o `#server/` (o un patrón como `"#*"`), gana la suya: Meeko no define ese alias en ninguna parte (ni en Vite ni en los `tsconfig`) y avisa una vez por proceso. Para quitar el aviso, desactive el alias con `alias: { "#shared/": false }`.
- **Paquetes.** Los módulos de `node_modules` nunca reciben los aliases del proyecto: un `#…` de un paquete es suyo.

## API y RPC

Los archivos `server/api/users/index.get.ts`, `index.post.ts` y `[id].get.ts` crean `/api/users` y `/api/users/:id`. Los procedimientos bajo `server/rpc/users/get.ts` crean `/_meeko/rpc/users/get`. Los schemas públicos residen en `shared/`. Los handlers usan `defineApiRoute` y `defineRpc`, y el servidor valida entrada, salida, sesión, autorización y CSRF.

**Validador: Standard Schema, Valibot por defecto.** Meeko valida con cualquier biblioteca que implemente [Standard Schema](https://standardschema.dev), como Valibot, Zod o ArkType, en API, RPC, Socket, rutas, `useForm` y `useStorage`. Los ejemplos de esta documentación usan Valibot (`import * as v from "valibot"`, desde la versión 1), el validador recomendado: es pequeño y modular, así que el bundle del navegador sólo incluye las funciones que usan los schemas de `shared/` que comparten servidor y cliente. Elegir otra biblioteca no cambia ninguna API de Meeko; sólo la exportación OpenAPI necesita el conversor a JSON Schema de esa biblioteca (para Valibot, `@valibot/to-json-schema`).

```sh
npm install valibot
```

```ts
// shared/schemas/user.ts
import * as v from "valibot";
export const userParams = v.object({ id: v.string() });
export const userSchema = v.object({ id: v.string(), name: v.string() });
export const usersSchema = v.array(userSchema);
```

```ts
// server/api/users/index.get.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { usersSchema } from "../../../shared/schemas/user.js";

export default defineApiRoute({
  response: usersSchema,
  handler: () => [{ id: "123", name: "Ada" }],
});
```

```ts
// server/api/users/[id].get.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/user.js";

export default defineApiRoute({
  params: userParams,
  response: userSchema,
  handler: ({ params }) => ({ id: params.id, name: "Ada" }),
});
```

```ts
// server/rpc/users/get.ts
import { defineRpc } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/user.js";

export default defineRpc({
  input: userParams,
  output: userSchema,
  handler: ({ input }) => ({ id: input.id, name: "Ada" }),
});
```

```ts
// app/pages/users/index.meeko, sin imports manuales
const loadUsers = async () => {
  const users = await api.users.get();
  const user = await api.users({ id: "123" }).get();
  const result = await rpc.users.get({ id: "123" });
  return { users, user, result };
};
```

Esos símbolos también funcionan en `.ts` según el ámbito. `meeko routes .` genera `.meeko/generated/clients.client.ts` y `clients.server.ts` con descriptores públicos y tipos inferidos; no importan handlers privados. En SSR, los clientes consultan el contexto actual en cada llamada y despachan localmente por el mismo pipeline HTTP si el host suministra `createLocalServerFetch`. El starter ya lo conecta. Credenciales, sesión, servicios, estado y `requestId` quedan ligados a la petición original. Fuera de un contexto SSR, una llamada al cliente servidor falla con un error claro. En navegador se usa `fetch` same-origin y se lee el token CSRF de la meta `meeko-csrf-token`, que se actualiza tras respuestas y navegación. `createApiClient` y `createRpcClient` siguen disponibles para clientes explícitos o externos. Las respuestas no JSON requieren `contentType: "response"`.

Una respuesta API/RPC iniciada antes de un cambio de token no puede restaurar un token CSRF ya eliminado por logout ni sobrescribir el token aplicado por navegación. El cliente compara el documento y el token actuales con los que tenía al iniciar la petición antes de aplicar la cabecera de respuesta.

Los schemas `params` de API deben describir exactamente los segmentos dinámicos de la ruta como cadenas obligatorias. Una ruta estática no declara `params`. Los inputs de `query` deben aceptar cadenas o listas de cadenas, con campos opcionales si la clave puede faltar. Si se necesitan números, conviértalos dentro del schema desde texto; el generador rechaza un contrato que exige directamente un número que la URL no puede entregar.

Los schemas públicos de API, RPC y Socket deben exponer tipos Standard Schema concretos: la generación rechaza `any`, `unknown` y `never` tanto en la entrada como en la salida, incluso cuando aparecen anidados, y también parámetros genéricos que no quedan resueltos en el contrato exportado. Concrete esos parámetros y modele explícitamente el tipo público antes de generar clientes. El manifiesto también rechaza nombres que no puedan representarse sin ambigüedad en el cliente. Por ejemplo, `server/api/users/index.get.ts` (`api.users.get()`) no puede coexistir con `server/api/users/get.post.ts` (`api.users.get.post()`), ni `server/rpc/users.ts` con `server/rpc/users/get.ts`. `server/api/index.<method>.ts` se rechaza porque produciría una clave cliente vacía. Cada diagnóstico incluye las rutas en conflicto; no hay sobrescrituras silenciosas.

`meeko check .` genera proyectos TypeScript separados para cliente, servidor y shared. Incluye las fuentes de los layers declarados en `meeko.config.ts` (también los que añaden los módulos), aunque sus rutas no usen el nombre convencional `layers/`, y los componentes de `addComponentsDir` de los módulos que viven dentro del proyecto fuera de `node_modules`. Un archivo `*.server.ts` de `app/` se comprueba en el proyecto servidor y uno `*.shared.ts` en el proyecto shared; los archivos con sufijo de ámbito conservan esa selección también dentro de `shared/` y `server/`.

Los errores de API y RPC se normalizan en el servidor: un `ApiError` conserva `code` y `status`, la respuesta añade `requestId` y `x-request-id`, y un fallo desconocido se devuelve como `INTERNAL_ERROR` sin exponer su mensaje. La misma normalización se aplica al despacho local SSR y al transporte Node, incluso cuando Vite carga módulos en grafos distintos. La navegación que solicita `application/meeko+json` recibe el mismo formato; una página HTML de error conserva el estado HTTP y `x-request-id` sin incluir detalles privados. El servidor generado observa los fallos 5xx: en producción registra tipo e ID, y en desarrollo muestra también el error original. Las respuestas 4xx esperadas no se registran como fallos internos.

### Segmentos dinámicos en `api.*`

Cada carpeta o archivo de `server/api` es un nivel de `api.*`, y cada archivo aporta el método de su sufijo. Desde `1.2`, un segmento dinámico se llama con sus parámetros: `node({ nombre: valor })` devuelve el cliente de ese segmento, y los métodos que se alcanzan así ya no reciben `params`. `query`, `body` y `signal` siguen igual, y la URL se construye y se codifica como con `params`.

```ts
// server/api/menu/categories/index.get.ts         → api.menu.categories.get()
// server/api/menu/categories/[id].patch.ts        → api.menu.categories({ id }).patch({ body })
// server/api/menu/categories/[id]/archive.post.ts → api.menu.categories({ id }).archive.post()
// server/api/orgs/[org]/users/[id].get.ts         → api.orgs({ org }).users({ id }).get()
const list = await api.menu.categories.get();
await api.menu.categories({ id }).patch({ body: { name } });
await api.menu.categories({ id }).archive.post();
const user = await api.orgs({ org }).users({ id }).get({ query: { tab: "profile" } });
```

- La llamada recibe un objeto con el único parámetro de su segmento, como cadena: TypeScript rechaza que falte, una clave de más, un valor que no es texto y `params` en los métodos que siguen a la llamada. Un objeto sin el parámetro o con otro lanza un `TypeError` al llamar; un valor vacío, `.`, `..` o con `/` rechaza la petición igual que con `params`.
- Un nivel conserva sus métodos y sus hijos estáticos junto a la llamada: `api.menu.categories.get()` y `api.menu.categories({ id })` conviven. Si un nivel tiene varios segmentos dinámicos hijos (`users/[id].get.ts` y `users/[slug]/posts.get.ts`), el nombre del parámetro elige el segmento: `api.users({ id })` o `api.users({ slug }).posts.get()`.
- Un catch-all `[...path]` recibe, como en `params`, una cadena con los segmentos unidos por `/`: `api.files({ path: "docs/a b.txt" }).get()` pide `/api/files/docs/a%20b.txt`, con cada segmento codificado por separado.
- `useApi` no cambia: sigue recibiendo la ruta con corchetes y `params`, como `useApi("/api/menu/categories/[id]", { params: { id } })`.
- El editor completa la llamada, sus parámetros y los métodos del segmento, y el hover y "ir a la definición" de `api.menu.categories({ id }).archive.post` llevan al handler.

En `clientKey`, el segmento dinámico de `[id]` o `[...id]` se llama `byId`: `by` seguido del nombre del parámetro con la inicial en mayúscula. El cliente reconoce así el segmento al que corresponde cada parámetro, también en un cliente explícito de `createApiClient`. Por eso el manifiesto rechaza, con las rutas en conflicto, un segmento estático que se llame igual que el segmento dinámico de su nivel (`users/byId/` junto a `users/[id]`) o de su propia ruta (`[id]/byId.get.ts`), y dos parámetros cuyo nombre sólo cambia en la inicial (`[id]` y `[Id]`) en el mismo nivel o en la misma ruta.

La forma anterior, `api.menu.categories.byId.archive.post({ params: { id } })`, sigue funcionando durante toda la serie 1.x y se retirará en `2.0`. Está obsoleta desde `1.2`: el editor tacha cada método que se llama a través de `byId` y su hover indica el reemplazo; no hay aviso de consola. Sólo existe antes de la primera llamada de segmento: `api.orgs({ org }).users.byId` no existe.

### Errores de validación en formularios

Desde `1.2`, cuando `params`, `query`, `body` o el `input` de un RPC no superan su schema, la respuesta `400` (`INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` o `INVALID_INPUT`) incluye `issues`: una lista de `{ path, message }` con, como mucho, 20 elementos. `path` son las claves de la ruta del issue de Standard Schema unidas con `.` (`"items.0.name"`), o `""` para la entrada completa; `message` es el mensaje del schema. Sólo viajan esos dos campos: nunca el valor recibido, lo esperado ni una traza. Los issues sin mensaje se omiten, y sin ninguno la respuesta no lleva `issues`. Un resultado del handler que no supera `response` u `output` sigue siendo `500` sin detalle, porque es un fallo del servidor.

```ts
// shared/schemas/auth.ts
import * as v from "valibot";
export const loginInput = v.object({
  email: v.pipe(v.string(), v.email("Escribe un correo válido.")),
  password: v.pipe(v.string(), v.minLength(1, "Escribe tu contraseña.")),
});
```

```json
{ "code": "INVALID_INPUT", "status": 400, "requestId": "…", "issues": [{ "path": "password", "message": "Escribe tu contraseña." }] }
```

En el cliente, `ClientError.issues` es esa lista de sólo lectura (tipo `ValidationIssue`), o `undefined` si la respuesta no la trae. Llega igual desde `api.*`, `rpc.*` y el `error` de `useApi`, `useRpcQuery` y `useRpcMutation`:

```ts
import { ClientError } from "@meekojs/meeko/framework";

const login = useRpcMutation("auth.login");
const fieldError = (path: string) => {
  const error = login.error.value;
  return error instanceof ClientError ? error.issues?.find((issue) => issue.path === path)?.message : undefined;
};
```

Escriba mensajes propios en el schema: algunos mensajes por defecto de Valibot citan el valor recibido.

`useForm` lleva estos `issues` a cada campo del formulario sin código propio (véase [Formularios: `useForm`](#formularios-useform)).

### Errores de un campo: `ApiError` con `issues`

Desde `1.5`, un error que no es de validación pero pertenece a un campo, como un correo que ya tiene cuenta, lleva `issues` con el tercer argumento de `ApiError`, que acepta `{ message, issues }` además del mensaje interno de siempre:

```ts
throw new ApiError("EMAIL_TAKEN", 409, {
    message: `duplicate key for ${body.email}`, // interno: nunca se envía
    issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }],
});
```

```json
{ "code": "EMAIL_TAKEN", "status": 409, "requestId": "…", "issues": [{ "path": "email", "message": "Ese correo ya tiene una cuenta." }] }
```

- Los `issues` tienen la forma de los de un `400` (`{ path, message }`, con `path` unido con `.` o `""` para el formulario completo) y se envían igual: como mucho 20, en las respuestas de API y RPC, también en el despacho local SSR. Son mensajes públicos, escritos para el usuario; el `message` del error sigue siendo interno.
- Sólo viajan con un estado `4xx`: un `5xx` es un fallo del servidor y responde sin ellos. Un issue sin `path` o sin `message` de texto lanza un `TypeError` al crear el error.
- Un `ApiError` de otro grafo de módulos (Vite) conserva sus `issues` en la normalización. Otro error con la misma forma, como el `ApiError` de un SDK o un `ClientError` de otro servicio Meeko que el handler deja escapar, no envía sus `issues`: Meeko sólo reenvía los de su propio `ApiError`.
- En el cliente llegan en `ClientError.issues`, y `useForm` los reparte como los de un `400`.

### Valores por petición: `locals`

Desde `1.2`, `defineApiRoute` y `defineRpc` aceptan `locals(context)`, que calcula un valor por petición (por ejemplo, el usuario actual) y se lo entrega al handler como `locals`, con el tipo inferido de lo que devuelve. Sin `locals`, el handler recibe `locals: undefined`. `authorize` no cambia y sigue devolviendo un booleano.

El orden de cada petición es: Origin con `origin: "required"`, Origin y CSRF de la sesión, `rateLimit` (desde `1.2`), `auth`, `authorize`, validación de la entrada (`params`, `query` y `body`, o `input`), `locals`, handler y validación de la respuesta. Así, `locals` sólo se ejecuta con una entrada válida y una petición ya autorizada. Si lanza un `ApiError`, ese error es la respuesta (por ejemplo, `401` si el usuario de la sesión ya no existe o `403` si perdió el acceso); cualquier otro error es `500`.

```ts
// server/rpc/orders/create.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { newOrder, orderSchema } from "../../../shared/schemas/order.js";
import { createOrder, findUser } from "../../utils/store.js";

export default defineRpc({
  input: newOrder,
  output: orderSchema,
  auth: "required",
  locals: async ({ session }) => {
    const user = await findUser((session.current!.data as { userId: string }).userId);
    if (!user) throw new ApiError("UNAUTHENTICATED", 401);
    return { user };
  },
  handler: ({ input, locals }) => createOrder(locals.user, input),
});
```

Declare `locals` antes de `handler` en el objeto: si `locals` usa su parámetro, TypeScript sólo infiere su tipo para el handler cuando aparece antes. Con la sesión tipada mediante [`MeekoSession`](#tipos-de-la-sesión-meekosession), `session.current!.data.userId` no necesita `as`.

### Estado de la respuesta: `status`

Desde `1.2`, `defineApiRoute` acepta `status` para elegir el estado de una respuesta correcta sin renunciar a JSON, a la validación con `response` ni al tipo del cliente generado:

| `status` | Respuesta | `api.*` resuelve |
| --- | --- | --- |
| `200` (por defecto) | JSON validado con `response` | el valor de `response` |
| `201` | JSON validado con `response` (`201 Created`) | el valor de `response` |
| `202` | JSON validado con `response` (`202 Accepted`) | el valor de `response` |
| `204` | sin cuerpo ni `content-type` (`204 No Content`) | `undefined` |

```ts
// server/api/orders/index.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { newOrder, orderSchema } from "../../../shared/schemas/order.js";
import { createOrder } from "../../utils/store.js";

export default defineApiRoute({
  body: newOrder,
  response: orderSchema,
  status: 201,
  handler: ({ body }) => createOrder(body),
});
```

```ts
// server/api/orders/[id].delete.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { orderParams } from "../../../shared/schemas/order.js";
import { deleteOrder } from "../../utils/store.js";

export default defineApiRoute({
  params: orderParams,
  status: 204,
  handler: async ({ params }) => { await deleteOrder(params.id); },
});
```

- `status` debe ser un literal (`status: 201`): el generador lo lee sin ejecutar el handler y rechaza otro valor. Una constante o una expresión no sirven.
- Con `204`, el handler no devuelve nada y no se declara `response`; devolver un valor responde `500` `INVALID_RESPONSE`. En el contrato generado la salida es `undefined`, así que `await api.orders({ id }).delete()` resuelve `undefined`, igual que `useApi`.
- `status` no se combina con `contentType: "response"`: ese handler ya devuelve su propio `Response` con el estado que quiera.
- Un `status` no admitido, combinado con `contentType: "response"` o un `204` con `response` responde `500` `INVALID_RESPONSE_STATUS` antes de leer la entrada, aunque el generador ya lo rechaza en `meeko routes`, `meeko check` y `meeko dev`.
- Los errores no cambian: siguen saliendo de `ApiError` con su propio estado.
- `generateOpenApi` documenta el estado declarado (`201 Created`, `202 Accepted` o `204 No Content`, este sin `content`).
- El estado es fijo por endpoint. Para elegirlo en cada petición (por ejemplo, `201` al crear y `200` al actualizar en un mismo `PUT`), use `contentType: "response"` o dos endpoints.
- RPC no tiene `status`: un procedimiento siempre responde `200` con su `output`.

### Formularios sin JavaScript: `form`

Desde `1.7`, un endpoint de API puede atender también un `<form method="post">` nativo, que funciona antes de que cargue el JavaScript o sin él. Se activa con `form`, y el formulario se valida con el **mismo schema** de `body` que el JSON:

```ts
// shared/schemas/feedback.ts
import * as v from "valibot";
export const feedbackInput = v.object({
  page: v.pipe(v.string(), v.startsWith("/")),
  helpful: v.boolean("Elige sí o no."),
  comment: v.optional(v.pipe(v.string(), v.maxLength(500, "Usa como mucho 500 caracteres.")), ""),
});
export const feedbackSaved = v.object({ id: v.string() });
```

```ts
// server/api/feedback.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { feedbackInput, feedbackSaved } from "../../shared/schemas/feedback.js";
import { saveFeedback } from "../utils/feedback.js";

export default defineApiRoute({
  body: feedbackInput,
  response: feedbackSaved,
  // O { redirect: (saved) => `/gracias?id=${saved.id}` }. `echo` devuelve tras un error el texto de esos campos.
  form: { echo: ["comment"] },
  handler: ({ body }) => saveFeedback(body),
});
```

```html
<!-- app/components/Feedback.meeko -->
<script lang="ts">
const route = useRoute();
const form = useForm({
    schema: feedbackInput,
    initial: { page: route.path.value, helpful: false, comment: "" },
    action: "/api/feedback",
    submit: (values) => api.feedback.post({ body: values }),
});
</script>
<template>
    <form method="post" action="/api/feedback" on:submit="form.submit" novalidate>
        <input type="hidden" name="return" bind:value="route.url.value">
        <input type="hidden" name="_csrf" bind:value="form.csrfToken">
        <input type="hidden" name="page" bind:value="form.fields.page.value">
        <p if:when="form.submitted.value">¡Gracias!</p>
        <p if:when="form.error.value" role="alert">{form.error.value}</p>
        <button name="helpful" value="true" on:click="() => { form.fields.helpful.value = true; }">Sí</button>
        <button name="helpful" value="false" on:click="() => { form.fields.helpful.value = false; }">No</button>
        <textarea name="comment" model="form.fields.comment"></textarea>
        <p if:when="form.errors.value.comment">{form.errors.value.comment}</p>
    </form>
</template>
```

Con JavaScript, `form.submit` cancela el envío nativo y manda JSON con `submit`, como siempre. Sin él (o antes de hidratar), el navegador envía el formulario a `/api/feedback`, con el `name` y el `value` del botón pulsado, y vuelve a la página con el resultado ya pintado en el HTML del servidor: `helpful` llega como el texto `"true"` y el schema lo recibe como `true` (véase la conversión, más abajo). La misma definición sirve para los dos caminos: cada control necesita su `name`, el de su campo.

**Cuerpo.** Con `form`, el endpoint acepta `application/x-www-form-urlencoded` y `multipart/form-data` además de JSON. Sin `form`, esos tipos siguen respondiendo `415 UNSUPPORTED_MEDIA_TYPE`. El JSON no cambia y nunca se convierte. Cada `name` es una clave del objeto, que pasa por el schema de `body`:

- Un nombre repetido (`tag=a&tag=b`) o terminado en `[]` (`tags[]=a`) es una lista; con `[]` es una lista aunque llegue un solo valor, o ninguno con un `<input type="file">` vacío.
- Los campos llegan como texto. Si el schema rechaza el texto de algunos campos, Meeko lo vuelve a validar **una vez** con la lectura tipada de esos campos, y sólo de ellos: `""` es `undefined` (un campo vacío no se dio), `"true"` y `"on"` (una casilla marcada) son `true`, `"false"` es `false` y un número decimal (`"4"`, `"-1.5"`, `"2e3"`) es un `number`; en una lista, cada elemento, sin los vacíos. Un campo que el schema acepta como texto (`"42"` en un `v.string()`, un código postal `"01234"`) nunca se convierte. Así, `v.number()` y `v.boolean()` funcionan sin escribir conversiones; las conversiones del propio schema (`v.pipe(v.string(), v.toNumber())`) también. Un schema asíncrono (`v.pipeAsync`, `v.checkAsync`, que puede consultar la base de datos) se ejecuta **una sola vez**, sin segundo intento: sus campos numéricos o booleanos deben convertir el texto en el propio schema (`v.pipe(v.string(), v.toNumber())`).
- Una casilla sin marcar no envía nada: declárela con un valor por defecto, `v.optional(v.boolean(), false)`, y una lista de casillas con `v.optional(v.array(v.string()), [])`.
- Si un campo convertido sigue sin superar el schema, su mensaje es el de su texto, el que escribió el usuario.
- `return` y `_csrf` son campos reservados: nunca llegan al schema.
- Los objetos anidados no se construyen: `address.city` es una clave con un punto.

**Respuesta.** Un envío correcto (tras validar `response`) responde `303 See Other` a la ruta que devuelve `form.redirect(result, context)` o, sin ella, a la del campo `return`, a la página de `Referer` si es de este sitio, o a `/`. `result` es la respuesta validada, `undefined` con `status: 204` o el `Response` del handler con `contentType: "response"` (sin `redirect`, ese `Response` es la respuesta). La ruta debe ser de esta aplicación: un valor con `//`, `\`, un esquema (`javascript:`, `https://otro.example`), caracteres de control o segmentos de punto que dejarían `//` al principio se sustituye por `/`, con las mismas comprobaciones que [`POST /_meeko/theme`](#tema-clarooscuro-sin-parpadeo); una URL absoluta de este mismo origen vale como su ruta.

Un error (de validación, un `ApiError` del handler o de `locals`, `401`, `403 FORBIDDEN`, `429`, `413` o un `500`) también responde `303`, de vuelta al campo `return`, a `Referer` o a `/`, nunca con el JSON del error. En los dos casos, la respuesta deja una cookie de un solo uso, `__Host-meeko-form` (`meeko-form` sin HTTPS), `HttpOnly`, `SameSite=Lax`, de 60 segundos, con el resultado: el código, el estado, los `issues` (como mucho 20, como en un `400`) y, sólo en los campos que lista `form.echo`, los valores enviados. Por defecto ningún valor vuelve: el formulario muestra los mensajes y sus campos parten de `initial`. Los valores viajan en la cookie y en el HTML de la página, así que `echo` no debe incluir contraseñas, números de tarjeta, PIN, IBAN ni otros datos sensibles; aun así, un campo cuyo nombre contiene `password`, `passcode`, `secret`, `token`, `cvc` o `cvv` nunca vuelve, y los archivos tampoco. Si no cabe en la cookie, primero se quitan los valores y después los últimos `issues`.

**La página.** El `GET` de esa página lee la cookie, la borra en la misma respuesta (`Max-Age=0`, `cache-control: no-store`) y renderiza la página aunque esté prerenderizada. Un `useForm` con `action` igual a la ruta del endpoint toma el resultado durante el SSR, igual que tras un envío con JavaScript: los valores de `form.echo` en sus campos, `errors` y `error` repartidos por los `issues`, `failure` con un `ClientError` del código y el estado (y `error` con `errorMessage(failure)` si no hay `issues`) o `submitted` en `true` tras un envío correcto. El resultado viaja en el estado de la página, así que la hidratación pinta lo mismo, y el navegador lo usa una sola vez: al volver a montar el formulario, empieza de `initial`. Un campo con un mensaje del servidor lo pierde al cambiar, como tras un envío con JavaScript. Un campo que sigue con error vuelve como texto, tal como se escribió.

Por qué una cookie: una query firmada dejaría los valores, a veces personales, en la barra de direcciones, el historial, los logs y el `Referer`, y necesitaría un secreto compartido entre instancias; guardar el resultado en el store de sesiones crearía una sesión para cada visitante anónimo. Una cookie `HttpOnly` de un solo uso no deja rastro en la URL, no necesita estado en el servidor, funciona con varias instancias y, con el prefijo `__Host-`, ningún subdominio puede plantarla. Su contenido sólo se pinta como texto escapado, y no se firma: quien puede escribir esa cookie (el propio navegador del usuario) sólo puede cambiar lo que él mismo ve.

**Seguridad.**

- Un formulario no necesita *preflight*, así que cualquier sitio puede enviar uno. Por eso todo envío nativo exige un `Origin` permitido (el de la aplicación o uno de `SessionManager.allowedOrigins`), como si declarara `origin: "required"`, también con `origin: "none"`: sin él responde `403 INVALID_ORIGIN` antes de leer el cuerpo. Los navegadores envían `Origin` en cada `POST`; una página servida con `Referrer-Policy: no-referrer` lo envía como `null` y no puede usar formularios nativos.
- Con una sesión, el token CSRF que JavaScript envía en `x-meeko-csrf` llega en el campo oculto `_csrf`: `form.csrfToken` lo da en el SSR y en el navegador. Sin él, `403 INVALID_CSRF`. Estos dos `403` responden con el JSON de error y sin `303`: la petición no es de este sitio. Lo demás (`auth`, `authorize`, `rateLimit`, `locals`) funciona igual que con JSON, salvo el orden de `rateLimit`: desde `1.7`, en un envío nativo se cuenta tras `Origin` y **antes de leer el cuerpo**, así que un aluvión de envíos se corta sin analizar cada uno; el token CSRF va en el cuerpo, de modo que un envío con un token no válido también cuenta. Un `429` vuelve a `Referer` o a `/`, porque el campo `return` está en el cuerpo sin leer.
- El cuerpo tiene el límite de 1 MiB del JSON, que `form.maxBytes` cambia; por encima, `BODY_TOO_LARGE`.
- Un `multipart/form-data` no admite archivos salvo con `form.files: true`: llegan al schema de `body` como `File` (por ejemplo, `v.instance(File)` o `v.file()`), y un archivo en un endpoint sin `files` es `400 FILES_NOT_ALLOWED`. Un `<input type="file">` vacío no cuenta. Suba `maxBytes` según el tamaño que acepte.

**Límites.**

- Lo atiende `dispatchApiRoute`, es decir, `createServerApp` y todos los adaptadores de Meeko. `executeApiRoute` sigue aceptando sólo JSON, y un host que renderiza las páginas con `createFrameworkHandler` no lee la cookie.
- Una caché compartida delante del servidor (un CDN) debe dejar pasar las peticiones con la cookie `meeko-form` (o respetar `Vary: Cookie`): si sirve una copia, el formulario no muestra el resultado.
- Una página `render: "prerender"` se renderiza en el build, sin sesión, así que su HTML no lleva el token CSRF y `form.csrfToken` está vacío hasta que hidrata. Con JavaScript no importa (el envío lleva el token en `x-meeko-csrf`), pero un usuario con sesión que envía el formulario nativo sin JavaScript recibe `403 INVALID_CSRF`. Si el formulario es para usuarios con sesión, use `render: "ssr"` (con `cache` si la página es costosa: una petición con sesión nunca usa la copia y lleva su token).
- `generateOpenApi` describe el cuerpo JSON, no el de formulario.

### Datos en componentes: `useApi`, `useRpcQuery` y `useRpcMutation`

Desde `1.1`, un componente puede pedir sus propios datos con composables autoimportados desde los clientes generados. Usan los mismos contratos, tipos, sesión y CSRF que `api.*` y `rpc.*`:

| Composable | Uso | Devuelve |
| --- | --- | --- |
| `useApi(ruta, opciones?, recarga?)` | Lectura de un endpoint `GET` | `{ data, error, pending, refreshing, refresh }` |
| `useRpcQuery(procedimiento, input, recarga?)` | Lectura mediante un procedimiento RPC | `{ data, error, pending, refreshing, refresh }` |
| `useRpcMutation(procedimiento, opciones?)` | Escritura bajo demanda mediante RPC | `{ mutate(input), data, error, pending }` |
| `useApiMutation(ruta, método, opciones?)` (desde `1.2`) | Escritura bajo demanda en un endpoint `POST`, `PUT`, `PATCH` o `DELETE` | `{ mutate({ params, query, body }), data, error, pending }` |

`ruta` es la ruta del endpoint tal como la describe `server/api`, con los segmentos dinámicos entre corchetes: `"/api/users"` o `"/api/users/[id]"`. Sólo se admiten endpoints `GET`. `procedimiento` es el ID del procedimiento con puntos: `server/rpc/users/get.ts` es `"users.get"`. El editor completa rutas y procedimientos, y TypeScript comprueba `params`, `query` e `input` contra el contrato. `data`, `error` y `pending` son señales de sólo lectura; `error` es un `Error` o `null`.

```html
<!-- app/pages/users/[id].meeko -->
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const tab = signal("profile");
const user = await useApi("/api/users/[id]", { params: { id: props.params.id } });
const activity = await useRpcQuery("users.activity", () => ({ id: props.params.id, tab: tab.value }));
const rename = useRpcMutation("users.rename");
async function save(name: string): Promise<void> {
    await rename.mutate({ id: props.params.id, name });
    await user.refresh();
}
</script>
<template><h1>{user.data.value.name}</h1><p>{activity.data.value.length} eventos</p></template>
```

#### Con y sin `await`

- **Con `await`.** El componente no se renderiza hasta tener los datos, también en SSR, y `data` deja de ser nulo en su tipo. Un fallo de la petición se trata como un fallo de la página.
- **Sin `await`.** El componente se renderiza enseguida con `pending` en `true` y `data` en `null`. La petición no se ejecuta en SSR: empieza en el navegador cuando el componente se monta. Es el patrón para mostrar un indicador de carga:

```html
<script lang="ts">
const users = useApi("/api/users");
</script>
<template>
    <p if:when="users.pending.value">Cargando…</p>
    <p if:when="users.error.value">No se pudieron cargar los usuarios.</p>
    <ul if:when="users.data.value"><li each:of="users.data.value ?? []" each:as="user" each:key="user.id">{user.name}</li></ul>
</template>
```

Las opciones de `useApi` y el `input` de `useRpcQuery` pueden contener señales en sus campos, o ser una función que las lee. Cuando el componente ya está montado en el navegador, un cambio de esas señales vuelve a pedir los datos y actualiza `data`, `pending` y `error`; una petición anterior que sigue en curso se cancela. `refresh()` vuelve a pedir los datos con la entrada actual. Mientras llegan los datos nuevos, `data` conserva los anteriores (véase [Datos anteriores durante una recarga](#datos-anteriores-durante-una-recarga-keepprevious)). Un fallo de una recarga o de `refresh()` sólo actualiza `error`: no muestra la página de error.

Las opciones son opcionales cuando el contrato no exige nada. `useApi(ruta)` admite omitirlas si el endpoint no tiene `params` y su `query` no existe o sólo tiene campos opcionales. `useRpcQuery(procedimiento)` admite omitir el `input` si el schema acepta `{}`, y entonces envía `{}`. Lo mismo vale para los clientes generados: `api.users.get()` se llama sin argumentos cuando el endpoint no tiene `params`, ni `query` obligatoria, ni cuerpo. La firma de `rpc.x(input)` no cambia.

```ts
const stats = await useRpcQuery("stats.summary");          // input opcional: envía {}
const users = await useApi("/api/users");                  // query opcional
const page = await api.users.get({ query: { page: "2" } }); // la query sigue disponible
```

#### SSR e hidratación

En SSR, el servidor renderiza la página y sus layouts, registra las peticiones de cada `await` de datos, las espera y vuelve a renderizar con los datos, hasta que ninguna pasada se suspende. Las pasadas descartadas se liberan, con su estado y sus efectos, y cada una parte del estado que dejó el loader. Las peticiones se despachan localmente por el mismo pipeline que `api.*` y `rpc.*` en SSR, así que conservan la sesión y el contexto de la petición. En una ruta `render: "stream"` se resuelven antes del primer byte, como el loader crítico. `head` se calcula con los datos del loader o del código de nivel superior de `<script server>`, no con los de estos composables: si el `<title>` depende de un dato, cárguelo allí.

Los datos resueltos viajan en el campo `resources` del payload, por clave de petición (método o procedimiento y entrada). Al hidratar, el navegador los lee de ahí de forma síncrona y no repite la petición. La entrada de un `await` de datos debe depender sólo de props, datos de la ruta y estado: si el navegador pide una clave que el servidor no cargó, la hidratación falla con un error `MEEKO_RESOURCE_MISSING` que nombra la petición. Un componente que en cada pasada pide datos nuevos detiene el render tras 10 pasadas con un error.

#### Navegación y `render: "client"`

Antes de confirmar una navegación, el navegador renderiza la página nueva sin mostrarla para descubrir y cargar sus `await` de datos. Mientras tanto la página anterior sigue visible y `useNavigation().pending` vale `true`. Si la navegación pidió el payload al servidor, los datos que este ya resolvió llegan en `resources` y no se piden otra vez. Un fallo muestra el `+error.meeko` más cercano, o `app/error.meeko`, dentro de los layouts, como un fallo del loader. Las rutas `render: "client"` usan el mismo mecanismo, entero en el navegador. En SSR, un fallo de un `await` de datos también muestra la página de error, con el mismo mensaje público que un fallo del loader.

Ese render previo es una pasada en seco. El setup de la página nueva y de los layouts que no se conservan se ejecuta, con un estado provisional que después se descarta, pero:

- ningún `effect` se ejecuta (`computed` sí calcula su valor);
- `onMounted` no se ejecuta y la continuación tras un `await` de navegador no empieza;
- `useSocket` y `socket.x` devuelven un cliente que no conecta.

Lo que se repite es el propio código del nivel superior del setup: una petición con `api.*`, una escritura externa o un contador que se incrementa ahí se ejecutan una vez más por navegación. Llévelos a `onMounted` o a un handler.

La pasada se salta si ningún componente del árbol nuevo puede esperar datos. El compilador marca cada módulo con dos datos estáticos: si su script tiene un `await` de datos y qué componentes pinta su plantilla. El navegador recorre esas marcas desde la página y los layouts nuevos y, si ninguno espera datos, confirma la navegación sin pasada previa; el setup se ejecuta entonces una sola vez. Cuentan como que pueden esperar datos un componente elegido en tiempo de ejecución (`<component is>` con una variable del setup, un elemento de `each:` o un parámetro de un snippet) y un módulo sin marcas (escrito a mano o compilado por una versión anterior). El outlet de un layout (`<component is="props.outlet">`) no se recorre, porque el navegador ya comprueba la página. Límite: un componente que no es un layout y pinta con `<component is="props.outlet">` un componente recibido en una prop llamada `outlet` tampoco se recorre; si ese componente espera datos, no se carga antes de confirmar la navegación y se monta tarde, como se describe a continuación, sin error.

#### Componentes que se montan más tarde

Un componente que aparece después de hidratar o confirmar la página (cuando un `if:` pasa a ser verdadero, en una fila nueva de `each:`, al cambiar el componente de `<component is>` o al recibir props nuevas: un componente con un `await` de datos en el nivel superior se vuelve a montar con ellas, en lugar de actualizarlas en su sitio como los demás; véase [Props reactivas](api.md#props-reactivas)) reutiliza los datos que la aplicación ya cargó. Si hace un `await` de datos que no están en caché:

- Su zona queda vacía, sin error, mientras los datos se cargan.
- La carga usa pasadas en seco bajo la raíz del componente que lo contiene, con su mismo contexto (`inject`), sin efectos, sin `onMounted` y sin conexiones de socket.
- Cuando terminan, el componente se renderiza, se hidrata y ejecuta su `onMounted`. Los datos quedan en la caché de la aplicación para los montajes siguientes.
- Si el componente se libera antes (el `if:` vuelve a ser falso o la fila desaparece), la petición se aborta y no se pinta nada, ni se ejecuta `onMounted`, ni se informa un error.
- Si la petición falla, la zona queda vacía y el error llega, con la fuente `"mounted"`, al `provideErrorHandler` más cercano o, si no hay ninguno, al `onError` de `mountClientApp`.

Para mostrar un indicador mientras tanto, use el composable sin `await` y lea `pending`, como en el ejemplo anterior, o envuelva la zona en [`<MeekoAwait>`](#meekoawait), que además puede reservar su altura. El error `MEEKO_SUSPENDED` sólo aparece al llamar a `renderToString` o `renderWithState` de un componente con un `await` de datos fuera del framework (véase [api.md](api.md#módulo-generado)).

#### Datos anteriores durante una recarga: `keepPrevious`

Desde `1.1`, una recarga no vacía `data`: tanto `refresh()` como un cambio de las señales de la entrada ponen `pending` en `true` y dejan los datos anteriores hasta que llegan los nuevos, que los sustituyen en la misma actualización que `pending` vuelve a `false`. Una lista no desaparece mientras se recarga. Desde `1.5`:

- **`refreshing`.** Es `true` mientras hay una recarga y `data` conserva una carga anterior. La primera carga es `pending` sin `refreshing`. Sirve para un indicador discreto (atenuar la lista, un icono girando) sin ocultar los datos.
- **`keepPrevious`.** El último argumento de `useApi` y `useRpcQuery` acepta `{ keepPrevious }` (y, desde `1.7`, [`debounceMs` y `enabled`](#búsqueda-mientras-se-escribe-debouncems-y-enabled)). Por defecto vale `true`, el comportamiento de siempre. Con `false`, un cambio de la entrada vacía `data` y `error` y vuelve a ser una primera carga: sirve cuando mostrar los datos de otra entrada confundiría (la ficha de otro usuario mientras llega la nueva). `refresh()` conserva siempre los datos, porque son de la misma entrada, y un recurso esperado con `await`, cuyo `data` nunca es `null`, también.

```html
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const page = signal("1");
// Por defecto: la página anterior sigue en pantalla mientras llega la siguiente.
const orders = useApi("/api/orders", { query: { page } });
// Otro usuario: mejor el esqueleto que la ficha del anterior.
const user = useApi("/api/users/[id]", () => ({ params: { id: props.params.id } }), { keepPrevious: false });
</script>
<template>
    <ul bind:class="orders.refreshing.value ? 'dimmed' : undefined" bind:aria-busy="orders.pending.value ? 'true' : undefined">
        <li each:of="orders.data.value ?? []" each:as="order" each:key="order.id">{order.total}</li>
    </ul>
</template>
```

| Situación | `data` | `pending` | `refreshing` |
| --- | --- | --- | --- |
| Primera carga | `null` | `true` | `false` |
| `refresh()` | La anterior | `true` | `true` |
| Cambio de la entrada | La anterior (con `keepPrevious: false`, `null`) | `true` | `true` (con `keepPrevious: false`, `false`) |
| Recarga fallida | La anterior; `error` dice por qué | `false` | `false` |

`<MeekoAwait>` se apoya en este comportamiento: durante una recarga sigue mostrando su contenido y marca la zona con `data-meeko-refreshing` y `aria-busy`.

#### Búsqueda mientras se escribe: `debounceMs` y `enabled`

Desde `1.7`, las opciones del último argumento de `useApi` y `useRpcQuery` incluyen `debounceMs` y `enabled`, para una búsqueda que consulta mientras se escribe sin una petición por tecla:

```html
<script lang="ts">
const query = signal("");
const results = useRpcQuery("docs.search", () => ({ q: query.value.trim() }), {
    debounceMs: 200,
    enabled: () => query.value.trim().length >= 2,
});
</script>
<template>
    <input type="search" model="query" aria-controls="results">
    <ul id="results" bind:aria-busy="results.pending.value ? 'true' : undefined">
        <li each:of="results.data.value?.hits ?? []" each:as="hit" each:key="hit.url"><a bind:href="hit.url">{hit.title}</a></li>
    </ul>
</template>
```

- **`debounceMs`.** Milisegundos que la entrada debe quedarse quieta antes de pedir los datos: una ráfaga de cambios hace una sola petición, con la última entrada. Cada cambio cancela la petición en curso, cuyo resultado, si aún llega, se descarta. Durante la espera `pending` ya vale `true` (y `refreshing`, si hay datos) y `data` conserva el resultado anterior; con `keepPrevious: false` se vacía en el primer cambio. No retrasa la primera carga del navegador ni `refresh()`. Por defecto, `0`: cada cambio pide enseguida, como hasta `1.6`.
- **`enabled`.** Un booleano, una señal o una función que lee señales. Mientras vale `false` no hay petición, ni al montar ni con `refresh()` (que resuelve sin hacer nada); la que estaba en curso se cancela, `pending` y `refreshing` valen `false` y `data` conserva el último resultado, o `null` si no lo hubo (`error` tampoco cambia). Al volver a `true` se piden los datos de la entrada actual (con `debounceMs`, tras la espera), salvo que `data` ya sea de esa entrada. Un cambio de `enabled` cuenta como un cambio de la entrada.
- **SSR.** Las dos opciones sólo actúan en el navegador. Un recurso con `await` se pide enseguida en el SSR, sin espera, y sus datos viajan en el payload para hidratar, como siempre. Un recurso con `await` que empieza con `enabled` en `false` no puede tener sus datos: falla con un error que lo dice, en el servidor y en el navegador. Sin `await`, la petición nunca se hace en el SSR, y un recurso desactivado se renderiza con `pending` en `false`.

#### `<MeekoAwait>`

Desde `1.5`, `<MeekoAwait>` es una etiqueta propia de Meeko, como `<MeekoLink>`: no se importa y el compilador la convierte en un componente que Meeko compila y distribuye. Envuelve la zona de unos datos que llegan después del primer pintado, el resultado de `useApi` o `useRpcQuery` sin `await`:

```html
<!-- app/components/ItemsCard.meeko -->
<script lang="ts">
const items = useApi("/api/items");
</script>
<template>
    <section class="card">
        <h2>Items</h2>
        <MeekoAwait for="items" reserve>
            <snippet name="pending"><ItemsSkeleton /></snippet>
            <snippet name="error" params="error, retry"><p role="alert">No se pudo cargar. <button on:click="retry">Reintentar</button></p></snippet>
            <ItemsList bind:items="items.data.value" />
        </MeekoAwait>
    </section>
</template>
```

- **`for`.** El recurso, como expresión (igual que `each:of`; también vale `bind:for`), o una lista: `for="[items, stats]"`. Falta o vacío es el error `MEEK116`; algo que no es un recurso, un error de tipos en `meeko check` y en el editor, y un `TypeError` al renderizar. Vale cualquier objeto con `data`, `error`, `pending` y `refresh` (el tipo `AwaitResource`).
- **Estados.** El contenido de la etiqueta (`default`) se pinta cuando todos los recursos tienen datos. El snippet `pending`, en la primera carga: mientras un recurso no tiene datos y carga (o aún no empezó; sin `await` la petición empieza al montar). El snippet `error`, cuando un recurso sin datos falló: recibe el error y `retry`, que vuelve a pedir los recursos que fallaron y pasa otra vez por `pending`. Sin snippet `error`, pinta `<p role="alert">` con «No se pudieron cargar los datos.» y un botón «Reintentar» (tradúzcalos con `bind:messages="{ error, retry }"`). Un fallo de un recurso gana a otro que todavía carga, para ofrecer `retry` cuanto antes.
- **Recargas.** Una recarga con datos (`refresh()`, un cambio de la entrada) no vuelve a `pending`: el contenido sigue montado, con su DOM, su foco y su estado, y el snippet `default` recibe `refreshing` (`<snippet name="default" params="refreshing">`) para un indicador discreto. Una recarga fallida conserva el contenido; `items.error.value` dice por qué. Con `keepPrevious: false`, un cambio de la entrada vacía los datos y la zona vuelve a `pending`.
- **Tipos.** Dentro del contenido, `meeko check` y el editor leen `items.data.value` como cargado: no hace falta `!` ni `?.`, como dentro de `if:when="items.data.value"`. Vale para cada recurso de `for` escrito como nombre (`items`, `page.items`); con otra expresión, el contenido usa el tipo de siempre. `pending` y `error` no se estrechan. Las props son `MeekoAwaitProps` y los snippets, `MeekoAwaitSnippets`, de `@meekojs/meeko/framework`; `MeekoAwaitProps` se autoimporta como `MeekoLinkProps`.
- **Marcado.** Un `<div>` con `class` e `id` si se pasan, que nunca cambia de elemento, y con `data-meeko-await="pending|error|ready"`, `aria-busy="true"` mientras carga o recarga, `data-meeko-refreshing` durante una recarga y, con `reserve`, `data-meeko-reserve` y `data-meeko-reserve-min`. No trae estilos.
- **Accesibilidad.** `aria-busy` avisa a los lectores de pantalla de que la zona carga. El error se anuncia con `role="alert"`: el aviso por defecto lo lleva; póngalo también en su snippet `error`. Si el foco estaba dentro de un nodo que desaparece al cambiar de estado (el botón «Reintentar», un esqueleto enfocable), pasa a la zona (`tabindex="-1"`, sin desplazar la página) en lugar de perderse en `<body>`; al llegar los datos sigue ahí.
- **SSR.** Sin `await`, la petición no se hace en el servidor: el HTML lleva el snippet `pending` y `aria-busy`, y la hidratación no cambia nada hasta que llegan los datos. Si el recurso ya tiene datos en el servidor (un `await useApi`, que también vale en `for`), el HTML lleva el contenido.
- **Nombre propio.** Un componente del proyecto llamado `MeekoAwait` tiene prioridad sobre la etiqueta de Meeko, con el aviso `MEEK106`.

##### Reservar la altura: `reserve`

Con `reserve`, mientras la zona espera ocupa la altura que tuvo con datos la última vez:

- **Memoria.** Al mostrar datos, un `ResizeObserver` mide la zona (después del layout, sin bloquear el render) y guarda su altura en `sessionStorage` (`meeko:await`) y en memoria, bajo una clave que combina la ruta, la clave de la petición (la del payload: método o procedimiento y entrada) y el orden de la zona entre las de la misma petición en la página. Guarda las 100 zonas más recientes. Si el navegador bloquea `sessionStorage` (modo privado, un sandbox), la memoria vive mientras la página está abierta.
- **Aplicación.** Mientras la zona está en `pending`, una regla CSS le da `min-block-size` con la altura recordada. La regla vive en una hoja de estilos construida (`adoptedStyleSheets`) y la zona la recibe por sus atributos: no hay `style="…"` en el HTML, así que funciona con una CSP estricta sin `'unsafe-inline'` en `style-src`. Con datos, la zona vuelve a su altura natural.
- **Mínimo explícito.** `reserve="320px"` (cualquier longitud CSS: `px`, `rem`, `vh`…) fija además un mínimo, también en la primera visita, y la memoria nunca reserva menos. Su regla va en un `<style>` de `<head>` con el nonce de la petición o, en un sitio estático, permitido por su hash (`inlineStyleHashes`). Otra cosa es un `TypeError`.
- **Reactivo.** Con `bind:reserve` (por ejemplo, `bind:reserve="compact.value ? false : '320px'"`), activarlo, quitarlo o cambiar el mínimo en el navegador añade o quita el script y las reglas de `<head>` y empieza o deja de medir la zona.

Qué pasa en cada caso:

| Situación | Primer pintado | Al llegar los datos |
| --- | --- | --- |
| Primera visita de la pestaña (sin memoria) | El esqueleto, con su altura natural (o el mínimo de `reserve="320px"`) | La zona crece una vez hasta el contenido: el mismo salto que sin `reserve`, que sólo evita un esqueleto de la misma altura |
| Carga completa de una página ya visitada en la pestaña (recarga, abrir un enlace) | El esqueleto con la altura recordada: un script en línea de `<head>`, que se ejecuta antes del primer pintado, lee `sessionStorage` y adopta las reglas | Sin salto si el contenido mide lo mismo |
| Navegación en el cliente a una página ya visitada | La zona se inserta con la altura recordada: el componente adopta las reglas antes de insertarla | Sin salto |
| Zona que se monta más tarde (un `if:`, una pestaña) | Igual que la navegación | Sin salto |
| Recarga de datos | El contenido sigue en pantalla | Sin salto, salvo que el contenido nuevo mida distinto |

El script de `<head>` es siempre el mismo texto, así que tiene un único hash para la CSP; lleva el nonce de la petición y un sitio estático lo permite con los hashes de `inlineScriptHashes`. Sólo toca el CSSOM, nunca el DOM, así que la hidratación encuentra el HTML del servidor. Meeko lo añade sólo a las páginas con `<MeekoAwait reserve>` (con `useHead`, en una ruta `render: "stream"` también en el primer envío). Sin hojas de estilos construidas (navegadores anteriores a 2023) la zona usa su altura natural.

La altura depende del ancho: si la ventana cambia mucho entre visitas, la memoria se ajusta en la siguiente medida. Dos zonas con la misma petición en la misma página tienen claves distintas por su orden; si el orden cambia entre visitas, intercambian sus alturas.

##### Una transición opcional

`<MeekoAwait>` no anima nada. Si quiere suavizar el cambio de altura cuando la zona deja la reserva, en los navegadores con [`interpolate-size`](https://developer.mozilla.org/docs/Web/CSS/interpolate-size):

```css
@media (prefers-reduced-motion: no-preference) {
    [data-meeko-await] {
        interpolate-size: allow-keywords;
        transition: min-block-size 200ms ease-out;
    }
}
```

Una transición de tamaño mueve lo que viene después en cada fotograma y el navegador lo cuenta como salto (CLS): suaviza la percepción, no la métrica. Para la métrica, lo que cuenta es que la altura reservada coincida con la del contenido.

#### Evitar saltos de altura (CLS)

Una card cuyos datos llegan después del primer pintado sale vacía en el HTML y crece al llegar la lista, empujando lo que viene después: un salto de diseño, que Core Web Vitals mide como CLS. En orden de preferencia:

1. **`await` en la carga inicial.** Con `await useApi(...)`, el SSR espera los datos y pinta la lista: no hay nada que crezca. Es la recomendación para lo que se ve al cargar la página.

   ```html
   <!-- app/components/ItemsCard.meeko -->
   <script lang="ts">
   const items = await useApi("/api/items");
   </script>
   <template>
       <section class="card">
           <h2>Items</h2>
           <ul><li each:of="items.data.value" each:as="item" each:key="item.id">{item.name}</li></ul>
       </section>
   </template>
   ```

2. **`<MeekoAwait reserve>`.** Para lo que no puede esperar el SSR: datos secundarios, zonas fuera de pantalla, componentes que se montan más tarde o datos que cambian con la interacción. Desde la segunda visita de la pestaña la zona sale con su altura (véase [Reservar la altura](#reservar-la-altura-reserve)).

   ```html
   <script lang="ts">
   const items = useApi("/api/items");
   </script>
   <template>
       <section class="card">
           <h2>Items</h2>
           <MeekoAwait for="items" reserve>
               <snippet name="pending"><ul class="skeleton"><li each:of="[1, 2, 3, 4]" each:as="row"></li></ul></snippet>
               <ul><li each:of="items.data.value" each:as="item" each:key="item.id">{item.name}</li></ul>
           </MeekoAwait>
       </section>
   </template>
   ```

3. **Esqueletos de la misma altura.** El snippet `pending` con las mismas filas y alturas que el contenido evita también el salto de la primera visita. Si la lista tiene un tamaño conocido (una página de 20), dé al esqueleto ese tamaño; si no, `reserve="320px"` fija un mínimo razonable.
4. **`keepPrevious`.** Por defecto, `refresh()` y un cambio de la entrada conservan la lista anterior hasta que llega la nueva: no la vacíe a mano antes de recargar (véase [Datos anteriores durante una recarga](#datos-anteriores-durante-una-recarga-keepprevious)).
5. **`content-visibility` y `contain-intrinsic-size`.** Para secciones largas fuera de pantalla, `content-visibility: auto` con `contain-intrinsic-size: auto 320px` reserva un tamaño y el navegador recuerda el último que pintó (`auto`). Es CSS de la aplicación; combina bien con `<MeekoAwait>`.
6. **`interpolate-size`.** Una transición suaviza el cambio, pero no lo quita de la métrica (véase [Una transición opcional](#una-transición-opcional)).

`meeko check`, `meeko build` y el editor avisan con `MEEK117` de una página o un layout que pinta en un `each:of` los datos de un `useApi` o un `useRpcQuery` sin `await` sin ocuparse de su carga. Es una pista, nunca un error: desaparece al esperar los datos con `await`, envolver la lista en `<MeekoAwait>`, leer `pending` o `refreshing` del recurso (un esqueleto con `if:when="items.pending.value"`), poner la lista bajo un `if:when` que lea sus datos o pasar el recurso entero a otro componente (`bind:items="items"`), que puede ocuparse de su carga.

#### Mutaciones

`useRpcMutation(procedimiento)` no hace ninguna petición hasta que se llama `mutate(input)`, nunca en SSR. `mutate` envía el token CSRF como `rpc.*`, actualiza `pending`, `data` y `error` y devuelve la salida del procedimiento, o rechaza con su error. No se puede esperar con `await` en el nivel superior (`MEEK055`): espere `mutate` dentro de un handler.

Desde `1.2`, cada envío empieza con `pending` en `true` y `error` en `null` en una sola actualización, y termina escribiendo a la vez `data` o `error` y `pending` en `false`: un `effect` que lee varias de esas señales nunca ve una mezcla del intento anterior y del nuevo. Las opciones `onSuccess(output, intento)` y `onError(error, intento)` se llaman después, con el estado ya actualizado, una vez por intento (véase [Avisos de cada intento](#avisos-de-cada-intento-onsuccess-y-onerror)).

Desde `1.2`, `useApiMutation(ruta, método)` hace lo mismo con un endpoint de API que no es `GET`. `ruta` se escribe como en `useApi` (`"/api/notes/[id]"`) y `método` es `"POST"`, `"PUT"`, `"PATCH"` o `"DELETE"`; TypeScript sólo acepta los métodos que existen para esa ruta. `mutate({ params, query, body })` recibe la entrada de la operación, comprobada contra el contrato, y se puede llamar sin argumentos si la operación no exige nada. Un endpoint `204` resuelve con `undefined`.

```html
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const note = await useApi("/api/notes/[id]", { params: { id: props.params.id } });
const save = useApiMutation("/api/notes/[id]", "PUT");
const remove = useApiMutation("/api/notes/[id]", "DELETE");
async function rename(text: string): Promise<void> {
    await save.mutate({ params: { id: props.params.id }, body: { text } });
    await note.refresh();
}
</script>
<template>
    <p if:when="save.error.value">No se pudo guardar.</p>
    <button bind:disabled="remove.pending.value" on:click="() => remove.mutate({ params: { id: props.params.id } })">Borrar</button>
</template>
```

Igual que `useRpcMutation`, se llama mientras se ejecuta el script del componente (en su nivel superior) y `await useApiMutation(...)` da `MEEK055`. Un export propio de la aplicación llamado `useApiMutation` tiene prioridad sobre el autoimport.

#### Mutaciones seguras ante reintentos

Una escritura que se queda sin respuesta (se cae la red, el servidor responde `5xx` o el proceso muere) puede haberse aplicado o no. Reintentarla a ciegas puede cobrar dos veces; descartarla puede perder una venta. Desde `1.2`, `useRpcMutation` y `useApiMutation` aceptan la opción `retrySafe`, que resuelve ese caso en el cliente y deja la deduplicación al servidor:

```ts
const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
const step = useApiMutation("/api/kitchen/items/[id]/steps", "POST", { retrySafe: { key: "kitchen:step", storage: "session" } });
```

- **Intención con clave.** `mutate(input)` crea un UUID nuevo (la clave de idempotencia), guarda la intención (la entrada, la clave y la hora) en el almacenamiento del navegador bajo `retrySafe.key` y después la envía con la cabecera `Idempotency-Key: "<uuid>"`, con el formato de cadena de Structured Fields que define el borrador del IETF. Si la página se cierra a mitad de la petición, la intención sigue guardada.
- **Sin respuesta.** Un fallo de red, un `5xx`, un `408` o un `429` conservan la intención: `mutate` rechaza con el error, `error` lo refleja y `charge.uncertain.value` muestra la intención (`{ idempotencyKey, input, startedAt }`). Se reintenta con la **misma** clave cuando el navegador vuelve a estar en línea (evento `online`), cuando se monta un componente que usa la mutación (también después de recargar) y al llamar a `charge.retry()`. Mientras se reintenta, `uncertain` conserva su valor, `pending` vale `true` y `error` vuelve a `null`.
- **Con respuesta.** Un `2xx` borra la intención y `mutate` o `retry()` resuelven con la salida. Cualquier otro `4xx` también la borra: el servidor contestó, así que no hay nada que reintentar; el `ClientError` llega a `error` y rechaza la promesa. `uncertain` vuelve a `null` en la misma actualización que escribe `data` o `error` y pone `pending` en `false`, también en los demás componentes que usan la misma clave: un `effect` que mira `uncertain` lee ya el resultado de ese intento, nunca un `error` anterior.
- **Una intención a la vez.** Mientras haya una intención incierta bajo esa clave, `mutate` rechaza con un error `MUTATION_UNCERTAIN` sin enviar nada. La aplicación decide: `retry()` la reintenta, `discard()` la olvida sin enviarla (pida antes confirmación al usuario, porque pudo registrarse) y vacía `error`, que describía el fallo de esa intención.
- **Nunca en SSR ni en seco.** El servidor nunca la envía ni la lee, y las pasadas en seco de una navegación tampoco: sólo la reintenta el componente ya montado.
- **Almacenamiento.** `storage: "local"` (por defecto) sobrevive a recargas y a cerrar el navegador; `"session"`, sólo a recargas de esa pestaña. Si el navegador bloquea el almacenamiento, la intención vive en memoria y se reintenta mientras la página siga abierta. La intención usa [`useStorage`](#estado-persistente-usestorage) por dentro, así que otra pestaña la ve llegar por el evento `storage`; si dos pestañas la reintentan a la vez, el servidor recibe la misma clave dos veces y responde lo mismo.

Use una clave de almacenamiento por mutación, que incluya lo que la distinga entre usuarios o cuentas que comparten el navegador (`` `pos:sale:${restaurant.slug}` ``). Una intención que guardó otra mutación bajo la misma clave nunca se envía a este endpoint. La entrada se guarda y se reenvía tal como viaja, en JSON.

```html
<script lang="ts">
const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
const failure = signal("");
async function pay(input: SaleInput): Promise<void> {
    failure.value = "";
    try {
        const receipt = await charge.mutate(input);
        notify(`Venta #${receipt.number} cobrada.`);
    } catch (error) {
        // Sin respuesta: queda en verificación y se reintentará con la misma clave.
        if (!charge.uncertain.value) failure.value = errorMessage(error);
    }
}
function discard(): void {
    if (window.confirm("Descarta esta venta sólo si comprobaste que no se registró.")) charge.discard();
}
</script>
<template>
    <div role="alert" if:when="charge.uncertain.value">
        <p>Venta en verificación: no tuvo respuesta. Se reintentará con la misma clave, así que no se cobrará dos veces.</p>
        <button bind:disabled="charge.pending.value" on:click="() => charge.retry().catch(() => {})">Reintentar ahora</button>
        <button on:click="discard">Descartar</button>
    </div>
    <p if:when="failure.value">{failure.value}</p>
</template>
```

##### Avisos de cada intento: `onSuccess` y `onError`

Un reintento automático (al volver la conexión o al montarse el componente) no tiene una promesa a la que esperar. Desde `1.2`, las opciones `onSuccess` y `onError` de `useRpcMutation` y `useApiMutation`, con o sin `retrySafe`, se llaman una vez por cada intento que termina, lo haya enviado quien sea, después de actualizar `data`, `error`, `pending` y `uncertain`:

```ts
const charge = useRpcMutation("sales.checkout", {
    retrySafe: { key: "pos:sale" },
    onSuccess(receipt, attempt) {
        // También tras un reintento en segundo plano: la venta en verificación se confirmó.
        if (attempt.trigger !== "mutate") notify(`Venta #${receipt.number} cobrada.`);
        ticket.clear();
    },
    onError(error, attempt) {
        // Sólo los rechazos con respuesta: sin respuesta, la venta sigue en verificación.
        if (!attempt.uncertain) notify(`La venta no se registró: ${errorMessage(error)}`);
    },
});
```

- **`intento`.** Lleva la entrada enviada (`input`), su clave (`idempotencyKey`, `null` sin `retrySafe`) y quién lo envió (`trigger`): `"mutate"`, `"retry"` (una llamada a `retry()`) o `"resume"` (el reintento automático). En `onError`, `uncertain` es `true` cuando no hubo respuesta y la intención se conserva para reintentarla; sin `retrySafe` siempre es `false`.
- **Una vez por intento.** Si `mutate` y `retry()` esperan la misma petición, o dos componentes con la misma clave la comparten, cada mutación avisa una sola vez. La promesa de `mutate` y `retry()` sigue resolviendo o rechazando como siempre: use los avisos para lo que también debe pasar tras un reintento en segundo plano y la promesa para lo propio de esa llamada.
- **Errores.** Un fallo dentro del aviso (o la promesa que rechaza si es asíncrono) llega al `provideErrorHandler` más cercano con la fuente `"event"`, como un manejador `on:`; no cambia el estado de la mutación ni el resultado de la promesa.

**En el servidor**, la clave llega validada como `context.idempotencyKey`: el UUID en minúsculas, o `undefined` si la cabecera falta o no es un UUID (se acepta con o sin comillas). Meeko no deduplica: la aplicación guarda la clave junto al resultado, con una restricción única, y ante una clave repetida devuelve el resultado que ya registró en lugar de aplicar la escritura otra vez.

```sql
ALTER TABLE sales ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX sales_idempotency_key ON sales (restaurant_id, idempotency_key);
```

```ts
// server/rpc/sales/checkout.ts
export default defineRpc({
    input: saleInput,
    output: saleReceipt,
    auth: "required",
    handler: async ({ input, context }) => {
        const key = context.idempotencyKey;
        if (!key) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED", 400);
        const { db, restaurantId } = context.services;
        // Un reintento de una venta ya registrada devuelve el mismo recibo, sin cobrar otra vez.
        const existing = await db.sales.findByKey(restaurantId, key);
        if (existing) return existing.receipt;
        // La restricción única cubre también dos reintentos simultáneos: el segundo INSERT falla
        // y vuelve a leer la venta del primero.
        return db.sales.insertOrGet(restaurantId, key, input);
    },
});
```

Acote la clave al usuario o a la cuenta, como en el índice, y, si quiere seguir el borrador del IETF al pie de la letra, responda `422` cuando la misma clave llega con otra entrada. La cabecera no cambia la seguridad: la petición sigue necesitando la sesión, el token CSRF y el `Origin` de siempre. En una petición del mismo origen el navegador la envía sin más; si un cliente de otro origen llama a la API con CORS, añada `Idempotency-Key` a `Access-Control-Allow-Headers` en su proxy o middleware.

##### Una clave propia en `api.*` y `rpc.*`

Desde `1.2`, una llamada de los clientes generados acepta `idempotencyKey`, un UUID que viaja en la misma cabecera `Idempotency-Key`. Va junto a `params`, `query`, `body` y `signal` en `api.*`, y en las opciones de `rpc.*`:

```ts
const key = crypto.randomUUID();
await api.sales.post({ body: sale, idempotencyKey: key });
await rpc.sales.checkout(sale, { idempotencyKey: key, signal: AbortSignal.timeout(10_000) });
```

Un valor que no es un UUID rechaza con `TypeError` sin enviar la petición. La clave no se guarda ni se reintenta: es la misma cabecera, y la deduplicación sigue siendo del servidor.

| Situación | Use |
| --- | --- |
| Una escritura desde un componente que debe sobrevivir a una caída de red o a una recarga, con aviso de «en verificación» | `useRpcMutation` / `useApiMutation` con `retrySafe`: Meeko crea la clave, guarda la intención y la reintenta |
| Código que no es un componente (un script, una cola propia, un service worker) o una clave que ya existe fuera de Meeko, como el id de un pedido sin conexión | `api.*` / `rpc.*` con `idempotencyKey`: usted guarda la clave y repite la llamada con ella |
| Pruebas de la deduplicación del servidor | `api.*` / `rpc.*` con `idempotencyKey`, sin escribir la cabecera a mano |

#### `load` o composables

| Necesidad | Use |
| --- | --- |
| Datos de la página que determinan `head`, una redirección, la sesión o el estado HTTP | Código de nivel superior de `<script server>` (o `load`) |
| Datos lentos y secundarios en una ruta `"stream"` | Un export, o un campo de `load`, con `defer` |
| Datos que pertenecen a un componente reutilizable o a un layout | `await useApi` / `await useRpcQuery` |
| Datos que dependen de señales del componente y se recargan al cambiar | `useApi` / `useRpcQuery`, con o sin `await` |
| Datos que pueden llegar después del primer pintado, con un indicador de carga | `useApi` / `useRpcQuery` sin `await`, con [`<MeekoAwait>`](#meekoawait) para no saltar |
| Escrituras | `useRpcMutation` / `useApiMutation`, o `api.*`/`rpc.*` en un handler |
| Escrituras que no deben aplicarse dos veces si se pierde la respuesta (cobros, pasos de cocina) | `useRpcMutation` / `useApiMutation` con `retrySafe` |
| Estado del navegador que debe sobrevivir a una recarga (un ticket abierto, la caja elegida) | [`useStorage`](#estado-persistente-usestorage) |
| Formularios que envían datos, con validación y errores por campo | `useForm` con `api.*`/`rpc.*` en su `submit` |

Las reglas de nivel superior de estos composables (`MEEK054`, `MEEK055`) se describen en [api.md](api.md#composables-de-nivel-superior-y-await). Un host propio puede crearlos con `createUseApi(manifest, options)`, `createUseRpcQuery(manifest, options)`, `createUseRpcMutation(manifest, options)` y, desde `1.2`, `createUseApiMutation(manifest, options)` de `@meekojs/meeko/framework`, que es lo que hacen los clientes generados; los tipos `DataResource`, `LoadedResource`, `RpcMutation`, `UseApi`, `UseRpcQuery`, `UseRpcMutation`, `ApiQueryContract`, `ApiQueryOptions` y `Reactive`, desde `1.2` `ApiMutation`, `ApiMutationInput`, `ApiMutationContract`, `UseApiMutation`, `MutationOptions`, `RetrySafeOptions`, `RetrySafeMutation` y `UncertainMutation`, y desde `1.5` `DataResourceOptions`, describen su forma.

### Estado persistente: `useStorage`

Desde `1.2`, `useStorage(clave, inicial, opciones?)` devuelve una señal editable cuyo valor se guarda en JSON en `localStorage` (o en `sessionStorage` con `storage: "session"`). Se autoimporta en los `.meeko` desde `@meekojs/meeko/framework`, como `useState`, y se llama mientras se ejecuta el script de un componente (en su nivel superior o dentro de un composable que este llama).

```html
<script lang="ts">
const lines = useStorage("pos:ticket", [] as TicketLine[]);
const registerId = useStorage("pos:register", "");
const add = (line: TicketLine): void => { lines.value = [...lines.value, line]; };
</script>
<template><p>{lines.value.length} productos en el ticket</p></template>
```

- **SSR e hidratación sin desajustes.** El servidor nunca lee el almacenamiento: el HTML usa `inicial`, y la hidratación también. El valor guardado se aplica justo al terminar de hidratar la página, antes de `onMounted`, igual que `model` con un control que el usuario editó antes de hidratar. Un componente que se monta después (un `if:` que se abre, la página de una navegación en el navegador) ya pinta el valor guardado en su primer render. La señal no viaja en el estado del payload: su fuente es el almacenamiento.
- **Escrituras.** Cada asignación se guarda al momento, en JSON. Asigne valores nuevos (`lines.value = [...lines.value, line]`), como con cualquier señal: mutar el objeto no avisa ni guarda. Asignar `undefined` borra la clave, y la siguiente lectura vuelve a `inicial` (declare el tipo con `| undefined`, por ejemplo `useStorage<string | undefined>("draft", undefined)`).
- **Lecturas inválidas.** Un valor que no es JSON o que no cumple `schema` se ignora y la señal vale `inicial`. `schema` es un Standard Schema síncrono (Valibot, Zod…); con él, el tipo de la señal sale del schema:

  ```ts
  import * as v from "valibot";
  const theme = useStorage("theme", "light", { schema: v.picklist(["light", "dark"]) });
  ```

- **Almacenamiento bloqueado.** En modo privado, sin permiso o con la cuota llena, nunca lanza: la señal sigue funcionando en memoria. Sólo un fallo inesperado, como un valor que JSON no puede representar (`BigInt`, ciclos) o un `schema` que lanza o es asíncrono, llega al `provideErrorHandler` más cercano o al `onError` de la aplicación.
- **Otras pestañas.** Mientras algún componente usa la clave, el evento `storage` de otra pestaña actualiza la señal (con la misma validación); un `localStorage.clear()` la devuelve a `inicial`. El listener se libera con el último componente que la usa.
- **Una señal por clave.** Dos componentes que usan la misma clave y el mismo almacenamiento comparten una sola señal; el primero que la crea fija `inicial` y `schema`. Cuando ya ningún componente la usa, el siguiente vuelve a leer el almacenamiento.

| Necesidad | Use |
| --- | --- |
| Estado compartido de la aplicación, igual en SSR y en el navegador | `useState` |
| Estado del navegador que sobrevive a una recarga o se comparte entre pestañas | `useStorage` |
| Datos que pertenecen al servidor | `useApi` / `useRpcQuery` |

No guarde secretos ni tokens: el almacenamiento es legible por cualquier script de la página. Incluya en la clave lo que distinga a usuarios o cuentas que comparten navegador (`` `pos:ticket:${restaurant.slug}` ``).

### Formularios: `useForm`

Desde `1.2`, `useForm` reúne lo que repite cada formulario: una señal por campo, la validación en el navegador, `pending`, el mensaje de error, `event.preventDefault()` y los `issues` de un `400` del servidor llevados a cada campo. Se autoimporta desde `@meekojs/meeko/framework` y valida con cualquier Standard Schema, como los de Valibot.

```ts
// shared/schemas/menu.ts
import * as v from "valibot";

export const categoryInput = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, "Escribe un nombre."), v.maxLength(60, "Usa como mucho 60 caracteres.")),
  description: v.pipe(v.string(), v.trim(), v.maxLength(200, "Usa como mucho 200 caracteres.")),
});
export const categorySchema = v.object({ id: v.string(), name: v.string(), description: v.string() });
```

```ts
// server/api/menu/categories/index.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { categoryInput, categorySchema } from "../../../../shared/schemas/menu.js";
import { createCategory } from "../../../utils/menu.js";

export default defineApiRoute({
  body: categoryInput,
  response: categorySchema,
  status: 201,
  handler: async ({ body }) => {
    const category = await createCategory(body);
    if (!category) throw new ApiError("CATEGORY_EXISTS", 409);
    return category;
  },
});
```

```html
<!-- app/components/TextField.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; error?: string | undefined }>();
const value = defineModel<string>("value");
</script>
<template>
    <label>{props.label} <input model="value" bind:aria-invalid="props.error ? 'true' : null"></label>
    <p class="field-error" if:when="props.error">{props.error}</p>
</template>
```

```html
<!-- app/pages/menu/categories/new.meeko -->
<script lang="ts">
import { ClientError } from "@meekojs/meeko/framework";

const form = useForm({
    schema: categoryInput,
    initial: { name: "", description: "" },
    submit: (values) => api.menu.categories.post({ body: values }),
    errorMessage: (failure) => failure instanceof ClientError && failure.code === "CATEGORY_EXISTS"
        ? "Ya existe una categoría con ese nombre."
        : "No se pudo guardar. Revisa la conexión e inténtalo de nuevo.",
});
</script>
<template>
    <form on:submit="form.submit" novalidate>
        <p class="alert" role="alert" if:when="form.error.value">{form.error.value}</p>
        <label>Nombre <input model="form.fields.name" bind:aria-invalid="form.errors.value.name ? 'true' : null"></label>
        <p class="field-error" if:when="form.errors.value.name">{form.errors.value.name}</p>
        <TextField label="Descripción" model:value="form.fields.description" bind:error="form.errors.value.description" />
        <button bind:disabled="form.pending.value">{form.pending.value ? "Guardando…" : "Guardar"}</button>
        <p if:when="form.submitted.value">Categoría guardada.</p>
    </form>
</template>
```

`useForm(options)` recibe:

| Opción | Uso |
| --- | --- |
| `schema` | Opcional. Standard Schema que valida los campos al enviar. |
| `initial` | Valor inicial de cada campo. Con `schema`, uno por cada clave de su entrada, también las opcionales (`undefined` si no hay valor). |
| `submit(values)` | Envía los datos: recibe la salida del schema (o los valores de los campos, sin schema) y devuelve el resultado, o rechaza. |
| `errorMessage(failure)` | Opcional. Texto de `error` para un fallo sin `issues`; por defecto, `failure.message`, que en un `ClientError` es su `code`. |
| `onSuccess(result, form)` | Opcional, desde `1.5`. Se ejecuta tras un envío correcto, con `submitted` ya en `true`: por ejemplo, `(saved, form) => form.commit({ name: saved.name })`. |
| `focusInvalid` | Opcional, desde `1.5`. Con `true`, tras un envío con errores en los campos mueve el foco al primer control inválido (véase [Foco en el primer error](#foco-en-el-primer-error)). |
| `action` | Opcional, desde `1.7`. Ruta del endpoint con `form` al que se envía el `<form method="post">` sin JavaScript, como `"/api/feedback"`: al volver de ese envío, el SSR pinta su resultado (véase [Formularios sin JavaScript](#formularios-sin-javascript-form)). |

y devuelve un `Form`:

| Propiedad | Valor |
| --- | --- |
| `fields` | Una `Signal` escribible por campo, para `model` en un `<input>`, `<textarea>` o `<select>` y `model:nombre` en un componente. |
| `errors` | Señal con el primer mensaje de cada ruta con error (`errors.value.name`, `errors.value["items.0.name"]`); un campo sin error no tiene clave. |
| `error` | Señal con el mensaje del formulario completo, o `null`. |
| `failure` | Señal con el error original del último envío fallido (también el `ClientError` de un `400`), o `null`. |
| `pending` | `true` mientras se valida de forma asíncrona o se ejecuta `submit`. |
| `submitted` | `true` cuando el último envío terminó bien. |
| `dirty` | `true` si algún campo difiere de los valores iniciales (los arrays y objetos se comparan por contenido). |
| `submit(event?)` | Envía el formulario; resuelve con lo que devuelve `submit`, o con `undefined`. Nunca rechaza. |
| `trySubmit(event?)` | Desde `1.5`. Envía igual que `submit`, pero resuelve con un `FormSubmission` que dice cómo terminó. Nunca rechaza. |
| `reset(values?)` | Vuelve a los valores iniciales, o a `initial` combinado con `values`. |
| `commit(values?)` | Desde `1.5`. Escribe `values` y toma los valores de los campos como nuevos valores iniciales, sin borrar `submitted`. |
| `field(name)` | Desde `1.5`. Las piezas de un campo para un componente propio: su señal, su mensaje e IDs estables (véase [Componentes de campo](#componentes-de-campo-formfield)). |
| `csrfToken` | Desde `1.7`. El token CSRF de la sesión para el campo oculto `_csrf` de un formulario nativo, o `undefined` sin sesión. No es una señal. |

Todas las señales salvo `fields` son de sólo lectura (`csrfToken` es un texto, no una señal).

**Envío.** `form.submit(event)` llama a `event.preventDefault()`, valida los campos con el schema y, si son válidos, llama a `submit` con la salida del schema. Mientras hay un envío en curso, otro `form.submit()` se ignora (resuelve `undefined`, y también evita el envío nativo del navegador). Al empezar un envío válido se borran `errors`, `error`, `failure` y `submitted`. `submit` puede devolver un valor o una promesa; para hacer algo con el resultado, envuelva la llamada:

```ts
async function save(event: SubmitEvent): Promise<void> {
    const category = await form.submit(event);
    if (category) form.reset();
}
```

**Resultado del envío.** `submit` resuelve `undefined` tanto si los datos no son válidos como si falla la red o si `submit` devuelve `undefined`. Desde `1.5`, `form.trySubmit(event)` envía igual, pero resuelve con un `FormSubmission<Result>` discriminado por `ok` y `reason`:

| Resultado | Cuándo |
| --- | --- |
| `{ ok: true, result }` | `submit` terminó bien y devolvió `result`. |
| `{ ok: false, reason: "invalid", errors, error, failure }` | Los datos no superaron el schema del navegador (`failure` es `null`) o el servidor respondió con `issues` (`failure` es el `ClientError`). `errors` y `error` son los mensajes que muestra el formulario. |
| `{ ok: false, reason: "error", error, failure }` | El envío falló sin `issues`, como un `409` o un fallo de red. `error` es el texto de `errorMessage`, o `null` si un `reset` lo descartó. |
| `{ ok: false, reason: "skipped" }` | No se envió nada: ya había un envío en curso, el script se ejecuta sólo para producir HTML (SSR) o un `reset` descartó los valores mientras el schema validaba. |

```ts
async function send(event: SubmitEvent): Promise<void> {
    const outcome = await form.trySubmit(event);
    if (outcome.ok) created.value = outcome.result.username;
    else if (outcome.reason === "error") console.warn(outcome.failure);
}
```

`submit` no cambia: sigue resolviendo con el resultado o con `undefined`, y `on:submit="form.submit"` sigue siendo la forma corta cuando no hace falta el resultado.

#### Foco en el primer error

Con `focusInvalid: true`, un envío que termina con errores en los campos, del schema o de los `issues` del servidor, mueve el foco al primer control inválido una vez que los mensajes se han pintado (en el siguiente `requestAnimationFrame`). Busca, en el orden del documento dentro del `<form>` del evento (su `currentTarget`, o el formulario del botón que lo envió), un control cuyo `name` o cuyo `id` de `form.field` sea el de un campo con error, o que tenga `aria-invalid="true"`. Sin evento, busca en todo el documento. Un fallo sin `issues`, como un `409` sin ellos o un fallo de red, no mueve el foco.

```ts
const form = useForm({ schema: signupInput, initial: { email: "", password: "" }, submit: (values) => api.signup.post({ body: values }), focusInvalid: true });
```

**Validación.** El schema se ejecuta al enviar, no mientras se escribe. Cada issue va a `errors` con su ruta unida con `.`, como los `issues` del servidor: `"name"`, o `"items.0.name"` en un campo anidado. Si una ruta tiene varios, se conserva el primero. Un issue con ruta `""` (de una regla sobre el objeto completo) o de una clave que el formulario no tiene va a `error`. Tras un error, el campo se vuelve a validar cada vez que cambia: su mensaje se actualiza o desaparece en cuanto es válido, sin esperar al siguiente envío. Un campo sin error no se valida hasta el envío. Si el schema es asíncrono, `pending` vale `true` mientras valida.

**Campos que dependen de otros.** Desde `1.5`, cada cambio vuelve a validar también los demás campos que ya muestran un error del schema, y el mensaje del formulario si vino del schema (un issue con ruta `""`). El schema se ejecuta siempre sobre el formulario entero, así que no cuesta más. Con una confirmación que Valibot lleva a su campo con `v.forward(v.partialCheck([["password"], ["confirm"]], …), ["confirm"])`, cambiar la contraseña quita el «Las contraseñas no coinciden» de `confirm` en cuanto coinciden, sin tocar la confirmación. Las reglas siguen sin añadir mensajes a un campo que no tenía error, y los mensajes del servidor de otro campo (un `issue` de un `400` o de un `ApiError`) no se borran por cambiar un campo distinto: sólo cuando cambia su propio campo. Con un schema asíncrono, sólo se aplica la validación más reciente, que cubre todos los campos cambiados desde la anterior.

**Errores del servidor.** Un `ClientError` con `issues` (la respuesta `400` de una entrada que no supera el schema del servidor) se reparte igual: cada mensaje en su campo y los demás en `error`. Es útil sin schema en el navegador, o cuando el servidor tiene reglas que el formulario no comprueba. Sin schema, cambiar un campo borra sus mensajes del servidor:

```ts
// app/pages/ingresar.meeko: sin schema, valida sólo el servidor
const form = useForm({
    initial: { email: "", password: "" },
    submit: (values) => api.session.post({ body: values }),
    errorMessage: (failure) => failure instanceof ClientError && failure.code === "INVALID_CREDENTIALS"
        ? "Los datos no coinciden con ninguna cuenta."
        : "No se pudo conectar con el servidor.",
});
```

```json
{ "code": "INVALID_BODY", "status": 400, "requestId": "…", "issues": [{ "path": "email", "message": "Escribe un correo válido." }, { "path": "password", "message": "Escribe tu contraseña." }] }
```

Con esa respuesta, `form.errors.value` vale `{ email: "Escribe un correo válido.", password: "Escribe tu contraseña." }`, `form.error.value` vale `null` y `form.failure.value` es el `ClientError`. Un `401` `INVALID_CREDENTIALS` deja `errors` vacío y `error` con el texto de `errorMessage`. Para marcar un campo desde el propio `submit` (por ejemplo, tras comprobar algo en el navegador), lance un `ClientError` con `issues`: `throw new ClientError("EMAIL_TAKEN", 409, undefined, [{ path: "email", message: "Ese correo ya tiene cuenta." }])`.

Desde `1.5`, el servidor también puede atribuir a un campo un error que no es de validación, como un `409` de un correo que ya existe: `new ApiError(code, status, { issues })` envía esos `issues` con la misma forma que los de un `400` (véase [Errores de un campo: `ApiError` con `issues`](#errores-de-un-campo-apierror-con-issues)), y `useForm` los reparte igual: el mensaje en `errors.value.email`, `error` en `null` y el `ClientError` del `409` en `failure`.

```ts
// server/api/signup.post.ts
export default defineApiRoute({
    body: signupInput,
    response: signupResult,
    status: 201,
    handler: async ({ body }) => {
        if (await emailTaken(body.email)) throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
        return createUser(body);
    },
});
```

`ClientError` e `isClientError` se autoimportan desde `1.5` en los componentes y en los módulos de `app/` (no en `server/`, donde se lanza `ApiError`), como `useForm`: `errorMessage: (failure) => isClientError(failure, "INVALID_CREDENTIALS") ? "…" : "…"` no necesita import.

**Otros fallos.** Un error sin `issues` pone en `error` el texto de `errorMessage(failure)` y en `failure` el error original, y `form.submit()` resuelve `undefined`. Un `ClientError` es una respuesta prevista del servidor y no se informa en otro sitio. Cualquier otro error (un fallo de red, un error de programación en `submit` o un schema que lanza) llega además al observador de errores del componente, `provideErrorHandler` o el `onError` de `mountClientApp`, con la fuente `"event"`; sin observador, se escribe en la consola. Así un fallo inesperado nunca se pierde en silencio, aunque la plantilla no muestre `error`.

**`reset` y `dirty`.** `reset()` devuelve los campos a `initial`; `reset(values)` los lleva a `initial` combinado con `values`, por ejemplo para editar un registro existente: `form.reset({ name: category.name, description: category.description })`. Esos valores pasan a ser la referencia de `dirty`. `reset` borra `errors`, `error`, `failure` y `submitted`, y descarta el resultado de una validación o un envío que siga en curso (aunque `pending` sigue en `true` hasta que termine). Como con cualquier señal, sustituya los arrays y objetos en lugar de mutarlos: `form.fields.items.value = [...form.fields.items.value, item]`.

**`commit`.** Desde `1.5`, `commit(values?)` escribe `values` en sus campos y toma los valores de todos los campos como los nuevos valores iniciales: `dirty` vuelve a `false` y un `reset()` posterior vuelve a ellos (y `reset(values)` combina `values` con ellos). A diferencia de `reset`, no borra `submitted`, `errors`, `error` ni `failure`, ni descarta un envío en curso. Sirve tras guardar, para que lo guardado sea la nueva referencia sin perder el «Guardado». Sin `values`, toma los valores actuales; si el usuario puede seguir escribiendo durante el envío, pase lo que devolvió el servidor. Con `onSuccess`, el formulario lo hace solo:

```ts
const profile = useForm({
    schema: profileInput,
    initial: { name: data.name, bio: data.bio },
    submit: (values) => api.profile.put({ body: values }),
    onSuccess: (saved, form) => form.commit({ name: saved.name, bio: saved.bio }),
});
```

```html
<p if:when="profile.submitted.value && !profile.dirty.value">Guardado.</p>
```

**Tipos.** Con `schema`, los campos tienen el tipo de la entrada del schema y `submit` recibe su salida: con un `v.transform`, el campo puede ser texto (`price: Signal<string>`) y `submit` recibir un número. Sin schema, los campos y los valores tienen el tipo de `initial`. `meeko check` comprueba `initial` contra la entrada del schema, rechaza un campo que no existe (`form.fields.nmae`) o una ruta de `errors` que no existe, y exige que el campo de un `model` tenga el tipo del control (un campo `number` no sirve para un `<input>` de texto). El tipo `Form<Values, Result>` describe el resultado, por ejemplo para pasar el formulario a un componente.

#### Componentes de campo: `FormField`

Desde `1.5`, `form.field(name)` devuelve lo que un componente de campo necesita, sin recibir el formulario entero: un `FormField<Value>` tipado por la clave del campo (`form.field("nmae")` es un error de tipos). Devuelve siempre el mismo objeto para el mismo campo, así que se puede pasar como prop en la plantilla.

| Propiedad | Valor |
| --- | --- |
| `value` | La misma `Signal` que `form.fields[name]`, para `model`. |
| `name` | El nombre del campo, para el atributo `name` (y para `focusInvalid`). |
| `id`, `errorId`, `hintId` | IDs del control, de su mensaje (`${id}-error`) y de un texto de ayuda (`${id}-hint`). Salen de [`useId`](api.md#ids-estables-useid): coinciden entre SSR e hidratación y no se repiten entre formularios. |
| `error` | Señal con el primer mensaje del campo (o de una ruta anidada, como `items.0.name`), o `undefined`. |
| `invalid` | Señal: `true` si el campo tiene algún error. |
| `describedBy` | Señal: `errorId` mientras hay error, o `undefined`; el valor de `aria-describedby`. |

```html
<!-- app/components/AppField.meeko -->
<script lang="ts">
import type { FormField } from "@meekojs/meeko/framework";
const props = defineProps<{ field: FormField<string>; label: string; hint?: string }>();
const describedBy = computed(() => [props.hint ? props.field.hintId : "", props.field.describedBy.value ?? ""].filter(Boolean).join(" ") || null);
</script>
<template>
    <div class="field">
        <label bind:for="props.field.id">{props.label}</label>
        <input bind:id="props.field.id" bind:name="props.field.name" model="props.field.value"
            bind:aria-invalid="props.field.invalid.value ? 'true' : null" bind:aria-describedby="describedBy.value">
        <p if:when="props.hint" class="field-hint" bind:id="props.field.hintId">{props.hint}</p>
        <p if:when="props.field.error.value" class="field-error" bind:id="props.field.errorId">{props.field.error.value}</p>
    </div>
</template>
```

```html
<form on:submit="form.submit" novalidate>
    <AppField bind:field="form.field('email')" label="Correo" />
    <AppField bind:field="form.field('password')" label="Contraseña" hint="Al menos 10 caracteres." />
</form>
```

**Un campo con `field` o con `model`.** Un componente de campo reutilizable puede servir dentro de un formulario, con `bind:field`, y fuera de él, con `model` o sin nada. Declare `field` opcional y el modelo por defecto con opciones sin nombre, `defineModel<string>({ default: "" })`, para que también sea opcional (véase [Modelos de componente](api.md#modelos-de-componente-definemodel-y-model)); con `defineModel<string>()`, `<AppTextField bind:field="…" />` da `TS2741` porque el modelo sería obligatorio. Elija entre los dos dentro de un `computed`:

```html
<!-- app/components/AppTextField.meeko -->
<script lang="ts">
import type { FormField } from "@meekojs/meeko/framework";
const props = defineProps<{ field?: FormField<string>; label: string; hint?: string; error?: string }>();
// Sin field, el valor es el modelo: la señal del padre (model="señal") o una propia.
const model = defineModel<string>({ default: "" });
const ownId = useId();
const id = computed(() => props.field?.id ?? ownId);
const hintId = computed(() => `${id.value}-hint`);
const errorId = computed(() => `${id.value}-error`);
const value = computed(() => props.field?.value ?? model);
const error = computed(() => props.field ? props.field.error.value : props.error);
const describedBy = computed(() => [props.hint ? hintId.value : "", error.value ? errorId.value : ""].filter(Boolean).join(" ") || null);
</script>
<template>
    <div class="field">
        <label bind:for="id.value">{props.label}</label>
        <input bind:id="id.value" bind:name="props.field?.name" model="value.value"
            bind:aria-invalid="error.value ? 'true' : null" bind:aria-describedby="describedBy.value">
        <p if:when="props.hint" class="field-hint" bind:id="hintId.value">{props.hint}</p>
        <p if:when="error.value" class="field-error" bind:id="errorId.value">{error.value}</p>
    </div>
</template>
```

```html
<form on:submit="form.submit" novalidate>
    <AppTextField bind:field="form.field('email')" label="Correo" />
</form>
<AppTextField model="query" label="Buscar" hint="Por nombre o correo." />
<AppTextField label="Notas" />
```

`model="value.value"` enlaza la señal que elige el `computed`: la del campo o la del modelo. Los IDs del campo salen de `form.field` y, sin él, de `useId`, con los mismos sufijos `-hint` y `-error` que `hintId` y `errorId`. `const value = props.field?.value ?? model` en el setup daría el aviso `MEEK101`, y con razón: el setup se ejecuta una vez y, con props reactivas, el padre puede cambiar de campo sin volver a montar el hijo (`bind:field="editing.value ? form.field('email') : form.field('phone')"`). `form.field` devuelve el mismo objeto para el mismo campo, pero la prop puede pasar a otro; dentro de un `computed`, el valor y los IDs siguen ese cambio. Use `untrack(() => props.field)` sólo si el campo de esa instancia no cambia nunca.

Para un campo de otro tipo, declare la prop con su tipo (`FormField<boolean>` en una casilla). Los IDs de `form.field` toman el prefijo de `document.idPrefix`. Llame a `useForm` en el nivel superior del script, como `useId`, para que sus IDs coincidan al hidratar.

**SSR e hidratación.** En SSR el formulario se renderiza con `initial` y nunca envía: los eventos no existen en el servidor, y `form.submit()` no hace nada si se llama mientras el script se ejecuta para producir sólo HTML (SSR o la pasada en seco de una navegación). Los campos son estado del componente que no viaja en el payload: no forman parte del estado transferido ni del que conserva HMR, porque `form` no es una señal. Al hidratar, el navegador vuelve a ejecutar `useForm` con el mismo `initial`, así que `initial` debe depender sólo de props, datos de la ruta y estado, como la entrada de un `await useApi`. Lo que el usuario escriba antes de que la página se hidrate se conserva: `model` lo copia a la señal del campo al terminar la hidratación. Desde `1.7`, con `action`, el resultado de un envío sin JavaScript sí viaja en el estado de la página, para que la hidratación pinte lo mismo que el SSR (véase [Formularios sin JavaScript](#formularios-sin-javascript-form)).

Llame a `useForm` en el nivel superior del `<script>`, como cualquier estado del componente. A diferencia de `useApi`, no tiene la restricción `MEEK054` ni admite `await`.

## WebSocket

`server/socket/chat.ts` exporta un `defineSocketChannel` con schemas separados para cada dirección. Los schemas expuestos al cliente deben venir de `shared/`. El generador emite un contrato público sin importar handlers privados. Cada evento se declara como `evento: schema` o, desde `1.2`, con la forma abreviada `{ kitchenChanged }` cuando el schema importado se llama como el evento; lo mismo vale para los campos de `defineApiRoute` y `defineRpc` (`{ body, response }`).

```ts
// server/socket/chat.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { chatInput, chatMessage } from "../../shared/schemas/chat.js";

export default defineSocketChannel({
  clientToServer: { message: chatInput },
  serverToClient: { message: chatMessage },
  auth: "required",
  authorize: ({ context, roomId }) => !!context.session.current && roomId === "general",
  handlers: { message: async ({ payload, emit }) => emit("message", payload) },
});
```

```ts
// Dentro de <script lang="ts"> de app/pages/chat/index.meeko
const chat = typeof window === "undefined" ? undefined : useSocket("chat", { roomId: "general" });
const unsubscribe = chat?.on("message", (message) => console.log(message.text));
const send = async () => chat?.emit("message", { text: "Hola", roomId: "general" });
```

Hasta `1.6`, `useSocket` sin `await` sólo podía llamarse en el navegador (en SSR lanzaba un error), de ahí la comprobación de `window`; desde `1.7`, en SSR devuelve un cliente inerte que se queda en `"connecting"` (su `on` no registra nada y su `emit` rechaza), y la comprobación ya no hace falta. Desde `1.1`, `await useSocket(...)` en el nivel superior va más allá: el setup se divide en ese punto y el resto se ejecuta sólo en el navegador, tras montar el componente y con el socket ya abierto (estado `"open"`). La plantilla sólo puede usar los nombres declarados antes del `await` (`MEEK057`), y si el socket no llega a abrirse, la continuación sigue esperando (véase [api.md](api.md#composables-de-nivel-superior-y-await)):

```html
<script lang="ts">
const messages = signal<string[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
chat.on("message", (message) => { messages.value = [...messages.value, message.text]; });
</script>
<template><p each:of="messages.value" each:as="text">{text}</p></template>
```

La firma y el contrato de `useSocket` sin `await` no cambian. `socket.chat.on(...)` y `socket.chat.emit(...)` ofrecen un registro tipado alternativo. El registro abre conexiones sólo al acceder al canal en navegador. Dentro de `mountClientApp`, cada aplicación conserva su propia conexión por canal y la cierra al desmontarse; los listeners registrados durante el setup se desuscriben al liberar su raíz. Fuera de una aplicación montada, el registro conserva su cliente compartido y el llamador debe liberar sus listeners. `useSocket` requiere una raíz de componente y libera su conexión al desmontar. Durante SSR no se abre ninguna conexión. En el navegador tampoco la abren el render que produce el HTML de un componente antes de montarlo (bajo un `if:` o al confirmar una navegación) ni las pasadas en seco: ahí `useSocket` y `socket.x` devuelven un cliente que se queda en `"connecting"`, cuyo `emit` rechaza, y la conexión la abre el montaje, una sola vez. El cliente usa WebSocket nativo, reconexión con retroceso configurable y entrega a lo sumo una vez: `emit` rechaza si está desconectado, sin cola ni reenvío. Los mensajes entrantes inválidos cierran el canal; un error del transporte se informa una vez por conexión activa y los errores de conexiones reemplazadas se ignoran. Un listener u observador de `state` que falle se informa sin impedir la ejecución de los demás listeners ni salir del callback del transporte. El cliente de bajo nivel acepta `onError(error)` para observar estos fallos; sin callback de aplicación o componente, los registra en la consola.
El registro `socket` es de alcance de aplicación: cancele listeners con la función que devuelve `on` y cierre el canal cuando ya no se necesite.

**Rechazo de autenticación o autorización.** Desde `1.1`, cuando el servidor rechaza la sesión, el cliente no reintenta: su `state` pasa al estado terminal `"unauthorized"`, deja de escuchar y el observador de errores recibe un `ClientError` con `status` `401` (código `UNAUTHENTICATED`) o `403` (`FORBIDDEN`), no el error genérico del transporte. Lo detecta en los códigos de cierre `4401` y `4403`, en el código de política del hub (`1008`, con el motivo `Unauthorized`, `Session expired` o `Session revoked`) y en un handshake rechazado con `401` o `403` cuando la implementación de `WebSocket` expone el estado HTTP, como el paquete `ws` en Node mediante `webSocketFactory`. `close()` pasa un cliente `"unauthorized"` a `"closed"`; para volver a intentarlo, cree otro cliente (en un componente, al volver a montarlo).

**Cierres `4401` y `4403` del handshake.** El `WebSocket` del navegador (y el global de Node) no expone el estado HTTP de un handshake rechazado, así que desde `1.1` los adaptadores de Meeko no responden con `401` ni `403` a un rechazo de sesión o de autorización del canal. Si la comprobación previa del hub rechaza la sesión (un canal `auth: "required"` sin sesión, `401`) o la autorización (`authorize` devuelve `false`, `403`), el servidor acepta el upgrade y cierra en seguida con `4401` (motivo «Autenticación requerida») o `4403` («Acceso denegado»). No llama a ningún handler ni entrega mensajes, y el motivo es un texto fijo, sin datos de la sesión. El cliente llega así a `"unauthorized"` también en el navegador, sin reintentar. Como el upgrade se completa, `state` puede pasar un instante por `"open"` antes del cierre, y un `emit` hecho en ese momento se descarta. Un hub que vuelve a autorizar una conexión ya aceptada, como el Durable Object de una sala al despertar, cierra del mismo modo con `4401` o `4403`.

Los demás rechazos del handshake mantienen su respuesta HTTP, que el navegador ve como un fallo de red y reintenta con retroceso: nombre de canal inválido, método o petición que no es de upgrade (`400`), canal inexistente (`404`), los límites (como `431` en Cloudflare) y el Origin no permitido (`403` `INVALID_ORIGIN`). El Origin es una política de la petición, no la autorización del canal: un origen ajeno nunca completa un upgrade ni llega a la comprobación de la sesión, de modo que tampoco puede distinguir un `4401` de un `4403`.

`serveNode` conecta `attachNodeWebSocketServer` al mismo servidor HTTP cuando la aplicación declara canales. El adaptador Node usa `ws` para framing y upgrades; Bun usa el WebSocket nativo de `Bun.serve` y Deno `Deno.upgradeWebSocket` (véanse sus límites en [Bun](#bun) y [Deno](#deno)), y Cloudflare Workers aloja cada sala en un Durable Object con hibernación (véase [Cloudflare Workers](#cloudflare-workers)). Todos comparten `createSocketUpgradeHandler`, que comprueba ruta, Origin y sesión antes del upgrade y devuelve `{ action: "reject", status, close }` en los rechazos de sesión o autorización. Un adaptador propio que atiende `close` hace el upgrade y cierra con `close.code` y `close.reason`; uno escrito para `1.0`, que lo ignora, sigue respondiendo `status`. El hub existente valida Origin, sesión, canal, sala, evento y payload; aplica límites de mensaje/buffer, heartbeat y cierre ordenado. Tras un proxy, el mismo `publicOrigin` de `server/runtime.ts` o `MEEKO_PUBLIC_ORIGIN` rige la comprobación de Origin de HTTP y de Socket.

### Clientes con URL y contrato explícitos

El autoimport `useSocket("canal", opciones)` cubre los canales de la propia aplicación. Para otra URL o un contrato propio, `@meekojs/meeko/framework` ofrece dos funciones con la firma `(url, contract, options)`:

- `useSocketClient` (desde `1.1`) liga el cliente a la raíz del componente actual, igual que el autoimport: no conecta en SSR (desde `1.7` devuelve ahí un cliente inerte; hasta `1.6` lanzaba) ni en un render que sólo produce HTML, usa el observador de errores más cercano y cierra la conexión al desmontar. Admite `await useSocketClient(...)` en el nivel superior del `<script>`.
- `createSocketClient` crea un cliente independiente, también fuera de un componente; el llamador lo cierra con `close()`.

```ts
import { useSocketClient } from "@meekojs/meeko/framework";

// Dentro de <script lang="ts"> de un componente
const feed = await useSocketClient("wss://feed.example.com/_meeko/socket/prices", pricesContract);
feed.on("price", (price) => console.log(price.symbol, price.value));
```

Hasta `1.0` esta función se exportaba como `useSocket` desde `@meekojs/meeko/framework`, con el mismo nombre que el autoimport generado y otra firma. Ese export sigue disponible como alias obsoleto de `useSocketClient` (es la misma función) durante toda la serie 1.x y se retirará en `2.0`. El autoimport `useSocket("canal")` de los clientes generados no está obsoleto. En un proyecto sin clientes generados, el autoimport `useSocket` resuelve a `useSocketClient`.

### Broadcast desde el servidor

Desde `1.2`, el autoimport `socket` del código de servidor (API, RPC, `<script server>`, middleware y handlers de Socket) añade a cada canal `broadcast(roomId, event, payload)`, tipado con el contrato generado del canal. Sustituye a publicar a mano en el `SocketPubSub` del runtime, que no comprueba el evento ni el payload:

```ts
// server/socket/operations.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { kitchenChanged, subscribe } from "../../shared/schemas/operations.js";

export default defineSocketChannel({
  clientToServer: { subscribe },
  serverToClient: { kitchenChanged },
});
```

```ts
// server/api/orders/[id]/ready.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { orderParams, orderSchema } from "../../../../shared/schemas/order.js";
import { markReady } from "../../../utils/orders.js";

export default defineApiRoute({
  params: orderParams,
  response: orderSchema,
  handler: async ({ params }) => {
    const order = await markReady(params.id);
    await socket.operations.broadcast(order.storeId, "kitchenChanged", { orderId: order.id, status: "ready" });
    return order;
  },
});
```

- **Mismas comprobaciones que `hub.broadcast`.** El hub valida con la definición del canal: un evento que no está en `serverToClient` rechaza con `UNKNOWN_SOCKET_EVENT` (404), un payload que no cumple su schema con `INVALID_SOCKET_PAYLOAD` (400) y un mensaje serializado mayor que `socket.maxMessageBytes` con `SOCKET_LIMIT_EXCEEDED` (413), siempre antes de publicar. Se resuelve cuando el broker acepta el mensaje; véase [Broadcast y varias instancias](#broadcast-y-varias-instancias). Dentro de un handler de API o RPC, un rechazo no capturado es la respuesta de error, con ese código y estado.
- **Sala.** `roomId` es la sala de `?room=`; las conexiones sin sala usan `""`.
- **Qué hub.** `broadcast` publica en el hub de la aplicación que atiende la petición HTTP en curso, también desde su trabajo asíncrono (como `platform.waitUntil` o un temporizador iniciado en la petición), o en el hub del handler de Socket en curso. Funciona igual en Node, Bun, Deno y Cloudflare Workers, donde el broker es el Durable Object de cada sala.
- **Fuera de una petición.** Una tarea que empieza al arrancar, fuera de cualquier petición, no tiene aplicación actual y `broadcast` lanza un error. Cree un registro con el hub explícito: `createServerSocketRegistry(socketContracts, { hub: () => app.socket?.hub })` de `@meekojs/meeko/server`, o use `app.socket.hub.broadcast(canal, sala, evento, payload)` sin tipos.
- **Sólo servidor.** En el navegador `socket.<canal>` sigue siendo el cliente WebSocket y no tiene `broadcast`. En el servidor, `on`, `emit`, `state` y `close` de `socket.<canal>` lanzan un error, porque durante SSR no hay conexión. Hasta `1.1`, leer `socket.<canal>` en el servidor ya lanzaba ese error.

### Broadcast y varias instancias

`hub.broadcast(channel, room, event, payload)` valida el evento y el payload, y se resuelve cuando el broker acepta el mensaje. No espera a que lleguen a los peers ni informa de sus fallos al emisor. Sólo rechaza si el evento no existe, el payload no cumple su schema, el mensaje es demasiado grande o el broker no acepta la publicación.

- **`broadcast` rechaza por tamaño.** El mensaje se mide ya serializado con `serializeJson`, que escribe `<`, `>` y `&` como secuencias de 6 bytes; si supera `maxMessageBytes` del hub (64 KiB por defecto), `broadcast` rechaza con `SOCKET_LIMIT_EXCEEDED` (413) antes de publicar y ningún peer se cierra. Así, un mensaje de cliente de unos 11 KB lleno de `<` no puede reenviarse tal cual. Un receptor con un `maxMessageBytes` menor que el del emisor sigue cerrando su peer con `1009`.
- **Entrega a lo sumo una vez por peer.** No hay reenvío: un mensaje publicado mientras una instancia está desconectada del broker se pierde. Cada peer recibe los mensajes de una instancia en el orden de llegada.
- **Cola acotada por peer.** Las entregas a un peer se procesan de una en una. Si un peer acumula más de `maxPendingDeliveries` entregas pendientes (256 por defecto, contando la que está en curso), se cierra con `1013` ("try again later") y el error `SOCKET_BACKLOG_EXCEEDED` (503) llega a `onDeliveryError`, en lugar de crecer la memoria sin límite.
- **Comprobaciones en el receptor.** Cada instancia receptora vuelve a validar el payload con el schema y ejecuta `authorize` y `authorizeSend` antes de enviar a cada peer local. La sesión no se relee en cada entrega: una revocación cierra el peer de inmediato mediante `SessionHandle.signal`, y el resto de cambios (caducidad, rotación o un borrado sin aviso) se detecta al releer el store, como mucho una vez cada `sessionRefreshMs` por peer (1000 ms por defecto; `0` relee en cada entrega). Cada evento del cliente relee siempre la sesión.
- **`authorizeSend` filtra.** Si devuelve `false`, ese peer no recibe el broadcast y sigue conectado. En un `emit` directo, el mismo rechazo lanza `FORBIDDEN`.
- **Un peer que falla se cierra.** Puede fallar por sesión caducada, `authorize` rechazado, límite de tamaño, cola llena o error de envío. El peer se cierra con `1008` (fallo de política), `1009` (tamaño), `1013` (cola llena) o `1011` (error interno) y se desuscribe. El error llega a `SocketHubOptions.onDeliveryError(error, { channel, room, event })` de la instancia que tiene ese peer. Un payload que no cumple el schema en el receptor se descarta y se informa sin cerrar al peer.
- **Observador por defecto.** `createServerApp` envía `onDeliveryError` al `onError` del runtime con un ID nuevo; `socket.onDeliveryError` de `server/runtime.ts` lo sustituye. Sin observador, el hub usa `console.error`.

`LocalSocketPubSub` cubre una sola instancia, y su `publish` también espera los intentos de entrega locales. Desde `1.7`, una aplicación de producción con canales que no declara `socket.pubsub` avisa una vez de que usa este broker; con una sola instancia, declare `new LocalSocketPubSub()` para quitar el aviso. Para varias instancias o procesos, use `RedisSocketPubSub`:

```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  const subscriber = redis.duplicate(); // conexión dedicada en modo suscriptor
  await subscriber.connect();
  return {
    sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber }), production: production && !prerendering }),
    socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:" }) },
    close: async () => { await subscriber.quit(); await redis.quit(); },
  };
});
```

- **Clientes.** `publisher` y `subscriber` siguen la interfaz de node-redis 4 o posterior (`publish`, `subscribe(channel, listener)`, `unsubscribe(channel, listener)`); el suscriptor necesita su propia conexión. La aplicación abre y cierra ambos clientes.
- **Canales Redis.** Cada par canal/sala usa el canal `<prefix>socket:<canal>:<sala>`, con canal y sala codificados con `encodeURIComponent`. Cada instancia se suscribe una sola vez por sala mientras tenga peers locales en ella y se desuscribe al irse el último. `hub.accept` se resuelve cuando Redis confirma la suscripción.
- **Formato.** El mensaje viaja como `{ v: 1, event, payload }`, serializado con `serializeJson`. `publish` rechaza con `SOCKET_LIMIT_EXCEEDED` (413) los mensajes de más de `maxMessageBytes` (1 MiB por defecto) antes de enviarlos a Redis. El receptor descarta los mensajes mal formados o con otra versión y los informa a `onError` de `RedisSocketPubSub` (por defecto, `console.error`).
- **Redis Cluster.** Con Redis 7 o posterior, `sharded: true` usa `SPUBLISH`/`SSUBSCRIBE`/`SUNSUBSCRIBE`, que en un clúster mantienen cada sala dentro de su shard. Los clientes deben ofrecer `sPublish`, `sSubscribe` y `sUnsubscribe`.

Una implementación propia de `SocketPubSub` debe cumplir el mismo contrato:

- `publish(channel, room, { event, payload })` se resuelve cuando el broker acepta el mensaje.
- `subscribe(channel, room, listener)` devuelve, o promete, una función `Unsubscribe` que puede ser asíncrona.
- Los listeners del hub nunca rechazan, así que el broker no debe agregar sus errores.

## Runtime de servidor

`server/runtime.ts` exporta por defecto `defineServerRuntime(factory)`. Meeko llama a la fábrica una vez por proceso con `{ env, production, platform, prerendering }` y espera los recursos de la aplicación:

```ts
import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";
import { createDatabase } from "./utils/database.js";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const db = await createDatabase(env.DATABASE_URL);
  return {
    sessions: new SessionManager({ store: db.sessionStore(), production: production && !prerendering }),
    services: (request, { platform }) => ({ db, region: platform.env.REGION }),
    socket: { allowedOrigins: [], maxMessageBytes: 64 * 1024 },
    publicOrigin: env.MEEKO_PUBLIC_ORIGIN,
    onError: (error, requestId) => console.error("request failed", requestId, error),
    close: () => db.close(),
  };
});
```

- `sessions` es opcional desde `1.2`. Sin `server/runtime.ts`, o si no devuelve `sessions`, Meeko las crea: en memoria en desarrollo y en Redis con `MEEKO_REDIS_URL` en producción (véase [Sesiones sin configuración](#sesiones-sin-configuración)). Unas `sessions` explícitas siempre ganan.
- `services` puede ser un objeto compartido o una función por petición; llega a páginas, API, RPC y Socket como `RequestContext.services`. Desde `1.7` su tipo se infiere de este archivo, sin conversiones (véase [Tipos de los servicios](#tipos-de-los-servicios)).
- `RequestContext.platform` expone `{ name, env, waitUntil(promise) }`. En Node, `serveNode` espera las tareas registradas con `waitUntil` antes de cerrar la aplicación. Las tareas registradas fuera de una petición HTTP, como en callbacks de Socket, quedan a cargo de la aplicación: `app.close()` las espera y sus fallos llegan al observador `onError` del runtime en lugar de la consola.
- `publicOrigin` es el origen público de la aplicación, por ejemplo `https://example.com` tras un proxy que termina TLS. HTTP y Socket comparan `Origin` con ese valor; `MEEKO_PUBLIC_ORIGIN` lo sustituye en `meeko dev` y en las salidas de Node, Bun, Deno y Workers. Sin `publicOrigin`, Socket usa la dirección en la que escucha el servidor. Si esa dirección o el `publicOrigin` es de loopback, Socket acepta también los otros nombres de loopback (`localhost`, `127.0.0.1`, `[::1]`) con el mismo esquema y puerto. Esto supone que ningún otro proceso escucha en ese puerto con otra dirección de loopback; si ocurre, configure `publicOrigin` con un origen que no sea de loopback o cambie el puerto.
- `onError` recibe los fallos internos con su ID de petición; sin él, Meeko registra el nombre del error y el ID, y en desarrollo también el error completo. También recibe los fallos de entrega de Socket, salvo que `socket.onDeliveryError` los observe por separado, y, desde `1.3`, las promesas rechazadas sin manejar y las excepciones no capturadas del proceso, con un tercer argumento (véase [Errores](#errores)).
- `processErrors` (desde `1.3`) decide qué pasa con esos fallos del proceso; sin declararlo, un rechazo se informa y el servidor sigue atendiendo, y una excepción se informa y el servidor se cierra de forma ordenada con código 1 (véase [Fallos fuera de una petición](#fallos-fuera-de-una-petición)).
- `socket.pubsub` elige el broker de broadcast; `socket.maxPendingDeliveries` y `socket.sessionRefreshMs` limitan la cola de cada peer y la frecuencia con que sus entregas releen la sesión. Véase [Broadcast y varias instancias](#broadcast-y-varias-instancias).
- `close` se ejecuta después de cerrar las sesiones, al detener el servidor.

`createServerApp({ manifest, load, runtime, production })` de `@meekojs/meeko/server` crea la misma aplicación a partir de un manifiesto y un cargador de módulos, y expone `fetch(request, platform?)`, `socket`, `publicOrigin`, `reportError` y `close()`. El entry generado por `meeko build` la usa; un host propio puede servirla con `serveNode(app, { host, port, publicOrigin, handleSignals, shutdownTimeout })` de `@meekojs/meeko/node`. Si el servidor arranca pero falla la conexión de Socket, `serveNode` libera el puerto y cierra la aplicación antes de propagar el error.

### Tipos de los servicios

Desde `1.7`, `context.services` tiene el tipo de lo que devuelve `server/runtime.ts`, sin `as unknown as MisServicios`. `meeko check`, `meeko dev` y el editor generan `.meeko/types/services.d.ts`, que amplía la interfaz `GeneratedServices` de `@meekojs/meeko/server` con el tipo de `services` del export por defecto: el objeto compartido o, si `services` es una función por petición, lo que ésta devuelve (sin la promesa). El tipo resultante se llama `AppServices`:

```ts
// server/runtime.ts
export default defineServerRuntime(async ({ env }) => {
  const db = await createDatabase(env.DATABASE_URL);
  return { services: { db, search: createSearch(db) }, close: () => db.close() };
});

// server/utils/docs.ts
import type { RequestContext } from "@meekojs/meeko/server";
export const findDoc = (context: RequestContext, slug: string) => context.services.db.docs.find(slug); // tipado
```

- **Dónde.** En `usePage().context` del `<script server>`, en los handlers, `authorize`, `locals` y `rateLimit.key` de `defineApiRoute` y `defineRpc`, en `defineSocketChannel`, en `defineServerRouteMiddleware` (`services` y `context.services`) y en cualquier `RequestContext` escrito sin argumento. `defineServerMiddleware` no recibe contexto: se ejecuta antes de que exista. El `context` opcional del `load` de `definePage` sigue siendo el tipo `C` de sus argumentos de tipo.
- **Cómo se resuelve.** `RequestContext<TServices>` usa `AppServices` cuando `TServices` es `unknown`, el valor por defecto; un tipo escrito (`RequestContext<MisServicios>`, `defineServerRouteMiddleware<MisServicios>`) o `any` siguen ganando. Sin `server/runtime.ts`, con uno en JavaScript o sin `services`, `AppServices` es `unknown`, como hasta `1.6`. Una conversión `as unknown as MisServicios` sigue compilando; una conversión directa a un tipo incompatible con el inferido pasa a ser un error, porque lo es.
- **Tests y contextos con otros servicios.** `RequestContext` compara por su tipo de servicios, así que un contexto con cualquier otro (el de un test, `createRequestContext(request, { db: falso }, session)`) se sigue aceptando donde se espera un `RequestContext` sin argumento, como el handler de una ruta sin tipo escrito, igual que en `1.6`. A cambio, para recibir el contexto de una ruta en una función, escriba `RequestContext` sin argumento (sus `services` ya son `AppServices`): `RequestContext<AppServices>` no acepta el `RequestContext` de una ruta sin tipo.
- **Autoimports.** La declaración lee una copia de `server/runtime.ts` en `.meeko/types/server-runtime.ts` con sus autoimports de servidor escritos como imports, así que `defineServerRuntime` sin importar funciona también en el editor. La copia lleva `// @ts-nocheck`: los errores se informan una sola vez, en `server/runtime.ts`. Se regenera con cada `meeko check`, al arrancar `meeko dev` y en las comprobaciones del editor.
- **Host propio.** Sin las declaraciones generadas, amplíe `GeneratedServices` a mano en un `.d.ts` de `server/`, como `MeekoSession`: `interface GeneratedServices { readonly services: MisServicios }`. `ServerRuntimeServices<typeof runtime>` calcula ese tipo a partir de una definición de runtime.
- **Límites.** Es un tipo, no valida en ejecución. Si un servicio menciona `RequestContext` en su propio tipo, TypeScript puede encontrar una referencia circular; escriba entonces `RequestContext<MisServicios>` en ese punto.

## Errores

Ningún fallo se pierde sin pasar por un observador de Meeko: cada nivel tiene el suyo, y lo que un nivel no atiende sube al siguiente o, sin observador, a la consola, como sin Meeko.

| Nivel | Qué captura | Observador | Política |
| --- | --- | --- | --- |
| Componente | Handlers `on:`, `effect`, limpiezas, `onMounted`, la continuación de un setup con `await`, formularios, mutaciones y `useStorage` de ese componente y sus hijos. | `provideErrorHandler((error, source) => …)` en el `<script>`; el más cercano gana ([Middleware de rutas y servidor](#middleware-de-rutas-y-servidor), [api.md](api.md#componentes-meeko)). | Observa sin cambiar la interfaz. Sin proveedor, sube a la aplicación. |
| Aplicación (navegador) | Lo anterior sin un proveedor más cercano, la navegación, los clientes Socket y, desde `1.3`, las excepciones no capturadas (`"uncaught"`) y las promesas rechazadas sin manejar (`"rejection"`) de la página. | `mountClientApp({ onError })` y `app.onError` de los plugins ([Plugins de aplicación](#plugins-de-aplicación)); `onNavigationError` tiene prioridad para la navegación. | Sin ninguno, la navegación, Socket y los fallos globales van al primer `provideErrorHandler` activo; sin él, a la consola. |
| Página (SSR) | Un fallo del loader, de `<script server>`, del render (también `render: "stream"` antes del primer byte) o de un `await` de datos. | `+error.meeko` más cercano o `app/error.meeko` ([Página de error de la aplicación](#página-de-error-de-la-aplicación-apperrormeeko)), y el `onError` del runtime y de los plugins con el `requestId` de la respuesta. | El HTML muestra el estado y un mensaje público; un `5xx` se informa con su error privado. Un diferido rechazado de un stream se envía como `{ code, status }` y su causa llega a los mismos observadores ([Streaming SSR](#streaming-ssr-render-stream)). |
| API y RPC | Lo que lanzan los handlers, `auth`, `authorize`, `locals` y las validaciones. | Respuesta normalizada: `ApiError` conserva `code` y `status`, todo lo demás es `INTERNAL_ERROR`, con `requestId` y `x-request-id` ([API y RPC](#api-y-rpc)). En el cliente, `ClientError` (`isClientError(error, "CODIGO")` desde `1.3`). | Sólo los `5xx` llegan a `onError` del runtime; los `4xx` son respuestas previstas. |
| Runtime del servidor | Los `5xx` de páginas, API, RPC, Socket, `waitUntil` y el transporte, y desde `1.3` los fallos del proceso. | `onError` de `server/runtime.ts` ([Runtime de servidor](#runtime-de-servidor)). | Nunca cambia la respuesta; un observador que falla se registra sin detalles privados. |
| Proceso (desde `1.3`) | Promesas rechazadas sin manejar y excepciones no capturadas fuera del flujo de una petición. | `onError` del runtime, con `{ kind, inRequest }` como tercer argumento. | `processErrors`; véase [Fallos fuera de una petición](#fallos-fuera-de-una-petición). |

`ErrorSource`, el segundo argumento de los observadores del navegador, gana `"uncaught"` y `"rejection"` en `1.3`. Es una unión que Meeko entrega a la aplicación, así que, según la [política de estabilidad](stability.md#api-pública), un `switch` exhaustivo sobre ella necesita una rama por defecto.

```ts
import { isClientError, mountClientApp } from "@meekojs/meeko/framework";

await mountClientApp({
  ...options,
  onError(error, source) {
    if (isClientError(error, "UNAUTHENTICATED")) return location.assign("/login");
    navigator.sendBeacon("/api/client-errors", JSON.stringify({ source, message: String(error) }));
  },
});
```

### Fallos globales del navegador

Mientras una aplicación está montada, `mountClientApp` escucha `error` y `unhandledrejection` en `window`: un `setTimeout` que lanza, un `fetch().then()` sin `catch` en el setup o el fallo de una librería llegan a `onError` y a `app.onError` con la fuente `"uncaught"` o `"rejection"`. El primer argumento es el error lanzado o el motivo del rechazo, tal cual.

- **Sin duplicados.** Un error que ya recibió un observador de Meeko (un evento, una navegación…) y que la aplicación vuelve a lanzar o deja rechazado no se informa otra vez.
- **Consola.** Cuando un observador lo recibe, Meeko llama a `preventDefault()` y el navegador no lo repite en la consola. Sin ningún observador, el evento no se toca y el navegador lo muestra como siempre. Un evento que otro listener ya marcó con `preventDefault()` se considera atendido.
- **Scripts de otro origen.** El `"Script error."` opaco de un script de otro origen cargado sin CORS no trae error, archivo ni línea: se deja a la consola. Para observarlo, cargue el script con `crossorigin` y sirva `Access-Control-Allow-Origin`.
- **Ciclo de vida.** Los listeners se registran al hidratar y se retiran con `app.dispose()` o si la hidratación falla. Un cambio de un componente con HMR no vuelve a montar la aplicación; un cambio de la entrada recarga la página. Con dos aplicaciones en la misma página, sólo la primera que lo observa recibe cada fallo.

### Fallos fuera de una petición

En el servidor, una promesa que nadie espera dentro de un handler, un `setTimeout` que lanza o el callback de una librería quedan fuera del `try` de la petición. Sin una política, Node 15+, Bun y Deno terminan el proceso con el primer rechazo sin manejar o la primera excepción no capturada, sin pasar por `onError` ni cerrar el servidor de forma ordenada. Desde `1.3`, `meeko dev`, las salidas de `meeko build` (Node, Bun, Deno y Cloudflare Workers) y `serveNode` y `serveDeno` con `handleSignals` aplican la política `processErrors` de `server/runtime.ts`:

| Fallo | Por defecto | Otras opciones |
| --- | --- | --- |
| `unhandledRejection` | `"report"`: llega a `onError` y el servidor sigue atendiendo. | `"shutdown"`: además, cierre ordenado con código 1. `"off"`: el runtime decide (en Node, el rechazo pasa a ser una excepción no capturada). |
| `uncaughtException` | `"shutdown"`: llega a `onError`, el servidor deja de aceptar conexiones, espera las respuestas abiertas y las tareas de `waitUntil`, cierra la aplicación y sale con código 1, porque el estado del proceso ya no es fiable. | `"off"`: el runtime decide. |

```ts
// server/runtime.ts
export default defineServerRuntime(() => ({
  processErrors: { unhandledRejection: "shutdown" },
  onError(error, requestId, info) {
    if (info) logger.fatal({ kind: info.kind, inRequest: info.inRequest, requestId }, error);
    else logger.error({ requestId }, error);
  },
}));
```

- **Observador.** El `onError` del runtime recibe el error, un ID y `{ kind, inRequest }` (tipo `ServerErrorInfo`); los fallos de una petición no llevan ese tercer argumento. Sin `onError`, Meeko escribe en la consola el error completo, como haría el runtime. `processErrors: false` desactiva los dos casos.
- **`requestId`.** Si el fallo ocurre en el trabajo asíncrono de una petición y el runtime conserva ese contexto hasta el evento, el ID es el de la respuesta (`x-request-id`) e `inRequest` es `true`; si no, el ID es nuevo. Node conserva el contexto para rechazos y excepciones; Deno y workerd, para los rechazos; Bun 1.4, sólo para las excepciones.
- **Listeners de la aplicación.** Si la aplicación registró sus propios `process.on("uncaughtException" | "unhandledRejection")` (o, en Deno, marcó el evento con `preventDefault()` antes), Meeko informa a `onError` y deja que ella decida: no cierra el proceso.
- **Por runtime.** Node y Bun usan los eventos de `process`; Deno, `unhandledrejection` y `error` de `globalThis`. En Cloudflare Workers no hay proceso que cerrar: los rechazos sin manejar del aislado llegan a `onError` y una excepción hace fallar sólo la petición o la tarea de `waitUntil` que la lanzó, que Meeko ya informa. En `meeko dev`, un rechazo de la aplicación no detiene el servidor de desarrollo; la política es la del runtime con el que arrancó.
- **Hosts propios.** `handleProcessErrors(app, { close, onError?, shutdownTimeout? })` de `@meekojs/meeko/server` aplica la misma política a un host que no usa `serveNode` ni `serveDeno`, como `Bun.serve` con `createBunServer`; devuelve la función que retira los listeners. `close` debe detener el servidor y cerrar la aplicación; `shutdownTimeout` (15 s por defecto) limita su duración antes de salir igualmente. Desde `1.7` se instala una sola vez por aplicación: una segunda llamada (por ejemplo, la propia junto a `serveNode` con `handleSignals`) no añade listeners y, si sus opciones son distintas, se ignoran con un aviso en la consola.

## Autenticación

Desde `1.2`, Meeko se ocupa de las piezas delicadas de un inicio de sesión: cookie opaca `HttpOnly`, `Secure` y host-only, sesiones en Redis entre instancias con revocación, Origin y CSRF, contraseñas con scrypt, límite de intentos y tipos de la sesión. La aplicación sólo decide quién puede entrar. Un panel privado para una cuenta queda así:

**1. Variables** (`.env` en desarrollo, ignorado por git; en producción, las del entorno):

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com       # el origen exacto tras el proxy HTTPS
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_TRUST_PROXY=1                           # un proxy (Traefik, Caddy, nginx) delante
ADMIN_USERNAME=ada
ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…       # npx meeko auth hash
```

Las dos últimas son de la aplicación, sin el prefijo `MEEKO_`, que queda reservado. Instale el cliente Redis con `npm install redis`; en desarrollo las sesiones viven en memoria y no hace falta Redis. No hay `server/runtime.ts`: véase [Sesiones sin configuración](#sesiones-sin-configuración).

**2. El tipo de la sesión**, una sola vez para páginas, API, RPC y Socket:

```ts
// server/types/session.d.ts
import type {} from "@meekojs/meeko/server";
declare module "@meekojs/meeko/server" {
  interface MeekoSession { user: string; role: "owner" }
}
```

**3. Inicio y cierre de sesión:**

```ts
// server/api/auth/login.post.ts
import { verifyPassword } from "@meekojs/meeko/password";
import { loginInput, okResult } from "../../../shared/schemas/auth.js";

export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ body, context }) => {
    const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? "");
    if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.session.create({ user: body.username, role: "owner" });
    return { ok: true as const };
  },
});
```

```ts
// server/api/auth/logout.post.ts
export default defineApiRoute({
  auth: "required",
  status: 204,
  handler: async ({ context }) => { await context.session.revoke(); },
});
```

`verifyPassword` se ejecuta siempre, también con un usuario incorrecto, para que el tiempo de respuesta no revele cuál de los dos falló. `defineApiRoute` y `ApiError` se autoimportan en `server/`. Desde el navegador, `await api.auth.login.post({ body })` y `await api.auth.logout.post()`: el cliente envía Origin y el token CSRF.

**4. Una página protegida:**

```html
<!-- app/pages/dashboard.meeko -->
<script server lang="ts">
const { context } = usePage();
const session = context.session.current;
if (session?.data.role !== "owner") redirect("/login");
export const user = session.data.user;
</script>

<template>
  <h1>Hola, {user}</h1>
</template>
```

Lo que hace Meeko por usted en este ejemplo:

- La cookie `__Host-meeko.sid` es opaca, `HttpOnly`, `Secure`, `SameSite=Lax` y host-only; `MEEKO_SESSION_TTL` y `MEEKO_SESSION_SAMESITE` la ajustan. El ID cambia al iniciar sesión y la familia completa se revoca al cerrarla, también en las demás instancias.
- `origin: "required"` y, aunque falte, el propio `session.create()` impiden el *login CSRF* (véase [Origin en mutaciones anónimas](#origin-en-mutaciones-anónimas)); `auth: "required"` y el token CSRF protegen el cierre de sesión.
- `rateLimit` cuenta los intentos por IP en Redis (o, sin Redis, en SQL; véase [Rate limit en SQL](#rate-limit-en-sql)), y `MEEKO_TRUST_PROXY` hace que la IP sea la del cliente y no la del proxy.
- `verifyPassword` compara en tiempo constante y acepta los hashes que ya tenga con el mismo formato.

### Tipos de la sesión: `MeekoSession`

Sin declaración, `context.session.current.data` es `unknown`, como hasta `1.1`, y `session.create(data)` acepta cualquier valor serializable. Desde `1.2`, una aumentación de módulo de la interfaz `MeekoSession` de `@meekojs/meeko/server` fija la forma en toda la aplicación: `RequestContext.session` pasa a ser `SessionHandle<MeekoSession>`, así que `context.session.current?.data` y `create(data)` quedan tipados en el `<script server>` de las páginas (`usePage().context`), en API, RPC y Socket, y en `authorize` y `locals`. El tipo resultante se llama `SessionData`. Declárela en un archivo `.d.ts` de `server/` (por ejemplo, `server/types/session.d.ts`), que `meeko check` y el editor incluyen en todos los proyectos, y empiece por `import type {} from "@meekojs/meeko/server";`: así el archivo es un módulo y TypeScript carga siempre el módulo que amplía, aunque el código que lee la sesión sólo importe `@meekojs/meeko/framework` (con `export {}` la aumentación se perdería en esos archivos). El tipo no valida en ejecución: si cambia la forma, las sesiones guardadas antes conservan la anterior hasta que caducan o se crean de nuevo.

### Contraseñas

`@meekojs/meeko/password` (desde `1.2`) guarda y comprueba contraseñas con scrypt:

- `hashPassword(password)` devuelve `scrypt$<N>$<r>$<p>$<sal>$<hash>`, con N = 2^17, r = 8, p = 1 (128 MiB por cálculo), una sal aleatoria de 16 bytes y una clave de 32, ambas en base64url. El formato describe sus propios parámetros, así que un hash guardado sigue siendo válido aunque cambien los valores por defecto.
- `verifyPassword(password, hash)` recalcula con los parámetros del hash y compara en tiempo constante (`timingSafeEqual`). Acepta los hashes escritos a mano con el mismo formato, como `scrypt$131072$8$1$…` con una sal de 32 bytes y una clave de 64, sin regenerarlos. Un hash mal formado o con parámetros fuera de los límites (N potencia de dos entre 2^10 y 2^20, `r` hasta 32, `p` hasta 16) lanza `TypeError`: es un fallo de configuración, no una contraseña incorrecta. Una contraseña vacía o de más de 4096 bytes devuelve `false` sin calcular nada.
- `needsRehash(hash)` indica si el hash usa parámetros más débiles que los actuales; tras un inicio de sesión correcto, guarde `await hashPassword(password)` en su lugar.

Como mucho se calculan dos hashes a la vez por proceso, para acotar la memoria (256 MiB) y no ocupar todos los hilos de `libuv`; combine el inicio de sesión con [`rateLimit`](#límite-de-peticiones-ratelimit). Cuando el usuario no existe, compare igualmente contra un hash fijo para que el tiempo de respuesta no revele qué cuentas existen.

**Por qué una subruta aparte.** Web Crypto, la única criptografía de `@meekojs/meeko/server`, no ofrece funciones de derivación costosas en memoria (scrypt, Argon2), y una implementación en JavaScript sería decenas de veces más lenta, lo que obliga a bajar el coste. `node:crypto` las implementa en código nativo y existe en Node, Bun y Deno, así que `/password` lo importa y `/server` sigue siendo portable (Web APIs y `node:async_hooks`). No vale para Cloudflare Workers: aunque `nodejs_compat` ofrece scrypt, los 128 MiB de un cálculo con estos parámetros agotan la memoria de un aislado; en Workers, delegue la verificación en un servicio externo.

Para obtener un hash sin escribir código:

```sh
npx meeko auth hash                       # pide la contraseña dos veces, sin mostrarla
printf '%s' "$PASSWORD" | npx meeko auth hash   # o la lee de stdin
```

El comando escribe en stdout sólo la línea del hash, lista para `.env` (`ADMIN_PASSWORD_HASH=…`); los avisos van a stderr.

### Límite de peticiones: `rateLimit`

Desde `1.2`, `defineApiRoute` y `defineRpc` aceptan `rateLimit: { limit, window, key? }`: como mucho `limit` peticiones por ventana fija de `window` (milisegundos o un texto como `"30s"`, `"5m"`, `"1h"`). La petición que lo supera recibe `429 RATE_LIMITED` con `Retry-After` (segundos hasta la ventana siguiente), sin validar la entrada ni ejecutar el handler. Se comprueba tras Origin y CSRF y antes de `auth`, `authorize`, la entrada y `locals`, así que también frena a los clientes anónimos.

```ts
export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ body, context }) => { /* … */ },
});
```

- **Clave.** Sin `key`, cada IP de cliente tiene su contador por ruta (las IPv6 por su red /64, porque un cliente dispone de toda una /64). La IP es `context.clientAddress`: la de la conexión que entrega el adaptador (Node, Bun, Deno; en Workers, `CF-Connecting-IP`, que fija Cloudflare). Si Meeko no la conoce, todos los clientes comparten el contador de la ruta. `key: (context) => string` cuenta por otro sujeto, como el usuario de la sesión; se ejecuta antes de validar la entrada, así que no recibe el cuerpo. Una ruta dinámica (`/api/users/[id]`) tiene un solo contador para todos sus valores.
- **Proxies.** `X-Forwarded-For` nunca se lee salvo con `MEEKO_TRUST_PROXY`, porque cualquier cliente puede enviarlo. Con un número `n`, la IP es la entrada que añadió el proxy de confianza más externo, la `n`-ésima desde la derecha: con un único proxy (Traefik en Coolify, Caddy, nginx) use `MEEKO_TRUST_PROXY=1`, y las entradas que el cliente falsificó a la izquierda se ignoran. `true` toma la entrada de la izquierda: sólo es seguro si el proxy de entrada sustituye la cabecera en lugar de añadirse. Una entrada con puerto, como la que escribe Azure Application Gateway (`203.0.113.7:5678` o `[2001:db8::1]:5678`), cuenta por su IP; si la entrada elegida no es una IP, la petición cuenta con la IP de la conexión (la del proxy), nunca con el contador compartido de los clientes desconocidos. Sin la variable, tras un proxy todos los clientes comparten el contador del proxy. Un valor no válido detiene el arranque.
- **Middleware y llamadas locales.** Un middleware de servidor que pasa a `next()` una petición nueva (`next(new Request(request, { headers }))`) conserva la IP de la conexión. `createLocalCalls` usa el contador de la ruta que usa el despachador HTTP y la IP del `context` que recibe, así que una llamada local no esquiva el límite de la ruta. Un host propio que crea sus `Request` sin un adaptador de Meeko (`serveNode`, `toNodeListener`, `createBunServer`, `serveDeno` o `createWorker`) no tiene IP de conexión: sus clientes comparten el contador de la ruta, salvo que declare `key`.
- **Almacenamiento.** Los contadores viven en el store de sesiones: en memoria con `MemorySessionStore` y, con `RedisSessionStore` (también el de [Sesiones sin configuración](#sesiones-sin-configuración)), en `<prefix>ratelimit:<resumen>`, con un script Lua que hace `INCR` y `PEXPIRE` de forma atómica para todas las instancias. La clave guarda un resumen SHA-256 de la ruta y el sujeto, nunca la IP ni la clave en claro. Si Redis falla, la petición se rechaza con `500` (*fail closed*) y el error llega a `onError`.
- **Store propio.** Un `SessionStore` puede implementar `rateLimit(key, windowMs)`, que cuenta una petición en la ventana fija `key` y resuelve `{ count, resetInMs }` (tipo `RateLimitHit`); debe ser atómico entre instancias y rechazar si falla. Desde `1.7`, `SqlSessionStore` lo implementa cuando su driver ofrece `rateLimit` (véase [Rate limit en SQL](#rate-limit-en-sql)); sin él, los contadores viven en la memoria de cada instancia o aislado, y Meeko lo avisa una vez en producción.
- Un `limit` que no es un entero positivo, una `window` no válida o una `key` vacía responden `500 INVALID_RATE_LIMIT`.

### Rate limit en SQL

Desde `1.7`, una aplicación sin Redis comparte los contadores de `rateLimit` entre instancias con su base de datos: `SqlSessionDriver.rateLimit(key, windowMs, now)` es opcional y, si el driver lo implementa, `SqlSessionStore` delega en él. Sin él todo sigue como hasta `1.6`: contadores en la memoria de cada instancia y un aviso en producción.

La semántica es la de Redis y la memoria: una **ventana fija** por clave. La primera petición abre la ventana (`count = 1`, `window_ends_at = now + windowMs`); las siguientes suman uno y conservan su final; la primera tras el final la reinicia. Una ruta que cambia `window` no acorta ni alarga una ventana ya abierta. El driver devuelve la fila resultante, `{ count, windowEndsAt }` (tipo `SqlRateLimitRow`; `Number()` acepta un `bigint` devuelto como texto); Meeko calcula `resetInMs = windowEndsAt - now` y, por encima del límite, responde `429` con `Retry-After` en segundos redondeados hacia arriba (como mínimo, 1). `now` es el reloj de la instancia, como en `replace`. Si la sentencia falla, la petición se rechaza con `500` (*fail closed*).

`key` llega como los 32 bytes del SHA-256 de la clave del contador, que Meeko ya calcula como un resumen SHA-256 de la ruta y el sujeto: la tabla nunca guarda una IP ni una clave en claro (tampoco las de `SessionManager.rateLimit` llamado a mano) y la columna tiene ancho fijo. La sentencia debe ser atómica frente a peticiones concurrentes de todas las instancias; en PostgreSQL basta un único `INSERT … ON CONFLICT DO UPDATE … RETURNING`:

```sql
-- Una vez, en una migración. UNLOGGED: sin WAL, más rápida; tras una caída del servidor
-- la tabla se vacía y los contadores vuelven a empezar, lo que es aceptable para un límite.
CREATE UNLOGGED TABLE IF NOT EXISTS meeko_rate_limits (
  key bytea PRIMARY KEY,
  window_ends_at bigint NOT NULL,
  count integer NOT NULL
);
CREATE INDEX IF NOT EXISTS meeko_rate_limits_window_ends_at ON meeko_rate_limits (window_ends_at);

-- Cada petición limitada: $1 = key, $2 = now, $3 = windowMs.
INSERT INTO meeko_rate_limits AS r (key, window_ends_at, count) VALUES ($1, $2::bigint + $3::bigint, 1)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN r.window_ends_at <= $2 THEN 1 ELSE r.count + 1 END,
  window_ends_at = CASE WHEN r.window_ends_at <= $2 THEN EXCLUDED.window_ends_at ELSE r.window_ends_at END
RETURNING count, window_ends_at;

-- Limpieza periódica (cron, pg_cron o una tarea de la aplicación): $1 = now.
DELETE FROM meeko_rate_limits WHERE window_ends_at <= $1;
```

Las dos asignaciones del `UPDATE` leen la fila anterior, así que el reinicio de `count` y el de `window_ends_at` coinciden. Un driver con `node-postgres`:

```ts
// server/runtime.ts (fragmento)
import pg from "pg";
import type { SqlSessionDriver } from "@meekojs/meeko/server";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const rateLimitSql = `INSERT INTO meeko_rate_limits AS r …`; // la sentencia de arriba

const driver: SqlSessionDriver = {
  // read, write, remove, replace y revokeFamily, como siempre.
  ...sessionStatements(pool),
  async rateLimit(key, windowMs, now) {
    const { rows } = await pool.query<{ count: number; window_ends_at: string }>(rateLimitSql, [Buffer.from(key), now, windowMs]);
    return { count: rows[0]!.count, windowEndsAt: Number(rows[0]!.window_ends_at) };
  },
};
```

En Cloudflare D1, `D1SessionDriver` lo implementa con la opción `rateLimitTable` (véase [Sesiones en D1](#sesiones-en-d1)).

### IP del cliente tras un proxy

La IP del cliente tiene dos vías, con la misma política que `rateLimit`:

- **`context.clientAddress`**, donde hay un `RequestContext`: API, RPC, el `<script server>` de las páginas, el middleware de ruta de servidor (`context.clientAddress`) y los canales Socket.
- **`clientAddress(request, env?)`** de `@meekojs/meeko/server` (desde `1.7`), donde sólo hay un `Request`: `defineServerMiddleware` y los handlers de `addServerHandler`.

```ts
// server/middleware/10-access-log.ts
import { clientAddress, defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  // Tras Traefik con MEEKO_TRUST_PROXY=1, la del visitante y no la del proxy.
  const ip = clientAddress(request) ?? "desconocida";
  const response = await next();
  console.log(`${request.method} ${new URL(request.url).pathname} ${response.status} ${ip}`);
  return response;
});
```

La política es siempre la misma:

- **Sin `MEEKO_TRUST_PROXY`**, la IP es la de la conexión que entrega el adaptador: el socket remoto en Node (`serveNode`, `toNodeListener`), `server.requestIP()` en Bun, `remoteAddr` en Deno y `CF-Connecting-IP` en Workers, una cabecera que fija el borde de Cloudflare y que sustituye la que envíe el cliente. `X-Forwarded-For` nunca se lee: tras un proxy, todos los clientes tienen la IP del proxy.
- **Con `MEEKO_TRUST_PROXY=n`**, la IP es la `n`-ésima entrada de `X-Forwarded-For` desde la derecha, la que añadió el proxy de confianza más externo, sin su puerto. Lo que el cliente escribió a su izquierda se ignora. Con Traefik (Coolify), Caddy o nginx como único proxy, `MEEKO_TRUST_PROXY=1`; con un CDN delante de Traefik que añade su entrada, `2`. `true` toma la entrada de la izquierda y sólo es seguro si el proxy de entrada sustituye la cabecera. Si la entrada elegida no es una IP, vale la de la conexión.
- La IP sale normalizada: IPv6 en minúsculas y sin zona, e IPv4 mapeada en IPv6 (`::ffff:192.0.2.1`) como IPv4. `undefined` si no se conoce, como en un host propio que crea sus `Request` sin un adaptador de Meeko.

Sin `env`, `clientAddress` aplica el `MEEKO_TRUST_PROXY` del entorno de la aplicación que atiende la petición (el `platform.env` que recibe `ServerApp.fetch`), también en la petición nueva que un middleware pasa a `next()`. Con una petición que no atiende un `ServerApp`, sólo usa la IP de la conexión, salvo que reciba el entorno: `clientAddress(request, process.env)`. Un `MEEKO_TRUST_PROXY` no válido lanza `TypeError` (y detiene el arranque de la aplicación).

## Sesiones y seguridad

Las sesiones usan IDs opacos aleatorios en cookies `HttpOnly`, host-only, `Secure` por defecto y `SameSite=Lax` por defecto. Cada sesión nueva recibe también un `familyId` opaco que permanece al rotar su ID. `SessionHandle` permite crear, rotar y revocar; la rotación y la revocación de toda la familia requieren operaciones atómicas en el store. Así, un logout iniciado con un handle anterior invalida el ID activo aunque otra petición ya lo haya rotado. Las mutaciones autenticadas con cookie verifican Origin y `x-meeko-csrf`. Las respuestas SSR y API entregan el token CSRF por meta o cabecera same-origin. La aplicación debe definir verificación de identidad y reglas de autorización; Meeko no guarda secretos de autenticación en el navegador.

`MemorySessionStore` sirve sólo en desarrollo. `SessionManager({ production: true, store })` exige `persistent: true`, `replace` atómico y `revokeFamily`; una aplicación sin `MEEKO_REDIS_URL` ni `sessions` propias no arranca en producción. `RedisSessionStore` acepta un cliente compatible con `get`, `set` con `PX`, `del` y `eval`; usa un índice de familia con el TTL de la sesión activa. Use un prefijo propio por aplicación y entorno. Los registros Redis anteriores sin `familyId` siguen siendo legibles y adquieren una familia en la primera rotación. `SqlSessionStore` acepta un `SqlSessionDriver` con `read`, `write`, `remove`, `replace` transaccional, `revokeFamily`, `close` opcional y, desde `1.7`, `rateLimit` opcional (véase [Rate limit en SQL](#rate-limit-en-sql)). El ejemplo ejecutable en `tests/fixtures/fullstack-consumer/server/runtime.ts` usa SQLite real; el framework no depende de una librería SQL ni de un motor de base de datos concreto. `SessionManager.close()` libera el store cuando el host es propietario del recurso.

Todo `SessionStore` persistente personalizado debe almacenar `familyId` y garantizar que `replace` y `revokeFamily` sean atómicos frente a peticiones concurrentes. Antes de actualizar, migre los registros existentes y los índices necesarios para localizar la sesión activa por familia. No despliegue el nuevo runtime sobre un store antiguo: en producción la construcción falla de forma deliberada cuando no puede garantizar rotación y revocación familiar seguras. Desde `1.2`, un store puede implementar además `rateLimit(key, windowMs)` para los contadores de [`rateLimit`](#límite-de-peticiones-ratelimit).

**Migración de drivers SQL existentes:** añada una columna de familia a la tabla (por ejemplo, `family_id`), rellene las filas existentes con `family_id = id` y cree un índice único sobre ella. `read` y `write` deben transferir `SqlSessionRow.familyId`; `replace` debe comprobar la misma familia y sustituir la fila en una transacción; `revokeFamily(familyId)` debe borrar la fila activa por familia. Migre el esquema antes de iniciar la nueva versión. Un driver antiguo sin `revokeFamily` falla al construir `SqlSessionStore`; no se admite silenciosamente en producción.

Sin `server/runtime.ts`, Meeko hace todo esto por usted con `MEEKO_REDIS_URL` (véase la sección siguiente). Para un cliente propio, instale `redis` en la aplicación, cree el cliente con `createClient({ url: process.env.MEEKO_REDIS_URL })`, llame `connect()` antes de servir tráfico y páselo a `RedisSessionStore` con un prefijo propio. El host debe cerrar su cliente con `quit()` al detenerse; `SessionManager.close()` cierra el store, pero no se apropia de clientes externos. La prueba de integración `tests/redis.integration.ts` usa un namespace aleatorio y sólo borra sus propias claves. Se ejecuta contra un Redis real con `MEEKO_REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx --test tests/redis.integration.ts`; CI dispone de un servicio Redis dedicado. La prueba local requiere un Redis accesible y no usa bases ajenas.

### Sesiones sin configuración

Desde `1.2`, una aplicación no necesita `server/runtime.ts` para tener sesiones seguras. Si el archivo no existe, o su fábrica no devuelve `sessions`, `createServerApp` las crea:

- **Desarrollo** (`meeko dev`) y el prerender de `meeko build`: `MemorySessionStore`.
- **Producción** en Node, Bun y Deno: con `MEEKO_REDIS_URL` (`redis://` o `rediss://`), Meeko importa el paquete `redis` del proyecto, conecta un cliente y un suscriptor dedicado (`client.duplicate()`) **antes de servir tráfico**, crea un `RedisSessionStore` con revocación entre instancias y cierra ambas conexiones al detenerse, después del `close` de la aplicación. Instale el paquete con `npm install redis`: el build sólo lo incluye si está instalado, y sin él el arranque falla con un mensaje que lo pide. Si la primera conexión falla, el arranque falla; si se corta después, el cliente reconecta y, mientras tanto, las peticiones que leen la sesión fallan en el acto en lugar de esperar (*fail closed*). Los mensajes nunca incluyen la URL, que lleva la contraseña.
- **Producción sin `MEEKO_REDIS_URL`**: la aplicación no arranca, como hasta ahora. En Workers no hay TCP, así que `MEEKO_REDIS_URL` también detiene el arranque: declare un `SessionManager` con D1 o con Upstash (véase [Cloudflare Workers](#cloudflare-workers)).

Las claves usan el prefijo de `MEEKO_REDIS_PREFIX` o, por defecto, `meeko:<name de package.json>:prod:`. `MEEKO_SESSION_TTL` (`30m`, `12h`, `7d`…; 7 días por defecto) y `MEEKO_SESSION_SAMESITE` (`Lax` por defecto, o `Strict`) ajustan esas sesiones, también en desarrollo; un valor no válido detiene el arranque. La cookie conserva los valores seguros: `__Host-meeko.sid`, `Secure`, `HttpOnly`, `Path=/` y sin `Domain` (host-only). Con unas `sessions` propias en `server/runtime.ts`, esas variables no se aplican y Meeko lo avisa una vez.

### Duración de cada sesión

`SessionManager({ ttlMs })` fija la duración por defecto (7 días). Desde `1.2`, `context.session.create(data, { ttlMs })` da a una sesión su propia duración, un entero positivo de milisegundos; por ejemplo, 30 días para los propietarios y 12 horas para el personal. Un valor no válido rechaza con `RangeError` sin tocar el store. Esa duración fija el `Max-Age` de la cookie y la caducidad en el store (`expiresAt`, que Redis aplica con `PX` y SQL y D1 guardan en `expires_at`), se guarda en `SessionRecord.ttlMs` y `rotate()` la conserva: cada rotación cuenta de nuevo esa duración desde el momento de rotar.

```ts
const ttlMs = user.role === "staff" ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
await context.session.create({ userId: user.id }, { ttlMs });
```

Las sesiones creadas sin `ttlMs`, y los registros escritos antes de `1.2`, usan la duración del gestor también al rotar. `SqlSessionStore` no necesita una columna nueva: deduce la duración de cada fila como `expiresAt - createdAt`, así que una fila anterior conserva al rotar la duración con la que se creó. Un `SessionStore` propio debe conservar el campo `ttlMs` del registro si quiere que la duración sobreviva a la rotación; si lo pierde, la sesión rota con la duración del gestor.

### Origin en mutaciones anónimas

Origin y `x-meeko-csrf` se comprueban sólo en las mutaciones que llegan con una cookie de sesión. Un endpoint que crea la sesión, como el inicio de sesión, se llama sin ella y queda expuesto al *login CSRF*: otra web podría iniciar sesión en el navegador de la víctima con una cuenta del atacante. Desde `1.2`, `origin: "required"` en `defineApiRoute` o `defineRpc` exige un `Origin` permitido aunque no haya sesión:

```ts
// server/rpc/auth/login.ts
export default defineRpc({
  input: loginInput,
  output: loginOutput,
  origin: "required",
  handler: async ({ input, context }) => { /* … */ },
});
```

En un endpoint de API se comprueban los métodos `POST`, `PUT`, `PATCH` y `DELETE` (un `GET` no lleva `Origin` al navegar); en un RPC, todas las llamadas. Se acepta el origen de la petición, que tras `createServerApp` es el `publicOrigin` configurado, y los de `SessionManager({ allowedOrigins })`: la misma regla que en las mutaciones autenticadas. Un `Origin` ausente, `null` u otro distinto responde `403 INVALID_ORIGIN` antes de leer o validar la entrada y de ejecutar el handler. Las llamadas de los clientes `api.*` y `rpc.*` durante el SSR envían el origen de la petición en curso, así que el despacho local sigue funcionando. Una llamada desde fuera del navegador (una app nativa o un script) debe enviar una cabecera `Origin` permitida.

**`session.create()` protege el inicio de sesión aunque falte `origin: "required"`.** Desde `1.2`, en una petición `POST`, `PUT`, `PATCH` o `DELETE`, `context.session.create()` sólo crea la sesión si el `Origin` de esa petición ya se comprobó (con `origin: "required"`, o en una mutación autenticada que superó Origin y CSRF) o si está permitido en ese momento; si no, rechaza con `403 INVALID_ORIGIN` sin tocar el store ni enviar la cookie. Los navegadores envían `Origin` en toda petición `POST`, también en las de su propio origen, así que un inicio de sesión desde la propia aplicación sigue funcionando sin cambios. Lo que cambia:

- Un script, una prueba o una app nativa que inicia sesión sin cabecera `Origin` recibe `403`. Envíe el `Origin` de la aplicación o declare `origin: "none"` en esa ruta. `"none"` es **inseguro**: desactiva esta comprobación y deja la ruta expuesta al *login CSRF*, así que úselo sólo con otra prueba de que la petición no viene de otra web (por ejemplo, un secreto de la app que el navegador no tiene). En desarrollo, el primer rechazo escribe un aviso con estas dos salidas.
- `GET`, `HEAD` y `OPTIONS` no se comprueban, porque un callback de OAuth o un enlace mágico llegan como navegación desde otro sitio, sin `Origin`. Esos flujos deben validar su propio `state` o token de un solo uso.
- Un `SessionHandle` que no cargó `SessionManager.load` (un host propio que lo construye a mano) no conoce su petición y crea la sesión como antes.

Es un cambio incompatible publicado en un minor como corrección de seguridad, según la [política de estabilidad](stability.md#excepciones-aprobadas): sin él, cualquier ruta de inicio de sesión sin `origin: "required"` que acepte formularios o `text/plain` era vulnerable por defecto.

### Revocación durante una petición

Revocar una familia también detiene el trabajo que ya había pasado la autenticación:

- **Peticiones en curso.** `SessionHandle.signal` se aborta con `SessionRevokedError` cuando se revoca la familia de su sesión, y `RequestContext.signal` combina esa señal con la de la petición (`AbortSignal.any`, creada al leerla por primera vez). Ambas señales se abortan aunque el código sólo conserve la señal y no el handle ni el contexto. Pase `context.signal` a `fetch`, consultas y otras operaciones cancelables. `SessionRevokedError` es un `ApiError` con código `SESSION_REVOKED` y estado `401`; si escapa del handler, la respuesta es ese `401`. La petición que llama a `revoke()` no se aborta, porque debe enviar la cookie vacía.
- **Sockets abiertos.** Las conexiones Socket cuya sesión de handshake pertenece a la familia revocada se cierran de inmediato con `1008` ("Session revoked"), sin esperar a otro evento.
- **Otras instancias.** Dentro de la misma instancia, `revoke()` aborta siempre. Para alcanzar a otras instancias, el store implementa `subscribeRevocations(listener)`, que devuelve, o promete, un `Unsubscribe`. `RedisSessionStore` la ofrece cuando recibe `subscriber` (una conexión dedicada, por ejemplo `client.duplicate()`). El script de `revokeFamily` publica el `familyId` en `<prefix>revoked` en la misma operación atómica que borra la sesión. `MemorySessionStore` avisa a los `SessionManager` del mismo proceso que lo comparten. `SqlSessionStore` no tiene notificación: sin ella, las demás instancias sólo detectan la revocación al releer el store.
- **Inicio de la suscripción.** `SessionManager` se suscribe en la primera llamada a `load` y espera la confirmación antes de autenticar. Si la suscripción falla, `load` rechaza esa petición y la siguiente lo reintenta. `SessionManager.close()` cancela la suscripción.

La notificación es asíncrona: entre el borrado en el store y la llegada del aviso, otra instancia puede seguir ejecutando código. Antes de un efecto irreversible (un pago, un envío, un borrado), llame `await context.session.verify()`. Relee el store y lanza `SessionRevokedError` si la sesión fue revocada, reemplazada por una rotación o caducó; sin sesión no hace nada.

Límites conocidos de la notificación:

- **Suscriptor Redis desconectado.** Redis pub/sub no guarda mensajes: las revocaciones publicadas mientras el `subscriber` de una instancia está desconectado se pierden para esa instancia, aunque node-redis restablezca la suscripción al reconectar. El borrado en el store sí es atómico, así que esas sesiones dejan de valer en cuanto se releen: cada petición nueva y cada evento de Socket releen la sesión, y una entrega de broadcast la relee si pasó más de `sessionRefreshMs` desde la última lectura. Lo que no se detecta es el trabajo ya autenticado en esa instancia: una petición en curso no se aborta y un socket sin tráfico permanece abierto hasta su siguiente evento o entrega. Use `verify()` antes de efectos irreversibles y vigile los eventos de reconexión del cliente Redis.
- **Ventana de revocaciones recientes.** Cada instancia recuerda las familias revocadas durante 60 segundos, hasta 4096; con más revocaciones en esa ventana olvida primero las más antiguas. Un handle cuyo registro se leyó antes del aviso y se crea después de que su familia salga de esa memoria no se aborta al registrarse, pero `verify()` y la siguiente relectura sí detectan la revocación, porque el registro ya no existe.
- **Avisos falsificables.** Cualquiera con permiso `PUBLISH` sobre el Redis puede publicar un `familyId` en `<prefix>revoked`. El aviso no borra datos ni concede acceso, pero aborta las peticiones en curso y cierra los sockets de esa familia en todas las instancias (denegación de servicio). Restrinja con ACL de Redis quién puede publicar en ese canal.

Un almacenamiento caído propaga error y no concede acceso. No se debe usar un store en memoria en producción. `Secure` requiere HTTPS en despliegue; configure el proxy y `MEEKO_PUBLIC_ORIGIN` acorde al origen público.

## Limpiar el proyecto

`meeko clean [directorio]` borra todo lo que genera Meeko para dejar el proyecto limpio:

| Comando | Borra | Conserva |
| --- | --- | --- |
| `meeko clean` | `.meeko/` (tipos, entradas, manifiestos, builds, `tsconfig.*` generados) y la caché de Vite `node_modules/.vite` | El resto de `node_modules` y todos los archivos de la aplicación |
| `meeko clean --all` | Lo anterior y `node_modules` | Lockfiles, `.env`, `package.json` y el código |
| `meeko clean --dry-run` | Nada: muestra qué borraría, con el número de archivos y el tamaño | Todo |

El comando sólo actúa sobre un proyecto Meeko (con `meeko.config.*` o con `@meekojs/meeko` en `dependencies`/`devDependencies`) y rechaza la raíz de una unidad y el directorio del usuario. Borra únicamente esa lista fija de rutas dentro del proyecto y **nunca sigue enlaces**: un symlink o una junction se elimina como enlace sin entrar en su destino, así que es seguro con `link:` de pnpm, donde `node_modules/@meekojs/meeko` apunta a otro repositorio. Si `node_modules` es un enlace, la caché de Vite se omite con un aviso. Un archivo bloqueado se reintenta; si el error persiste, se informa, se sigue con el resto y el comando termina con código 1. Para reinstalar desde cero: `meeko clean --all` y después `pnpm install`.

## Build, despliegue y verificación

```sh
npm run check   # manifiestos, tipos, componentes y proyectos TypeScript separados
npm run build   # cliente, servidor Node y prerender bajo .meeko/output/node/
npm start       # Node 24, con store persistente configurado
```

`meeko build [directorio] [--adapter <nombre>]` toma el adaptador de `--adapter` o de `server.adapter` en `meeko.config.ts`, con `node` por defecto. `MeekoConfig.server` es una unión discriminada; para Node acepta `{ adapter: "node", host?, port? }`. El build Node escribe `.meeko/output/node/` con `index.mjs`, `chunks/`, `client/` y `prerender/`. Esa carpeta contiene el manifiesto de rutas, endpoints y assets ya resuelto: no lee `app/`, `server/` ni `meeko.config.ts` y no carga TypeScript ni Vite. Sólo necesita las dependencias de `node_modules`, incluida `@meekojs/meeko`. `meeko start` y `meeko preview` ejecutan `index.mjs`; también puede ejecutarse con `node .meeko/output/node/index.mjs`. Para Bun y Deno, `meeko build --adapter bun` o `--adapter deno` (o `server: { adapter: "bun" }` / `{ adapter: "deno" }`) produce una salida autónoma descrita en [Bun](#bun) y [Deno](#deno), y `--adapter cloudflare` un Worker descrito en [Cloudflare Workers](#cloudflare-workers). Desde `1.3`, `--adapter static` (o `server: { adapter: "static" }`) genera un sitio de archivos para un hosting estático; véase [Sitio estático](#sitio-estático).

El servidor escucha en `127.0.0.1:4173` salvo que `server.host`/`server.port` o las variables `MEEKO_HOST` y `MEEKO_PORT` (o `PORT`) indiquen otra dirección; use `MEEKO_HOST=0.0.0.0` para aceptar tráfico remoto. `MEEKO_PUBLIC_ORIGIN` fija el origen público para las comprobaciones de Origin de HTTP y Socket cuando un proxy termina TLS. `SIGINT` y `SIGTERM` cierran Socket, HTTP, las tareas de `waitUntil` y el runtime, por ese orden. Las respuestas abiertas, como un stream, disponen de `shutdownTimeout` milisegundos (10 000 por defecto) para terminar; después se cortan sus conexiones y el cierre continúa. Si el cliente se desconecta antes o durante el envío, el cuerpo de la respuesta se cancela, lo que libera archivos abiertos y detiene productores de streams. Un request-target que empieza por `//` se interpreta siempre como ruta del origen propio (o de `MEEKO_PUBLIC_ORIGIN`), nunca como otro host.

Los archivos públicos se sirven sólo si figuran en el manifiesto de assets generado con el build cliente (incluida la copia de `public/`); cualquier otra ruta pasa a la aplicación y nunca se lee del disco. Cada asset lleva `ETag`, `content-length` y soporte de `HEAD` y `304`; sólo los archivos emitidos por Vite y listados en su manifiesto (con hash de contenido) usan `cache-control: public, max-age=31536000, immutable`; el resto, incluidos los de `public/assets/`, usan `public, max-age=0, must-revalidate`. La clave de cada asset es su ruta tal como la serializa la URL WHATWG, la misma que pide el navegador: `public/logo@2x.png` se sirve en `/logo@2x.png`, `a b.txt` en `/a%20b.txt` y un nombre no ASCII en su forma codificada en UTF-8. El HTML enlaza la entrada cliente, su CSS y sus `modulepreload` desde el manifiesto de Vite; la lista de rutas del cliente se importa como módulo y ya no se inserta en el documento.

Para un servicio público, sitúelo tras un proxy HTTPS, configure `MEEKO_PUBLIC_ORIGIN`, sesiones persistentes y cierre ordenado. La exportación OpenAPI es opcional mediante `generateOpenApi`; un schema que no pueda representarse produce error explícito.

El starter independiente creado con `meeko init` coordina el cierre de HTTP y Vite ante `SIGINT` y `SIGTERM`. El cierre es idempotente; si fallan ambos recursos conserva las dos causas y fija un código de salida fallido, sin dejar rechazos de promesas sin observar. El host de framework conserva del mismo modo el error original de arranque y comunica por el observador central cada fallo adicional al cerrar Socket, sesiones o Vite.

El adaptador Node entrega por separado varias cabeceras `Set-Cookie` y deja de transmitir el cuerpo si el cliente cierra la conexión. Una respuesta ya iniciada no puede sustituirse por un JSON de error; el adaptador cierra esa conexión y comunica el fallo al observador del host.

### Sitio estático

```sh
npx meeko build --adapter static     # .meeko/output/static/
npx meeko preview --adapter static   # la sirve como un hosting estático
```

Desde `1.3`, el adaptador `static` escribe en `.meeko/output/static/` un sitio sin servidor, listo para subir tal cual a nginx, Netlify, Cloudflare Pages, GitHub Pages o un bucket:

- los assets del cliente y `public/`;
- cada página prerenderizada como `<ruta>/index.html` (`/docs/api` → `docs/api/index.html`, con los segmentos decodificados como los pide el hosting) y su payload de navegación `<ruta>/index.meeko.json`;
- `404.html`, la página de `app/error.meeko` con estado `404` dentro de sus layouts (sin `app/error.meeko` no se genera y el build lo avisa);
- `sitemap.xml` y `robots.txt` si están activados, y los archivos de cabeceras de `headerFiles`.

Un hosting estático no negocia `Accept`, así que el cliente de este build no pide la página con `Accept: application/meeko+json`: lee el archivo `index.meeko.json` de la carpeta de la página (`/docs/api/index.meeko.json`, sin la query string). La navegación cliente funciona, por tanto, con cualquier hosting que sirva los archivos; el de los demás adaptadores sigue negociando `Accept`. `404.html` hidrata en cualquier URL, también en una que coincide con una ruta dinámica cuya página no se prerenderizó (`/docs/[slug]` con `slug` desconocido), y navega en el cliente desde ella; una ruta cuyo payload no existe muestra la página de error sin recargar. Los hostings sirven `404.html` para las URL que no existen (en nginx, `error_page 404 /404.html;`).

Todas las páginas deben usar `render: "prerender"`, con `prerenderEntries` en las rutas dinámicas. Antes de compilar nada, el build falla con la lista de lo que necesita un servidor: las páginas `"ssr"`, `"stream"` o `"client"`, los endpoints de API, los procedimientos RPC, los canales Socket, el middleware de `server/middleware` y los handlers de servidor de los módulos. El middleware de ruta (`app/middleware`) se ejecuta al prerenderizar y al navegar en el cliente, pero no en la primera carga de una página; el build lo avisa. `server/runtime.ts` sólo se ejecuta mientras se prerenderiza. Un archivo de `public/` que choca con uno generado (`404.html`, `sitemap.xml`, `robots.txt`, `_headers`, `_meeko/headers.conf` o el `index.html` de una página) es un error.

`server` acepta, con `adapter: "static"`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  sitemap: true,
  robots: true,
  document: { seo: true },
  server: {
    adapter: "static",
    headerFiles: ["_headers", "nginx"],
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
    },
    headers: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" },
  },
});
```

- `contentSecurityPolicy`: la `Content-Security-Policy` de todas las páginas, por directiva. El build le añade los hashes de los scripts en línea; véase [CSP con hashes](#csp-con-hashes).
- `headers`: otras cabeceras de todas las respuestas. `Content-Security-Policy` no se admite aquí, porque perdería los hashes.
- `headerFiles`: dónde se escriben esas cabeceras. Por defecto, en ningún sitio: un hosting estático no las lee de la configuración de Meeko, así que cada formato es opcional y explícito.
  - `"_headers"` escribe `/_headers`, el formato de Netlify y Cloudflare Pages, con un bloque `/*` para todas las rutas. Esos hostings lo leen y no lo publican.
  - `"nginx"` escribe `/_meeko/headers.conf`, una línea `add_header … always;` por cabecera, para incluirlo en cada `location` (un `add_header` dentro de una `location` anula los del `server`). El archivo está dentro de la raíz web, así que la configuración debe ocultar `/_meeko/`:

```nginx
server {
  root /usr/share/nginx/html;   # el contenido de .meeko/output/static
  location / {
    include /usr/share/nginx/html/_meeko/headers.conf;
    try_files $uri $uri/index.html =404;
  }
  location ^~ /_meeko/ { internal; }
  error_page 404 /404.html;
}
```

Esas opciones sólo se leen cuando `server.adapter` es `"static"`; con `meeko build --adapter static` sobre otra configuración se construye sin ellas. `meeko preview` sirve la carpeta como lo haría un hosting (el archivo, el `index.html` de la carpeta o `404.html` con estado `404`, sin publicar `_headers` ni `_meeko/`) y aplica la CSP y `headers`, en `127.0.0.1:4173` salvo que `MEEKO_HOST` y `MEEKO_PORT` digan otra cosa. `meeko start` sirve sólo el build de Node. El build sigue usando Node y Vite, y el prerender, un servidor Node intermedio en `.meeko/build/node/`, como en Bun.

### `sitemap.xml` y `robots.txt`

```ts
export default defineMeekoConfig({
  site: "https://example.com",
  sitemap: { exclude: ["/admin", "/admin/*"] },   // o sitemap: true
  robots: { disallow: ["/admin/"] },              // o robots: true
});
```

Desde `1.3`, `sitemap` escribe `sitemap.xml` (protocolo sitemaps.org 0.9) con la URL absoluta de cada página prerenderizada y de cada ruta sin parámetros, sea `"ssr"`, `"stream"` o `"client"`; las rutas dinámicas sin prerender no se conocen en el build salvo que declaren [`sitemapEntries`](#rutas-dinámicas-en-el-sitemap-sitemapentries) (desde `1.7`). Se omiten las páginas prerenderizadas que piden `<meta name="robots" content="noindex">` (o `none`) y las rutas de `exclude`, donde `*` sustituye a cualquier secuencia de caracteres, `/` incluida. `robots` escribe `robots.txt` con `User-agent: *`, sus `allow` y `disallow` (`Allow: /` sin ninguno) y, con `sitemap`, la línea `Sitemap:` con su URL absoluta.

Las URL necesitan el origen público: `site` o, sin él, `MEEKO_PUBLIC_ORIGIN` del build. Con `sitemap` y sin origen, el build falla antes de compilar; `robots` sin `sitemap` no lo necesita. Valen para todos los adaptadores. En Node, Bun, Deno y Workers se sirven como los demás archivos públicos, desde el manifiesto de assets del build: como el sitemap lista las páginas prerenderizadas, el adaptador Node las renderiza con un servidor intermedio y construye el suyo después, con el sitemap en su manifiesto (una compilación de servidor más, sólo con `sitemap`). Un `public/sitemap.xml` o `public/robots.txt` choca con la opción correspondiente y el build falla.

#### Rutas dinámicas en el sitemap: `sitemapEntries`

Desde `1.7`, una página con render en el servidor declara sus URL del sitemap con `sitemapEntries` en `definePage`: una lista de `{ params, lastmod?, changefreq?, priority? }` (tipo `SitemapEntry`) o una función, síncrona o asíncrona, que la devuelve. Es la vía para las rutas dinámicas con `"ssr"` o `"stream"`, cuyas URL el build no puede adivinar:

```ts
// app/pages/docs/[slug].route.ts (o el <script server> de la página)
import { definePage } from "@meekojs/meeko/framework";
import { docs } from "../../../server/content/bundle.js";

export const route = definePage({
  sitemapEntries: ({ env }) => docs
    .filter((doc) => env.DOCS_DRAFTS === "1" || !doc.draft)
    .map((doc) => ({ params: { slug: doc.slug }, lastmod: doc.updatedAt, changefreq: "weekly" })),
});
```

- **Cuándo y con qué.** `meeko build` la evalúa una vez, después de prerenderizar, en el servidor de Node intermedio con el que prerenderiza: el runtime de `server/runtime.ts` ya existe con `prerendering: true`, pero no hay petición, sesión ni `services` por petición. La función recibe `SitemapEntriesContext`: `env` (el `process.env` del build) y `prerendering` (siempre `true`). Lea los datos de lo que el build tiene a mano, como un bundle de contenido; si consulta una base de datos, debe estar accesible durante el build. Sólo se ejecuta con `sitemap` en `meeko.config.ts`, y Meeko sólo carga las opciones de las rutas que la nombran: escríbala en las opciones, no a través de un spread.
- **Qué devuelve cada entrada.** `params` construye la URL como `href`; una ruta sin parámetros los omite y la entrada sólo añade campos a su URL. `lastmod` es un `Date` (se escribe con `toISOString()`) o un texto W3C Datetime (`"2026-10-01"`, `"2026-10-01T12:00:00Z"`); `changefreq` es `always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly` o `never`, y `priority`, un número de `0` a `1`. Un valor fuera de esos, una URL repetida, unos `params` que no forman la URL o una URL que resuelve otra ruta detienen el build con la ruta.
- **Con `render: "prerender"`.** Las páginas prerenderizadas ya están en el sitemap; `sitemapEntries` sólo les añade `lastmod`, `changefreq` y `priority`. Una entrada sin página prerenderizada detiene el build: añádala a `prerenderEntries` o quítela. Así el sitemap nunca anuncia una URL que el adaptador `static` no tiene.
- **`exclude` y `noindex` ganan.** Una URL declarada que coincide con `sitemap.exclude`, o una página prerenderizada con `noindex`, no se lista.
- **`render: "client"`.** Sus opciones llegan al navegador, así que no admite `sitemapEntries`: es un error de tipos y detiene `meeko dev`, `meeko build` y `meeko check`. Una página `"client"` sin parámetros ya está en el sitemap.

Funciona igual con todos los adaptadores: el sitemap se escribe en los archivos públicos del build y en Node, Bun, Deno y Workers se sirve desde su manifiesto de assets. El adaptador `static` no admite rutas `"ssr"`, así que en él `sitemapEntries` sólo completa las páginas prerenderizadas.

### CSP con hashes

Una `Content-Security-Policy` sin `'unsafe-inline'` bloquea los scripts en línea de un documento, como uno de `document.head.script` o el que añade [`theme`](#tema-clarooscuro-sin-parpadeo). Para las páginas que se generan en el build, Meeko permite cada uno por su hash SHA-256, sin nonce por petición:

- Desde `1.3`, el índice `prerender/manifest.json` guarda en `pages[ruta].scriptHashes` las fuentes `'sha256-…'` de los `<script>` en línea que ejecuta cada página prerenderizada: los de JavaScript, `module`, `importmap` y `speculationrules`. Los bloques de datos (`application/json`, como el payload de Meeko, y `application/ld+json`) y los scripts con `src` no cuentan. Desde `1.7`, sólo cuentan los que escribe Meeko fuera de la página (el `<head>`, el payload, la entrada y `document.bodyEnd`): un `<script>` o un `<style>` dentro de `#app` o de un teleport, que puede venir de contenido de usuario, no recibe hash.
- `inlineScriptHashes(html)` de `@meekojs/meeko/build` devuelve `{ hashes, unhashable }` para cualquier documento: los hashes y el JavaScript que un hash no puede permitir, los atributos `on*` y las URL `javascript:`. Lee el HTML como el navegador, así que el hash coincide con el que éste comprueba. Lee el documento entero, también lo que hay dentro de `#app`: para una página de Meeko, use los hashes del índice.
- `contentSecurityPolicy(policy, hashes)` de `@meekojs/meeko/server` construye el valor de la cabecera: añade los hashes a `script-src` (desde `1.7`, a `script-src-elem` si la política la tiene) sin repetir fuentes o, si la política no tiene `script-src`, a una copia de las fuentes de `default-src` (sin ninguna de las dos, los scripts ya están permitidos y no añade nada). Con hashes, el navegador ignora `'unsafe-inline'` de `script-src`.
- Desde `1.4`, lo mismo con los `<style>` en línea, como el de los iconos de [`<MeekoThemeToggle>`](#meekothemetoggle) y los de los componentes: `pages[ruta].styleHashes` en el índice, `inlineStyleHashes(html)` de `@meekojs/meeko/build` (los atributos `style="…"` no cuentan, porque un hash no los permite) y un tercer argumento, `contentSecurityPolicy(policy, scriptHashes, styleHashes)`, que los añade a `style-src-elem` si la política la tiene, si no a `style-src` o a una copia de `default-src`. A diferencia de los scripts, no los añade a una directiva que ya admite `'unsafe-inline'`: no hace falta, y el hash anularía `'unsafe-inline'` para los atributos `style="…"`.

El adaptador `static` hace todo eso con `server.contentSecurityPolicy`: calcula los hashes de los scripts y, desde `1.4`, de los `<style>` de todos los `.html` de su salida (`404.html` y los de `public/` incluidos; desde `1.7`, en los documentos de Meeko sólo los de fuera de `#app` y de los teleports, y un `.html` propio se lee entero), los añade a la política y escribe la cabecera en `headerFiles`. Si una página tiene un atributo `on*` o una URL `javascript:`, el build falla con la lista de archivos: use un script o `on:` del componente. Cambiar un script cambia su hash en el siguiente build, sin tocar la política.

```ts
// Un host propio que sirve el build de Node con CSP para sus páginas prerenderizadas.
import { readFile } from "node:fs/promises";
import { contentSecurityPolicy } from "@meekojs/meeko/server";
import type { PrerenderIndex } from "@meekojs/meeko/build";

const index = JSON.parse(await readFile(".meeko/output/node/prerender/manifest.json", "utf8")) as PrerenderIndex;
const hashes = [...new Set(Object.values(index.pages).flatMap((page) => page.scriptHashes ?? []))];
const header = contentSecurityPolicy({ "default-src": ["'self'"], "object-src": ["'none'"] }, hashes);
```

Desde `1.7`, los adaptadores con servidor ponen la cabecera ellos mismos con `server.contentSecurityPolicy` (véase la sección siguiente). Sin esa opción, `meeko start` no añade ninguna CSP: un host propio usa el nonce de `DocumentOptions.nonce`, que Meeko pone en sus `<script>` y `<style>`, y entonces una página prerenderizada no se sirve desde el archivo, porque el nonce cambia en cada respuesta.

### CSP y cabeceras en los adaptadores con servidor

Desde `1.7`, `server.contentSecurityPolicy` y `server.headers` también existen con `adapter: "node"`, `"bun"`, `"deno"` y `"cloudflare"`. Se fijan en el build (en el manifiesto de la aplicación, `AppManifest.contentSecurityPolicy` y `AppManifest.headers`) y la aplicación los aplica a cada respuesta:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "node",
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      // Shiki y otros resaltadores escriben atributos style="…": esta directiva se queda como está.
      "style-src": ["'self'", "'unsafe-inline'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "frame-ancestors": ["'none'"],
    },
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "/admin/*": { "X-Robots-Tag": "noindex" },
    },
  },
});
```

**La CSP según la respuesta.** Meeko completa la política de cada respuesta con lo que su cuerpo necesita:

| Respuesta | `Content-Security-Policy` |
| --- | --- |
| Página prerenderizada | La política con los hashes de los scripts y `<style>` en línea que escribe Meeko (`scriptHashes` y `styleHashes` del índice de prerender, como el adaptador `static`). La página se sigue sirviendo desde su archivo, con su `ETag` y su `304`. |
| Página SSR, `"stream"`, página de error y 404 | La política con un nonce nuevo en cada respuesta en `script-src` (en `script-src-elem` si la política la tiene, o en una copia de `default-src`), que Meeko pone en sus `<script>`, sus `<style>`, la entrada del cliente, el script del tema y los de `useHead` y `document`. |
| Página SSR con [`cache`](#caché-de-páginas-ssr) | La política con los hashes de los scripts y `<style>` en línea que escribe Meeko, sin nonce: el documento es el mismo para todos y en cada revalidación, y un nonce no sobrevive a un `304`. |
| JSON de API, RPC y payload de navegación | `default-src 'none'; frame-ancestors 'none'`: el JSON no ejecuta ni carga nada. Se aplica a toda respuesta de `server/api` y del RPC, también a la de un endpoint con `contentType: "response"`. |
| Cualquier otra (archivos públicos, handlers de módulos, 404 sin página de error) | La política tal cual. |

**Qué autorizan los hashes.** Sólo el código en línea que escribe Meeko fuera de la página: el `<head>` (el script y el estilo del tema, la reserva de `<MeekoAwait>`, `useHead`, `document.head` y los `<style>` de los componentes), el payload si no es un bloque de datos, la entrada del cliente y `document.bodyEnd`. Un `<script>` o un `<style>` dentro de `#app` o de un teleport (de `html="…"`, de contenido de usuario mal saneado o escrito en la plantilla) nunca recibe hash, así que el navegador lo bloquea, igual que con nonce. Un `<script>` o `<style>` en la plantilla de una página con `cache` o prerenderizada debe ir en `useHead` o en un archivo.

Meeko nunca añade un nonce ni un hash a una directiva con `'unsafe-inline'`: con uno, el navegador ignoraría `'unsafe-inline'` y bloquearía lo que esa directiva permitía a propósito, como los atributos `style="…"` que escriben Shiki y otros resaltadores. La excepción es `'strict-dynamic'` (desde `1.7`): con él, el navegador ya ignora `'unsafe-inline'` y las fuentes de host, que quedan sólo para navegadores antiguos, así que `script-src 'strict-dynamic' 'unsafe-inline' https:` recibe el nonce o los hashes. Con `'strict-dynamic'`, la entrada del cliente (`<script src>`) sólo carga con nonce: en una página con `cache` o prerenderizada, que usan hashes, el navegador la bloquea, así que esas páginas no hidratan; use `'strict-dynamic'` sólo si todas sus páginas son SSR sin `cache`. Si la política tiene `script-src-elem` o `style-src-elem`, el nonce y los hashes van a esa directiva, que es la que rige los elementos. Con `style-src 'self' 'unsafe-inline'`, los `<style>` de Meeko entran por `'unsafe-inline'`; con un `style-src` estricto, por el nonce o el hash, como los scripts. Una respuesta que ya trae `Content-Security-Policy` (de un handler o de un middleware) la conserva, y un `304` nunca lleva la política: el navegador actualiza con él las cabeceras de su copia, y una política sin los hashes de ese documento sustituiría a la suya. El nonce lo genera Meeko (128 bits aleatorios); si el host pasa `DocumentOptions.nonce`, se usa el suyo, y `document.bodyEnd` y `document.head` lo reciben como siempre.

Con un atributo `on*` o una URL `javascript:` en el HTML, el navegador los bloquea igual con nonce que con hashes; muévalos a un script o a `on:` del componente. Calcular los hashes de una página con `cache` lee su HTML con el mismo analizador que el build (`parse5`), una vez por render; con `cache.memory`, una vez por versión de la página. La CSP sólo se aplica en producción (`meeko start`, `meeko preview` y las salidas de cada adaptador): en `meeko dev`, Vite inyecta scripts y estilos sin nonce ni hash.

**Cabeceras.** Cada clave de `headers` con nombre de cabecera se aplica a todas las respuestas; una clave que empieza por `/` es un patrón de ruta (el `pathname`, sin query) con sus propias cabeceras, que se aplican después de las globales y en el orden escrito, de modo que la última gana. En el patrón, `*` sustituye a cualquier secuencia de caracteres, `/` incluida: `"/docs/*"` coincide con `/docs/api` pero no con `/docs`. Una cabecera que la respuesta ya trae (de Meeko, de un handler o de un middleware) no se sustituye: `Cache-Control` de una página o de un archivo, por ejemplo, gana a la de `headers`. `Content-Security-Policy` no se admite en `headers`, y con `adapter: "static"` las claves con patrón son un error, porque `headerFiles` escribe un único bloque para todas las rutas. A diferencia de la CSP, `headers` también se aplica en `meeko dev` a lo que atiende la aplicación (páginas, API y RPC); los archivos que sirve Vite no las llevan.

**Workers.** Cloudflare Workers aplica la CSP y las cabeceras igual que Node, Bun y Deno: los hashes y el nonce usan Web Crypto, y el índice de prerender de los assets lleva los hashes de cada página.

**Un endpoint que devuelve HTML.** La política de JSON (`default-src 'none'`) se aplica a todo `/api/` y al RPC. Un endpoint con `contentType: "response"` que devuelve HTML (una vista previa, una página de retorno de un pago) se pintaría sin estilos ni scripts: ponga su propia `Content-Security-Policy` en el `Response`, que Meeko conserva.

**Workers sin CSP.** El analizador HTML que calcula los hashes (`parse5`) sólo se carga cuando hay `server.contentSecurityPolicy`; sin ella, el build de Cloudflare lo deja fuera del Worker (unos 240 KB menos).

**Cookies y cachés compartidas.** Independientemente de estas opciones, una respuesta con `Set-Cookie` y un `Cache-Control` `public` o con `s-maxage` (de la respuesta o de `headers`) sale como `private, no-store` y sin `ETag`, para que ninguna caché compartida guarde la cookie con la página.

### Bun

```sh
npx meeko build --adapter bun
npx meeko preview --adapter bun      # ejecuta la salida con `bun`
bun .meeko/output/bun/index.js       # en producción
```

El build Bun escribe `.meeko/output/bun/` con `index.js`, `chunks/`, `client/` y `prerender/`. A diferencia del build Node, `index.js` incluye `@meekojs/meeko` y el resto de dependencias del servidor: la carpeta no necesita `node_modules`, ni las fuentes de la aplicación, ni TypeScript o Vite. Copie la carpeta completa al servidor. El build y el prerender siguen ejecutándose con Node; Meeko construye para ello un servidor Node intermedio en `.meeko/build/node/`, que no forma parte de la salida.

La salida escucha en `127.0.0.1:4173` salvo que `MEEKO_HOST` y `MEEKO_PORT` (o `PORT`) indiquen otra dirección; `MEEKO_PUBLIC_ORIGIN` cumple la misma función que en Node. `server.host` y `server.port` sólo se aplican a Node. `SIGINT` y `SIGTERM` detienen `Bun.serve`, cierran las conexiones activas y después la aplicación. Desde `1.3`, los rechazos sin manejar y las excepciones no capturadas siguen `processErrors` (véase [Fallos fuera de una petición](#fallos-fuera-de-una-petición)); un host propio con `createBunServer` lo consigue con `handleProcessErrors`. `meeko preview` lanza `bun` como proceso hijo, le reenvía las señales y adopta su código de salida; si `bun` no está en el `PATH`, falla con un mensaje explícito.

Para alojar la aplicación en un servidor propio, `createBunServer(app, options)` devuelve `{ fetch, websocket }` para `Bun.serve({ port, ...createBunServer(app) })`, y `createBunAssetReader({ root, assets })` sirve los archivos del manifiesto con `Bun.file`. Límites de Socket:

- `maxPayloadLength`: el frame entrante más grande. Por defecto, `socket.maxMessageBytes` de `server/runtime.ts` o 64 KiB. Bun cierra los frames mayores y el hub responde `1009` a un mensaje que supere el límite de la aplicación.
- `backpressureLimit`: bytes salientes pendientes por peer, 1 MiB por defecto. Un envío que lo supera cierra ese peer con `1011` sin bloquear al resto de la sala.
- `idleTimeout` (60 s) y `sendPings` (activo) mantienen vivas las conexiones sanas y cierran las inactivas. Los mensajes binarios se cierran con `1003`. La compresión por mensaje está desactivada.

### Deno

```sh
npx meeko build --adapter deno
npx meeko preview --adapter deno                 # ejecuta `deno run -A` sobre la salida
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

El build Deno escribe `.meeko/output/deno/` con `main.js`, `chunks/`, `client/` y `prerender/`. Como en Bun, `main.js` incluye todas las dependencias del servidor y no necesita `node_modules`, las fuentes, TypeScript ni Vite. `meeko preview` concede todos los permisos (`-A`). En producción bastan `--allow-net`, `--allow-env` (el runtime recibe `Deno.env.toObject()`) y lectura de la carpeta de salida. `MEEKO_HOST`, `MEEKO_PORT` (o `PORT`) y `MEEKO_PUBLIC_ORIGIN` funcionan como en Node.

`serveDeno(app, { host, port, publicOrigin, platform, onError, maxMessageBytes, idleTimeout, handleSignals })` sirve la aplicación con `Deno.serve` y devuelve `{ url, finished, close() }`. `close()` cierra los peers de Socket con `1001`, detiene HTTP, espera las tareas de `waitUntil` y cierra la aplicación, por ese orden. Con `handleSignals`, lo hace ante `SIGINT` y `SIGTERM` (en Windows, `SIGINT` y `SIGBREAK`) y, desde `1.3`, aplica `processErrors` a los rechazos sin manejar y las excepciones no capturadas (véase [Fallos fuera de una petición](#fallos-fuera-de-una-petición)). `createDenoAssetReader({ root, assets })` sirve los archivos del manifiesto. Límites de Socket:

- `Deno.upgradeWebSocket` no ofrece un límite de frame, así que el adaptador mide cada mensaje con `maxMessageBytes` (por defecto, el límite de Socket de la aplicación o 64 KiB) y cierra con `1009` los mayores. Deno reensambla el frame en memoria antes de esa comprobación; limite el tamaño de las peticiones en el proxy si necesita un tope anterior.
- El búfer saliente se controla con el límite de búfer del hub mediante `bufferedAmount`.
- `idleTimeout` (60 s) cierra un peer que no responde al ping. Los mensajes binarios se cierran con `1003`.

### Cloudflare Workers

```sh
npx meeko build --adapter cloudflare
npx meeko preview --adapter cloudflare   # wrangler dev sobre la salida
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

El build Cloudflare escribe `.meeko/output/cloudflare/` con:

- `worker.js`: un único módulo ES que incluye `@meekojs/meeko` y las dependencias del servidor. Sólo importa `cloudflare:workers` y `node:async_hooks`, que proporciona el runtime.
- `assets/`: el build cliente y `public/`, más las páginas prerenderizadas bajo `assets/_meeko/prerender/`. El Worker lee esas páginas mediante el binding de assets y nunca las sirve como archivos; `public/_meeko/` queda reservado y detiene el build.
- `wrangler.jsonc`: la configuración generada. No la edite; se regenera en cada build.

Wrangler no vuelve a empaquetar la salida (`no_bundle: true`), así que se despliega exactamente el código que se probó. Wrangler es una herramienta de despliegue, no una dependencia de ejecución: `meeko preview` usa el de la aplicación o, en su defecto, el de la instalación de Meeko, y si no encuentra ninguno falla con «Wrangler no está instalado; añádelo con pnpm add -D wrangler…». `MEEKO_PORT` (o `PORT`) y `MEEKO_HOST` se pasan a `wrangler dev` como `--port` e `--ip`. El build y el prerender siguen ejecutándose con Node; durante el prerender, la fábrica de `server/runtime.ts` se ejecuta en Node con `prerendering: true` y sin bindings.

La configuración se declara en `meeko.config.ts`:

```ts
export default defineMeekoConfig({
  server: {
    adapter: "cloudflare",
    name: "mi-app",                     // por defecto, el nombre del package.json
    socketClassName: "MeekoSocketRoom", // clase Durable Object de las salas
    compatibilityDate: "2026-10-19",    // por defecto, la fecha con la que Meeko se prueba
    wrangler: {                         // campos adicionales de wrangler.jsonc
      d1_databases: [{ binding: "DB", database_name: "mi-app", database_id: "<id>" }],
      vars: { MEEKO_PUBLIC_ORIGIN: "https://mi-app.example" },
    },
  },
});
```

El `wrangler.jsonc` generado contiene:

- `main: "./worker.js"`, `no_bundle: true` y `find_additional_modules: false`, para que los archivos de `assets/` no se suban también como módulos del Worker.
- `compatibility_flags` con `nodejs_als`, que habilita `AsyncLocalStorage` de `node:async_hooks`, unido a los flags declarados en `server.wrangler.compatibility_flags`. `nodejs_compat` también es válido, porque incluye `AsyncLocalStorage`.
- `assets` con `directory: "./assets"`, binding `ASSETS`, `run_worker_first: true` y `html_handling`/`not_found_handling` en `"none"`. Todas las peticiones llegan al Worker, que sólo sirve los archivos listados en el manifiesto con el `ETag` y la política de caché de los demás adaptadores.
- El binding Durable Object `MEEKO_SOCKET` hacia la clase de salas, antepuesto a los bindings de `server.wrangler.durable_objects`.
- La declaración de la clase de salas (`MeekoSocketRoom`, o el nombre de `server.socketClassName`), sin reescribir nunca un historial existente. Cloudflare admite dos formas por Worker, el array `migrations` o el mapa declarativo `exports`:
  - Sin `server.wrangler.migrations` ni entradas Durable Object en `exports`, Meeko genera `migrations: [{ "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] }]`. No borre ni renombre esa migración después del primer despliegue.
  - Si declara `migrations`, el historial debe crear la clase él mismo (`new_sqlite_classes`, `new_classes` o el destino de `renamed_classes`/`transferred_classes`). Las migraciones se aplican en orden y se registran por `tag`, así que anteponer la de Meeko cambiaría un historial ya desplegado; el build se detiene con «server.wrangler.migrations does not create the Socket room class …; append { "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] } at the end of server.wrangler.migrations». Añada esa entrada al final de su historial; si `meeko-socket-v1` ya es el tag de otra migración, el mensaje propone `meeko-socket-v1-<n>`, con `<n>` igual al número de migraciones más uno.
  - Si declara Durable Objects en `exports`, Meeko añade `"MeekoSocketRoom": { "type": "durable-object", "storage": "sqlite" }` cuando falta y no genera `migrations`; una entrada propia de la clase debe estar viva (sin `state` o con `"created"`). `exports` con Durable Objects y `migrations` a la vez detienen el build, porque Cloudflare sólo acepta una de las dos formas.

`main`, `assets`, `no_bundle` y `find_additional_modules` pertenecen a Meeko y no se pueden sobrescribir, ni tampoco el binding `MEEKO_SOCKET`. El resto de campos de `server.wrangler` (`routes`, `vars`, `d1_databases`, `observability`…) se copian tal cual.

En Workers, `env` de `server/runtime.ts` es el objeto de bindings del Worker y `platform` vale `"cloudflare"`. La aplicación se crea una vez por aislado, en la primera petición, y `context.platform.waitUntil` usa `ctx.waitUntil`. La variable `MEEKO_PUBLIC_ORIGIN` fija el origen público; sin ella se usa el origen de la URL enrutada. Ejemplo con D1 para las sesiones:

```ts
// server/runtime.ts
import { D1SessionDriver, DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";
import type { D1DatabaseLike, DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";

interface Env { readonly DB?: D1DatabaseLike; readonly MEEKO_SOCKET?: DurableObjectNamespaceLike }

export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
  const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB));
  const pubsub = env.MEEKO_SOCKET ? new DurableObjectSocketPubSub(env.MEEKO_SOCKET) : undefined;
  return {
    sessions: new SessionManager({ production: production && !prerendering, store }),
    services: { pubsub },
    // Sin pubsub, el Worker usa DurableObjectSocketPubSub(env.MEEKO_SOCKET) por defecto;
    // cualquier otro broker se rechaza al crear la aplicación.
    socket: { maxMessageBytes: 16 * 1024 },
  };
});
```

#### Sesiones en D1

`D1SessionDriver(db, { table? })` implementa `SqlSessionDriver` para `SqlSessionStore`. `replace` es un único `UPDATE … WHERE id = ? AND family_id = ? AND expires_at > ?` que comprueba que haya cambiado exactamente una fila; `revokeFamily` es un `DELETE … WHERE family_id = ?`. `UNIQUE(family_id)` impide un segundo ID activo en la misma familia. `D1SessionDriver.schema(table?)` devuelve el esquema de referencia (con la tabla por defecto `meeko_sessions`):

```sql
CREATE TABLE IF NOT EXISTS "meeko_sessions" (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "meeko_sessions_expires_at" ON "meeko_sessions" (expires_at);
```

Aplíquelo como migración D1 antes de desplegar: `npx wrangler d1 migrations create <base> meeko_sessions`, copie el SQL en el archivo creado y ejecute `npx wrangler d1 migrations apply <base> --remote` (o `--local` para `wrangler dev`). Las filas caducadas se borran al leerlas; para limpiar el resto, llame a `driver.deleteExpired()` desde un Cron Trigger. D1 no notifica revocaciones a otros aislados: una conexión abierta en otro aislado detecta la revocación al releer la sesión en su siguiente evento (véase [Revocación durante una petición](#revocación-durante-una-petición)).

Desde `1.7`, `D1SessionDriver(db, { rateLimitTable: "meeko_rate_limits" })` implementa también `rateLimit`, de modo que los contadores de [`rateLimit`](#límite-de-peticiones-ratelimit) se comparten entre aislados en lugar de vivir en la memoria de cada uno (véase [Rate limit en SQL](#rate-limit-en-sql)). Es opcional, porque necesita otra tabla: sin la opción, el driver no cambia. `D1SessionDriver.rateLimitSchema(table?)` devuelve su esquema; aplíquelo en una migración, como el de las sesiones:

```sql
CREATE TABLE IF NOT EXISTS "meeko_rate_limits" (
  key TEXT PRIMARY KEY NOT NULL,
  window_ends_at INTEGER NOT NULL,
  count INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS "meeko_rate_limits_window_ends_at" ON "meeko_rate_limits" (window_ends_at);
```

La clave es el SHA-256 en base64url (43 caracteres), y cada petición limitada es un único `INSERT … ON CONFLICT(key) DO UPDATE … RETURNING`. Con `rateLimitTable`, `deleteExpired()` borra también los contadores cuya ventana terminó y devuelve el total de filas borradas.

#### Redis mediante la API REST de Upstash

Workers no abre conexiones TCP de Redis con el cliente `redis`. `RedisSessionStore` sólo necesita `get`, `set` con `PX`, `del` y `eval`, de modo que un adaptador sobre la API REST de Upstash basta. Guarde la URL y el token como secretos del Worker:

```ts
import { RedisSessionStore } from "@meekojs/meeko/server";
import type { RedisSessionClient } from "@meekojs/meeko/server";

/** Cliente mínimo de la API REST de Upstash para RedisSessionStore. */
function upstashClient(url: string, token: string): RedisSessionClient {
  const command = async (...args: Array<string | number>): Promise<unknown> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = await response.json() as { result?: unknown; error?: string };
    if (!response.ok || body.error) throw new Error(`Upstash ${String(args[0])} failed: ${body.error ?? response.status}`);
    return body.result;
  };
  return {
    get: async (key) => (await command("GET", key)) as string | null,
    set: (key, value, { PX }) => command("SET", key, value, "PX", PX),
    del: (key) => command("DEL", key),
    eval: (script, { keys, arguments: args }) => command("EVAL", script, keys.length, ...keys, ...args),
  };
}

// En la fábrica de server/runtime.ts:
const store = new RedisSessionStore(upstashClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN), { prefix: "mi-app:prod:" });
```

La API REST no mantiene una suscripción, así que no pase `subscriber`: las revocaciones se detectan al releer la sesión, como con D1.

Workers KV no sirve como store de sesiones: no ofrece operaciones atómicas de comparación ni de borrado por familia y su consistencia es eventual, por lo que no puede garantizar `replace` ni `revokeFamily`. `SessionManager({ production: true })` rechaza los stores que no implementan ambas operaciones.

#### Socket y Durable Objects

El Worker comprueba la ruta, el Origin y la autorización del canal antes del upgrade, con las mismas respuestas que el resto de adaptadores: `400`, `403` `INVALID_ORIGIN` y `404` por HTTP, y los rechazos de sesión o autorización con el cierre `4401` o `4403` (véase [WebSocket](#websocket)), que el propio Worker hace con un `WebSocketPair` sin despertar el Durable Object de la sala. Si los acepta, reenvía la conexión al Durable Object de su sala: `env.MEEKO_SOCKET.idFromName(canal + "\0" + sala)`. Cada par canal/sala es un objeto, que:

- acepta el WebSocket con la API de hibernación (`ctx.acceptWebSocket`), de modo que las conexiones inactivas no mantienen el objeto en memoria;
- guarda con `serializeAttachment` el canal, la sala, la URL, la cookie de sesión (sólo la cookie con el nombre de `SessionManager`, no el resto de la cabecera `Cookie`) y las cabeceras `origin` y `authorization`. Al despertar reconstruye cada conexión desde ese estado y el hub vuelve a autorizar. Los canales ven esas mismas cabeceras antes y después de hibernar. `keepHeaders` añade otras (en minúsculas; `"cookie"` conserva la cabecera completa). Cloudflare limita ese attachment a 16.384 bytes serializados: Meeko estima el tamaño antes de aceptar el WebSocket y, si no cabe, responde `431` y notifica el error a `onError` en lugar de abrir una conexión que se cerraría con `1011`;
- responde `pong` a un mensaje de texto `ping` sin despertar (configurable con `autoResponse`, o `false` para desactivarlo). Los pings de protocolo los responde siempre el runtime;
- cierra con `1009` los mensajes mayores que `maxMessageBytes` (por defecto, el límite de Socket de la aplicación o 64 KiB) y con `1003` los binarios.

`DurableObjectSocketPubSub(env.MEEKO_SOCKET)` es el broker por defecto en Workers: `publish` entrega el mensaje a la sala mediante RPC al Durable Object (o directamente si ya se ejecuta en él) y se resuelve cuando la sala lo acepta; la sala reparte el mensaje a sus peers en orden de publicación. Las suscripciones sólo existen dentro del Durable Object de la sala; por eso todo upgrade debe pasar por `createWorker`. Un broadcast desde una API o desde otra sala funciona igual. `runtime.socket.pubsub` sólo puede omitirse o ser un `DurableObjectSocketPubSub`: `LocalSocketPubSub`, `RedisSocketPubSub` u otro broker entregarían sólo a los suscriptores de un aislado, así que el Worker y la sala rechazan la aplicación al crearla con «Socket channels on Cloudflare Workers require DurableObjectSocketPubSub…».

Entrega en la sala:

- Cada publicación se entrega a los peers ya suscritos. Una conexión recién aceptada que todavía se está autorizando no retrasa a las demás; recibe las publicaciones posteriores a su autorización, como en el resto de adaptadores.
- Al despertar de la hibernación, la sala reconstruye las conexiones abiertas y las publicaciones esperan a que se vuelvan a autorizar, como máximo `rebuildTimeoutMs` (5000 ms por defecto) desde el inicio de cada reconstrucción; una conexión que no termina a tiempo recibe sólo las publicaciones siguientes.
- Una sala acepta como máximo `maxPendingPublications` publicaciones sin entregar (1024 por defecto). Por encima, `publish` (y por tanto `broadcast`) rechaza con `SOCKET_BACKLOG_EXCEEDED` (503) y el mensaje no se entrega.
- El nombre de la sala sale de `ctx.id.name`; cuando el runtime no lo da (nombres de más de 1.024 bytes), la sala lo toma de su primera conexión o publicación, y las publicaciones hacia ella misma siguen sin RPC.
- Los WebSockets de Workers no informan de `bufferedAmount`, así que `socket.maxBufferBytes` no se aplica en las salas; `maxMessageBytes` y `maxPendingDeliveries` siguen limitando cada peer.
- Si la aplicación no puede crearse al despertar, la sala notifica el error y cierra con `1011` el WebSocket que la despertó.

Rendimiento: un Durable Object ejecuta su código en un solo hilo, así que todos los mensajes y broadcasts de una sala se procesan en serie en un único lugar. Esto da orden y coherencia, pero limita el caudal de una sala muy concurrida; reparta el tráfico en varias salas (por ejemplo, por documento o por grupo) en lugar de una sala global. Consulte los límites vigentes de Durable Objects en la documentación de Cloudflare.

Para un Worker propio, `@meekojs/meeko/cloudflare` exporta las piezas que usa el build:

- `createWorker(app, { socketBinding?, publicOrigin?, onError? })` devuelve el handler `{ fetch }` del módulo. `app` es un `ServerApp` o una fábrica `({ env, platform }) => ServerApp | Promise<ServerApp>` que se ejecuta una vez por aislado; si falla, el siguiente evento la reintenta.
- `createSocketRoomClass(app, DurableObject, { maxMessageBytes?, autoResponse?, keepHeaders?, maxPendingPublications?, rebuildTimeoutMs?, onError? })` crea la clase de salas. `DurableObject` se importa de `cloudflare:workers` y se pasa como argumento para que el módulo se pueda cargar fuera de Workers. El Worker que genera `meeko build` usa los valores por defecto de estas opciones; para cambiar `keepHeaders`, `maxPendingPublications` o `rebuildTimeoutMs` hace falta un Worker propio.
- `DurableObjectSocketPubSub`, `socketRoomName(canal, sala)`, `D1SessionDriver`, `createCloudflareAssetReader({ binding, assets })` y `createCloudflarePrerenderSource({ binding, directory? })`.
- `ServerAppOptions.defaultSocketPubSub` fija el broker cuando `server/runtime.ts` no declara `socket.pubsub`, y `openSocketSession` de `@meekojs/meeko/server` conecta un peer ya aceptado al hub.

### Conformidad entre adaptadores

`packages/meeko/tests/conformance/` construye la misma aplicación de prueba (`tests/fixtures/conformance-app/`) con cada adaptador. Antes de arrancar la salida en su runtime real, retira las fuentes; para Bun, Deno y workerd retira también `node_modules`. La variante `workerd` construye con el adaptador `cloudflare` y ejecuta la salida con el mismo runtime local que `wrangler dev` (workerd tras el proxy de Wrangler, mediante `createTestHarness`), con D1 y Durable Objects en memoria. Las mismas aserciones cubren:

- SSR con loader y plataforma, API, RPC, CSRF y Origin;
- `404`, `405` con `Allow`, y `HEAD`, incluida la `404` de una página sin ruta con `app/error.meeko` dentro de los layouts;
- assets con `ETag`/`304` y política de caché, e intentos de traversal (`..`, `%2e%2e`, `%2f`, `%5c`) y de leer archivos del build;
- páginas prerenderizadas con la meta CSRF de la sesión;
- orden del middleware;
- Socket: ruta, Origin, autenticación, límites de tamaño, validación y binario, orden de mensajes de un peer y broadcast entre dos conexiones de una sala;
- fallos del proceso: un rechazo sin manejar llega al `onError` del runtime y la salida sigue atendiendo, y una excepción no capturada llega a `onError` y la salida termina con código 1 (salvo en workerd).

La variante `workerd` añade sesiones en D1 (también leídas desde el Durable Object de un canal privado), la hibernación forzada de una sala (`evictDurableObject` con `webSockets: "hibernate"`) seguida de mensajes en ambos sentidos, el auto-response `ping`/`pong` y un broadcast desde la API, la publicación de una sala a otra por RPC sin fugas a terceras salas, una conexión con una cabecera `Cookie` mayor que el límite del attachment, una sala cuyo nombre supera 1.024 bytes y que la salida sea un único módulo `worker.js`. La prueba de streaming pide `accept-encoding: identity`: el runtime local de Wrangler (Miniflare) emula la compresión de Cloudflare para `text/html` sin respetar `no-transform`, y su codificador gzip sólo escribe al cerrar el cuerpo, de modo que con `wrangler dev` o `meeko preview --adapter cloudflare` un navegador que acepta gzip recibe las páginas `"stream"` completas al final. Es una limitación del entorno local: en producción, la compresión de Cloudflare respeta `no-transform`.

```sh
pnpm run conformance          # node, bun, deno y workerd
pnpm run conformance:bun      # o :node / :deno / :workerd
```

Node se ejecuta siempre. Bun y Deno se buscan en `MEEKO_BUN`/`MEEKO_DENO`, después en el `PATH` y por último en una versión instalada con `mise` (`mise where bun`). Si no se encuentran, la suite se omite con un mensaje explícito. workerd llega con la devDependency `wrangler`; sin ella, su suite también se omite. `MEEKO_CONFORMANCE_REQUIRE=bun,deno,workerd` convierte esa omisión en un fallo; la CI lo usa en sus jobs de Bun, Deno y workerd.

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1` instala un tarball local en un proyecto independiente, genera tipos, construye producción, retira las fuentes de la aplicación, arranca el build Node y prueba HTTP, assets, páginas prerenderizadas con CSRF, dos sesiones, RPC/CSRF, WebSocket real y Chrome. También crea `meeko init-framework` desde ese paquete e instala, comprueba tipos y construye el starter generado. El fixture contiene páginas `/`, `/users`, `/users/[id]`, `/dashboard`, `/chat` y `/layer-demo`; sus aserciones TypeScript comprueban entradas y salidas válidas e inválidas de API, RPC, Socket, rutas y `ComponentProps` importado desde una página `.meeko` del paquete instalado.

Antes de preparar una publicación, ejecute `pnpm install --frozen-lockfile`, `pnpm run verify`, `pnpm run e2e`, `pnpm run pilot:e2e`, `pnpm run package:smoke`, `pnpm run conformance` (con Bun y Deno instalados; workerd llega con `pnpm install`), la prueba Redis anterior, `pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1`, `pnpm pack` (en `packages/meeko`) y `git diff --check`. La CI ejecuta estas familias de comprobaciones, incluida la conformidad Node, en Windows; Redis y la conformidad de Bun, Deno y workerd se ejecutan en Ubuntu. La existencia del workflow no sustituye una ejecución verde de CI. El workflow de publicación repite los gates y sólo responde a una etiqueta de versión; la decisión de crearla corresponde al mantenedor.

### Resolución de problemas de pnpm y Redis

Si pnpm 12 muestra `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, compruebe el usuario efectivo y el ACL del archivo. En un sandbox Windows restringido, `codexsandboxonline` puede carecer de escritura sobre `all-stores.lock`; `--store-dir` y `LOCALAPPDATA` por sí solos no cambian esa ubicación. No elimine el almacén ni cambie ACL globales para superar este caso. En una terminal Windows normal con acceso al perfil, `pnpm install --frozen-lockfile` funciona sin ese ajuste.

Una instalación congelada con pnpm 12.14.0 pasó en una copia limpia al aislar el perfil sólo dentro del proceso PowerShell que lanzó pnpm, con el comando exacto `pnpm install --frozen-lockfile`, sin enlaces de dependencias:

```powershell
$isolatedProfile = Join-Path (Get-Location).Path '.meeko/pnpm-profile'
$env:USERPROFILE = $isolatedProfile
$env:LOCALAPPDATA = Join-Path $isolatedProfile 'AppData/Local'
$env:APPDATA = Join-Path $isolatedProfile 'AppData/Roaming'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:APPDATA -Force | Out-Null
pnpm install --frozen-lockfile
```

Ejecute el bloque sólo en un proceso PowerShell nuevo y restringido para que las variables recuperen sus valores al salir. Una versión anterior del sandbox también produjo `uv_os_get_passwd returned ENOMEM` en `node:os.userInfo()` antes de cargar `tsx`; ese error corresponde al entorno. La verificación en Windows normal no requiere preload ni cambios en Meeko.

La prueba Redis requiere que `MEEKO_REDIS_URL` apunte a un servidor de pruebas accesible. Un error de conexión o `WRONGTYPE` debe fallar; el adaptador no concede acceso a una sesión cuando Redis no está disponible. Use un prefijo distinto por proyecto y entorno; no ejecute `FLUSHALL` ni `FLUSHDB` en un Redis compartido.

`pnpm run pilot:e2e` registra cada motor y entorno y limita sus lanzamientos. Chromium, Firefox y WebKit pasaron en desarrollo y producción en Windows normal sin cambiar las protecciones del navegador. Un sandbox restringido puede impedir que Firefox cree una página; diagnostique ese entorno con `DEBUG=pw:browser*` antes de atribuir el fallo al framework.

## Rendimiento y baseline

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1 -Benchmark` reproduce el consumidor externo, construye la aplicación mínima y escribe `packages/meeko/.meeko/benchmarks/stability-baseline.json`. El baseline conservado está en `packages/meeko/benchmarks/baseline-2026-10-24.json`. Cada tiempo usa siete muestras y dos calentamientos; el JSON contiene mediana, percentiles 10/90 y extremos. La compilación fría usa un worker nuevo por muestra; HMR mide una edición visible en Chrome con un servidor Vite nuevo por muestra. SSR y dispatchers se miden en proceso con `app.fetch` sobre el build Node de producción, incluido el middleware de servidor; SSR usa `/?benchmark=ssr` para no medir la copia prerenderizada de `/`. Las mediciones de tamaño incluyen JS y CSS comprimidos con gzip. Son medidas de esta máquina, no umbrales de CI.

La entrada cliente generada registra `meeko-hydration` en el navegador. El benchmark actual mide navegación desde el clic de un enlace hasta que aparece la nueva ruta; el baseline histórico medía una llamada directa a `mountClientApp.navigate`. Por ese cambio de método, no compare las cifras de navegación entre ambas ejecuciones como si fueran una regresión del runtime. El JSON histórico permanece intacto.

| Métrica | Mediana o tamaño | p10–p90 |
| --- | ---: | ---: |
| Compilación fría | 9.40 ms | 9.08–9.45 ms |
| Compilación tras edición | 0.87 ms | 0.53–1.14 ms |
| HMR visible | 28.63 ms | 27.19–29.11 ms |
| SSR por petición | 0.040 ms | 0.032–0.060 ms |
| Hidratación | 11.10 ms | 10.70–11.20 ms |
| Navegación cliente | 1.90 ms | 1.80–2.10 ms |
| Dispatcher API | 0.019 ms | 0.017–0.019 ms |
| Dispatcher RPC | 0.049 ms | 0.044–0.054 ms |
| Bundle motor | 19,134 B; gzip 7,222 B | — |
| Bundle mínimo | 21,314 B; gzip 6,438 B | — |
| Bundle full-stack | 36,063 B; gzip 14,897 B | — |

Tras 500 renders SSR, el heap pasó de 87,276,056 a 87,012,304 bytes después de GC; RSS máximo observado: 224,952,320 bytes. Esta muestra no prueba ausencia de fugas y debe compararse sólo bajo condiciones equivalentes.

## Compatibilidad y versionado

Las entradas públicas soportadas de la versión actual son `@meekojs/meeko`, `/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare`, `/build`, `/vite`, `/devtools-ui`, desde `1.1`, `/prettier` y, desde `1.2`, `/password` y `/postcss`. `/internal` existe para el código generado por Meeko y no es contrato de consumo directo. La compilación se ofrece mediante la CLI y Vite; la raíz pública expone la reactividad y el runtime de SSR e hidratación, pero no una función `compile`. `defineMeekoConfig`, routing, `definePage`, `useState`, `createApiClient`, `createRpcClient`, `defineSocketChannel`, `attachNodeWebSocketServer`, `RedisSessionStore` y `SqlSessionStore` conservan sus nombres actuales. Los autoimports generados `api`, `rpc`, `socket` y `useSocket` dependen del manifiesto de cada aplicación.

Meeko sigue SemVer desde `1.0`: el contrato público, lo que no es público y la política de deprecación están en [stability.md](stability.md). Una publicación requiere lockfile reproducible con el pnpm declarado, CI verde, consumidor externo y revisión del tarball. No se aumenta la versión automáticamente.

## Límites actuales

- Los adaptadores de servidor publicados son Node 24, Bun, Deno y Cloudflare Workers, y desde `1.3` el adaptador `static`, que sólo admite páginas prerenderizadas; la suite de conformidad se ejecuta con Bun 1.4.4, Deno 2.9.8 y workerd 1.20261019.1 (wrangler 4.152.0). En Workers, Socket requiere Durable Objects, las sesiones requieren D1 o Redis por la API REST de Upstash (KV no es válido) y D1 no notifica revocaciones a otros aislados.
- Redis tiene una prueba de integración con servidor real configurada en CI; su ejecución local depende de un servidor accesible. El adaptador SQL se probó con SQLite real. `RedisSocketPubSub` se prueba en la misma integración con dos procesos.
- Los canales Socket se descubren como archivos con nombre simple bajo `server/socket/`.
- Cambios en configuración o registro de autoimports fuerzan recarga completa en Vite.
- La producción requiere un store de sesiones persistente: `MEEKO_REDIS_URL` en Node, Bun y Deno, o `sessions` propias en `server/runtime.ts` (en Workers, D1 o Upstash).
- La revocación por familia invalida el ID activo ante rotaciones concurrentes, aborta `RequestContext.signal` de las peticiones en curso de esa familia y cierra sus sockets. En otras instancias, esto requiere un store con `subscribeRevocations`. El aborto es cooperativo: el código que no observa `context.signal` sigue ejecutándose hasta su siguiente comprobación, y el aviso entre instancias llega con la latencia del broker. Llame `context.session.verify()` antes de efectos irreversibles. Si la aplicación requiere orden estricto entre operaciones en curso, debe coordinarlas. Meeko evita que una respuesta anterior restaure un token CSRF ya cambiado.
- La navegación cliente es transaccional. Sin layouts compartidos, la vista nueva se hidrata junto a la actual entre marcadores privados y la anterior sólo se retira y libera después de una hidratación correcta. Con un layout conservado, el outlet restaura e hidrata de nuevo su página anterior si falla la nueva. En ambos casos la ruta visible, su URL y su estado siguen activos y `navigate()` rechaza con el error original. Sólo si también falla esa restauración, Meeko solicita una carga completa de la última URL confirmada. Durante la hidratación de la vista nueva, la anterior sigue en el documento: un `id` repetido entre ambas páginas puede resolver al elemento antiguo hasta el commit.
- Si la API de historial del navegador falla después de renderizar, Meeko solicita recargar la última URL confirmada y propaga el error original. Si también falla esa recuperación, conserva ambas causas en `AggregateError`.
