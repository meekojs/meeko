---
title: defineProps
group: macros
since: 1.0.0
description: Declares component props with a TypeScript type and defaults, returning a reactive read-only view that also supports destructuring.
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
  - docs/api.md#desestructurar-las-props
  - docs/api.md#constantes-en-los-valores-por-defecto
  - docs/api.md#props-estáticas
source-hash: 61717eda1f3878b026c87f88f7cc38f4252a5819f70cf486aae304c492bd9b5b
---

`defineProps<Props>()` declares the props received by the component and returns the `props` object. It is a compile-time macro: it is neither imported nor present at runtime; the compiler reads `Props` and generates `ComponentProps`, checked by `meeko check` and the editor on each parent tag.

**Naming convention:** if you declare the props interface in the same `<script>`, name it `Props` and use `defineProps<Props>()`. `meeko check` and the editor emit warning `MEEK120` if that local interface has another name; the component still compiles. Inline types, aliases and imported interfaces retain their names. To query props from another file, use `ComponentProps<"NombreDelComponente">`; you do not need to export a global interface per component.

Since `1.2`, `props` is a **reactive** read-only view: every read of `props.x` in the template, a `computed` or an `effect` tracks the prop when the parent changes it, without remounting the child. The optional argument is an object literal with defaults. Since `1.8`, the result can also be destructured (`const { label, size = "md", ...rest } = defineProps<Props>()`) without losing reactivity.

## Usage

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

`step` has a default, so it is optional for the parent and always `number` inside the component. Passing a prop to `signal(...)`, alone or in an expression such as `props.initial ?? 0`, declares that the signal only takes its initial value; through `1.6`, the expression produced a false `MEEK101` warning and needed wrapping in `untrack`.

## Parameters

| Parameter               | Type           | Default  | Description                                                                                                                                                                 |
| ----------------------- | -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Props` (type argument) | an object type | required | Props: an interface, alias, intersection or union. Omitting the type argument produces `MEEK017`.                                                                           |
| `defaults`              | object literal | none     | Default values. Each key must exist in `Props` and its value must have the corresponding type. These props become optional for the parent and are never `undefined` inside. |

The defaults argument must be an **object literal with named properties**: no spreads or computed keys (`MEEK041`), no duplicate keys (`MEEK042`) and no `undefined` values. Values can use literals, imports and, since `1.8`, top-level script constants using only literals and imports; another setup variable produces `MEEK123`. Variables declared by the value itself (a local variable, block, `catch`, parameter or accessor name) do not count; the setup function's `arguments`, `new.target` and `super` do (`MEEK123`).

With a props union, a literal default (`kind = "a"`, or a top-level constant holding a literal) makes its prop optional only in variants accepting that value: with `{ kind: "a"; a: string } | { kind: "b"; b: string }` and `kind = "a"`, the parent can omit `kind` with `a`, but must pass `kind="b"` with `b`. A nonliteral default is optional in all variants, so each variant requiring the prop must accept it (`MEEK131`, since `1.8`).

With destructuring, write defaults in the pattern (`size = "md"`), equivalent to the argument; they cannot appear in both places (`MEEK124`).

## Return value

`Readonly<Props>`, with defaults applied. A view of current props, or their names when destructured (see [Destructure props](#destructure-props)):

- reading `props.x` in the template, a `computed`, an `effect` or `useApi`'s input function tracks the prop;
- `"x" in props`, `Object.keys(props)` and `{ ...props }` see props the parent adds or stops passing;
- a prop becoming `undefined` reverts to its default;
- assigning, deleting or defining a `props` property in the browser throws `TypeError`.

## Examples

### Destructure props

Since `1.8`, each destructured name reads its prop where used: in the template, a `computed`, an `effect` or a handler, it tracks the parent just like `props.x`:

```html
<!-- app/components/AppTag.meeko -->
<script lang="ts">
interface Props {
  label: string;
  tone?: "neutral" | "danger";
  class?: string;
  title?: string;
}

const { label, tone = "neutral", class: className, ...rest } = defineProps<Props>();
const upper = computed(() => label.toUpperCase());
</script>

<template>
  <span bind:class="`tag tag--${tone} ${className ?? ''}`" bind="rest">{upper.value}</span>
</template>
```

- `tone = "neutral"` is a default: the prop is optional for the parent and never `undefined` inside. The editor displays it in hover and parent completion (`tone?: "neutral" | "danger" = "neutral"`).
- `class: className` renames a prop, useful for reserved words.
- `...rest` is a read-only view of remaining props (here, `title`), excluding destructured ones and `defineEmits` handlers, tracking the parent: `bind="rest"` writes its current attributes.
- A parameter, local variable, `each:as` or snippet parameter with the same name is a different variable.
- Unions narrow in the script and template: `if:when="to !== undefined"` gives that branch's `params`. The guide's [polymorphic button](../../api.md#a-button-that-is-a-route-link-or-button) has a destructured version.

### Constants in defaults

Since `1.8`, a default can read a top-level constant whose value uses only literals, imports and similar constants. It is evaluated again with defaults, so an object is still new per instance:

```html
<script lang="ts">
const SIZES = ["sm", "md", "lg"] as const;
const DEFAULT_SIZE = SIZES[1];
const { size = DEFAULT_SIZE } = defineProps<{ size?: "sm" | "md" | "lg" }>();
</script>

<template><span bind:class="`size-${size}`">{size}</span></template>
```

### Defaults created per instance

The defaults object is evaluated on every render or hydration, so an array or object created inside is new per instance:

```html
<script lang="ts">
const props = defineProps<{ title: string; tags?: string[]; size?: "sm" | "md" | "lg" }>({ tags: [], size: "md" });
</script>

<template>
  <h3 bind:class="`title title--${props.size}`">{props.title}</h3>
  <p if:when="props.tags.length">{props.tags.join(", ")}</p>
</template>
```

### Derive from a prop without losing reactivity

Setup runs once. To track a prop, read it where used or derive with `computed`:

```html
<script lang="ts">
const props = defineProps<{ name: string; price: number }>();
const label = computed(() => `${props.name.toUpperCase()} · ${props.price.toFixed(2)} €`);
</script>

<template><p>{label.value}</p></template>
```

### A callback prop

A prop can be a function. `defineEmits` is shorter, but a manually declared prop remains valid:

```html
<script lang="ts">
const props = defineProps<{ items: string[]; onPick?: (item: string) => void }>();
</script>

<template>
  <ul><li each:of="props.items" each:as="item" on:click="() => props.onPick?.(item)">{item}</li></ul>
</template>
```

### Page props

A page receives `params`, `search` and, with a loader, `data`; `meeko check` checks that their types match route option output:

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

## Common mistakes

### Nested destructuring

```html bad
<script lang="ts">
const { user: { name } } = defineProps<{ user: { name: string } }>();
</script>
```

`MEEK015: defineProps no admite desestructuración anidada: el valor interior sería una copia que no sigue a la prop. Desestructura la prop entera, como const { user } = defineProps<Props>(), y lee sus campos donde los uses`. An array, computed key and `let` also produce `MEEK015`. Through `1.7`, all destructuring did.

```html good
<script lang="ts">
const { user } = defineProps<{ user: { name: string } }>();
</script>

<template><p>{user.name}</p></template>
```

### Assign a destructured prop

```html bad
<script lang="ts">
const { count } = defineProps<{ count: number }>();
</script>

<template><button type="button" on:click="() => count++">{count}</button></template>
```

`MEEK125: count es la prop count de defineProps y es de sólo lectura: no se puede asignar ni borrar con delete. Para cambiar un valor del padre, emite un evento (defineEmits) o usa un modelo (defineModel); para un valor propio que empieza con la prop, usa signal(count)`. `delete count` also produces `MEEK125`: it would delete the prop from the parent's object.

```html good
<script lang="ts">
const { count } = defineProps<{ count: number }>();
const current = signal(count);
</script>

<template><button type="button" on:click="() => current.value++">{current.value}</button></template>
```

### Copy a destructured prop during setup

```html bad
<script lang="ts">
const { label } = defineProps<{ label: string }>();
const upper = label.toUpperCase();
</script>
```

Compiles, but `upper` retains the initial value: `meeko check` warns with `MEEK101: label es una prop de defineProps y aquí se lee una sola vez porque el setup se ejecuta una sola vez…`.

```html good
<script lang="ts">
const { label } = defineProps<{ label: string }>();
const upper = computed(() => label.toUpperCase());
</script>
```

### Defaults in both pattern and argument

```html bad
<script lang="ts">
const { size = "md" } = defineProps<{ size?: string }>({ size: "sm" });
</script>
```

`MEEK124: Los valores por defecto van en la desestructuración o en el argumento de defineProps, no en los dos: escríbelos en la desestructuración, como size = …, y quita el argumento`.

```html good
<script lang="ts">
const { size = "md" } = defineProps<{ size?: string }>();
</script>
```

### A default depending on setup

```html bad
<script lang="ts">
const start = signal(1);
const { count = start.value } = defineProps<{ count?: number }>();
</script>
```

`MEEK123: El valor por defecto de la prop count usa start, que depende del setup: su valor llama a una función, que podría depender del setup o tener efectos. Los valores por defecto se evalúan antes del setup…`. A `let` variable, script function, another prop, a call's value (`Date.now()`) or `arguments` also count. A variable declared by the default itself, such as `(() => { const start = 2; return start; })()`, does not.

```html good
<script lang="ts">
const START = 1;
const { count = START } = defineProps<{ count?: number }>();
</script>
```

### A nonliteral default in a union discriminant

```html bad
<script lang="ts">
import { DEFAULT_KIND } from "./kinds";
type Props = { kind: "a"; a: string } | { kind: "b"; b: string };
const { kind = DEFAULT_KIND } = defineProps<Props>();
</script>
```

`MEEK131: el valor por defecto de kind no es un literal y alguna variante de las props exige kind con un valor que no lo admite…`. With a nonliteral default, `kind` would be optional in both variants and the parent could pass `b` without `kind`, which would become `"a"`. Write a literal or a top-level constant holding a literal: `kind` is optional only in the variant accepting it.

```html good
<script lang="ts">
type Props = { kind: "a"; a: string } | { kind: "b"; b: string };
const { kind = "a" } = defineProps<Props>();
</script>
```

### Copy a prop during setup

```html bad
<script lang="ts">
const props = defineProps<{ label: string }>();
const upper = props.label.toUpperCase();
</script>
```

Compiles, but `upper` retains the initial value. `meeko check` warns with `MEEK101: props.label se lee una sola vez porque el setup se ejecuta una sola vez: no se actualizará cuando el padre cambie la prop; léela donde se usa: {props.x} en la plantilla, computed(() => props.x) o una función. Si sólo quieres el valor inicial, usa signal(props.label) o untrack(() => props.label)`.

```html good
<script lang="ts">
const props = defineProps<{ label: string }>();
const upper = computed(() => props.label.toUpperCase());
</script>
```

### No type argument

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

### Call it twice

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

### Defaults that are not an object literal

```html bad
<script lang="ts">
const base = { tags: [] };
const props = defineProps<{ tags?: string[] }>({ ...base });
</script>
```

`MEEK041: Los valores por defecto de defineProps necesitan propiedades con nombre`. Since `1.8`, a setup variable as a value (`{ count: fallback }`) produces `MEEK123` (through `1.7`, `TS2304: Cannot find name 'fallback'.`), except for a constant of literals and imports.

```html good
<script lang="ts">
const props = defineProps<{ tags?: string[] }>({ tags: [] });
</script>
```

### Defaults not matching `Props`

```html bad
<script lang="ts">
const props = defineProps<{ count?: number }>({ count: "3", size: 2 });
</script>
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type 'number'.` and, for a nonexistent key, `TS2322: Type 'number' is not assignable to type 'never'.`

```html good
<script lang="ts">
const props = defineProps<{ count?: number }>({ count: 3 });
</script>
```

### A required prop omitted by the parent

```html bad
<AppCounter bind:initial="10" />
```

`meeko check` reports `TS2345: Argument of type '{ initial: number; }' is not assignable to parameter of type …` with `Property 'label' is missing`. An undeclared child prop produces `TS2353`, and one of the wrong type produces `TS2322`.

```html good
<AppCounter label="Visitas" bind:initial="10" />
```

## Notes

- **SSR and hydration.** The server renders with props and the browser hydrates with the same ones, transferred in the payload: they must be JSON-serializable when the component is a page or layout, and defaults must be deterministic (no `Date.now()` or `Math.random()`).
- **Reactivity.** Setup runs once per instance; only reads in the template, a `computed`, an `effect` or a function track the prop. Components with a top-level `await useApi(...)` remount with new props.
- **Read-only.** To change a parent value, emit an event (`defineEmits`) or use a model (`defineModel`). Since `1.7`, the script sees props as `Readonly<Props>`: assigning `props.x` is error `TS2540` in `meeko check` and the editor, and throws `TypeError` at runtime.
- **Location.** In its own top-level `const` declaration, named or destructured, before any browser `await` (`MEEK058`). In `<script server>`, produces `MEEK108`.
- **Types.** The compiled module exports `ComponentProps`; each auto-imported component also has `<Nombre>Props`, such as `AppCounterProps`, without an import.
