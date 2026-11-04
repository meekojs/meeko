---
title: isTooLargeToAnimate
group: utils
since: 1.8.0
description: Indica si un documento es demasiado grande para animarlo con una View Transition; las navegaciones y withViewTransition ya lo comprueban.
symbols:
  - "@meekojs/meeko#isTooLargeToAnimate"
related:
  - docs/framework.md#view-transitions-nativas
---

`isTooLargeToAnimate(target?)` indica si un documento tiene demasiados elementos para animarlo con una View Transition. En una página de miles de elementos, con una pantalla de alta densidad o en un teléfono, cada frame de la transición bloquea la página durante segundos. Por encima del límite, aplica el cambio sin animar.

Las navegaciones con `viewTransitions` y `withViewTransition()` de `@meekojs/ui/runtime` ya lo comprueban. Úsalo solo si llamas a `document.startViewTransition()` por tu cuenta.

## Uso

```ts
// app/utils/change.ts
import { isTooLargeToAnimate } from "@meekojs/meeko";

export function change(update: () => void) {
  if (isTooLargeToAnimate()) return update();
  const transition = document.startViewTransition(() => {
    update();
    // El cambio puede haber traído el contenido grande: no pagues sus frames.
    if (isTooLargeToAnimate()) transition.skipTransition();
  });
}
```

## Parámetros

| Parámetro | Tipo       | Por defecto | Descripción             |
| --------- | ---------- | ----------- | ----------------------- |
| `target`  | `Document` | `document`  | El documento que cuenta |

## Valor devuelto

`true` si el documento supera el límite y el cambio debe aplicarse sin animar; `false` si se puede animar.

## Ejemplos

### Comprobar otro documento

```ts
// app/utils/frame.ts
import { isTooLargeToAnimate } from "@meekojs/meeko";

export function canAnimateFrame(frame: HTMLIFrameElement) {
  return frame.contentDocument !== null && !isTooLargeToAnimate(frame.contentDocument);
}
```

## Errores comunes

### Comprobar solo antes de empezar

El cambio puede traer el contenido grande. La página corta empieza la transición y sus frames se pagan con la larga.

```ts bad
if (!isTooLargeToAnimate()) document.startViewTransition(showLongPanel);
else showLongPanel();
```

Compruébalo también dentro del callback y salta la animación. El cambio queda aplicado.

```ts good
import { isTooLargeToAnimate } from "@meekojs/meeko";

declare function showLongPanel(): void;

if (isTooLargeToAnimate()) showLongPanel();
else {
  const transition = document.startViewTransition(() => {
    showLongPanel();
    if (isTooLargeToAnimate()) transition.skipTransition();
  });
}
```

## Notas

- **Límite:** hoy son 4.000 elementos en todo el documento. El valor exacto no es contrato: puede cambiar en cualquier versión.
- **Rendimiento:** contar es barato. Menos de 1 ms de mediana en un documento de 24.000 elementos con la CPU limitada a ×4.
- **Servidor:** solo existe en el navegador. Sin argumento lee el `document` global, así que no lo llames durante el render del servidor.
