---
title: css
group: config
since: 1.2.0
description: Component style options, such as which elements receive the scoped style attribute, all elements or only those that some selector can match.
symbols:
  - "config:css"
related:
  - "syntax:style-scoped"
  - "syntax:style"
  - docs/framework.md#configuración
source-hash: b44c05f0ba9fb545583ca74ec1ee039ba997ff25eb255c5628fc9fa0036f3f8d
---

`css` groups component style options. Currently it has one: `scopeAttribute`, which decides which template elements receive the scope attribute of `<style scoped>`.

- `"all"`, the default in `1.x`: every template element receives it.
- `"matched"` (since `1.2`): only those that some scoped selector in the component can match. This produces smaller HTML and fewer differences between SSR and hydration. It will become the default in `2.0`.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  css: { scopeAttribute: "matched" },
});
```

## Options

| Option           | Type                 | Default | Description                                            |
| ---------------- | -------------------- | ------- | ------------------------------------------------------ |
| `scopeAttribute` | `"all" \| "matched"` | `"all"` | Which elements receive the `<style scoped>` attribute. |

## Result

With this component:

```html
<!-- app/components/Card.meeko -->
<template>
  <article class="card"><h2>{props.title}</h2><p>{props.body}</p></article>
</template>
<style scoped>
.card { padding: 1rem; }
h2 { margin: 0; }
</style>
```

| `scopeAttribute` | Elements with the attribute                                                          |
| ---------------- | ------------------------------------------------------------------------------------ |
| `"all"`          | `<article>`, `<h2>` and `<p>`                                                        |
| `"matched"`      | `<article>` (`.card`) and `<h2>` (`h2`); not `<p>`, because no selector can match it |

## Examples

### Enable `"matched"` in an existing project

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ css: { scopeAttribute: "matched" } });
```

Review components that add classes or attributes through the DOM API (see “Common mistakes”): this is the only case that changes.

### A class added by the script, with `"matched"`

```html
<template>
  <button class="toggle" on:click="(event) => event.currentTarget.classList.toggle('open')">Menú</button>
</template>
<style scoped>
.toggle.open { outline: 2px solid; }
</style>
```

An element with `on:` or `ref:` is controlled by the script: only its tag matters and any selector class may match, so it receives the attribute and the style works.

## Common mistakes

### A value that does not exist

```ts bad
export default defineMeekoConfig({ css: { scopeAttribute: "some" } as never });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: css.scopeAttribute debe ser "all" o "matched"`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ css: { scopeAttribute: "matched" } });
```

### A class added through the DOM to an element without the attribute

```html bad
<template><span id="badge">nuevo</span></template>
<script lang="ts">
onMounted(() => document.getElementById("badge")?.classList.add("hot"));
</script>
<style scoped>
.hot { color: red; }
</style>
```

There is no error: with `"matched"`, no selector can match the `<span>` (it has neither the `hot` class in the template nor `ref:` nor `on:`), so it does not receive the attribute and `.hot` does not apply to it.

```html good
<template><span bind:class="hot.value ? 'hot' : ''">nuevo</span></template>
<script lang="ts">
const hot = signal(false);
onMounted(() => { hot.value = true; });
</script>
<style scoped>
.hot { color: red; }
</style>
```

## Notes

- **When it changes.** This only affects `<style scoped>`; global styles do not change.
- **`2.0`.** `"matched"` will be the default. Enabling it now and reviewing components that touch the DOM avoids surprises when migrating.
- **Development.** Changing `meeko.config.ts` requires restarting `meeko dev`.
