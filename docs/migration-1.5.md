# Actualizar de 1.4 a 1.5

`1.5` es un minor: lo nuevo (los layouts con nombre con `+group.ts`, `layoutProps` y `useLayout()`; `useForm` con `field`, `trySubmit`, `commit`, `onSuccess` y `focusInvalid`; `useId()`; `ApiError` con `issues`; las etiquetas HTML y `bind="obj"` en `<component is>`; `<MeekoTeleport>`, `<MeekoAwait>`, `<MeekoPopover>` y `<MeekoSelect>`; `match` en `<MeekoLink>` y `useRoute().isActive()`; `refreshing` y `keepPrevious` en `useApi` y `useRpcQuery`, y los aliases de ruta `~/`, `@/`, `#shared/` y `#server/`) es opcional. Dos cambios se publican como [excepciones aprobadas](stability.md#excepciones-aprobadas) a la política de estabilidad: `bind="…"` sin nombre deja de ser un atributo literal, y `alias` pasa a ser una clave propia de `MeekoConfig`. Además, algunos cambios se notan al actualizar: los `paths` del proyecto en los `tsconfig` generados, `MEEK108` con el `server/` de los layers, interfaces que ganan miembros, los módulos compilados de las etiquetas propias, los nombres nuevos que se autoimportan y los códigos `MEEK112` a `MEEK118`. Esta guía los reúne con lo que conviene revisar en cada uno y explica cómo adoptar cada función. La lista completa, con lo añadido y corregido, está en el [CHANGELOG](../packages/meeko/CHANGELOG.md); los compromisos de compatibilidad, en la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualice `@meekojs/meeko` a la versión exacta `1.5.0` y vuelva a compilar o construir, incluidas las páginas prerenderizadas: el código generado y el runtime deben tener la misma versión, y en `1.5` el código generado importa además los módulos de las etiquetas propias (véase [Módulos de las etiquetas propias](#módulos-de-las-etiquetas-propias)). Si usa la extensión de VS Code, actualícela a `1.5.0`; Meeko DevTools no cambia (sigue en `1.0.0`).
2. Si un módulo de `modules` declara `meta.configKey: "alias"`, cámbiela antes de arrancar: la configuración no carga (véase [Un módulo con `configKey: "alias"`](#un-módulo-con-configkey-alias)).
3. Busque `bind="` sin nombre en las plantillas y conviértalo en `bind:bind="…"` donde quería el atributo o la prop literal (véase [`bind="…"` sin nombre](#bind-sin-nombre)).
4. Ejecute `meeko check`. Revise los errores de `paths` (véase [`paths` del proyecto en los `tsconfig` generados](#paths-del-proyecto-en-los-tsconfig-generados)), los `MEEK108` nuevos con layers, los avisos `MEEK106` de un componente propio con el nombre de una etiqueta nueva y las pistas `MEEK117`, que no hacen fallar la comprobación.
5. Si implementa a mano alguna interfaz que Meeko devuelve (`RouteState`, `DataResource`, `LoadedResource`, `Form`), por ejemplo en una prueba, conviértala en un doble parcial (véase [Interfaces que ganan miembros](#interfaces-que-ganan-miembros)).

## Excepciones aprobadas

### `bind="…"` sin nombre

Desde `1.5`, `bind="…"` sin nombre en un elemento HTML estándar, en `<component is>` o en una etiqueta de componente es la directiva de [atributos en bloque](api.md#atributos-en-bloque-con-bind): el valor es una expresión que da un objeto, y sus claves se escriben como atributos o, en un componente, como props. Hasta `1.4`, `bind="texto"` era un atributo HTML literal `bind` o, en un componente, la prop estática `bind` con el texto.

`bind` no es un atributo de ningún elemento HTML estándar, así que el navegador lo ignoraba. Qué cambiar:

- **Un atributo literal `bind`** que leía un script o una hoja de estilos: escríbalo como `bind:bind="'texto'"`, o mejor con un nombre `data-*`.
- **Una prop llamada `bind`** de un componente propio: pásela con `bind:bind="'texto'"`, o renómbrela.
- **Los elementos personalizados** (con guion, como `<x-widget bind="a">`) no cambian: `bind` sigue siendo un atributo literal.

`meeko check` y el editor marcan el valor que no es un objeto (`MEEK113`).

### Un módulo con `configKey: "alias"`

Desde `1.5`, `alias` es la opción de los [aliases de ruta](framework.md#aliases-de-ruta). Un módulo cuyo `meta.configKey` es `"alias"` hace fallar la carga de la configuración en `meeko dev`, `meeko build` y `meeko check`, con un mensaje que pide otra clave, como `theme` desde `1.4`: sus opciones se leerían como aliases y su aumentación de `MeekoConfig.alias` chocaría con el tipo de Meeko.

Dé al módulo otra clave en `meta.configKey` y en su aumentación de `MeekoConfig`, y mueva sus opciones a esa clave en `meeko.config.ts`, como en [Actualizar de 1.3 a 1.4](migration-1.4.md#un-módulo-con-configkey-theme). Un módulo sin `configKey`, o con una clave que no es de Meeko, no cambia.

## Cambios que se notan al actualizar

### `paths` del proyecto en los `tsconfig` generados

`.meeko/tsconfig.app.json`, `.meeko/tsconfig.server.json` y `.meeko/tsconfig.shared.json` copian ahora los `paths` del `tsconfig.json` del proyecto. Hasta `1.4` sólo los usaban el editor y la comprobación de los componentes; ahora `meeko check` resuelve con ellos también los `.ts`. Un `paths` que apuntaba a una carpeta que ya no existe, o que sólo funcionaba por casualidad, puede dar errores nuevos de módulo no encontrado: corríjalo o quítelo.

Un patrón de esos `paths` con el prefijo de un alias de Meeko y otra carpeta (`"@/*": ["./src/*"]`) gana y desactiva ese alias de Meeko en todo el proyecto, también en sus comprobaciones de ámbito, con un aviso una vez por proceso (véase [Aliases de ruta](#aliases-de-ruta)).

### `MEEK108` con el `server/` de los layers

Un import de valores de un componente que llega al `server/` de un layer ya fallaba en el build. Desde `1.5`, `meeko check` y el editor lo marcan también con `MEEK108`, como el `server/` del proyecto. Pida esos datos al servidor con `useApi` o `useRpcQuery`, o mueva el código compartido a `shared/`.

### Interfaces que ganan miembros

Algunas interfaces de objetos que Meeko entrega a la aplicación tienen miembros nuevos y obligatorios:

| Interfaz | Miembros nuevos |
| --- | --- |
| `RouteState` (de `useRoute()`) | `isActive(to, { params, prefix })` |
| `DataResource` y `LoadedResource` (de `useApi`, `useRpcQuery` y los recursos) | `refreshing` |
| `Form` (de `useForm`) | `trySubmit`, `commit` y `field` |

[stability.md](stability.md#entradas-del-paquete) recoge desde `1.5` la regla: una interfaz que Meeko **entrega** puede ganar miembros en un minor, como una unión que Meeko entrega puede ganar miembros. Leerlas y desestructurarlas no cambia. Lo que deja de compilar es implementarlas a mano, por ejemplo en una prueba:

```ts
// Antes: falta isActive desde 1.5
const route: RouteState = { url, path, id, params, search };

// Después: un doble parcial, que sigue compilando cuando la interfaz crece
const route = { url, path, id, params, search } as Partial<RouteState> as RouteState;
```

### Módulos de las etiquetas propias

`<MeekoThemeToggle>`, `<MeekoAwait>`, `<MeekoPopover>` y `<MeekoSelect>` son módulos propios, `@meekojs/meeko/builtins/theme-toggle`, `/await`, `/popover` y `/select`, que el compilador importa sólo en los componentes que usan la etiqueta: el resto de la aplicación no carga su código. En `1.4`, `<MeekoThemeToggle>` salía de `@meekojs/meeko/internal`, que ya no lo exporta. Por eso un componente compilado con `1.4` que usa `<MeekoThemeToggle>` no funciona con el runtime de `1.5`: vuelva a compilar, como en cada actualización. `@meekojs/meeko/builtins/*` es, como `/internal`, un contrato entre el compilador y el runtime de la misma versión exacta: no lo importe a mano (véase [stability.md](stability.md)).

Si su configuración de Vite enumera módulos de `@meekojs/meeko` (en `optimizeDeps` o en `manualChunks`), tenga en cuenta también `@meekojs/meeko/builtins/*`. `meeko dev` ya optimiza esos módulos de antemano cuando Vite optimiza Meeko, así que la primera visita a una página con `<MeekoAwait>` no recarga.

### Etiquetas propias nuevas y `MEEK106`

`<MeekoTeleport>`, `<MeekoAwait>`, `<MeekoPopover>` y `<MeekoSelect>` son etiquetas propias de Meeko, sin import. Un componente del proyecto con uno de esos nombres (en `app/components`, de un módulo, importado o declarado en el `<script>`) sigue siendo esa etiqueta, con sus props, y no la de Meeko; `meeko check`, `meeko build` y el editor lo avisan con `MEEK106`, que no hace fallar la comprobación. Renómbrelo si quiere usar la etiqueta propia.

### Nombres nuevos que se autoimportan

`useId`, `useLayout`, `defineGroup`, `ClientError`, `isClientError` y los tipos `LayoutProps`, `MeekoAwaitProps`, `MeekoTeleportProps`, `MeekoPopoverProps`, `MeekoSelectProps` y los de sus partes se autoimportan donde corresponde (`ClientError` e `isClientError`, en los componentes y en los módulos de `app/`, no en `server/`, `*.server.ts` ni los archivos de ruta). Un export propio con el mismo nombre en las carpetas de autoimports, o un import o una declaración del archivo, tiene prioridad, así que el código existente no cambia.

### `<component is>` con contenido

Hasta `1.4`, un `<component is>` con contenido daba `MEEK031`. Ahora su contenido son los snippets del componente, como en su etiqueta, o los hijos de la etiqueta HTML (véase [`<component is>` con etiquetas HTML](#component-is-con-etiquetas-html)). `MEEK031` queda para una etiqueta vacía (`img`, `input`…) con contenido. En un `<component is>` cuya expresión puede dar una etiqueta, los atributos con guiones, que antes daban `MEEK032`, son del elemento. Un `<component is>` cuyos resultados son componentes compila igual que antes.

### `useForm` revalida los campos con error

Cada cambio de un campo vuelve a validar también los demás campos que tienen un error del schema (y el mensaje del formulario que vino del schema): una confirmación de contraseña deja de mostrar «Las contraseñas no coinciden» en cuanto se corrige la contraseña. Los mensajes del servidor de otros campos se conservan. Si una prueba esperaba que el error de otro campo siguiera visible tras el cambio, actualícela.

### Señales con `undefined` en el SSR

`const id = signal<string | undefined>(undefined)` hacía responder `500` a toda la página. Ahora el estado lleva esas señales aparte y el navegador las hidrata como `undefined`. Un valor que JSON sigue sin representar (una fecha, un `Map`, una instancia) falla con el componente, la señal y una pista; guarde una fecha como texto ISO y un `Map` como objeto.

## Adoptar las funciones nuevas

### Layouts con nombre y `+group.ts`

Cada `app/layouts/<nombre>.meeko` es un layout con nombre que la página elige en sus opciones de ruta; sin `layout` se usa el de sus `+group.ts` o `default`, como hasta ahora:

```ts
// app/pages/connections.route.ts (o export const route en <script server>)
export const route = definePage({ layout: "dashboard" });
```

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false } });
```

`layout: false` deja sólo `app/app.meeko` y los `+layout.meeko`. `layout` y el contenido de `+group.ts` son literales: Meeko los lee sin ejecutar el archivo, como `render`. Para migrar un grupo con su propio layout, como `app/pages/(dashboard)/+layout.meeko`, mueva el archivo a `app/layouts/dashboard.meeko` y añada el `+group.ts` de arriba: el layout ya no se anida dentro de `default`, sino que lo sustituye. Al navegar entre dos páginas con el mismo layout, éste sigue montado con su estado. Un `+group.ts` fuera de `app/pages` es `MEEK115`. Véase [Layouts con nombre](framework.md#layouts-con-nombre).

### Props del layout: `layoutProps` y `useLayout`

La página pasa props tipadas contra las del layout elegido con `layoutProps` (un objeto o una función del contexto, como `head`), que llegan al HTML del servidor desde el primer byte, o las cambia desde su `<script>` con `useLayout()`, sin volver a montar el layout:

```ts
export const route = definePage({ layout: "dashboard", layoutProps: ({ data }) => ({ title: data.user.name }) });
```

```html
<script lang="ts">
const layout = useLayout();
const failing = signal(false);
effect(() => layout.set({ showAlert: failing.value }));
</script>
```

Viajan en el payload: una prop con `undefined` deja la prop en el valor por defecto del layout, y una que JSON no representa hace fallar la página con un error que nombra la página, el layout y la prop. Las props de un layout con nombre deben ser opcionales o tener valor por defecto. Al navegar, el layout recibe las de la página nueva: nada queda de la anterior. Un layout que usa `<MeekoOutlet />` ya no necesita declarar `outlet` en sus props. Para poner markup de la página en una zona del layout, use `<MeekoTeleport>`. Véase [Props del layout desde la página](framework.md#props-del-layout-desde-la-página).

### `useForm`: `field`, `trySubmit`, `commit` y `focusInvalid`

- **`form.field(name)`** devuelve un `FormField` tipado (la señal, el nombre, los IDs de `useId`, el mensaje, `invalid` y `describedBy`) para un componente de campo propio: `<AppField bind:field="form.field('email')" label="Correo" />`. Un componente de campo que sirve dentro y fuera de un formulario declara `field` opcional y el modelo por defecto con opciones sin nombre, `defineModel<string>({ default: "" })`, para que también sea opcional, y lee `computed(() => props.field?.value ?? model)`. Véase [Componentes de campo: `FormField`](framework.md#componentes-de-campo-formfield).
- **`form.trySubmit(event)`** envía como `submit`, pero resuelve con un `FormSubmission` (`{ ok: true, result }` o `{ ok: false, reason: "invalid" | "error" | "skipped" }`) y nunca rechaza. `submit` no cambia.
- **`form.commit(values?)`** toma los valores como nuevos iniciales de `dirty` y de `reset()`, sin borrar `submitted`; la opción `onSuccess(result, form)` se ejecuta tras un envío correcto, por ejemplo para llamar a `commit`.
- **`focusInvalid: true`** mueve el foco al primer control inválido tras un envío con errores en los campos, del schema o de los `issues` del servidor.

Véase [Formularios: `useForm`](framework.md#formularios-useform).

### `useId`

`useId()` (autoimportado en los `.meeko`) devuelve un ID para `id`, `for` o `aria-describedby` que coincide entre el HTML del servidor y la hidratación y no se repite entre instancias, también en las filas de `each:` y en las regiones que aparecen después. Llámelo en el script del componente, antes de cualquier `await`; `document.idPrefix` en `meeko.config.ts` cambia su prefijo (`m` por defecto). Sustituye a los contadores propios, que daban IDs distintos en el servidor y en el navegador. Véase [IDs estables: `useId`](api.md#ids-estables-useid).

### `ApiError` con `issues`

Un error que pertenece a un campo, como un correo que ya tiene cuenta, lleva `issues` con el tercer argumento de `ApiError`:

```ts
throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
```

Se envían con la forma de los de un `400` (como mucho 20, sólo con un estado `4xx`), llegan en `ClientError.issues` y `useForm` los pone en su campo. El tercer argumento como texto sigue siendo el mensaje interno. Sólo viajan los `issues` de un `ApiError` de Meeko: los de otro error con su forma (el `ApiError` de un SDK, un `ClientError` de otro servicio que el handler deja escapar) no salen. Véase [Errores de un campo](framework.md#errores-de-un-campo-apierror-con-issues).

### `<component is>` con etiquetas HTML

`is` acepta también una etiqueta HTML (un literal, una unión de etiquetas como `props.href ? 'a' : 'button'` o una unión de etiquetas y componentes), con sus atributos, eventos, `ref:` y su contenido. Un botón que se convierte en enlace se escribe con una sola plantilla, y los atributos que no son globales sólo se escriben mientras la etiqueta del momento los admite:

```html
<component is="props.href ? 'a' : 'button'" class="button" bind="state.value" on:click="onClick"
  bind:href="props.href" bind:target="props.target" bind:type="props.type" bind:disabled="props.disabled">
  <render snippet="snippets.default" />
</component>
```

`bind="obj"` escribe las claves de un objeto como atributos (o props) de forma reactiva; las explícitas ganan, las claves `on*` y `data-meeko*` se rechazan y los nombres se comparan sin distinguir mayúsculas. Véase [Etiquetas HTML en `<component is>`](api.md#etiquetas-html-en-component-is) y [Atributos en bloque con `bind`](api.md#atributos-en-bloque-con-bind).

### `<MeekoTeleport>`

`<MeekoTeleport to="#toolbar">…</MeekoTeleport>` pinta su contenido dentro del elemento con ese `id` (o al final de `<body>` con `to="body"`) sin sacarlo del componente: sus señales, eventos, `provide`/`inject` y `<style scoped>` siguen funcionando y se libera con él. El HTML del servidor ya lo trae en su destino. Sustituye a mover nodos a mano en `onMounted`. Véase [`<MeekoTeleport>`](framework.md#meekoteleport), que explica también cuándo bastan `<dialog>` o `popover`.

### `<MeekoAwait>`, `refreshing` y `keepPrevious`

Para los datos de un `useApi` o un `useRpcQuery` sin `await`, `<MeekoAwait>` pinta el estado de carga, el error con un reintento y el contenido, y con `reserve` guarda la altura que tuvo la zona para que no salte en la próxima visita:

```html
<MeekoAwait for="items" reserve>
  <snippet name="pending"><p class="skeleton">Cargando…</p></snippet>
  <ul><li each:of="items.data.value" each:as="item">{item.name}</li></ul>
</MeekoAwait>
```

Dentro, `meeko check` lee `items.data.value` como cargado, sin `!`. Sustituye a los `if:when="items.pending.value"` y a los `min-height` fijos. `refreshing` es `true` mientras `refresh()` o un cambio de la entrada recargan con datos; con `{ keepPrevious: false }` un cambio de la entrada vuelve a ser una primera carga. Véase [`<MeekoAwait>`](framework.md#meekoawait) y [Evitar saltos de altura (CLS)](framework.md#evitar-saltos-de-altura-cls).

### `<MeekoLink match>` y `useRoute().isActive()`

Para marcar la sección de la navegación, `<MeekoLink to="/dashboard" match="prefix">` lleva `aria-current="page"` en su ruta y `aria-current="true"` en las que están por debajo (`/dashboard/stats`, no `/dashboards`); `match="exact"` es el valor por defecto y el comportamiento de antes. Para un enlace o un componente propio, `useRoute().isActive(to, { params, prefix })` aplica la misma regla y devuelve `"page"`, `"true"` o `false`, listo para `bind:aria-current`. Sustituye a comparar `useRoute().path` a mano. Véase [Ruta actual](framework.md#ruta-actual).

### `<MeekoPopover>` y `<MeekoSelect>`

`<MeekoPopover>` es un popover accesible sobre la API nativa `popover` y *CSS anchor positioning* (menús, diálogos no modales y tooltips con `mode="hint"`), y `<MeekoSelect>` un select accesible construido sobre él, cuyo `model` toma el tipo de `options`, con búsqueda, grupos, selección múltiple y `bind:field` de `useForm`. Ninguno trae estilos visuales y ambos funcionan con una CSP sin `'unsafe-inline'`. El snippet `anchor` de `<MeekoPopover>` acepta un disparador propio con `bind="trigger"`. Véase [Popover](api.md#popover-meekopopover) y [Select](api.md#select-meekoselect).

### Aliases de ruta

Sin configuración, `~/` es la raíz del proyecto, `@/` es `app/` (al revés que en Nuxt, a propósito), `#shared/` es `shared/` y `#server/` es `server/`, en `meeko dev`, `meeko build`, `meeko check` y el editor:

```ts
import { formatDate } from "#shared/dates";
import * as Card from "@/components/Card.meeko";
```

- **Ámbitos.** Cada alias tiene el ámbito de su carpeta: `#server/` fuera del código de servidor es `MEEK108`, y `@/` en `shared/` es `MEEK118`.
- **`alias` en `meeko.config.ts`** añade aliases, cambia los de Meeko o los quita: `alias: { "ui/": "app/components/ui/", "#server/": false }`.
- **Contratos.** Los schemas de API, RPC y Socket se importan también con un alias (`#shared/schemas/auth`), y los clientes generados los resuelven.
- **Si ya tenía aliases propios.** Un patrón de los `paths` del `tsconfig.json` con el mismo prefijo y otra carpeta, un `resolve.alias` de Vite que cubre ese prefijo (del proyecto o de un módulo) o una entrada de `"imports"` de `package.json` con `#shared/` o `#server/` ganan y desactivan ese alias de Meeko en todas partes, incluidas sus comprobaciones de ámbito, con un aviso. Si el suyo apunta a la misma carpeta que el de Meeko, no cuenta como redefinición. Para quitar el aviso, desactive el alias de Meeko con `alias: { "@/": false }`.

Véase [Aliases de ruta](framework.md#aliases-de-ruta).

## Códigos nuevos

| Código | Dónde | Qué señala |
| --- | --- | --- |
| `MEEK112` | Compilador, `meeko check`, editor y ejecución | Una etiqueta que `<component is>` no puede renderizar (`script`, `style`, `iframe`…: error de compilación con un literal, de tipos con una expresión y `TypeError` en ejecución), o un atributo que no admite ninguna de sus etiquetas posibles. |
| `MEEK113` | `meeko check`, editor y ejecución | El valor de `bind="…"` que no es un objeto, una clave `on*` o `data-meeko*`, o una clave que no es una prop del componente. |
| `MEEK114` | Compilador | Un `to` estático de `<MeekoTeleport>` que no es `"body"` ni `"#id"`. |
| `MEEK115` | `meeko check` | Un `+group.ts` fuera de `app/pages`. |
| `MEEK116` | Compilador | `<MeekoAwait>` sin `for`. |
| `MEEK117` | `meeko check`, `meeko build` y editor (pista) | Una página o un layout que pinta en un `each:of` los datos de un `useApi` o un `useRpcQuery` sin `await` sin ocuparse de su carga. No hace fallar la comprobación. |
| `MEEK118` | `meeko check`, `meeko dev` y build | `@/` (o un alias de `app/`) en `shared/`, que no ve `app/`. |

## Editor

La extensión de VS Code `1.5.0` colorea `<MeekoAwait>`, `<MeekoTeleport>`, `<MeekoPopover>`, `<MeekoSelect>` y `bind="…"` sin nombre, e incluye el servidor de lenguaje de Meeko `1.5`: completado y hover de las etiquetas nuevas, de `layout:` y `layoutProps`, de `match` y de los aliases (carpetas y archivos tras el alias, e «Ir a la definición»), los tipos de `<MeekoSelect>` inferidos de `options` y los diagnósticos nuevos. Con `meeko.languageServer.preferWorkspace` (activado por defecto) usa el servidor del `@meekojs/meeko` del proyecto, así que lo nuevo llega al actualizar el paquete a `1.5`. Véase [Editores](editors.md).
