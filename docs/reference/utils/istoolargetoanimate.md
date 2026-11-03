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
import { isTooLargeToAnimate } from "@meekojs/meeko";

function change(update: () => void) {
  if (isTooLargeToAnimate()) return update();
  const transition = document.startViewTransition(() => {
    update();
    // El cambio puede haber traído el contenido grande: no pagues sus frames.
    if (isTooLargeToAnimate()) transition.skipTransition();
  });
}
```

## Detalles

- Hoy el límite son 4.000 elementos en todo el documento. El valor exacto no es contrato: puede cambiar en cualquier versión.
- Compruébalo antes de empezar y otra vez dentro del callback, porque el cambio puede traer el contenido grande. `skipTransition()` en ese momento evita los frames, y el cambio queda aplicado.
- Contar es barato: menos de 1 ms en un documento de 24.000 elementos con la CPU limitada a ×4.
- Solo existe en el navegador. Sin argumento lee el `document` global.
