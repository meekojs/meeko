---
title: meeko preview
group: commands
since: 1.0.0
description: Ejecuta la salida de meeko build en su runtime real (Node, Bun, Deno, wrangler dev o un servidor de archivos) para probarla antes de desplegar.
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
---

`meeko preview` arranca el build de producción con el runtime de su adaptador, para comprobar que lo que se va a desplegar funciona: no compila nada, así que antes hay que ejecutar [`meeko build`](/docs/reference/meeko-build) con el mismo adaptador.

| Adaptador | Qué ejecuta |
| --- | --- |
| `node` | El mismo servidor que [`meeko start`](/docs/reference/meeko-start), en este proceso. |
| `bun` | `bun .meeko/output/bun/index.js`, como proceso hijo. |
| `deno` | `deno run -A .meeko/output/deno/main.js`, como proceso hijo. |
| `cloudflare` | `wrangler dev --config .meeko/output/cloudflare/wrangler.jsonc`, el Worker en `workerd` con bindings locales. |
| `static` | Un servidor pequeño que responde como un hosting estático, con la CSP y las cabeceras de `server`. |

## Uso

```sh
meeko build --adapter static
meeko preview --adapter static
```

```text
http://127.0.0.1:4173
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `[directorio]` | ruta | `.` | Raíz del proyecto. |
| `--adapter <nombre>` o `--adapter=<nombre>` | `node` \| `bun` \| `deno` \| `cloudflare` \| `static` | `server.adapter`, o `node` | Qué build ejecutar. Debe coincidir con el del último `meeko build`. |
| `MEEKO_PORT` (o `PORT`), `MEEKO_HOST` | número, texto | `127.0.0.1:4173` | Dirección del servidor. Con `cloudflare` se pasan a `wrangler dev` como `--port` e `--ip`. |
| `MEEKO_PUBLIC_ORIGIN` y demás variables | | | Las mismas de `meeko start`; el `.env` del proyecto se lee antes de arrancar y los procesos hijos heredan el entorno. |

## Resultado

- **Node y `static`** imprimen la URL y sirven en este proceso hasta `Ctrl+C`.
- **Bun, Deno y Cloudflare** heredan la consola del proceso hijo, que escribe su propia salida; `meeko preview` le reenvía `SIGINT` y `SIGTERM` y termina con el código de salida del hijo.
- **`static`** sirve el archivo pedido, el `index.html` de la carpeta o `404.html` con estado `404` (o el texto `Not Found` si el build no tiene `404.html`, porque falta `app/error.meeko`), sin publicar `_headers` ni `_meeko/`, y aplica `contentSecurityPolicy` y `headers` como lo haría el hosting con `headerFiles`. Sólo admite `GET` y `HEAD` (otro método da `405` con `Allow: GET, HEAD`) y todo lleva `cache-control: no-cache`.

## Ejemplos

### Un sitio estático antes de subirlo

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

### Bun o Deno

```sh
meeko build --adapter bun
meeko preview --adapter bun
```

El build ya lleva todas las dependencias: lo que funciona aquí funciona copiando sólo `.meeko/output/bun/` al servidor. Con Deno, `preview` concede todos los permisos (`-A`); en producción bastan `--allow-net`, `--allow-env` y `--allow-read` de la carpeta.

### Cloudflare Workers en local

```sh
pnpm add -D wrangler
meeko build --adapter cloudflare
MEEKO_PORT=8787 meeko preview --adapter cloudflare
```

`preview` usa el Wrangler de la aplicación o, si no lo tiene, el de la instalación de Meeko.

### El adaptador de la configuración

Con `server: { adapter: "deno" }` en `meeko.config.ts`, `--adapter` sobra en los dos comandos:

```sh
meeko build
meeko preview
```

## Errores comunes

### Previsualizar otro adaptador que el construido

```sh bad
meeko build --adapter static
meeko preview
```

Sin `--adapter`, `preview` toma el de la configuración (por defecto, `node`) y busca otro build: `No hay build de producción en …\.meeko\output\node\index.mjs; ejecuta meeko build`. Con los demás adaptadores el mensaje nombra su archivo, como `No hay build de producción en …\.meeko\output\deno\main.js; ejecuta meeko build --adapter deno` o `No hay build estático en …\.meeko\output\static; ejecuta meeko build --adapter static`.

```sh good
meeko build --adapter static
meeko preview --adapter static
```

### Cloudflare sin Wrangler

```sh bad
meeko build --adapter cloudflare
meeko preview --adapter cloudflare
```

Si ni la aplicación ni Meeko encuentran Wrangler: `Wrangler no está instalado; añádelo con pnpm add -D wrangler para previsualizar el build de cloudflare`.

```sh good
pnpm add -D wrangler
meeko preview --adapter cloudflare
```

### `--adapter` sin nombre

```sh bad
meeko preview --adapter
```

`Falta el nombre del adaptador en --adapter de preview`, con el uso y código `1`. Un nombre que no existe da `Adaptador desconocido: …; usa node, cloudflare, deno, bun o static`.

```sh good
meeko preview --adapter bun
```

## Notas

- **Para probar, no para producción.** Con Node, `preview` y `start` son el mismo servidor; con `static`, el servidor de `preview` sólo imita a un hosting y no debe exponerse a Internet. Con Deno, `-A` concede más permisos de los necesarios.
- **Runtimes.** `bun` y `deno` deben estar en el `PATH`. Si el ejecutable no existe, el error es `Bun no está instalado o no está en el PATH; instálalo desde https://bun.sh para previsualizar el build de bun` (o el equivalente de Deno). Un gestor de versiones con shims, como `mise` o `asdf`, puede interceptar el comando y mostrar su propio error.
- **Windows y POSIX.** El proceso hijo se lanza sin ventana propia en Windows, con la consola del padre, y recibe reenviados `SIGINT` y `SIGTERM`. Si el hijo termina por una señal, `preview` sale con código `1`.
- **Sesiones.** Con Node, Bun y Deno, `preview` es producción: necesita `MEEKO_REDIS_URL` o `sessions` en `server/runtime.ts`, como `meeko start`.
- **CSP.** `preview` aplica `server.contentSecurityPolicy` y `server.headers` igual que producción (con `static` desde `1.3`; con los adaptadores con servidor desde `1.7`). Es el sitio para comprobar que la CSP no bloquea nada antes de desplegar.
