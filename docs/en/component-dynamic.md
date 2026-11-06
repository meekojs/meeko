---
source-hash: 282b5846680d7da48a7b90a9c78c523cb356fd344d93938786c085a8256f7117
---

# Dynamic components and tags

## Component tags (`<AppButton />`)

Since `1.1`, a tag whose name starts with an uppercase letter is a component: `<AppButton bind:label="'Guardar'" />` is equivalent to `<component is="AppButton" bind:label="'Guardar'"></component>`. The name is a script identifier, whether an import (`import * as AppButton from "./AppButton.meeko"`) or an auto-import from `app/components`. It allows the same `bind:` and static props, `on:` events, `model:` models and `ref:` as `<component>`, is checked the same in the CLI and VS Code and can go inside `if:when` and `each:of`.

- It can close itself (`<AppButton />`) or with its closing tag (`<AppButton></AppButton>`). Nodes following a self-closing tag are its siblings, not its content.
- Its content is the child's snippets (see [Snippets](component-events.md#snippets-with-definesnippets)). Passing content to a component without `defineSnippets` is a type error. `MEEK049`, which rejected any content, is no longer emitted.
- A `</AppButton>` without an opening tag produces `MEEK008`, and a component tag outside `<template>`, `<script>` and `<style>` produces `MEEK002`.
- Uppercase names are not confused with HTML elements: `<Table>`, `<Input>` or `<Title>` are components.
- Since `1.2`, an optional child prop (`error?: string`) also accepts `undefined` on the tag, such as `bind:error="failed.value ? 'Obligatorio' : undefined"`, even if the project uses `exactOptionalPropertyTypes`: for Meeko, passing `undefined` is equivalent to not passing the prop, and if the prop has a default in `defineProps`, the child receives the default. Required props still reject `undefined` and an unknown prop remains an error.

Use `<component is="expression">` when the component is selected by an expression, such as `props.outlet` or `props.content`; for a fixed component, the tag is shorter. The editor completes names after `<` and navigates from the tag to the `.meeko` file.

## HTML tags in `<component is>`

Since `1.5`, `is` also accepts an HTML tag: a text literal (`'a'`), an expression whose type is a tag union (`props.href ? 'a' : 'button'`, or a prop `as: "section" | "article"`), a component or a union of tags and components. With a tag, `<component is>` is that element, with its attributes, `on:` events, `ref:`, `html` and `bind="obj"`, and its **content**: children, `if:when`, `each:of`, `<render>` and components. With a component, the content is its snippets, as on a component tag.

A button that becomes a link when it receives `href`, with a single template:

```html
<!-- Button.meeko -->
<script lang="ts">
	import { computed } from '@meekojs/meeko'
	const props = defineProps<{ href?: string; target?: string; type?: 'button' | 'submit' | 'reset'; disabled?: boolean; loading?: boolean }>()
	const emit = defineEmits<{ click: [event: MouseEvent] }>()
	const snippets = defineSnippets<{ default?: []; leading?: []; trailing?: [] }>()
	const inactive = computed(() => Boolean(props.disabled || props.loading))
	const rel = computed(() => (props.target === '_blank' ? 'noopener noreferrer' : undefined))
	const state = computed(() => ({ 'data-loading': props.loading ? '' : undefined, 'aria-disabled': inactive.value ? 'true' : undefined }))
	function onClick(event: MouseEvent): void {
		if (inactive.value) {
			event.preventDefault()
			return
		}
		emit('click', event)
	}
</script>
<template>
	<component
		is="props.href ? 'a' : 'button'"
		class="button"
		bind="state.value"
		on:click="onClick"
		bind:href="inactive.value ? undefined : props.href"
		bind:target="props.target"
		bind:rel="rel.value"
		bind:type="props.type"
		bind:disabled="props.disabled"
	>
		<span
			if:when="props.loading"
			class="button__spinner"
			aria-hidden="true"
		></span>
		<span class="button__label">
			<render snippet="snippets.leading" />
			<render snippet="snippets.default" />
			<render snippet="snippets.trailing" />
		</span>
	</component>
</template>
```

Without `href`, it renders `<button class="button" type="button" data-meeko="0">…</button>`; with `href`, `<a class="button" href="/docs" target="_blank" rel="noopener noreferrer" data-meeko="0">…</a>`. `type` and `disabled` are not written on `<a>`, nor `href`, `target` and `rel` on `<button>` (see [Attributes by tag](component-attributes.md#attributes-by-tag)).

- **Types.** Meeko infers the tag union from the type of `is`. An `on:` event's `event.currentTarget` is the union of its elements (`HTMLAnchorElement | HTMLButtonElement`, with `1.2`'s events typed per element), as is a `ref:`'s `useElementRef`. An `is` value that is neither an allowed tag nor a component is a type error (`MEEK112`), as is an arbitrary `string`: type the tag as a literal union or use the `TagName` type. A void tag (`img`, `input`, `hr`…) with content produces `MEEK031`.
- **Allowed tags.** Those in Meeko's HTML data (the MDN data used by the editor), except `script`, `style`, `iframe`, `object`, `embed`, `template`, `slot`, `textarea`, `title`, `base`, `link`, `meta`, `head`, `html`, `body`, `noscript`, `param` and `fencedframe`. The public `TagName` type is that union. A disallowed literal is compile error `MEEK112`; a disallowed value arriving at runtime (with `as any`, for example) throws `TypeError` with `MEEK112` in SSR and the browser before writing HTML: the tag name never injects markup. Custom elements (`x-card`) and SVG tags are not allowed as `is` values; inside `<svg>`, `is` only allows components.
- **SSR and hydration.** Meeko reads the outcomes of `is` from its syntax (`?:` branches, without `as` or parentheses). If all are literals, SSR writes the element as is, without markers. If all are PascalCase identifiers or imports from a `.meeko` (`is="open ? Dialog : Sheet"`), it is a component, as before `1.5` (a constant holding a tag must have a lowercase name). Since `1.8`, a PascalCase literal (`'MeekoLink'`, `'UICard'`) names a component resolved by the compiler (see [Component names in `is`](#component-names-in-is)). In other cases (`props.as`, `view()`), the type decides at runtime: the element goes between component range comments and its content in a snippet range.
- **Tag changes.** If the tag changes in the browser, a new element replaces the previous one: children are **moved** into it with their nodes, so they preserve their reactive state, their components' state, control values and focus; if focus was on the element, it moves to the new one. The element's attributes, events, `ref:`, `html` and `bind` are rebound on the new one. When switching from a tag to a component or vice versa, the range is emptied and content mounts again.
- **Tag or component.** With a union of both, each attribute is checked against what accepts it: `aria-label`, `html` or `data-*` are valid only if `is` is a tag, and `model`, `model:x` or `<snippet name>` only if it is a component (`MEEK112` in `meeko check` and the editor when the `is` type allows the other kind).
- **`'MeekoLink'` in `is`.** `<MeekoLink>` is a compiler tag, not a value: `is="internal ? MeekoLink : 'a'"` remains `TS2304: Cannot find name 'MeekoLink'`. Since `1.8`, write it as a literal, `is="internal ? 'MeekoLink' : 'a'"`, just like a project component (see [Component names in `is`](#component-names-in-is)).
- **Limits.** Content must be valid inside every possible tag (the browser moves a `<div>` out of `<p>` and hydration does not match), and `<component is>` inside `<table>` follows that container's rules. `model` on a `<component is>` whose outcomes are tags produces `MEEK112`: use a form control.

## Component names in `is`

Since `1.8`, a **PascalCase** text literal inside `is` names a component known at compile time: `'MeekoLink'`, a component imported from a `.meeko` or an auto-imported one, such as those from `app/components` or `UI*` from `@meekojs/ui`. It combines with HTML tags in `?:` branches, so a button that is a route, external link or `<button>` fits in a single template:

```html
<component
	is="to !== undefined ? 'MeekoLink' : href !== undefined ? 'a' : 'button'"
	bind:to="to"
	bind:params="params"
	bind:href="href"
	bind:type="type"
	class="button"
>
	Open
</component>
```

- **Uppercase or lowercase.** HTML tags are written in lowercase and components in PascalCase: `'button'` is the element and `'Button'` a project component named `Button`. A PascalCase literal that is neither `'MeekoLink'` nor a component imported, auto-imported or declared in the script is `MEEK132` on the literal. `'MeekoOutlet'` and `'MeekoTeleport'` are not allowed.
- **Static resolution.** The compiler imports each name as its tag (`<MeekoLink>`, `<UICard>`), without `import()` or promises, so it works the same in SSR, hydration and navigation. Each name is an `if:when` region whose condition is the `?:` path to its literal (`to !== undefined` for `'MeekoLink'`), and HTML tags form another, an element whose tag changes. When switching branches, the previous one is disposed and the new one mounts, as with `if:when`; between `'a'` and `'button'`, the element is replaced and children move, as always.
- **Attributes per branch.** Each attribute goes only to branches accepting it: `to`, `params`, `search` and `match` to `'MeekoLink'`, which builds its typed `href` and `aria-current` like the tag, along with its `<a>`'s other attributes except `href`; each HTML attribute to tags accepting it, such as `href` on `<a>` and `type` or `disabled` on `<button>` (see [Attributes by tag](component-attributes.md#attributes-by-tag)); and props, events, models and `bind="obj"` to components. A component receives all the tag's props and only reads those it declares. `<snippet name>` blocks belong to components; elements render loose content.
- **Types.** `meeko check` and the editor check each branch after its condition, which narrows it: inside `'MeekoLink'`, `to` is a route and its `params` are that route's. Each component is checked against its props (one of its props with a value of another type is an error), but a prop it does not declare is not an excess property, because it may belong to another branch. An attribute accepted by **no** branch, neither tags nor component props, is `MEEK112` (`colour no se aplica a ninguna rama de is`, meaning colour does not apply to any is branch). The editor completes names inside `is` and shows the component or `<MeekoLink>` in the literal's hover.
- **Limits.** With names, all `is` outcomes are literals: a value (`x ? 'MeekoLink' : props.as`) is `MEEK132`. `ref:` is valid only with a single name (`MEEK052`); with several branches, each is a different element or component. `?:` conditions are evaluated in every branch traversing them, so they must be expressions without side effects.
- **Runtime names.** A name arriving at runtime (from a URL, a database) is not resolved at compile time: load it with [`resolveComponent(name)`](reference/components/componentregistry.md), which returns a promise with the module, and pass the module to `is`. Use the literal in `is` when the name is known while writing the template, and `resolveComponent` when chosen at runtime or the component must load lazily.

## A button that is a route, link or button

A single component rendering `<MeekoLink>` if it receives `to`, an `<a>` if it receives `href` and a `<button>` if it receives neither, each with its props and the HTML attributes passed by the parent. Since `1.8`, it fits in one template with `'MeekoLink'` in `is` (see [Component names in `is`](#component-names-in-is)). This is the pattern verified with `meeko check`, SSR, hydration and client navigation:

```html
<!-- app/components/AppButton.meeko -->
<script lang="ts">
import { computed } from '@meekojs/meeko'
import type { ElementAttributes } from '@meekojs/meeko'

/** Params for route K: `{ id: string }` in `/users/[id]`, `{}` in a static route. */
type RouteParamsOf<K extends RouteId> = NonNullable<MeekoLinkProps<K>['params']>
/** A route with its correlated params: required if the route has them, forbidden otherwise. */
type LinkTarget = {
	[K in RouteId]: { to: K; search?: MeekoLinkProps['search'] } & (keyof RouteParamsOf<K> extends never ? { params?: never } : { params: RouteParamsOf<K> })
}[RouteId]
type LinkProps = LinkTarget & { href?: never; target?: never; rel?: never; download?: never; type?: never; disabled?: never }
type AnchorProps = {
	href: string
	target?: '_self' | '_blank' | '_parent' | '_top'
	rel?: string
	download?: string | boolean
	to?: never
	params?: never
	search?: never
	type?: never
	disabled?: never
}
type ButtonProps = {
	type?: 'button' | 'submit' | 'reset'
	disabled?: boolean
	to?: never
	params?: never
	search?: never
	href?: never
	target?: never
	rel?: never
	download?: never
}
/** Attributes forwarded unchanged, shared by `<a>` and `<button>`: `id`, `title`, `aria-*`, `data-*`… */
type SharedAttributes = Pick<ElementAttributes<'a'>, keyof ElementAttributes<'a'> & keyof ElementAttributes<'button'>>
type ForwardedAttributes = Omit<SharedAttributes, 'class' | 'type'>

const props = defineProps<(LinkProps | AnchorProps | ButtonProps) & ForwardedAttributes & { label?: string; class?: string }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const snippets = defineSnippets<{ default?: [] }>()

const linkRel = computed(() => props.rel ?? (props.target === '_blank' ? 'noopener noreferrer' : undefined))
/** Each branch receives its own props; the rest (`id`, `title`, `aria-*`, `data-*`…) are forwarded with `bind`. */
const attributes = computed((): ForwardedAttributes => {
	const { to, params, search, href, target, rel, download, type, disabled, label, class: className, ...rest } = props
	return rest
})
</script>
<template>
	<component
		is="props.to !== undefined ? 'MeekoLink' : props.href !== undefined ? 'a' : 'button'"
		bind:to="props.to"
		bind:params="props.params"
		bind:search="props.search"
		bind:class="props.class"
		bind="attributes.value"
		bind:href="props.href"
		bind:target="props.target"
		bind:rel="linkRel.value"
		bind:download="props.download"
		bind:type="props.type ?? 'button'"
		bind:disabled="props.disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</component>
</template>
```

`to`, `params` and `search` only reach the `'MeekoLink'` branch; `href`, `target`, `rel` and `download` reach the second branch's `<a>` (and `target`, `rel` and `download` also reach `<MeekoLink>`'s `<a>`, which builds its `href`); `type` and `disabled` only reach `<button>`. Before `1.8`, or if you prefer explicit branches, the same template is written with two `if:when` conditions, which also narrow `props`:

```html
<template>
	<MeekoLink
		if:when="props.to !== undefined"
		bind:to="props.to"
		bind:params="props.params"
		bind:search="props.search"
		bind:class="props.class"
		bind="attributes.value"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</MeekoLink>
	<component
		if:when="props.to === undefined"
		is="props.href !== undefined ? 'a' : 'button'"
		bind:class="props.class"
		bind="attributes.value"
		bind:href="props.href"
		bind:target="props.target"
		bind:rel="linkRel.value"
		bind:download="props.download"
		bind:type="props.type ?? 'button'"
		bind:disabled="props.disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</component>
</template>
```

The parent uses it with each branch's props; `aria-*`, `data-*`, `id` and `title` reach the element:

```html
<AppButton to="/about" label="About" />
<AppButton to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'actividad' }" aria-label="Profile">Profile</AppButton>
<AppButton href="https://example.com" target="_blank" label="Documentation" />
<AppButton href="/informe.pdf" download="informe.pdf" label="Descargar" />
<AppButton type="submit" bind:aria-busy="saving.value" label="Save" />
<AppButton bind:disabled="!valid.value" on:click="reset" data-testid="reset">Reset</AppButton>
```

With `id: "7"`, SSR writes, in this order, an `<a>` with `href="/about"`; another with `aria-label="Perfil"` and `href="/users/7?tab=actividad"`; an `<a>` with `target="_blank"` and `rel="noopener noreferrer"`; one with `download="informe.pdf"`; a `<button type="submit">` and a `<button>` with `data-testid="reset"`, `type="button"` and `disabled`. Hydration preserves those elements, `on:click` reaches the parent through `emit` and forwarded attributes update when they change.

- **Three mutually exclusive branches.** Each branch declares the others' props as `never`, so `to` with `href`, `to` or `href` with `type` or `disabled`, and `type` with `target` are type errors in the parent (`TS2345` or `TS2322`). Without `to` or `href`, it is a button, with `type="button"` by default.
- **Routes with their parameters.** `MeekoLinkProps['params']` does not relate parameters to the route: with `to: RouteId` and `params?: MeekoLinkProps['params']`, the parent could omit `params` for `/users/[id]`. `LinkTarget` iterates over `RouteId` and creates a variant per route, so `meeko check` requires `params` for `/users/[id]` (`TS2345`), rejects a nonexistent key (`TS2353`) and forbids `params` on a static route. A nonexistent route is `TS2322` on `to`.
- **`<MeekoLink>` with a route union.** Inside the component, `bind:to="props.to"` is a route union and `bind:params="props.params"` a parameter union TypeScript cannot relate in that expression. Since `1.8`, `<MeekoLink>` then accepts `params` from one of the routes, or none, and optional `search`; previously it produced `TS2412`. The props type correlates the route and its parameters, which the parent does check.
- **One template or two branches.** With `'MeekoLink'` in `is`, each branch is checked after the `?:` condition leading to it, just as `if:when` narrows `props` in each branch (see [Conditions with `if:when` and types](component-template.md#conditions-with-ifwhen-and-types)): `props.to` is a route inside `'MeekoLink'`. `<component is>` only writes `href`, `target`, `rel` and `download` on `<a>` and `type` and `disabled` on `<button>` (see [Attributes by tag](component-attributes.md#attributes-by-tag)). Both forms render the same elements and `meeko check` checks the same rules in the parent.
- **Parent attributes.** Since `1.8`, `aria-*` and `data-*` (static or with `bind:`) pass to a component as props with that name, like `id` or `title`; the component declares them, here with `ElementAttributes`, and one it does not declare is `TS2353` on the attribute (see [Static props](component-attributes.md#static-props)). `ForwardedAttributes` are attributes common to `<a>` and `<button>`: `bind` on `<MeekoLink>` is checked against `<a>` attributes (`MEEK113`), so an attribute specific to `<button>`, such as `autocomplete`, is not valid in all three branches.
- **The rest, with `bind`.** Own props are separated with destructuring inside a `computed`, which follows the props, and the rest goes to `bind`. Since `1.8`, `props` does not include `defineEmits` handlers (`onClick`) among its keys, so rest does not carry them along; previously, `bind` threw `MEEK113` with the `onClick` key (see [Component events](component-events.md#component-events-defineemits-and-on)).
- **Default `rel`.** `linkRel` puts `noopener noreferrer` on a `target="_blank"` without `rel`; an explicit `rel` wins.
- **Optional text.** `{props.label ?? ''}`: `{expresión}` writes its value's text, including `undefined`.

With destructured props (since `1.8`), the same component's script and template are shorter; types do not change and `meeko check` checks the same rules in the parent:

```html
<script lang="ts">
// …the same imports and types…
const { to, params, search, href, target, rel, download, type = 'button', disabled = false, label = '', class: className, ...rest } = defineProps<(LinkProps | AnchorProps | ButtonProps) & ForwardedAttributes & { label?: string; class?: string }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const snippets = defineSnippets<{ default?: [] }>()

const linkRel = computed(() => rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined))
</script>
<template>
	<MeekoLink
		if:when="to !== undefined"
		bind:to="to"
		bind:params="params"
		bind:search="search"
		bind:class="className"
		bind="rest"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{label}
	</MeekoLink>
	<component
		if:when="to === undefined"
		is="href !== undefined ? 'a' : 'button'"
		bind:class="className"
		bind="rest"
		bind:href="href"
		bind:target="target"
		bind:rel="linkRel.value"
		bind:download="download"
		bind:type="type"
		bind:disabled="disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{label}
	</component>
</template>
```

`rest` replaces the `attributes` `computed`, `if:when="to !== undefined"` narrows `params` like `props.to`, and pattern defaults (`type = 'button'`) remain exclusive to their branch: `to` with `type` remains an error in the parent. See [Destructure props](component-basics.md#destructure-props).
