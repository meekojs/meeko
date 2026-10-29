---
title: definePlugin
group: macros
since: 1.2.0
description: Declara un plugin de aplicación de app/plugins, que se ejecuta al arrancar en el navegador, en el servidor o en ambos, y publica valores para todos los componentes.
symbols:
  - "@meekojs/meeko/framework#definePlugin"
types:
  - "@meekojs/meeko/framework#PluginApp"
related:
  - "@meekojs/meeko/framework#defineMeekoModule"
  - "@meekojs/meeko#createContext"
  - "@meekojs/meeko#inject"
  - "@meekojs/meeko#provideErrorHandler"
  - "@meekojs/meeko/framework#useRoute"
  - docs/framework.md#plugins-de-aplicación
---

`definePlugin(setup)` declara un plugin de aplicación: un archivo de `app/plugins` que lo exporta por defecto y se ejecuta al arrancar la aplicación, antes de pintar la página. El sufijo del archivo decide dónde:

| Archivo | Dónde y cuándo |
| --- | --- |
| `app/plugins/x.client.ts` | Sólo en el navegador, una vez, antes de la hidratación. |
| `app/plugins/x.server.ts` | Sólo en el servidor, una vez por petición de página, antes del render (también al prerenderizar). |
| `app/plugins/x.ts` | En los dos. |

`setup` recibe la aplicación: publica valores para todos los componentes con `app.provide`, registra observadores de errores con `app.onError` y lee la ruta con `app.route`. Se autoimporta.

## Uso

```ts
// app/plugins/theme.ts
import { createContext, signal } from "@meekojs/meeko";
import type { Signal } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";

export const accentKey = createContext<Signal<"teal" | "violet">>("accent");

export default definePlugin((app) => {
  app.provide(accentKey, signal<"teal" | "violet">("teal"));
});
```

```html
<!-- app/components/AccentBadge.meeko -->
<script lang="ts">
import { accentKey } from "../plugins/theme";

const accent = inject(accentKey);
</script>

<template><span bind:data-accent="accent.value">Acento</span></template>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `setup` | `(app: PluginApp, options: Options) => void \| Promise<void>` | obligatorio | La función del plugin. Puede ser asíncrona: Meeko espera a cada plugin antes del siguiente. `options` son las que pasa un módulo con `meeko.addPlugin({ src, options })`; en `app/plugins`, `undefined`. |

`PluginApp`:

| Miembro | Descripción |
| --- | --- |
| `side` | `"client"` o `"server"`. |
| `route` | La ruta, como `useRoute()`. En el navegador sigue a la ruta confirmada: un `effect` que la lee se repite al navegar. |
| `request` | La petición en el servidor; `undefined` en el navegador. |
| `provide(key, value)` | Publica un valor para todos los componentes, que lo leen con `inject(key)`. `key` sale de `createContext`. |
| `onError(handler)` | En el navegador, recibe lo mismo que `mountClientApp({ onError })`, con `{ side: "client", source }`; en el servidor, los fallos del render de esa petición, con `{ side: "server", requestId }`. |

## Valor devuelto

Un `MeekoPlugin<Options>`, para exportarlo por defecto. `definePlugin` sin función lanza `TypeError: definePlugin requires a setup function`.

## Ejemplos

### Analítica en el navegador

Un plugin `.client.ts` no se ejecuta en el servidor, así que puede usar `navigator` y `window`:

```ts
// app/plugins/analytics.client.ts
import { effect } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin((app) => {
  effect(() => navigator.sendBeacon("/api/visits", app.route.path.value));
  app.onError((error, info) => console.error("[app]", info.side, error));
});
```

### Un servicio por petición en el servidor

Un plugin `.server.ts` se ejecuta en cada petición de página, con la petición:

```ts
// app/plugins/locale.server.ts
import { createContext } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";

export const localeKey = createContext<string>("locale");

export default definePlugin((app) => {
  const header = app.request?.headers.get("accept-language") ?? "es";
  app.provide(localeKey, header.split(",")[0] ?? "es");
});
```

Un componente que lee `localeKey` y se hidrata debe recibir el mismo valor en el navegador: si lo pinta, publícalo también desde un plugin universal o pásalo en los datos de la página.

### Un plugin con opciones, desde un módulo

```ts
// modules/greeting/runtime/greeting.ts
import { createContext } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";

export const greetingKey = createContext<string>("greeting");

export default definePlugin<{ greeting: string }>((app, options) => {
  app.provide(greetingKey, options.greeting);
});
```

El módulo lo añade con `meeko.addPlugin({ src: new URL("./runtime/greeting.ts", import.meta.url), options: { greeting: "Hola" } })`. Las opciones deben ser JSON y, si el plugin llega al navegador, viajan en su bundle.

## Errores comunes

### Una clave de texto en `provide`

```ts bad
export default definePlugin((app) => {
  app.provide("theme", "dark");
});
```

`meeko check` da `TS2345: Argument of type 'string' is not assignable to parameter of type 'ContextKey<…>'.` con `Type 'string' is not assignable to type 'symbol'.` La clave sale de `createContext`, que también tipa el valor.

<!-- no-check -->
```ts good
export const themeKey = createContext<string>("theme");
export default definePlugin((app) => {
  app.provide(themeKey, "dark");
});
```

### Exportar la función sin `definePlugin`

```ts bad
// app/plugins/theme.ts
export default (app: unknown) => {};
```

`meeko check` no lo detecta. Al arrancar, la aplicación falla con `TypeError: <plugin> must default-export definePlugin(...)`, con el nombre del plugin.

<!-- no-check -->
```ts good
export default definePlugin((app) => {});
```

### Estado mutable compartido entre peticiones

En el servidor, un plugin universal o `.server.ts` se ejecuta en cada petición: un valor creado fuera de `setup` lo comparten todos los visitantes, sin ningún error.

```ts bad
const cart = signal<string[]>([]);
export default definePlugin((app) => {
  app.provide(cartKey, cart);
});
```

<!-- no-check -->
```ts good
export default definePlugin((app) => {
  app.provide(cartKey, signal<string[]>([]));
});
```

## Notas

- **Orden.** Primero los plugins de los módulos, en el orden en que los añaden; después los de cada layer y los de la aplicación, por nombre de archivo. Sólo cuentan los archivos que están directamente en `app/plugins`; las subcarpetas pueden guardar auxiliares. Se excluyen `*.test.ts`, `*.spec.ts` y `*.d.ts`.
- **Fallos.** Un plugin que lanza en el servidor hace fallar la petición, que muestra la página de error. En el navegador, la hidratación no llega a empezar y la página se queda con el HTML del servidor.
- **SSR e hidratación.** Lo que un componente pinta a partir de un valor publicado debe ser igual en el servidor y en el navegador; los valores que se renderizan suelen venir de un plugin universal.
- **Alcance.** No se ejecutan en las páginas ya prerenderizadas que sirve el servidor, ni en API, RPC o handlers. Con `cache.memory` en `definePage` (desde `1.7`), tampoco en una petición servida desde la copia.
- **Seguridad.** Un plugin universal o `.client.ts` va en el bundle del navegador: no importes `server/` ni secretos en él.
