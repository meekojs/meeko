---
title: contentSecurityPolicy
group: server
since: 1.3.0
description: Builds the Content-Security-Policy header from a directive-based policy and adds the hashes of a page's inline scripts and styles.
symbols:
  - "@meekojs/meeko/server#contentSecurityPolicy"
types:
  - "@meekojs/meeko/server#ContentSecurityPolicy"
related:
  - "config:server"
  - "@meekojs/meeko/build#inlineScriptHashes"
  - "@meekojs/meeko/build#inlineStyleHashes"
  - docs/framework.md#csp-con-hashes
  - docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
  - docs/framework.md#sitio-estático
source-hash: 3b52b585893cf20fe7042f527e09d7062dd900febabd5fadc3abd49838315fae
---

`contentSecurityPolicy(policy, scriptHashes?, styleHashes?)` writes the `Content-Security-Policy` header value from a directives object, adding SHA-256 hashes of inline `<script>` elements and, since `1.4`, inline `<style>` elements used by a page to the correct directive. It validates every directive name, source and hash, so a malformed policy fails when you build it, not in the browser.

Since `1.7` you rarely need to call it: with `server.contentSecurityPolicy` in `meeko.config.ts`, the `node`, `bun`, `deno` and `cloudflare` adapters set the header on every response themselves, with hashes or a nonce depending on response type (see [Notes](#notes)). It is the building block for your own host, a CDN or a deployment script.

## Usage

```ts
import { contentSecurityPolicy } from "@meekojs/meeko/server";

const header = contentSecurityPolicy(
  { "default-src": ["'self'"], "object-src": ["'none'"] },
  ["'sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8='"],
);
// "default-src 'self'; object-src 'none'; script-src 'self' 'sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8='"
```

Without `script-src`, hashes go into a copy of `default-src`, so the policy does not become more restrictive than it already was.

## Parameters

| Parameter      | Type                                                          | Default  | Description                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy`       | `ContentSecurityPolicy` (`Record<string, readonly string[]>`) | required | Each key is a lowercase directive (`"script-src"`) and its value is the source list as written (`"'self'"`, `"https://cdn.example"`). An empty list writes the directive alone, such as `upgrade-insecure-requests`.  |
| `scriptHashes` | `readonly string[]`                                           | `[]`     | Sources `'sha256-…'`, `'sha384-…'` or `'sha512-…'`, with quotes. Added to `script-src-elem` if present (since `1.7`), otherwise to `script-src` or a copy of `default-src`; without any of these, they are not added. |
| `styleHashes`  | `readonly string[]`                                           | `[]`     | Since `1.4`. The same for `<style>` elements: added to `style-src-elem` if present, otherwise to `style-src` or a copy of `default-src`. Never to a directive with `'unsafe-inline'`.                                 |

## Return value

The header text, with directives in `policy` order (those created from `default-src` at the end) and no duplicate sources.

Throws `TypeError` if a directive, source or hash is invalid (see [Common mistakes](#common-mistakes)).

## Examples

### CSP in server adapters (since 1.7)

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "node",
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // atributos style="…" de un resaltador
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "frame-ancestors": ["'none'"],
    },
  },
});
```

`meeko build` validates the policy with this same function and fixes it in the manifest; `meeko start` and Bun, Deno and Workers outputs complete it on every response.

### Your own host with prerendered pages

```ts
import { readFile } from "node:fs/promises";
import { contentSecurityPolicy } from "@meekojs/meeko/server";
import type { PrerenderIndex } from "@meekojs/meeko/build";

const index = JSON.parse(await readFile(".meeko/output/node/prerender/manifest.json", "utf8")) as PrerenderIndex;
const pages = Object.values(index.pages);
const scripts = [...new Set(pages.flatMap((page) => page.scriptHashes ?? []))];
const styles = [...new Set(pages.flatMap((page) => page.styleHashes ?? []))];
export const header = contentSecurityPolicy(
  { "default-src": ["'self'"], "style-src": ["'self'"], "object-src": ["'none'"] },
  scripts,
  styles,
);
```

### Hashes from any document

<!-- no-check -->

```ts
import { inlineScriptHashes, inlineStyleHashes } from "@meekojs/meeko/build";
import { contentSecurityPolicy } from "@meekojs/meeko/server";

const html = await (await fetch("http://127.0.0.1:4173/docs")).text();
const { hashes, unhashable } = inlineScriptHashes(html);
if (unhashable.length) throw new Error(`JavaScript que un hash no permite: ${unhashable.join(", ")}`);
const header = contentSecurityPolicy({ "default-src": ["'self'"] }, hashes, inlineStyleHashes(html));
```

`unhashable` lists `on*` attributes and `javascript:` URLs: no CSP without `'unsafe-inline'` allows them.

`inlineScriptHashes` reads the entire document, including content inside `#app`. If the page renders user content, an injected `<script>` would receive its hash: for Meeko pages, use `scriptHashes` and `styleHashes` from the prerender index, which since `1.7` cover only what Meeko writes outside the page.

## Common mistakes

### Unquoted or space-separated sources

```ts bad
contentSecurityPolicy({ "script-src": ["self https://cdn.example"] });
```

`TypeError: contentSecurityPolicy: invalid source "self https://cdn.example" in script-src`. Each source is one item, and keywords require single quotes. In `meeko.config.ts`, `meeko dev`, `meeko build` and `meeko check` stop with `meeko.config.ts: server.contentSecurityPolicy: invalid source "…" in script-src`.

```ts good
import { contentSecurityPolicy } from "@meekojs/meeko/server";
contentSecurityPolicy({ "script-src": ["'self'", "https://cdn.example"] });
```

### An unquoted hash

```ts bad
contentSecurityPolicy({ "default-src": ["'self'"] }, ["sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8="]);
```

`TypeError: contentSecurityPolicy: invalid script hash "sha256-B2yP…"`.

```ts good
import { contentSecurityPolicy } from "@meekojs/meeko/server";
contentSecurityPolicy({ "default-src": ["'self'"] }, ["'sha256-B2yPHKaXnvFWtRChIbabYmUBFZdVfKKXHbWtWidDVF8='"]);
```

### A string instead of a list, or uppercase directives

```ts bad
contentSecurityPolicy({ "Script-Src": "'self'" });
```

`TypeError: contentSecurityPolicy: invalid directive name "Script-Src"`; with the correct name and a string, `contentSecurityPolicy: script-src must be an array of sources`.

```ts good
import { contentSecurityPolicy } from "@meekojs/meeko/server";
contentSecurityPolicy({ "script-src": ["'self'"] });
```

### CSP in `server.headers`

```ts bad
server: { adapter: "node", headers: { "Content-Security-Policy": "default-src 'self'" } }
```

`meeko.config.ts: server.headers no puede fijar Content-Security-Policy; use server.contentSecurityPolicy, que añade los hashes de los scripts`: written manually, the policy would lack hashes and the nonce and would block Meeko's scripts.

<!-- no-check -->

```ts good
server: { adapter: "node", contentSecurityPolicy: { "default-src": ["'self'"] } }
```

## Notes

- **CSP per response (since 1.7).** With `server.contentSecurityPolicy` on `node`, `bun`, `deno` or `cloudflare`, Meeko completes the policy according to each response's content:

  | Response                            | What is added                                                                                                                                             |
  | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Prerendered page                    | Hashes of its scripts and `<style>` elements (from the prerender index). Still served from its file, with `ETag` and `304`.                               |
  | SSR, `"stream"`, error and 404 page | A new nonce per response (128 bits), set by Meeko on its `<script>`, `<style>`, client entry point, theme script and those from `useHead` and `document`. |
  | SSR page with `cache`               | Its HTML hashes, without a nonce: the document is the same for everyone and a nonce does not survive a `304`.                                             |
  | API, RPC and navigation JSON        | The policy is replaced with `default-src 'none'; frame-ancestors 'none'`.                                                                                 |
  | Public files and everything else    | The policy as is.                                                                                                                                         |

- **`'unsafe-inline'`.** With a hash or nonce, the browser ignores `'unsafe-inline'` in that directive. This is why Meeko never adds a nonce or hash to a directive containing it; the public function does add script hashes (not style hashes) to a `script-src` with `'unsafe-inline'`.
- **When it applies.** Only in production: in `meeko dev`, Vite injects scripts without a nonce or hash. A response already carrying `Content-Security-Policy` (from a handler or middleware) keeps it, and a `304` never carries it.
- **Workers.** Hashes and the nonce use Web Crypto: Cloudflare Workers applies CSP just like Node, Bun and Deno.
- **`static`.** The static adapter writes the policy, with hashes from all its `.html` files, to the `headerFiles` files; an `on*` attribute or `javascript:` URL stops the build with the list of files.
