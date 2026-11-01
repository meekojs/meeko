---
title: meeko preview
group: commands
since: 1.0.0
description: Runs meeko build output in its real runtime (Node, Bun, Deno, wrangler dev or a file server) to test it before deployment.
symbols:
  - "cli:preview"
related:
  - "cli:build"
  - "cli:start"
  - "@meekojs/meeko/bun#createBunServer"
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/cloudflare#createWorker"
  - docs/framework.md#sitio-estático
  - docs/framework.md#bun
  - docs/framework.md#deno
  - docs/framework.md#cloudflare-workers
source-hash: 3fedd4e10b753b521f15a58b8128068f674ed3271942da8cbcf7fe7f54ac591e
---

`meeko preview` starts the production build with its adapter's runtime to check that what you will deploy works: it compiles nothing, so first run [`meeko build`](/en/docs/reference/meeko-build) with the same adapter.

| Adapter      | What it runs                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `node`       | The same server as [`meeko start`](/en/docs/reference/meeko-start), in this process.                          |
| `bun`        | `bun .meeko/output/bun/index.js`, as a child process.                                                         |
| `deno`       | `deno run -A .meeko/output/deno/main.js`, as a child process.                                                 |
| `cloudflare` | `wrangler dev --config .meeko/output/cloudflare/wrangler.jsonc`, the Worker in `workerd` with local bindings. |
| `static`     | A small server responding like static hosting, with the CSP and `server` headers.                             |

## Usage

```sh
meeko build --adapter static
meeko preview --adapter static
```

```text
http://localhost:4173
```

## Options

| Option                                       | Type                                                  | Default                     | Description                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `[directorio]`                               | path                                                  | `.`                         | Project root.                                                                                                       |
| `--adapter <nombre>` or `--adapter=<nombre>` | `node` \| `bun` \| `deno` \| `cloudflare` \| `static` | `server.adapter`, or `node` | Which build to run. Must match the last `meeko build`.                                                              |
| `MEEKO_PORT` (or `PORT`), `MEEKO_HOST`       | number, text                                          | `127.0.0.1:4173`            | Server address. With `cloudflare`, passed to `wrangler dev` as `--port` and `--ip`.                                 |
| `MEEKO_PUBLIC_ORIGIN` and other variables    |                                                       |                             | The same as `meeko start`; the project's `.env` is read before startup and child processes inherit the environment. |

## Result

- **Node and `static`** print the URL and serve in this process until `Ctrl+C`. As with [`meeko start`](/en/docs/reference/meeko-start), loopback and `0.0.0.0` are displayed as `http://localhost:4173` and, with `0.0.0.0` or `::`, `Red:` lines follow with network addresses. Bun and Deno outputs print the same; Deno only lists the network with `--allow-sys=networkInterfaces`, included in `-A`.
- **Bun, Deno and Cloudflare** inherit the child process's console, which writes its own output; `meeko preview` forwards `SIGINT` and `SIGTERM` to it and exits with the child's exit code.
- **`static`** serves the requested file, the folder's `index.html` or `404.html` with status `404` (or `Not Found` if the build has no `404.html`, because `app/error.meeko` is missing), without exposing `_headers` or `_meeko/`, and applies `contentSecurityPolicy` and `headers` as hosting would with `headerFiles`. Only accepts `GET` and `HEAD` (another method gives `405` with `Allow: GET, HEAD`) and everything carries `cache-control: no-cache`.

## Examples

### A static site before uploading

```sh
meeko build --adapter static
MEEKO_PORT=5000 meeko preview --adapter static
```

```sh
curl -sI http://127.0.0.1:5000/
# HTTP/1.1 200 OK
# content-type: text/html; charset=utf-8
# cache-control: no-cache
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/no-existe
# 404
```

### Bun or Deno

```sh
meeko build --adapter bun
meeko preview --adapter bun
```

The build already contains all dependencies: what works here works by copying only `.meeko/output/bun/` to the server. With Deno, `preview` grants all permissions (`-A`); in production, `--allow-net`, `--allow-env` and `--allow-read` for the folder suffice.

### Cloudflare Workers locally

```sh
pnpm add -D wrangler
meeko build --adapter cloudflare
MEEKO_PORT=8787 meeko preview --adapter cloudflare
```

`preview` uses the application's Wrangler or, if absent, the one from the Meeko installation.

### The configured adapter

With `server: { adapter: "deno" }` in `meeko.config.ts`, neither command needs `--adapter`:

```sh
meeko build
meeko preview
```

## Common mistakes

### Preview a different adapter from the one built

```sh bad
meeko build --adapter static
meeko preview
```

Without `--adapter`, `preview` takes the configured adapter (default `node`) and looks for another build: `No hay build de producción en …\.meeko\output\node\index.mjs; ejecuta meeko build`. For other adapters the message names their file, such as `No hay build de producción en …\.meeko\output\deno\main.js; ejecuta meeko build --adapter deno` or `No hay build estático en …\.meeko\output\static; ejecuta meeko build --adapter static`.

```sh good
meeko build --adapter static
meeko preview --adapter static
```

### Cloudflare without Wrangler

```sh bad
meeko build --adapter cloudflare
meeko preview --adapter cloudflare
```

If neither the application nor Meeko finds Wrangler: `Wrangler no está instalado; añádelo con pnpm add -D wrangler para previsualizar el build de cloudflare`.

```sh good
pnpm add -D wrangler
meeko preview --adapter cloudflare
```

### `--adapter` without a name

```sh bad
meeko preview --adapter
```

`Falta el nombre del adaptador en --adapter de preview`, with usage information and exit code `1`. An unknown name gives `Adaptador desconocido: …; usa node, cloudflare, deno, bun o static`.

```sh good
meeko preview --adapter bun
```

## Notes

- **For testing, not production.** With Node, `preview` and `start` are the same server; with `static`, the `preview` server only imitates hosting and must not be exposed to the Internet. With Deno, `-A` grants more permissions than required.
- **Runtimes.** `bun` and `deno` must be in `PATH`. If the executable is missing, the error is `Bun no está instalado o no está en el PATH; instálalo desde https://bun.sh para previsualizar el build de bun` (or the Deno equivalent). A version manager with shims, such as `mise` or `asdf`, may intercept the command and display its own error.
- **Windows and POSIX.** The child process launches without its own window on Windows, using the parent's console, and receives forwarded `SIGINT` and `SIGTERM`. If the child terminates due to a signal, `preview` exits with code `1`.
- **Sessions.** With Node, Bun and Deno, `preview` runs in production mode: it needs `MEEKO_REDIS_URL` or `sessions` in `server/runtime.ts`, like `meeko start`.
- **CSP.** `preview` applies `server.contentSecurityPolicy` and `server.headers` just as production does (with `static` since `1.3`; with server adapters since `1.7`). Check here that CSP does not block anything before deployment.
