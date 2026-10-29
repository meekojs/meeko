---
title: meeko init-framework
group: commands
since: 1.0.0
description: Crea una aplicación full-stack de Meeko con meeko.config.ts, app/, un layout, una página prerenderizada, .env.example y los scripts de la CLI.
symbols:
  - "cli:init-framework"
related:
  - "cli:init"
  - "cli:dev"
  - "cli:check"
  - "@meekojs/meeko/framework#defineMeekoConfig"
  - docs/framework.md#crear-una-aplicación
  - docs/framework.md#configuración
---

`meeko init-framework` crea el starter del framework: rutas por archivos en `app/pages`, un layout que conserva el shell al navegar, estilos globales y la configuración mínima. No necesita `server/runtime.ts` ni Redis para empezar: en desarrollo las sesiones viven en memoria. No instala dependencias ni sobrescribe archivos.

## Uso

```sh
npx @meekojs/meeko init-framework tienda
```

```text
Proyecto creado en C:\proyectos\tienda
Siguiente paso: cd C:\proyectos\tienda && npm install && npm run dev
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `<directorio>` | ruta | obligatorio | Carpeta de la aplicación. Se crea si no existe; si existe, sólo puede contener `.git` (una carpeta recién creada con `git init`) o un `package.json` con lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`), `pnpm-workspace.yaml`, `node_modules`, `.npmrc` y `.git`; las mismas que `meeko init`. Hasta `1.6`, una carpeta con sólo `.git` y los lockfiles de Bun se rechazaban. Su nombre normalizado es el `name` del `package.json` si éste no tiene uno. |

## Resultado

```text
tienda/
├── .env.example            las variables MEEKO_* comentadas
├── .gitignore              node_modules/, .meeko/, .env
├── README.md
├── meeko.config.ts         defineMeekoConfig({ layers: [], modules: [], imports: { serverDirs: [] } })
├── package.json
├── tsconfig.json           referencia .meeko/tsconfig.app.json, server y shared
├── public/.gitkeep
└── app/
    ├── app.meeko           el documento raíz
    ├── layouts/default.meeko
    ├── pages/index.meeko   render: "prerender", con un contador
    └── styles/main.css     estilos globales, que se cargan solos
```

`package.json` recibe estos scripts y fija `@meekojs/meeko` a la versión exacta de la CLI que lo creó, con `@types/node`, `typescript` y `vite` como dependencias de desarrollo:

| Script | Comando |
| --- | --- |
| `dev` | `meeko dev .` |
| `check` | `meeko check .` |
| `build` | `meeko build .` |
| `start` | `meeko start .` |

Si la carpeta tenía `pnpm-lock.yaml`, el siguiente paso dice `pnpm install && pnpm run dev`.

## Ejemplos

### Una aplicación nueva, de principio a fin

```sh
npx @meekojs/meeko init-framework tienda
cd tienda
npm install
npm run dev      # http://127.0.0.1:4173
npm run check    # tipos y contratos
npm run build    # .meeko/output/node
```

Para `npm start` en producción hace falta un almacén de sesiones persistente (`MEEKO_REDIS_URL` o `sessions` en `server/runtime.ts`); véase [`meeko start`](/docs/reference/meeko-start).

### Sobre un `package.json` existente

Con una carpeta que sólo tiene `pnpm-lock.yaml` y este `package.json`:

```json
{ "name": "tienda", "scripts": { "test": "node --test" } }
```

```sh
meeko init-framework .
```

```text
Proyecto creado en C:\proyectos\tienda
Siguiente paso: pnpm install && pnpm run dev
```

```json
{
  "name": "tienda",
  "scripts": {
    "test": "node --test",
    "dev": "meeko dev .",
    "check": "meeko check .",
    "build": "meeko build .",
    "start": "meeko start ."
  },
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "dependencies": { "@meekojs/meeko": "1.6.0" },
  "devDependencies": { "@types/node": "^24.0.0", "typescript": "^7.0.2", "vite": "^8.3.5" }
}
```

Los campos, scripts y dependencias que ya existían se conservan; `private`, `type` y `engines.node` se fijan. El número de versión es el de la CLI que se ejecutó.

### En un monorepo

```sh
pnpm exec meeko init-framework apps/tienda
pnpm install
pnpm -F tienda dev
```

Los scripts usan `.` como directorio, así que funcionan con `pnpm -F` o desde la carpeta de la aplicación.

## Errores comunes

### Una carpeta que no está vacía

```sh bad
meeko init-framework tienda   # tienda ya tiene app/ o un README.md
```

`El destino no está vacío: C:\proyectos\tienda (app, README.md)`. Desde `1.7`, como en `meeko init`, el mensaje lista las entradas que lo impiden.

```sh good
meeko init-framework tienda-nueva
```

### Lockfiles sin su `package.json`

```sh bad
# tienda tiene bun.lock o node_modules, pero no package.json
meeko init-framework tienda
```

`El destino no está vacío: C:\proyectos\tienda (sin package.json)`: unos lockfiles sin su `package.json` son de otro proyecto. Una carpeta con sólo `.git` (`git init tienda`) sí se acepta desde `1.7`; hasta `1.6` se rechazaba.

```sh good
cd tienda && npm init -y && meeko init-framework .
```

### Un `package.json` que ya define `dev`, `check`, `build` o `start`

```sh bad
# package.json con "scripts": { "dev": "vite" }
meeko init-framework .
```

`El destino ya define el script dev: C:\proyectos\tienda`. No se escribe nada.

```sh good
# renombra o quita el script y vuelve a ejecutarlo
meeko init-framework .
```

## Notas

- **`.meeko/` no se versiona.** El `.gitignore` del starter lo excluye, igual que `.env`. Los tipos y entradas se regeneran con `meeko dev` o `meeko check`.
- **Sin servidor que configurar.** Las sesiones funcionan sin `server/runtime.ts`: en memoria en desarrollo y, en producción, en Redis con `MEEKO_REDIS_URL`. Añade `server/runtime.ts` con `defineServerRuntime` cuando necesites servicios, tu propio almacén o la política de Socket.
- **`.env.example`.** Documenta `MEEKO_PORT`, `MEEKO_HOST`, `MEEKO_PUBLIC_ORIGIN`, `MEEKO_REDIS_URL`, `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` y `MEEKO_TRUST_PROXY`. Cópialo a `.env`: `dev`, `build`, `start`, `preview` y `check` lo leen.
- **Versión exacta.** El proyecto fija la versión de `@meekojs/meeko` con la que se creó; actualízala a mano con el gestor de paquetes.
- **Windows y POSIX.** El mensaje usa `&&`, que funciona en PowerShell 7, `cmd` y POSIX.
