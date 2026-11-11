---
source-hash: 6e18e269635ea64189fad8b6f698dcf6848a858f97d1284c7ba74e5dfd3f395b
---

# Attributes and static props

## Attributes by tag

In a `<component is>` with tags, Meeko writes each attribute only while the current tag accepts it according to its HTML data, without ternaries: `bind:href`, `target` and `rel` only on `<a>`, `bind:type` and `disabled` only on `<button>`. Global attributes (`class`, `id`, `style`, `title`, `hidden`, `tabindex`, `role`, `lang`, `dir`, `aria-*`, `data-*`…) and `on:` events are always written; `aria-disabled` is global, so it is valid for a disabled link. `type` does not count as an attribute of `<a>` or `<area>`, where it is only a MIME type hint. Nothing changes on ordinary elements.

`meeko check` and the editor give error `MEEK112` on an attribute accepted by **none** of the possible tags (`bind:colspan` on `'a' | 'button'`): Meeko would never write it. Since `1.8`, with component names in `is`, the rule applies to all branches: `'MeekoLink'` is an `<a>` without `href`, and a component accepts its props (see [Component names in `is`](component-dynamic.md#component-names-in-is)). When `is` writes its tags as literals, the editor completes their attributes and indicates which tags each applies to, and the `component` hover shows the possible elements.

## Attribute values

Since `1.8`, Meeko knows the values the HTML standard allows for each attribute from its HTML data (generated from WHATWG, WAI-ARIA and `@mdn/browser-compat-data`): `<button>`'s `type` is `"submit" | "reset" | "button"`, `hidden` is `"" | "hidden" | "until-found"`, `<dialog>`'s `closedby` is `"any" | "closerequest" | "none"` and `aria-pressed` is `"true" | "false" | "mixed" | "undefined"`.

- **Types.** `AttributeValues<Tag, Name>` is the union of those values (`never` for a free-text, hint or space-separated token attribute, such as `href`, `rel` or `class`). `AttributeValueOf<Tag, Name>` is that union plus any attribute value (`string`, `number`, `boolean`, `null`, `undefined`), so the editor suggests values without rejecting others; it is the type of each `ElementAttributes<Tag>` key, which retains its keys.
- **Warning `MEEK122`.** `meeko check`, `meeko build` and the editor warn when the value is a text literal not among the standard's values, compared case-insensitively as in HTML: `<button type="sumbit">`, `bind:type="'sumbit'"` or an expression whose type is a literal union with no valid value. A `string` value, number, boolean or attribute without a closed value set never warns. This applies to HTML elements and `<component is>` with tags, with values from any of them; not custom elements or SVG. It is a warning: it does not fail `meeko check` or change generated code. In `2.0`, it becomes an error (see [Deprecated APIs](stability.md#deprecated-apis)).
- **`hidden`.** No longer just boolean: `hidden="until-found"` and `bind:hidden="'until-found'"` write `hidden="until-found"`, hiding content until page search finds it. `bind:hidden` with `true` writes `hidden=""` and with `false`, `null`, `undefined`, `0` or `""` removes it, as before; only nonempty text changes: previously it wrote `hidden=""`.
- **Booleans.** Standard boolean attributes (`disabled`, `open`, `inert`, `itemscope`…) are written empty with a truthy value and removed with a falsy one, in SSR and the browser. Since `1.8`, the list comes from the same HTML data; additions since `1.7` are `alpha`, `headingreset`, `itemscope`, `scoped`, `seamless`, `typemustmatch` and `<template>`'s `shadowroot*`: with `bind:` and text, they now write the empty attribute instead of the text.

```html
<script lang="ts">
	import type { AttributeValues } from '@meekojs/meeko'
	const props = defineProps<{ kind?: AttributeValues<'button', 'type'> }>()
</script>
<template>
	<button bind:type="props.kind ?? 'button'">Send</button>
	<details hidden="until-found">…</details>
</template>
```

## `class` and `style` alongside `bind:class` and `bind:style`

Since `1.8`, an element can carry both static `class` and `bind:class`, or `style` and `bind:style`, and Meeko writes a single attribute with both, identically in SSR, hydration and updates. Dynamic classes follow static ones, and dynamic `style` declarations follow static ones, so they win. If the dynamic value is `undefined`, `null`, `false` or an empty string, the static text remains as is. This also applies to a `<component is>` that can only be a tag; on a component, `class` and `bind:class` pass the same prop (`MEEK090`).

```html
<article
	class="card"
	bind:class="open.value ? 'is-open' : undefined"
>
	...
</article>
```

Before `1.8`, SSR wrote `class` twice (`class="card" class="is-open"`): the browser kept the first and hydration failed with a mismatch.

## Bulk attributes with `bind`

Since `1.5`, `bind="obj"` writes an object's keys as attributes of an element, of `<component is>` or, on a component tag, as its props:

```html
<script lang="ts">
	import { computed } from '@meekojs/meeko'
	import type { ElementAttributes } from '@meekojs/meeko'
	const props = defineProps<{ busy: boolean; id: string }>()
	const attrs = computed((): ElementAttributes<'section'> => ({ id: props.id, 'aria-busy': props.busy, hidden: false }))
</script>
<template>
	<section
		class="panel"
		bind="attrs.value"
	>
		...
	</section>
</template>
```

- **Types.** The object is checked against the tag's attributes (or those of any `<component is>` tag), or the component's props: a key that is not one produces `MEEK113`. If `is` can be both, a key that either of them accepts is valid. `ElementAttributes<Tag>` types the object. On a custom element (`<x-card bind="...">`), `bind` remains an HTML attribute, like `html` and `model`.
- **A list with one component per row.** If `is` and `bind` read the same object (`is="option.component" bind="option.props"`), each entry is checked against its own component, and wrong props produce `MEEK113` on `bind`. With other expressions, TypeScript cannot relate them and the object must be valid for every possible component. See [the `<component is>` list](reference/components/component-tag.md#a-list-with-one-component-per-row).
- **Values.** Keys with `undefined`, `null` or `false` are not written, as with `bind:x`; `true` writes the empty attribute. On a component, an `undefined` key is an absent prop.
- **Order.** An explicit `bind:x` or static attribute wins over the same object key. `class` and `style` are **combined** in any order, including `class`, `bind:class` and `bind` together: explicit and object classes are joined, and the object's `style` declarations precede explicit ones, which win. On a component they are not combined: the explicit prop wins.
- **The same attribute as text and with `bind:`.** Except for `class` and `style`, `id="a" bind:id="b"` produces the `MEEK133` warning: only `bind:id` applies, in any order, and the text is ignored. Keep one of the two.
- **No handlers.** A key starting with `on` is a type error (`MEEK113`) and a runtime `TypeError`: event handlers are not created from data; use `on:evento`. `data-meeko*` keys, reserved for Meeko, are not allowed either. As in HTML, names are compared case-insensitively: `Data-Meeko` is also rejected, and an `ID` key alongside `bind:id` does not write a second `id`.
- **Reactive.** If the object changes, Meeko writes the new attributes and removes those no longer present; a component receives new props in place. `bind=""` or valueless `bind` produces `MEEK113`, as does using it on `<template>`.

## Static props

Since `1.1`, an unprefixed attribute on a component tag or `<component is>` passes a static prop, as on an HTML element:

```html
<AppButton
	variant="primary"
	disabled
	bind:label="title.value"
/>
```

- **Value.** Attribute text arrives as a text literal (`"primary"`, with its literal type) and a valueless attribute arrives as `true`. Both are type-checked against child props, like `bind:`: `variant="tertiary"` against `variant: "primary" | "secondary"` is an error on the attribute.
- **Reserved names.** `is`, `ref` and `html` are not static props, nor is `bind`, which passes bulk props since `1.5` (see [Bulk attributes with `bind`](#bulk-attributes-with-bind)), nor hyphenated names other than `aria-*` and `data-*` (`x-label`) or names containing `:` without being a directive (`bind:`, `on:`, `model:`, `ref:`, `if:when`, `each:*`): all produce `MEEK032`. To pass a prop named `ref`, use `bind:ref`.
- **`aria-*` and `data-*`.** Since `1.8`, `aria-label="Cerrar"`, `data-state="open"` and their `bind:aria-busy="saving.value"` and `bind:data-count="n"` forms pass a prop with that name, on component tags and `<component is>` with a component; previously they produced `MEEK032`. The child declares them like any prop, for example with `defineProps<Props & ElementAttributes<'button'>>()`, and writes them on its element with `bind` (see [A button that is a route, link or button](component-dynamic.md#a-button-that-is-a-route-link-or-button)); if not declared, `meeko check` produces `TS2353` on the attribute. They are lowercase, as in HTML (`Aria-Label` produces `MEEK032`), and `data-meeko*` is reserved. On a `<component is>` that can be a tag or component, they remain tag attributes (see [HTML tags in `<component is>`](component-dynamic.md#html-tags-in-component-is)).
- **Conflicts.** The same prop as static text and with `bind:` or `on:` (`variant="primary" bind:variant="x"`) produces `MEEK090`. `on:save` alongside `bind:onSave` remains `MEEK048`.
