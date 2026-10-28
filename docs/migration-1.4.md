# Actualizar de 1.3 a 1.4

`1.4` es un minor: lo nuevo (el tema claro/oscuro con `theme`, `useTheme()` y `<MeekoThemeToggle>`, `data-theme-choice`, `if:when` en `<snippet>`, los tipos con el nombre de cada componente, `defineSnippets` con `Snippet<Args>`, `MeekoLinkProps` y `RouteId`, los autoimports en los módulos de `@utilities` y la CSP con hashes de estilos) es opcional. Un cambio se publica como [excepción aprobada](stability.md#excepciones-aprobadas) a la política de estabilidad: un módulo no puede usar como `meta.configKey` una clave propia de `MeekoConfig`, y `theme` lo es desde esta versión. Además, algunos cambios se notan al actualizar: los autoimports y la ejecución de la configuración al generar el CSS de `@utilities`, el objeto `snippets` de un hijo, el aviso `MEEK106` de un componente propio llamado `MeekoThemeToggle`, el completado del editor y `meeko dev` con un Meeko enlazado. Esta guía los reúne con lo que conviene revisar en cada uno. La lista completa, con lo añadido y corregido, está en el [CHANGELOG](../packages/meeko/CHANGELOG.md); los compromisos de compatibilidad, en la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualice `@meekojs/meeko` a la versión exacta `1.4.0` y vuelva a compilar o construir, incluidas las páginas prerenderizadas: el código generado y el runtime deben tener la misma versión. Si usa la extensión de VS Code, actualícela a `1.4.0`; Meeko DevTools no cambia (sigue en `1.0.0`).
2. Si un módulo de `modules` declara `meta.configKey: "theme"` (como el ejemplo de módulos de la guía de `1.3`) u otra clave de `MeekoConfig`, cámbiela antes de arrancar: la configuración no carga (véase [Un módulo con `configKey: "theme"`](#un-módulo-con-configkey-theme)).
3. Ejecute `meeko check`. Un componente propio llamado `MeekoThemeToggle` da ahora el aviso `MEEK106`, que no hace fallar la comprobación (véase [`<MeekoThemeToggle>`, `MEEK106` y `MEEK111`](#meekothemetoggle-meek106-y-meek111)).
4. Si usa `@meekojs/meeko/postcss` en un proyecto Meeko, regenere el CSS y revise los avisos de PostCSS: los módulos de `@utilities` reciben autoimports y el plugin ejecuta `meeko.config.*` y los `setup` de sus módulos (véase [Autoimports en `@utilities`](#autoimports-en-utilities)).
5. Si activa `theme`, retire el script de tema que tuviera en `<head>` y revise la CSP, la caché de las páginas SSR y el CSS (véase [Tema claro/oscuro](#tema-clarooscuro)).

## Excepción aprobada

### Un módulo con `configKey: "theme"`

Desde `1.4`, `theme` es la opción del tema claro/oscuro de Meeko. El ejemplo de módulos de la guía de `1.3` definía un módulo de tema con `meta.configKey: "theme"`, opciones `{ initial, storageKey }` y una aumentación de `MeekoConfig.theme`. Ese módulo ya no puede convivir con la opción de Meeko: leería como sus opciones las del tema de Meeko, su aumentación choca con el tipo de Meeko (`TS2717`) y unas opciones suyas en `theme` activarían el tema de Meeko o no pasarían su validación.

Por eso, desde `1.4`, un módulo cuyo `meta.configKey` es una clave propia de `MeekoConfig` (`layers`, `extends`, `modules`, `imports`, `server`, `css`, `document`, `dev`, `site`, `sitemap`, `robots` o `theme`) hace fallar la carga de la configuración en `meeko dev`, `meeko build` y `meeko check`:

```text
Meeko module @acme/meeko-theme uses meta.configKey "theme", which is an option of Meeko itself since 1.4: give the module another configKey and move its options in meeko.config.* to that key (see docs/migration-1.4.md)
```

Y unas opciones de ese módulo escritas en `theme` fallan antes, al validar la configuración, con `theme: unknown field initial` y una explicación que apunta a este conflicto.

Qué cambiar:

- **En el módulo**, otra clave en `meta.configKey` y en su aumentación de `MeekoConfig`:

  ```ts
  // Antes
  declare module "@meekojs/meeko/framework" {
    interface MeekoConfig { readonly theme?: Partial<ThemeOptions> }
  }
  export default defineMeekoModule<ThemeOptions>({ meta: { name: "@acme/meeko-theme", configKey: "theme" }, /* … */ });

  // Después
  declare module "@meekojs/meeko/framework" {
    interface MeekoConfig { readonly acmeTheme?: Partial<ThemeOptions> }
  }
  export default defineMeekoModule<ThemeOptions>({ meta: { name: "@acme/meeko-theme", configKey: "acmeTheme" }, /* … */ });
  ```

- **En `meeko.config.ts`**, sus opciones bajo la clave nueva: `theme: { initial: "dark" }` pasa a `acmeTheme: { initial: "dark" }`. Las opciones de `[módulo, opciones]` en `modules` no cambian.
- **O sustituya el módulo por `theme`** (véase [Si ya tenía un tema propio](#si-ya-tenía-un-tema-propio)). Si el módulo añadía su propio `useTheme` con `addAutoImports`, ése sigue teniendo prioridad sobre el de Meeko mientras el módulo esté en `modules`.

Un módulo sin `configKey`, o con una clave que no es de Meeko, no cambia.

## Tema claro/oscuro

### Qué añade `theme` al activarlo

Sin `theme` en `meeko.config.ts`, nada cambia: no hay script ni estilo en `<head>`, ni cookie, ni cabeceras, ni `POST /_meeko/theme`. Con `theme: true` (o sus opciones), Meeko añade:

- **En `<head>`, un script en línea y bloqueante** que aplica el tema guardado antes del primer pintado, justo después de las `meta` y antes de las hojas de estilo enlazadas, y un `<style>` mínimo (sólo `display: none`) para los iconos de `<MeekoThemeToggle>`. En SSR llevan el nonce de `DocumentOptions.nonce`; en las páginas prerenderizadas y el adaptador `static`, sus hashes entran en `scriptHashes` y `styleHashes` y en la CSP que escribe `static`. Si sirve el HTML con una CSP propia sin `'unsafe-inline'`, permítalos por nonce o por hash (véase [CSP con hashes](framework.md#csp-con-hashes)).
- **En `<html>`, el tema** (`data-theme="dark"` o, con `attribute: "class"`, una clase) y la elección en `data-theme-choice`. Con `"class"`, el runtime sólo cambia la clase del tema y conserva las demás, también las que añaden otros scripts.
- **Una cookie**, `meeko-theme` por defecto (`cookie`), y la misma clave en `localStorage` (`storageKey`, que por defecto toma el nombre de la cookie). Las cookies son por host, no por puerto: en desarrollo, las aplicaciones de `localhost` comparten `meeko-theme` aunque usen puertos distintos; dé a cada una su `cookie` para separarlas.
- **Cabeceras en los documentos SSR**: `Vary: Cookie, Sec-CH-Prefers-Color-Scheme`, `Accept-CH: Sec-CH-Prefers-Color-Scheme` y, con la elección `"system"`, `Critical-CH` (sin `clientHints`, sólo `Vary: Cookie`). Si un proxy o una CDN cachea páginas SSR, debe incluir la cookie del tema en la clave o no cachearlas. Las páginas prerenderizadas y `static` no varían por el tema.
- **`POST /_meeko/theme`**, el endpoint del formulario de `<MeekoThemeToggle>` sin JavaScript. Sólo existe con `theme`; en los demás métodos responde `405`.

Véase [Tema claro/oscuro sin parpadeo](framework.md#tema-clarooscuro-sin-parpadeo).

### Si ya tenía un tema propio

Retire el script que aplicaba el tema en `<head>` (por ejemplo, el de `document.head.script` o el de un módulo con `meeko.addHead`) y el código que escribía el atributo: `theme` hace lo mismo y además lo escribe el servidor. El script de Meeko lee la cookie, después `localStorage` y por último `default`, así que una elección guardada sólo en `localStorage` sigue valiendo y vuelve a la cookie. Si su script usaba otra clave de `localStorage`, indíquela en `storageKey` (`theme: { storageKey: "theme" }`) y los visitantes conservan su elección, siempre que los valores guardados sean nombres de `themes` o `"system"`.

`useTheme()` se autoimporta en los `.meeko`; un export propio con ese nombre en las carpetas de autoimports, o el `useTheme` de un módulo, tiene prioridad, así que su composable sigue funcionando hasta que lo retire.

### `data-theme-choice`

Con `theme`, `<html>` lleva además la elección del usuario, `"system"` incluido: `data-theme-choice="system"` mientras `data-theme` dice el tema efectivo. La escribe el script de `<head>` antes del primer pintado, el servidor cuando la conoce por la cookie y el runtime con cada cambio. Sirve para el CSS propio, use o no `<MeekoThemeToggle>`. Si su aplicación ya usaba un atributo con ese nombre en `<html>`, renómbrelo; `theme.attribute` tampoco puede ser `"data-theme-choice"`. Véase [`data-theme-choice`](framework.md#data-theme-choice).

### `<MeekoThemeToggle>`, `MEEK106` y `MEEK111`

`<MeekoThemeToggle>` es una etiqueta propia de Meeko, como `<MeekoLink>`, sin import: un selector de tema que funciona sin JavaScript. Usarla sin `theme` es el error `MEEK111`. `meeko dev` y `meeko build` lo saben por la configuración, que ejecutan; `meeko check` y el editor leen `theme` de `meeko.config.*` sin ejecutarlo y, cuando así no se sabe (un `theme` que es una variable, una configuración que no es un literal o una carpeta sin `meeko.config.*`, como un layer con su propio `package.json`), no avisan: el componente da el mismo error al renderizarse.

Un componente del proyecto llamado `MeekoThemeToggle` (en `app/components`, de un módulo, importado o declarado en el `<script>`) sigue siendo esa etiqueta, con sus props, y no la de Meeko; `meeko check`, `meeko build` y el editor lo avisan con `MEEK106`. Renómbrelo si quiere usar la etiqueta propia. Su `MeekoThemeToggleProps` autoimportado son también sus props. Véase [`<MeekoThemeToggle>`](framework.md#meekothemetoggle).

## Snippets

### `if:when` en `<snippet>` y `MEEK110`

`<snippet name="footer" if:when="snippets.actions">…</snippet>` pasa el snippet al hijo sólo mientras la condición es verdadera. Hasta `1.3`, cualquier atributo de `<snippet>` salvo `name` y `params` era `MEEK061`, así que ningún código existente cambia de significado. Sólo vale para un snippet que el hijo declara opcional (`x?:`): en uno obligatorio es el nuevo error de tipos `MEEK110` de `meeko check` y del editor, marcado en `if:when`. `MEEK061` señala además un `if:when` vacío o sin valor. Véase [Snippets con `defineSnippets`](api.md#snippets-con-definesnippets).

### El objeto `snippets` de un hijo

Para que un `<snippet if:when>` del padre llegue a un hijo montado sin volver a montarlo, el objeto que devuelve `defineSnippets()` en un hijo con props reactivas sigue al padre: cada lectura de `snippets.x` en la plantilla, en un `computed` o en un `effect` se actualiza cuando el padre empieza o deja de pasar ese snippet. En `1.3` era un objeto congelado con los snippets del primer render. Qué revisar:

- **Un valor copiado en el setup** (`const hasFooter = Boolean(snippets.footer)`) conserva el inicial, como una prop copiada: léalo en la plantilla o en un `computed`.
- **Sigue siendo de sólo lectura:** asignar, definir o borrar una clave lanza `TypeError`. Ya no es un objeto congelado, así que `Object.isFrozen(snippets)` devuelve `false`.
- **Los hijos sin props reactivas** (con un `await` de datos en el nivel superior, o compilados antes de `1.2`) se vuelven a montar cuando cambia un snippet, conservando sus señales editables por nombre, como con las props.

### `defineSnippets` con `Snippet<Args>`

El valor de cada clave de `T` puede ser, además de una tupla, un `Snippet<Args>`. Así `T` parte del mapa de snippets de otro componente: `defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>()`, o el `ComponentSnippets` importado de un `.meeko`, que en `1.3` era el error `TS2344`. Las declaraciones con tuplas tienen el mismo tipo que antes.

## Tipos

### Tipos de cada componente

Cada componente autoimportado aporta sin import `<Nombre>Props`, `<Nombre>Snippets`, `<Nombre>Models` y `<Nombre>Exposed`: `app/components/App/Card.meeko` da `AppCardProps`, `AppCardSnippets`, `AppCardModels` y `AppCardExposed`. Son nombres nuevos en el ámbito de `app/` (los `.meeko` y los `.ts` de `app/`, no `shared/`), declarados en `.meeko/types/autoimports/`. Un autoimport del proyecto con el mismo nombre (por ejemplo, un `AppCardProps` de `app/types`) tiene prioridad sin aviso, y un import o una declaración del archivo prevalecen como siempre, así que el código existente no cambia. Véase [Tipos de cada componente](framework.md#tipos-de-cada-componente).

### `MeekoLinkProps`, `MeekoOutletProps`, `MeekoThemeToggleProps` y `RouteId`

`@meekojs/meeko/framework` exporta los tipos de las props de sus etiquetas y `RouteId`, el ID de cualquier ruta de la aplicación. Se autoimportan: los de las etiquetas con el ámbito de `AppCardProps`, y `RouteId` en todo el proyecto, como `href`. Un tipo del proyecto con uno de esos nombres tiene prioridad, y un componente del proyecto que sustituye una etiqueta (`app/components/MeekoLink.meeko`, con `MEEK106`) aporta su propio `MeekoLinkProps`. Con ellos, un componente recibe una ruta sin import (`defineProps<{ href: MeekoLinkProps["to"] }>()` o `RouteId`) y `meeko check` comprueba que el padre le pasa una ruta que existe.

## Configuración y build

### Autoimports en `@utilities`

En un proyecto Meeko (una carpeta con `meeko.config.*` o un `package.json` que depende de `@meekojs/meeko`), `meekoUtilities()` aplica al módulo de `@utilities` y a los módulos locales en TypeScript que importa los autoimports de valores de `app/` y `shared/` (con `imports.appDirs`, `imports.sharedDirs`, los layers y los módulos), cuando el módulo se empaqueta con rolldown (Vite 8). Qué revisar:

- **Un nombre libre que antes era un global** (por ejemplo, una constante leída con `typeof NOMBRE === "undefined"`) se resuelve ahora al export del proyecto con ese nombre, si lo hay.
- **La configuración se ejecuta al generar el CSS.** Para leer el registro, el plugin ejecuta `meeko.config.*` y los `setup` de sus módulos, como `meeko dev`, una vez por hoja. Si un `setup` tiene efectos (escribir archivos, contactar un servicio), también ocurren entonces. Si la configuración o un `setup` lanza, la hoja se genera sin autoimports y PostCSS muestra un aviso con el motivo.
- **Lo que no llega** (exports de `server/` y `serverDirs`, `.client.ts` y `.server.ts`, componentes, clientes generados y las API del framework como `signal` o `useState`) da, al usarse, un error que nombra el autoimport, su origen y el motivo.

`meekoUtilities({ autoImports: false })` vuelve al comportamiento de `1.3`: sin autoimports y sin ejecutar la configuración. Fuera de un proyecto Meeko o sin rolldown tampoco cambia nada. Véase [Utilidades generadas con TypeScript](framework.md#utilidades-generadas-con-typescript).

### CSP con hashes de estilos

`inlineStyleHashes(html)` de `@meekojs/meeko/build` calcula el SHA-256 de cada `<style>` en línea, el índice de prerender los guarda en `pages[ruta].styleHashes` y `contentSecurityPolicy(policy, scriptHashes, styleHashes)` acepta un tercer argumento. El adaptador `static` los aplica a `server.contentSecurityPolicy`: añade los hashes a `style-src-elem`, a `style-src` o a una copia de `default-src`, salvo que la directiva ya admita `'unsafe-inline'`. Si su sitio `static` tiene una política sin `'unsafe-inline'` para estilos, la cabecera que genera cambia: incluye los hashes de los `<style>` en línea de cada página (el del tema y los de los componentes). Si compara o fija esa cabecera en otro sitio (un proxy, una prueba), actualícela. Véase [CSP con hashes](framework.md#csp-con-hashes).

## Desarrollo

### `meeko dev` con un Meeko enlazado

Con `@meekojs/meeko` enlazado (`link:` de pnpm, `npm link` o un workspace), `meeko dev` sólo se reinicia por escrituras, creaciones y borrados de `dist/` y `package.json` del paquete: en Windows, leer un build de hace más de una hora ya no lo reinicia. Con `MEEKO_LINK_WATCH=0`, que desactiva el reinicio, el servidor conserva el código de Meeko que cargó mientras el navegador recibe el `dist/` nuevo; ahora lo avisa en la terminal, una vez por reconstrucción, para que reinicie `meeko dev` antes de comprobar el resultado. Véase [Crear una aplicación](framework.md#crear-una-aplicación).

## Editor

La extensión de VS Code `1.4.0` incluye el servidor de lenguaje de Meeko `1.4`. Cambios visibles:

- **Completado filtrado.** El completado del `<script>` y de la plantilla ya no ofrece los tipos auxiliares del código virtual (`__MeekoEmit`…), las rutas internas de un `@meekojs/meeko` enlazado, los globales y módulos de Node (`__dirname`, `process`, `userInfo` de `os`…), que no existen en el navegador, ni los exports del componente compilado (`renderToString`, `hydrate`…). `<script server>` conserva los de Node. Los exports de los paquetes van después de los nombres locales y de los autoimports del proyecto.
- **Comprobación del proyecto.** `MEEK_PROJECT_CHECK` se actualiza al guardar, crear, borrar o renombrar cualquier `.meeko`, módulo, configuración o carpeta de la aplicación, con el texto sin guardar de los archivos abiertos; un `.meeko` vacío ya no deja el error en todos los archivos.
- **Etiquetas propias y tipos.** El hover de `<MeekoLink>`, `<MeekoOutlet />` y `<MeekoThemeToggle>` muestra su ficha con los tipos reales, los tipos de cada componente se completan sin import y `MEEK110` y `MEEK111` se marcan en su línea. Con un `@meekojs/meeko` anterior a `1.4`, la ficha de las etiquetas usa la descripción incluida en el servidor. Véase [Editores](editors.md).

## Repositorio: ESLint

El repositorio de Meeko añade ESLint (`pnpm lint`, con `eslint.config.ts`) para su propio código. No cambia nada para las aplicaciones: el paquete publicado no incluye ESLint ni su configuración, y los `.meeko` los siguen validando el compilador y `meeko check`. Véase [CONTRIBUTING](../CONTRIBUTING.md).
