---
title: css
group: config
since: 1.2.0
description: Component style options, such as which elements receive the scoped style attribute, and the external class providers that the editor leaves to their extension.
symbols:
  - "config:css"
related:
  - "syntax:style-scoped"
  - "syntax:style"
  - docs/framework.md#configuración
  - docs/editors.md#proveedores-de-clases
source-hash: a995b6aaddb3f7e19493722a52531b6b54976063fde7bccd5b86acaaa58fa1cc
---

`css` groups component style options. `scopeAttribute` decides which template elements receive the scope attribute of `<style scoped>`:

- `"all"`, the default in `1.x`: every template element receives it.
- `"matched"` (since `1.2`): only those that some scoped selector in the component can match. This produces smaller HTML and fewer differences between SSR and hydration. It will become the default in `2.0`.

`classProviders` (since `1.12`) declares to the editor the tools that generate classes and the extension that serves them, when no module does: a project with Tailwind without `@meekojs/ui`, or with UnoCSS. It is data, which Meeko neither runs nor interprets: in the `auto` mode of `meeko.classes.completion` and `meeko.classes.hover`, while that extension is active, the editor leaves to it the classes that only the processed stylesheet `.meeko/styles/main.css` has, and keeps offering those written in `<style>` blocks and source stylesheets (see [Class providers](../../editors.md#class-providers)). It does not change what `meeko dev` or `meeko build` compile.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  css: { scopeAttribute: "matched" },
});
```

## Options

| Option           | Type                 | Default | Description                                                                          |
| ---------------- | -------------------- | ------- | ------------------------------------------------------------------------------------ |
| `scopeAttribute` | `"all" \| "matched"` | `"all"` | Which elements receive the `<style scoped>` attribute.                               |
| `classProviders` | `ClassProvider[]`    | `[]`    | Since `1.12`, tools that generate classes and the editor extensions that serve them. |

Each `ClassProvider` has:

| Field       | Type       | Description                                                                                                                       |
| ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | `string`   | Readable name of the tool, such as `"Tailwind CSS"`. Two with the same name (from the project and from a module) are one.         |
| `vscode`    | `string[]` | Ids of the VS Code extensions that serve its classes (`publisher.name`). One active is enough.                                    |
| `languages` | `string[]` | Language ids of its `.css` stylesheets in the editor, such as `"tailwindcss"`: besides `css`, they get the CSS variable features. |

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

### Declare Tailwind without `@meekojs/ui`

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  css: {
    classProviders: [{ name: "Tailwind CSS", vscode: ["bradlc.vscode-tailwindcss"], languages: ["tailwindcss"] }],
  },
});
```

With `@meekojs/ui` it is not needed: its module declares the same with `meeko.addClassProvider`. Write the array as a literal: in an untrusted workspace the editor reads it without running the configuration.

### A class added by the script, with `"matched"`

```html
<template>
  <button class="toggle" on:click="(event) => event.currentTarget.classList.toggle('open')">Menu</button>
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
<template><span id="badge">new</span></template>
<script lang="ts">
onMounted(() => document.getElementById("badge")?.classList.add("hot"));
</script>
<style scoped>
.hot { color: red; }
</style>
```

There is no error: with `"matched"`, no selector can match the `<span>` (it has neither the `hot` class in the template nor `ref:` nor `on:`), so it does not receive the attribute and `.hot` does not apply to it.

```html good
<template><span bind:class="hot.value ? 'hot' : ''">new</span></template>
<script lang="ts">
const hot = signal(false);
onMounted(() => { hot.value = true; });
</script>
<style scoped>
.hot { color: red; }
</style>
```

### A misspelled provider

```ts bad
export default defineMeekoConfig({ css: { classProviders: [{ name: "Tailwind CSS", vscode: "bradlc.vscode-tailwindcss" }] } as never });
```

`meeko dev`, `meeko build` and `meeko check` stop with `…/meeko.config.ts: css.classProviders[0].vscode debe ser un array de ids como "bradlc.vscode-tailwindcss"`. An unknown field, an empty `name` or `"meeko"` in `languages` are errors too.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ css: { classProviders: [{ name: "Tailwind CSS", vscode: ["bradlc.vscode-tailwindcss"] }] } });
```

## Notes

- **When it changes.** This only affects `<style scoped>`; global styles do not change.
- **`2.0`.** `"matched"` will be the default. Enabling it now and reviewing components that touch the DOM avoids surprises when migrating.
- **Development.** Changing `meeko.config.ts` requires restarting `meeko dev`.
