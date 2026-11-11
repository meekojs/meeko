---
title: createId
group: utils
since: 1.8.0
description: Genera UUID v4 criptográficos en servidor y navegador desde funciones, handlers o módulos.
symbols:
  - "@meekojs/meeko#createId"
related:
  - "@meekojs/meeko#useId"
---

`createId()` crea un identificador nuevo sin contexto de componente. Se puede usar en servidor y navegador. En aplicaciones Meeko se autoimporta; fuera del framework impórtalo de `@meekojs/meeko`. Cada llamada genera un ID distinto.

## Uso

```ts
import { createId } from '@meekojs/meeko'

function createItem(label: string) {
  return { id: createId(), label }
}

const items = ['Guardar', 'Cancelar'].map(createItem)
```

`items` contiene dos objetos con IDs UUID v4 distintos. En un módulo de aplicación del framework puedes omitir el import si usas sus autoimports.

## Parámetros

No recibe parámetros. No requiere un contador global ni acceso a una base de datos.

## Valor devuelto

Devuelve un `string` con un UUID v4 generado por Web Crypto. Usa `crypto.randomUUID()` o, si no existe, `crypto.getRandomValues()`; nunca `Math.random()`.

## Ejemplos

Para un item creado durante SSR, genera el ID en el servidor y envíalo junto con los datos serializados. El navegador debe usar ese valor recibido; llamar otra vez a `createId()` produciría otro ID.

```ts
import { createId } from '@meekojs/meeko'

const item = { id: createId(), label: 'Guardar' }
// Serializa item como parte de los datos de la página.
```

## Errores comunes

### Esperar el mismo ID en servidor y navegador

Cada llamada genera otro UUID. Conserva el ID del servidor en los datos serializados.

```ts bad
const browserId = createId() // Nuevo ID: no coincide con el generado en SSR.
```

```ts good
import { createId } from '@meekojs/meeko'

const serverItem = { id: createId() }
const payload = JSON.stringify(serverItem)
const browserItem = JSON.parse(payload) as typeof serverItem
const browserId = browserItem.id // El ID recibido, no uno generado de nuevo.
```

- Usarlo para un ID del DOM que debe coincidir durante SSR e hidratación: en el setup del componente usa `useId()`.
- Suponer unicidad matemática de registros persistidos: añade una restricción única en el almacenamiento y reintenta una colisión.

## Notas

Lanza un error si el entorno no ofrece Web Crypto. Las colisiones son extremadamente improbables, pero posibles; la función no comprueba el almacenamiento de la aplicación.
