---
source-hash: 5ba3d2898d7fecacbd22269c8b55afe6c422658e0263ca584a09c1b402cd3cf5
---

# Upgrade from 1.1 to 1.2

`1.2` is a minor release: new features (modules, `document` and `useHead`, `<MeekoLink>` and `<MeekoOutlet />`, zero-configuration sessions, passwords, `rateLimit`, `useForm`, `useStorage`, PostCSS utilities…) are optional. Two behavior changes are released as [approved exceptions](stability.md#approved-exceptions) to the stability policy: reactive props and protection against _login CSRF_ in `session.create()`. Some other changes are noticeable when updating. This guide collects them and what you should review for each. The complete list, including additions and fixes, is in the [CHANGELOG](../../packages/meeko/CHANGELOG.md); compatibility commitments are in the [stability policy](stability.md).

## Recommended order

1. Update `@meekojs/meeko` to the exact version `1.2.0` and recompile or rebuild, including prerendered pages: generated code and runtime must have the same version. If you use the VS Code extension, update it to `1.2.0`; Meeko DevTools is unchanged.
2. Run `meeko check` and review `MEEK101` warnings: they identify prop copies that stop following the prop (see [Reactive props](#reactive-props-what-setup-copies-from-a-prop)).
3. If a script, test or native app logs in without sending `Origin`, adjust it (see [`session.create()` requires an allowed `Origin`](#sessioncreate-requires-an-allowed-origin)).
4. Replace `HOST` and `PUBLIC_ORIGIN` with `MEEKO_HOST` and `MEEKO_PUBLIC_ORIGIN` in the deployment environment, and review the root `.env`, which is now loaded (see [Environment variables](#environment-variables)).
5. Move layer directories listed in `modules` to `layers`, and replace `byId` in `api.*` calls when convenient: both keep working throughout `1.x`.
6. If any tests compare server HTML, review [Document HTML](#document-html).

## Approved exceptions

### Reactive props: what setup copies from a prop

When the parent changes a prop, the compiled child stays mounted and only bindings reading that prop update: DOM, focus, cursor and `<input>` composition, state and snippets are preserved. In `1.1`, the child was rebuilt on every change and setup ran again.

As a result, anything setup copies from a prop keeps its initial value: `const { label } = props`, top-level `props.title.toUpperCase()`, `signal(props.initial)` or the input to `useApi(ruta, { query: { q: props.q } })`. Also, `props` is read-only in the browser: assigning, deleting or defining a property throws `TypeError`. Components with a top-level data `await`, changes to `<component is>` or a `model` signal, and snippets appearing or disappearing still remount the child. SSR and hydration are unchanged.

`meeko check`, `meeko build` and the editor warn about these reads with `MEEK101`, and the editor offers to convert them to `computed` or declare them with `untrack`. To follow the prop, read it where used, derive with `computed` or pass a function to `useApi`/`useRpcQuery`:

```html
<script lang="ts">
const props = defineProps<{ title: string; q: string }>();

// Before: recalculated because the child was rebuilt on each change
const upper = props.title.toUpperCase();
const results = useApi("/api/search", { query: { q: props.q } });

// After
const upper = computed(() => props.title.toUpperCase());
const results = useApi("/api/search", () => ({ query: { q: props.q } }));
</script>
```

If you only need the initial value (for example, an unchanging key), `untrack(() => props.id)` declares that intent and removes the warning. To change a parent's value, emit an event (`defineEmits`) or use a model (`defineModel`) instead of writing to `props`. See [Reactive props](api.md#reactive-props).

### `session.create()` requires an allowed `Origin`

On a `POST`, `PUT`, `PATCH` or `DELETE` request, `context.session.create()` only creates the session if the request's `Origin` has already been checked (with the new `origin: "required"` option in `defineApiRoute` and `defineRpc`, or in an authenticated mutation passing Origin and CSRF) or is allowed at that moment. If missing or disallowed, it rejects with `403 INVALID_ORIGIN` without touching the store or sending the cookie. Until `1.1`, a login route without its own check let another website log the victim's browser into an attacker's account.

Browsers send `Origin` on every `POST` request, so login from the application itself is unchanged. What to review:

- **Scripts, tests and native apps** logging in without the `Origin` header, for example a test using `fetch` or `request.post` against `/api/auth/login`: they receive `403`. Send the application's `Origin` (the request's, `MEEKO_PUBLIC_ORIGIN` or one from `SessionManager({ allowedOrigins })`).
- **`origin: "none"`** on the route disables the check. It is **unsafe**: it exposes the route to _login CSRF_, so only use it if the request proves in another way that it does not come from another website (for example, through an app secret the browser does not have). In development, the first rejection writes a warning with both alternatives.
- `GET`, `HEAD` and `OPTIONS` are not checked: OAuth callbacks and magic links keep working and must validate their own `state` or single-use token.
- A manually constructed `SessionHandle`, without `SessionManager.load`, creates the session as before.

Also declare `origin: "required"` on login routes: it requires `Origin` before validating input and executing the handler.

```ts
// server/api/auth/login.post.ts
export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  handler: async ({ body, context }) => {
    // …
    await context.session.create({ user: body.username });
    return { ok: true as const };
  },
});
```

See [Origin in anonymous mutations](framework.md#origin-in-anonymous-mutations).

## Environment variables

### `MEEKO_` prefix

All variables read by Meeko start with `MEEKO_`. `MEEKO_HOST`, `MEEKO_PORT` and `MEEKO_PUBLIC_ORIGIN` replace `HOST`, `PORT` and `PUBLIC_ORIGIN` in `meeko dev`, `start` and `preview`, in Node, Bun and Deno outputs and in the Cloudflare Worker:

| Before          | Since `1.2`           | Status of the previous name                                                                                                 |
| --------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `HOST`          | `MEEKO_HOST`          | Deprecated: read if `MEEKO_HOST` is absent, with one warning per process, and will stop being read in `2.0`.                |
| `PUBLIC_ORIGIN` | `MEEKO_PUBLIC_ORIGIN` | Deprecated, like `HOST`.                                                                                                    |
| `PORT`          | `MEEKO_PORT`          | Not deprecated: the permanent fallback for `MEEKO_PORT`, because platforms such as Coolify, Railway or Cloud Run inject it. |

Rename them in the deployment environment, Dockerfiles and `vars` in `wrangler.jsonc`:

```jsonc
// Before
"vars": { "PUBLIC_ORIGIN": "https://mi-app.example" }

// After
"vars": { "MEEKO_PUBLIC_ORIGIN": "https://mi-app.example" }
```

The warning for an old name is `[meeko] La variable HOST está obsoleta desde Meeko 1.2; usa MEEKO_HOST. HOST dejará de leerse en Meeko 2.0.` The `MEEKO_` prefix is reserved for Meeko: application variables must use another name. See [Environment variables and `.env`](framework.md#environment-variables-and-env).

### Project `.env`

`meeko dev`, `build`, `start`, `preview` and `check` load the project root's `.env` into `process.env`. A variable already defined in the environment takes precedence, and `meeko build` output run directly (`node .meeko/output/node/index.mjs`, a container) does not read `.env`. If the root `.env` contains values not intended for these commands, such as a `PORT` or `MEEKO_*` for another purpose, they now apply: review it. Changing `.env` requires restarting `meeko dev`.

### Available port in `meeko dev`

Without `MEEKO_PORT`, `PORT` or `server.port`, `meeko dev` uses the first free port from `4173` (up to `4192`) and reports the change. An occupied fixed port exits with a message naming it. If a script expected a second `meeko dev` to fail on `4173`, set the port explicitly.

## Type checking

### `Bundler` module resolution

`meeko check`, the editor and Meeko-generated `tsconfig` files use `"module": "ESNext"` and `"moduleResolution": "Bundler"` instead of `NodeNext`, like Vite and Nuxt: relative imports no longer need `.js` (`import { format } from "../utils/format"`). Imports with `.js` keep working, so nothing needs changing. `meeko init-framework` generates the new `tsconfig.json`; in an existing project, change its two lines so the editor also accepts extensionless imports in `.ts` files:

```jsonc
// tsconfig.json
"module": "ESNext",           // before "NodeNext"
"moduleResolution": "Bundler" // before "NodeNext"
```

### Warnings in `meeko check`

`MEEK101` is the first warning diagnostic: it is displayed but does not fail `meeko check` or `meeko build`, and the exit code is only `1` for errors. In the API, `CompileDiagnostic` gains `severity: "warning"` and `CompileResult` gains `warnings`. Output from `meeko check --json` includes warnings with `severity: "warning"`: if a tool treated every item as an error, make it filter by that field.

### Typed events by element

On an HTML or SVG element, the `on:evento` handler receives the event type for that name and `event.currentTarget` has the tag's element type. A handler valid in `1.1` remains valid; only an explicit cast to another element (`event.currentTarget as HTMLSelectElement` on an `<input>`) may now produce a type error. Remove the cast, which is no longer needed.

### New auto-imports

`definePage`, `defineRouteMiddleware` and `definePlugin` are auto-imported, and in `server/` and `<script server>`, so are `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime` and `ApiError`. Explicit imports keep working and take precedence, so removing them is optional. Types from `app/types` are also auto-imported.

If the application exports a symbol with one of these names from an auto-import directory (for example, its own `ApiError` in `server/utils`) and uses it without an import, the name becomes ambiguous and the build fails with `Autoimport ambiguo`: import it explicitly or rename it. Only `useRoute`, `useForm`, `useStorage`, `useApiMutation`, `useHead` and `useSeoMeta` yield to your own export.

## Template and components

### `<MeekoOutlet />` and `<MeekoLink>`

Two built-in tags recognized by the compiler without imports. Adoption is optional: `<component is="props.outlet">` and `<a bind:href="href(...)">` keep working.

```html
<!-- Before: app/layouts/default.meeko -->
<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
</script>
<template>
  <a bind:href="href('/about')">About</a>
  <main><component is="props.outlet"></component></main>
</template>

<!-- After -->
<template>
  <MeekoLink to="/about">About</MeekoLink>
  <main><MeekoOutlet /></main>
</template>
```

`<MeekoOutlet />` is only valid in `app/app.meeko` and layouts, without attributes or content (`MEEK104`). `<MeekoLink>` requires `bind:params` on dynamic routes (`<MeekoLink to="/users/[id]" bind:params="{ id: user.id }">`), does not accept `href` or `bind:href` (`MEEK105`) and adds `aria-current="page"` on the active route. The names `MeekoLink` and `MeekoOutlet` are reserved: if the application had a component with either name, the compiler uses the built-in tag; rename the component. See [`<MeekoOutlet />` and `<MeekoLink>`](framework.md#meekooutlet--and-meekolink).

## Document HTML

These changes do not affect an application hydrating its own HTML; only tests, stylesheets or scripts reading server HTML.

- **One hydration marker per element.** Each element with bindings carries a single `data-meeko="N"` instead of an attribute per binding (`data-meeko-a-N`, `data-meeko-e-N`, `data-meeko-m-N` and `data-meeko-r-N`). These attributes are internal: tests should depend on content or your own attributes (`data-testid`) instead.
- **Managed head.** The title and tags managed by Meeko, including the route's `title` and `description`, go between comments `<!--meeko:head-->` and `<!--/meeko:head-->`, before `DocumentOptions.head` HTML, and CSRF meta follows `<meta charset>` and default tags (viewport and icon).
- **Static `<MeekoLink>`.** With a `to` without dynamic segments or `bind:params`/`bind:search`, SSR writes `href` directly.

## Document head

`document` in `meeko.config.ts`, `useHead` and `useSeoMeta` are new in `1.2` (see [Document head](framework.md#document-head-document-usehead-and-useseometa)). When adopting them, keep two rules in mind:

- **`titleTemplate` in `document.head` is a string.** `document.head` and modules' `meeko.addHead` are fixed at build time as JSON and also reach the browser, so their type, `DocumentHead`, does not accept a function: `meeko check` and the editor flag a type error on the `titleTemplate` line, and `meeko build` rejects it. `useHead` still accepts `(title) => string`.
- **The site title does not pass through the template.** The `title` in `document.head` is the site title: a page without its own title, or with an empty title, displays it unchanged, and the template only applies to titles from `app.meeko`, layouts, pages, `useHead` and the route's `head`.

```ts
// meeko.config.ts
export default defineMeekoConfig({
  document: {
    head: {
      title: "My store",            // an untitled page: “My store”
      titleTemplate: "%s · My store", // a page titled “Shoes”: “Shoes · My store”
    },
  },
});
```

If you tried the `1.2` development branch with a function in `document.head.titleTemplate`, replace it with a string, or move the function to a `useHead` in `app/app.meeko`.

## Server and sessions

### Sessions without configuration: optional `server/runtime.ts`

A `server/runtime.ts` returning `sessions` keeps working unchanged, and its `sessions` always take precedence. The new behavior is that the file is optional: without it, or if it does not return `sessions`, Meeko creates in-memory sessions during development and, in production (Node, Bun and Deno), Redis sessions with `MEEKO_REDIS_URL`. `ServerRuntime.sessions` becomes optional.

To switch to zero-configuration sessions:

1. Install the `redis` client in the application (`npm install redis`): the build only includes it if installed.
2. Define `MEEKO_REDIS_URL` (`redis://` or `rediss://`) and, if needed, `MEEKO_REDIS_PREFIX` (default `meeko:<name de package.json>:prod:`), `MEEKO_SESSION_TTL` and `MEEKO_SESSION_SAMESITE`.
3. Remove `sessions` from `server/runtime.ts`, or the whole file if it does nothing else.

Existing session keys depend on the prefix: to preserve them, use the same prefix as your `RedisSessionStore`. Production still refuses to start without a persistent store, as in `1.1`. Workers has no TCP: declare a `SessionManager` with D1 or Upstash. If you declare your own `sessions`, `MEEKO_SESSION_*` variables do not apply and Meeko warns once. A custom host calling `createServerApp` without `sessions` must pass `loadRedis` to use `MEEKO_REDIS_URL` (otherwise startup fails asking for the `redis` package) and `appName` for the default prefix (otherwise `meeko:app:prod:`); Meeko's generated entry point already passes them. See [Zero-configuration sessions](framework.md#sessions-without-configuration).

### Passwords, `rateLimit` and `MeekoSession`

These are optional and do not change anything by themselves; they replace code many applications wrote manually:

- **`@meekojs/meeko/password`**: `hashPassword`, `verifyPassword` and `needsRehash` with scrypt, and `meeko auth hash` to get a hash without writing code. `verifyPassword` accepts previously hand-written hashes in the `scrypt$<N>$<r>$<p>$<sal>$<hash>` format without regenerating them. Imports `node:crypto`: works on Node, Bun and Deno, not Workers. See [Passwords](framework.md#passwords).
- **`rateLimit: { limit, window, key? }`** in `defineApiRoute` and `defineRpc` returns `429 RATE_LIMITED` with `Retry-After`. Behind a proxy, define `MEEKO_TRUST_PROXY` to count by client IP. Your own `SessionStore` can implement optional `rateLimit`; without it, counters live in each instance's memory. See [Rate limiting](framework.md#rate-limiting-ratelimit).
- **`MeekoSession`**: module augmentation of `@meekojs/meeko/server` types `context.session.current.data` and `session.create(data)` throughout the application and lets you remove `as` casts. Without it, data remains `unknown`. See [Session types](framework.md#session-types-meekosession).

### `400` responses and mutation status

- `400` responses from `INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` and `INVALID_INPUT` add `issues: [{ path, message }]` with schema messages. A custom client strictly validating error bodies must accept that field.
- In `useRpcMutation` and `useApiMutation`, every submission clears `error` at the start, and `discard()` clears it too. If your UI displayed the previous error while retrying, it now disappears on submission.

## Configuration and build

### Layer folders in `modules`

`modules` is now for `defineMeekoModule` modules. A directory with `app/pages` listed in `modules` keeps working as a layer during `1.x`, with one warning per process in `meeko dev`, `meeko build` and `meeko check`. Move it to `layers` (`extends` remains an alias of `layers`, without warnings):

```ts
// Before
export default defineMeekoConfig({ modules: ["./modules/auth"] });

// After
export default defineMeekoConfig({ layers: ["./modules/auth"] });
```

If that directory has a `package.json` with an entry point or an `index.ts` (or `.mts`, `.js`, `.mjs`) at its root, Meeko loads it as a module rather than a layer: move it to `layers` before updating. See [Directories in `modules`](framework.md#folders-in-modules-deprecated).

### Dynamic segments in `api.*`

`api.users.byId.get({ params: { id } })` is deprecated and will be removed in `2.0`; the editor strikes it through. Replace it by calling the segment: `api.users({ id }).get()`. `useApi` is unchanged. The manifest now rejects, naming the conflicting routes, a static directory or file with the same name as its level's dynamic segment (`server/api/users/byId/` alongside `users/[id]`), and two parameters differing only in their initial letter's case (`[id]` and `[Id]`): rename one. See [Dynamic segments in `api.*`](framework.md#dynamic-segments-in-api).

### Component CSS

A component's `<style>` CSS is now the module `Componente.meeko?meeko-style=<hash>&lang.css`, alongside the component file, instead of a virtual module with an ID starting with a null byte (`\0virtual:meeko-style:…`). This lets PostCSS plugins resolve `@reference` and relative `@import` paths from the component's directory, as Tailwind 4 does with `@apply`. The ID is internal ([outside the contract](stability.md#outside-the-contract)), but a Vite plugin recognizing the old prefix must recognize the `meeko-style` query, and one filtering by `.meeko` may also receive these CSS modules.

To generate utilities with TypeScript, the new `@meekojs/meeko/postcss` provides the `meekoUtilities()` plugin and `@utilities` at-rule, which goes before `@tailwindcss/postcss`. It is optional. See [TypeScript-generated utilities](framework.md#generated-utilities-with-typescript).

### Prerendering errors

A page throwing during `meeko build` or `meeko prerender` prerendering still fails the build, but the message is no longer `Prerender <url> returned HTTP 500 instead of HTML 200`: it is `Prerender <url> (<archivo de la ruta>) failed:` followed by the error with its stack and `cause` chain. `prerenderRoutes` does the same when its `handler` rejects, with the original error in `cause`. If a script searched for the old text, make it use the exit code. Production requests are unchanged: the default observer still logs only the error name and request ID.

## Editor

VS Code extension `1.2.0` needs the Meeko `1.2` language server for HTML, CSS and directive completion. Visible changes:

- The `reactive` modifier no longer italicizes expressions reading a reactive value. To restore it, add `"*.reactive": { "italic": true }` to `rules` in `editor.semanticTokenColorCustomizations`.
- `editor.linkedEditing` is enabled by default in `.meeko` files: opening and closing tags are renamed together. Tags close when typing `>` or `</`; `meeko.autoClosingTags` disables this.
- Control directives, events and Meeko built-in tags have new colors.
