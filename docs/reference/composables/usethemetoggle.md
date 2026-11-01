---
title: useThemeToggle
group: composables
since: 1.8.0
description: Estado público para un selector de tema propio compatible con SSR, hidratación y formularios sin JavaScript.
symbols:
  - '@meekojs/meeko/framework#useThemeToggle'
types:
  - '@meekojs/meeko/framework#ThemeToggleState'
  - '@meekojs/meeko/framework#ThemeToggleSystem'
related:
  - '@meekojs/meeko/framework#useTheme'
  - 'config:theme'
  - docs/framework.md#selector-de-tema-propio
---

`useThemeToggle()` proporciona el estado que usa `UIThemeToggle` de `@meekojs/ui`. Permite construir un selector conservando el tema del SSR durante la hidratación.

## Uso

Activa `theme: true` en `meeko.config.ts` y llama al composable en el script de un componente:

```ts
import { useThemeToggle } from '@meekojs/meeko/framework'

const toggle = useThemeToggle()
```

## Parámetros

No recibe parámetros. Lee los temas de la configuración del framework.

## Valor devuelto

Un `ThemeToggleState<Name, Choice>`, con nombres inferidos de la configuración:

| Propiedad     | Tipo                                   | Descripción                                                                     |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| `theme`       | `ThemeState<Name, Choice>`             | Estado de `useTheme()`, con `set(choice)` para cambiarlo en el navegador.       |
| `choices`     | `readonly Choice[]`                    | Elecciones en orden, con `"system"` si está activo.                             |
| `system`      | `ThemeToggleSystem<Name> \| undefined` | Nombres `light` y `dark` que resuelve el modo sistema.                          |
| `known`       | `ReadonlySignal<boolean>`              | La elección es conocida: cookie en SSR o hidratación terminada en el navegador. |
| `interactive` | `ReadonlySignal<boolean>`              | Los handlers ya responden; `false` en SSR y durante la hidratación.             |

## Ejemplos

```ts
import { computed } from '@meekojs/meeko'
import { useThemeToggle } from '@meekojs/meeko/framework'

const toggle = useThemeToggle()
const label = computed(() => (toggle.known.value ? `Tema: ${toggle.theme.theme.value}` : 'Cambiar tema'))
```

El [selector de tema propio](../../framework.md#selector-de-tema-propio) incluye un formulario completo con `POST /_meeko/theme`, `theme` y `return`, que cambia mediante `theme.set(choice)` cuando `interactive.value` es `true`.

Para iconos sin saltos, pinta todos los iconos con `data-meeko-theme-icon` y deja que la regla de `<head>` muestre el de la elección. Mientras `known.value` sea `false`, anuncia una acción neutra («Cambiar tema»).

## Errores comunes

### Llamarlo sin configurar el tema

```ts bad
// meeko.config.ts no activa theme
const toggle = useThemeToggle()
```

<!-- no-check -->

```ts good
// meeko.config.ts
export default defineMeekoConfig({ theme: true })
```

Sin `theme` en `meeko.config.ts`, o fuera de una aplicación Meeko, lanza `MEEK111`. Activa `theme: true` y llámalo mientras se ejecuta el script de un componente.

### Cambiar el tema durante el SSR

```ts bad
const toggle = useThemeToggle()
toggle.theme.set('dark') // el setup también corre en el servidor
```

```ts good
import { useThemeToggle } from '@meekojs/meeko/framework'

const toggle = useThemeToggle()
const chooseDark = (): void => {
	if (toggle.interactive.value) toggle.theme.set('dark')
}
```

`theme.set()` sólo cambia el tema en el navegador. En SSR usa el estado de sólo lectura y conserva el envío nativo del formulario; no llames a `set` en el setup.

## Notas

- `known` e `interactive` son señales de sólo lectura: consulta `.value` en el binding que las usa.
- El formulario funciona sin JavaScript con un adaptador con servidor. El adaptador `static` necesita JavaScript.
- La cookie, el script, la regla de iconos de `<head>` y `POST /_meeko/theme` permanecen en core; no requieren UI.
- `<MeekoThemeToggle>` está obsoleto desde 1.8 y se retira en 2.0. Para un selector listo, activa el módulo UI y usa `<UIThemeToggle>`.
