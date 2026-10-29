---
title: defineProps
group: macros
since: 1.0.0
description: Declara las props de un componente con un tipo de TypeScript y sus valores por defecto, y devuelve una vista reactiva de sólo lectura.
symbols:
  - "syntax:defineprops"
related:
  - "syntax:defineemits"
  - "syntax:definemodel"
  - "syntax:definesnippets"
  - "syntax:bind"
  - "syntax:generic"
  - "@meekojs/meeko#Component"
  - docs/api.md#props-reactivas
  - docs/api.md#valores-por-defecto-en-defineprops
  - docs/api.md#props-estáticas
---

`defineProps<Props>()` declara las props que recibe el componente y devuelve el objeto `props`. Es una macro de compilación: no se importa ni existe en ejecución; el compilador lee el tipo `Props` y genera `ComponentProps`, que comprueban `meeko check` y el editor en cada etiqueta del padre.

Desde `1.2`, `props` es una vista **reactiva** de sólo lectura: cada lectura de `props.x` en la plantilla, en un `computed` o en un `effect` sigue a la prop cuando el padre la cambia, sin volver a montar el hijo. El argumento opcional es un objeto literal con valores por defecto.

## Uso

```html
<!-- app/components/AppCounter.meeko -->
<script lang="ts">
interface Props {
  label: string;
  initial?: number;
  step?: number;
}

const props = defineProps<Props>({ step: 1 });
const count = signal(props.initial ?? 0); // sólo el valor inicial
</script>

<template>
  <button type="button" on:click="() => count.value += props.step">{props.label}: {count.value}</button>
</template>
```

```html
<AppCounter label="Visitas" bind:initial="10" />
```

`step` tiene valor por defecto, así que es opcional para el padre y, dentro del componente, siempre es `number`. Pasar la prop a `signal(...)`, sola o en una expresión como `props.initial ?? 0`, declara que la señal sólo toma su valor inicial; hasta `1.6`, la expresión daba un falso aviso `MEEK101` y hacía falta envolverla en `untrack`.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `Props` (argumento de tipo) | un tipo de objeto | obligatorio | Las props: una interfaz, un alias, una intersección o una unión. Sin argumento de tipo es `MEEK017`. |
| `defaults` | objeto literal | ninguno | Valores por defecto. Cada clave debe existir en `Props` y su valor, tener su tipo. Esas props pasan a ser opcionales para el padre y nunca son `undefined` dentro. |

El argumento de defaults debe ser un **objeto literal con propiedades con nombre**: sin spreads ni claves calculadas (`MEEK041`), sin claves repetidas (`MEEK042`) y sin valores `undefined`. Sus valores pueden usar literales e imports, no variables del setup.

## Valor devuelto

`Readonly<Props>`, con los defaults aplicados. Es una vista de las props actuales:

- leer `props.x` en la plantilla, en un `computed`, en un `effect` o en la función de entrada de `useApi` sigue a la prop;
- `"x" in props`, `Object.keys(props)` y `{ ...props }` ven las props que el padre añade o deja de pasar;
- una prop que pasa a `undefined` vuelve a su default;
- asignar, borrar o definir una propiedad de `props` en el navegador lanza `TypeError`.

## Ejemplos

### Valores por defecto creados por instancia

El objeto de defaults se evalúa en cada render o hidratación, así que un array o un objeto creado dentro es nuevo por instancia:

```html
<script lang="ts">
const props = defineProps<{ title: string; tags?: string[]; size?: "sm" | "md" | "lg" }>({ tags: [], size: "md" });
</script>

<template>
  <h3 bind:class="`title title--${props.size}`">{props.title}</h3>
  <p if:when="props.tags.length">{props.tags.join(", ")}</p>
</template>
```

### Derivar de una prop sin perder la reactividad

El setup se ejecuta una vez. Para seguir a la prop, léela donde se usa o deriva con `computed`:

```html
<script lang="ts">
const props = defineProps<{ name: string; price: number }>();
const label = computed(() => `${props.name.toUpperCase()} · ${props.price.toFixed(2)} €`);
</script>

<template><p>{label.value}</p></template>
```

### Un callback como prop

Una prop puede ser una función. `defineEmits` lo hace más corto, pero una prop declarada a mano sigue siendo válida:

```html
<script lang="ts">
const props = defineProps<{ items: string[]; onPick?: (item: string) => void }>();
</script>

<template>
  <ul><li each:of="props.items" each:as="item" on:click="() => props.onPick?.(item)">{item}</li></ul>
</template>
```

### Las props de una página

Una página recibe `params`, `search` y, con un loader, `data`; `meeko check` comprueba que su tipo coincide con lo que entregan las opciones de ruta:

```html
<!-- app/pages/products/[slug].meeko -->
<script server lang="ts">
export const route = definePage({ load: ({ params }) => ({ name: `Producto ${params.slug ?? ""}` }) });
</script>

<script lang="ts">
export interface Props {
  params: { slug: string };
  search: Record<string, string | string[]>;
  data: { name: string };
}
const props = defineProps<Props>();
</script>

<template><h1>{props.data.name}</h1></template>
```

## Errores comunes

### Desestructurar las props

```html bad
<script lang="ts">
const { title } = defineProps<{ title: string }>();
</script>
```

`MEEK015: defineProps no admite desestructuración: asígnalo a un nombre simple, como const props = defineProps<{ title: string }>(), y lee props.title`.

```html good
<script lang="ts">
const props = defineProps<{ title: string }>();
</script>
```

### Copiar una prop en el setup

```html bad
<script lang="ts">
const props = defineProps<{ label: string }>();
const upper = props.label.toUpperCase();
</script>
```

Compila, pero `upper` conserva el valor inicial. `meeko check` avisa con `MEEK101: props.label se lee una sola vez porque el setup se ejecuta una sola vez: no se actualizará cuando el padre cambie la prop; léela donde se usa: {props.x} en la plantilla, computed(() => props.x) o una función. Si sólo quieres el valor inicial, usa signal(props.label) o untrack(() => props.label)`.

```html good
<script lang="ts">
const props = defineProps<{ label: string }>();
const upper = computed(() => props.label.toUpperCase());
</script>
```

### Sin argumento de tipo

```html bad
<script lang="ts">
const props = defineProps();
</script>
```

`MEEK017: defineProps necesita un argumento de tipo`.

```html good
<script lang="ts">
const props = defineProps<{ title: string }>();
</script>
```

### Llamarla dos veces

```html bad
<script lang="ts">
const props = defineProps<{ title: string }>();
const more = defineProps<{ subtitle: string }>();
</script>
```

`MEEK016: defineProps debe aparecer una sola vez, en su propia declaración`.

```html good
<script lang="ts">
const props = defineProps<{ title: string; subtitle: string }>();
</script>
```

### Defaults que no son un objeto literal

```html bad
<script lang="ts">
const base = { tags: [] };
const props = defineProps<{ tags?: string[] }>({ ...base });
</script>
```

`MEEK041: Los valores por defecto de defineProps necesitan propiedades con nombre`. Una variable del setup como valor (`{ count: fallback }`) da `TS2304: Cannot find name 'fallback'.`, porque los defaults se evalúan fuera del setup.

```html good
<script lang="ts">
const props = defineProps<{ tags?: string[] }>({ tags: [] });
</script>
```

### Defaults que no coinciden con `Props`

```html bad
<script lang="ts">
const props = defineProps<{ count?: number }>({ count: "3", size: 2 });
</script>
```

`meeko check` da `TS2322: Type 'string' is not assignable to type 'number'.` y, para la clave que no existe, `TS2322: Type 'number' is not assignable to type 'never'.`

```html good
<script lang="ts">
const props = defineProps<{ count?: number }>({ count: 3 });
</script>
```

### Una prop obligatoria que el padre no pasa

```html bad
<AppCounter bind:initial="10" />
```

`meeko check` da `TS2345: Argument of type '{ initial: number; }' is not assignable to parameter of type …` con `Property 'label' is missing`. Una prop que el hijo no declara da `TS2353`, y una del tipo equivocado, `TS2322`.

```html good
<AppCounter label="Visitas" bind:initial="10" />
```

## Notas

- **SSR e hidratación.** El servidor renderiza con las props y el navegador hidrata con las mismas, que viajan en el payload: deben poder serializarse en JSON cuando el componente es una página o un layout, y los defaults deben ser deterministas (nada de `Date.now()` ni `Math.random()`).
- **Reactividad.** El setup se ejecuta una vez por instancia; sólo las lecturas dentro de la plantilla, un `computed`, un `effect` o una función siguen a la prop. Los componentes con un `await useApi(...)` de nivel superior se vuelven a montar con props nuevas.
- **Sólo lectura.** Para cambiar un valor del padre, emite un evento (`defineEmits`) o usa un modelo (`defineModel`). Desde `1.7`, el script ve las props como `Readonly<Props>`: asignar `props.x` es el error `TS2540` en `meeko check` y el editor, y en ejecución lanza `TypeError`.
- **Dónde va.** En su propia declaración `const` de nivel superior, antes de cualquier `await` de navegador (`MEEK058`). En `<script server>` es `MEEK108`.
- **Tipos.** El módulo compilado exporta `ComponentProps`; cada componente autoimportado tiene además `<Nombre>Props`, como `AppCounterProps`, sin import.
