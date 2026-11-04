---
title: devtools
group: config
since: 1.8.0
description: Monta el panel de Meeko DevTools dentro de la página en meeko dev, sin código de la aplicación, en la esquina elegida.
symbols:
  - "config:devtools"
types:
  - "@meekojs/meeko/framework#MeekoDevtoolsConfig"
related:
  - "config:dev"
  - "cli:dev"
  - docs/devtools.md#panel-dentro-de-la-página
  - docs/framework.md#configuración
---

`devtools` activa Meeko DevTools en `meeko dev`: con `true`, `meeko dev` monta el panel dentro de la página en todos los documentos, sin `import()` ni `mountDevtoolsPanel()` en la aplicación. Es la forma recomendada desde `1.8`, como `devtools: true` en Nuxt. Por defecto, `false`: quien actualiza dentro de `1.x` no ve el panel hasta que lo pide.

El panel nunca llega a `meeko build`, `meeko start`, `meeko preview` ni a las páginas prerenderizadas: sólo `meeko dev` lo añade.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ devtools: true });
```

## Opciones

`devtools` es un booleano o un objeto. Un objeto activa DevTools: sin `panel`, el panel se monta igual que con `true`.

| Opción     | Tipo                                                           | Por defecto      | Descripción                                        |
| ---------- | -------------------------------------------------------------- | ---------------- | -------------------------------------------------- |
| `panel`    | `boolean`                                                      | `true`           | Monta el panel dentro de la página en `meeko dev`. |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Esquina de la ventana en la que se fija el panel.  |

## Resultado

Con el panel activo, `meeko dev` añade al `<head>` de cada documento un `<script type="module">` (con el nonce de la CSP, si lo hay) que carga `@meekojs/meeko/devtools-ui` y llama a `mountDevtoolsPanel({ position })`. El panel se conecta al hook `window.__MEEKO_DEVTOOLS__` cuando la página hidrata.

El panel usa los colores de Meeko, en claro u oscuro según el sistema o el `data-theme` de la página; se minimiza a una pastilla con el número de eventos nuevos (`Alt+Mayús+M`) y se lleva a otra esquina arrastrando su asa. Recuerda ambas cosas en `localStorage`; un cambio de `position` en la configuración manda sobre la esquina recordada. Véase [Aspecto, minimizar y mover](../../devtools.md#aspecto-minimizar-y-mover).

Sin `devtools` (o con `false` o `{ panel: false }`), `meeko dev` no añade nada. El hook sigue existiendo en desarrollo, así que la [extensión de Chrome](../../devtools.md#panel-de-chrome-devtools) y el [puente del editor](../../devtools.md#puente-del-editor) funcionan con o sin esta opción.

## Ejemplos

### En otra esquina

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ devtools: { position: "bottom-left" } });
```

### Sólo cuando se pide

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ devtools: process.env.MEEKO_DEVTOOLS === "1" });
```

```sh
MEEKO_DEVTOOLS=1 npm run dev
```

## Errores comunes

### Una esquina que no existe

```ts bad
export default defineMeekoConfig({ devtools: { position: "middle" } as never });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: devtools.position debe ser "bottom-right", "bottom-left", "top-right" o "top-left"`, y `meeko check` da además `TS2322` en esa línea. Un valor que no es booleano ni objeto da `devtools debe ser un booleano o un objeto { panel?: boolean, position?: … }`; un campo de más, `devtools: campo desconocido …`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ devtools: { position: "top-left" } });
```

### Montarlo dos veces

```ts bad
// app/plugins/devtools.client.ts, con devtools: true en meeko.config.ts
if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
}
```

Si el montaje propio llega antes, `meeko dev` lo respeta y no añade otro; si llega después, hay dos paneles. Use una de las dos formas: `devtools` en la configuración o el montaje manual, que sigue sirviendo para un contenedor propio (`container`).

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ devtools: true });
```

## Notas

- **Sólo desarrollo.** Ni el script ni `@meekojs/meeko/devtools-ui` existen en `meeko build`, `meeko start`, `meeko preview` o las páginas prerenderizadas.
- **Claves de módulos.** `devtools` es una opción del propio Meeko desde `1.8`: un módulo con `meta.configKey: "devtools"` deja de cargarse y debe usar otra clave.
- **Desarrollo.** Cambiar `meeko.config.ts` exige reiniciar `meeko dev`.
