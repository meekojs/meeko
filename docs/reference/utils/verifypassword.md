---
title: verifyPassword
group: utils
since: 1.2.0
description: Comprueba una contraseña contra un hash scrypt guardado, en tiempo constante, recalculándolo con los parámetros del propio hash.
symbols:
  - "@meekojs/meeko/password#verifyPassword"
related:
  - "@meekojs/meeko/password#hashPassword"
  - "@meekojs/meeko/password#needsRehash"
  - "@meekojs/meeko/server#defineRpc"
  - "cli:auth hash"
  - docs/framework.md#contraseñas
  - docs/framework.md#autenticación
---

`verifyPassword(password, hash)` comprueba una contraseña contra un hash `scrypt$<N>$<r>$<p>$<sal>$<hash>`: el de `hashPassword` o uno escrito antes con parámetros dentro de los límites de Meeko. Recalcula el hash con los parámetros guardados y lo compara en tiempo constante.

Se importa de `@meekojs/meeko/password`, sólo en el servidor (Node, Bun y Deno).

## Uso

<!-- no-check -->
```ts
// server/rpc/auth/login.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { verifyPassword } from "@meekojs/meeko/password";
import { loginInput, loginOutput } from "../../../shared/schemas/auth";

const DUMMY_HASH = "scrypt$131072$8$1$…"; // un hash cualquiera, calculado una vez con meeko auth hash

export default defineRpc({
  input: loginInput,
  output: loginOutput,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ input, context }) => {
    const user = await context.services.db.users.byEmail(input.email);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.session.create({ userId: user.id });
    return { ok: true };
  },
});
```

Comparar contra un hash fijo cuando el usuario no existe hace que la respuesta tarde lo mismo, y no revela qué correos tienen cuenta.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `password` | `string` | obligatorio | La contraseña recibida. |
| `hash` | `string` | obligatorio | El hash guardado. |

## Valor devuelto

Una promesa con `true` si la contraseña coincide y `false` si no. Una contraseña vacía o de más de 4096 bytes devuelve `false` sin calcular nada.

Lanza `TypeError: Invalid password hash: expected scrypt$<N>$<r>$<p>$<salt>$<hash> within Meeko's limits` si el hash no tiene el formato o sus parámetros están fuera de los límites (N potencia de dos entre 2^10 y 2^20, `r` hasta 32, `p` hasta 16). Es un fallo de configuración, no una contraseña incorrecta.

## Ejemplos

### Una cuenta de administración en `.env`

<!-- no-check -->
```ts
// server/api/admin/login.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { verifyPassword } from "@meekojs/meeko/password";
import { adminLogin, okResult } from "../../../shared/schemas/admin";

export default defineApiRoute({
  origin: "required",
  rateLimit: { limit: 5, window: "15m" },
  body: adminLogin,
  response: okResult,
  handler: async ({ body, context }) => {
    const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? "");
    if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.session.create({ user: body.username, role: "owner" });
    return { ok: true as const };
  },
});
```

Si `ADMIN_PASSWORD_HASH` falta, `verifyPassword` lanza `TypeError` por el hash vacío: el fallo de configuración aparece en el primer intento, en lugar de rechazar todas las contraseñas en silencio.

### Actualizar el hash tras entrar

<!-- no-check -->
```ts
if (await verifyPassword(input.password, user.passwordHash)) {
  if (needsRehash(user.passwordHash)) {
    await db.users.update(user.id, { passwordHash: await hashPassword(input.password) });
  }
}
```

## Errores comunes

### Un hash con otro formato

```ts bad
await verifyPassword(input.password, "$2b$10$…"); // un hash de bcrypt
```

`TypeError: Invalid password hash: expected scrypt$<N>$<r>$<p>$<salt>$<hash> within Meeko's limits`. Migra esas cuentas verificando con su biblioteca y guardando un hash nuevo con `hashPassword` tras el siguiente inicio de sesión.

<!-- no-check -->
```ts good
const valid = user.passwordHash.startsWith("scrypt$")
  ? await verifyPassword(input.password, user.passwordHash)
  : await bcrypt.compare(input.password, user.passwordHash);
```

### Responder distinto si el usuario no existe

Devolver antes cuando no hay usuario hace la respuesta más rápida y permite saber qué correos tienen cuenta, sin ningún error.

```ts bad
const user = await findUser(input.email);
if (!user) throw new ApiError("UNKNOWN_EMAIL", 404);
```

<!-- no-check -->
```ts good
const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
if (!user || !valid) throw new ApiError("INVALID_CREDENTIALS", 401);
```

### Esperar que lance con una contraseña incorrecta

`verifyPassword` sólo lanza por un hash mal formado: una contraseña incorrecta, vacía o demasiado larga devuelve `false`.

```ts bad
try { await verifyPassword(input.password, hash); } catch { throw new ApiError("INVALID_CREDENTIALS", 401); }
```

<!-- no-check -->
```ts good
if (!(await verifyPassword(input.password, hash))) throw new ApiError("INVALID_CREDENTIALS", 401);
```

## Notas

- **Seguridad.** Limita los intentos con `rateLimit` y exige `origin: "required"` en el inicio de sesión. Rota la sesión al entrar (`session.create` crea una nueva).
- **Coste.** Cada comprobación cuesta lo mismo que un `hashPassword`: unos 128 MiB y cientos de milisegundos.
- **Runtimes.** Sólo en Node, Bun y Deno; en un componente, el import avisa con `MEEK109`.
