---
source-hash: bbfb6a650170a3c25c9cf49a6008951f568ca4f2555abaf9667408653347cb79
---

# Templates and directives

## Conditions with `if:when` and types

Since `1.2`, `if:when` narrows types inside its element, as `v-if` does in Vue: its attributes, props, events and content are checked knowing the condition holds, in `meeko check` and VS Code. No `!` is needed:

```html
<p if:when="user.value">{user.value.name}</p>
<WorkspaceHeader
	if:when="session.data.value.staff"
	bind:staff="session.data.value.staff"
/>
```

- TypeScript narrows the same reference checked by the condition: `if:when="user.value"` narrows `user.value.name`, but not another expression returning the same value.
- It extends to nested conditions and lists and a component tag's content (its snippets). A `<snippet>`'s `if:when` also narrows its content (see [Conditional snippets](component-events.md#snippets-with-definesnippets)). An `each:as`, `each:index` or snippet parameter with the same name as a condition variable shadows it, and it is not narrowed there.
- Inside an arrow function written in the template, such as `on:click="() => save(user.value.id)"`, TypeScript does not preserve property narrowing; extract the handler to a script function or check the value inside the function.
- Only type checking changes: at runtime, content is never evaluated when the condition is false.

A text expression can contain JavaScript's own braces: object literals (`{ { total: count.value }.total }`), template literals with `${...}`, strings containing `{` or `}`, comments and regular expressions. The expression ends at the brace balancing the opening one; if none exists, the compiler reports `MEEK010` at the opening brace. Directive values can be unquoted when HTML allows it, for example `on:click=increment` or `each:of=items`; the CLI and VS Code locate them just like quoted values.

## Form controls with `model`

Since `1.1`, `model="signal"` binds a form control to a signal in both directions: the control shows the signal's value and every user edit writes to it.

```html
<script lang="ts">
	const name = signal('')
	const accepted = signal(false)
	const plan = signal<string | null>('free')
	const tags = signal<string[]>([])
</script>
<template>
	<input model="name" />
	<input
		type="checkbox"
		model="accepted"
	/>
	<input
		type="radio"
		value="free"
		model="plan"
	/>
	<input
		type="radio"
		value="pro"
		model="plan"
	/>
	<select
		multiple
		model="tags"
	>
		<option value="a">A</option>
		<option value="b">B</option>
	</select>
</template>
```

| Control                                                                           | Property and event                                                   | Signal type                   |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------- |
| Text `<input>` (any `type` except the following, or `bind:type`) and `<textarea>` | `value`, on `input`                                                  | `string`                      |
| `<input type="checkbox">`                                                         | `checked`, on `change`                                               | `boolean`                     |
| `<input type="radio">`                                                            | checked if the signal equals its `value`; `change` writes that value | `string \| null \| undefined` |
| `<select>`                                                                        | `value`, on `change`                                                 | `string`                      |
| `<select multiple>`                                                               | selected options, on `change`                                        | `string[]`                    |

- **Numbers.** An `<input type="number">` also delivers text: store a `string` and convert it where used. An `<input type="range">`, since `1.8`, gets numbers if the signal holds a number.
- **Writable signal.** The expression must be a writable signal of the type in the table. A `computed`, a read-only signal or a plain value is a type error, and throws a `TypeError` at runtime.
- **Synchronization.** Assigning the signal from code updates the control's live property, like `bind:value` since `1.0.1`. In SSR, the HTML carries the signal's value (`value`, `checked`, `<textarea>` content or each `<option>`'s `selected`). If the user edits the control before the page hydrates (or the browser restores its value), what they typed is preserved and copied to the signal when hydration ends, before `onMounted` callbacks: `if:`, `each:`, `<render>` regions and parents reading the signal hydrate first with the SSR value and then react to the restored value.
- **Radio.** Requires `value="..."` or `bind:value="expression"`.
- **Dynamic `type`.** Since `1.2`, `model` allows `bind:type` on `<input>` and always treats the control as text: `value`, on `input`, with a `string` signal, even when the type changes. For example, this works for a password field revealing its text:

  ```html
  <script lang="ts">
  	const password = signal('')
  	const revealed = signal(false)
  </script>
  <template>
  	<input
  		bind:type="revealed.value ? 'text' : 'password'"
  		model="password"
  		autocomplete="current-password"
  	/>
  	<button
  		type="button"
  		on:click="() => revealed.value = !revealed.value"
  	>
  		Show
  	</button>
  </template>
  ```

  `bind:type` can only produce text types (`text`, `password`, `email`, `search`, `number`…). With `checkbox`, `radio`, `file`, `submit`, `reset`, `button` or `image`, which have no text value, the model changes neither the signal nor the control: if the control already has that type on hydration, hydration throws a `TypeError`; if it takes that type later, each model read or write delivers a `TypeError` to the nearest error observer (see `provideErrorHandler`). For a checkbox or radio, use another `<input>` with a static `type`.

`MEEK065` flags unsupported uses: `model` on an element other than `<input>`, `<textarea>` or `<select>`; on `<input type="file">`, `submit`, `reset`, `button` or `image`; with both `bind:type` and `type="..."` on the same `<input>`; with `bind:multiple` instead of static `multiple`; with content in `<textarea model>`; alongside `value`, `bind:value` or `on:input` on a text control (or `checked`, `bind:checked` or `on:change` on a checkable control, and `value`, `bind:value` or `on:change` on a `<select>`); a second `model` or `model:nombre`, which is only for components. Other `on:` events are allowed.

## `<select>` with rich content

Since `1.8`, a `<select>` keeps the content current browsers accept: `<button>`, `<selectedcontent>`, `<legend>`, `<div>` and options with `<span>` or `<svg>`. With `appearance: base-select` on the `<select>` and on its `::picker(select)`, the browser paints that content in its own dropdown:

```html
<script lang="ts">
	const plan = signal('pro')
	const plans = [
		{ id: 'free', name: 'Free' },
		{ id: 'pro', name: 'Pro' },
	]
</script>
<template>
	<select model="plan">
		<button type="button"><selectedcontent></selectedcontent></button>
		<option
			each:of="plans"
			each:as="item"
			each:key="item.id"
			bind:value="item.id"
		>
			<span class="dot"></span>
			<span>{item.name}</span>
		</option>
	</select>
</template>
```

- **Hydration.** The browser copies the chosen option into `<selectedcontent>`, with its attributes. Bindings (`bind:`, `on:`, `{text}`) always belong to the real option, never to the copy. Do not put an `id` inside an option, because the copy duplicates it.
- **The copy is not reactive.** If the content of the chosen option changes, the copy stays the same until another one is chosen. `select.selectedIndex = select.selectedIndex` rebuilds it.
- **`<input>` and another `<select>`.** The browser closes the `<select>` when it finds them and moves what follows out of it, so inside a `<select>` they are `MEEK008`. Place them outside.
- **Inner button.** The `<button>` of a `<select>` is inert: clicks reach the `<select>`. A button that clears the selection goes outside.
- **Other browsers.** Firefox keeps this content, but without `base-select` it shows the native dropdown and `<selectedcontent>` stays empty. Check support on [MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select).

## Unescaped HTML with `html`

Since `1.1`, `html="expression"` on an element fills it with the expression's HTML, **without escaping**. The expression is a `string`; `null` and `undefined` leave the element empty. Since `1.3`, that `string` must be marked as trusted with `trustHtml` (type `TrustedHtml`) or `meeko check` warns with `MEEK107`; see [Trusted HTML](#trusted-html-trustedhtml-and-trusthtml).

```html
<script lang="ts">
	import { trustHtml } from '@meekojs/meeko'
	const article = signal(trustHtml('<p>Content <strong>generated</strong> on the server.</p>'))
</script>
<template>
	<article
		class="prose"
		html="article.value"
	></article>
</template>
```

- **SSR.** The expression's HTML is normalized for the element before writing, so parsing the document cannot move any node outside it (or imitate Meeko markers outside it): unclosed tags, comments and text elements (`<style>`, `<textarea>`…) are closed (`"<b>Hola"` gives `<b>Hola</b>`), closing tags not matching anything open in the value are discarded (a `</div>` does not close the element), and implicit closing tags are written explicitly. Text and attributes are written as is. If the browser would move some content outside the element, SSR leaves the element empty and the browser fills it on hydration with `innerHTML`, which keeps it inside; without JavaScript that content is invisible. This occurs with a `<div>` or other block inside a `<p>` or an inline element (`<span>`, `<a>`, `<em>`, `<label>`…, which could be inside a `<p>`), a standalone `<li>`, a heading inside another, cells or rows outside their table, loose text in a `<table>`, `<tbody>` or `<tr>`, content other than `<option>` in a `<select>`, an HTML block inside `<svg>` and `<noscript>` and `<plaintext>` elements. Use an element accepting the content (`<div html>`, `<ul html>` for a list of `<li>`, `<tbody html>` for rows). Normalization does not know the element's ancestors: do not nest links, buttons or forms across the template and content.
- **Hydration.** If the element's content matches the expression's HTML (parsed in the element's context, so `<br/>` and `<br>` match), the DOM is left untouched; if it differs, `innerHTML` is replaced.
- **Reactivity.** Every value change replaces `innerHTML`. Inserted content is not part of the template: it has no directives, and hydration never looks for Meeko markers inside it.
- **Events.** To react to clicks inside inserted HTML, listen on the element itself (`on:click`) and use `event.target.closest(...)`.

**It is unsafe with untrusted content.** HTML from users or third parties can execute scripts on the page (XSS): sanitize it before insertion or use `{expression}`, which escapes text. Meeko never executes the content's `<script>` elements when inserting it in the browser, just like `innerHTML`: neither when hydrating different content, changing the value, in a region mounting later (`if:`, `each:`, a component) nor when navigating to another page. Those in the initial document's HTML do execute, because the browser parses them like any page script. `html` is not a mechanism for loading scripts.

The element does not allow children, not even comments or `{expression}`; only whitespace. `MEEK095` also flags `html` on a void element (`<img>`, `<input>`…), a text element (`<textarea>`, `<title>`, `<script>`, `<style>`…), `<template>`, alongside `model` or with an empty value. On a component tag, `html` is not a prop (`MEEK032`). `bind:html` remains an HTML attribute named `html`.

**Custom elements.** `html` and `model` are directives only on standard HTML elements, where they are not valid HTML attributes. On a custom element (a hyphenated tag, such as `<x-markdown html="intro">` or `<my-input model="query">`), they remain literal HTML attributes, as in `1.0`, and the element allows children.

### Trusted HTML: `TrustedHtml` and `trustHtml`

Since `1.3`, the type of the `html` expression declares where the HTML comes from. `TrustedHtml` is a `string` with a brand existing only in types, and `trustHtml(html)` adds it: at runtime it returns the same `string`, without copying or checking it. Both are imported from `@meekojs/meeko`; they are not auto-imports, so the trust declaration is always a visible import and works the same outside the framework.

**`trustHtml` does not sanitize: it only declares.** Use it where HTML originates, not just before the template:

```ts
// server/content/articles.ts
import DOMPurify from 'isomorphic-dompurify'
import { trustHtml } from '@meekojs/meeko'
import type { TrustedHtml } from '@meekojs/meeko'

// User or third-party HTML: sanitize it first, then mark it as trusted.
export function commentHtml(input: string): TrustedHtml {
	return trustHtml(DOMPurify.sanitize(input))
}

// Your own HTML, such as repository Markdown rendered at build time: just mark it as trusted.
export function articleHtml(markdownDeConfianza: string): TrustedHtml {
	return trustHtml(markdownDeConfianza)
}
```

For user HTML, [DOMPurify](https://github.com/cure53/DOMPurify) is recommended (in SSR, `isomorphic-dompurify`, which runs it on jsdom). To show text, `{expression}` escapes it and needs none of this.

`meeko check`, `meeko build` and the editor warn with **`MEEK107`** when the expression's type is not assignable to `TrustedHtml | null | undefined`:

- **They warn for** `string`, `string | undefined`, a concatenation or template with a `string` (`'<b>' + name + '</b>'`, whose type is `string` or a pattern such as `` `<b>${string}</b>` ``) and `any`, which says nothing about the origin (for example, the result of `JSON.parse` or `response.json()`).
- **They do not warn for** `TrustedHtml` (including with `null` or `undefined`), text literal types and their unions, written by the author in code (`html="'<br>'"`, `html="open.value ? '<b>sí</b>' : '<i>no</i>'"` or a variable with a declared literal type), and `null` or `undefined`.
- `unknown`, `number` and other non-text types remain a type error (`TS2345`), without an additional warning.
- An unannotated `<script>` constant, such as `const icon = "<svg>…</svg>"`, reaches the template as `string`, because setup returns its bindings in an object and TypeScript widens the literal: write `as const` (`const icon = "<svg>…</svg>" as const`) or mark it with `trustHtml`.

Server data retains the brand: a `<script server>` export or `load` result of type `TrustedHtml` reaches the template with that type (`ServerData<T>` and the page contract preserve it), because the payload is JSON and the brand exists only in types. Mark HTML in the server module producing it and declare `TrustedHtml` in its shared types.

`MEEK107` is a warning: it appears but does not fail `meeko check` or `meeko build`, nor change SSR, hydration or generated code; everything that compiled in `1.2` still compiles and works the same. Inserting an unmarked `string` is deprecated: in `2.0`, the warning becomes an error (see [Deprecation](stability.md#deprecated-apis)).

### HTML that travels once: `documentHtml`

Since `1.8`, a large `TrustedHtml` that is only read in `html="..."` can travel once. Without the mark, page data arrives twice on the first load: in the document's HTML and in the hydration payload, where JSON escaping also makes it heavier. `documentHtml` leaves it only in the HTML:

```html
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const guide = { body: documentHtml(trustHtml("<h2>Guide</h2><p>A long article.</p>")) };
</script>

<template>
  <article html="guide.body"></article>
</template>
```

The document's payload carries a placeholder, and hydration adopts the element's content without reading or rewriting it. Client navigations receive the whole value. If the page paints the element again, such as an `if:` that closes and opens, the browser requests the value from the server: the DOM never provides HTML.

It is not automatic because it changes what the browser sees on that first load: the value is the placeholder, so `{guide.body.length}` or a `computed` that analyzes it would not give the same as on the server. Mark it only if nothing else reads it. The value stays in the payload if `html` did not paint it in the document or if SSR left any of its elements empty. If the page paints the element again, the browser requests the value from the server and only inserts the one that response declares marked; if it is gone, it loads the document again. See [`documentHtml`](/docs/reference/documenthtml).

## Lists with and without `each:key`

Since `1.1`, `each:key` is optional (previously, an unkeyed list produced `MEEK023`, now retired). Without a key, each row's key is its index: row `i` keeps its nodes and receives item `i`, and rows are only added or removed at the end. When inserting, deleting or reordering in the middle of the list, each row shows the item now occupying its position.

```html
<li
	each:of="tags.value"
	each:as="tag"
>
	{tag}
</li>
<li
	each:of="todos.value"
	each:as="todo"
	each:key="todo.id"
>
	<TodoItem bind:todo="todo" />
</li>
```

Use `each:key` when the list changes order or receives items in the middle and each row has its own state that must follow its item: a child component with signals, a form control being edited, focus or an animation. With a key, Meeko moves existing rows instead of reassigning them. For lists that are only displayed or only grow at the end, the index is enough.

## Elements without content (`<div />`)

Since `1.8`, any non-void HTML element can close with `/>` when it has no content, as in Vue: `<div class="spacer" />` is equivalent to `<div class="spacer"></div>`, as are `<span />`, `<textarea name="nota" />`, `<td />`, `<option value="" />`, `<iframe src="…" />` or a custom element such as `<my-element />`. Previously this was `MEEK001`, because the HTML parser opens `<div/>` and puts everything following inside it.

```html
<template>
	<ul>
		<li
			each:of="items.value"
			each:as="item"
			each:key="item.id"
			bind:data-id="item.id"
		/>
	</ul>
	<span
		if:when="loading.value"
		class="spinner"
	/>
	<p>The nodes following <code>&lt;span /&gt;</code> are its siblings.</p>
</template>
```

- Nodes following a self-closing element are its siblings, not its content. It allows attributes, `bind:`, `on:`, `ref:`, `if:when` and `each:of` like the closing-tag form, and compiles exactly the same.
- SSR writes valid HTML (`<div></div>`, never `<div/>`), and hydration, updates and disposal work as with the closing tag.
- Void elements (`<input />`, `<br />`, `<img />`) do not change, and SVG and MathML already closed with `/>` (`<path d="…" />`, `<mi />`).
- `<template>`, `<script>`, `<style>`, `<html>`, `<head>`, `<body>` and unknown names (`<foo />`) still require their closing tag: `MEEK001`.
- `<td />`, `<th />`, `<tr />`, `<option />` and other table and list elements retain their names for the parser, so their own closing tag afterward (`<td /></td>`) produces `MEEK008`.
- The language server, `meeko check`, ESLint parser and Prettier understand both forms. Prettier preserves them as written; the optional [`meeko/html-self-closing`](../../packages/eslint-plugin/docs/rules/html-self-closing.md) rule standardizes the style with autofix.
