---
title: useNavigation
group: composables
since: 1.0.0
description: Returns the application's navigation state, with pending set to true while a new page loads.
symbols:
  - "@meekojs/meeko/framework#useNavigation"
types:
  - "@meekojs/meeko/framework#NavigationState"
related:
  - "@meekojs/meeko/framework#useRoute"
  - "syntax:meekolink"
  - "syntax:meekoawait"
  - "@meekojs/meeko/framework#mountClientApp"
  - docs/framework.md#estado-de-navegación
  - docs/framework.md#navegación-y-render-client
source-hash: 1d9924053bf47ac3434a2efd5f9011747f6b0f4770453092b73b17b13648148c
---

`useNavigation()` tells you whether the application is changing pages. Its `pending` is `true` from the start of a client navigation (a link click, [`navigate()`](/docs/reference/navigate), `app.navigate()`, the back button) until the new page is committed, fails or is canceled, including loading its `await useApi`/`await useRpcQuery` calls and the first load of a `render: "client"` page. Use it for a global progress bar, a wait cursor or dimming content while the next page arrives.

It is exported from `@meekojs/meeko/framework` and, since `1.7`, auto-imported like `useRoute` (a project export called `useNavigation` takes precedence); explicit imports still work. You can also call it from code running with the component (a composable, a `computed`, an `effect`), but not from an event handler: there is no active root there, and it returns a fixed state with `pending` set to `false`.

## Usage

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
const navigation = useNavigation();
</script>

<template>
  <div class="progress" if:when="navigation.pending.value" role="progressbar" aria-label="Loading page"></div>
  <main bind:aria-busy="navigation.pending.value ? 'true' : null"><MeekoOutlet /></main>
</template>
```

The previous page remains visible while `pending` is `true`; when the new page is committed, it returns to `false`.

## Parameters

`useNavigation()` takes no parameters.

## Return value

A `NavigationState`:

| Property  | Type                      | Description                                                                         |
| --------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `pending` | `ReadonlySignal<boolean>` | `true` while a new page loads. In SSR and outside `mountClientApp`, always `false`. |

It never throws: outside a mounted application, it returns a fixed state with `pending` set to `false`.

## Examples

### A progress bar that does not flicker

A fast navigation should display nothing. An `effect` with a delay shows the bar only if loading takes time:

```html
<!-- app/components/NavigationProgress.meeko -->
<script lang="ts">
const navigation = useNavigation();
const visible = signal(false);
effect(() => {
  if (!navigation.pending.value) { visible.value = false; return; }
  const timer = setTimeout(() => { visible.value = true; }, 150);
  onCleanup(() => clearTimeout(timer));
});
</script>

<template><div class="progress" if:when="visible.value" aria-hidden="true"></div></template>
```

### Attributes for CSS

Since `1.10`, while `pending` is `true`, `<html>` carries the `data-navigating` attribute and, if the navigation started with a click on a `<MeekoLink>` or an internal `<a>`, that link carries `data-pending`. Back, forward and `app.navigate()` mark `<html>`, but no link. Both are removed when the navigation is confirmed, fails or is cancelled, and they never appear in the server HTML.

With them, a progress bar needs no component or `effect`. The transition's delay keeps it from flickering on a fast navigation: if it ends within 150 ms, the bar is never seen.

```css
/* app/styles/main.css */
html::before {
	content: "";
	position: fixed;
	inset: 0 0 auto;
	z-index: 1000;
	height: 3px;
	background: currentColor;
	transform: scaleX(0);
	transform-origin: left;
	opacity: 0;
	pointer-events: none;
}

html[data-navigating]::before {
	opacity: 1;
	transform: scaleX(0.8);
	/* Empieza a los 150 ms y avanza despacio mientras dure la carga. */
	transition: opacity 0s 150ms, transform 8s 150ms cubic-bezier(0.1, 0.7, 0.2, 1);
}

a[data-pending] {
	cursor: progress;
	opacity: 0.6;
}

@media (prefers-reduced-motion: reduce) {
	html[data-navigating]::before {
		transition: opacity 0s 150ms;
	}
}
```

When `data-navigating` is removed, the bar disappears without a transition and starts again from zero on the next navigation.

### Disabling actions during navigation

```ts
import { computed } from "@meekojs/meeko";
import { useNavigation } from "@meekojs/meeko/framework";

const navigation = useNavigation();
const disabled = computed(() => navigation.pending.value);
// <button bind:disabled="disabled.value">Save</button>
```

### A component aware of navigation

`pending` indicates a navigation is in progress; the destination route is not yet visible in [`useRoute`](/en/docs/reference/useroute), which only changes on commit. Together, they let a layout show the current page and loading state:

```html
<script lang="ts">
const navigation = useNavigation();
const route = useRoute();
</script>

<template>
  <p class="status">{route.path.value}{navigation.pending.value ? " · loading…" : ""}</p>
</template>
```

## Common mistakes

### Calling it in an event handler

```html bad
<script lang="ts">
function save() {
  if (useNavigation().pending.value) return;
  // …
}
</script>
```

There is no error, but the handler runs without an active root: `useNavigation()` returns the fixed state, and `pending` is always `false`. Get it in the script and read it in the handler:

```html good
<script lang="ts">
const navigation = useNavigation();
function save() {
  if (navigation.pending.value) return;
  // …
}
</script>
```

### Writing to `pending`

```ts bad
const navigation = useNavigation();
navigation.pending.value = true;
```

`meeko check` reports `TS2540: Cannot assign to 'value' because it is a read-only property`. The application's navigator manages this state; for your own indicator, use your own signal:

<!-- no-check -->

```ts good
const saving = signal(false);
```

### Expecting `pending` in SSR or on the first load

```html bad
<p if:when="navigation.pending.value">Loading the application…</p>
```

Server HTML and a full page load never display this text: `pending` only activates during client navigations. For data arriving after the first render, wrap the area in [`<MeekoAwait>`](/en/docs/reference/meekoawait) or read `pending` from the `useApi` resource:

```html good
<MeekoAwait for="items">
  <snippet name="pending"><p>Loading…</p></snippet>
  <ItemsList bind:items="items.data.value" />
</MeekoAwait>
```

## Notes

- **SSR.** Always `false`. Hydration does not change it either. `data-navigating` and `data-pending` do not appear in the server HTML either.
- **What counts.** The new page's preliminary render that loads its data `await` calls, the server payload request and loading a `render: "client"` route. Fragment-only navigation (`#seccion`) does not activate it: the browser only scrolls the page.
- **Cancellation.** If the user starts another navigation meanwhile, the previous one is canceled and `pending` stays `true` until the latest one finishes.
- **Accessibility.** Mark the changing area with `aria-busy` while loading instead of announcing every navigation.
