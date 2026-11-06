# Middleware de rutas

El middleware de ruta se ejecuta antes de cargar los datos de la página. Es distinto del middleware HTTP de `server/middleware`, que también envuelve API y RPC. [Ver middleware HTTP](framework.md#middleware-de-servidor).

| Archivo                      | Se ejecuta            | Uso habitual                                     |
| ---------------------------- | --------------------- | ------------------------------------------------ |
| `app/middleware/*.ts`        | Servidor y navegador. | Mejorar la navegación o redirigir temprano.      |
| `app/middleware/*.server.ts` | Sólo servidor.        | Comprobar sesión y acceso antes de enviar datos. |

Ambas clases pueden ser globales o elegirse por ruta. Un guard de página no autoriza automáticamente sus endpoints API o RPC.

## Middleware con nombre

Declara `defineRouteMiddleware(fn, { global: false })` en `app/middleware/auth.ts` y elige `middleware: ['auth']` en `definePage` o `+group.ts`. Sin `{ global: false }`, se ejecuta globalmente en todas las rutas.

Los globales se ejecutan primero; después, los middleware con nombre que hereda o declara la página. `middleware: false` quita los heredados, no los globales. [Ver orden, herencia y errores](routing-middleware-reference.md#middleware-con-nombre).

## Middleware de ruta de servidor

Para leer la sesión usa `defineServerRouteMiddleware` en `app/middleware/auth.server.ts`. No entra al bundle del navegador; se ejecuta antes del código de servidor o `load` de la página.

```ts
// app/middleware/auth.server.ts
import { redirect } from '@meekojs/meeko/framework'

export default defineServerRouteMiddleware(
	({ session }) => {
		if (!session.current) redirect('/login')
	},
	{ global: false },
)
```

Elige `middleware: ['auth']` en las páginas o grupos protegidos. Valida también cada API o RPC que use la página. [Ver contextos, modos de render y host propio](routing-middleware-reference.md#middleware-de-ruta-de-servidor).
