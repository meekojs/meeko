---
name: meeko
description: Write and fix code for Meeko (`@meekojs/meeko`), the typed `.meeko` single-file-component engine with signals, SSR and hydration, and Meeko Framework (file routing under `app/pages`, `<script server>`, `definePage`, API/RPC routes, `meeko.config.ts`). Use whenever a project contains `.meeko` files, `meeko.config.ts` or `@meekojs/*` dependencies, or the user mentions Meeko, MeekoLink, defineProps/definePage, `meeko check` or MEEK diagnostic codes.
---

# Meeko

Meeko is **not** Vue, Svelte or React. Its syntax looks familiar but differs in ways that compile silently into wrong output (`@click`, `v-if`, `class:active`, `<slot>` and `title="{x}"` become literal attributes or elements). Follow this file, and open the matching reference before writing anything non-trivial.

Targets `@meekojs/meeko` **1.9**. Check the installed version in `package.json`; when in doubt, trust the installed `.d.ts` files in `node_modules/@meekojs/meeko/dist/` and the diagnostics from `meeko check` over memory.

## References (read on demand)

| Task                                                                                                 | File                                                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| SFC structure, props, emits, model, snippets, every template directive                               | [references/components.md](references/components.md)                   |
| `signal`, `computed`, `effect`, lifecycle, context, `useState`/`useStorage`/`useHead`                | [references/reactivity.md](references/reactivity.md)                   |
| Styles, built-ins (`MeekoLink`, `MeekoAwait`, `MeekoTeleport`), dynamic components                   | [references/components-advanced.md](references/components-advanced.md) |
| Pages, `definePage`, render modes, data loading, layouts, middleware, navigation, auto-imports       | [references/framework-routing.md](references/framework-routing.md)     |
| `meeko.config.ts`, API routes, RPC, sessions/auth, WebSockets, adapters, deployment                  | [references/framework-server.md](references/framework-server.md)       |
| CLI, MEEK diagnostic codes, Vite, `@meekojs/ui`/`i18n`/`icon`, ESLint, Prettier, testing, migrations | [references/tooling.md](references/tooling.md)                         |

## Minimal component

```meeko
<script lang="ts">
import * as Card from './Card.meeko'

type Props = { title: string; initial?: number }
const { title, initial = 0 } = defineProps<Props>()
const emit = defineEmits<{ change: [count: number] }>()

const count = signal(initial)
const double = computed(() => count.value * 2)

function increment() {
	count.value++
	emit('change', count.value)
}
</script>

<template>
	<Card>
		<h2>{title}</h2>
		<button
			type="button"
			bind:disabled="count.value >= 10"
			on:click="increment"
		>
			{count.value} (x2 = {double.value})
		</button>
	</Card>
</template>

<style scoped>
	h2 { margin: 0; }
</style>
```

In a Framework app `signal`, `computed`, etc. are auto-imported; in engine-only (Vite) projects import them from `'@meekojs/meeko'`. Macros (`defineProps`, `defineEmits`, `defineModel`, `defineSnippets`, `defineExpose`, `useElementRef`) are never imported.

## Core rules

**Files and scripts**

- Every file needs `<template>`. Scripts must be `<script lang="ts">` (`MEEK006`). One `<style>` or `<style scoped>`; `:global(.x)` only inside `scoped`.
- Top level of `<script>` runs once per instance: one declarator per `const` (`MEEK014`), no value `export` (`MEEK018`); put `class`/`enum` in a `.ts` module.
- Import components as `import * as Card from './Card.meeko'` (no default export) and use PascalCase tags. In Framework apps files in `app/components` are auto-imported (`app/components/App/Card.meeko` → `<AppCard>`).

**Template syntax**

- Text: `{expr}` — single braces (`{{ }}` is `MEEK020`). Interpolate `sig.value`, not `sig`.
- Dynamic attributes: `bind:title="expr"`. Never `:title` (`MEEK012`) or `title="{x}"` (literal text). `bind:class` takes a string; `null`/`undefined`/`false` removes the attribute; `aria-*` need `'true'`/`'false'` strings.
- Events: `on:click="handler"` or `on:click="() => save(id)"`, never `on:click="save()"`. No modifiers (`.prevent` → `MEEK011`): call `event.preventDefault()`. Read `event.currentTarget.value`.
- Conditionals: `if:when="expr"`; 1.9 has no else — use `if:when="!expr"`. Never combine with `each:of` on one tag (`MEEK021`); wrap with `<template if:when>`.
- Lists: `<li each:of="items.value" each:as="item" each:key="item.id">` (`each:index` defaults to `index`).
- Two-way binding: `model="nameSignal"` (pass the signal, not `.value`, not a `computed`). Components: `model:name="sig"`, child declares `defineModel<T>('name')`.
- Slots are snippets: child `defineSnippets<{ default: []; row?: [item: T] }>()` + `<render snippet="snippets.row" args="item" />`; parent `<snippet name="row" params="item">…</snippet>`. There is no `<slot>`.
- Element refs: `<input ref:field>` + `const field = useElementRef('field')`; `null` during SSR, read it in `onMounted` or handlers.
- Raw HTML: `<div html="trustHtml(clean)"></div>` with an empty element (`MEEK095`, `MEEK107`).

**Reactivity**

- Assign, never mutate: `items.value = [...items.value, x]` (`push` notifies nothing).
- `props` is reactive and read-only; `const t = props.x.trim()` freezes the first value (`MEEK101`) — use `computed`.
- `computed` is pure and synchronous. `effect`/`onCleanup` callbacks must be synchronous; since 1.10 a function returned from `effect` (and `onCleanup` inside it) is that run's cleanup, run before the next run and on stop.
- `effect` and top-level code also run during SSR; `onMounted` never does. Touch `window`/`document` only in `onMounted` or handlers. Top-level `onCleanup` also runs on the server.
- Call `onMounted`, `onCleanup`, `inject`, `useState`, `useStorage`, `useId` synchronously during setup, not in handlers or after `await`.
- Top-level signals and `useState` must hold JSON-serializable values (no `Date`, `Map`).
- Avoid browser-dependent values (`Date.now()`, `Math.random()`, `window`) in the initial render: they cause hydration mismatches.

**Framework**

- Each `.meeko` in `app/pages` not starting with `+` is a route (`[id]`, `[...slug]`, `(group)`); shared components go in `app/components`, layouts in `app/layouts`.
- Page options: `<script server lang="ts">export const route = definePage({ render: 'prerender' })</script>`. Options read statically must be literals. Dynamic prerendered routes need `prerenderEntries`.
- Server data: top-level `export const` in `<script server>` **or** `definePage({ load })` (→ `props.data`), never both (`MEEK070`). Exports must be JSON-serializable and are read-only (wrap in `signal(...)` to edit).
- `usePage()`, `redirect()`, `notFound()` only at top level of `<script server>` (`MEEK073`); inside `load` throw `ApiError` / return `Response.redirect(...)`.
- Links: `<MeekoLink to="/users/[id]" bind:params="{ id }">` — `to` is the route ID, never a filled URL; `params`/`search` need `bind:` (`MEEK105`). There is no `navigate()` composable.
- `render: 'client'` makes the "server" block public browser code. Never put secrets in `<script>` or client blocks.
- Route middleware does not protect API/RPC endpoints; check the session inside the handler.

**Server (Framework)**

- Locations: API `server/api/**/<name>.<get|post|put|patch|delete>.ts` (`defineApiRoute`), RPC `server/rpc/**/<name>.ts` (`defineRpc`, client `rpc.a.b()`), sockets `server/socket/<channel>.ts`, HTTP middleware `server/middleware/NN-name.ts`, page guards `app/middleware/*.server.ts`.
- Validation schemas (`params`, `query`, `body`, `response`, `input`, `output`) are Standard Schema values imported from `shared/` (e.g. `#shared/schemas/user`).
- Private endpoints: `auth: 'required'` + `authorize`; take the user from `context.session.current`, never from the body.
- Errors: `throw new ApiError('NOT_FOUND', 404, { message })`; clients get `ClientError` (`isClientError(err, 'NOT_FOUND')`). Other throws become `500 INTERNAL_ERROR`.
- Client code must never value-import `server/**`, `#server/*` or `*.server.ts` (`MEEK108`). Passwords: `hashPassword`/`verifyPassword` from `@meekojs/meeko/password`.

## Workflow

1. Detect the project kind: `meeko.config.ts` + `app/pages` → Framework; `@meekojs/meeko/vite` in `vite.config.*` → engine-only.
2. Read the reference for the area you touch. Mirror existing project files for style.
3. Validate after every change, using the project's package manager:
   - `npx meeko check .` (types + template diagnostics; `npx meeko check path/Foo.meeko --json` for one file).
   - `npx meeko doctor .` when packages or generated types are missing; `npx meeko routes .` after adding routes.
   - `npx meeko build .` before declaring a Framework change done.
4. Fix every `MEEKxxx` diagnostic; look the code up in [references/tooling.md](references/tooling.md). Never edit generated `.meeko/` or `dist/` folders.

## Common mistakes from other frameworks

| Wrong (Vue / Svelte / React habit)                      | Meeko                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@click="f"`, `onClick={f}`, `on:click={f}`             | `on:click="f"`                                                                                                      |
| `:href="url"`, `href={url}`, `href="{url}"`             | `bind:href="url"`                                                                                                   |
| `v-if`, `{#if}`, `cond && <X/>`                         | `if:when="cond"`                                                                                                    |
| `v-for`, `{#each}`, `.map()`                            | `each:of="list" each:as="item" each:key="item.id"`                                                                  |
| `v-model="x"`, `bind:value={x}`                         | `model="x"` (the signal)                                                                                            |
| `<slot />`, `children`                                  | `defineSnippets` + `<render snippet="snippets.default" />`                                                          |
| `useState`/`ref()` for local state                      | `signal()` (`useState` is Meeko's SSR-shared keyed state)                                                           |
| `import Card from './Card.meeko'`                       | `import * as Card from './Card.meeko'`                                                                              |
| `withDefaults(defineProps…)`                            | `defineProps<P>({ size: 'md' })` or destructuring defaults                                                          |
| `@submit.prevent`                                       | `on:submit="(e) => { e.preventDefault(); … }"`                                                                      |
| `useRouter().push()`                                    | `<MeekoLink>` / `<a href>` / `location.assign()`                                                                    |
| `<MeekoSelect>`, `<MeekoPopover>`, `<MeekoThemeToggle>` | `@meekojs/ui` `UICombobox` (same contract; `UISelect` is a native select), `UIPopover`, `UIThemeToggle` (`MEEK121`) |
