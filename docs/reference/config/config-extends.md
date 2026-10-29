---
title: extends
group: config
since: 1.0.0
description: El nombre anterior de layers, que sigue funcionando en 1.x sin aviso; sus carpetas van antes que las de layers.
symbols:
  - "config:extends"
related:
  - "config:layers"
  - "config:modules"
  - docs/framework.md#layers
---

`extends` es el nombre que tenía `layers` hasta `1.1`. Acepta lo mismo (carpetas del proyecto con `app/pages`) y aplica las mismas reglas, y sigue funcionando en toda la serie `1.x` sin aviso. La única diferencia es el orden: sus carpetas van antes que las de `layers`.

En un proyecto nuevo, use `layers`.

## Uso

```ts
// meeko.config.ts de un proyecto de 1.0 o 1.1
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  extends: ["./layers/base"],
});
```

## Opciones

| Valor | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `extends` | `readonly string[]` | `[]` | Carpetas del proyecto con `app/pages`, como las de `layers`. |

## Resultado

Las carpetas de `extends` se añaden como layers justo después de la aplicación y antes de las de `layers`. Ese orden decide qué layout con nombre gana cuando dos fuentes lo declaran y en qué orden se buscan los aliases `~/`, `@/`, `#shared/` y `#server/`.

## Ejemplos

### Migrar a `layers`

```ts
// Antes (1.1)
// export default defineMeekoConfig({ extends: ["./layers/base", "./layers/admin"] });

// Después (1.2 o posterior): el mismo orden.
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./layers/base", "./layers/admin"] });
```

### Las dos a la vez durante una migración

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  extends: ["./layers/legacy"], // primero
  layers: ["./layers/base"],    // después
});
```

## Errores comunes

### La misma carpeta en `extends` y en `layers`

```ts bad
export default defineMeekoConfig({ extends: ["./layers/base"], layers: ["./layers/base"] });
```

`Raíz de fuentes de Meeko repetida: <ruta>`: una carpeta sólo puede ser una fuente.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./layers/base"] });
```

### Una carpeta fuera del proyecto

```ts bad
export default defineMeekoConfig({ extends: ["../outside"] });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `layer ../outside sale de la raíz del proyecto <ruta>`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ extends: ["./layers/outside"] });
```

## Notas

- **Sin aviso.** A diferencia de las carpetas en `modules`, `extends` no escribe ningún aviso y no está programado para desaparecer en `1.x`.
- **Editor.** Como `layers`, el editor lo lee sin ejecutar la configuración si es un array literal de cadenas.
