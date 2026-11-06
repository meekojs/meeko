---
source-hash: 77be5e57789fb8c8a454ed256c946d2a1e1f4a55cfaa317a6cec7b781a8c0ebe
---

# Component styles

## Component styles: `<style>` and `<style scoped>`

A `.meeko` allows one style block, with or without `scoped`. Both pass through the same PostCSS as `app/styles/main.css` (`postcss.config.*`, Tailwind, `@utilities`) and Vite bundles them with the component: SSR links the CSS of the page's components and client navigation loads each route's CSS on entry.

|                                   | `<style scoped>`                                                                        | `<style>`                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Scope                             | Only elements in the component's template, through the `data-meeko-s-<hash>` attribute. | **The entire page**, like `app/styles/main.css`.               |
| Children and `html="..."` content | No, except with `:global(...)`.                                                         | Yes.                                                           |
| `:global(...)`                    | Unwraps the selector without the attribute.                                             | Not transformed: do not use it.                                |
| Risk                              | No leakage.                                                                             | One component's `.card` affects any other component's `.card`. |

A `<style>` without `scoped` is global CSS living alongside the component that needs it. It is not limited to when the component is mounted: once loaded, it keeps applying when navigating to other routes, and its order relative to other stylesheets depends on when it loaded. Use it for intentional global styles, such as those of third-party content wrapped by the component:

```html
<!-- MarkdownView.meeko -->
<template>
	<article
		class="markdown-view"
		html="props.content"
	></article>
</template>

<style>
	/* Global by design: the .markdown-view prefix avoids affecting the rest of the page. */
	.markdown-view p {
		margin-block: 0.75em;
	}
	.markdown-view pre {
		overflow-x: auto;
	}
</style>
```

For almost everything else, `<style scoped>` is the default choice, and `:global(...)` reaches children or `html` content without losing scope: `.markdown-view :global(p)` gives `.markdown-view[data-meeko-s-…] p`. Application-wide styles (reset, tokens, typography) belong in `app/styles/main.css` or a file it imports, where their order is explicit.

## Scoped styles and `:global(...)`

`<style scoped>` adds the `data-meeko-s-<hash>` attribute to each selector's last compound, before a pseudo-element if present (`.card::before` becomes `.card[data-meeko-s-…]::before`). `:global(<selector>)` emits the inner selector without the scope attribute:

| Source                 | Result                                 |
| ---------------------- | -------------------------------------- |
| `.card :global(.icon)` | `.card[data-meeko-s-…] .icon`          |
| `:global(body) .card`  | `body .card[data-meeko-s-…]`           |
| `:global(html.dark)`   | `html.dark`, without a scope attribute |

A compound containing `:global(...)` is not scoped; the attribute is added to the selector's last local compound, and a fully global selector does not receive it. `:global` without parentheses or empty, a selector list inside `:global(...)` and a `:global(...)` nested in another pseudo-class, such as `:not(...)`, fail with `MEEK019` at their position. Rules inside `@keyframes` are not modified.

### Which elements receive the attribute

By default, `data-meeko-s-<hash>` goes on every element in the component's template. Since `1.2`, the `css.scopeAttribute: "matched"` option in `meeko.config.ts` adds it only to elements some scoped selector can select, reducing HTML size:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	css: { scopeAttribute: 'matched' }, // "all" by default in 1.x
})
```

The option applies to everything the project compiles: the Vite plugin (`meeko dev`, `meeko build` and prerendering; outside the framework, the plugin reads `meeko.config.ts` from the Vite root) and `meeko compile`, which reads configuration from the nearest `package.json` folder. Callers of `compile()` directly pass `{ scopeAttribute: "matched" }` in their options. `meeko check` and the editor do not depend on it: it only changes rendered HTML, not types or diagnostics. Like any `meeko.config.ts` change, changing it requires restarting `meeko dev`.

In `1.x`, the default is `"all"`, because `"matched"` can change the result of a previously working case: a class or attribute added by the script through the DOM API to an element left without the attribute (see the end of this section). In `2.0`, `"matched"` becomes the default; see [Stability](stability.md#planned-changes-for-20).

With `"matched"`, rules apply to the same elements as with `"all"`. Only the compound carrying the attribute counts in each selector: the other compounds (ancestors, siblings and `:global(...)`) select any element on the page, with or without the attribute, so an element appearing only as an ancestor, such as `.card` in `.card .title`, does not need it. An element receives the attribute when that compound can match it:

- A tag matches elements of that tag; a class, ID or attribute selector (`[href^="/"]`) matches elements having them in the template. Matching is case-insensitive.
- `*`, pseudo-classes (`:hover`, `:focus-visible`, `:nth-child(...)`, `:not(...)`, `:has(...)`) and pseudo-elements do not restrict matching: `:hover` alone puts the attribute on every element and `a:hover` on every `<a>`.
- `:is(...)` and `:where(...)` match when any argument matches; `&` in nested CSS matches when the enclosing rule's selector matches.

An attribute that can change after rendering counts as present with any value:

- `bind:class` can produce any class; `bind:id`, any ID; `bind:nombre`, the `nombre` attribute (`bind:aria-current` and `[aria-current="page"]`).
- `model` gives its control `value` and `checked`, and a `<select model>` gives its `<option>` elements `selected`.
- An element with `ref:` or an `on:evento` is controlled by the script, through the reference or `event.currentTarget`, and a custom element (`<x-chip>`) manages its own attributes: on them only the tag counts, and any selector class or attribute can match.
- The browser adds `open` to `<details>` and `<dialog>`.

```html
<template>
	<section class="card">
		<h2 class="title">Title</h2>
		<p>Text</p>
		<span bind:class="state.value">State</span>
		<em>Note</em>
	</section>
</template>

<style scoped>
	.card .title {
		font-weight: 700;
	} /* the <h2>; .card is only an ancestor */
	p:hover {
		color: teal;
	} /* the <p> */
	.active {
		color: green;
	} /* the <span>, through bind:class */
</style>
```

With `"matched"`, `<section>` and `<em>` here render without the attribute. The content of `html="..."` and a child component's elements do not receive the parent's attribute, as before (select them with `:global(...)`, for example `.content :global(p)`), and snippet content receives that of the component writing it. A component without `<style scoped>` never emits the attribute and, with `"matched"`, neither does one whose selectors are all global. SSR, hydration and `if:when` and `each:of` regions share the compiled template, so the attribute matches in server HTML and browser-rendered HTML.

Before enabling `"matched"`, review code changing classes or attributes with the DOM API (`classList`, `setAttribute`, `toggleAttribute`). On an element without `ref:` or `on:`, such as a descendant reached by the script with `querySelector`, `closest` or `event.target`, or one modified by an external library, the class receives scoped styles only if that element already had the attribute. Use `bind:class` or `bind:nombre`, put a `ref:` on that element or write the selector with `:global(...)`. With `"all"`, all template elements have the attribute and this case does not occur.

The CLI and VS Code check the type of the event received by `on:event` and that `each:key` returns `string | number`; both locate diagnostics in the template expression. Since `1.2`, on an HTML element the event has its name's `HTMLElementEventMap` type (`SVGElementEventMap` inside `<svg>`), such as `KeyboardEvent` for `on:keydown` or `PointerEvent` for `on:pointerdown`, and `Event` if the name is not in the map (previously only `click`, `input`, `change`, `submit`, `keydown`, `keyup`, `focus` and `blur` were typed). Also, `event.currentTarget` has the tag's element type, the same as `ref:` (`HTMLInputElement` for `<input>`, `HTMLSelectElement` for `<select>`, `HTMLElement` for a custom element), so `on:input="(event) => query.value = event.currentTarget.value"` and `on:change="(event) => accepted.value = event.currentTarget.checked"` are checked without casts; a property the element does not have remains an error. `event.target` keeps the type `EventTarget | null`, because it can be a descendant. On a component tag, `on:evento` is a callback prop and receives the arguments from its `defineEmits`. The VS Code virtual document applies the same strict options for indexed access, exact optional props and type imports as `meeko check`.

`each:index` has type `number` both in the compiled component and the VS Code virtual document; it is not inferred as the initial literal `0`.

`on:event` handlers can be asynchronous. Meeko observes their promise and delivers synchronous failures or rejections to the nearest observer, without leaving an unhandled rejection or stopping other listeners. Component cleanup removes its listeners. If there is no observer, Meeko logs the failure to the console.

Inside a component script, `provideErrorHandler((error, source) => { ... })` registers an observer for its events and its children's, and also for rejections from an `effect` or `onCleanup` that mistakenly returned a promise. It is auto-imported as a real ESM function; `error` has type `unknown`, so it must be narrowed before reading its properties, and `source` is an `ErrorSource` (`"event"`, `"effect"`, `"cleanup"`, `"mounted"`, `"navigation"`, `"socket"` and, since `1.3`, `"uncaught"` and `"rejection"` for global page failures in a mounted application; see [Errors](framework.md#errors)). The union may gain members in a minor: an exhaustive `switch` needs a default branch. `"mounted"` (since `1.1`) identifies failures in an `onMounted` callback and in the browser continuation of a setup with `await` (see [Lifecycle](language-reactivity.md#lifecycle)). A descendant component can register another observer for its own branch. Context is isolated per root; an asynchronous observer that rejects is logged alongside the original error. In a mounted application, navigation and Socket channels created within the application also use the active observer; their explicit `onNavigationError` and `onError` options take priority. The server uses its own observer with `requestId`.

```html
<script lang="ts">
	provideErrorHandler((error) => {
		console.error('Component failed', error)
	})
	function save(): void {
		// Handle the action here.
	}
</script>
<template><button on:click="save">Save</button></template>
```

To compose components, import the child module in the script and use `<component is="Child" bind:label="expression"></component>`. `is` accepts a module expression and each `bind:` defines a typed prop (also see [static props](component-attributes.md#static-props)). The CLI and VS Code check required props, names and value types against the child's declared props; the editor offers completion and locates diagnostics in the original expression. Since `1.1`, names are also checked when the tag passes other valid props: previously an unknown prop alongside a known one did not produce an error. A missing required prop is flagged on the tag. `<component>` closes with `</component>` or itself (`<component is="..." />`); since `1.5`, its content is the component's snippets, as on its tag (see [Snippets](component-events.md#snippets-with-definesnippets)), and `is` also accepts HTML tags (see [HTML tags in `<component is>`](component-dynamic.md#html-tags-in-component-is)). SSR HTML marks a comment range to hydrate the child without a wrapper element; children can appear in conditions and lists.

`is` also accepts an expression returning a component module. This allows passing content as a `Component<Props>` prop and rendering it inside another component with props checked by TypeScript:

```html
<!-- Card.meeko -->
<script lang="ts">
	import type { Component } from '@meekojs/meeko'
	const props = defineProps<{ content: Component<{ label: string }>; label: string }>()
</script>
<template>
	<section>
		<component
			is="props.content"
			bind:label="props.label"
		></component>
	</section>
</template>
```

The parent can use `<component is="Card" bind:content="Content" bind:label="'Hola'"></component>`, where `Content` is an imported `.meeko` module. If the `is` expression changes reactively, Meeko disposes of the previous instance and renders and hydrates the new one inside the same markers. Content is created as an independent component, with its own state and cleanup. To pass inline content, write it between the tags: up to `1.4`, `<component is>` did not allow content (`MEEK031`); since `1.5`, loose content fills the `default` snippet and each `<snippet name>` fills its own, just like on a component tag. A component typed only as `Component<Props>` declares no snippets, so passing it content is a type error; type the prop with the module (`typeof Card`) to pass it content.

`<component is>` requires `Component<Props>`: its `renderWithState` function is required to transfer the child's SSR state. `ComponentModule<Props>` retains that function as optional for low-level uses rendering without transfer. The outlet in `app/app.meeko` and layouts is also declared as `Component<Record<string, unknown>>`. The CLI and VS Code diagnose a module that does not satisfy this contract.

If hydration of a reactive replacement fails, Meeko restores the previous content and rehydrates it. If restoration also fails, it delivers both causes in `AggregateError` and stops that binding. Lists prepare new rows before removing old ones: a render, hydration or move failure attempts to restore the previous order and instances. Cleanup errors are preserved alongside the original failure.

Scripts accept `import type`, `export interface`, `export type` and type re-exports. For example, `import type { ComputedRef } from "./contract.js"; export interface CardProps { label: string }; const props = defineProps<CardProps & ComputedRef<string>>();` preserves the intersection in `ComponentProps` and the `.d.meeko.ts` declaration. The consumer must provide all its fields; the name `ComputedRef` alone does not turn a prop into a reactive signal.
