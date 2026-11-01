---
title: <MeekoLink>
group: components
since: 1.2.0
description: Enlace tipado a una página de la aplicación, que construye su href con href() y marca con aria-current la página o la sección actual.
symbols:
  - "syntax:meekolink"
types:
  - "@meekojs/meeko/framework#MeekoLinkProps"
  - "@meekojs/meeko/framework#RouteId"
related:
  - "@meekojs/meeko/framework#href"
  - "@meekojs/meeko/framework#useRoute"
  - "syntax:meekooutlet"
  - "@meekojs/meeko/framework#useNavigation"
  - docs/framework.md#meekooutlet--y-meekolink
  - docs/framework.md#enlaces-anclas-y-scroll
---

`<MeekoLink>` pinta un `<a>` cuyo `href` construye [`href()`](/docs/reference/href) a partir del ID de una ruta de `app/pages`. `to` sólo admite rutas que existen, una ruta dinámica exige sus parámetros y `meeko check` marca cualquier error en el propio atributo. En la página actual añade `aria-current="page"`, y la navegación del cliente lo mantiene al día, también en un layout que el navegador conserva entre páginas.

No se importa: el compilador reconoce la etiqueta en cualquier plantilla de la aplicación.

## Uso

```html
<!-- app/layouts/default.meeko -->
<template>
  <header>
    <MeekoLink to="/" class="brand">Inicio</MeekoLink>
    <MeekoLink to="/users/[id]" bind:params="{ id: session.userId }">Mi perfil</MeekoLink>
  </header>
  <main><MeekoOutlet /></main>
</template>
```

Con `/users/[id]` y `id: "7"`, el segundo enlace es `<a href="/users/7">`; en `/users/7` lleva además `aria-current="page"`.

## Props

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `to` o `bind:to` | `RouteId` | obligatorio | ID de la ruta de destino, como `to="/users/[id]"`: la ruta de su archivo en `app/pages`, sin query ni fragmento. `bind:to` admite una expresión cuyo tipo sea una ruta o una unión de rutas; con una unión, `bind:params` acepta los parámetros de alguna de ellas (desde `1.8`). |
| `bind:params` | `RouteParams<K>` | ninguno | Los segmentos dinámicos de la ruta, como `bind:params="{ id: user.id }"`. Obligatorio en una ruta con segmentos dinámicos y prohibido en las demás. Los valores son `string`. Sin rutas generadas (`RouteId` es `string`: una librería como `@meekojs/ui` o un proyecto antes de `meeko check`), ninguna ruta dice qué parámetros tiene: `bind:params` es opcional y acepta `Record<string, string>` o `undefined` (desde `1.8`; antes exigía `params ?? {}`). |
| `bind:search` | `Readonly<Record<string, string \| number \| boolean \| null \| undefined>>` | ninguno | Query string, como `bind:search="{ tab: 'perfil' }"`. Omite las claves con `null` o `undefined`. |
| `match` o `bind:match` | `"exact" \| "prefix"` | `"exact"` | Desde `1.5`. `"exact"` marca el enlace sólo en su ruta; `"prefix"` también en las rutas que están por debajo. |
| cualquier otro | atributos de `<a>` | | `class`, `target`, `rel`, `aria-*`, `data-*`, `on:click` y los hijos pasan al `<a>` tal cual. |

`href`, `bind:href` y las formas estáticas `params="…"` y `search="…"` no se admiten (`MEEK105`).

## Resultado

Un `<a>` con el `href` construido. `aria-current` dice dónde está el usuario:

| Ruta actual | `match="exact"` | `match="prefix"` |
| --- | --- | --- |
| La misma ruta, sin contar query ni fragmento | `aria-current="page"` | `aria-current="page"` |
| Una ruta por debajo, por segmentos completos | sin atributo | `aria-current="true"` |
| Cualquier otra | sin atributo | sin atributo |

`aria-current="true"` significa «el elemento actual de un conjunto»: la sección en la que está la página. `to="/"` sólo coincide exacta, también con `match="prefix"`, porque si no marcaría todas las páginas. La comparación se hace sobre las rutas codificadas como las escribe `href()`, así que `/categorías` y `/categor%C3%ADas` son la misma.

Desde `1.8`, un `aria-current` propio gana a la ruta, en el servidor, en la hidratación y en cada actualización, tanto escrito como con `bind:aria-current` o en `bind`:

| Valor propio | Resultado |
| --- | --- |
| Un texto, como `aria-current="step"` | Ese valor, sea cual sea la ruta |
| `false` | Sin atributo, aunque sea la ruta activa |
| `null` o `undefined` | Decide la ruta, como sin atributo |

`aria-current` y `bind:aria-current` ganan a la clave `aria-current` de `bind`. Escribir los dos en el mismo enlace es `MEEK105`.

## Ejemplos

### Un menú de secciones

Cada enlace marca su sección en todas sus páginas y, de forma distinta, la página exacta. El CSS distingue los dos valores, los mismos que leen los lectores de pantalla:

```html
<!-- app/layouts/default.meeko -->
<template>
  <nav aria-label="Secciones">
    <MeekoLink to="/" match="prefix">Inicio</MeekoLink>
    <MeekoLink to="/dashboard" match="prefix">Panel</MeekoLink>
    <MeekoLink to="/settings" match="prefix">Ajustes</MeekoLink>
  </nav>
  <main><MeekoOutlet /></main>
</template>

<style scoped>
nav a[aria-current="true"] { border-bottom: 2px solid currentColor; }
nav a[aria-current="page"] { border-bottom: 2px solid currentColor; font-weight: 700; }
</style>
```

En `/dashboard/stats`, «Panel» lleva `aria-current="true"`; en `/dashboard`, `aria-current="page"`; en `/dashboards`, ninguno.

### Parámetros y query string

```html
<ul>
  <li each:of="users" each:as="user" each:key="user.id">
    <MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'actividad', page: 2 }">{user.name}</MeekoLink>
  </li>
</ul>
```

Para el usuario `"42"` el enlace es `/users/42?tab=actividad&page=2`. En una ruta dinámica con `match="prefix"`, la sección es la de sus `params`: `to="/users/[id]"` con `id: "7"` cubre `/users/7/posts`, pero no `/users/8/posts`.

### Una lista de enlaces con `bind:to`

`bind:to` toma la ruta de una expresión. Con `as const`, el tipo de cada `to` es una unión de rutas que existen y `meeko check` la comprueba igual:

```html
<script lang="ts">
const links = [
  { to: "/", label: "Inicio" },
  { to: "/settings", label: "Ajustes" },
] as const;
</script>

<template>
  <nav>
    <MeekoLink each:of="links" each:as="link" each:key="link.to" bind:to="link.to">{link.label}</MeekoLink>
  </nav>
</template>
```

### Un componente que recibe una ruta

`MeekoLinkProps` y `RouteId` se autoimportan. Tipar la prop con `MeekoLinkProps["to"]` hace que el padre tampoco pueda pasar una ruta inexistente:

```html
<!-- app/components/NavItem.meeko -->
<script lang="ts">
const props = defineProps<{ to: MeekoLinkProps["to"]; label: string }>();
</script>

<template>
  <a class="nav-item" bind:href="href(props.to)">{props.label}</a>
</template>
```

Para un enlace propio, `useRoute().isActive(to, { params, prefix })` aplica la misma regla que `match`.

### Un componente que recibe cualquier ruta con sus parámetros

`MeekoLinkProps["params"]` no relaciona los parámetros con la ruta. Para que el padre pase cualquier ruta y `meeko check` exija los `params` de la que elige, cree una variante por ruta:

```html
<!-- app/components/NavLink.meeko -->
<script lang="ts">
type RouteParamsOf<K extends RouteId> = NonNullable<MeekoLinkProps<K>["params"]>;
type LinkTarget = {
  [K in RouteId]: { to: K; search?: MeekoLinkProps["search"] }
    & (keyof RouteParamsOf<K> extends never ? { params?: never } : { params: RouteParamsOf<K> })
}[RouteId];
const props = defineProps<LinkTarget & { label: string }>();
</script>

<template>
  <MeekoLink bind:to="props.to" bind:params="props.params" bind:search="props.search">{props.label}</MeekoLink>
</template>
```

`<NavLink to="/users/[id]" label="Perfil" />` sin `bind:params` es `TS2345`; `bind:params="{ userId: '1' }"`, `TS2353`; y `params` en `/about`, `TS2345`. Desde `1.8`, `<MeekoLink>` acepta `bind:to` con una unión de rutas y unos `params` de alguna de ellas; antes, `bind:params="props.params"` daba `TS2412`. Para un botón que además puede ser un enlace externo o un `<button>`, véase [Un botón que es ruta, enlace o botón](../../api.md#un-botón-que-es-ruta-enlace-o-botón).

### `'MeekoLink'` en `<component is>` (desde 1.8)

`<MeekoLink>` no es un valor del script, pero `is` lo nombra con un literal, junto a etiquetas HTML y otros componentes:

```html
<component is="props.to !== undefined ? 'MeekoLink' : 'button'" bind:to="props.to" bind:params="props.params" type="button">Abrir</component>
```

La rama de `'MeekoLink'` es esta etiqueta: recibe `to`, `params`, `search` y `match` y los demás atributos de su `<a>`, pero no `href`, y `meeko check` comprueba la ruta y sus parámetros tras la condición de `?:`, que estrecha `props.to`. Véase [Nombres de componente en `is`](../../api.md#nombres-de-componente-en-is).

## Errores comunes

### Escribir `href`

`<MeekoLink>` construye su `href`. Pasarlo a mano anula la comprobación de la ruta.

```html bad
<MeekoLink href="/about">Acerca de</MeekoLink>
```

El compilador lo rechaza con `MEEK105: <MeekoLink> construye su href: indica la ruta con to="/users/[id]" y sus parámetros con bind:params`. Sin `to`, el error es `MEEK105: <MeekoLink> necesita to con la ruta`.

```html good
<MeekoLink to="/about">Acerca de</MeekoLink>
```

### Una ruta que no existe, o con query en `to`

`to` es el ID de una ruta, no una URL: la query string va en `bind:search`.

```html bad
<MeekoLink to="/nowhere">Perdido</MeekoLink>
<MeekoLink to="/about?tab=1">Acerca de</MeekoLink>
```

`meeko check` da `TS2345: Argument of type '"/about?tab=1"' is not assignable to parameter of type '"/" | "/about" | "/users/[id]"'` en el atributo, con la lista de las rutas de la aplicación.

```html good
<MeekoLink to="/about" bind:search="{ tab: '1' }">Acerca de</MeekoLink>
```

Para un enlace externo, a otro origen o a un archivo, usa `<a href>`: no es una ruta de la aplicación.

### Olvidar los parámetros de una ruta dinámica

```html bad
<MeekoLink to="/users/[id]">Perfil</MeekoLink>
```

`meeko check` da `TS2345: Argument of type '{}' is not assignable to parameter of type '__MeekoLinkOptions<"/users/[id]">'`, con `Property 'params' is missing`. Una clave equivocada (`{ userId: '1' }`) da `TS2353`, y un número (`{ id: 7 }`) da `TS2322: Type 'number' is not assignable to type 'string'`.

```html good
<MeekoLink to="/users/[id]" bind:params="{ id: String(user.id) }">Perfil</MeekoLink>
```

### `params` o `search` sin `bind:`

Sin `bind:`, el valor del atributo sería texto, no un objeto.

```html bad
<MeekoLink to="/users/[id]" params="{ id: '1' }">Perfil</MeekoLink>
```

El compilador da `MEEK105: params de <MeekoLink> es un objeto: escríbelo como bind:params="{ … }"`.

```html good
<MeekoLink to="/users/[id]" bind:params="{ id: '1' }">Perfil</MeekoLink>
```

### Un `match` que no existe

```html bad
<MeekoLink to="/dashboard" match="partial">Panel</MeekoLink>
```

`MEEK105: match de <MeekoLink> es "exact" (por defecto) o "prefix"`. Con `bind:match`, un valor que no es `"exact" | "prefix"` es un error de tipos.

```html good
<MeekoLink to="/dashboard" match="prefix">Panel</MeekoLink>
```

### Un componente propio llamado `MeekoLink`

Un componente de `app/components/MeekoLink.meeko` (o importado con ese nombre) tiene prioridad sobre la etiqueta de Meeko, con sus props, para no romper proyectos anteriores a `1.2`.

```html bad
<!-- app/components/MeekoLink.meeko existe en el proyecto -->
<MeekoLink to="/about">Acerca de</MeekoLink>
```

`meeko check`, `meeko build` y el editor avisan con `MEEK106: <MeekoLink> es el componente MeekoLink del proyecto, no la etiqueta propia de Meeko`. Renombra el componente (por ejemplo, a `AppLink.meeko`) y la etiqueta vuelve a ser la de Meeko.

```html good
<!-- app/components/AppLink.meeko -->
<MeekoLink to="/about">Acerca de</MeekoLink>
```

## Notas

- **Navegación del cliente.** El `<a>` es un enlace normal, que funciona también antes de hidratar y sin JavaScript. Con la aplicación hidratada, `mountClientApp` convierte el clic en una navegación del cliente, como cualquier enlace del mismo origen a una ruta de la aplicación; un enlace a un fragmento de la página actual sólo desplaza la página.
- **SSR e hidratación.** El servidor escribe `href` y `aria-current` en el HTML; la hidratación no los cambia y cada navegación actualiza `aria-current`, también en los layouts que el navegador conserva. Un `aria-current` propio y la ruta escriben un solo atributo, con la misma regla en los dos lados.
- **Tipos de las rutas.** `RouteId` es la unión de las rutas que declara `.meeko/types/routes.d.ts`, que generan `meeko check`, `meeko dev` y `meeko routes`; sin esas declaraciones es `string` y la comprobación de `to` no ocurre. Una página nueva necesita uno de esos comandos para que su ruta sea válida.
- **Editor.** `to="` sugiere las rutas del proyecto y Ctrl+clic lleva a su página.
- **No es un valor de `is`.** `<MeekoLink>` es una etiqueta del compilador: `<component is="x ? MeekoLink : 'button'">` da `TS2304`. Use dos ramas con `if:when`.
- **Estilos.** Los estilos con ámbito de un componente se aplican al `<a>`, que es un elemento de su plantilla: `a[aria-current="page"]` en `<style scoped>` funciona.
