---
title: if:when
group: syntax
since: 1.0.0
description: Renders a tag and its content only while an expression is truthy, and narrows types inside it.
symbols:
  - "syntax:if-when"
related:
  - "syntax:each"
  - "syntax:snippet-tag"
  - "syntax:render-tag"
  - "syntax:interpolation"
  - "syntax:meekoawait"
  - docs/api.md#condiciones-con-ifwhen-y-tipos
source-hash: c69dee5a9d6d205fad33aa88b14c7d9b61888bc0345c212439052dccebce1bc0
---

`if:when="expresión"` makes a tag and all its content exist only while the expression is truthy (in the JavaScript sense: `0`, `""`, `null` and `undefined` are falsy). Valid on HTML elements, component tags, `<component is>` and, since `1.4`, `<snippet>`.

Since `1.2`, it also narrows types, like Vue's `v-if`: inside the tag, `meeko check` and the editor check attributes, props, events and content knowing the condition holds, without `!`.

## Usage

```html
<!-- app/components/UserCard.meeko -->
<script lang="ts">
const user = signal<{ name: string; email: string } | null>(null);
</script>

<template>
  <article if:when="user.value">
    <h2>{user.value.name}</h2>
    <a bind:href="`mailto:${user.value.email}`">{user.value.email}</a>
  </article>
  <p if:when="!user.value">Sin sesión.</p>
</template>
```

While `user.value` is `null`, only the second paragraph exists. Inside `<article>`, `user.value` is `{ name: string; email: string }` to TypeScript.

## Attributes

| Attribute | Type           | Default  | Description                                                                                        |
| --------- | -------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `if:when` | any expression | required | The condition. Evaluated as a JavaScript boolean and reevaluated when the signals it reads change. |

There is no `if:else` or `else-if`: write the opposite condition on another tag (`if:when="!user.value"`). An unknown `if:` attribute produces `MEEK024: Directiva de plantilla incompleta` and, alongside an `if:when`, warning `MEEK119` (since `1.7`), because it would be written as a literal HTML attribute.

## Result

- **Truthy condition.** The tag and its content render as if they had no directive.
- **Falsy condition.** Nothing renders: content is never evaluated, so its expressions do not execute or fail.
- **In HTML.** The region is enclosed by two marker comments, even when empty, so hydration knows where it is.
- **On change.** Becoming falsy disposes of the region (its effects, listeners and child components, which run their cleanup); becoming truthy recreates it with fresh state.

## Examples

### Loading states

Multiple mutually exclusive conditions cover a resource's states:

```html
<script lang="ts">
const items = useApi("/api/items");
</script>

<template>
  <p if:when="items.pending.value && !items.data.value">Cargando…</p>
  <p if:when="items.error.value" role="alert">No se pudo cargar.</p>
  <ul if:when="items.data.value">
    <li each:of="items.data.value" each:as="item" each:key="item.id">{item.name}</li>
  </ul>
</template>
```

For a region with loading, error and retry states, `<MeekoAwait>` does the same with less code and reserves height.

### A conditional component

On a component tag, the condition also narrows its props:

```html
<template>
  <WorkspaceHeader if:when="session.data.value?.staff" bind:staff="session.data.value.staff" />
</template>
```

`bind:staff` receives the type without `undefined`, because TypeScript knows the condition holds.

### Show and hide without losing state

`if:when` destroys the region when hiding it. To retain form state or a panel's scroll position, hide the element with `hidden` instead of removing it:

```html
<script lang="ts">
const open = signal(false);
const draft = signal("");
</script>

<template>
  <button type="button" bind:aria-expanded="open.value ? 'true' : 'false'" on:click="() => open.value = !open.value">Notas</button>
  <section bind:hidden="!open.value">
    <textarea model="draft"></textarea>
  </section>
</template>
```

### An optional snippet

In the child, `if:when` checks whether the parent passed an optional snippet before rendering its container:

```html
<!-- app/components/AppCard.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: []; footer?: [] }>();
</script>

<template>
  <article class="card">
    <render snippet="snippets.default" />
    <footer if:when="snippets.footer"><render snippet="snippets.footer" /></footer>
  </article>
</template>
```

## Common mistakes

### `if:when` and `each:of` on the same tag

```html bad
<li each:of="items.value" each:as="item" if:when="item.visible">{item.name}</li>
```

`MEEK021: Un nodo no puede tener if:when y each:of a la vez`. Filter the list first, or put the condition on an inner element.

```html good
<li each:of="visibleItems.value" each:as="item" each:key="item.id">{item.name}</li>
```

With `const visibleItems = computed(() => items.value.filter((item) => item.visible))` in the script.

### Expect an `else`

```html bad
<p if:when="user.value">Hola, {user.value.name}</p>
<p if:else>Sin sesión.</p>
```

`MEEK024: Directiva de plantilla incompleta`, on `if:else`.

```html good
<p if:when="user.value">Hola, {user.value.name}</p>
<p if:when="!user.value">Sin sesión.</p>
```

### Lose narrowing in an arrow function

TypeScript does not retain property narrowing inside a function that runs later.

```html bad
<div if:when="user.value">
  <button on:click="() => save(user.value.id)">Guardar</button>
</div>
```

`meeko check` reports `TS18047: 'user.value' is possibly 'null'.` in the handler.

```html good
<div if:when="user.value">
  <button on:click="saveCurrent">Guardar</button>
</div>
```

With `function saveCurrent(): void { if (user.value) save(user.value.id); }` in the script.

### An empty condition

```html bad
<p if:when>Hola</p>
```

`MEEK020: Expression expected.` The directive needs an expression; to hide an element statically, remove it from the template.

```html good
<p if:when="visible.value">Hola</p>
```

## Notes

- **SSR and hydration.** The server evaluates the condition and renders the corresponding branch between its markers; the browser evaluates it again during hydration and must get the same result. A browser-dependent condition (`window.innerWidth`, `localStorage`, local time) causes a hydration error: render that part in `onMounted` or store the value in a signal you change after mounting.
- **Performance.** Hiding disposes of the region and showing recreates it with its children. For a panel opened and closed often, `bind:hidden` is cheaper and preserves state.
- **Types.** Only checking changes: at runtime, content is never evaluated with a falsy condition. Narrowing reaches nested conditions and lists and snippets in a component tag, except where `each:as`, `each:index` or a snippet parameter shadows the name.
- **Accessibility.** A message appearing with `if:when` is not announced automatically: give it `role="alert"` or `role="status"`, or put it in an always-present `aria-live` region.
