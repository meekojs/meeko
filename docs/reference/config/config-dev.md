---
title: dev
group: config
since: 1.3.0
description: Opciones de meeko dev, como el reenvío a la consola del navegador de lo que el código de servidor escribe mientras atiende una petición.
symbols:
  - "config:dev"
related:
  - "cli:dev"
  - docs/framework.md#logs-del-servidor-en-la-consola-del-navegador
  - docs/framework.md#configuración
---

`dev` agrupa las opciones de `meeko dev`; no afectan a `meeko build`, `meeko start` ni a ninguna salida de producción. Hoy tiene una: `serverLogs`, que activa o desactiva los logs del servidor en la consola del navegador.

Con `serverLogs` activo (el valor por defecto), lo que el código de servidor escribe con `console.log`, `info`, `warn`, `error` o `debug` mientras atiende una petición aparece también en la consola del navegador, agrupado por petición, como `features.devLogs` de Nuxt. La terminal lo sigue mostrando igual.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ dev: { serverLogs: false } });
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `serverLogs` | `boolean` | `true` | Reenvía los logs del servidor de cada petición a la consola del navegador en `meeko dev`. |

## Resultado

Con `serverLogs: true`:

- **Qué se reenvía.** Lo que se ejecuta para una petición: middleware, loaders, `<script server>`, plugins `*.server.ts`, el render, los clientes `api.*` y `rpc.*` del SSR, handlers de API y RPC y su trabajo asíncrono. El arranque, `server/runtime.ts` y los callbacks de Socket sólo van a la terminal.
- **Cómo llega.** En el documento HTML, en el stream de `"stream"`, en el payload de una navegación cliente o, para API y RPC, por el WebSocket de HMR de Vite.
- **Cómo se ve.** Un grupo por petición con la insignia `server`, el método, la ruta y el `requestId`; los objetos se despliegan como en el servidor.

Con `serverLogs: false`, nada de eso: la terminal sigue mostrando los logs.

## Ejemplos

### Desactivarlo con una variable

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ dev: { serverLogs: process.env.MEEKO_DEV_LOGS !== "0" } });
```

```sh
MEEKO_DEV_LOGS=0 npm run dev
```

## Errores comunes

### Un valor que no es booleano

```ts bad
export default defineMeekoConfig({ dev: { serverLogs: "no" } as never });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: dev.serverLogs debe ser un booleano`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ dev: { serverLogs: false } });
```

### Publicar el puerto de HMR por un túnel

```sh bad
cloudflared tunnel --url http://127.0.0.1:$MEEKO_HMR_PORT   # el WebSocket de HMR de Meeko
```

Quien se conecte al WebSocket de HMR recibe los logs de todas las peticiones, como una pestaña local. Publique sólo el puerto de la aplicación, o desactive `serverLogs`.

```sh good
cloudflared tunnel --url http://127.0.0.1:4173
```

## Notas

- **Sólo desarrollo.** Ni la captura de `console` ni su código existen en `meeko build`, `meeko start` o `meeko preview`.
- **Sólo para el navegador del desarrollador.** Las respuestas sólo llevan logs si la petición llega desde loopback, con un `Host` de loopback y sin cabeceras de proxy (`Forwarded`, `X-Forwarded-*`, `CF-Connecting-IP`…): los visitantes de un túnel no los reciben.
- **Secretos.** Los logs pueden contener datos sensibles; en una demo compartida, desactívelos.
- **Desarrollo.** Cambiar `meeko.config.ts` exige reiniciar `meeko dev`.
