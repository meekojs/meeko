---
title: createCloudflarePrerenderSource
group: adapters
since: 1.0.0
description: A Worker's prerendered pages, read from the Static Assets binding once per isolate, with their navigation payload and CSP hashes.
symbols:
  - "@meekojs/meeko/cloudflare#createCloudflarePrerenderSource"
types:
  - "@meekojs/meeko/cloudflare#CloudflarePrerenderSourceOptions"
  - "@meekojs/meeko/server#PrerenderSource"
related:
  - "@meekojs/meeko/cloudflare#createWorker"
  - "@meekojs/meeko/cloudflare#createCloudflareAssetReader"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#cloudflare-workers
  - docs/framework.md#modos-de-render
source-hash: 19ecab564ffd76d8c390872fd3f188a8f611be86e3115942a6f3bfc326d2d865
---

`createCloudflarePrerenderSource({ binding, directory })` is the Workers `PrerenderSource`: when a request asks for a page with `render: "prerender"`, the application queries it by `pathname` and the source reads the HTML, CSRF meta insertion offset, `ETag`, navigation payload and, since `1.3` and `1.4`, script and style hashes from the assets binding. The index (`manifest.json`) and each page are read once per isolate.

Pages live in `assets/_meeko/prerender/` but are never served as files: the application returns them as documents, with the session's CSRF meta, CSP and page headers.

## Usage

<!-- no-check -->

```ts
import { createCloudflareAssetReader, createCloudflarePrerenderSource, createWorker } from "@meekojs/meeko/cloudflare";

export default createWorker(({ env, platform }) => createApp({
  production: true,
  platform,
  assets: createCloudflareAssetReader({ binding: env.ASSETS, assets: manifest.assets ?? {} }),
  prerender: createCloudflarePrerenderSource({ binding: env.ASSETS }),
}));
```

## Parameters

| Option      | Type                      | Default                | Description                                                                      |
| ----------- | ------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `binding`   | `CloudflareAssetsBinding` | required               | The Static Assets binding.                                                       |
| `directory` | `string`                  | `"/_meeko/prerender/"` | Asset folder containing `manifest.json` and the pages; starts and ends with `/`. |

## Return value

A `PrerenderSource` with `get(pathname)`, which resolves to:

- `undefined` if the index does not list the route (or there is no index: an application without prerendered pages);
- `{ html, headOffset, etag, payload?, scriptHashes?, styleHashes? }` if it does.

A failed read is not cached: the next request retries it.

## Examples

### A prerendered page in Workers

```ts
// app/pages/precios.route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender", head: () => ({ title: "Precios" }) });
```

`meeko build --adapter cloudflare` renders it in Node and writes it to `assets/_meeko/prerender/`. In production:

```text
GET /precios (sin sesión) → el HTML del build, ETag, cache-control: public, max-age=0, must-revalidate
GET /precios (con sesión) → el mismo HTML con <meta name="meeko-csrf-token">, cache-control: private, no-store
```

### CSP with hashes (since 1.7)

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: { adapter: "cloudflare", contentSecurityPolicy: { "default-src": ["'self'"], "script-src": ["'self'"], "object-src": ["'none'"] } },
});
```

The `/precios` response carries the policy with the index's `scriptHashes` and `styleHashes`, without a nonce, and still responds with `304` to an `If-None-Match`.

## Common mistakes

### A folder without a trailing `/`

```ts bad
createCloudflarePrerenderSource({ binding: env.ASSETS, directory: "/_meeko/prerender" });
```

`TypeError: Prerender directory must start and end with /`, when creating the application.

<!-- no-check -->

```ts good
createCloudflarePrerenderSource({ binding: env.ASSETS, directory: "/_meeko/prerender/" });
```

### An index listing a page that was not uploaded

```text bad
assets/_meeko/prerender/manifest.json desplegado sin assets/_meeko/prerender/precios/index.html
```

The `/precios` request responds with `500` and `onError` receives `Error: Missing prerendered file /_meeko/prerender/…`. Deploy the complete output.

```sh good
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

## Notes

- **Once per isolate.** The index and each page are stored in isolate memory after the first read; a new deployment creates new isolates.
- **No TCP or disk.** Everything is read through the `ASSETS` binding.
- **Security.** Paths are only looked up in the index; the filename comes from the index, never the request.
- **Session.** The prerendered HTML is the same for everyone: Meeko inserts each session's CSRF meta at `headOffset` and marks the response as `private, no-store`.
