---
title: createDenoAssetReader
group: adapters
since: 1.0.0
description: Streams only build files listed in the asset manifest using Deno.open, with ETag, HEAD, 304 and Meeko's cache policy.
symbols:
  - "@meekojs/meeko/deno#createDenoAssetReader"
types:
  - "@meekojs/meeko/deno#DenoAssetReaderOptions"
  - "@meekojs/meeko/server#AssetReader"
related:
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/node#createNodeAssetReader"
  - "@meekojs/meeko/bun#createBunAssetReader"
  - docs/framework.md#deno
source-hash: baccc90e9581537c148ca48942e726b9c06dc14092d0ded8f5b573ca8e996db6
---

`createDenoAssetReader({ root, assets })` is Deno's public file reader: it responds only to paths in the build's asset manifest, opening the file with `Deno.open` and streaming it, and returns `null` for all others, which are never looked up on disk. Headers, `HEAD`, `304` and the cache policy are shared by all adapters.

## Usage

<!-- no-check -->

```ts
import { createServerApp } from "@meekojs/meeko/server";
import { createDenoAssetReader, serveDeno } from "@meekojs/meeko/deno";

const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createDenoAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
});
await serveDeno(app, { handleSignals: true });
```

## Parameters

| Option   | Type            | Description                                                       |
| -------- | --------------- | ----------------------------------------------------------------- |
| `root`   | `string \| URL` | Folder containing the manifest's files, as a path or `file:` URL. |
| `assets` | `AssetManifest` | Public paths with their `type`, `etag`, `size` and `immutable`.   |

## Return value

An `AssetReader` with `get(pathname, request)`: `null` for a path absent from `assets` or a method other than `GET` and `HEAD`; `304` if `If-None-Match` matches, without opening the file; `200` with the file body, `content-type`, `ETag`, `content-length` and `cache-control` (`immutable` for one year for hashed files, `max-age=0, must-revalidate` for the rest).

## Examples

### Restricted read permissions

```sh
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

The reader only opens files under `root`, so allowing reads of the output folder is enough.

### Stream a large file

```text
GET /downloads/catalogo.pdf → 200, content-length: 18874368, the body is file.readable
```

If the client leaves, the stream is canceled and the file is closed.

## Common mistakes

### Read permissions for a different folder

```sh bad
deno run --allow-net --allow-env --allow-read=./public .meeko/output/deno/main.js
```

The first request for a listed file fails with Deno's permission error when opening it, and the application responds with `500` and sends it to `onError`.

```sh good
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

### Run it in Node

```ts bad
await createDenoAssetReader({ root, assets }).get("/robots.txt", request); // in Node
```

`Error: The Meeko Deno adapter requires the Deno runtime`. In Node, use `createNodeAssetReader`.

<!-- no-check -->

```ts good
const assets = createNodeAssetReader({ root: fileURLToPath(new URL("./client/", import.meta.url)), assets: manifest.assets ?? {} });
```

## Notes

- **Security.** Paths are looked up in the manifest without decoding: no traversal matches, and the key comes from the build, never from the request.
- **Deno only.** Importing `@meekojs/meeko/deno` in another runtime does not fail; reading a file does.
