---
source-hash: 1686ccb14734aa75a4fdc64bea49cdbdd01a86a9a9e440203b9335c7d4016b9f
title: createId
group: utils
since: 1.8.0
description: Generates cryptographic UUID v4 identifiers on server and browser from functions, handlers or modules.
symbols:
  - "@meekojs/meeko#createId"
related:
  - "@meekojs/meeko#useId"
---

`createId()` creates a new identifier without a component context. It works on server and browser. Meeko applications autoimport it; outside the framework, import it from `@meekojs/meeko`. Each call produces a different ID.

## Usage

```ts
import { createId } from '@meekojs/meeko'

function createItem(label: string) {
  return { id: createId(), label }
}

const items = ['Save', 'Cancel'].map(createItem)
```

`items` contains two objects with distinct UUID v4 IDs. In a framework application module, you may omit the import when using autoimports.

## Parameters

It takes no parameters. It needs neither a global counter nor a database.

## Return value

Returns a `string` containing a UUID v4 generated with Web Crypto. It uses `crypto.randomUUID()` or, when unavailable, `crypto.getRandomValues()`; never `Math.random()`.

## Examples

For an item created during SSR, generate the ID on the server and send it with serialized data. The browser must use that received value; calling `createId()` again would produce another ID.

```ts
import { createId } from '@meekojs/meeko'

const item = { id: createId(), label: 'Save' }
// Serialize item with the page data.
```

## Common mistakes

### Expecting the same ID on server and browser

Each call generates another UUID. Preserve the server ID in the serialized data.

```ts bad
const browserId = createId() // A new ID: it does not match the one from SSR.
```

```ts good
import { createId } from '@meekojs/meeko'

const serverItem = { id: createId() }
const payload = JSON.stringify(serverItem)
const browserItem = JSON.parse(payload) as typeof serverItem
const browserId = browserItem.id // The received ID, not a newly generated one.
```

- Using it for a DOM ID that must match across SSR and hydration: use `useId()` in component setup.
- Assuming mathematical uniqueness for persisted records: add a unique constraint in storage and retry on collision.

## Notes

It throws if the environment does not provide Web Crypto. Collisions are extremely unlikely but possible; the function does not inspect application storage.
