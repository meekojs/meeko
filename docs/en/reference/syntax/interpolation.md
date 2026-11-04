---
title: "{expresión}"
group: syntax
since: 1.0.0
description: Inserts a TypeScript expression's value into the template as escaped text, updated when the signals it reads change.
symbols:
  - "syntax:interpolation"
related:
  - "syntax:html"
  - "syntax:bind"
  - "syntax:if-when"
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko#computed"
  - docs/api.md#componentes-meeko
  - docs/api.md#condiciones-con-ifwhen-y-tipos
source-hash: 23a4fc9098bf6252a2b135cc1fc05c5d8c98a8da47025d8a2f8d2b465a66c8de
---

`{expresión}` writes a TypeScript expression's value into an element's content, always **escaped**: `<`, `>`, `&` and quotes arrive as text, never HTML. The expression sees everything declared at `<script>` top level (signals, `props`, functions, imports) and data exported by a page's `<script server>`.

Each interpolation is its own reactive binding: when a signal it reads changes, Meeko updates only that text node, without rendering the component again.

## Usage

```html
<!-- app/components/Inbox.meeko -->
<script lang="ts">
const props = defineProps<{ name: string }>();
const unread = signal(3);
</script>

<template>
  <p>{props.name} has {unread.value} unread messages</p>
</template>
```

In SSR, with `name: "Ana"`, the paragraph says “Ana tiene 3 mensajes sin leer” (Ana has 3 unread messages); each value sits between two `<!--meeko:text:N-->` comments used by hydration to find its node. Changing `unread.value` only changes the number.

## Attributes

| Syntax        | Type                      | Default  | Description                                                                                                                                    |
| ------------- | ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `{expresión}` | any TypeScript expression | required | Evaluated in the `<script>` scope (and `<script server>` data scope), and its result written as text. Only in element content, not attributes. |

What the expression accepts:

- Any TypeScript expression: calls, ternaries, operators, template literals (``{`${count.value} €`}``), `as` and `!`.
- JavaScript braces: an object literal (`{ { total: count.value }.total }`), a template with `${…}`, strings with `{` or `}`, comments and regular expressions. Interpolation ends at the brace balancing the opening one.
- Write `<`, `&&` and strings with tags as is: `{a<b&&c}`, `{ok && "<b>"}`. An expression's `<` never opens a tag.
- HTML character references (`&lt;`, `&amp;`, `&#60;`) are decoded before evaluation, as in attribute values and Vue: `{x &amp;&amp; y}` is `x && y`, and `{'&lt;'}` renders `<`. To preserve a literal reference, write its `&` from JavaScript: `{"\x26lt;"}` renders `&lt;`. Diagnostics and source maps point to the position in the source, after the reference.
- Statements (`if`, `const`, `;`) are not accepted: compute the value in the script or with a `computed`.

## Result

A text node with `String(valor)`, between two marker comments: escaped in server HTML and assigned through `textContent` in the browser.

| Value                         | Text                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `string`, `number`, `boolean` | Their text conversion: `"Ana"`, `3`, `true`.                                      |
| `null`, `undefined`           | Their text conversion: `null`, `undefined`. Use `?? ""` to render nothing.        |
| An object or signal           | `[object Object]`: read `.value` or the property you want.                        |
| HTML (`"<b>hola</b>"`)        | The literal text `<b>hola</b>`, escaped. To insert HTML use the `html` directive. |

## Examples

### Computed values with `computed`

For a repeated calculation or one reading several signals, a `computed` avoids repeating the expression and only recomputes when its dependencies change:

```html
<script lang="ts">
const items = signal([{ name: "Tea", price: 3.5, qty: 2 }]);
const total = computed(() => items.value.reduce((sum, item) => sum + item.price * item.qty, 0));
const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
</script>

<template>
  <p>Total: {money.format(total.value)}</p>
  <p>{items.value.length === 1 ? "1 item" : `${items.value.length} items`}</p>
</template>
```

### Optional values

With `strict`, TypeScript requires checking `null` before reading a property. `?.` and `??` handle it within the expression, and `if:when` narrows the type for an entire block:

```html
<script lang="ts">
const user = signal<{ name: string; city?: string } | null>(null);
</script>

<template>
  <p>Hello, {user.value?.name ?? "guest"}</p>
  <p if:when="user.value">{user.value.name} lives in {user.value.city ?? "somewhere"}</p>
</template>
```

### A page's server data

An `export const` from `<script server>` reaches the template with its name and type:

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
export const profile = { id: params.id, name: `Usuario ${params.id}` };
</script>

<template><h1>{profile.name}</h1></template>
```

### User text, safely

Text is always escaped, so a comment containing HTML is displayed as is and does not execute:

```html
<script lang="ts">
const props = defineProps<{ comment: string }>(); // "<img src=x onerror=alert(1)>"
</script>

<template><blockquote>{props.comment}</blockquote></template>
```

## Common mistakes

### An unclosed brace

```html bad
<p>Hello {user.value.name</p>
```

The compiler reports `MEEK010: Expresión de plantilla sin cerrar`, at the opening brace. To write a literal brace in text, interpolate it as a string.

```html good
<p>Hello {user.value.name}</p>
<p>Write braces as {"{"} and {"}"}</p>
```

### An empty interpolation

```html bad
<p>Hello {}</p>
```

`MEEK009: Expresión de plantilla vacía`.

```html good
<p>Hello {name.value}</p>
```

### Interpolate the signal instead of its value

`{count}` is not a type error: the template accepts any value, but renders `[object Object]` and does not update.

```html bad
<button on:click="increment">{count}</button>
```

```html good
<button on:click="increment">{count.value}</button>
```

### Read a property of a potentially `null` value

```html bad
<p>{user.value.name}</p>
```

`meeko check` reports `TS18047: 'user.value' is possibly 'null'.`

```html good
<p if:when="user.value">{user.value.name}</p>
```

### Braces in an attribute

Braces only interpolate in content. In an attribute they are literal text: `title="{name}"` writes `{name}`.

```html bad
<a title="{user.value.name}">Profile</a>
```

```html good
<a bind:title="user.value.name">Profile</a>
```

## Notes

- **SSR and hydration.** The server writes escaped text and the browser claims that node during hydration: the expression is evaluated on both sides with the same data. A different value on each side (`Date.now()`, `Math.random()`, the browser's time zone) produces a hydration error; compute it on the server and pass it as data, or render it in `onMounted`.
- **Reactivity.** Each `{…}` subscribes to the signals it reads and updates in place. Reading `props.x` in the template follows the prop when the parent changes it.
- **Security.** Escaping makes any string safe, including user strings. For trusted HTML, use the `html` directive with `trustHtml`.
- **Performance.** The expression is reevaluated on each signal change: for expensive or repeated calculations, use a `computed`.
- **Types.** `meeko check` and the editor check each expression with the project's strict options (`strict`, `noUncheckedIndexedAccess`) and locate the error in the expression itself.
