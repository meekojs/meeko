---
source-hash: 4a0d52130a9797a845bedf13965ffbabd9926210347fd9db2bba3f2b41f88598
---

# Data and rendering

Each page chooses **where it gets data** and **when its HTML is generated**. This guide summarizes the usual decisions. Full contracts, limits and edge cases are in the [technical details](routing-data-reference.md).

## Application error page (`app/error.meeko`)

Use `app/error.meeko` for a `404` with no matching page and as a fallback when a page fails. A closer `+error.meeko` takes precedence. Both receive `status` and `message`. [See the edge cases](routing-data-reference.md#application-error-page-apperrormeeko).

## Page server code

Use `<script server lang="ts">` to load data before rendering. It runs on the server per request; only exported values reach the component. For a complete example, follow the [router tutorial](router.md#2-validate-and-load-data).

### Top-level code and exported data

This is the direct form: read `usePage()`, load data and export it. `redirect()` and `notFound()` stop the request when appropriate.

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
	const { params } = usePage()
	export const user = { id: params.id }
</script>
<template><h1>User {user.id}</h1></template>
```

[See execution, serialization and errors](routing-data-reference.md#top-level-code-and-exported-data).

### Route options with `definePage`

`definePage({ load })` is an alternative: it provides the result as `props.data`. Choose **`load` or top-level code** for a page's data; do not combine them. You can place options in a `*.route.ts` sidecar. [See options and contracts](routing-data-reference.md#route-options-with-definepage).

### Common rules

The server block and the component's `<script>` have different scopes. Server code can import `server/`; exported data must be serializable to reach the browser. `meeko check` verifies the page contract. [See restrictions and diagnostics](routing-data-reference.md#common-rules).

### Where each API is used

`usePage()`, `redirect()` and `notFound()` belong to the server code of an active page. Component APIs are used in its `<script>` and template. [See the full table](routing-data-reference.md#where-each-api-is-used).

## Rendering modes

| `render`        | When content is generated                         | Use it when                                              |
| --------------- | ------------------------------------------------- | -------------------------------------------------------- |
| `ssr` (default) | On the server, per request.                       | You need current data and initial HTML.                  |
| `stream`        | On the server; secondary values can arrive later. | Slow data should not delay the first response.           |
| `prerender`     | During the build.                                 | Pages can be generated before visitors arrive.           |
| `client`        | In the browser.                                   | The page can start without its data in the initial HTML. |

In `client`, the loader reaches the browser and cannot use secrets or server services. [See modes, prerendering and limits](routing-data-reference.md#rendering-modes).

## Streaming SSR (`render: "stream"`)

Use `defer()` for secondary data that can arrive after the initial HTML. Keep decisions about redirects, headers and indexable content in critical data. A proxy that buffers the whole response can cancel the benefit of streaming. [See protocol, cancellation and proxies](routing-data-reference.md#streaming-ssr-render-stream).

## SSR page caching

`definePage({ cache })` can revalidate public pages with `etag` and, when useful, store the rendered result in memory. It applies only to cacheable responses; requests with a session or `Authorization` do not reuse that copy. If HTML depends on your own cookies, include them in the version or avoid caching. [See options and exclusions](routing-data-reference.md#ssr-page-caching).
