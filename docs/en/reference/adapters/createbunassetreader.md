---
title: createBunAssetReader
group: adapters
since: 1.0.0
description: Serves only build files listed in the asset manifest through Bun.file, with ETag, HEAD, 304 and Meeko's cache policy.
symbols:
  - "@meekojs/meeko/bun#createBunAssetReader"
types:
  - "@meekojs/meeko/bun#BunAssetReaderOptions"
  - "@meekojs/meeko/server#AssetReader"
related:
  - "@meekojs/meeko/bun#createBunServer"
  - "@meekojs/meeko/node#createNodeAssetReader"
  - "@meekojs/meeko/deno#createDenoAssetReader"
  - docs/framework.md#bun
source-hash: 22725a7b10264089f762a83449b4f4e7fad0bf217a4f8f8179b867f9f5370186
---

`createBunAssetReader({ root, assets })` is Bun's public file reader. Like the Node reader, it only responds to paths in the build's asset manifest and returns `null` for all others, which are never looked up on disk; the difference is that it reads with `Bun.file`, which Bun sends without going through JavaScript.

## Usage

<!-- no-check -->

```ts
import { createServerApp } from "@meekojs/meeko/server";
import { createBunAssetReader } from "@meekojs/meeko/bun";

const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createBunAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
});
```

## Parameters

| Option   | Type            | Description                                                                                                               |
| -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `root`   | `string \| URL` | Folder containing the manifest files, as a path or `file:` URL. In the Bun output, `new URL("client/", import.meta.url)`. |
| `assets` | `AssetManifest` | The public paths with their `type`, `etag`, `size` and `immutable`.                                                       |

## Return value

An `AssetReader` with `get(pathname, request)`: `null` for a path not in `assets` or a method other than `GET` and `HEAD`; `304` if `If-None-Match` matches; `200` with `content-type`, `ETag`, `content-length` and `cache-control` (`public, max-age=31536000, immutable` for Vite's hashed files, `public, max-age=0, must-revalidate` for the rest).

## Examples

### Test the reader in Bun

<!-- no-check -->

```ts
// bun test assets.test.ts
import { expect, test } from "bun:test";
import { createBunAssetReader } from "@meekojs/meeko/bun";

test("sólo sirve lo que está en el manifiesto", async () => {
  const assets = createBunAssetReader({ root: new URL("./fixtures/client/", import.meta.url), assets: { "/robots.txt": { type: "text/plain", etag: '"r1"', size: 25 } } });
  expect((await assets.get("/robots.txt", new Request("http://x/robots.txt")))?.status).toBe(200);
  expect(await assets.get("/../package.json", new Request("http://x/../package.json"))).toBeNull();
});
```

### A cache in front of Bun

```text
GET /assets/entry-4f2a.js  → 200, cache-control: public, max-age=31536000, immutable
GET /assets/entry-4f2a.js  If-None-Match: "…" → 304 sin leer el archivo
```

## Common mistakes

### Run it in Node

```ts bad
// node server.mjs
await createBunAssetReader({ root, assets }).get("/robots.txt", request);
```

The first read throws `Error: The Meeko Bun adapter requires the Bun runtime`. In Node, use `createNodeAssetReader`.

<!-- no-check -->

```ts good
import { createNodeAssetReader } from "@meekojs/meeko/node";
const assets = createNodeAssetReader({ root: fileURLToPath(new URL("./client/", import.meta.url)), assets: manifest.assets ?? {} });
```

### A manifest file missing from the folder

```text bad
.meeko/output/bun/ copiada sin client/assets/
```

A request for a listed file rejects with `Error: Missing build asset /assets/entry-4f2a.js`, which the application converts to `500` and sends to `onError`. Copy the complete output folder.

```text good
.meeko/output/bun/ completa: index.js, chunks/, client/ y prerender/
```

## Notes

- **Security.** Paths are looked up in the manifest without decoding: no traversal matches.
- **`HEAD` and `304`.** They do not open the file.
- **Bun only.** Importing `@meekojs/meeko/bun` in Node does not fail; reading a file does.
