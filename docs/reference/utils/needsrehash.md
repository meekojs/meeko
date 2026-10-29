---
title: needsRehash
group: utils
since: 1.2.0
description: Indica si un hash de contraseña debe recalcularse con los parámetros actuales de hashPassword, para actualizarlo tras un inicio de sesión correcto.
symbols:
  - "@meekojs/meeko/password#needsRehash"
related:
  - "@meekojs/meeko/password#hashPassword"
  - "@meekojs/meeko/password#verifyPassword"
  - docs/framework.md#contraseñas
---

`needsRehash(hash)` dice si un hash guardado debe recalcularse con los parámetros actuales de `hashPassword`: su coste (N, r, p), su sal o su clave son menores que los actuales, o no tiene un formato válido. Es síncrona y no calcula ningún hash.

El momento de usarla es justo después de un inicio de sesión correcto: es la única vez que el servidor tiene la contraseña en claro para calcular el hash nuevo.

## Uso

<!-- no-check -->
```ts
import { hashPassword, needsRehash, verifyPassword } from "@meekojs/meeko/password";

if (await verifyPassword(input.password, user.passwordHash) && needsRehash(user.passwordHash)) {
  await db.users.update(user.id, { passwordHash: await hashPassword(input.password) });
}
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `hash` | `string` | obligatorio | El hash guardado. |

## Valor devuelto

`true` si conviene guardar un hash nuevo; `false` si el hash ya usa los parámetros actuales (o unos mayores). Nunca lanza: un texto que no es un hash de Meeko devuelve `true`.

| Hash | Resultado |
| --- | --- |
| El de `hashPassword` en esta versión (`scrypt$131072$8$1$…`) | `false` |
| `scrypt$16384$8$1$…`, de un coste menor | `true` |
| `bcrypt$…`, `$2b$10$…` o cualquier otro texto | `true` |

## Ejemplos

### En el procedimiento de inicio de sesión

<!-- no-check -->
```ts
// server/rpc/auth/login.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { hashPassword, needsRehash, verifyPassword } from "@meekojs/meeko/password";
import { loginInput, loginOutput } from "../../../shared/schemas/auth";

export default defineRpc({
  input: loginInput,
  output: loginOutput,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ input, context }) => {
    const user = await context.services.db.users.byEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new ApiError("INVALID_CREDENTIALS", 401);
    if (needsRehash(user.passwordHash)) {
      context.platform.waitUntil(hashPassword(input.password).then((passwordHash) => context.services.db.users.update(user.id, { passwordHash })));
    }
    await context.session.create({ userId: user.id });
    return { ok: true };
  },
});
```

`waitUntil` deja que el nuevo hash se calcule y se guarde sin retrasar la respuesta.

### Comprobar cuántas cuentas quedan por migrar

```ts
import { needsRehash } from "@meekojs/meeko/password";

export function pendingRehash(hashes: readonly string[]): number {
  return hashes.filter(needsRehash).length;
}
```

## Errores comunes

### Recalcular sin haber verificado

Sin `verifyPassword`, el hash nuevo se calcularía con una contraseña que nadie ha comprobado: cualquiera podría cambiar la de otra cuenta, sin ningún error.

```ts bad
if (needsRehash(user.passwordHash)) await save(user.id, await hashPassword(input.password));
```

<!-- no-check -->
```ts good
if (await verifyPassword(input.password, user.passwordHash) && needsRehash(user.passwordHash)) await save(user.id, await hashPassword(input.password));
```

### Llamarla con `await` esperando una promesa

`needsRehash` es síncrona. Un `await` sobra pero no falla; el error es tratar su resultado como una promesa.

```ts bad
needsRehash(hash).then((stale) => stale && rehash());
```

`meeko check` da `TS2339: Property 'then' does not exist on type 'boolean'.`

<!-- no-check -->
```ts good
if (needsRehash(hash)) await rehash();
```

## Notas

- **Coste.** No calcula nada: lee los parámetros del hash. Puedes llamarla en cada inicio de sesión.
- **Migraciones.** Con `verifyPassword` y otra biblioteca para los hashes antiguos, `needsRehash` devuelve `true` para cualquier hash que no sea de Meeko, así que la cuenta se migra en su siguiente inicio de sesión.
- **Runtimes.** Sólo en el servidor (Node, Bun y Deno), como el resto de `@meekojs/meeko/password`.
