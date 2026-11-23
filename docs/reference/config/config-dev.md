---
title: dev
group: config
since: 1.3.0
description: Opciones de meeko dev, como el reenvío a la consola del navegador de lo que el código de servidor escribe mientras atiende una petición o los hosts desde los que se puede abrir (proxies y túneles).
symbols:
  - "config:dev"
related:
  - "cli:dev"
  - docs/framework.md#logs-del-servidor-en-la-consola-del-navegador
  - docs/framework.md#configuración
---

`dev` agrupa las opciones de `meeko dev`; no afectan a `meeko build`, `meeko start` ni a ninguna salida de producción. Tiene dos: `serverLogs`, que activa o desactiva los logs del servidor en la consola del navegador, y, desde `1.10`, `allowedHosts`, los hosts desde los que se puede abrir `meeko dev` (un proxy, un túnel o un nombre de la red local).

Con `serverLogs` activo (el valor por defecto), lo que el código de servidor escribe con `console.log`, `info`, `warn`, `error` o `debug` mientras atiende una petición aparece también en la consola del navegador, agrupado por petición, como `features.devLogs` de Nuxt. La terminal lo sigue mostrando igual.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ dev: { serverLogs: false } });
```

## Opciones

| Opción         | Tipo               | Por defecto | Descripción                                                                                                                                                                                                         |
| -------------- | ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverLogs`   | `boolean`          | `true`      | Reenvía los logs del servidor de cada petición a la consola del navegador en `meeko dev`.                                                                                                                           |
| `allowedHosts` | `string[] \| true` | ninguno     | Desde `1.10`. Hosts, sufijos `.dominio` u orígenes completos desde los que se puede abrir `meeko dev`; `true`, cualquiera. Véase [Abrir meeko dev desde otro dispositivo](#abrir-meeko-dev-desde-otro-dispositivo). |

## Resultado

Con `serverLogs: true`:

- **Qué se reenvía.** Lo que se ejecuta para una petición: middleware, loaders, `<script server>`, plugins `*.server.ts`, el render, los clientes `api.*` y `rpc.*` del SSR, handlers de API y RPC y su trabajo asíncrono. El arranque, `server/runtime.ts` y los callbacks de Socket sólo van a la terminal.
- **Cómo llega.** En el documento HTML, en el stream de `"stream"`, en el payload de una navegación cliente o, para API y RPC, por el WebSocket de HMR de Vite.
- **Cómo se ve.** Un grupo por petición con la insignia `server`, el método, la ruta y el `requestId`; los objetos se despliegan como en el servidor.

Con `serverLogs: false`, nada de eso: la terminal sigue mostrando los logs.

## Abrir meeko dev desde otro dispositivo

`allowedHosts` (desde `1.10`) deja abrir `meeko dev` a través de un proxy o un túnel (`tailscale serve`, ngrok, cloudflared) o con un nombre de la red local (`mi-pc.local`). Sin él, una petición así se bloquea dos veces: primero el host, que Vite sólo acepta para `localhost`, `*.localhost` y las direcciones IP, y después el `Origin` de las mutaciones de API, RPC, formularios, `session.create` y Socket, porque un túnel que termina TLS envía `https://<host>` y Meeko ve `http://<host>`.

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  dev: { allowedHosts: ["mi-pc.tailnet.ts.net", ".ngrok-free.app"] },
});
```

Cada entrada puede ser:

| Entrada                          | Host que se sirve                                    | `Origin` que se acepta                                    |
| -------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `"mi-pc.tailnet.ts.net"`         | ese nombre, en cualquier puerto                      | `https://` y `http://` de ese nombre, en cualquier puerto |
| `".ngrok-free.app"`              | `ngrok-free.app` y sus subdominios                   | `https://` y `http://` de esos nombres                    |
| `"https://dev.example.com:8443"` | `dev.example.com`                                    | sólo `https://dev.example.com:8443`                       |
| `true`                           | cualquiera, como `server.allowedHosts: true` de Vite | el que tenga el mismo host que la petición, http o https  |

La variable `MEEKO_ALLOWED_HOSTS` añade entradas sin tocar el archivo, separadas por comas, o `true`; también se lee del `.env` del proyecto:

```sh
MEEKO_ALLOWED_HOSTS=mi-pc.tailnet.ts.net,.ngrok-free.app meeko dev
```

Ya no hace falta un módulo con `extendViteConfig` para `server.allowedHosts`: Meeko le pasa a Vite estas entradas, el host de `MEEKO_HOST` (o `server.host`) y el de `MEEKO_PUBLIC_ORIGIN`. Lo que un módulo añada a `server.allowedHosts` sigue contando.

Cuando `meeko dev` rechaza una petición, dice qué configurar:

- **Host.** Responde `403` con `[meeko] meeko dev bloqueó una petición con el host "mi-pc.local". … añádalo a dev.allowedHosts en meeko.config.ts (…) o a la variable MEEKO_ALLOWED_HOSTS`, y lo escribe una vez en la terminal.
- **Origin.** La respuesta sigue siendo `403 INVALID_ORIGIN`, y la terminal (y, con `serverLogs`, la consola del navegador) avisa una vez por origen: `[meeko] meeko dev rechazó una petición con Origin "https://mi-pc.local" (403 INVALID_ORIGIN). Si abre la aplicación a través de un proxy o un túnel, añada "mi-pc.local" a dev.allowedHosts …`.

`allowedHosts` no existe fuera de `meeko dev`: `meeko build`, `meeko start`, `meeko preview` y las salidas de los adaptadores no lo leen, y un `SessionManager` con `production: true` lo ignora aunque se lo pasen. En producción, un origen adicional se declara en `allowedOrigins` de `SessionManager` (o `socket.allowedOrigins`), y el de un proxy, con `MEEKO_PUBLIC_ORIGIN`.

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

### Un host con esquema, puerto o ruta

```ts bad
export default defineMeekoConfig({ dev: { allowedHosts: ["mi-pc.local:4173"] } });
```

La carga se detiene con `…/meeko.config.ts: dev.allowedHosts[0] "mi-pc.local:4173" debe ser un nombre de host (sin esquema, puerto ni ruta) o un origen completo como https://mi-pc.local`. Un host vale en cualquier puerto; para limitar el `Origin` a un puerto, escriba el origen completo.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ dev: { allowedHosts: ["mi-pc.local"] } });
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
- **HMR desde otro dispositivo.** `allowedHosts` abre el puerto de la aplicación; el WebSocket de HMR de Vite sigue escuchando sólo en `127.0.0.1`, así que en otro dispositivo la página funciona pero no se recarga sola al editar.
- **Desarrollo.** Cambiar `meeko.config.ts` o `MEEKO_ALLOWED_HOSTS` exige reiniciar `meeko dev`.
