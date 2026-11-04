---
title: serializeJson
group: utils
since: 1.0.0
description: Serializes a value into JSON safe to insert in a script tag, checking faithful representation and escaping anything that could close the tag.
symbols:
  - "@meekojs/meeko#serializeJson"
related:
  - "@meekojs/meeko/framework#definePage"
  - "syntax:script-server"
  - "@meekojs/meeko/framework#useState"
  - docs/api.md#módulo-generado
source-hash: 456361517fcb7eff831e805f1be163ecdb3189a8da2950356888b6c95f68640e
---

`serializeJson(valor)` converts a value to JSON to send it to the browser inside a `<script>` tag. It does two things that `JSON.stringify` does not:

- **Checks** that the value is faithfully represented in JSON and throws `TypeError` otherwise: it rejects `undefined`, functions, `bigint`, symbols, non-finite numbers, cycles, accessors, custom `toJSON`, sparse arrays and class instances such as `Date` or `Map`, with the value's path.
- **Escapes** `<`, `>`, `&`, U+2028 and U+2029, so the result cannot close the `<script>` tag or break the surrounding JavaScript.

This is the function Meeko uses to send page payloads, `<script server>` data and SSR state. You need it if you write your own host or insert data into a document by hand.

## Usage

```ts
import { serializeJson } from "@meekojs/meeko";

const state = { user: { name: "Ana" }, note: "</script><script>alert(1)</script>" };
const html = `<script type="application/json" id="state">${serializeJson(state)}</script>`;
// …"note":"</script><script>alert(1)</script>"…
```

In the browser, `JSON.parse(document.getElementById("state")!.textContent!)` returns the same object.

## Parameters

| Parameter | Type      | Default  | Description                                                                                                                                        |
| --------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`   | `unknown` | required | A JSON value: `null`, booleans, strings, finite numbers, dense arrays and plain objects (`Object.prototype` or `null` prototype) with string keys. |

## Return value

The value's JSON as text, with `<`, `>` and `&` written as `<`, `>` and `&`, and U+2028 and U+2029 as ` ` and ` `. `JSON.parse` reads it just like ordinary JSON.

Throws `TypeError` with the path of the failing value:

| Value                            | Message                         |
| -------------------------------- | ------------------------------- |
| `{ when: new Date() }`           | `Non-plain object at $.when`    |
| `{ n: NaN }`                     | `Non-finite number at $.n`      |
| `{ u: undefined }`, `{ f() {} }` | `Non-serializable value at $.u` |
| `[1, , 3]`                       | `Sparse array at $[1]`          |
| An object that contains itself   | `Circular reference at $.self`  |

## Examples

### A component in a custom host

<!-- no-check -->

```ts
import { hydrate, renderWithState } from "./Counter.meeko";
import { serializeJson } from "@meekojs/meeko";

const props = { initial: 1 };
const { html, state } = renderWithState(props);
const page = `<div id="counter">${html}</div>
<script type="application/json" id="counter-state">${serializeJson({ props, state })}</script>`;
```

In the browser, the host reads that JSON and calls `hydrate(root, props, state)`.

### Prepare dates and maps before sending them

Convert what JSON cannot represent into types it can:

```ts
import { serializeJson } from "@meekojs/meeko";

const scores = new Map([["ana", 3], ["luis", 5]]);
const payload = {
  updatedAt: new Date("2026-10-29T10:00:00Z").toISOString(),
  scores: Object.fromEntries(scores),
};
const json = serializeJson(payload); // {"updatedAt":"2026-10-29T10:00:00.000Z","scores":{"ana":3,"luis":5}}
```

## Common mistakes

### Send a `Date`

```ts bad
serializeJson({ when: new Date() });
```

`TypeError: Non-plain object at $.when`. `JSON.stringify` would silently convert it into text, and the browser would receive a `string` where the type says `Date`.

<!-- no-check -->

```ts good
serializeJson({ when: new Date().toISOString() });
```

### `undefined` properties

```ts bad
serializeJson({ name: "Ana", email: undefined });
```

`TypeError: Non-serializable value at $.email`. Remove the key or use `null`.

<!-- no-check -->

```ts good
serializeJson({ name: "Ana", email: null });
```

### Insert `JSON.stringify` in a `<script>`

`JSON.stringify` does not escape `</script>`: user text can close the tag and inject code, without any error.

```ts bad
const html = `<script type="application/json">${JSON.stringify(data)}</script>`;
```

<!-- no-check -->

```ts good
const html = `<script type="application/json">${serializeJson(data)}</script>`;
```

## Notes

- **Security.** Escaping makes the result safe inside a `<script>` and in the text of an HTML document; do not use it for an attribute without escaping it as an attribute.
- **Page data.** Values returned by `load`, `<script server>` exports and SSR state signals pass through `serializeJson`: a rejected value produces `500` at runtime, and `meeko check` already flags it as a type error in page data.
- **Performance.** It traverses the value once to check it before `JSON.stringify`: for large payloads, send only what the page renders.
- **Package.** Exported from the root, `@meekojs/meeko`, without framework dependencies: it also works outside a Meeko application.
