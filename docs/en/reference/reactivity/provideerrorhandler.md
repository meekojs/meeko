---
title: provideErrorHandler
group: reactivity
since: 1.0.0
description: Registers the browser failure observer for a component and its entire branch, with each failure's source.
symbols:
  - "@meekojs/meeko#provideErrorHandler"
types:
  - "@meekojs/meeko#ComponentErrorHandler"
  - "@meekojs/meeko#ErrorSource"
related:
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/framework#mountClientApp"
  - docs/framework.md#errores
  - docs/framework.md#fallos-globales-del-navegador
source-hash: e490df7b38e406283c58cc020af3317e96d4775173cfbe194f3aa5389dbbca2e
---

In the browser, many failures happen outside any `try`: an asynchronous `on:click` handler rejects, `onMounted` throws, a late-mounted component reloads, a Socket channel drops. `provideErrorHandler(handler)` registers who receives these failures: the calling component and all its descendants, except those registering their own observer. `handler` receives the error and its source (`ErrorSource`), to show an alert, send it to a monitoring service or both.

Without an observer, the failure goes to `mountClientApp`'s `onError` or, if absent too, the console. It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```html
<!-- app/app.meeko -->
<script lang="ts">
const failure = signal<string | null>(null);
provideErrorHandler((error, source) => {
  failure.value = error instanceof Error ? error.message : String(error);
  console.error(`[${source}]`, error);
});
</script>

<template>
  <p if:when="failure.value" role="alert">Algo falló: {failure.value}</p>
  <div class="site-root"><MeekoOutlet /></div>
</template>
```

A rejecting handler on any page leaves the message in the alert, instead of an unhandled rejection.

## Parameters

| Parameter | Type                                            | Default  | Description                                                                                                                                                                     |
| --------- | ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler` | `(error: unknown, source: ErrorSource) => void` | required | Receives each branch failure. `error` is `unknown`: check it before reading its properties. A failure inside `handler` itself is written to the console alongside the original. |

`source` tells you where the failure was observed:

| Source                      | Origin                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `"event"`                   | An `on:` handler (synchronous or its returned promise), a mutation's `onSuccess`/`onError` notification or an unexpected `useForm` error. |
| `"effect"`                  | A promise mistakenly returned by an `effect`.                                                                                             |
| `"cleanup"`                 | A promise mistakenly returned by cleanup.                                                                                                 |
| `"mounted"`                 | `onMounted`, the continuation after a browser `await` or data for a late-mounted component (since `1.1`).                                 |
| `"navigation"`              | A failed client navigation.                                                                                                               |
| `"socket"`                  | A Socket client without its own `onError`.                                                                                                |
| `"uncaught"`, `"rejection"` | Since `1.3`, in a mounted application: unhandled exceptions and promises from code not passing through Meeko (a `setTimeout`, a library). |

## Return value

`void`. Without an active component it throws `Error: provide() requires an active component root`, because it provides the observer through [`provide`](/en/docs/reference/provide).

## Examples

### An alert per section

A branch can have its own observer; failures inside no longer propagate to the application's observer.

```html
<!-- app/components/CheckoutPanel.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
const problem = signal("");
provideErrorHandler((error) => {
  problem.value = isClientError(error) ? "El servidor rechazó el pago." : "No se pudo conectar. Inténtalo de nuevo.";
});
</script>

<template>
  <section>
    <p if:when="problem.value" role="alert">{problem.value}</p>
    <render snippet="snippets.default" />
  </section>
</template>
```

### Send to a monitoring service

```ts
// app/composables/report.ts
import type { ComponentErrorHandler } from "@meekojs/meeko";

export const reportError: ComponentErrorHandler = (error, source) => {
  const message = error instanceof Error ? error.message : String(error);
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, source, path: location.pathname }),
    keepalive: true,
  });
};
```

```html
<script lang="ts">
provideErrorHandler(reportError);
</script>
```

### A `switch` on the source

`ErrorSource` may gain members in a minor version: a `switch` needs a default branch.

```ts
import type { ErrorSource } from "@meekojs/meeko";

function label(source: ErrorSource): string {
  switch (source) {
    case "navigation": return "No se pudo abrir la página";
    case "socket": return "Conexión perdida";
    default: return "Algo falló";
  }
}
```

## Common mistakes

### Read `error.message` without checking its type

```ts bad
provideErrorHandler((error) => console.log(error.message));
```

`meeko check` reports `TS18046: 'error' is of type 'unknown'`: any value can be thrown, not just an `Error`.

<!-- no-check -->

```ts good
provideErrorHandler((error) => console.log(error instanceof Error ? error.message : String(error)));
```

### Expect it to catch render failures

The observer receives failures **after** mounting: events, `onMounted`, navigation, Socket. An error thrown by the script or template during rendering or hydration fails that render and is shown by the error page.

```html bad
<script lang="ts">
const props = defineProps<{ items: { name: string }[] }>();
provideErrorHandler(() => { /* no se llama */ });
const first = props.items[0]!.name; // con una lista vacía: TypeError en el render
</script>
```

Handle potentially missing data in the script; for a page that can fail, use `+error.meeko` or `app/error.meeko`:

<!-- no-check -->

```ts good
const first = computed(() => props.items[0]?.name ?? "Sin elementos");
```

### Call it outside a component

```ts bad
// app/utils/errors.ts, evaluado al importar
provideErrorHandler(reportError);
```

Throws `Error: provide() requires an active component root`. Call it in a component's script (for the entire application, `app/app.meeko`), or use `mountClientApp`'s `onError` in a custom host.

```html good
<!-- app/app.meeko -->
<script lang="ts">
provideErrorHandler(reportError);
</script>
```

## Notes

- **Browser only.** SSR has no events or mounting: a server render failure responds with the error page and reaches the server observer, not this one.
- **Nearest observer.** The nearest ancestor's observer wins. A component with no observer in its branch only sends failures to the application's `onError` or the console, never another branch's observer.
- **Expected errors.** A `ClientError` (an expected server response, such as a `409`) also reaches here if nobody catches it; `useForm` handles it itself and only delivers unexpected failures.
- **No duplicates.** A failure already received by a Meeko observer is not reported again if it escapes to `window`.
- **Security.** The `error` may contain response or user data: do not render it with `html`, and filter what you send to an external service.
