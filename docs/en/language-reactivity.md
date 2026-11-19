---
source-hash: 1dc4cc576ffb15ff363a533668f410a8db4027a7f24e7e22f2f7502cd06a457c
---

# Reactivity and lifecycle

## Reactivity

`signal(initial)` creates a writable value with `.value`. `computed(() => expression)` creates a read-only computed value. `effect(() => ...)` observes signals read and returns a function canceling the observer. `batch(() => ...)` batches updates; `untrack(() => ...)` reads without subscribing the current observer. `createRoot(dispose => ...)` groups effects to dispose of them when an instance unmounts. If an observer fails, Meeko continues other pending observers and propagates errors; multiple failures are delivered in an `AggregateError`. If the `batch` callback also fails, both causes are preserved.

The `effect` callback must be synchronous: reads after an `await` cannot be registered as dependencies of that execution. TypeScript rejects a callback returning a promise and the runtime rejects the same case in JavaScript; if that promise also rejects, Meeko reports the rejection so it does not remain unhandled. Start async work from a synchronous effect and explicitly manage its cancellation and errors.

The value returned by the `effect` callback is ignored: unlike React or Solid, a returned function is not a cleanup. `onCleanup` inside an effect does not clean up per run either: it registers on the active component or root and runs only when they are disposed, so every run would add another one. To release the previous run's resources, do it at the start of the next run and close the last one with `onCleanup` outside the effect:

```ts
let controller: AbortController | undefined
effect(() => {
	const q = query.value
	controller?.abort()
	const current = new AbortController()
	controller = current
	void fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: current.signal }).catch(() => {})
})
onCleanup(() => controller?.abort())
```

`onCleanup(() => ...)` registers resource disposal in the active root and also requires a synchronous callback. TypeScript rejects functions that can return `PromiseLike`; the runtime protects JavaScript and callbacks changing behavior, observes any rejection and delivers a `TypeError` during disposal. All cleanups continue executing and simultaneous failures are aggregated. To close an async resource, explicitly start and observe that operation before unmounting or use a host that can await its own shutdown lifecycle.

If rendering or hydration fails, Meeko disposes all effects and resources already registered. When both work and some cleanup fail, it delivers an `AggregateError` preserving both causes.

### Lifecycle

`onMounted(fn)` (since `1.1`) executes `fn` once in the browser after the component hydrates or mounts and its bindings and refs exist. It never runs in SSR. Call it while the component script executes; outside it, it throws an error. It is exported from the root and auto-imported in framework applications.

```html
<script lang="ts">
	const width = signal(0)
	onMounted(() => {
		const update = (): void => {
			width.value = window.innerWidth
		}
		update()
		window.addEventListener('resize', update)
		return () => window.removeEventListener('resize', update)
	})
</script>
<template><p>{width.value}px</p></template>
```

- **Order.** Callbacks execute at the end of the current hydration or mount, when everything that operation created exists: the component, its later siblings and its parent's bindings. Within it, children run their `onMounted` before the parent. A component mounting later (under an `if:`, in a new `each:` row or when committing navigation) follows the same rule within its own mount. Multiple callbacks in a component execute in registration order, without subscribing to signals they read. If hydration or mounting fails, their callbacks do not run, nor do those of a component disposed before completion.
- **Cleanup.** If `fn` returns a function, Meeko registers it as `onCleanup` and executes it when the component unmounts.
- **Async.** `fn` can be `async`, but then cannot return a cleanup: call `onCleanup` before its first `await`.
- **Errors.** A synchronous failure or rejected promise reaches the nearest observer with source `"mounted"`, does not stop other callbacks and does not undo hydration.

There is no `onUpdated`: use `effect` to react to changes.

| Phase                                             | When it runs                                       | Where                               |
| ------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| Setup (top level of `<script>`)                   | On rendering and on hydration or mounting          | Server and browser                  |
| `effect`                                          | During setup and whenever a signal it read changes | Server (first run only) and browser |
| `onMounted`                                       | Once, after hydration or mounting                  | Browser only                        |
| `onCleanup` (and cleanup returned by `onMounted`) | On unmounting or disposing the component           | Where it was registered             |

`createContext<T>()` creates a unique typed key. `provide(key, value)` publishes a value in the active instance; `inject(key)` finds the nearest provider and fails explicitly if missing. Independent roots do not share values. If the value is a signal, descendants can read it reactively.

Observers created during `hydrate` belong to that instance. During Vite HMR, writable script signals are preserved by name; computed values are recalculated. This in-memory HMR state is independent of JSON transfer between server and browser.

The `@meekojs/meeko` root exports exactly `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `onMounted`, `createContext`, `provide`, `inject`, `provideErrorHandler`, `serializeJson`, since `1.3`, `trustHtml`, since `1.5`, `useId` and, since `1.8`, `createId` and `isTooLargeToAnimate`, plus signal, context, component error, component, snippet, HTML tag and attribute value, `HotState`, DevTools and, since `1.3`, `TrustedHtml` types. This engine also documents `@meekojs/meeko/vite` and `@meekojs/meeko/devtools-ui`. Framework and adapter subpaths (`/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare` and `/build`) are described in the [framework guide](framework.md). The compiler imports its DOM, HMR and DevTools registration functions from `@meekojs/meeko/internal`. That path is a contract between the compiler and its runtime of the **exact same version**, and is not intended for manual imports. A generated module must be compiled with the same package version that executes it, so it must be recompiled when updating Meeko.

### New IDs: `createId`

`createId()` generates a cryptographic UUID v4 on server and browser without a component context. It is exported from the root and autoimported in Meeko applications; it can run inside functions, handlers and modules. Each call creates a new value. Serialize IDs created during SSR with their data to preserve them on the client. Use `useId()` for DOM identifiers that match during hydration. See [createId](reference/utils/create-id.md) for uniqueness limits and examples.

### Stable IDs: `useId`

Since `1.5`, `useId()` returns an ID for attributes linking elements (`id`, `for`, `aria-describedby`, `aria-controls`, `aria-labelledby`): the same in server HTML and on hydration, and different in each component instance. It is exported from the root and auto-imported in framework applications; a project's own export with the same name takes priority.

```html
<!-- app/components/AppSwitch.meeko -->
<script lang="ts">
	const props = defineProps<{ label: string; hint?: string }>()
	const on = defineModel<boolean>()
	const id = useId()
</script>
<template>
	<input
		type="checkbox"
		role="switch"
		bind:id="id"
		bind:aria-describedby="props.hint ? `${id}-hint` : null"
		model="on"
	/>
	<label bind:for="id">{props.label}</label>
	<p
		if:when="props.hint"
		bind:id="`${id}-hint`"
	>
		{props.hint}
	</p>
</template>
```

- **Deterministic.** The ID does not travel in state: it comes from the instance's tree position (its containing component, its row's key in an `each:` and the `if:` or snippet rendering it) and the call order in its script. Server and browser traverse the same positions, so hydration finds the same `id` in every attribute.
- **Unique.** Two instances never share an ID, including list rows or content rendered later in the browser by an `if:` or snippet. A row with `each:key` keeps its ID when the list reorders, and a component recreated by an `if:` recovers its previous one.
- **Where to call it.** At the script's top level, like `onMounted`, and before any `await`. Every call gives a new ID (`id` and `hint`, not one for everything); for several elements of the same field, derive suffixes from one: `` `${id}-hint` ``. Outside a component script (in an event handler or test), it returns a unique ID that does not match between server and browser.
- **Format.** Application prefix, `-`, position and counter: `m-0`, `m-2_f0n3-1`; a position with long text keys or other characters is summarized in a hash (`m-h1x2y3…-0`). It only contains letters, numbers, `-` and `_`, so it also works in a CSS selector. Do not depend on its shape, which can change between versions.
- **Prefix.** `document.idPrefix` in `meeko.config.ts` (a letter followed by letters, numbers, `-` or `_`; `m` by default) changes it on server and browser together. Use distinct prefixes when two Meeko applications share a page. A custom host passes the same value in `DocumentOptions.config` and `mountClientApp({ document })`.
- **Standalone roots.** With `hydrate` or `renderWithState` without the framework, each root starts at the empty position: two independent roots on the same page would repeat their IDs.

`useForm` uses it for [`form.field`](framework.md#field-components-formfield) IDs.
