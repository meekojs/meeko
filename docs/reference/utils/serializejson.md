---
title: serializeJson
group: utils
since: 1.0.0
description: Serializa un valor a JSON seguro para insertarlo en una etiqueta script, comprobando que se representa fielmente y escapando lo que podría cerrarla.
symbols:
  - "@meekojs/meeko#serializeJson"
related:
  - "@meekojs/meeko/framework#definePage"
  - "syntax:script-server"
  - "@meekojs/meeko/framework#useState"
  - docs/api.md#módulo-generado
---

`serializeJson(valor)` convierte un valor en JSON para enviarlo al navegador dentro de una etiqueta `<script>`. Hace dos cosas que `JSON.stringify` no hace:

- **Comprueba** que el valor se representa fielmente en JSON y lanza `TypeError` si no: rechaza `undefined`, funciones, `bigint`, símbolos, números no finitos, ciclos, accesores, `toJSON` propios, arrays dispersos e instancias de clase como `Date` o `Map`, con la ruta del valor.
- **Escapa** `<`, `>`, `&`, U+2028 y U+2029, así que el resultado no puede cerrar la etiqueta `<script>` ni romper el JavaScript que lo rodea.

Es la función con la que Meeko envía el payload de las páginas, los datos de `<script server>` y el estado SSR. La necesitas si escribes tu propio host o insertas datos a mano en un documento.

## Uso

```ts
import { serializeJson } from "@meekojs/meeko";

const state = { user: { name: "Ana" }, note: "</script><script>alert(1)</script>" };
const html = `<script type="application/json" id="state">${serializeJson(state)}</script>`;
// …"note":"</script><script>alert(1)</script>"…
```

En el navegador, `JSON.parse(document.getElementById("state")!.textContent!)` devuelve el mismo objeto.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `value` | `unknown` | obligatorio | Un valor JSON: `null`, booleanos, cadenas, números finitos, arrays densos y objetos planos (prototipo `Object.prototype` o `null`) con claves de texto. |

## Valor devuelto

El JSON del valor, como texto, con `<`, `>` y `&` escritos como `<`, `>` y `&`, y U+2028 y U+2029 como ` ` y ` `. `JSON.parse` lo lee igual que el JSON normal.

Lanza `TypeError` con la ruta del valor que falla:

| Valor | Mensaje |
| --- | --- |
| `{ when: new Date() }` | `Non-plain object at $.when` |
| `{ n: NaN }` | `Non-finite number at $.n` |
| `{ u: undefined }`, `{ f() {} }` | `Non-serializable value at $.u` |
| `[1, , 3]` | `Sparse array at $[1]` |
| Un objeto que se contiene a sí mismo | `Circular reference at $.self` |

## Ejemplos

### Un componente en un host propio

<!-- no-check -->
```ts
import { hydrate, renderWithState } from "./Counter.meeko";
import { serializeJson } from "@meekojs/meeko";

const props = { initial: 1 };
const { html, state } = renderWithState(props);
const page = `<div id="counter">${html}</div>
<script type="application/json" id="counter-state">${serializeJson({ props, state })}</script>`;
```

En el navegador, el host lee ese JSON y llama a `hydrate(root, props, state)`.

### Preparar fechas y mapas antes de enviarlos

Convierte lo que JSON no representa en tipos que sí:

```ts
import { serializeJson } from "@meekojs/meeko";

const scores = new Map([["ana", 3], ["luis", 5]]);
const payload = {
  updatedAt: new Date("2026-10-29T10:00:00Z").toISOString(),
  scores: Object.fromEntries(scores),
};
const json = serializeJson(payload); // {"updatedAt":"2026-10-29T10:00:00.000Z","scores":{"ana":3,"luis":5}}
```

## Errores comunes

### Enviar un `Date`

```ts bad
serializeJson({ when: new Date() });
```

`TypeError: Non-plain object at $.when`. `JSON.stringify` lo convertiría en texto en silencio y el navegador recibiría un `string` donde el tipo dice `Date`.

<!-- no-check -->
```ts good
serializeJson({ when: new Date().toISOString() });
```

### Propiedades `undefined`

```ts bad
serializeJson({ name: "Ana", email: undefined });
```

`TypeError: Non-serializable value at $.email`. Quita la clave o usa `null`.

<!-- no-check -->
```ts good
serializeJson({ name: "Ana", email: null });
```

### Insertar `JSON.stringify` en un `<script>`

`JSON.stringify` no escapa `</script>`: un texto de usuario puede cerrar la etiqueta e inyectar código, sin ningún error.

```ts bad
const html = `<script type="application/json">${JSON.stringify(data)}</script>`;
```

<!-- no-check -->
```ts good
const html = `<script type="application/json">${serializeJson(data)}</script>`;
```

## Notas

- **Seguridad.** El escape hace seguro el resultado dentro de un `<script>` y en el texto de un documento HTML; no lo uses para un atributo sin escaparlo como atributo.
- **Datos de la página.** Lo que devuelve `load`, los exports de `<script server>` y las señales del estado SSR pasan por `serializeJson`: un valor que rechaza responde `500` en ejecución, y `meeko check` ya lo marca como error de tipos en los datos de una página.
- **Rendimiento.** Recorre el valor una vez para comprobarlo antes de `JSON.stringify`: para payloads grandes, envía sólo lo que la página pinta.
- **Paquete.** Se exporta desde la raíz, `@meekojs/meeko`, sin dependencias del framework: sirve también fuera de una aplicación Meeko.
