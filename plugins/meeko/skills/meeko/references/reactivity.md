# Reactivity, lifecycle and state composables

Meeko 1.9. Fine-grained signals, no virtual DOM: the compiled template updates exactly the node/attribute that read a signal.

## Imports

| From                       | Exports                                                                                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@meekojs/meeko`           | `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `onMounted`, `createContext`, `provide`, `inject`, `provideErrorHandler`, `useId`, `createId`, `serializeJson`, `trustHtml`; types `Signal`, `ReadonlySignal`, `ContextKey`, `ErrorSource`, `ComponentErrorHandler` |
| `@meekojs/meeko/framework` | `useState`, `useStorage`, `useHead`, `useSeoMeta`, `useTheme` (+ types `StorageOptions`, `HeadInput`, `SeoMetaInput`, `ThemeState`)                                                                                                                                                                |

In a framework app (`app/`), all of these are **auto-imported** in `.meeko` files and app modules; a project export with the same name wins. Explicit imports also work.

## What runs where

| Code                                         | SSR                                     | Hydration / client mount                                                   | Client dry pass (navigation preload) |
| -------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| Top level of `<script lang="ts">`            | yes                                     | yes (again, from transferred state)                                        | yes                                  |
| `computed(fn)`                               | yes, eagerly                            | yes, recomputed (not transferred)                                          | yes                                  |
| `effect(fn)`                                 | **first run only**                      | yes, and on every dependency change                                        | **no**                               |
| `onMounted(fn)`                              | **never**                               | once, after mount/hydration                                                | never                                |
| `onCleanup(fn)`                              | **yes** — root is disposed after render | on unmount / dispose (inside an `effect`: before its next run and on stop) | —                                    |
| Code after first browser `await` (see below) | never                                   | after mount, browser only                                                  | never                                |
| `<script server>`                            | yes (server only)                       | never                                                                      | —                                    |

There is **no `onUpdated`**: use `effect`.

## signal

```ts
const count = signal(0)                    // Signal<number>
const user = signal<User | null>(null)     // annotate unions / empty values
const tags = signal<string[]>([])

count.value++                              // write -> notifies synchronously
tags.value = [...tags.value, 'admin']      // ALWAYS assign a new value
user.value = { ...user.value!, name: 'Grace' }
```

- Read `.value` in template/computed/effect = subscribe. Write notifies only if `!Object.is(old, new)`; same value = no-op. Mutating in place (`push`, `obj.x = …`) notifies **nobody**, no error.
- `Signal<T>` is assignable to `ReadonlySignal<T>` — return that from composables to hide writes.
- **Component state transfer**: top-level _writable_ signals of a component `<script>` are serialized with SSR HTML, restored before hydration, and preserved by name on HMR. `computed`, constants and signals nested inside objects are not transferred. `undefined` travels (since 1.5).
- Values must be JSON-faithful. `signal(new Date())` fails SSR: `the signal "when" cannot be sent to the browser with the SSR state (Non-plain object at $.when)`. Store `toISOString()` and derive with `computed`.
- In SSR, writes after the HTML is produced never reach the browser.
- Templates: `{count.value}`, `on:click="() => count.value++"`, `if:when="count.value > 0"`, `model="count"` (model takes the signal itself, no `.value`).

## computed

```ts
const total = computed(() => items.value.reduce((s, i) => s + i.price, 0)) // ReadonlySignal<number>
const date = computed(() => new Date(iso.value))   // non-serializable values belong in computed
```

- **Eager**: runs at creation and on each dependency change, even if unread. Keep it cheap.
- Notifies readers only when the result changes by `Object.is` (returning a new object = always notifies).
- Read-only: `total.value = 1` is `TS2540` and, since 1.7, throws `TypeError: Meeko computed values are read-only…`.
- Runs in SSR and in the client dry pass: **no side effects** (`localStorage`, `fetch`, DOM) inside.
- Never `async`: `computed(async …)` yields a `Promise`. Use `useApi`/`useRpcQuery` for server data.
- Dynamic deps: only what the last run read counts.
- Props from `defineProps` are reactive (since 1.2): `computed(() => props.cents / 100)` follows the parent.

## effect

```ts
const stop = effect(() => {
	if (typeof document === 'undefined') return // runs once in SSR!
	document.title = query.value ? `Search: ${query.value}` : 'Search'
})
stop() // optional; inside a component it stops on unmount
```

- Callback must be **synchronous**. `effect(async () => …)` is a type error (`TS2345 … parameter of type 'never'`) and at runtime `TypeError: Meeko effect callbacks must be synchronous`. Reads after `await` would not be tracked anyway.
- Runs immediately, then on dependency changes, in creation order (parent before child).
- **Per-run cleanup (since 1.10).** A function returned from the callback is that run's cleanup: it runs before the next run and when the effect stops (stop(), unmount, root dispose; in SSR when the render's root is released). `onCleanup` inside an effect belongs to that run too, and so do effects/`computed`/`createRoot` created inside it (recreated every run — create them outside if they must outlive a run). Other return values are ignored; a returned promise, or a cleanup returning one, is rejected. Up to 1.9 the returned function was silently ignored and `onCleanup` accumulated on the component.

```ts
effect(() => {
	const q = query.value.trim()           // track BEFORE any async work
	if (!q) { results.value = []; return }
	const controller = new AbortController()
	fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
		.then((r) => r.json() as Promise<string[]>)
		.then((list) => { results.value = list })
		.catch((e: unknown) => { if (!controller.signal.aborted) console.error(e) })
	return () => controller.abort()          // before the next search and on unmount
})
```

- Don't return a function you only meant to read: `effect(() => props.onSelect)` would call it as a cleanup. Use a block body.
- `onCleanup` after an `await`, in an event handler or at module level has no owner: it throws an error saying what to use and, in development, also `console.warn`s it.

- Writing a signal the effect reads loops: `Error: Reactive update cycle exceeded 1000 iterations`. Derived state = `computed`, not `effect` + signal.
- Browser APIs: guard with `typeof window` or create the effect inside `onMounted` (browser-only):

```ts
onMounted(() => { effect(() => window.scrollTo(0, offset.value)) }) // still owned by the component
```

- Errors: a throw during setup fails the render; a throw while reacting to a write propagates to the writer (e.g. the `on:click` handler) and then to `provideErrorHandler`. Multiple failures → `AggregateError`.
- For data fetching prefer `useApi` / `useRpcQuery` (cancellation, SSR, hydration, `debounceMs`, `enabled`).

## batch / untrack

```ts
batch(() => { category.value = 'all'; minPrice.value = 0; page.value = 1 }) // observers run once, after fn
const n = untrack(() => page.value)          // read without subscribing
effect(() => log(query.value, untrack(() => page.value))) // re-runs on query only
const draft = signal(untrack(() => props.text)) // intentional one-time copy of a prop
```

- `batch` returns `fn`'s result; nested batches flush at the outermost. Must be sync: writes after an `await` fall outside the batch. Do async work first, then batch the writes.
- Inside `batch`, a `computed` still holds its **old** value until the batch ends.
- `useApi`/`useRpcQuery`/mutations already batch their `data/error/pending` writes.
- `untrack(() => sig)` returning the signal itself does not help — read `.value` inside.
- `onMounted` callbacks already run untracked.

## onMounted

```html
<script lang="ts">
	const width = signal(0)
	const field = useElementRef('search')
	onMounted(() => {
		field.value?.focus()
		const update = (): void => { width.value = window.innerWidth }
		update()
		window.addEventListener('resize', update)
		return () => window.removeEventListener('resize', update) // registered as onCleanup
	})
</script>
<template><input ref:search /><p>{width.value}px</p></template>
```

- Browser only, once, after hydration/mount when bindings and `ref:`s exist. Never in SSR or dry renders → `window`/`document` are safe.
- Must be called while the component script runs (top level or a composable it calls). Elsewhere: `Error: onMounted() must be called while a component script runs`. In `<script server>`: `MEEK108`.
- Order: children before parent; multiple callbacks in registration order. Components mounted later (`if:when` true, new `each:of` row, navigation) follow the same rule within their mount.
- `async` allowed, but then it **cannot return a cleanup** (type error); call `onCleanup` **before the first `await`**:

```ts
onMounted(async () => {
	const controller = new AbortController()
	onCleanup(() => controller.abort())
	const res = await fetch('/api/stats', { signal: controller.signal })
	stats.value = await res.json()
})
```

- Errors (sync or rejection) go to the nearest `provideErrorHandler` with source `"mounted"`; hydration is not undone. Not run if hydration fails or component is disposed first.
- `useStorage`, `useTheme` and user-edited `model` controls apply their client values **just before** `onMounted`.

## onCleanup

```ts
export function useNow(ms = 1000): ReadonlySignal<number> {
	const now = signal(Date.now())
	const timer = typeof window === 'undefined' ? undefined : setInterval(() => { now.value = Date.now() }, ms)
	onCleanup(() => clearInterval(timer))
	return now
}
```

- Registers on the active root (component or `createRoot`); runs on unmount, route change, `if:when`/`each:of` row removal, and on failed render/hydration. All cleanups run in registration order; failures aggregate.
- **Runs in SSR too** (server root is disposed after render). A top-level cleanup calling `window`/`cancelAnimationFrame` throws `ReferenceError` on the server (`MEEK128` warning). Put resource + cleanup inside `onMounted`, or guard with `typeof window`.
- Must be synchronous (`TypeError: Meeko cleanup callbacks must be synchronous`); start async close and `.catch` it yourself.
- No active root (module top level, event handler, after `await`): `Error: onCleanup() requires an active component root` (`MEEK130` module-level, `MEEK129` after await).
- `effect`/`computed` of the component need no cleanup — they stop with the root.

## createContext / provide / inject

```ts
// app/composables/toasts.ts — key created ONCE at module level
const toastsKey = createContext<Toasts>('toasts')       // always pass T and a description
export function provideToasts(): Toasts {
	const items = signal<readonly string[]>([])
	const toasts: Toasts = { items, show: (m) => { items.value = [...items.value, m] } }
	provide(toastsKey, toasts)
	return toasts
}
export const useToasts = (): Toasts => inject(toastsKey)
```

- `provide` reaches the component and all **descendants** (incl. snippet and `<MeekoTeleport>` content), not siblings. Nearest provider wins.
- `inject` with no provider throws `Error: Missing Meeko context: toasts`. No default value: provide one in `app/app.meeko`, or wrap in `try/catch`.
- Call both at script top level (or a composable called by it). In handlers/after `await` there is no active root → store the injected value first.
- Provide **the signal**, not `.value`, for reactivity. `inject(key).value` at setup freezes it.
- Never create the key inside a component script (new `Symbol` per instance) and never use `Symbol.for`.
- Context is per request in SSR, does not travel in the payload (re-run on hydration). For tree-wide state transferred SSR→client use `useState`.

## createRoot

```ts
const dispose = createRoot((dispose) => {
	effect(() => { document.title = title.value })
	onCleanup(() => console.log('released'))
	return dispose
})
dispose() // runs cleanups, stops effects, clears contexts
```

- For code outside components (tests, custom hosts) or a group of effects to stop early. Created in a component script it is a child root (disposed with the component); created in an **event handler** it has no parent — dispose it yourself (`onCleanup(() => stop?.())` at top level).
- Inherits contexts from the active root. If `fn` throws, the root is disposed before rethrowing.
- Auto-imported since 1.7.

## provideErrorHandler

```ts
provideErrorHandler((error, source) => {     // error: unknown — narrow it
	failure.value = error instanceof Error ? error.message : String(error)
})
```

- Browser-side failures **after mount** for this component's branch: `"event"`, `"effect"`, `"cleanup"`, `"mounted"`, `"navigation"`, `"socket"`, `"uncaught"`, `"rejection"`. `ErrorSource` may gain members: `switch` needs `default`.
- Does **not** catch render/hydration errors (use `+error.meeko` / `app/error.meeko`). Nearest handler wins; with none, falls to `mountClientApp({ onError })` then console.
- Uses `provide`: outside a component it throws `provide() requires an active component root`.

## Top-level `await` in setup (summary)

Only `await useApi(...)` / `await useRpcQuery(...)` (resolved in SSR, hydration and navigation) and `await useElementRef(...)` / `await useSocket(...)` / `await useSocketClient(...)` (browser-only) are allowed, as a full statement or full initializer. The first **browser** `await` splits setup: code after it runs only in the browser after mount; the template can only use names declared before it (`MEEK057`); `define*` macros must precede it (`MEEK058`); `useId()` must precede it. Other top-level `await` → `MEEK055`.

## Framework state composables

### useState — app-wide shared state, SSR-transferred

```ts
// app/stores/cart.ts
export function useCart() {
	const items = useState('cart:items', (): string[] => [])  // factory, not a value
	return { items, add: (id: string) => { items.value = [...items.value, id] } }
}
```

- One signal per key per app. SSR: one store **per request** (never use module-level variables for user state); serialized into the payload, restored before hydration so `factory` is not re-run on the client. Browser: survives client navigations; lost on reload.
- JSON-faithful values only. Never secrets (it ships in HTML).
- Writing after SSR render finished: `STATE_SEALED` error. Load data before render (`<script server>`, `load`, `await useApi`).
- Callable from nested code that runs with the component; in an event handler: `Missing Meeko context: Meeko framework state`.

### useStorage — localStorage/sessionStorage-backed signal

```ts
const view = useStorage('products:view', 'grid')                          // Signal<string>
const mode = useStorage<'grid' | 'list'>('products:view', 'grid')
const draft = useStorage<string | undefined>('comment:draft', undefined, { storage: 'session' })
const density = useStorage('table:density', 'normal', { schema: v.picklist(['compact', 'normal']) })
draft.value = undefined // removes the key; next read is `initial`
```

- Server never reads storage: SSR **and hydration** use `initial`; stored value is applied right after hydration, before `onMounted` → no mismatch. Later-mounted components render the stored value immediately.
- Syncs across tabs (`storage` event). Blocked/full storage never throws (in-memory fallback).
- Same key+area = one shared signal; first caller fixes `initial`/`schema`.
- Must be called during script execution (top level or composable): `Error: useStorage("k") must be called while a component script runs`.
- Never store tokens/credentials.

### useId / createId

```html
<script lang="ts">
	const id = useId()                    // top level, before any await
</script>
<template>
	<label bind:for="id">Name</label>
	<input bind:id="id" bind:aria-describedby="`${id}-hint`" />
	<p bind:id="`${id}-hint`">Hint</p>
</template>
```

- Deterministic from tree position + call order: identical in SSR HTML and hydration, unique per instance (stable per `each:key` row). Not in payload. Don't parse its format (`m-0`, `m-2_f0n3-1`). Prefix via `document.idPrefix` in `meeko.config.ts`.
- One call per element group; derive suffixes. Calling it in a handler/template function gives non-matching IDs.
- Use `bind:for="id"`, not `for="id"` (literal text).
- `createId()` (since 1.8): random UUID v4 anywhere, **not** hydration-stable — serialize it with data if created in SSR.

### useHead / useSeoMeta

```ts
useHead(() => ({                                  // getter => reactive
	title: unread.value ? `(${unread.value}) Inbox` : 'Inbox',
	meta: [{ name: 'robots', content: 'noindex' }],
	htmlAttrs: { lang: 'en' },
	bodyAttrs: { 'data-sidebar': open.value ? 'open' : undefined },
}))
useSeoMeta(() => ({ title: p.name, description: p.summary, ogImage: 'https://example.com/og.png', twitterCard: 'summary_large_image', canonical: 'https://example.com/p/1' }))
```

- Accepts object, `ReadonlySignal`, or getter. **A plain object is evaluated once** — pass a getter when it reads signals/props.
- Priority (low→high): `document` config, `app/app.meeko`, layouts (innermost wins), page + components, route `head` (`export const head`, `route.head`, `useHead` in `<script server>`). Later call wins within a level. Dedup by `key` or natural key.
- Entries removed on unmount; no-op outside a Meeko app and in the dry pass.
- `on*` attributes rejected; `titleTemplate` function only in `useHead`, string only in config.
- `useSeoMeta` unknown field: `TS2353` / `TypeError: useSeoMeta: unknown field`. Use absolute URLs for `ogImage`/`canonical`.

### useTheme (requires `theme` in `meeko.config.ts`)

```ts
const { theme, resolved, themes, set } = useTheme()
// theme: Signal<'system' | Name> (writable in browser; `model="theme"` works)
// resolved: ReadonlySignal<Name>; set('dark'); unknown name -> TypeError
```

- SSR reads cookie / `Sec-CH-Prefers-Color-Scheme`; otherwise `resolved` = light. Client values apply after hydration, before `onMounted`. `set()` on the server throws.
- For icons, render both and switch via CSS on `:root[data-theme='dark']` — don't branch on `resolved.value` in the template (flashes on prerendered pages).
- Ready-made toggle: `<UIThemeToggle>` from `@meekojs/ui` (`<MeekoThemeToggle>` is deprecated).

## Common mistakes

- `count++` / `if:when="count > 0"` — forgot `.value` (`TS2588`, `TS2365`). In `model="count"` pass the signal, no `.value`.
- `items.value.push(x)` / `user.value.name = 'x'` — no notification, no storage write. Assign a new array/object.
- `effect(async () => …)` or `onCleanup(async () => …)` — type error + runtime `TypeError`.
- Returning a cleanup function from `effect` — silently ignored. Use `onCleanup` once at top level + closure state.
- `effect(() => { total.value = a.value * b.value })` — use `computed`. Writing a read signal in an effect → 1000-iteration cycle error.
- `window`/`document`/`localStorage` in setup, `computed`, `effect` or top-level `onCleanup` without a guard — crashes SSR. Move to `onMounted`.
- `onCleanup` / `onMounted` / `inject` / `useStorage` / `useState` inside event handlers or after `await` — no active root. Call at top level, use results later.
- `async` `onMounted` returning a cleanup — not allowed; `onCleanup` before first `await`.
- `signal(new Date())`, `Map`, class instances in top-level signals or `useState` — SSR serialization error. Store JSON, derive in `computed`.
- `createContext` inside a component script, or `Symbol.for` keys — consumers never find the provider.
- `provide(key, sig.value)` / `inject(key).value` at setup — loses reactivity.
- `useHead({ title: \`${n.value}\` })`— static; use`useHead(() => ({ … }))`.
- `useId()` in a function called from the template, or after a browser `await` — IDs mismatch between server and client.
- Reading a `computed` inside `batch` and expecting the new value — read it after the batch.
- Expecting `provideErrorHandler` to catch render-time exceptions — it only sees post-mount failures.
- Using module-level variables for per-user state on the server — shared across requests; use `useState`.
