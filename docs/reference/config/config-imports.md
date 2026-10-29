---
title: imports
group: config
since: 1.0.0
description: Carpetas de autoimports además de las de por defecto, cada una con el ámbito de la carpeta que la contiene, app, shared o server.
symbols:
  - "config:imports"
related:
  - "config:alias"
  - "config:layers"
  - docs/framework.md#autoimports-y-typescript
  - docs/framework.md#configuración
---

`imports` añade carpetas cuyos exports se autoimportan, además de las de por defecto (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`, `shared/{types,schemas,utils,constants,enums}` y `server/utils`). Cada opción admite sólo carpetas dentro de su raíz, y cada carpeta toma el ámbito de esa raíz, así que un servicio de `server/` nunca llega a un componente.

`serverDirs` existe desde `1.0`; `appDirs` y `sharedDirs`, desde `1.3`. Las carpetas se buscan también dentro de cada layer, con la misma ruta relativa.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  imports: {
    appDirs: ["app/services"],
    sharedDirs: ["shared/validators"],
    serverDirs: ["server/services", "server/repositories"],
  },
});
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `appDirs` | `readonly string[]` | `[]` | Desde `1.3`. Carpetas dentro de `app/`, con el ámbito de `app/`: componentes y `.ts` de `app/`, en el navegador y en SSR; también el código de servidor. No `shared/`. |
| `sharedDirs` | `readonly string[]` | `[]` | Desde `1.3`. Carpetas dentro de `shared/`, con el ámbito de `shared/`: todo el proyecto. |
| `serverDirs` | `readonly string[]` | `[]` | Carpetas dentro de `server/`, sólo para el código de servidor: `server/`, `<script server>`, sidecars `*.route.ts` y `*.server.ts`. |

Cada entrada es una ruta relativa que empieza por su raíz (`app/…`, `shared/…`, `server/…`), con `/` o `\` y sin segmentos `.` ni `..`.

## Resultado

Cada carpeta se lee de forma recursiva, en el proyecto y en cada layer. Sólo sus `.ts` aportan exports (sin `*.test.ts`, `*.spec.ts` ni `*.d.ts`); los `.meeko` de estas carpetas no son componentes. Los sufijos `.client.ts`, `.server.ts` y `.shared.ts` mandan sobre el ámbito de la carpeta.

- Un `type` o una `interface` llegan con `import type`.
- Un export del proyecto con el nombre de un autoimport del framework (`useRoute`, `useForm`…) tiene prioridad.
- Dos archivos que exportan el mismo nombre en un ámbito son un error que nombra ambos.
- Una carpeta que ya es de autoimports o que está dentro de otra de la lista no se lee dos veces.
- `meeko check` y el editor declaran los nombres en `.meeko/types/autoimports/`.

## Ejemplos

### Servicios de servidor sin imports

```ts
// server/services/orders.ts
export async function markReady(id: string): Promise<{ id: string; status: "ready" }> {
  return { id, status: "ready" };
}
```

<!-- no-check -->
```ts
// server/api/orders/[id]/ready.post.ts: markReady llega por autoimport
export default defineApiRoute({ params: orderParams, handler: ({ params }) => markReady(params.id) });
```

### Validadores compartidos por el formulario y la API

```ts
// shared/validators/email.ts
export const isCorporateEmail = (value: string): boolean => value.endsWith("@acme.example");
```

`isCorporateEmail` está disponible en `app/`, en `server/` y en el propio `shared/`.

### Un servicio que sólo es de servidor dentro de `appDirs`

```text
app/services/cart.ts          → app/ (navegador y SSR)
app/services/payments.server.ts → sólo servidor: un componente que lo usa da MEEK108
```

## Errores comunes

### Una ruta fuera de su raíz

```ts bad
export default defineMeekoConfig({ imports: { appDirs: ["services"] } });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: imports.appDirs[0] debe ser una ruta relativa dentro de app/: services`; el editor de un workspace de confianza lo marca en la entrada (`MEEK_CONFIG`).

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ imports: { appDirs: ["app/services"] } });
```

### Usar en un componente un servicio de `serverDirs`

```html bad
<!-- app/pages/orders.meeko -->
<script lang="ts">
const orders = await listOrders(); // de server/services
</script>
```

`meeko check` da `MEEK108`: el código de servidor no puede llegar al navegador. Cárguelo en `<script server>` o expóngalo con una API.

```html good
<script server lang="ts">
export const orders = await listOrders();
</script>
```

### `imports` que no es un objeto

```ts bad
export default defineMeekoConfig({ imports: ["server/services"] as never });
```

`…/meeko.config.ts: imports debe ser un objeto`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ imports: { serverDirs: ["server/services"] } });
```

## Notas

- **Ámbitos y seguridad.** El ámbito evita que un secreto de `server/` acabe en el bundle del navegador: `serverDirs` sólo existe en el código de servidor.
- **Desarrollo.** Crear, editar o borrar un `.ts` de estas carpetas recarga el registro sin reiniciar; cambiar las listas de `imports` exige reiniciar `meeko dev`.
- **Editor.** En un workspace no confiable, el editor lee las tres listas sin ejecutar la configuración si son arrays literales de cadenas.
