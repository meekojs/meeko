# Páginas y parámetros

Cada archivo `.meeko` bajo `app/pages` define una ruta. Sigue el [tutorial del router](router.md) para construir una aplicación y usa el [índice de Routing](routing.md) para pasar a otros temas.

## Convenciones de archivos

| Archivo bajo `app/pages` | URL de ejemplo        | Parámetros                  |
| ------------------------ | --------------------- | --------------------------- |
| `index.meeko`            | `/`                   | Ninguno                     |
| `users/index.meeko`      | `/users`              | Ninguno                     |
| `users/new.meeko`        | `/users/new`          | Ninguno                     |
| `users/[id].meeko`       | `/users/42`           | `{ id: '42' }`              |
| `docs/[...slug].meeko`   | `/docs/guide/install` | `{ slug: 'guide/install' }` |
| `(admin)/reports.meeko`  | `/reports`            | Ninguno                     |

`[id]` captura un segmento. `[...slug]` captura uno o más y debe ir al final. Los grupos entre paréntesis organizan archivos sin añadir un segmento a la URL. Las rutas estáticas tienen prioridad sobre las dinámicas; dos páginas con la misma forma de URL producen una colisión.

## Opciones y parámetros validados

Declara las opciones de una página con `definePage()` dentro de su `<script server>` o en un archivo compañero `*.route.ts`. `definePage({ params, search })` acepta schemas Standard Schema para validar y transformar parámetros antes de cargar datos. `usePage()` ofrece los valores de la petición en el servidor. Consulta [definePage](reference/macros/definepage.md), [usePage](reference/composables/usepage.md) y [Datos y renderizado](routing-data.md#código-de-servidor-de-la-página).

Para construir enlaces tipados, usa `<MeekoLink to="/users/[id]" bind:params="{ id: '42' }" />` o `href('/users/[id]', { params: { id: '42' } })`. El ID de ruta corresponde al archivo, no a la URL ya rellenada. [Navegación](routing-navigation.md#meekooutlet--y-meekolink) explica el comportamiento del enlace.

## Opciones por carpeta

Un `+group.ts` aplica opciones a las páginas de su carpeta y sus descendientes sin cambiar la URL:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

Los grupos exteriores se aplican antes que los interiores y la página puede precisar sus propias opciones. Para la herencia de `middleware`, consulta [Middleware de rutas](routing-middleware.md#middleware-con-nombre); para layouts con nombre y anidados, consulta [Layouts](routing-layouts.md#layouts-con-nombre).

## Referencia relacionada

`app/pages` también admite `+error.meeko`. Los layouts compartidos viven en `app/layouts`, mientras `+layout.meeko` permite anidarlos junto a páginas. Las reglas de errores y modos SSR están en [Datos y renderizado](routing-data.md).
