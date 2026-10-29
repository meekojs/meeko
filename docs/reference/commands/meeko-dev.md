---
title: meeko dev
group: commands
since: 1.0.0
description: Servidor de desarrollo de una aplicación full-stack, que prepara los tipos de .meeko/ y sirve la aplicación con Vite, SSR y HMR.
symbols:
  - "cli:dev"
related:
  - "cli:check"
  - "cli:build"
  - "cli:clean"
  - "config:dev"
  - "@meekojs/meeko/vite#meeko"
  - docs/framework.md#configuración
  - docs/framework.md#logs-del-servidor-en-la-consola-del-navegador
  - docs/devtools.md#puente-del-editor
---

`meeko dev` arranca la aplicación del directorio indicado (por defecto, el actual) en modo desarrollo. Primero lee el `.env` del proyecto, carga `meeko.config.ts` y sus módulos y genera en `.meeko/` las entradas de Vite, los tipos de las rutas, de los contratos, de los autoimports y, desde `1.7`, `.meeko/types/services.d.ts`. Después crea un servidor HTTP de Node con Vite en modo middleware: SSR con los módulos de `app/` y `server/` sin compilar, HMR de componentes y CSS y los logs del servidor en la consola del navegador.

No comprueba tipos: eso es [`meeko check`](/docs/reference/meeko-check). Tampoco sirve el build de producción: eso es [`meeko start`](/docs/reference/meeko-start).

## Uso

```sh
# en la raíz del proyecto, la que tiene meeko.config.ts
meeko dev
```

```text
http://127.0.0.1:4173
```

El starter de [`meeko init-framework`](/docs/reference/meeko-init-framework) lo declara como `"dev": "meeko dev ."`, así que lo habitual es `npm run dev` o `pnpm dev`.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `[directorio]` | ruta | `.` | Raíz del proyecto. Es también la carpeta cuyo `.env` se lee. |
| `MEEKO_PORT` (o `PORT`) | número | el primer libre desde `4173` | Puerto HTTP. Sustituye a `server.port` de `meeko.config.ts` (sólo con `adapter: "node"`). Un puerto con nombre se usa tal cual: si está ocupado, el arranque falla. |
| `MEEKO_HOST` | texto | `127.0.0.1` | Dirección en la que escucha. Sustituye a `server.host`. Con `0.0.0.0` acepta conexiones de otras máquinas. `HOST` sigue valiendo, con un aviso, hasta `2.0`. |
| `MEEKO_PUBLIC_ORIGIN` | origen | ninguno | Origen público para las comprobaciones de `Origin` de HTTP y Socket cuando hay un proxy o un túnel delante. |
| `MEEKO_HMR_PORT` | número | derivado del puerto HTTP | Puerto del WebSocket de HMR de Vite, que sólo escucha en `127.0.0.1`. |
| `MEEKO_EDITOR_BRIDGE=0` | `0` | activo | Desactiva el puente con el editor (los valores en vivo de la extensión). |
| `MEEKO_LINK_WATCH=0` | `0` | activo | Con un `@meekojs/meeko` enlazado (`link:`, `npm link`, un workspace), no reinicia el servidor cuando ese paquete se reconstruye: sólo avisa. |

No admite banderas: `meeko dev --port 3000` termina con `Opción desconocida para dev: --port`. Los puertos y la dirección se indican con variables de entorno, en la shell o en el `.env`.

## Resultado

- **En la salida estándar**, la URL en la que escucha, como `http://127.0.0.1:4173` (con `MEEKO_HOST=0.0.0.0` muestra `127.0.0.1`). Si no se indicó un puerto y `4173` está ocupado, antes avisa: `[meeko] El puerto 4173 está en uso; meeko dev usa el 4174`.
- **En `.meeko/`**, las entradas `generated/`, los manifiestos, las declaraciones de `types/` y los `tsconfig.*.json` que usa el editor, como `meeko check` pero sin ejecutar TypeScript. Se generan al arrancar: mientras el proceso sigue vivo, los tipos no se regeneran (ejecuta `meeko check`).
- **En `.meeko/dev/`**, el descriptor `editor-bridge-<puerto>.json` del puente con el editor, que se borra al cerrar con `Ctrl+C`.
- **El proceso** sigue en marcha hasta `SIGINT` o `SIGTERM`, que cierran el puente, Socket, HTTP, la aplicación y Vite en ese orden. Un error de arranque termina con código `1` y el mensaje en la salida de errores.

Mientras corre, crear o borrar una página, un layout, un middleware o un módulo de `server/api`, `server/rpc` o `server/socket` vuelve a descubrir las rutas y crea la aplicación de nuevo, sin reiniciar el proceso. Cambiar `meeko.config.ts`, el `setup` de un módulo o un canal Socket existente exige reiniciar.

## Ejemplos

### Otro puerto, con el `.env` del proyecto

```sh
# .env
MEEKO_PORT=3000
```

```sh
meeko dev
# http://127.0.0.1:3000
```

Una variable de la shell gana al `.env`: `MEEKO_PORT=3100 meeko dev` usa el `3100` aunque el `.env` diga otra cosa.

### Dos aplicaciones a la vez

Sin puerto con nombre, el segundo `meeko dev` toma el siguiente libre en lugar de fallar, y su HMR va a otro puerto derivado:

```sh
# terminal 1, en ./tienda
meeko dev
# http://127.0.0.1:4173

# terminal 2, en ./panel
meeko dev
# [meeko] El puerto 4173 está en uso; meeko dev usa el 4174
# http://127.0.0.1:4174
```

### Probar desde el móvil en la red local

```sh
MEEKO_HOST=0.0.0.0 meeko dev
```

En PowerShell:

```powershell
$env:MEEKO_HOST = "0.0.0.0"; meeko dev
```

El móvil abre `http://<IP del equipo>:4173`. El WebSocket de HMR y los logs del servidor siguen escuchando sólo en `127.0.0.1`: el navegador del móvil no recibe HMR ni los logs en su consola.

### Tras un túnel o un proxy HTTPS

```sh
MEEKO_PUBLIC_ORIGIN=https://mi-tunel.example.com meeko dev
```

Sin él, las mutaciones (`POST` de API y RPC) y los sockets que llegan con `Origin: https://mi-tunel.example.com` se rechazan, porque no coinciden con el origen local.

### Otro proyecto del monorepo

```sh
meeko dev apps/site
```

La ruta es la raíz del proyecto, no un archivo: el `.env`, `meeko.config.ts`, `app/` y `.meeko/` se leen y escriben dentro de `apps/site`.

## Errores comunes

### Pasar el puerto como bandera

```sh bad
meeko dev --port 3000
```

La CLI responde `Opción desconocida para dev: --port`, imprime el uso y termina con código `1`. `meeko dev` no tiene banderas; desde `1.7`, `meeko dev --help` imprime su ayuda.

```sh good
MEEKO_PORT=3000 meeko dev
```

### Un puerto con nombre que ya está ocupado

Con `MEEKO_PORT`, `PORT` o `server.port`, `meeko dev` no busca otro puerto: quien lo fija espera esa URL.

```sh bad
# otro meeko dev (u otro programa) ya escucha en el 4391
MEEKO_PORT=4391 meeko dev
```

```text
El puerto 4391 de 127.0.0.1 ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev
```

El proceso termina con código `1`. Si no indicas puerto y los 20 desde `4173` están ocupados, el mensaje es `Los puertos 4173–4192 de 127.0.0.1 ya están en uso; usa MEEKO_PORT=<puerto> o cierra otro meeko dev`.

```sh good
MEEKO_PORT=4392 meeko dev
# o, sin puerto con nombre, que elija el primero libre
meeko dev
```

### Ejecutarlo fuera de la raíz del proyecto

```sh bad
cd apps/site/app
meeko dev
```

`meeko dev` busca `app/pages` dentro del directorio que recibe y falla con `ENOENT: no such file or directory, scandir '…\apps\site\app\app\pages'`. Tampoco leería el `.env` correcto.

```sh good
meeko dev apps/site
```

### `MEEKO_LINK_WATCH=0` y un Meeko enlazado que cambia

Con `@meekojs/meeko` enlazado a su repositorio, `meeko dev` se supervisa a sí mismo y reinicia el servidor cuando el `dist/` del paquete cambia (`[meeko] Meeko enlazado cambió; reiniciando meeko dev…`). Con `MEEKO_LINK_WATCH=0` no lo hace:

```sh bad
MEEKO_LINK_WATCH=0 meeko dev
# después, pnpm -F @meekojs/meeko run build en el otro repositorio
```

```text
[meeko] Meeko enlazado cambió (…\packages\meeko\dist), pero este meeko dev no se reinicia solo (MEEKO_LINK_WATCH=0): el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.
```

El SSR sigue con el runtime anterior y el navegador hidrata con el nuevo: los errores de hidratación que aparecen entonces no son de la aplicación.

```sh good
meeko dev
```

Usa `MEEKO_LINK_WATCH=0` sólo si necesitas que el proceso no se reinicie (por ejemplo, con un depurador enganchado), y reinícialo a mano tras cada build del paquete.

### Esperar que `meeko dev` compruebe los tipos

```sh bad
# CI
meeko dev & sleep 10 && curl -f http://127.0.0.1:4173/
```

`meeko dev` sirve una página aunque otra tenga un error de tipos: Vite elimina los tipos sin comprobarlos. Un error de TypeScript sólo aparece en `meeko check`, en `meeko build` y en el editor.

```sh good
meeko check
```

## Notas

- **Sólo para desarrollo.** Sirve los módulos fuente sin empaquetar, con la CSP desactivada (Vite inyecta scripts sin nonce) y con logs del servidor en el navegador. No lo publiques en Internet; en producción usa `meeko build` y `meeko start`.
- **`.env`.** `dev`, `build`, `start`, `preview` y `check` leen `<directorio>/.env` antes que nada, también `MEEKO_PORT` o `MEEKO_LINK_WATCH`. Una variable que ya existe en el entorno nunca se sustituye. Cambiar el `.env` mientras corre reinicia Vite y vuelve a crear la aplicación; las sesiones en memoria se pierden.
- **Puertos.** Sin puerto con nombre prueba de `4173` a `4192` y toma el primero cuyo puerto HMR derivado también esté libre. El HMR usa un puerto derivado del HTTP para que dos proyectos no compartan el `24678` de Vite.
- **Dos procesos en el mismo proyecto.** Cada arranque reescribe `.meeko/generated/`; un segundo `meeko dev` sobre el mismo directorio hace que el primero recargue sus entradas de SSR. Desde `1.7`, cada `meeko dev` anota su PID en `.meeko/dev/server.json` y el segundo avisa al arrancar: `[meeko] Otro meeko dev (PID …) ya sirve este proyecto: …`. Sólo avisa y sigue arrancando; usa un proceso por proyecto.
- **Windows y POSIX.** En Windows, `Ctrl+C` cierra el servidor y borra `.meeko/dev/editor-bridge-<puerto>.json`; matar el proceso desde el Administrador de tareas (o con `taskkill /F`) no ejecuta el cierre y deja el descriptor en `.meeko/dev/` (`meeko clean` lo borra). En POSIX, `kill` (SIGTERM) cierra ordenadamente.
- **Rendimiento.** El arranque descubre rutas, contratos y autoimports y escribe los tipos antes de escuchar, pero no ejecuta TypeScript, que es lo lento de `meeko check`. Editar una página, un layout o un handler existente no reinicia nada: Vite recarga ese módulo cuando se pide.
- **Errores del proceso.** Un rechazo sin manejar del código de la aplicación se registra y el servidor sigue; una excepción no capturada cierra el servidor con código `1`.
