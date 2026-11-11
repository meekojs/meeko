# Layouts: detalles técnicos

Contratos completos y casos especiales. Para los usos habituales, empieza por la [guía breve](routing-layouts.md).

## Layouts con nombre

Desde `1.5`, cada `app/layouts/<nombre>.meeko` es un layout con nombre: `default`, `dashboard`, `auth`, `blank`… Una subcarpeta forma parte del nombre: `app/layouts/admin/panel.meeko` es `"admin/panel"`. El nombre son letras, dígitos, `-` y `_` (y `/` entre carpetas), y empieza por una letra o un dígito; un archivo con otro nombre (`_partes.meeko`) no es un layout y puede guardar otros componentes. Un layout con nombre es un layout normal: pinta la página con `<MeekoOutlet />` y declara sus props con `defineProps`.

La página elige su layout en sus opciones de ruta, en `<script server>` o en el sidecar `*.route.ts`:

```html
<!-- app/pages/connections.meeko -->
<script
	server
	lang="ts"
>
	export const route = definePage({ layout: 'dashboard' })
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

**Página de error.** Una página que falla en el navegador (su loader, `notFound()` o un dato) muestra su `+error.meeko` o `app/error.meeko` dentro de sus propios layouts, el layout con nombre incluido, con las props de sus `+group.ts` y sin las de la página. La `404` de una URL sin ruta usa el layout `default` (si existe), con sus valores por defecto. Desde `1.8`, una página que responde `404` en el servidor (`notFound()` o un `ApiError` con ese estado) da el mismo documento, que se hidrata; con un `+error.meeko` más cercano, éste va dentro de los layouts de la página, sin hidratar. Si un layout falla al pintarlo, o el error es otro, el documento de error no tiene layouts, porque un layout puede ser lo que ha fallado.

### Opciones por carpeta: `+group.ts`

Para no repetir `layout` en cada página, un `+group.ts` en cualquier carpeta de `app/pages` (un grupo `(dashboard)` o una carpeta normal) declara las opciones de su carpeta y sus subcarpetas. `defineGroup` se autoimporta:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard', layoutProps: { showAlert: false } })
```

- **Herencia en cascada.** Los `+group.ts` se aplican del exterior al interior y después la página. `layout` de la página, o del grupo más interior que lo declara, gana.
- **`layoutProps` se combinan por clave** entre los grupos y la página, y la página gana. Un grupo o una página que elige un layout distinto del heredado empieza sin las props heredadas, que eran para otro layout.
- **`layout: false`** en una página (o un grupo) dentro de un grupo quita el layout con nombre y deja sus `+layout.meeko`.
- **Literales.** Meeko lee el archivo sin ejecutarlo, como `render`: `layout` es un literal o `false`, `layoutProps` un objeto literal de textos, números, booleanos, `null`, arrays y objetos, y `middleware` un array literal de textos o `false`. Un valor calculado, un spread o una opción desconocida detienen el descubrimiento con el archivo. Por eso funciona igual en el prerender y en el sitio estático.
- **`middleware`** (desde `1.6`). Los middleware con nombre de las páginas del grupo, que se suman a los de los grupos exteriores; `middleware: false` quita los heredados. Véase [Middleware con nombre](routing-middleware.md#middleware-con-nombre).
- **Tipos.** `defineGroup({ layout: "dashboard", layoutProps: { … } })` tipa `layoutProps` contra ese layout en el propio archivo. Un grupo que hereda el layout, y una página que no lo elige en su `definePage`, se comprueban en `meeko check` contra el heredado (`MEEK_PAGE_LAYOUT_PROPS`: `Las layoutProps de app/pages/(dashboard)/reports/+group.ts no coinciden con las props del layout dashboard`). Un `+group.ts` fuera de `app/pages` no configura nada: `meeko check` avisa con `MEEK115`.

Para migrar un grupo con su propio layout, como `app/pages/(dashboard)/+layout.meeko`, mueva el archivo a `app/layouts/dashboard.meeko` y añada `app/pages/(dashboard)/+group.ts` con `export default defineGroup({ layout: "dashboard" })`. El layout ya no se anida dentro de `default`, sino que lo sustituye, y cualquier página de otra carpeta puede elegirlo; los `+layout.meeko` que queden en subcarpetas siguen anidándose dentro.

### Layouts de layers y módulos

Un layer aporta sus `app/layouts/*.meeko` a toda la aplicación, y un módulo los suyos con `meeko.addLayout(name, file)` (véase [El objeto `meeko`](framework.md#el-objeto-meeko)). Ante dos layouts con el mismo nombre gana el del proyecto, después el del propio layer de la página, después los demás layers en su orden y por último los módulos; dos módulos con el mismo nombre son un error. `default` mantiene la regla de `1.4`: el del proyecto envuelve también a las páginas de los layers, el `default` de un layer sólo envuelve sus propias páginas cuando el proyecto no tiene uno (ni `app/pages/+layout.meeko`), y el de un módulo sirve cuando ni el proyecto ni el layer lo tienen.

## Props del layout desde la página

El layout declara props normales. La página se las pasa tipadas contra las `Props` del layout que elige, sin el `outlet`:

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
	export interface Props {
		title?: string
		showAlert?: boolean
	}
	const props = defineProps<Props>({ showAlert: false })
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
export const route = definePage({ layout: 'dashboard', layoutProps: { title: 'Conexiones', showAlert: true } })
```

```ts
export const route = definePage({
	layout: 'dashboard',
	load: async ({ context }) => ({ user: await users.current(context) }),
	layoutProps: ({ data }) => ({ title: data.user.name }),
})
```

Con código de nivel superior en `<script server>`, escribe las props como un export más. Desde `1.8`, `export const layoutProps` se tipa con sus propios valores y se comprueba contra el layout; como `head`, no llega a la página, así que un dato que sólo lee el layout viaja una vez, si no lo exportas también por separado:

```html
<script server lang="ts">
	export const route = definePage({ layout: 'docs' })

	const { params } = usePage()
	const snapshot = await readPage(params.slug)
	export const doc = { html: snapshot.html }
	export const layoutProps = { nav: snapshot.nav, title: snapshot.title }
</script>
```

Exportarlo y declarar además `route.layoutProps` es `MEEK072`.

La función recibe el mismo contexto que `head` (`params`, `search`, `request`, `context`, `signal`, `state` y `data`); con código de nivel superior en `<script server>`, `data` son sus exports, ya tipados desde `1.8` si las opciones son un objeto literal sin spread. Se combinan con las de los `+group.ts`, y ganan. Viajan en el payload (`layoutProps`), así que deben poder serializarse en JSON: una prop con `undefined` (`{ title: data.user?.name }` sin usuario, o `layout.set({ title: undefined })`) deja la prop sin valor, así que el layout usa su valor por defecto, en el servidor y en el navegador; un valor que JSON no representa (una fecha, un `Map`, una instancia) hace fallar la página con un error que nombra la página, el layout y la prop. En una página `render: "client"`, el objeto ya llega al HTML del servidor y la función se ejecuta en el navegador después de `load`. `export const layoutProps` en `<script server>` no es una opción: sería un dato más de la página.

**2. Desde el `<script>` de la página: `useLayout()`.** Se autoimporta y, en una página, su tipo sigue al layout que eligen su `definePage` o sus `+group.ts` (en otro componente, `useLayout<"dashboard">()`):

```html
<!-- app/pages/connections.meeko -->
<script lang="ts">
	const layout = useLayout() // LayoutHandle de "dashboard"
	const failing = signal(false)
	effect(() => layout.set({ showAlert: failing.value }))
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
