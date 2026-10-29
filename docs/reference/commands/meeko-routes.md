---
title: meeko routes
group: commands
since: 1.0.0
description: Descubre rutas, contratos de servidor, componentes y autoimports y prepara .meeko/ como meeko check (manifiestos, declaraciones y tsconfig), sin ejecutar TypeScript.
symbols:
  - "cli:routes"
related:
  - "cli:check"
  - "cli:types"
  - "@meekojs/meeko/framework#RouteId"
  - docs/framework.md#configuración
  - docs/framework.md#autoimports-y-typescript
---

`meeko routes` hace el descubrimiento de [`meeko check`](/docs/reference/meeko-check) sin comprobar nada: lee `app/pages`, `server/api`, `server/rpc`, `server/socket`, los componentes y las carpetas de autoimports del proyecto y sus layers, y escribe los manifiestos y las declaraciones que usan el editor, `href()` y los clientes `api`, `rpc` y `socket`. Desde `1.7` prepara `.meeko/` igual que `meeko check`: escribe también las entradas de Vite, `.meeko/types/services.d.ts`, los contratos de páginas y los `tsconfig.*.json`, así que después funciona `tsc -p .meeko/tsconfig.server.json`. Imprime la ruta de cada archivo escrito.

Es la forma rápida de que una página o un endpoint nuevo existan para los tipos, por ejemplo en un script o un watcher propio, sin esperar a TypeScript.

## Uso

```sh
meeko routes .
```

```text
C:\proyectos\tienda\.meeko\types\routes.d.ts
C:\proyectos\tienda\.meeko\manifests\routes.json
C:\proyectos\tienda\.meeko\types\server-contracts.d.ts
C:\proyectos\tienda\.meeko\manifests\server.json
C:\proyectos\tienda\.meeko\types\app\app.d.meeko.ts
C:\proyectos\tienda\.meeko\types\app\components\Greeting.d.meeko.ts
C:\proyectos\tienda\.meeko\types\app\layouts\default.d.meeko.ts
C:\proyectos\tienda\.meeko\types\app\pages\index.d.meeko.ts
C:\proyectos\tienda\.meeko\generated\page-contracts.server.ts
C:\proyectos\tienda\.meeko\types\services.d.ts
C:\proyectos\tienda\.meeko\types\autoimports\client.d.ts
C:\proyectos\tienda\.meeko\types\autoimports\server.d.ts
C:\proyectos\tienda\.meeko\types\autoimports\shared.d.ts
C:\proyectos\tienda\.meeko\tsconfig.app.json
C:\proyectos\tienda\.meeko\tsconfig.server.json
C:\proyectos\tienda\.meeko\tsconfig.shared.json
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `<directorio>` | ruta | obligatorio | Raíz del proyecto. A diferencia de `dev`, `check` y `build`, no tiene valor por defecto: `meeko routes` sin él da `Falta el directorio de routes`. |

## Resultado

| Archivo | Qué contiene |
| --- | --- |
| `.meeko/types/routes.d.ts` | Las rutas (`RouteId`, sus parámetros), los layouts y los middleware con nombre. |
| `.meeko/manifests/routes.json` | El manifiesto de rutas. |
| `.meeko/types/server-contracts.d.ts` | Los tipos de `api`, `rpc` y `socket` a partir de los contratos de `server/`. |
| `.meeko/manifests/server.json` | El manifiesto de endpoints, procedimientos y canales. |
| `.meeko/types/**/*.d.meeko.ts` | La declaración de cada componente `.meeko` de la aplicación. |
| `.meeko/generated/page-contracts.server.ts` | Los contratos de props de páginas y layouts que comprueba el proyecto `server` (desde `1.7` en `routes`). |
| `.meeko/types/services.d.ts` | El tipo de `context.services`, a partir de `server/runtime.ts` (desde `1.7` en `routes`). |
| `.meeko/types/autoimports/{client,server,shared}.d.ts` | Los autoimports de cada ámbito. |
| `.meeko/tsconfig.{app,server,shared}.json` | Los proyectos de TypeScript de cada ámbito (desde `1.7` en `routes`). |

Termina con código `0`, o con `1` y el mensaje si el descubrimiento falla: dos rutas que resuelven a la misma URL, un contrato de API sin `response`, un layout o un middleware con nombre que no existe, `render` calculado…

## Ejemplos

### Tras crear una página, antes de usarla en `<MeekoLink>`

```sh
mkdir -p app/pages/blog
printf '<template><h1>Blog</h1></template>\n' > app/pages/blog/index.meeko
meeko routes .
```

`to="/blog"` deja de ser `TS2345` en el editor en cuanto `routes.d.ts` incluye la ruta.

### Un contrato de API inválido

```sh
meeko routes .
```

```text
C:/proyectos/tienda/server/api/health.get.ts: la API requiere un schema público response
```

El descubrimiento de servidor exige un `response` importado de `shared/`; `meeko dev`, `meeko check` y `meeko build` dan el mismo error, porque comparten el descubrimiento.

## Errores comunes

### Sin el directorio

```sh bad
meeko routes
```

`Falta el directorio de routes`, con el uso y código `1`.

```sh good
meeko routes .
```

### Esperar de `routes` la comprobación de `meeko check`

```sh bad
meeko routes . && echo "sin errores de tipos"
```

`meeko routes` sólo prepara `.meeko/`: no ejecuta TypeScript ni comprueba los componentes, así que termina con `0` aunque haya errores de tipos. Desde `1.7` deja preparado lo mismo que `meeko check`, y `npx tsc -p .meeko/tsconfig.server.json` funciona después; hasta `1.6` no escribía los `tsconfig.*.json` ni `services.d.ts` y `tsc` fallaba con `TS5058`. Para comprobar, use `meeko check` (o `meeko check-app` para sólo los componentes).

```sh good
meeko check .
```

### La ruta de una subcarpeta

```sh bad
meeko routes app
```

`ENOENT: no such file or directory, scandir '…\app\app\pages'`: la ruta es la raíz del proyecto.

```sh good
meeko routes .
```

## Notas

- **Sin ejecutar TypeScript.** Sólo lee y escribe archivos; no comprueba tipos ni el contrato de props de las páginas. Para eso, `meeko check`.
- **Ejecuta la configuración.** Carga `meeko.config.ts` y los `setup` de sus módulos, como `dev` y `check`, pero no lee el `.env` del proyecto.
- **Lo que no lista.** Escribe también, sin listarlos, las entradas de Vite (`entry-client.ts`, `entry-server.ts`, `entry-node.ts`), los clientes de `.meeko/generated/` (`clients.client.ts`, `clients.server.ts`, `socket-contracts.ts`), los bloques `<script server>` de `.meeko/routes/` y `.meeko/types/virtual-pages.d.ts`. Hasta `1.6` no escribía las entradas, los `tsconfig.*.json`, los contratos de páginas ni `services.d.ts`.
- **Componentes huérfanos.** Las declaraciones de componentes se registran en `.meeko/manifests/component-types.json`; al regenerarlas se borran sólo las administradas cuyo componente ya no existe.
- **Windows y POSIX.** Las rutas impresas son absolutas y con el separador del sistema; los errores del descubrimiento de servidor usan `/`.
