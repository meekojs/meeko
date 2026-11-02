---
title: createNodeAssetReader
group: adapters
since: 1.0.0
description: Serves only build files listed in the asset manifest from disk on Node, using streaming and Meeko's ETag, HEAD, 304 and cache policy.
symbols:
  - "@meekojs/meeko/node#createNodeAssetReader"
types:
  - "@meekojs/meeko/node#NodeAssetReaderOptions"
  - "@meekojs/meeko/server#AssetReader"
  - "@meekojs/meeko/server#AssetManifest"
related:
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/bun#createBunAssetReader"
  - "@meekojs/meeko/deno#createDenoAssetReader"
  - "@meekojs/meeko/cloudflare#createCloudflareAssetReader"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#build-despliegue-y-verificación
source-hash: 18d55d0b8c5395ee434f3c26eda9be006a9c9bae88e9ab447cc717219fe99889
---

`createNodeAssetReader({ root, assets })` is the Node adapter's public file reader: the application asks it about each `pathname` and, if it is listed in `assets` (the manifest written by `meeko build`), it responds by streaming the file from `root`. Any other path returns `null` and **is never read from disk**: there is no way to request `../package.json`, `%2e%2e/…` or build files that are not public.

Each response carries `content-type`, `ETag`, `content-length` and the cache policy shared by all adapters; `HEAD` and a matching `If-None-Match` (`304`) do not open the file.

## Usage

<!-- no-check -->

```ts
// .meeko/output/node/index.mjs (lo que genera meeko build, simplificado)
import { fileURLToPath } from "node:url";
import { createServerApp } from "@meekojs/meeko/server";
import { createNodeAssetReader } from "@meekojs/meeko/node";

const root = fileURLToPath(new URL("./client/", import.meta.url));
const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createNodeAssetReader({ root, assets: manifest.assets ?? {} }),
});
```

## Parameters

| Option   | Type            | Description                                                                 |
| -------- | --------------- | --------------------------------------------------------------------------- |
| `root`   | `string`        | Folder containing the manifest's files: the client build output, `client/`. |
| `assets` | `AssetManifest` | Public URL paths with their `type`, `etag`, `size` and `immutable`.         |

The keys of `assets` are paths as serialized by the WHATWG URL: `public/logo@2x.png` is `/logo@2x.png`, `a b.txt` is `/a%20b.txt`.

## Return value

An `AssetReader` with `get(pathname, request)`:

| Request                                                    | Response                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Path not in `assets`, or method other than `GET` or `HEAD` | `null`: the request continues to the application.                |
| `HEAD`                                                     | `200` without a body, with headers.                              |
| `If-None-Match` equals the `ETag`                          | `304` without a body.                                            |
| Vite-hashed file (`immutable`)                             | `200` with `cache-control: public, max-age=31536000, immutable`. |
| Everything else (`public/`, including `public/assets/`)    | `200` with `cache-control: public, max-age=0, must-revalidate`.  |

## Examples

### Checking with `curl`

```sh
curl -sI http://127.0.0.1:4173/robots.txt
# HTTP/1.1 200 OK
# content-type: text/plain; charset=utf-8
# etag: "…"
# cache-control: public, max-age=0, must-revalidate

curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4173/../package.json   # 404
```

### Your own reader for a calculated file

`createServerApp` accepts any `AssetReader`. To serve a file that is not in the build, compose a reader:

<!-- no-check -->

```ts
import type { AssetReader } from "@meekojs/meeko/server";

const files = createNodeAssetReader({ root, assets: manifest.assets ?? {} });
const assets: AssetReader = {
  async get(pathname, request) {
    if (pathname === "/version.txt") return new Response(process.env.GIT_SHA ?? "dev", { headers: { "content-type": "text/plain" } });
    return files.get(pathname, request);
  },
};
```

### Files behind a CDN

```text
/assets/*   → cache-control: public, max-age=31536000, immutable  (hash en el nombre: el CDN los guarda un año)
/favicon.svg → cache-control: public, max-age=0, must-revalidate   (el CDN revalida con ETag)
```

## Common mistakes

### Copying files to `client/` after the build

```text bad
cp extra/terms.pdf .meeko/output/node/client/terms.pdf
```

It is not in the manifest: `/terms.pdf` is never served, and the request reaches the application (a `404`). Put it in `public/` and build again.

```text good
public/terms.pdf  →  npm run build  →  /terms.pdf
```

### Reading disk files manually in a route

```ts bad
// server/api/files/[name].get.ts
handler: async ({ params }) => new Response(await readFile(`./uploads/${params.name}`)),
```

`params.name` could be `..%2f.env`: path traversal. The asset reader only serves manifest keys; for user files, validate the name with a schema and resolve the path within its folder.

<!-- no-check -->

```ts good
params: v.object({ name: v.pipe(v.string(), v.regex(/^[\w-]+\.pdf$/)) }),
handler: async ({ params }) => new Response(await readFile(join(uploads, params.name))),
```

## Notes

- **Security.** The path is looked up in the manifest without decoding, so no form of traversal (`..`, `%2e%2e`, `%2f`, `%5c`) matches; the conformance suite tests this on Node, Bun, Deno and Workers.
- **Before middleware.** Public files are served before `server/middleware`; `server.headers` (since `1.7`) does apply to them, except headers they already carry, such as `Cache-Control`.
- **Streaming.** The file opens only for a `200` with a body and is sent with `createReadStream`; if the client leaves, the stream is canceled.
- **Other runtimes.** Bun, Deno and Workers have their own readers with the same behavior: `createBunAssetReader`, `createDenoAssetReader` and `createCloudflareAssetReader`.
